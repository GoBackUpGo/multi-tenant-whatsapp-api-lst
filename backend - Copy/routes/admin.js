const express = require('express');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const Admin = require('../models/Admin');
const clientManager = require('../whatsappClientManager');
const { seedDefaultData } = require('../db');

const router = express.Router();
const SECRET_KEY = 'admin_secret_key';

// Admin Login
router.post('/login', async (req, res) => {
    const { username, password } = req.body;

    try {
        const admin = await Admin.findOne({ where: { username } });
        if (!admin) return res.status(404).send('Admin not found');

        const isPasswordValid = await bcrypt.compare(password, admin.passwordHash);
        if (!isPasswordValid) return res.status(401).send('Invalid credentials');

        const token = jwt.sign({ username }, SECRET_KEY, { expiresIn: '30m' }); // Token expires in 30 minutes
        res.status(200).send({ token });
    } catch (err) {
        res.status(500).send('Error logging in');
    }
});

// Reinitialize all clients
router.post('/reinitialize-clients', async (req, res) => {
    try {
        await clientManager.reinitializeClients();
        res.status(200).send('Clients reinitialized successfully');
    } catch (error) {
        res.status(500).json({ message: 'Error reinitializing clients', error: error.message });
    }
});

// Seed default data
router.post('/seed-data', async (req, res) => {
    try {
        await seedDefaultData();
        res.status(200).send('Default data seeded successfully');
    } catch (error) {
        res.status(500).json({ message: 'Error seeding default data', error: error.message });
    }
});

module.exports = router;
