const { Client, LocalAuth } = require('whatsapp-web.js');
const Auth = require('./models/Auth');
const Notification = require('./models/Notification');
const logger = require('./logger');
const sendEmail = require('./utils/email');
const { exec } = require('child_process');
const qrcode = require('qrcode');
const path = require('path');
const { saveSessionToDatabase, restoreSessionFromDatabase } = require('./SQLServerAuth'); // Import functions

// Define clients in the global scope
let clients = new Map();

class WhatsAppClientManager {
    constructor() {
        this.clients = clients;
        this.initializingClients = new Set(); // Track clients that are being initialized
    }

    async initializeClient(tenantId, useRemoteAuth = true) { // Default to useRemoteAuth
        if (this.initializingClients.has(tenantId)) {
            logger.warn(`Client initialization already in progress for tenantId: ${tenantId}`);
            return;
        }

        logger.info(`Initializing client for tenantId: ${tenantId}`);
        this.initializingClients.add(tenantId);
        logger.info(`Added tenantId: ${tenantId} to initializingClients`);

        try {
            const auth = await Auth.findOne({ where: { tenantId: tenantId.toString() } }); // Ensure tenantId is a string
            if (!auth) {
                logger.error(`No authentication found for tenantId: ${tenantId}`);
                this.initializingClients.delete(tenantId);
                logger.info(`Removed tenantId: ${tenantId} from initializingClients`);
                return; // Log the error and continue
            }

            const client = new Client({
                authStrategy: new LocalAuth({
                    clientId: tenantId.toString(),
                    dataPath: path.join(__dirname, '.wwebjs_auth')
                }),
                puppeteer: {
                    headless: true,
                    args: ['--no-sandbox', '--disable-setuid-sandbox']
                }
            });

            client.on('qr', async (qr) => {
                logger.info(`QR code generated for tenantId: ${tenantId}`);
                const qrCodeBase64 = await qrcode.toDataURL(qr);
                await auth.update({ qrCode: qrCodeBase64 });
            });

            client.on('ready', async () => {
                logger.info(`WhatsApp client ready for tenantId: ${tenantId}`);
                await saveSessionToDatabase(tenantId); // Save session to database
                logger.info(`Client initialization completed for tenantId: ${tenantId}`);
                this.initializingClients.delete(tenantId); // Remove from initializing set after initialization completes
                logger.info(`Removed tenantId: ${tenantId} from initializingClients`);

                // Start periodic session saving
                setInterval(async () => {
                    await saveSessionToDatabase(tenantId);
                }, 60000); // Save session every minute
            });

            client.on('authenticated', async (session) => {
                logger.info(`WhatsApp authenticated for tenantId: ${tenantId}`);
                await auth.update({ sessionData: `session-${tenantId}`, qrCode: null });
            });

            client.on('auth_failure', async () => {
                logger.error(`Authentication failed for tenantId: ${tenantId}`);
                const auth = await Auth.findOne({ where: { tenantId: tenantId.toString() } });
                if (auth && !auth.qrCode) {
                    logger.info(`Generating QR code for tenantId: ${tenantId}`);
                    await this.generateQRCode(tenantId);
                }
                this.initializingClients.delete(tenantId); // Remove from initializing set
                logger.info(`Removed tenantId: ${tenantId} from initializingClients`);
            });

            client.on('disconnected', async () => {
                logger.warn(`WhatsApp client disconnected for tenantId: ${tenantId}`);
                this.clients.delete(tenantId);
                logger.info(`Removed tenantId: ${tenantId} from clients`);
                this.initializingClients.delete(tenantId); // Remove from initializing set
                logger.info(`Removed tenantId: ${tenantId} from initializingClients`);

                await this.notifyTenantDisconnection(tenantId);
                this.reconnectClient(tenantId, 3);
            });

            client.on('change_state', async (state) => {
                if (state === 'CONFLICT' || state === 'UNLAUNCHED') {
                    logger.warn(`Client state changed to ${state} for tenantId: ${tenantId}. Attempting to restore session from database.`);
                    await restoreSessionFromDatabase(tenantId); // Restore session from database
                    await client.initialize(); // Reinitialize client with restored session
                }
            });

            await client.initialize();
            this.clients.set(tenantId, client);
            logger.info(`Added tenantId: ${tenantId} to clients`);
            logger.info(`Initialized client for tenantId: ${tenantId}`);
        } catch (error) {
            this.initializingClients.delete(tenantId); // Remove from initializing set
            logger.info(`Removed tenantId: ${tenantId} from initializingClients`);
            logger.error(`Failed to initialize client for tenantId: ${tenantId}. Error: ${error.message}`);
            if (error.message.includes('net::ERR_INTERNET_DISCONNECTED')) {
                logger.error(`Failed to initialize client for tenantId: ${tenantId} due to internet disconnection. Retrying in 30 seconds...`);
                setTimeout(() => this.initializeClient(tenantId, useRemoteAuth), 30000); // Retry after 30 seconds
            }
        }
    }

    async reconnectClient(tenantId, retries) {
        for (let i = 0; i < retries; i++) {
            logger.info(`Reconnection attempt ${i + 1} for tenantId: ${tenantId}`);
            try {
                await this.initializeClient(tenantId, true);
                logger.info(`Reconnection successful for tenantId: ${tenantId}`);
                return;
            } catch (error) {
                logger.error(`Reconnection attempt ${i + 1} failed for tenantId: ${tenantId}. Error: ${error.message}`);
            }
        }

        logger.error(`All reconnection attempts failed for tenantId: ${tenantId}`);
        await this.notifyTenantReconnectionFailure(tenantId);
    }

    async reinitializeClients() {
        logger.info('Reinitializing all clients');
        const allAuths = await Auth.findAll();
        for (const auth of allAuths) {
            try {
                await this.initializeClient(auth.tenantId.toString(), true); // Ensure tenantId is a string
            } catch (error) {
                logger.error(`Failed to reinitialize client for tenantId: ${auth.tenantId}. Error: ${error.message}`);
            }
        }
    }

    getClient(tenantId) {
        logger.info(`Getting client for tenantId: ${tenantId}`);
        const client = this.clients.get(tenantId);
        if (!client) {
            logger.error(`No client found for tenantId: ${tenantId}`);
            throw new Error(`No client found for tenantId: ${tenantId}`);
        }
        if (!client.info) {
            logger.error(`Client for tenantId: ${tenantId} is not ready`);
            throw new Error(`Client for tenantId: ${tenantId} is not ready`);
        }
        logger.info(`Client found and ready for tenantId: ${tenantId}`);
        return client;
    }

    async sendMessage(tenantId, phoneNumber, message) {
        logger.info(`Sending message to ${phoneNumber} for tenantId: ${tenantId}`);
        try {
            const client = this.getClient(tenantId);
            // Ensure the phone number is correctly formatted
            const formattedPhoneNumber = phoneNumber.includes('@c.us') ? phoneNumber : `${phoneNumber}@c.us`;
            await client.sendMessage(formattedPhoneNumber, message);
            logger.info(`Message sent to ${phoneNumber} for tenantId: ${tenantId}`);
        } catch (error) {
            logger.error(`Failed to send message to ${phoneNumber} for tenantId: ${tenantId}. Error: ${error.message}`);
            throw error;
        }
    }

    async notifyTenantDisconnection(tenantId) {
        logger.info(`Notifying tenant disconnection for tenantId: ${tenantId}`);
        const auth = await Auth.findOne({ where: { tenantId } });
        if (!auth) return;

        const message = `Your WhatsApp session has been disconnected. Attempting to reconnect...`;

        await Notification.create({ tenantId, message });
        sendEmail(auth.phoneNumber, 'WhatsApp Session Disconnected', message);
    }

    async notifyTenantReconnectionFailure(tenantId) {
        logger.info(`Notifying tenant reconnection failure for tenantId: ${tenantId}`);
        const auth = await Auth.findOne({ where: { tenantId } });
        if (!auth) return;

        const message = `All attempts to reconnect your WhatsApp session have failed. Please reauthenticate.`;

        await Notification.create({ tenantId, message });
    }

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

    async checkSessionStatus() {
        logger.info('Checking session status');
        for (const [tenantId, client] of this.clients.entries()) {
            try {
                await saveSessionToDatabase(tenantId);
                logger.info(`Session saved for tenantId: ${tenantId}`);
            } catch (error) {
                logger.error(`Failed to save session for tenantId: ${tenantId}. Error: ${error.message}`);
            }
        }
    }

    async generateQRCode(tenantId) {
        logger.info(`Generating QR code for tenantId: ${tenantId}`);
        let client = this.clients.get(tenantId);
        if (!client) {
            await this.initializeClient(tenantId, true);
            client = this.clients.get(tenantId);
        }

        // Check if client is already authenticated
        if (client.info) {
            logger.info(`Client for tenantId: ${tenantId} is already authenticated. Skipping QR code generation.`);
            return;
        }

        return new Promise((resolve, reject) => {
            const checkClientReady = setInterval(() => {
                client = this.clients.get(tenantId);
                if (client) {
                    clearInterval(checkClientReady);
                    client.on('qr', (qr) => {
                        resolve(qr);
                    });

                    client.on('auth_failure', (msg) => {
                        reject(new Error(`Authentication failed: ${msg}`));
                    });

                    client.on('authenticated', async (session) => {
                        logger.info(`WhatsApp authenticated for tenantId: ${tenantId}`);
                        logger.info(`Session data: ${JSON.stringify(session)}`); // Log session data
                        if (!session) {
                            logger.error('Session data is undefined');
                            return;
                        }
                        const auth = await Auth.findOne({ where: { tenantId } });
                        if (auth) {
                            await auth.update({ sessionData: `session-${tenantId}`, qrCode: null });
                        }
                        await saveSessionToDatabase(tenantId); // Ensure session data is saved in the database
                    });

                    client.initialize();
                }
            }, 1000); // Check every second if the client is ready
        });
    }

    async scanQRCode(tenantId, qrCode) {
        logger.info(`Scanning QR code for tenantId: ${tenantId}`);
        let client = this.clients.get(tenantId);
        if (!client) {
            await this.initializeClient(tenantId, true);
            client = this.clients.get(tenantId);
        }

        client.on('qr', (qr) => {
            if (qr === qrCode) {
                client.emit('authenticated');
            }
        });

        client.on('authenticated', async (session) => {
            logger.info(`WhatsApp authenticated for tenantId: ${tenantId}`);
            logger.info(`Session data: ${JSON.stringify(session)}`); // Log session data
            if (!session) {
                logger.error('Session data is undefined');
                return;
            }
            const auth = await Auth.findOne({ where: { tenantId } });
            if (auth) {
                await auth.update({ sessionData: `session-${tenantId}`, qrCode: null });
            }
            await saveSessionToDatabase(tenantId); // Ensure session data is saved in the database
        });

        client.initialize();
    }

    isClientInitializing(tenantId) {
        return this.initializingClients.has(tenantId);
    }

    isClientReady(tenantId) {
        const client = this.clients.get(tenantId);
        return client && client.info;
    }
}

module.exports = new WhatsAppClientManager();
