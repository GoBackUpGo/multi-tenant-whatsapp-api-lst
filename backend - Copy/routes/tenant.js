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
    if (!tenant) {
        console.error('Tenant not found');
        return res.status(404).send('Tenant not found');
    }
    res.send({ apiKey: tenant.apiKey });
});

module.exports = router;
