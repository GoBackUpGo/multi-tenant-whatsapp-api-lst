const express = require('express');
const clientManager = require('../whatsappClientManager');
const Auth = require('../models/Auth'); // Ensure correct import of Auth model
const { getSessionFileFromDatabase } = require('../SQLServerAuth'); // Import getSessionFileFromDatabase function
const router = express.Router();
const { v4: uuidv4 } = require('uuid'); // Import UUID for generating unique phone numbers
const authMiddleware = require('../middleware/auth'); // Import auth middleware
const path = require('path'); // Ensure correct import of path
const fs = require('fs'); // Ensure correct import of fs

// Generate QR code
router.get('/generate-qr/:tenantId', async (req, res) => {
    const { tenantId } = req.params;

    try {
        let auth = await Auth.findOne({ where: { tenantId } });
        if (!auth) {
            auth = await Auth.create({ tenantId, phoneNumber: uuidv4() }); // Generate a unique phone number
        }
        if (auth.qrCode) {
            return res.status(200).json({ qrCode: auth.qrCode });
        }

        // Check if client is already authenticated
        const client = clientManager.getClient(tenantId);
        if (client && client.info) {
            return res.status(200).json({ message: 'Client is already authenticated' });
        }

        // Wait for client initialization to complete
        await clientManager.initializeClient(tenantId, true);

        // Wait until the client is ready
        client.on('ready', async () => {
            const qrCode = await clientManager.generateQRCode(tenantId);
            res.status(200).json({ qrCode });
        });
    } catch (error) {
        console.error('Error generating QR code:', error); // Log the error
        res.status(500).json({ message: 'Error generating QR code', error: error.message });
    }
});

// Scan QR code
router.post('/scan-qr', authMiddleware, async (req, res) => {
    const { tenantId, qrCode } = req.body;
    try {
        await clientManager.scanQRCode(tenantId, qrCode);
        res.send({ success: true });
    } catch (error) {
        console.error('Failed to scan QR code:', error);
        res.status(500).send({ success: false, message: 'Failed to scan QR code', error: error.message });
    }
});

// Check if client is initializing
router.get('/is-initializing/:tenantId', async (req, res) => {
    const { tenantId } = req.params;
    const isInitializing = clientManager.isClientInitializing(tenantId);
    res.status(200).json({ tenantId, isInitializing });
});

// Check if client is ready
router.get('/is-ready/:tenantId', async (req, res) => {
    const { tenantId } = req.params;
    const isReady = clientManager.isClientReady(tenantId);
    res.status(200).json({ tenantId, isReady });
});

// Endpoint to download client session file
router.get('/download-session/:tenantId', authMiddleware, async (req, res) => {
    const { tenantId } = req.params;

    try {
        const sessionFile = await getSessionFileFromDatabase(tenantId);
        if (sessionFile) {
            const sessionFilePath = path.join(__dirname, `../session-${tenantId}.zip`);
            fs.writeFileSync(sessionFilePath, sessionFile);
            res.download(sessionFilePath, `session-${tenantId}.zip`, (err) => {
                if (err) {
                    console.error('Error downloading session file:', err);
                    res.status(500).send({ success: false, message: 'Failed to download session file', error: err.message });
                } else {
                    fs.unlinkSync(sessionFilePath); // Remove the file after download
                }
            });
        } else {
            res.status(404).send({ success: false, message: 'No session file found for this tenant' });
        }
    } catch (error) {
        console.error('Error retrieving session file from database:', error);
        res.status(500).send({ success: false, message: 'Failed to retrieve session file from database', error: error.message });
    }
});

// Endpoint to get client session file as binary data
router.get('/get-session-binary/:tenantId', authMiddleware, async (req, res) => {
    const { tenantId } = req.params;

    try {
        const sessionFile = await getSessionFileFromDatabase(tenantId);
        if (sessionFile) {
            res.setHeader('Content-Disposition', `attachment; filename="session-${tenantId}.zip"`);
            res.setHeader('Content-Type', 'application/zip');
            res.send(sessionFile);
        } else {
            res.status(404).send({ success: false, message: 'No session file found for this tenant' });
        }
    } catch (error) {
        console.error('Error retrieving session file from database:', error);
        res.status(500).send({ success: false, message: 'Failed to retrieve session file from database', error: error.message });
    }
});

module.exports = router;
