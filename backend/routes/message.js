const express = require('express');
const clientManager = require('../whatsappClientManager');
const MessageAnalytics = require('../models/MessageAnalytics');
const Message = require('../models/Message');
const Tenant = require('../models/Tenant');
const authMiddleware = require('../middleware/auth');
const router = express.Router();
const multer = require('multer');
const { MessageMedia } = require('whatsapp-web.js');
const { Sequelize, DataTypes } = require('sequelize');
const logger = require('../logger');
const { stat } = require('fs');

// // ����� multer ������� �� ������� �� �������
// const upload = multer({
//     storage: multer.memoryStorage(), // ����� ����� �� �������
//     limits: {
//         fileSize: 10 * 1024 * 1024 // �� ��� �����: 10MB
//     }
// });
// زيادة حجم الملف المسموح به إلى 50MB
// إعدادات Multer
const upload = multer({
    storage: multer.memoryStorage(),
    limits: {
        fileSize: 50 * 1024 * 1024 // 50MB
    }
});

// Middleware to authenticate using apiKey
const apiKeyAuth = async (req, res, next) => {
    const apiKey = req.headers['x-api-key'];
    //console.log('apiKey:',apiKey );
    if (!apiKey) {
        return res.status(401).send('API key is missing');
    }

    const tenant = await Tenant.findOne({ where: { apiKey } });
    if (!tenant) {
        return res.status(401).send('Invalid API key');
    }

    req.tenant = tenant;
    next();
};

// Helper function to ensure message is a string
const ensureStringMessage = (message) => {
    if (message === null || message === undefined) {
        return '';
    }
    
    if (typeof message === 'string') {
        return message;
    }
    
    // Handle objects and arrays by converting to JSON string
    if (typeof message === 'object') {
        try {
            return JSON.stringify(message);
        } catch (err) {
            return String(message);
        }
    }
    
    // Convert any other type to string
    return String(message.body || message);
};

// Send WhatsApp message
router.post('/send', authMiddleware, apiKeyAuth, async (req, res) => {
    const { phoneNumber, message } = req.body;
    const tenantId = req.tenant.id;
    const userId = req.user.id;

    try {
        await clientManager.sendMessage(tenantId, phoneNumber, message);

        // Log analytics
        await MessageAnalytics.increment('messageCount', { where: { tenantId } });

        // Save message
        await Message.create({ userId, tenantId, phoneNumber, message });

        res.status(200).json({ message: 'Message sent successfully' }); // Ensure JSON response
    } catch (error) {
        console.error('Error sending message:', error);
        res.status(500).json({ message: 'Error sending message', error: error.message });
    }
});
// Send WhatsApp message with optional file
router.post('/send-media', authMiddleware, apiKeyAuth, upload.single('file'), async (req, res) => {
    const { phoneNumber, message } = req.body;
    const tenantId = req.tenant.id;
    const userId = req.user.id;
    const filePath = req.file ? req.file.path : null;

    try {
        if (filePath) {
            await clientManager.sendFile(tenantId, phoneNumber, filePath, message);
        } else {
            await clientManager.sendMessage(tenantId, phoneNumber, message);
        }

        // Log analytics
        await MessageAnalytics.increment('messageCount', { where: { tenantId } });

        // Save message
        await Message.create({ 
            userId, 
            tenantId, 
            phoneNumber, 
            message,
            attachmentPath: filePath
        });

        res.status(200).json({ message: 'Message sent successfully' });
    } catch (error) {
        console.error('Error sending message:', error);
        
        // Clean up uploaded file if there was an error
        if (filePath && fs.existsSync(filePath)) {
            fs.unlinkSync(filePath);
        }

        res.status(500).json({ message: 'Error sending message', error: error.message });
    }
});

// Send WhatsApp message with optional file
router.post('/send-attch', authMiddleware, apiKeyAuth, upload.single('file'), async (req, res) => {
    const { phoneNumber, message, msgId, machineName, docType, docSrl, cmpNo, brnNo, brnUsr, brnYear, adUsrId, mimeType, fileName } = req.body;
    const tenantId = req.tenant.id;
    const userId = req.user.id;
    const file = req.file; // File is now in memory
    const attachType = file ? file.mimetype? file.mimetype : mimeType : null;
    const attachName = file ? file.originalname ? file.originalname : fileName  : null;
    const attachPath = file ? file.path : null;
    
    try {
        if (file) {
	    file.mimetype=attachType;
	    file.filename=attachName ;
            // Create MessageMedia object from the uploaded file
            const media = new MessageMedia(
                file.mimetype , // MIME type
                file.buffer.toString('base64'), // Base64-encoded file data
                file.filename  // File name
            );

            // Send the file via WhatsApp
	    //console.log('Send the file via WhatsApp');
            await clientManager.sendMessage(tenantId, phoneNumber, message,3,media );

        } else {
            // Send text message if no file is provided
	    //console.log('Send text message if no file is provided');
            await clientManager.sendMessage(tenantId, phoneNumber, message);
        }

        // Log analytics
        await MessageAnalytics.increment('messageCount', { where: { tenantId } });
        //console.info('Saving message to database');
        // Save message to database
        await Message.create({
            userId,
            tenantId,
            phoneNumber,
            message: ensureStringMessage(message), // Use the sanitized message
	        createdAt: new Date(), // ����� ����� ������ ����� �������� ����� createdAt
            updatedAt: new Date(), // ����� ����� ������ ����� �������� ����� updatedAt
            attachName: attachName || null, 
            attachPath: attachPath || null, 
            attachType: attachType || null, 
            msgId: msgId || null, 
            attachfile: file ? Buffer.from(file.buffer.toString('base64'), 'base64') : { type: Sequelize.NULL },
            machineName: machineName || null,
	        docType: docType || null,
            docSrl: docSrl || null,
            cmpNo: cmpNo || null,
            brnNo: brnNo || null,
            brnUsr: brnUsr || null,
            brnYear: brnYear || null,
            adUsrId: adUsrId || null,
            direction: 'OUTGOINING',
        });

        res.status(200).json({ message: 'Message sent successfully' });
    } catch (error) {
        console.error('Error sending message:', error);
        res.status(500).json({ message: 'Error sending message', error: error.message });
    }
});

// Receive WhatsApp messages
router.get('/receive', authMiddleware, apiKeyAuth, async (req, res) => {
    const tenantId = req.tenant.id;

    try {
        const messages = await Message.findAll({ where: { tenantId } });
        res.status(200).json(messages);
    } catch (error) {
        res.status(500).json({ message: 'Error fetching messages', error: error.message });
    }
});

// Get Message Analytics
router.get('/analytics', authMiddleware, apiKeyAuth, async (req, res) => {
    const tenantId = req.tenant.id;

    try {
        const analytics = await MessageAnalytics.findOne({ where: { tenantId } });
        res.status(200).json(analytics);
    } catch (error) {
        res.status(500).json({ message: 'Error fetching analytics', error: error.message });
    }
});

// List Messages
router.get('/', authMiddleware, apiKeyAuth, async (req, res) => {
    const tenantId = req.tenant.id;

    try {
        const messages = await Message.findAll({ where: { tenantId } });
        res.status(200).json(messages);
    } catch (error) {
        res.status(500).json({ message: 'Error fetching messages', error: error.message });
    }
});

// إرسال قالب رسالة (مكافئ لميتا)
// تنسيق الأرقام
const formatNumber = (number) => 
    number.includes('@c.us') ? number : `${number}@c.us`;

// معالجة الأخطاء المركزية
const handleError = (res, error) => {
    console.error('API Error:', error);
    res.status(500).json({ 
        error: error.message,
        code: error.code || 'INTERNAL_ERROR'
    });
};

// إرسال رسالة نصية
router.post('/text', async (req, res) => {
    try {
        const { to, text, preview_url, reply_to, tenantId } = req.body;
        const result = await clientManager.sendMessageNew({
            tenantId,
            type: 'text',
            to: formatNumber(to),
            content: text,
            options: {
                linkPreview: preview_url,
                quotedMessageId: reply_to
            }
        });

        // Ensure message is a string
        const messageText = ensureStringMessage(text);

        await Message.create({
            tenantId: tenantId.toString(),
            phoneNumber: to.replace('@c.us', ''),
            message: text.body || text,
            direction: 'OUTGOINING',
            whatsappMessageId: result.id,
            timestamp: result.timestamp,
            //attachType: null,
            //attachName: null,
            //attachfile: null,
            status: 'sent',
            createdAt: new Date(),
            updatedAt: new Date(),
        });

        res.json({
            id: result.id,
            messaging_product: result.messaging_product,
            contacts: result.contacts,
            messages: result.messages,
            status: 'sent',
            timestamp: result.timestamp
        });
    } catch (error) {
        handleError(res, error);
    }
});

// إرسال وسائط (صورة/فيديو/ملف/إلخ)
const handleMediaMessage = async (req, res, type) => {
    try {
        const { to, caption, reply_to, tenantId, mediaId } = req.body;
        
        // Check if we have a file or mediaId
        if (!req.file && !mediaId) {
            return res.status(400).json({
                error: `No file uploaded or mediaId provided for ${type} message`,
                code: 'FILE_REQUIRED'
            });
        }
        
        // If we have a file, upload it first
        let mediaIdentifier = mediaId;
        if (req.file) {
            // Upload the file and get a mediaId
            const uploadResult = await clientManager.uploadMedia(
                req.file.buffer,
                req.file.mimetype,
                req.file.originalname
            );
            mediaIdentifier = uploadResult.id;
        }
        
        // Now send the message with the mediaId
        const result = await clientManager.sendMessageNew({
            tenantId,
            type: 'media', // Always use 'media' type for consistency
            to: formatNumber(to),
            content: { 
                mediaId: mediaIdentifier,
                caption: ensureStringMessage(caption) // Ensure caption is a string
            },
            options: {
                quotedMessageId: reply_to
            }
        });

        res.json({
            media_id: result.id,
            type,
            id: result.id,
            messaging_product: result.messaging_product,
            contacts: result.contacts,
            messages: result.messages,
            status: 'sent',
            timestamp: result.timestamp
        });
    } catch (error) {
        handleError(res, error);
    }
};

// إرسال صورة
router.post('/image', authMiddleware, apiKeyAuth, upload.single('file'), (req, res) => 
    handleMediaMessage(req, res, 'media'));

// إرسال فيديو
router.post('/video', authMiddleware, apiKeyAuth, upload.single('file'), (req, res) => 
    handleMediaMessage(req, res, 'media'));

router.post('/audio', authMiddleware, apiKeyAuth, upload.single('file'), (req, res) => 
    handleMediaMessage(req, res, 'media'));

// إرسال مستند
router.post('/document', authMiddleware, apiKeyAuth, upload.single('file'), (req, res) => {
    req.body.type = 'document';
    handleMediaMessage(req, res, 'media');
});

// // إرسال قالب
// router.post('/template', async (req, res) => {
//     try {
//         const { to, name, language, components, reply_to, tenantId } = req.body;
        
//         const result = await clientManager.sendTemplate({
//             tenantId,
//             to: formatNumber(to),
//             template: {
//                 name,
//                 language: { code: language },
//                 components: components
//             },
//             quotedMessageId: reply_to
//         });

//         res.json({
//             template_id: result.id,
//             id: result.id,
//             messaging_product: result.messaging_product,
//             contacts: result.contacts,
//             messages: result.messages,
//             status: 'sent',
//             timestamp: result.timestamp
//         });
//     } catch (error) {
//         handleError(res, error);
//     }
// });
router.post('/template', async (req, res) => {
    try {
        const { to, template, reply_to } = req.body;
        
        const result = await clientManager.sendTemplate(
            req.tenant.id,
            to,
            template.name,
            template.language,
            template.components,
            { replyTo: reply_to }
        );

        res.json(result);
    } catch (error) {
        handleError(res, error);
    }
});

// إرسال أزرار
router.post('/buttons', async (req, res) => {
    try {
        const { to, body, buttons, header, footer, reply_to, tenantId } = req.body;
        
        const formattedButtons = buttons.map((btn, index) => ({
            id: `btn${index + 1}`,
            title: btn.title
        }));

        const result = await clientManager.sendMessageNew({
            tenantId,
            type: 'buttons',
            to: formatNumber(to),
            content: {
                body,
                buttons: formattedButtons,
                header,
                footer
            },
            options: {
                quotedMessageId: reply_to
            }
        });

        res.json({
            button_id: result.id,
            id: result.id,
            messaging_product: result.messaging_product,
            contacts: result.contacts,
            messages: result.messages,
            status: 'sent',
            timestamp: result.timestamp            
        });
    } catch (error) {
        handleError(res, error);
    }
});

// إدارة الردود
router.post('/reply', async (req, res) => {
    try {
        const { to, message_id, text, tenantId } = req.body;
        
        const result = await clientManager.sendMessageNew({
            tenantId,
            type: 'reply',
            to: formatNumber(to),
            content: text,
            options: {
                quotedMessageId: message_id
            }
        });

        res.json({
            reply_id: result.id,
            id: result.id,
            messaging_product: result.messaging_product,
            contacts: result.contacts,
            messages: result.messages,
            status: 'sent',
            timestamp: result.timestamp
        });
    } catch (error) {
        handleError(res, error);
    }
});

// إدارة الوسائط
router.post('/media/upload-old', upload.single('file'), async (req, res) => {
    try {
        const media = new MessageMedia(
            req.file.mimetype,
            req.file.buffer.toString('base64'),
            req.file.originalname
        );
        logger.info(`media: ${JSON.stringify(media)}`);

        const result = await clientManager.uploadMedia(media);
        logger.info(`result: ${JSON.stringify(result)}`);

        res.json({
            id: result.id,
            url: result.url,
            expires_at: result.expires
        });
    } catch (error) {
        handleError(res, error);
    }
});
// رفع الملفات
router.post('/media/upload', authMiddleware, apiKeyAuth, upload.single('file'), async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({
                error: 'لم يتم تحميل أي ملف',
                code: 'NO_FILE_UPLOADED'
            });
        }

        // التحقق من نوع الملف
        // if (!req.file.mimetype.startsWith('image/')) {
        //     return res.status(400).json({
        //         error: 'نوع الملف غير مدعوم',
        //         code: 'INVALID_FILE_TYPE'
        //     });
        // }

        // معالجة الملف
        // const media = new MessageMedia(
        //     req.file.mimetype,
        //     req.file.buffer.toString('base64'),
        //     req.file.originalname
        // );

        const result = await clientManager.uploadMedia(req.file,req.file.mimetype,req.file.originalname);

        res.json({
            id: result.id,
            url: result.url,
            expires_at: result.expires
        });

    } catch (error) {
        console.error('Error uploading media:', error);
        res.status(500).json({
            error: 'فشل في رفع الملف',
            code: 'UPLOAD_FAILED'
        });
    }
});


// الحصول على حالة الرسالة
router.get('/:id/status', async (req, res) => {
    try {
        const status = await clientManager.getMessageStatus(req.params.id);
        res.json({
            id: req.params.id,
            status: status.state,
            timestamp: status.timestamp
        });
    } catch (error) {
        handleError(res, error);
    }
});

// تحديث بيانات الأعمال
router.put('/business/profile', async (req, res) => {
    try {
        const updated = await clientManager.updateBusinessProfile(req.body);
        res.json(updated);
    } catch (error) {
        handleError(res, error);
    }
});

// الحصول على مقاييس الرسائل
router.get('/metrics', async (req, res) => {
    try {
        const { start, end } = req.query;
        const metrics = await clientManager.getMessageMetrics(start, end);
        res.json(metrics);
    } catch (error) {
        handleError(res, error);
    }
});

// Receive WhatsApp messages with filtering capabilities
router.get('/incoming', authMiddleware, apiKeyAuth, async (req, res) => {
    const tenantId = req.tenant.id;
    const { 
        startDate, 
        endDate, 
        phoneNumber, 
        limit = 100, 
        offset = 0 
    } = req.query;

    try {
        // Build query conditions
        const whereClause = { 
            tenantId,
            direction: 'INCOMING'
        };
        
        // Add optional filters
        if (phoneNumber) {
            whereClause.phoneNumber = phoneNumber;
        }
        
        // Add date range filter if provided
        if (startDate && endDate) {
            whereClause.createdAt = {
                [Sequelize.Op.between]: [new Date(startDate), new Date(endDate)]
            };
        } else if (startDate) {
            whereClause.createdAt = {
                [Sequelize.Op.gte]: new Date(startDate)
            };
        } else if (endDate) {
            whereClause.createdAt = {
                [Sequelize.Op.lte]: new Date(endDate)
            };
        }
        
        // Query with pagination
        const messages = await Message.findAndCountAll({
            where: whereClause,
            limit: parseInt(limit),
            offset: parseInt(offset),
            order: [['createdAt', 'DESC']]
        });
        
        // Format the response with pagination info
        res.status(200).json({
            total: messages.count,
            limit: parseInt(limit),
            offset: parseInt(offset),
            messages: messages.rows
        });
    } catch (error) {
        logger.error('Error fetching incoming messages:', error);
        res.status(500).json({ 
            message: 'Error fetching incoming messages', 
            error: error.message 
        });
    }
});

// Get a specific message by ID with attachment download option
router.get('/incoming/:messageId', authMiddleware, apiKeyAuth, async (req, res) => {
    const tenantId = req.tenant.id;
    const { messageId } = req.params;
    const { downloadAttachment } = req.query;

    try {
        // Find the message
        const message = await Message.findOne({ 
            where: { 
                id: messageId,
                tenantId,
                direction: 'INCOMING'
            } 
        });

        if (!message) {
            return res.status(404).json({ message: 'Message not found' });
        }

        // If download requested and message has attachment
        if (downloadAttachment === 'true' && message.attachfile && message.attachType) {
            // Set appropriate content type for file download
            res.set('Content-Type', message.attachType);
            res.set('Content-Disposition', `attachment; filename=${message.attachName || 'file'}`);
            return res.send(message.attachfile);
        }

        // Return message details
        res.status(200).json(message);
    } catch (error) {
        logger.error('Error fetching message details:', error);
        res.status(500).json({ 
            message: 'Error fetching message details', 
            error: error.message 
        });
    }
});

// Webhook endpoint for real-time message notifications
router.post('/webhook', async (req, res) => {
    try {
        // This endpoint can be used by external services to trigger message checks
        // Or it can be enhanced to receive messages from WhatsApp Cloud API if migrating in future
        const { tenantId } = req.body;
        
        if (!tenantId) {
            return res.status(400).json({ error: 'Tenant ID is required' });
        }
        
        // Force an immediate check for new messages
        await clientManager.updateChatStatus(tenantId);
        
        res.status(200).json({ success: true, message: 'Message check triggered successfully' });
    } catch (error) {
        logger.error('Error processing webhook:', error);
        res.status(500).json({ error: 'Failed to process webhook', details: error.message });
    }
});

module.exports = router;