const { Client, LocalAuth, MessageMedia } = require('whatsapp-web.js');
const Auth = require('./models/Auth');
const Notification = require('./models/Notification');
const logger = require('./logger');
const sendEmail = require('./utils/email');
const { exec } = require('child_process');
const qrcode = require('qrcode');
const path = require('path');
const { saveSessionToDatabase, restoreSessionFromDatabase } = require('./SQLServerAuth');
const { schedule } = require('node-cron');
const { v4: uuidv4 } = require('uuid');
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

class WhatsAppClientManager {
    constructor() {
        this.clients = new Map();
        this.initializingClients = new Set();
        this.savingSessions = new Set();
        this.messageQueue = [];
        this.reconnectAttempts = new Map();
        this.CONFIG = {
            CHECK_INTERVAL: 10000,
            RECONNECT_INTERVAL: 5000,
            MAX_RECONNECT_ATTEMPTS: 3,
            MEMORY_LIMIT: 500 * 1024 * 1024,
            PUPPETEER_TIMEOUT: 60000,
            MAX_QUEUE_SIZE: 50,
            MESSAGE_RETRY_LIMIT: 3,
            SESSION_DIR: path.join(process.cwd(), 'sessions'),
            INITIALIZATION_DELAY: 5000
        };

        this.app = express();
        this.server = http.createServer(this.app);
        this.io = new Server(this.server, {
            cors: {
                origin: "http://localhost:5173",
                methods: ["GET", "POST"]
            }
        });

        this.initializeSystem();
        this.setupSocketEvents();
    }

    initializeSystem() {
        this.setupErrorHandlers();
        this.startMemoryWatcher();
        this.setupScheduledTasks();
        this.startServer();
    }

    setupErrorHandlers() {
        process.on('unhandledRejection', (reason, promise) => {
            logger.error(`[ERROR] Unhandled Rejection at: ${promise}, reason: ${reason}`);
        });

        process.on('uncaughtException', (error) => {
            logger.error(`[ERROR] Uncaught Exception: ${error.message}`);
            this.gracefulShutdown();
        });
    }

    startMemoryWatcher() {
        setInterval(() => {
            const memory = process.memoryUsage();
            if (memory.heapUsed > this.CONFIG.MEMORY_LIMIT) {
                logger.warn('[MEMORY] High memory usage detected - Restarting');
                this.gracefulShutdown();
            }
        }, 60000);
    }

    setupScheduledTasks() {
        schedule('0 4 * * *', () => {
            logger.info('[CRON] Daily restart initiated');
            this.gracefulShutdown();
        });
    }

    async gracefulShutdown() {
        logger.info('[SHUTDOWN] Initiating graceful shutdown');
        for (const [tenantId, client] of this.clients.entries()) {
            try {
                await client.destroy();
                logger.info(`[SHUTDOWN] Client destroyed for tenant: ${tenantId}`);
            } catch (error) {
                logger.error(`[SHUTDOWN] Destruction error for ${tenantId}: ${error.message}`);
            }
        }
        process.exit(0);
    }

    startServer() {
        this.server.listen(this.CONFIG.PORT, () => {
            logger.info(`[SERVER] Running on port ${this.CONFIG.PORT}`);
        });

        this.server.on('error', (error) => {
            if (error.code === 'EADDRINUSE') {
                logger.warn(`[SERVER] Port ${this.CONFIG.PORT} in use - Retrying...`);
                setTimeout(() => {
                    this.server.close();
                    this.startServer();
                }, 5000);
            } else {
                logger.error(`[SERVER] Error: ${error.message}`);
                process.exit(1);
            }
        });
    }

    setupSocketEvents() {
        this.io.on('connection', (socket) => {
            logger.info('[SOCKET] Client connected');

            socket.on('startService', (tenantId) => {
                logger.info(`[SOCKET] Start service requested for tenant: ${tenantId}`);
                this.initializeClient(tenantId);
            });

            socket.on('stopService', async (tenantId) => {
                logger.info(`[SOCKET] Stop service requested for tenant: ${tenantId}`);
                await this.destroyClient(tenantId);
            });

            socket.on('sendMessage', async (data) => {
                const { tenantId, phoneNumber, message } = data;
                logger.info(`[SOCKET] Send message requested for tenant: ${tenantId}`);
                try {
                    await this.sendMessage(tenantId, phoneNumber, message);
                    socket.emit('messageSent', { id: data.id, success: true });
                } catch (error) {
                    logger.error(`[SOCKET] Message failed for ${tenantId}: ${error.message}`);
                    socket.emit('messageSent', { id: data.id, success: false, error: error.message });
                }
            });

            socket.on('disconnect', () => {
                logger.info('[SOCKET] Client disconnected');
            });
        });
    }

    async initializeClient(tenantId, useRemoteAuth = true) {
        const tenantIdStr = tenantId.toString();

        if (this.initializingClients.has(tenantIdStr)) {
            logger.warn(`[INIT] Initialization already in progress for tenant: ${tenantIdStr}`);
            return;
        }

        this.initializingClients.add(tenantIdStr);
        logger.info(`[INIT] Starting client for tenant: ${tenantIdStr}`);

        try {
            const auth = await Auth.findOne({ where: { tenantId: tenantIdStr } });
            if (!auth) {
                logger.error(`[INIT] No auth found for tenant: ${tenantIdStr}`);
                this.initializingClients.delete(tenantIdStr);
                return;
            }

            const client = new Client({
                authStrategy: new LocalAuth({
                    clientId: tenantIdStr,
                    dataPath: path.join(__dirname, '.wwebjs_auth'),
                    backupSyncIntervalMs: 300000
                }),
                puppeteer: {
                    headless: true,
                    args: [
                        '--no-sandbox',
                        '--disable-setuid-sandbox',
                        '--disable-dev-shm-usage',
                        '--single-process',
                        '--no-zygote',
                        '--disable-accelerated-2d-canvas',
                        '--disable-gpu'
                    ],
                    timeout: this.CONFIG.PUPPETEER_TIMEOUT,
                    handleSIGINT: false
                },
                takeoverOnConflict: true,
                restartOnAuthFail: true,
                qrMaxRetries: 5,
                authTimeoutMs: 30000
            });

            this.setupClientEvents(client, tenantIdStr);
            await client.initialize();
            
            this.clients.set(tenantIdStr, client);
            logger.info(`[INIT] Client initialized for tenant: ${tenantIdStr}`);
        } catch (error) {
            logger.error(`[INIT] Initialization failed for ${tenantIdStr}: ${error.message}`);
            this.handleReconnection(tenantIdStr);
        }
    }

    setupClientEvents(client, tenantId) {
        client.on('qr', async (qr) => {
            logger.info(`[AUTH] QR generated for ${tenantId}`);
            const qrCodeBase64 = await qrcode.toDataURL(qr);
            await Auth.update({ qrCode: qrCodeBase64 }, { where: { tenantId } });
            this.io.emit('qr', { qr: qrCodeBase64, tenantId });
        });

        client.on('ready', async () => {
            logger.info(`[STATUS] Client ready for ${tenantId}`);
            await this.handleClientReady(tenantId);
            this.io.emit('ready', { tenantId });
        });

        client.on('authenticated', async (session) => {
            logger.info(`[AUTH] Authenticated for ${tenantId}`);
            await Auth.update({ sessionData: `session-${tenantId}`, qrCode: null }, { where: { tenantId } });
        });

        client.on('auth_failure', async (msg) => {
            logger.error(`[AUTH] Auth failure for ${tenantId}: ${msg}`);
            this.handleReconnection(tenantId);
        });

        client.on('disconnected', async (reason) => {
            logger.warn(`[STATUS] Disconnected from ${tenantId}: ${reason}`);
            await this.handleDisconnection(tenantId);
        });

        client.on('change_state', (state) => {
            logger.info(`[STATE] State changed to ${state} for ${tenantId}`);
            if (state === 'CONFLICT') this.handleSessionConflict(tenantId);
        });

        client.on('error', (error) => {
            logger.error(`[ERROR] Client error for ${tenantId}: ${error.message}`);
            if (this.isSessionError(error)) this.handleReconnection(tenantId);
        });
    }

    async handleClientReady(tenantId) {
        await this.saveSessionWithLock(tenantId);
        this.initializingClients.delete(tenantId);
        this.reconnectAttempts.delete(tenantId);

        setInterval(async () => {
            await this.saveSessionWithLock(tenantId);
        }, 300000);

        setInterval(async () => {
            await this.updateChatStatus(tenantId);
        }, 300000);

        setInterval(async () => {
            await this.updateClientStatus(tenantId);
        }, 30000);

        setTimeout(async () => {
            await this.processMessageQueue(tenantId);
        }, this.CONFIG.INITIALIZATION_DELAY);
    }

    async handleReconnection(tenantId) {
        const attempts = this.reconnectAttempts.get(tenantId) || 0;
        if (attempts >= this.CONFIG.MAX_RECONNECT_ATTEMPTS) {
            logger.error(`[RECONNECT] Max reconnection attempts reached for ${tenantId}`);
            await this.notifyReconnectionFailure(tenantId);
            return;
        }

        logger.info(`[RECONNECT] Reconnecting attempt ${attempts + 1} for ${tenantId}`);
        this.reconnectAttempts.set(tenantId, attempts + 1);

        try {
            await this.safeReinitialize(tenantId);
        } catch (error) {
            logger.error(`[RECONNECT] Reconnection failed for ${tenantId}: ${error.message}`);
            setTimeout(() => this.handleReconnection(tenantId), this.CONFIG.RECONNECT_INTERVAL);
        }
    }

    async safeReinitialize(tenantId) {
        await this.destroyClient(tenantId);
        await new Promise(resolve => setTimeout(resolve, this.CONFIG.RECONNECT_INTERVAL));
        await this.initializeClient(tenantId);
    }

    async destroyClient(tenantId) {
        const client = this.clients.get(tenantId);
        if (!client) return;

        try {
            client.removeAllListeners();
            await client.destroy();
            logger.info(`[SHUTDOWN] Client destroyed for ${tenantId}`);
        } catch (error) {
            logger.error(`[SHUTDOWN] Destruction error for ${tenantId}: ${error.message}`);
        } finally {
            this.clients.delete(tenantId);
        }
    }

    async handleDisconnection(tenantId) {
        await this.notifyDisconnection(tenantId);
        await this.destroyClient(tenantId);
        this.handleReconnection(tenantId);
    }

    async sendMessage(tenantId, phoneNumber, message, retries = 3) {
        try {
            await this.validateClientState(tenantId);
            const formattedNumber = phoneNumber.includes('@c.us') ? phoneNumber : `${phoneNumber}@c.us`;
            
            const isRegistered = await Promise.race([
                this.clients.get(tenantId).isRegisteredUser(formattedNumber),
                new Promise((_, reject) => 
                    setTimeout(() => reject(new Error('Registration check timeout')), 5000)
                )
            ]);

            if (!isRegistered) throw new Error('Unregistered number');

            await this.clients.get(tenantId).sendMessage(formattedNumber, message);
            logger.info(`[MESSAGE] Message sent to ${phoneNumber} for ${tenantId}`);
        } catch (error) {
            logger.error(`[MESSAGE] Message failed for ${tenantId}: ${error.message}`);
            if (this.shouldRetryMessage(error)) {
                this.queueMessage(tenantId, { phoneNumber, message, retries });
                this.handleReconnection(tenantId);
            } else {
                throw error;
            }
        }
    }

    queueMessage(tenantId, data) {
        if (this.messageQueue.length >= this.CONFIG.MAX_QUEUE_SIZE) {
            throw new Error('Message queue overflow');
        }

        this.messageQueue.push({
            ...data,
            tenantId,
            timestamp: Date.now(),
            attempts: 0
        });
        logger.info(`[QUEUE] Message queued for ${tenantId} (total: ${this.messageQueue.length})`);
    }

    async processMessageQueue(tenantId) {
        const queue = this.messageQueue.filter(msg => 
            msg.tenantId === tenantId &&
            msg.attempts < this.CONFIG.MESSAGE_RETRY_LIMIT
        );

        for (const msg of queue) {
            try {
                await this.sendMessage(msg.tenantId, msg.phoneNumber, msg.message, msg.retries);
                this.messageQueue = this.messageQueue.filter(m => m !== msg);
            } catch (error) {
                msg.attempts++;
                logger.warn(`[QUEUE] Retry ${msg.attempts} failed for ${tenantId}`);
            }
        }
    }

    validateClientState(tenantId) {
        const client = this.clients.get(tenantId);
        if (!client || !client.pupPage || !client.info) {
            throw new Error('Client not initialized');
        }
        return true;
    }

    shouldRetryMessage(error) {
        return this.isSessionError(error) || 
               error.message.includes('CONFLICT') || 
               error.message.includes('Target closed');
    }

    // ... (ÇáßæÏ ÇáÓÇÈÞ íÈÞì ßãÇ åæ)

async updateChatStatus(tenantId) {
    const tenantIdStr = tenantId.toString();
    logger.info(`[CHAT] Updating chat status for ${tenantIdStr}`);
    
    try {
        const client = this.clients.get(tenantIdStr);
        if (!client || !client.info) {
            logger.warn(`[CHAT] Client not ready for ${tenantIdStr}`);
            return;
        }

        const chats = await client.getChats();
        for (const chat of chats) {
            try {
                const messages = await chat.fetchMessages({ limit: 1 });
                if (messages.length > 0) {
                    const lastMessage = messages[0];
                    logger.info(`[CHAT] Last message for ${chat.id._serialized} in ${tenantIdStr}: ${lastMessage.body.substr(0, 30)}...`);
                }
            } catch (error) {
                logger.error(`[CHAT] Error fetching messages for ${chat.id._serialized}: ${error.message}`);
            }
        }
    } catch (error) {
        logger.error(`[CHAT] Failed to update status for ${tenantIdStr}: ${error.message}`);
    }
}

async updateClientStatus(tenantId) {
    const tenantIdStr = tenantId.toString();
    logger.info(`[STATUS] Updating client status for ${tenantIdStr}`);
    
    try {
        const client = this.clients.get(tenantIdStr);
        if (!client || !client.info) {
            logger.warn(`[STATUS] Client not ready for ${tenantIdStr}`);
            return;
        }

        if (client.info.pushname !== client.info.wid.user) {
            logger.warn(`[STATUS] Session takeover detected for ${tenantIdStr}`);
            await this.handleSessionConflict(tenantIdStr);
        }
    } catch (error) {
        logger.error(`[STATUS] Error updating status for ${tenantIdStr}: ${error.message}`);
    }
}

async handleSessionConflict(tenantId) {
    const tenantIdStr = tenantId.toString();
    logger.warn(`[CONFLICT] Handling session conflict for ${tenantIdStr}`);
    
    try {
        await this.destroyClient(tenantIdStr);
        await new Promise(resolve => setTimeout(resolve, 5000));
        await this.initializeClient(tenantIdStr);
        logger.info(`[CONFLICT] Session restored for ${tenantIdStr}`);
    } catch (error) {
        logger.error(`[CONFLICT] Failed to resolve conflict for ${tenantIdStr}: ${error.message}`);
    }
}

async saveSessionWithLock(tenantId) {
    const tenantIdStr = tenantId.toString();
    if (this.savingSessions.has(tenantIdStr)) {
        logger.warn(`[SESSION] Session save already in progress for ${tenantIdStr}`);
        return;
    }

    this.savingSessions.add(tenantIdStr);
    try {
        await saveSessionToDatabase(tenantIdStr);
        logger.info(`[SESSION] Session saved for ${tenantIdStr}`);
    } catch (error) {
        logger.error(`[SESSION] Failed to save session for ${tenantIdStr}: ${error.message}`);
    } finally {
        this.savingSessions.delete(tenantIdStr);
    }
}

async notifyDisconnection(tenantId) {
    const tenantIdStr = tenantId.toString();
    logger.info(`[NOTIFY] Sending disconnection alert for ${tenantIdStr}`);
    
    try {
        const auth = await Auth.findOne({ where: { tenantId: tenantIdStr } });
        if (!auth) return;

        const message = `WhatsApp session disconnected. Attempting to reconnect...`;
        await Notification.create({ 
            tenantId: tenantIdStr, 
            message,
            type: 'DISCONNECTION' 
        });
        
        this.io.emit('notification', {
            tenantId: tenantIdStr,
            type: 'disconnection',
            message
        });
    } catch (error) {
        logger.error(`[NOTIFY] Failed to send disconnection alert: ${error.message}`);
    }
}

async notifyReconnectionFailure(tenantId) {
    const tenantIdStr = tenantId.toString();
    logger.error(`[NOTIFY] Sending reconnection failure alert for ${tenantIdStr}`);
    
    try {
        const auth = await Auth.findOne({ where: { tenantId: tenantIdStr } });
        if (!auth) return;

        const message = `All reconnection attempts failed. Please reauthenticate.`;
        await Notification.create({ 
            tenantId: tenantIdStr, 
            message,
            type: 'CRITICAL' 
        });

        this.io.emit('notification', {
            tenantId: tenantIdStr,
            type: 'critical',
            message
        });
    } catch (error) {
        logger.error(`[NOTIFY] Failed to send failure alert: ${error.message}`);
    }
}

isSessionError(error) {
    const sessionErrors = [
        'CONFLICT', 'UNLAUNCHED', 
        'Session closed', 'Target closed',
        'browser has disconnected'
    ];
    return sessionErrors.some(e => error.message.includes(e));
}

isImageFile(filePath) {
    const imageExtensions = ['.jpg', '.jpeg', '.png', '.gif', '.webp'];
    const ext = path.extname(filePath).toLowerCase();
    return imageExtensions.includes(ext);
}

handleFileError(error, filePath) {
    if (error.message.includes('ENOENT')) {
        error.message = `[FILE] Not found: ${filePath}`;
    } else if (error.message.includes('Unsupported')) {
        error.message = `[FILE] Unsupported type: ${path.extname(filePath)}`;
    }
    return error;
}

async checkForUpdates() {
    logger.info('[SYSTEM] Checking for package updates');
    exec('npm outdated whatsapp-web.js', (error, stdout) => {
        if (error) {
            logger.error(`[UPDATE] Check failed: ${error.message}`);
            return;
        }
        if (stdout) {
            logger.warn('[UPDATE] New version available');
            exec('npm update whatsapp-web.js', (updateError) => {
                if (updateError) {
                    logger.error(`[UPDATE] Failed to update: ${updateError.message}`);
                    return;
                }
                logger.info('[UPDATE] Successfully updated package');
                this.io.emit('update', { available: true });
            });
        }
    });
}

async checkConnectivity() {
    logger.info('[SYSTEM] Running connectivity check');
    for (const [tenantId, client] of this.clients.entries()) {
        if (!client.info) {
            logger.warn(`[NETWORK] Client ${tenantId} disconnected`);
            if (!this.initializingClients.has(tenantId)) {
                await this.initializeClient(tenantId);
            }
        }
    }
}

async checkClientStatus() {
    logger.info('[SYSTEM] Verifying client statuses');
    for (const [tenantId, client] of this.clients.entries()) {
        if (!client.info) {
            logger.warn(`[STATUS] Client ${tenantId} not ready`);
            this.io.emit('status', { 
                tenantId,
                status: 'unhealthy' 
            });
        }
    }
}

async checkSessionStatus() {
    logger.info('[SYSTEM] Validating session statuses');
    for (const [tenantId, client] of this.clients.entries()) {
        if (client.info) {
            await this.saveSessionWithLock(tenantId);
        } else {
            logger.warn(`[SESSION] Client ${tenantId} not ready for save`);
        }
    }
}

async reinitializeClients() {
    logger.info('[SYSTEM] Reinitializing all clients');
    const allAuths = await Auth.findAll();
    for (const auth of allAuths) {
        try {
            await this.initializeClient(auth.tenantId.toString());
        } catch (error) {
            logger.error(`[INIT] Failed to restart ${auth.tenantId}: ${error.message}`);
        }
    }
}

isClientReady(tenantId) {
    const tenantIdStr = tenantId.toString();
    const client = this.clients.get(tenantIdStr);
    const status = !!client?.info;
    
    logger.info(`[STATUS] Client readiness check for ${tenantIdStr}: ${status}`);
    this.io.emit('status', {
        tenantId: tenantIdStr,
        status: status ? 'ready' : 'not-ready'
    });
    
    return status;
}

async getClient(tenantId) {
    const tenantIdStr = tenantId.toString();
    logger.info(`[CLIENT] Retrieving client for ${tenantIdStr}`);
    
    if (!this.isClientReady(tenantIdStr)) {
        logger.warn(`[CLIENT] Client not ready, initializing ${tenantIdStr}`);
        await this.initializeClient(tenantIdStr);
        await new Promise(resolve => setTimeout(resolve, 5000));
    }
    
    const client = this.clients.get(tenantIdStr);
    if (!client) throw new Error(`[CLIENT] Not found for ${tenantIdStr}`);
    return client;
}

async generateQRCode(tenantId) {
    const tenantIdStr = tenantId.toString();
    logger.info(`[AUTH] Generating QR for ${tenantIdStr}`);
    
    return new Promise(async (resolve, reject) => {
        try {
            const client = await this.getClient(tenantIdStr);
            client.once('qr', (qr) => {
                qrcode.toDataURL(qr, (err, url) => {
                    if (err) reject(err);
                    resolve(url);
                });
            });
        } catch (error) {
            logger.error(`[AUTH] QR generation failed: ${error.message}`);
            reject(error);
        }
    });
}
}

module.exports = new WhatsAppClientManager();