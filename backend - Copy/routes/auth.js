const express = require('express');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const User = require('../models/User');
const Tenant = require('../models/Tenant');
const Auth = require('../models/Auth'); // Ensure correct import of Auth model
const clientManager = require('../whatsappClientManager'); // Ensure correct import of clientManager

const router = express.Router();

const JWT_SECRET = process.env.JWT_SECRET || 'your_jwt_secret'; // Ensure the secret is consistent

// Register
router.post('/register', async (req, res) => {
    const { username, password, tenantName } = req.body;

    try {
        // Check if tenant exists, if not create a new tenant
        let tenant = await Tenant.findOne({ where: { name: tenantName } });
        if (!tenant) {
            tenant = Tenant.build({ name: tenantName });
            tenant.generateApiKey();
            await tenant.save();

            // Generate QR code for the new tenant using RemoteAuth
            let auth = await Auth.findOne({ where: { tenantId: tenant.id } });
            if (!auth) {
                auth = await Auth.create({ tenantId: tenant.id, phoneNumber: uuidv4() }); // Generate a unique phone number
            }
            await clientManager.generateQRCode(tenant.id, { authType: 'RemoteAuth' });
        }

        const passwordHash = await bcrypt.hash(password, 10);
        const user = await User.create({ username, passwordHash, tenantId: tenant.id });
        res.status(201).send({ success: true, user });
    } catch (error) {
        console.error('Error during registration:', error);
        res.status(500).send({ success: false, message: 'Registration failed', error: error.message });
    }
});

// Login
router.post('/login', async (req, res) => {
    const { username, password } = req.body;
    const user = await User.findOne({ where: { username } });
    if (!user || !(await bcrypt.compare(password, user.passwordHash))) {
        return res.status(401).send('Invalid username or password');
    }
    const token = jwt.sign({ id: user.id, tenantId: user.tenantId }, JWT_SECRET);
    res.send({ token, tenantId: user.tenantId });
});

module.exports = router;
