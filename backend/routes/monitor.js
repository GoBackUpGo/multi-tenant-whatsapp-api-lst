const express = require('express');
const clientManager = require('../whatsappClientManager');
const Auth = require('../models/Auth');
const router = express.Router();

// Get Monitoring Data
router.get('/clients', async (req, res) => {
    try {
        const clients = Array.from(clientManager.clients.keys());
        const allTenants = await Auth.findAll();
        const disconnectedTenants = allTenants
            .filter((auth) => !clients.includes(auth.tenantId))
            .map((auth) => ({ tenantId: auth.tenantId, phoneNumber: auth.phoneNumber }));

        res.status(200).json({
            activeClients: clients,
            disconnectedClients: disconnectedTenants,
        });
    } catch (error) {
        res.status(500).json({ message: 'Error fetching monitoring data', error: error.message });
    }
});

// Get monitoring data
router.get('/data', async (req, res) => {
    const data = await clientManager.getMonitoringData();
    res.send(data);
});

module.exports = router;
