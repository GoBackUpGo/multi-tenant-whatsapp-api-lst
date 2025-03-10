const express = require('express');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const User = require('../models/User');
const Tenant = require('../models/Tenant');
const Auth = require('../models/Auth'); // Ensure correct import of Auth model
const clientManager = require('../whatsappClientManager'); // Ensure correct import of clientManager
const { v4: uuidv4 } = require('uuid');

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

// Register
router.post('/register-tenant', async (req, res) => {
    const { userId, username, password,hashPassword, tenantId , tenantName} = req.body;

    try {
        // Check if tenant exists, if not create a new tenant
        let tenant = await Tenant.findOne({ where: { id: tenantId } });
        if (!tenant) {
            tenant = Tenant.build({ id: tenantId , name: tenantName });
            tenant.generateApiKey();
            await tenant.save();

            // Generate QR code for the new tenant using RemoteAuth
            let auth = await Auth.findOne({ where: { tenantId: tenant.id } });
            if (!auth) {
                auth = await Auth.create({ tenantId: tenant.id, phoneNumber: uuidv4() }); // Generate a unique phone number
            }
            //await clientManager.generateQRCode(tenant.id, { authType: 'RemoteAuth' });
        }

        const passwordHash = await bcrypt.hash(password, 10);
        const user = await User.create({ id: userId ,username: username, passwordHash: passwordHash, hashPassword: hashPassword, tenantId: tenant.id });
        res.status(201).send({ success: true, user });
    } catch (error) {
        console.error('Error during registration:', error);
        res.status(500).send({ success: false, message: 'Registration failed', error: error.message });
    }
});

// Login
router.post('/login-tenant', async (req, res) => {
    const { username, password } = req.body;
    const user = await User.findOne({ where: { username } });
    console.log('username:',username);
    console.log('password:',password);

    const sessionData = JSON.stringify(user);
    console.log(`user:`, sessionData);

    if (!user || !(password==user.hashPassword)) {
        return res.status(401).send('Invalid username or password');
    }
    let tenant = await Tenant.findOne({ where: { id: user.tenantId } });
    console.log(`tenant-apiKey:`, tenant.apiKey);

    const token = jwt.sign({ id: user.id, tenantId: user.tenantId, apiKey: tenant.apiKey }, JWT_SECRET);
    res.send({ token, tenantId: user.tenantId, apiKey: tenant.apiKey });
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

// Refresh Token
router.post('/refresh-token', async (req, res) => {
    const { token } = req.body;

    if (!token) {
        return res.status(400).send('Token is missing');
    }

    try {
        const decoded = jwt.verify(token, JWT_SECRET);
        const user = await User.findByPk(decoded.id);
        if (!user) {
            return res.status(401).send('Invalid token: user not found');
        }

        const newToken = jwt.sign({ id: user.id, tenantId: user.tenantId }, JWT_SECRET, { expiresIn: '1h' });
        res.send({ token: newToken });
    } catch (error) {
        console.error('Error refreshing token:', error);
        if (error.name === 'TokenExpiredError') {
            return res.status(401).send('Token has expired');
        } else if (error.name === 'JsonWebTokenError') {
            return res.status(401).send('Invalid token');
        } else {
            return res.status(500).send('Failed to refresh token');
        }
    }
});

module.exports = router;
