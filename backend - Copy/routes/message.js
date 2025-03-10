const express = require('express');
const clientManager = require('../whatsappClientManager');
const MessageAnalytics = require('../models/MessageAnalytics');
const Message = require('../models/Message');
const Tenant = require('../models/Tenant');
const authMiddleware = require('../middleware/auth');
const router = express.Router();

// Middleware to authenticate using apiKey
const apiKeyAuth = async (req, res, next) => {
    const apiKey = req.headers['x-api-key'];
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

module.exports = router;