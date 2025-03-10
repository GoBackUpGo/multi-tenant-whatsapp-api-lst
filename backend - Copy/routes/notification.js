const express = require('express');
const Notification = require('../models/Notification');
const router = express.Router();

// Get Notifications
router.get('/:tenantId', async (req, res) => {
    const { tenantId } = req.params;

    try {
        const notifications = await Notification.findAll({ where: { tenantId } });
        res.status(200).json(notifications);
    } catch (error) {
        res.status(500).json({ message: 'Error fetching notifications', error: error.message });
    }
});

// Mark Notifications as Read
router.post('/read/:tenantId', async (req, res) => {
    const { tenantId } = req.params;

    try {
        await Notification.update({ read: true }, { where: { tenantId } });
        res.status(200).send('Notifications marked as read');
    } catch (error) {
        res.status(500).json({ message: 'Error marking notifications as read', error: error.message });
    }
});

// Get notifications for a tenant
router.get('/', async (req, res) => {
    const notifications = await Notification.findAll({ where: { tenantId: req.tenant.id } });
    res.send(notifications);
});

module.exports = router;
