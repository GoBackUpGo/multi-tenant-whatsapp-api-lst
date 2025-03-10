const pkg  = require('whatsapp-web.js');
const Auth = require('./models/Auth');
const Notification = require('./models/Notification');
const logger = require('./logger');
const sendEmail = require('./utils/email');
const { exec } = require('child_process');
const qrcode = require('qrcode');
const path = require('path');
const { saveSessionToDatabase, restoreSessionFromDatabase } = require('./SQLServerAuth');
const { Client, LocalAuth, MessageMedia } = pkg;
const { v4: uuidv4 } = require('uuid');
const multer = require('multer');
const { id } = require('tedious/lib/data-types/null');
const upload = multer({
    storage: multer.memoryStorage(),
    limits: {
        fileSize: 50 * 1024 * 1024 // 50MB
    }
});

class WhatsAppClientManager {
    constructor() {
        this.clients = new Map(); // Store clients by tenantId (string)
        this.initializingClients = new Set(); // Track clients being initialized
        this.savingSessions = new Set(); // Track clients whose sessions are being saved
        this.sessions = new Map(); // tenantId -> Session Data
        this.mediaCache = new Map(); // mediaId -> Media Info
        this.pendingRetries = new Map(); // messageId -> RetryInfo
        
        // Add error handlers to prevent app crashes
        process.on('unhandledRejection', (reason, promise) => {
            logger.error(`Unhandled Rejection at: ${promise}, reason: ${reason}`);
        });

        process.on('uncaughtException', (error) => {
            logger.error(`Uncaught Exception: ${error.message}`);
            logger.info(`Resstart services..`);
            process.exit(1); // Exit with failure
        });
        
        // ... (��������� �������)
        this.sessionCheckInterval = 1200000; // 5 ����� ���� �������
        this.setupHealthChecks();
        setInterval(() => this.checkStuckInitializations(), 60000); // Check every minute
    }

    // ����� ������ ���� �������
    async shutdownAllClients() {
        logger.info(`Shutdown All Clients..`);
        for (const [tenantId, client] of this.clients.entries()) {
            await client.destroy().catch(() => {});
        }
        this.clients.clear();
    }

    setupHealthChecks() {
        setInterval(() => {
            this.clients.forEach((client, tenantId) => {
                if (!client || client.state !== 'CONNECTED') {
                    this.reviveClient(tenantId);
                }
            });
        }, this.sessionCheckInterval);
    }

    async reviveClient(tenantId) {
        const tenantIdStr = tenantId.toString();
        if (this.initializingClients.has(tenantIdStr)) return;

        logger.info(`Reviving client for tenant: ${tenantIdStr}`);
        try {
            await this.handleSessionConflict(tenantIdStr);
            //await restoreSessionFromDatabase(tenantIdStr);
            //await this.initializeClient(tenantIdStr, true);
            logger.info(`Client revived successfully for tenant: ${tenantIdStr}`);
        } catch (error) {
            logger.error(`Revive failed: ${error.message}`);
            await this.delay(60000); // ����� �������� ��� 60 �����
            this.reviveClient(tenantId);
        }
    }

    async initializeClient(tenantId, useRemoteAuth = true) {
        const tenantIdStr = tenantId.toString();
        
        // Check if client is already being initialized
        if (this.initializingClients.has(tenantIdStr)) {
            logger.warn(`Client initialization already in progress for tenantId: ${tenantIdStr}`);
            return;
        }
    
        // Set initialization timeout to prevent hanging indefinitely
        const initTimeout = setTimeout(() => {
            if (this.initializingClients.has(tenantIdStr)) {
                logger.error(`Client initialization timed out for tenantId: ${tenantIdStr}`);
                this.initializingClients.delete(tenantIdStr);
                // Attempt recovery by killing any zombie processes
                this.killZombieBrowsers();
            }
        }, 120000); // 2 minutes timeout
    
        logger.info(`Initializing client for tenantId: ${tenantIdStr}`);
        this.initializingClients.add(tenantIdStr);
    
        try {
            const auth = await Auth.findOne({ where: { tenantId: tenantIdStr } });
            if (!auth) {
                logger.error(`No authentication found for tenantId: ${tenantIdStr}`);
                this.initializingClients.delete(tenantIdStr);
                clearTimeout(initTimeout);
                return;
            }
    
            const client = new Client({
                authStrategy: new LocalAuth({
                    clientId: tenantIdStr,
                    dataPath: path.join(__dirname, '.wwebjs_auth')
                }),
                puppeteer: {
                    headless: true,
                    args: [
                        '--no-sandbox', 
                        '--disable-setuid-sandbox',
                        '--disable-dev-shm-usage',
                        '--disable-accelerated-2d-canvas',
                        '--no-first-run',
                        '--no-zygote',
                        '--disable-gpu'
                    ],
                    timeout: 60000, // 60 seconds timeout for browser operations
                },
                // Fix for the webVersionCache error - use local cache instead of remote
                webVersionCache: {
                    type: 'local'
                    // If you want to use remote cache, you must specify a remotePath like:
                    // type: 'remote',
                    // remotePath: path.join(__dirname, '.wwebjs_cache', `tenant-${tenantIdStr}`)
                }
            });
    
            // Set up progress tracking
            let initStage = 'starting';
            
            // Event: QR Code Generated
            client.on('qr', async (qr) => {
                initStage = 'qr_generated';
                logger.info(`QR code generated for tenantId: ${tenantIdStr}`);
                const qrCodeBase64 = await qrcode.toDataURL(qr);
                await auth.update({ qrCode: qrCodeBase64 });
            });
    
            // Event: Loading Screen
            client.on('loading_screen', (percent, message) => {
                initStage = `loading_${percent}`;
                logger.info(`WhatsApp loading screen: ${percent}% - ${message} for tenantId: ${tenantIdStr}`);
            });
    
            // Event: Client Ready
            client.on('ready', async () => {
                initStage = 'ready';
                logger.info(`WhatsApp client ready for tenantId: ${tenantIdStr}`);
                await this.saveSessionWithLock(tenantIdStr);
                this.initializingClients.delete(tenantIdStr);
                clearTimeout(initTimeout);
    
                // ...existing ready event code...
                client.on('message', async (msg) => {
                    if (msg.fromMe) return; // Skip outgoing messages
                    
                    try {
                        const Message = require('./models/Message');
                        
                        // Check for existing message
                        const existingMessage = await Message.findOne({
                            where: { 
                                whatsappMessageId: msg.id._serialized,
                                tenantId: tenantIdStr
                            }
                        });
                        
                        // Skip if already exists
                        if (existingMessage) return;
                        
                        logger.info(`Received new message from ${msg.from} for tenantId: ${tenantIdStr}`);
                        
                        // Handle different message types
                        let attachType = null;
                        let attachName = null;
                        let attachData = null;
                        let messageText = msg.body;
                        
                        // Handle media messages with improved safety checks
                        if (msg.hasMedia) {
                            try {
                                logger.info(`Message has media. Attempting to download for message ID: ${msg.id._serialized}`);
                                const media = await msg.downloadMedia().catch(err => {
                                    logger.error(`Error in media download promise: ${err.message}`);
                                    return null;
                                });
                                
                                // Verify we have a valid media object with required properties
                                if (media && media.mimetype) {
                                    attachType = media.mimetype;
                                    attachName = media.filename || `file-${Date.now()}`;
                                    attachData = media.data; // Base64 data
                                    logger.info(`Media downloaded successfully. Type: ${attachType}, Name: ${attachName}`);
                                } else {
                                    logger.warn(`Downloaded media for message ${msg.id._serialized} is invalid or incomplete`);
                                }
                            } catch (mediaError) {
                                logger.error(`Failed to download media: ${mediaError.message}`);
                                // Continue without the attachment
                            }
                        }
                        
                        try {
                            // Create message with safe binary handling
                            const messageData = {
                                tenantId: tenantIdStr,
                                phoneNumber: msg.from.replace('@c.us', ''),
                                message: messageText,
                                direction: 'INCOMING',
                                whatsappMessageId: msg.id._serialized,
                                timestamp: msg.timestamp * 1000,
                                attachType,
                                attachName,
                                createdAt: new Date(),
                                updatedAt: new Date()
                            };
                            
                            // Only add attachfile if we have valid data
                            if (attachData) {
                                try {
                                    // Convert base64 string to Buffer explicitly for binary storage
                                    const buffer = Buffer.from(attachData, 'base64');
                                    if (Buffer.isBuffer(buffer)) {
                                        messageData.attachfile = buffer;
                                    }
                                } catch (conversionError) {
                                    logger.error(`Failed to convert attachment data to buffer: ${conversionError.message}`);
                                }
                            }
                            
                            await Message.create(messageData);
                        } catch (dbError) {
                            logger.error(`Database error storing message: ${dbError.message}`);
                        }
                    } catch (error) {
                        logger.error(`Failed to store incoming message: ${error.message}`);
                    }
                });

                // // Start periodic session saving
                // setInterval(async () => {
                //     await this.saveSessionWithLock(tenantIdStr);
                // }, 1000000); // Save session every 5 minutes

                // Start periodic chat status update
                setInterval(async () => {
                   await this.updateChatStatus(tenantIdStr);
                }, 60000); // Update chat status every 1 minutes

                //// Start periodic client status update
                //setInterval(async () => {
                //    await this.updateClientStatus(tenantIdStr);
                //}, 300000); // Update client status every 30 seconds
            });
    
            // Other events...
            // ...existing code...
    
            // Add enhanced error handling during initialization
            client.on('auth_failure', async (message) => {
                logger.error(`Authentication failed for tenantId: ${tenantIdStr}. Message: ${message}`);
                const auth = await Auth.findOne({ where: { tenantId: tenantIdStr } });
                if (auth && !auth.qrCode) {
                    logger.info(`Generating QR code for tenantId: ${tenantIdStr}`);
                    await this.generateQRCode(tenantIdStr);
                }
                this.initializingClients.delete(tenantIdStr);
                clearTimeout(initTimeout);
            });
    
            // Begin initialization with timeout handling
            logger.info(`Starting WhatsApp client initialization for tenantId: ${tenantIdStr}`);
            
            // Use a promise with timeout to handle initialize method
            const initializePromise = client.initialize();
            const timeoutPromise = new Promise((_, reject) => 
                setTimeout(() => reject(new Error('Client initialization timeout')), 90000)); // 90 seconds
    
            await Promise.race([initializePromise, timeoutPromise]);
    
            // If initialization is successful
            this.clients.set(tenantIdStr, client);
            logger.info(`Successfully initialized client for tenantId: ${tenantIdStr}`);
            
        } catch (error) {
            // Handle initialization errors
            this.initializingClients.delete(tenantIdStr);
            clearTimeout(initTimeout);
            logger.error(`Failed to initialize client for tenantId: ${tenantIdStr}. Error: ${error.message}`);
            
            if (error.message.includes('net::ERR_INTERNET_DISCONNECTED') || 
                error.message.includes('net::ERR_CONNECTION_RESET') ||
                error.message.includes('net::ERR_CONNECTION_REFUSED')) {
                logger.error(`Network error initializing client for tenantId: ${tenantIdStr}. Retrying in 30 seconds...`);
                setTimeout(() => this.initializeClient(tenantIdStr, useRemoteAuth), 30000);
            } else if (error.message.includes('timeout')) {
                logger.error(`Timeout initializing client for tenantId: ${tenantIdStr}. Killing zombie processes and retrying...`);
                await this.killZombieBrowsers();
                setTimeout(() => this.initializeClient(tenantIdStr, useRemoteAuth), 10000);
            }
        }
    }

    async handleSessionConflict(tenantId) {
        const tenantIdStr = tenantId.toString();
        logger.info(`Handling session conflict for tenantId: ${tenantIdStr}`);

        try {
            const client = this.clients.get(tenantIdStr);
            if (client) {
                try {
                    await client.destroy(); // Destroy the existing client
                } catch (destroyError) {
                    logger.error(`Failed to destroy client for tenantId: ${tenantIdStr}. Error: ${destroyError.message}`);
                }
                this.clients.delete(tenantIdStr);
            }

            // Wait for a short period before reinitializing to avoid rapid reconnection attempts
            await new Promise(resolve => setTimeout(resolve, 5000));

            await this.initializeClient(tenantIdStr, true);
        } catch (error) {
            logger.error(`Failed to handle session conflict for tenantId: ${tenantIdStr}. Error: ${error.message}`);
        }
    }

    async reconnectClient(tenantId, retries) {
        const tenantIdStr = tenantId.toString();

        for (let i = 0; i < retries; i++) {
            logger.info(`Reconnection attempt ${i + 1} for tenantId: ${tenantIdStr}`);
            try {
                await this.initializeClient(tenantIdStr, true);
                logger.info(`Reconnection successful for tenantId: ${tenantIdStr}`);
                return;
            } catch (error) {
                logger.error(`Reconnection attempt ${i + 1} failed for tenantId: ${tenantIdStr}. Error: ${error.message}`);
                await new Promise(resolve => setTimeout(resolve, 5000)); // Wait before retrying
            }
        }

        logger.error(`All reconnection attempts failed for tenantId: ${tenantIdStr}`);
        await this.notifyTenantReconnectionFailure(tenantIdStr);
    }

    async saveSessionWithLock(tenantId) {
        const tenantIdStr = tenantId.toString();

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

    async notifyTenantDisconnection(tenantId) {
        const tenantIdStr = tenantId.toString();
        logger.info(`Notifying tenant disconnection for tenantId: ${tenantIdStr}`);
        const auth = await Auth.findOne({ where: { tenantId: tenantIdStr } });
        if (!auth) return;

        const message = `Your WhatsApp session has been disconnected. Attempting to reconnect...`;
        await Notification.create({ tenantId: tenantIdStr, message });
        sendEmail(auth.phoneNumber, 'WhatsApp Session Disconnected', message);
    }

    async notifyTenantReconnectionFailure(tenantId) {
        const tenantIdStr = tenantId.toString();
        logger.info(`Notifying tenant reconnection failure for tenantId: ${tenantIdStr}`);
        const auth = await Auth.findOne({ where: { tenantId: tenantIdStr } });
        if (!auth) return;

        const message = `All attempts to reconnect your WhatsApp session have failed. Please reauthenticate.`;
        await Notification.create({ tenantId: tenantIdStr, message });
    }

    async sendMessage1(tenantId, phoneNumber, message, retries = 3) {
        const tenantIdStr = tenantId.toString();
        logger.info(`Sending message to ${phoneNumber} for tenantId: ${tenantIdStr}`);

        try {
            let client = this.clients.get(tenantIdStr);

            // Ensure the client is ready
            if (!this.isClientReady(tenantIdStr)) {
                logger.warn(`Client for tenantId: ${tenantIdStr} is not ready. Attempting to reinitialize...`);
                if (!this.initializingClients.has(tenantIdStr)) {
                    await this.initializeClient(tenantIdStr, true);
                } else {
                    logger.warn(`Client initialization already in progress for tenantId: ${tenantIdStr}`);
                }
                client = this.clients.get(tenantIdStr);

                // Wait for a short period to ensure the client is fully ready
                await new Promise(resolve => setTimeout(resolve, 0));
            }

            // Check if the client is now ready
            if (!client || !client.info) {
                logger.error(`Client for tenantId: ${tenantIdStr} is not properly initialized`);
                throw new Error(`Client for tenantId: ${tenantIdStr} is not properly initialized`);
            }

            // Format the phone number
            const formattedPhoneNumber = phoneNumber.includes('@c.us') ? phoneNumber : `${phoneNumber}@c.us`;

            // Send the message
            await client.sendMessage(formattedPhoneNumber, message);
            logger.info(`Message sent to ${phoneNumber} for tenantId: ${tenantIdStr}`);
        } catch (error) {
            logger.error(`Failed to send message to ${phoneNumber} for tenantId: ${tenantIdStr}. Error: ${error.message}`);

            // Handle session conflicts or disconnections
            if (error.message.includes('CONFLICT') || error.message.includes('UNLAUNCHED') || error.message.includes('Session closed') || error.message.includes('Target closed')) {
                logger.warn(`Session conflict or disconnection detected for tenantId: ${tenantIdStr}. Attempting to reinitialize...`);
                await this.handleSessionConflict(tenantIdStr);
                if (retries > 0) {
                    logger.info(`Retrying to send message to ${phoneNumber} for tenantId: ${tenantIdStr}. Retries left: ${retries - 1}`);
                    await this.sendMessage(tenantId, phoneNumber, message, retries - 1); // Retry sending the message
                } else {
                    logger.error(`Failed to send message to ${phoneNumber} for tenantId: ${tenantIdStr} after multiple attempts.`);
                }
            } else {
                throw error; // Re-throw the error if it's not a session conflict
            }
        }
    }
    
    async sendMessage(tenantId, phoneNumber, message, retries = 3, file = null) {
        const tenantIdStr = tenantId.toString();
        logger.info(`Sending message to ${phoneNumber} for tenantId: ${tenantIdStr}`);
    
        try {
            let client = this.clients.get(tenantIdStr);
    
            // Ensure the client is ready
            if (!this.isClientReady(tenantIdStr)) {
                logger.warn(`Client for tenantId: ${tenantIdStr} is not ready. Attempting to reinitialize...`);
                if (!this.initializingClients.has(tenantIdStr)) {
                    await this.initializeClient(tenantIdStr, true);
                } else {
                    logger.warn(`Client initialization already in progress for tenantId: ${tenantIdStr}`);
                }
                client = this.clients.get(tenantIdStr);
    
                // Wait for a short period to ensure the client is fully ready
                await new Promise(resolve => setTimeout(resolve, 5000));
            }
    
            // Check if the client is now ready
            if (!client || !client.info) {
                logger.error(`Client for tenantId: ${tenantIdStr} is not properly initialized`);
                throw new Error(`Client for tenantId: ${tenantIdStr} is not properly initialized`);
            }
    
            // Format the phone number
            const formattedPhoneNumber = phoneNumber.includes('@c.us') ? phoneNumber : `${phoneNumber}@c.us`;
    
            // Send the message
            if (file) {
                const media = new MessageMedia(file.mimetype, file.data, file.filename);
                await client.sendMessage(formattedPhoneNumber, media, { caption: message });
            } else {
                await client.sendMessage(formattedPhoneNumber, message);
            }
    
            logger.info(`Message sent to ${formattedPhoneNumber} for tenantId: ${tenantIdStr}`);
        } catch (error) {
            logger.error(`Failed to send message to ${phoneNumber} for tenantId: ${tenantIdStr}. Error: ${error.message}`);
    
            // Handle session conflicts or disconnections
            if (error.message.includes('CONFLICT') || error.message.includes('UNLAUNCHED') || error.message.includes('Session closed') || error.message.includes('Target closed')) {
                logger.warn(`Session conflict or disconnection detected for tenantId: ${tenantIdStr}. Attempting to reinitialize...`);
                await this.handleSessionConflict(tenantIdStr);
                if (retries > 0) {
                    logger.info(`Retrying to send message to ${phoneNumber} for tenantId: ${tenantIdStr}. Retries left: ${retries - 1}`);
                    await this.sendMessage(tenantId, phoneNumber, message, retries - 1, file); // Retry sending the message
                } else {
                    logger.error(`Failed to send message to ${phoneNumber} for tenantId: ${tenantIdStr} after multiple attempts.`);
                }
            } else {
                throw error; // Re-throw the error if it's not a session conflict
            }
        }
    }

    async sendFile(tenantId, phoneNumber, filePath, caption = '', retries = 3) {
        const tenantIdStr = tenantId.toString();
        logger.info(`Sending file to ${phoneNumber} for tenantId: ${tenantIdStr}`);

        try {
            const client = await this.getClient(tenantIdStr);
            const formattedPhoneNumber = phoneNumber.includes('@c.us') ? phoneNumber : `${phoneNumber}@c.us`;

            // ����� ���� ����� �� ������
            const media = MessageMedia.fromFilePath(filePath);
            
            // ����� ����� �� ��������
            const options = {
                caption: caption,
                sendMediaAsDocument: !this.isImageFile(filePath)
            };

            await client.sendMessage(formattedPhoneNumber, media, options);
            logger.info(`File sent to ${phoneNumber} for tenantId: ${tenantIdStr}`);
        } catch (error) {
            logger.error(`Failed to send file to ${phoneNumber} for tenantId: ${tenantIdStr}. Error: ${error.message}`);

            if (this.isSessionError(error)) {
                logger.warn(`Session error detected. Attempting to reinitialize...`);
                await this.handleSessionConflict(tenantIdStr);
                if (retries > 0) {
                    logger.info(`Retrying file send (${retries} retries left)`);
                    return this.sendFile(tenantId, phoneNumber, filePath, caption, retries - 1);
                }
            }
            
            throw this.handleFileError(error, filePath);
        }
    }

   /**
     * إرسال رسالة بأنواعها المختلفة
     * @param {object} params - معاملات الرسالة
     * @param {number} retries - عدد المحاولات المتبقية
     */
   async sendMessageNew(params, retries = 3) {
    const { tenantId, type, to, content, options = {} } = params;
        try {
            logger.info(`Sending message to ${to} for tenantId: ${tenantId}`);
    
            const client = await this.getValidatedClient(tenantId);
            const formattedTo = this.formatNumber(to);
            const body = content.body || content;
            let messagePayload;
            switch (type) {
                case 'text':
                    messagePayload = body ? body: this.prepareTextMessage(content, options);
                    break;
                case 'media':
                    let messagePayloadMedia = await this.prepareMediaMessage(content, options);
                    //logger.info(`messagePayloadMedia: ${JSON.stringify(messagePayloadMedia)}`);
                    messagePayload = new MessageMedia(messagePayloadMedia.mimetype, messagePayloadMedia.file.toString('base64'), messagePayloadMedia.filename);
                    break;
                case 'template':
                    messagePayload = this.prepareTemplateMessage(content);
                    break;
                case 'interactive':
                    messagePayload = this.prepareInteractiveMessage(content);
                    break;
                default:
                    throw new Error('نوع الرسالة غير مدعوم');
            }

            logger.info(`messagePayload: ${JSON.stringify(messagePayload)}`);
            logger.info(`formattedTo: ${JSON.stringify(formattedTo)}`);
            const message = await client.sendMessage(formattedTo, messagePayload, {
                quotedMessageId: options.replyTo
            });
            // const message = await client.sendMessage(formattedTo, messagePayload.media, {
            //     caption: messagePayload.caption,
            //     filename: messagePayload.filename,
            //     quotedMessageId: options.replyTo
            // });

            this.trackMessageStatus(message.id.id, 'sent');
            //logger.info(`message: ${JSON.stringify(message)}`);
            logger.info(`Result: ${JSON.stringify(this.formatMessageResult(message))}`);
            if (type === 'media') {
                const messagePayloadMedia = await this.prepareMediaMessage(content, options);
                const Message = require('./models/Message');
                await Message.create({
                    tenantId: tenantId.toString(),
                    phoneNumber: formattedTo.replace('@c.us', ''),
                    message: messagePayloadMedia.caption ? String(messagePayloadMedia.caption) : '',
                    direction: 'OUTGOINING',
                    whatsappMessageId: message.id.id,
                    timestamp: new Date(), // Use current date instead of message timestamp
                    attachType: messagePayloadMedia.mimetype,
                    attachName: messagePayloadMedia.filename,
                    attachfile: messagePayload.data ? Buffer.from(messagePayload.data, 'base64') : null,
                    createdAt: new Date(),
                    updatedAt: new Date(),
                    status: 'sent'
                });
            }
            
            return this.formatMessageResult(message);
        } catch (error) {
            return this.handleMessageError(error, params, retries);
        }
    }

    /**
     * رفع ملف وسائط إلى الخادم
     * @param {Buffer} buffer - بيانات الملف
     * @param {string} mimeType - نوع الملف
     * @param {string} filename - اسم الملف
     */
    async uploadMedia(file, mimeType, filename) {
        const mediaId = uuidv4();
        
        // Ensure we have proper parameters
        const fileBuffer = file.buffer || file;
        const fileMimeType = mimeType || file.mimetype;
        const fileFilename = filename || file.originalname;
        
        // Convert buffer to proper base64 format
        const base64Data = fileBuffer.toString('base64');
        
        // Create MessageMedia with proper base64 data
        const media = new MessageMedia(
            fileMimeType,
            base64Data,
            fileFilename
        );
        
        logger.info(`Uploading media: ${fileFilename} (${fileMimeType})`);
        
        this.mediaCache.set(mediaId, {
            id: mediaId,
            media: media,
            mimetype: fileMimeType,
            filename: fileFilename,
            buffer: fileBuffer,
            expires: Date.now() + 30 * 24 * 60 * 60 * 1000 // 30 days
        });
        
        return { id: mediaId, url: `/media/${mediaId}` };
    }

    // تحميل الملف من URL
    async  downloadMedia(url) {
        const response = await axios.get(url, { responseType: 'arraybuffer' });
        return Buffer.from(response.data, 'binary').toString('base64');
    }
    /**
     * تحديث معلومات حساب الأعمال
     * @param {object} profileData - بيانات الملف التعريفي
     */
    async updateBusinessProfile(profileData) {
        // تطبيق منطق التحديث حسب واجهة ميتا
        return { 
            success: true,
            profile: { ...profileData, verified: true }
        };
    }
    // التحليلات
    async getMessageMetrics(tenantId, startDate, endDate) {
        // تطبيق منطق التحليلات هنا
        return {
            period: { start: startDate, end: endDate },
            sent: 150,
            delivered: 145,
            read: 140
        };
    }
    // ======== الدوال المساعدة والخاصة ======== //

    /** تهيئة الأحداث للعميل */
    setupClientEvents(client, tenantId) {
        client.on('qr', qr => this.emit('qr', tenantId, qr));
        client.on('ready', () => this.handleClientReady(tenantId));
        client.on('disconnected', reason => this.handleDisconnect(tenantId, reason));
        client.on('message', msg => this.handleIncomingMessage(tenantId, msg));
        client.on('media_uploaded', media => this.cacheMedia(media));
    }

    /** معالجة الأخطاء الحرجة */
    handleCriticalError(tenantId, error) {
        logger.error(`Critical error for ${tenantId}: ${error.message}`);
        this.clients.delete(tenantId);
        this.emit('client-error', tenantId, error);
    }

    /** تنسيق نتيجة الرسالة */
    formatMessageResult2(message) {
        return {
            id: message.id.id,
            timestamp: message.timestamp,
            status: 'sent',
            recipient: message.to
        };
    }
    /** تنسيق نتيجة الرسالة بحيث تطابق استجابة ميتا */
    formatMessageResult(message) {
        // return {
        //     messaging_product: "whatsapp",
        //     contacts: message.contacts || [], // تأكيد وجود جهات الاتصال
        //     messages: message.messages || [], // تأكيد وجود الرسائل
        //     status: "sent", // تحديد حالة الرسالة
        //     timestamp: Date.now() // إضافة الطابع الزمني يدويًا لأن ميتا لا ترسله في الاستجابة
        // };
        return {
            id: message.id.id,
            messaging_product: "whatsapp",
            contacts: [
                {
                    input: message.to, // رقم الهاتف الذي تم الإرسال إليه
                    wa_id: message.to.replace("@c.us", "") // إزالة النطاق للحفاظ على التنسيق الصحيح
                }
            ],
            messages: [
                {
                    id: message.id._serialized // معرف الرسالة المرسل
                }
            ],
            status: "sent", // تحديد حالة الرسالة
            timestamp: message.timestamp,//safeTimestamp(message.timestamp || Date.now()) // استخدام وقت آمن
        };
    }

    /** التحقق من جاهزية العميل */
    async getValidatedClient(tenantId) {
        if (!this.clients.has(tenantId) || !this.clients.get(tenantId).info) {
            await this.initializeClient(tenantId);
            await new Promise(resolve => setTimeout(resolve, 5000));
        }
        return this.clients.get(tenantId);
    }

    /** تنسيق رقم الهاتف */
    formatNumber(number) {
        const cleaned = number.replace(/[^\d]/g, '');
        return cleaned.endsWith('@c.us') ? cleaned : `${cleaned}@c.us`;
    }

    /** تجهيز رسالة نصية */
    prepareTextMessage(content, options) {
        // return {
        //     body: content,
        //     previewUrl: options.previewUrl || false
        // };
        return content;
    }

    /** تجهيز رسالة وسائط */
    async prepareMediaMessage(content, options) {
        logger.info(`Preparing media message with content: ${JSON.stringify(content)}`);
        
        if (!content || !content.mediaId) {
            throw new Error('معرف الوسائط مفقود');
        }
        
        const mediaId = content.mediaId;
        const cachedMedia = this.mediaCache.get(mediaId);
        
        if (!cachedMedia) {
            throw new Error('الملف غير موجود في الذاكرة المؤقتة');
        }
        
        logger.info(`Found cached media: ${cachedMedia.filename} (${cachedMedia.mimetype})`);
        
        // Use the properly saved MessageMedia object directly
        return {
            media: cachedMedia.media,
            mimetype: cachedMedia.mimetype,
            filename: cachedMedia.filename,
            file: cachedMedia.buffer,
            caption: content.caption
        };
    }

    /** تجهيز رسالة تفاعلية */
    prepareInteractiveMessage(content) {
        return {
            title: content.header,
            text: content.body,
            footer: content.footer,
            buttons: content.buttons.map(btn => ({
                id: btn.id,
                title: btn.title
            }))
        };
    }

    /** معالجة أخطاء الرسائل */
    async handleMessageError(error, params, retries) {
        logger.error(`فشل الإرسال: ${error.message}`);
        
        if (this.isRetryableError(error) && retries > 0) {
            await this.handleSessionConflict(params.tenantId);
            return this.sendMessage(params, retries - 1);
        }

        throw this.normalizeError(error);
    }

    /** تحديد ما إذا كان الخطأ قابلًا لإعادة المحاولة */
    isRetryableError(error) {
        const retryableCodes = ['ECONNRESET', 'ETIMEDOUT', 'EPIPE'];
        return retryableCodes.includes(error.code) || 
            error.message.includes('CONFLICT');
    }

    /** توحيد شكل الأخطاء */
    normalizeError(error) {
        // return {
        //     code: error.code || 'UNKNOWN_ERROR',
        //     message: error.message,
        //     stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
        // };
        console.error("WhatsApp Message Send Error:", error);

        return {
            id: null,
            timestamp: Date.now(),
            status: 'failed',
            error: {
                message: error.message || 'Unknown error',
                code: error.code || 'UNKNOWN_CODE',
                details: error.error_subcode || null,
                trace_id: error.fbtrace_id || null
            }
        };
    }

    /** تتبع حالة الرسالة */
    trackMessageStatus(messageId, status) {
        // تطبيق منطق التتبع في قاعدة البيانات
        logger.info(`Message ${messageId} status: ${status}`);
    }

    /** معالجة الرسائل الواردة */
    async handleIncomingMessage1(tenantId, message) {
        this.emit('message', {
            tenantId,
            messageId: message.id.id,
            from: message.from,
            body: message.body,
            timestamp: message.timestamp
        });
    }
    async handleIncomingMessage(tenantId, msg) {
        if (msg.fromMe) return;

        const existingMessage = await Message.findOne({
            where: {
                whatsappMessageId: msg.id._serialized,
                tenantId: tenantId.toString(),
            },
        });

        if (existingMessage) return;

        let attachType = null;
        let attachName = null;
        let attachData = null;
        let messageText = msg.body;

        if (msg.hasMedia) {
            try {
                const media = await msg.downloadMedia();
                attachType = media.mimetype;
                attachName = media.filename || `file-${Date.now()}`;
                attachData = media.data;
            } catch (mediaError) {
                logger.error(`Failed to download media for message ${msg.id._serialized}: ${mediaError.message}`);
            }
        }

        await Message.create({
            tenantId: tenantId.toString(),
            phoneNumber: msg.from.replace('@c.us', ''),
            message: messageText,
            direction: 'INCOMING',
            whatsappMessageId: msg.id._serialized,
            timestamp: msg.timestamp * 1000,
            attachType,
            attachName,
            attachfile: attachData ? Buffer.from(attachData, 'base64') : null,
            createdAt: new Date(),
            updatedAt: new Date(),
        });
    }
    /**
     * إرسال قالب واتساب
     * @param {string} tenantId - معرّف المستأجر
     * @param {string} to - رقم المستقبل
     * @param {string} templateName - اسم القالب المعتمد
     * @param {string} language - لغة القالب (مثال: 'ar' أو 'en_US')
     * @param {Array} components - مكونات القالب
     * @param {Object} options - خيارات إضافية
     */
    async sendTemplate(
        tenantId,
        to,
        templateName,
        language,
        components = [],
        options = {}
    ) {
        try {
            const client = await this.getValidatedClient(tenantId);
            
            // بناء كائن القالب
            const templateMessage = {
                name: templateName,
                language: {
                    code: language,
                    policy: 'deterministic' // أو أي سياسة أخرى حسب الحاجة
                },
                components: components
            };

            // إرسال القالب
            const message = await client.sendMessage(
                this.formatNumber(to),
                templateMessage,
                {
                    quotedMessageId: options.replyTo,
                    parseVCards: true
                }
            );

            // تسجيل النتيجة
            this.trackMessageStatus(message.id.id, 'sent');
            
            return {
                success: true,
                messageId: message.id.id,
                timestamp: message.timestamp
            };
        } catch (error) {
            return this.handleTemplateError(error, {
                tenantId,
                to,
                templateName,
                language,
                components,
                options
            });
        }
    }

    /**
     * معالجة أخطاء القوالب
     */
    handleTemplateError(error, params) {
        logger.error(`فشل إرسال القالب: ${error.message}`, {
            errorDetails: {
                code: error.code,
                stack: error.stack
            },
            params
        });

        return {
            success: false,
            error: {
                code: 'TEMPLATE_SEND_FAILED',
                message: 'فشل إرسال القالب',
                details: error.message
            }
        };
    }

    // ���� ������ ������ �� ��� �����
    isImageFile(filePath) {
        const imageExtensions = ['.jpg', '.jpeg', '.png', '.gif', '.webp'];
        const ext = path.extname(filePath).toLowerCase();
        return imageExtensions.includes(ext);
    }

    // ������ ����� ������
    isSessionError(error) {
        const sessionErrors = ['CONFLICT', 'UNLAUNCHED', 'Session closed', 'Target closed'];
        return sessionErrors.some(e => error.message.includes(e));
    }

    // ������ ����� �������
    handleFileError(error, filePath) {
        if (error.message.includes('ENOENT')) {
            error.message = `File not found: ${filePath}`;
        } else if (error.message.includes('Unsupported')) {
            error.message = `Unsupported file type: ${path.extname(filePath)}`;
        }
        return error;
    }
    async updateChatStatus(tenantId) {
        const tenantIdStr = tenantId.toString();
        logger.info(`Updating chat status for tenantId: ${tenantIdStr}`);
    
        try {
            const client = this.clients.get(tenantIdStr);
            if (!client || !client.info) {
                logger.warn(`Client for tenantId: ${tenantIdStr} is not ready. Skipping chat status update.`);
                return;
            }
    
            const Message = require('./models/Message');
            const chats = await client.getChats();
            
            for (const chat of chats) {
                try {
                    // Only process chats with unread messages or recent messages
                    if (chat.unreadCount > 0 || chat.lastMessage) {
                        // Fetch last 10 messages to ensure we don't miss anything
                        const messages = await chat.fetchMessages({ limit: 10 });
                        if (messages.length > 0) {
                            // Process each message
                            for (const msg of messages) {
                                // Skip messages sent by the tenant (we only want incoming messages)
                                if (msg.fromMe) continue;
                                
                                // Check if message already exists in database to avoid duplicates
                                const existingMessage = await Message.findOne({
                                    where: { 
                                        whatsappMessageId: msg.id._serialized,
                                        tenantId: tenantIdStr
                                    }
                                });
                                
                                // Skip if message already exists
                                if (existingMessage) continue;
                                
                                logger.info(`Storing new incoming message from ${msg.from} for tenantId: ${tenantIdStr}`);
                                
                                // Handle different message types
                                let attachType = null;
                                let attachName = null;
                                let attachData = null;
                                let messageText = msg.body;
                                
                                // Handle special message types first
                                if (msg.type) {
                                    logger.info(`Message type: ${msg.type} from ${msg.from}`);
                                    // Special handling for location, contact cards, etc.
                                    if (['location', 'vcard', 'contact_card', 'contact_card_multi'].includes(msg.type)) {
                                        // For these types, we don't try to download media even if hasMedia is true
                                        logger.info(`Special message type detected: ${msg.type}. Skipping media download.`);
                                    } 
                                    // Only proceed with media download for standard media types
                                    else if (msg.hasMedia) {
                                        try {
                                            logger.info(`Downloading media for message ${msg.id._serialized}`);
                                            // Safe media download with timeout and validation
                                            const mediaPromise = msg.downloadMedia();
                                            
                                            // Add timeout to media download
                                            const timeoutPromise = new Promise((_, reject) => 
                                                setTimeout(() => reject(new Error('Media download timeout')), 30000));
                                            
                                            // Race between download and timeout
                                            const media = await Promise.race([mediaPromise, timeoutPromise])
                                                .catch(err => {
                                                    logger.error(`Media download error: ${err.message}`);
                                                    return null;
                                                });
                                            
                                            // Validate the media object
                                            if (media && typeof media === 'object' && media.mimetype) {
                                                attachType = media.mimetype;
                                                attachName = media.filename || `file-${Date.now()}-${msg.type}`;
                                                attachData = media.data; // Base64 data
                                                logger.info(`Media downloaded successfully for message ${msg.id._serialized}`);
                                            } else {
                                                logger.warn(`Invalid media object for message ${msg.id._serialized}`);
                                            }
                                        } catch (mediaError) {
                                            logger.error(`Failed to download media for message ${msg.id._serialized}: ${mediaError.message}`);
                                        }
                                    }
                                }
                                
                                try {
                                    // Create the message record with proper binary data handling
                                    const messageData = {
                                        tenantId: tenantIdStr,
                                        phoneNumber: msg.from.replace('@c.us', ''),
                                        message: messageText,
                                        direction: 'INCOMING',
                                        whatsappMessageId: msg.id._serialized,
                                        timestamp: msg.timestamp * 1000,
                                        attachType,
                                        attachName,
                                        createdAt: new Date(),
                                        updatedAt: new Date()
                                    };
                                    
                                    // Only add attachfile if we have valid data
                                    if (attachData) {
                                        try {
                                            // Convert base64 string to Buffer explicitly for binary storage
                                            const buffer = Buffer.from(attachData, 'base64');
                                            // Verify the buffer is valid before assigning
                                            if (Buffer.isBuffer(buffer)) {
                                                messageData.attachfile = buffer;
                                            } else {
                                                logger.warn(`Invalid buffer created from attachment data for message ${msg.id._serialized}`);
                                            }
                                        } catch (conversionError) {
                                            logger.error(`Failed to convert attachment data to buffer: ${conversionError.message}`);
                                            // Continue without the attachment data
                                        }
                                    }
    
                                    await Message.create(messageData);
                                } catch (dbError) {
                                    logger.error(`Database error storing message ${msg.id._serialized}: ${dbError.message}`);
                                }
                            }
                        }
                    }
                } catch (error) {
                    logger.error(`Failed to process messages for chat ${chat.id._serialized} in tenantId: ${tenantIdStr}. Error: ${error.message}`);
                }
            }
        } catch (error) {
            logger.error(`Failed to update chat status for tenantId: ${tenantIdStr}. Error: ${error.message}`);
        }
    }
    
    async updateClientStatus(tenantId) {
        const tenantIdStr = tenantId.toString();
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
                await this.handleSessionConflict(tenantIdStr);
            }
        } catch (error) {
            logger.error(`Failed to update client status for tenantId: ${tenantIdStr}. Error: ${error.message}`);
        }
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
                if (!this.initializingClients.has(tenantId.toString())) {
                    await this.initializeClient(tenantId.toString(), true);
                }
            }
        }
    }

    async checkClientStatus() {
        logger.info('Checking client status');
        for (const [tenantId, client] of this.clients.entries()) {
            if (!client.info) {
                logger.warn(`Client for tenantId ${tenantId} is not ready. Attempting to reinitialize...`);
                if (!this.initializingClients.has(tenantId.toString())) {
                    await this.initializeClient(tenantId.toString(), true);
                }
            }
        }
    }

    async checkSessionStatus() {
        logger.info('Checking session status');
        for (const [tenantId, client] of this.clients.entries()) {
            if (client.info) { // Only save session if client is ready
                try {
                    await this.saveSessionWithLock(tenantId.toString());
                    logger.info(`Session saved for tenantId: ${tenantId}`);
                } catch (error) {
                    logger.error(`Failed to save session for tenantId: ${tenantId}. Error: ${error.message}`);
                }
            } else {
                logger.warn(`Client for tenantId: ${tenantId} is not ready. Skipping session save.`);
            }
        }
    }

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

    isClientReady(tenantId) {
        const tenantIdStr = tenantId.toString();
        const client = this.clients.get(tenantIdStr);
        if (!client || !client.info) {
            logger.warn(`Client for tenantId: ${tenantIdStr} is not ready. Client or client.info is missing.`);
            return false;
        }
        //logger.info(`isClientReady client.info.pushname : ${client.info.pushname}`);
        //logger.info(`isClientReady client.info.wid.user : ${client.info.wid.user}`);
        return true;
    }

    isClientReadyF(tenantId) {
        const client = this.clients.get(tenantId); // �� ���� �� toString()
        if (!client?.info) {
            logger.warn(`Client for tenantId: ${tenantId} is not ready.`);
            return false;
        }
        logger.info(`Client Ready: ${client.info.pushname} (${client.info.wid.user})`);
        return true;
    }

    async getClient(tenantId) {
        const tenantIdStr = tenantId.toString();
        logger.info(`Getting client for tenantId: ${tenantIdStr}`);

        // Ensure the client is ready
        if (!this.isClientReady(tenantIdStr)) {
            logger.warn(`Client for tenantId: ${tenantIdStr} is not ready. Attempting to reinitialize...`);
            await this.initializeClient(tenantIdStr, true);

            // Wait for a short period to ensure the client is fully ready
            await new Promise(resolve => setTimeout(resolve, 5000));
        }

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

    async generateQRCode(tenantId) {
        return new Promise(async (resolve, reject) => {
            try {
                const client = this.getClient(tenantId);
                
                if (!client) {
                    console.log(`Client for tenantId: ${tenantId} not found, initializing new client`);
                    await this.initializeClient(tenantId);
                    // After initialization, get the client again
                    const newClient = this.getClient(tenantId);
                    
                    if (!newClient) {
                        reject(new Error(`Failed to initialize client for tenantId: ${tenantId}`));
                        return;
                    }
                    
                    // Wait for client to be ready
                    if (!newClient.isInitialized) {
                        console.log(`Waiting for client ${tenantId} to be ready...`);
                        // Wait up to 10 seconds for client to initialize
                        for (let i = 0; i < 10; i++) {
                            if (newClient.isInitialized) break;
                            await new Promise(r => setTimeout(r, 1000));
                        }
                        
                        if (!newClient.isInitialized) {
                            reject(new Error(`Client initialization timeout for tenantId: ${tenantId}`));
                            return;
                        }
                        
                        resolve(newClient.qr);
                    } else {
                        // Existing client found
                        if (!client.isInitialized) {
                            console.log(`Client for tenantId: ${tenantId} exists but not initialized, waiting for initialization`);
                            // Wait up to 10 seconds for client to initialize
                            for (let i = 0; i < 10; i++) {
                                if (client.isInitialized) break;
                                await new Promise(r => setTimeout(r, 1000));
                            }
                            
                            if (!client.isInitialized) {
                                // Re-initialize client if it's still not ready
                                console.log(`Re-initializing client for tenantId: ${tenantId}`);
                                await this.reinitializeClient(tenantId);
                                resolve(this.getClient(tenantId).qr);
                                return;
                            }
                        }
                        
                        // Client is initialized, return QR code
                        resolve(client.qr);
                    }
                }
            } catch (error) {
                console.error(`Error in generateQRCode for tenantId: ${tenantId}:`, error);
                reject(error);
            }
        });
    }

    // Add a helper method to reinitialize client
    async reinitializeClient(tenantId) {
        console.log(`Reinitializing client for tenantId: ${tenantId}`);
        // Clean up existing client if needed
        const existingClient = this.getClient(tenantId);
        if (existingClient) {
            try {
                await existingClient.destroy();
            } catch (err) {
                console.error(`Error destroying client for tenantId: ${tenantId}:`, err);
            }
        }
        
        // Remove from clients map
        this.clients.delete(tenantId);
        
        // Initialize new client
        return await this.initializeClient(tenantId);
    }

    // Add this new method to check client status
    async getClientStatus(tenantId) {
        const client = this.getClient(tenantId);
        if (!client) {
            return {
                exists: false,
                isInitialized: false,
                status: 'not_found'
            };
        }
        
        return {
            exists: true,
            isInitialized: !!client.isInitialized,
            status: client.isInitialized ? 'ready' : 'initializing',
            hasQR: !!client.qr
        };
    }

    // Add a method to kill zombie Chrome processes
    async killZombieBrowsers() {
        logger.info('Attempting to kill zombie Chrome processes');
        try {
            if (process.platform === 'win32') {
                exec('taskkill /F /IM chrome.exe /T', (err, stdout, stderr) => {
                    if (err) {
                        logger.error(`Failed to kill chrome.exe: ${err.message}`);
                        return;
                    }
                    logger.info('Successfully killed Chrome processes');
                });
            } else {
                exec('pkill -f chrome', (err, stdout, stderr) => {
                    if (err) {
                        logger.error(`Failed to kill Chrome: ${err.message}`);
                        return;
                    }
                    logger.info('Successfully killed Chrome processes');
                });
            }
        } catch (error) {
            logger.error(`Error killing zombie browsers: ${error.message}`);
        }
    }

    // Add method to check and fix stuck initializations
    async checkStuckInitializations() {
        const stuckThreshold = 5 * 60 * 1000; // 5 minutes
        const now = Date.now();
        
        // Track initialization times
        if (!this.initializationStartTimes) {
            this.initializationStartTimes = new Map();
        }
        
        // Record start time for new initializations
        for (const tenantId of this.initializingClients) {
            if (!this.initializationStartTimes.has(tenantId)) {
                this.initializationStartTimes.set(tenantId, now);
            }
        }
        
        // Check for stuck initializations
        for (const [tenantId, startTime] of this.initializationStartTimes.entries()) {
            if (now - startTime > stuckThreshold) {
                logger.warn(`Detected stuck initialization for tenantId: ${tenantId}. Duration: ${(now - startTime)/1000} seconds`);
                
                // Force reset the initialization
                this.initializingClients.delete(tenantId);
                this.initializationStartTimes.delete(tenantId);
                
                // Try to clean up and reinitialize
                await this.killZombieBrowsers();
                setTimeout(() => this.initializeClient(tenantId, true), 5000);
            }
        }
        
        // Clean up completed initializations from tracking
        for (const tenantId of this.initializationStartTimes.keys()) {
            if (!this.initializingClients.has(tenantId)) {
                this.initializationStartTimes.delete(tenantId);
            }
        }
    }
}

// Add utility function for safe timestamp handling
function safeTimestamp(timestamp) {
    if (!timestamp || isNaN(Number(timestamp))) {
        return Date.now();
    }
    
    try {
        const timestampNum = Number(timestamp);
        // Ensure timestamp is within reasonable range
        if (timestampNum > 946684800000 && timestampNum < 4102444800000) { // Between 2000 and 2100
            return timestampNum;
        }
        return Date.now();
    } catch (e) {
        logger.error(`Invalid timestamp: ${timestamp}`, e);
        return Date.now();
    }
}

module.exports = new WhatsAppClientManager();