const { Client, LocalAuth } = require('whatsapp-web.js');
const Auth = require('./models/Auth');
const Notification = require('./models/Notification');
const logger = require('./logger');
const sendEmail = require('./utils/email');
const { exec } = require('child_process');
const qrcode = require('qrcode');
const path = require('path');
const { saveSessionToDatabase, restoreSessionFromDatabase } = require('./SQLServerAuth');

class WhatsAppClientManager {
    constructor() {
        this.clients = new Map(); // Store clients by tenantId (string)
        this.initializingClients = new Set(); // Track clients being initialized
        this.savingSessions = new Set(); // Track clients whose sessions are being saved
    }

    /**
     * Initialize a WhatsApp client for a specific tenant.
     * @param {string|number} tenantId - The tenant ID.
     * @param {boolean} useRemoteAuth - Whether to use remote authentication.
     */
    async initializeClient(tenantId, useRemoteAuth = true) {
        const tenantIdStr = tenantId.toString(); // Ensure tenantId is a string

        if (this.initializingClients.has(tenantIdStr)) {
            logger.warn(`Client initialization already in progress for tenantId: ${tenantIdStr}`);
            return;
        }

        logger.info(`Initializing client for tenantId: ${tenantIdStr}`);
        this.initializingClients.add(tenantIdStr);

        try {
            const auth = await Auth.findOne({ where: { tenantId: tenantIdStr } });
            if (!auth) {
                logger.error(`No authentication found for tenantId: ${tenantIdStr}`);
                this.initializingClients.delete(tenantIdStr);
                return;
            }

            const client = new Client({
                authStrategy: new LocalAuth({
                    clientId: tenantIdStr,
                    dataPath: path.join(__dirname, '.wwebjs_auth')
                }),
                puppeteer: {
                    headless: true,
                    args: ['--no-sandbox', '--disable-setuid-sandbox']
                }
            });

            // Event: QR Code Generated
            client.on('qr', async (qr) => {
                logger.info(`QR code generated for tenantId: ${tenantIdStr}`);
                const qrCodeBase64 = await qrcode.toDataURL(qr);
                await auth.update({ qrCode: qrCodeBase64 });
            });

            // Event: Client Ready
            client.on('ready', async () => {
                logger.info(`WhatsApp client ready for tenantId: ${tenantIdStr}`);
                await this.saveSessionWithLock(tenantIdStr);
                this.initializingClients.delete(tenantIdStr);

                // Start periodic session saving
                setInterval(async () => {
                    await this.saveSessionWithLock(tenantIdStr);
                }, 500000); // Save session every minute

                // Start periodic chat status update
                setInterval(async () => {
                    await this.updateChatStatus(tenantIdStr);
                }, 400000); // Update chat status every 5 minutes

                // Start periodic client status update
                setInterval(async () => {
                    await this.updateClientStatus(tenantIdStr);
                }, 300000); // Update client status every 30 seconds
            });

            // Event: Authenticated
            client.on('authenticated', async (session) => {
                logger.info(`WhatsApp authenticated for tenantId: ${tenantIdStr}`);
                await auth.update({ sessionData: `session-${tenantIdStr}`, qrCode: null });
            });

            // Event: Authentication Failure
            client.on('auth_failure', async () => {
                logger.error(`Authentication failed for tenantId: ${tenantIdStr}`);
                const auth = await Auth.findOne({ where: { tenantId: tenantIdStr } });
                if (auth && !auth.qrCode) {
                    logger.info(`Generating QR code for tenantId: ${tenantIdStr}`);
                    await this.generateQRCode(tenantIdStr);
                }
                this.initializingClients.delete(tenantIdStr);
            });

            // Event: Disconnected
            client.on('disconnected', async () => {
                logger.warn(`WhatsApp client disconnected for tenantId: ${tenantIdStr}`);
                this.clients.delete(tenantIdStr);
                this.initializingClients.delete(tenantIdStr);

                await this.notifyTenantDisconnection(tenantIdStr);
                this.reconnectClient(tenantIdStr, 3); // Retry reconnection 3 times
            });

            // Event: State Changed
            client.on('change_state', async (state) => {
                logger.info(`Client state changed to ${state} for tenantId: ${tenantIdStr}`);
                if (state === 'CONFLICT' || state === 'UNLAUNCHED') {
                    logger.warn(`Client state changed to ${state} for tenantId: ${tenantIdStr}. Attempting to restore session from database.`);
                    await restoreSessionFromDatabase(tenantIdStr);
                    await client.initialize();
                }
            });

            await client.initialize();
            this.clients.set(tenantIdStr, client);
            logger.info(`Initialized client for tenantId: ${tenantIdStr}`);
        } catch (error) {
            this.initializingClients.delete(tenantIdStr);
            logger.error(`Failed to initialize client for tenantId: ${tenantIdStr}. Error: ${error.message}`);
            if (error.message.includes('net::ERR_INTERNET_DISCONNECTED')) {
                logger.error(`Failed to initialize client for tenantId: ${tenantIdStr} due to internet disconnection. Retrying in 30 seconds...`);
                setTimeout(() => this.initializeClient(tenantIdStr, useRemoteAuth), 30000);
            }
        }
    }

    /**
     * Reconnect a client for a specific tenant.
     * @param {string|number} tenantId - The tenant ID.
     * @param {number} retries - Number of retry attempts.
     */
    async reconnectClient(tenantId, retries) {
        const tenantIdStr = tenantId.toString(); // Ensure tenantId is a string

        for (let i = 0; i < retries; i++) {
            logger.info(`Reconnection attempt ${i + 1} for tenantId: ${tenantIdStr}`);
            try {
                await this.initializeClient(tenantIdStr, true);
                logger.info(`Reconnection successful for tenantId: ${tenantIdStr}`);
                return;
            } catch (error) {
                logger.error(`Reconnection attempt ${i + 1} failed for tenantId: ${tenantIdStr}. Error: ${error.message}`);
            }
        }

        logger.error(`All reconnection attempts failed for tenantId: ${tenantIdStr}`);
        await this.notifyTenantReconnectionFailure(tenantIdStr);
    }

    /**
     * Reinitialize all clients.
     */
    async reinitializeClients() {
        logger.info('Reinitializing all clients');
        const allAuths = await Auth.findAll();
        for (const auth of allAuths) {
            try {
                await this.initializeClient(auth.tenantId.toString(), true);
            } catch (error) {
                logger.error(`Failed to reinitialize client for tenantId: ${auth.tenantId}. Error: ${error.message}`);
            }
        }
    }

    /**
     * Get a client for a specific tenant.
     * @param {string|number} tenantId - The tenant ID.
     * @returns {Client} - The WhatsApp client.
     */
    getClient(tenantId) {
        const tenantIdStr = tenantId.toString(); // Ensure tenantId is a string
        logger.info(`Getting client for tenantId: ${tenantIdStr}`);
        const client = this.clients.get(tenantIdStr);
        if (!client) {
            logger.error(`No client found for tenantId: ${tenantIdStr}`);
            throw new Error(`No client found for tenantId: ${tenantIdStr}`);
        }
        if (!client.info) {
            logger.error(`Client for tenantId: ${tenantIdStr} is not ready`);
            throw new Error(`Client for tenantId: ${tenantIdStr} is not ready`);
        }
        logger.info(`Client found and ready for tenantId: ${tenantIdStr}`);
        return client;
    }

    /**
     * Send a WhatsApp message.
     * @param {string|number} tenantId - The tenant ID.
     * @param {string} phoneNumber - The recipient's phone number.
     * @param {string} message - The message to send.
     */
    async sendMessage(tenantId, phoneNumber, message) {
        const tenantIdStr = tenantId.toString(); // Ensure tenantId is a string
        logger.info(`Sending message to ${phoneNumber} for tenantId: ${tenantIdStr}`);
        try {
            let client = this.clients.get(tenantIdStr);

            // Ensure the client session is completely terminated and reactivated before sending the message
            if (client) {
                logger.info(`Terminating client session for tenantId: ${tenantIdStr}`);
                await client.destroy();
                this.clients.delete(tenantIdStr);
            }

            // Wait until any ongoing initialization is complete
            while (this.initializingClients.has(tenantIdStr)) {
                logger.warn(`Waiting for client initialization to complete for tenantId: ${tenantIdStr}`);
                await new Promise(resolve => setTimeout(resolve, 1000));
            }

            logger.info(`Reactivating client session for tenantId: ${tenantIdStr}`);
            await this.initializeClient(tenantIdStr, true);

            // Wait until the client is ready
            await new Promise((resolve, reject) => {
                const timeout = setTimeout(() => {
                    reject(new Error('Client initialization timed out'));
                }, 60000); // Timeout after 60 seconds

                const checkClientReady = setInterval(() => {
                    client = this.clients.get(tenantIdStr);
                    if (client && client.info) {
                        clearInterval(checkClientReady);
                        clearTimeout(timeout);
                        resolve();
                    }
                }, 1000); // Check every second
            });

            const formattedPhoneNumber = phoneNumber.includes('@c.us') ? phoneNumber : `${phoneNumber}@c.us`;
            await client.sendMessage(formattedPhoneNumber, message);
            logger.info(`Message sent to ${phoneNumber} for tenantId: ${tenantIdStr}`);
        } catch (error) {
            logger.error(`Failed to send message to ${phoneNumber} for tenantId: ${tenantIdStr}. Error: ${error.message}`);
            throw error;
        }
    }

    /**
     * Notify tenant about disconnection.
     * @param {string|number} tenantId - The tenant ID.
     */
    async notifyTenantDisconnection(tenantId) {
        const tenantIdStr = tenantId.toString(); // Ensure tenantId is a string
        logger.info(`Notifying tenant disconnection for tenantId: ${tenantIdStr}`);
        const auth = await Auth.findOne({ where: { tenantId: tenantIdStr } });
        if (!auth) return;

        const message = `Your WhatsApp session has been disconnected. Attempting to reconnect...`;
        await Notification.create({ tenantId: tenantIdStr, message });
        sendEmail(auth.phoneNumber, 'WhatsApp Session Disconnected', message);
    }

    /**
     * Notify tenant about reconnection failure.
     * @param {string|number} tenantId - The tenant ID.
     */
    async notifyTenantReconnectionFailure(tenantId) {
        const tenantIdStr = tenantId.toString(); // Ensure tenantId is a string
        logger.info(`Notifying tenant reconnection failure for tenantId: ${tenantIdStr}`);
        const auth = await Auth.findOne({ where: { tenantId: tenantIdStr } });
        if (!auth) return;

        const message = `All attempts to reconnect your WhatsApp session have failed. Please reauthenticate.`;
        await Notification.create({ tenantId: tenantIdStr, message });
    }

    /**
     * Get monitoring data for all clients.
     * @returns {Array} - Array of client statuses.
     */
    async getMonitoringData() {
        logger.info('Getting monitoring data');
        const data = [];
        for (const [tenantId, client] of this.clients.entries()) {
            data.push({
                tenantId,
                status: client.info ? 'connected' : 'disconnected',
            });
        }
        return data;
    }

    /**
     * Check for updates to the whatsapp-web.js library.
     */
    async checkForUpdates() {
        logger.info('Checking for updates');
        exec('npm outdated whatsapp-web.js', (error, stdout, stderr) => {
            if (error) {
                logger.error(`Error checking for updates: ${error.message}`);
                return;
            }
            if (stdout) {
                logger.info(`Update available for whatsapp-web.js: ${stdout}`);
                exec('npm update whatsapp-web.js', (updateError, updateStdout, updateStderr) => {
                    if (updateError) {
                        logger.error(`Error updating whatsapp-web.js: ${updateError.message}`);
                        return;
                    }
                    logger.info(`whatsapp-web.js updated: ${updateStdout}`);
                });
            } else {
                logger.info('whatsapp-web.js is up to date');
            }
        });
    }

    /**
     * Check connectivity for all clients.
     */
    async checkConnectivity() {
        logger.info('Checking connectivity');
        for (const [tenantId, client] of this.clients.entries()) {
            if (!client.info) {
                logger.warn(`Client for tenantId ${tenantId} is disconnected. Reinitializing...`);
                if (!this.initializingClients.has(tenantId)) {
                    await this.initializeClient(tenantId, true);
                }
            }
        }
    }

    /**
     * Check client status for all clients.
     */
    async checkClientStatus() {
        logger.info('Checking client status');
        for (const [tenantId, client] of this.clients.entries()) {
            if (!client.info) {
                logger.warn(`Client for tenantId ${tenantId} is not ready. Attempting to reinitialize...`);
                if (!this.initializingClients.has(tenantId)) {
                    await this.initializeClient(tenantId, true);
                }
            }
        }
    }

    /**
     * Check session status for all clients.
     */
    async checkSessionStatus() {
        logger.info('Checking session status');
        for (const [tenantId, client] of this.clients.entries()) {
            if (client.info) { // Only save session if client is ready
                try {
                    await this.saveSessionWithLock(tenantId);
                    logger.info(`Session saved for tenantId: ${tenantId}`);
                } catch (error) {
                    logger.error(`Failed to save session for tenantId: ${tenantId}. Error: ${error.message}`);
                }
            } else {
                logger.warn(`Client for tenantId: ${tenantId} is not ready. Skipping session save.`);
            }
        }
    }

    /**
     * Save session with a lock to prevent concurrent saves.
     * @param {string} tenantId - The tenant ID.
     */
    async saveSessionWithLock(tenantId) {
        const tenantIdStr = tenantId.toString(); // Ensure tenantId is a string

        if (this.savingSessions.has(tenantIdStr)) {
            logger.warn(`Session save already in progress for tenantId: ${tenantIdStr}`);
            return;
        }

        this.savingSessions.add(tenantIdStr);
        try {
            await saveSessionToDatabase(tenantIdStr);
        } catch (error) {
            logger.error(`Failed to save session for tenantId: ${tenantIdStr}. Error: ${error.message}`);
        } finally {
            this.savingSessions.delete(tenantIdStr);
        }
    }

    /**
     * Generate a QR code for a specific tenant.
     * @param {string|number} tenantId - The tenant ID.
     * @returns {Promise<string>} - The QR code data URL.
     */
    async generateQRCode(tenantId) {
        const tenantIdStr = tenantId.toString(); // Ensure tenantId is a string
        logger.info(`Generating QR code for tenantId: ${tenantIdStr}`);
        let client = this.clients.get(tenantIdStr);
        if (!client) {
            await this.initializeClient(tenantIdStr, true);
            client = this.clients.get(tenantIdStr);
        }

        if (client.info) {
            logger.info(`Client for tenantId: ${tenantIdStr} is already authenticated. Skipping QR code generation.`);
            return;
        }

        return new Promise((resolve, reject) => {
            const checkClientReady = setInterval(() => {
                client = this.clients.get(tenantIdStr);
                if (client) {
                    clearInterval(checkClientReady);
                    client.on('qr', (qr) => {
                        resolve(qr);
                    });

                    client.on('auth_failure', (msg) => {
                        reject(new Error(`Authentication failed: ${msg}`));
                    });

                    client.on('authenticated', async (session) => {
                        logger.info(`WhatsApp authenticated for tenantId: ${tenantIdStr}`);
                        const auth = await Auth.findOne({ where: { tenantId: tenantIdStr } });
                        if (auth) {
                            await auth.update({ sessionData: `session-${tenantIdStr}`, qrCode: null });
                        }
                        await saveSessionToDatabase(tenantIdStr);
                    });

                    client.initialize();
                }
            }, 1000);
        });
    }

    /**
     * Scan a QR code for a specific tenant.
     * @param {string|number} tenantId - The tenant ID.
     * @param {string} qrCode - The QR code data.
     */
    async scanQRCode(tenantId, qrCode) {
        const tenantIdStr = tenantId.toString(); // Ensure tenantId is a string
        logger.info(`Scanning QR code for tenantId: ${tenantIdStr}`);
        let client = this.clients.get(tenantIdStr);
        if (!client) {
            await this.initializeClient(tenantIdStr, true);
            client = this.clients.get(tenantIdStr);
        }

        client.on('qr', (qr) => {
            if (qr === qrCode) {
                client.emit('authenticated');
            }
        });

        client.on('authenticated', async (session) => {
            logger.info(`WhatsApp authenticated for tenantId: ${tenantIdStr}`);
            const auth = await Auth.findOne({ where: { tenantId: tenantIdStr } });
            if (auth) {
                await auth.update({ sessionData: `session-${tenantIdStr}`, qrCode: null });
            }
            await saveSessionToDatabase(tenantIdStr);
        });

        client.initialize();
    }

    /**
     * Check if a client is being initialized.
     * @param {string|number} tenantId - The tenant ID.
     * @returns {boolean} - Whether the client is being initialized.
     */
    isClientInitializing(tenantId) {
        const tenantIdStr = tenantId.toString(); // Ensure tenantId is a string
        return this.initializingClients.has(tenantIdStr);
    }

    /**
     * Check if a client is ready.
     * @param {string|number} tenantId - The tenant ID.
     * @returns {boolean} - Whether the client is ready.
     */
    isClientReady(tenantId) {
        const tenantIdStr = tenantId.toString(); // Ensure tenantId is a string
        const client = this.clients.get(tenantIdStr);
        return client && client.info;
    }

    /**
     * Update chat status for a specific tenant.
     * @param {string} tenantId - The tenant ID.
     */
    async updateChatStatus(tenantId) {
        const tenantIdStr = tenantId.toString(); // Ensure tenantId is a string
        logger.info(`Updating chat status for tenantId: ${tenantIdStr}`);

        try {
            const client = this.clients.get(tenantIdStr);
            if (!client || !client.info) {
                logger.warn(`Client for tenantId: ${tenantIdStr} is not ready. Skipping chat status update.`);
                return;
            }

            const chats = await client.getChats();
            for (const chat of chats) {
                const messages = await chat.fetchMessages({ limit: 1 });
                if (messages.length > 0) {
                    const lastMessage = messages[0];
                    logger.info(`Last message for chat ${chat.id._serialized} in tenantId: ${tenantIdStr}: ${lastMessage.body}`);
                    // Here you can save the last message status to the database or perform any other necessary actions
                }
            }
        } catch (error) {
            logger.error(`Failed to update chat status for tenantId: ${tenantIdStr}. Error: ${error.message}`);
        }
    }

    /**
     * Update client status for a specific tenant.
     * @param {string} tenantId - The tenant ID.
     */
    async updateClientStatus(tenantId) {
        const tenantIdStr = tenantId.toString(); // Ensure tenantId is a string
        logger.info(`Updating client status for tenantId: ${tenantIdStr}`);

        try {
            const client = this.clients.get(tenantIdStr);
            if (!client || !client.info) {
                logger.warn(`Client for tenantId: ${tenantIdStr} is not ready. Skipping client status update.`);
                return;
            }

            // Here you can update the client status in the database or perform any other necessary actions
            logger.info(`Client status for tenantId: ${tenantIdStr} is ready`);

            // Update local client session status if another party using the same session connects
            if (client.info.pushname !== client.info.wid.user) {
                logger.warn(`Client session for tenantId: ${tenantIdStr} has been taken over by another party. Reinitializing...`);
                await this.initializeClient(tenantIdStr, true);
            }
        } catch (error) {
            logger.error(`Failed to update client status for tenantId: ${tenantIdStr}. Error: ${error.message}`);
        }
    }
}

module.exports = new WhatsAppClientManager();