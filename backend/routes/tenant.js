const express = require('express');
const router = express.Router();
const Tenant = require('../models/Tenant');
const authMiddleware = require('../middleware/auth');

// Create a new tenant
router.post('/tenants', async (req, res) => {
    const tenant = Tenant.build({ name: req.body.name });
    tenant.generateApiKey();
    await tenant.save();
    res.status(201).send(tenant);
});

// List all tenants
router.get('/tenants', async (req, res) => {
    const tenants = await Tenant.findAll();
    res.send(tenants);
});

// Get tenant details
router.get('/tenants/:id', async (req, res) => {
    const tenant = await Tenant.findByPk(req.params.id);
    if (!tenant) {
        return res.status(404).send('Tenant not found');
    }
    res.send(tenant);
});

// Get API key for the logged-in user's tenant
router.get('/api-key', authMiddleware, async (req, res) => {
    const tenant = await Tenant.findByPk(req.user.tenantId);
    
    console.log('tenantId:',req.user.tenantId);
    const sessionData = JSON.stringify(tenant);
    console.log(`tenant:`, sessionData);

    if (!tenant) {
        console.error('Tenant not found');
        return res.status(404).send('Tenant not found');
    }
    //res.send({ apiKey: tenant.apiKey });
    res.send({ apiKey: tenant.apiKey , userId: req.user.id});
});

// Endpoint to get tenant name by tenant ID
router.get('/tenant-name/:tenantId', authMiddleware, async (req, res) => {
    const { tenantId } = req.params;

    try {
        const tenant = await Tenant.findByPk(tenantId);
        if (!tenant) {
            return res.status(404).send({ success: false, message: 'Tenant not found' });
        }

        res.send({ success: true, tenantName: tenant.name });
    } catch (error) {
        console.error('Error fetching tenant name:', error);
        res.status(500).send({ success: false, message: 'Failed to fetch tenant name', error: error.message });
    }
});

module.exports = router;
