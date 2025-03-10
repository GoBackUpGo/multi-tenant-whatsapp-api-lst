const express = require('express');
const clientManager = require('../whatsappClientManager');
const Auth = require('../models/Auth'); // Ensure correct import of Auth model
const { getSessionFileFromDatabase, saveSessionToDatabase } = require('../SQLServerAuth'); // Import getSessionFileFromDatabase and saveSessionToDatabase functions
const router = express.Router();
const { v4: uuidv4 } = require('uuid'); // Import UUID for generating unique phone numbers
const authMiddleware = require('../middleware/auth'); // Import auth middleware
const path = require('path'); // Ensure correct import of path
const fs = require('fs'); // Ensure correct import of fs
const multer = require('multer'); // Import multer for file uploads

const upload = multer({ dest: 'uploads/' }); // Configure multer to save files to 'uploads/' directory

const localCache = new Map(); // ����� ���� �� �������

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
        const client = clientManager.clients.get(tenantId.toString());
        if (client && client.info) {
            return res.status(200).json({ message: 'Client is already authenticated' });
        }

        // Initialize client and generate QR code
        await clientManager.initializeClient(tenantId.toString(), true);
        const qrCode = await clientManager.generateQRCode(tenantId);
        res.status(200).json({ qrCode });
    } catch (error) {
        console.error('Error generating QR code:', error); // Log the error
        res.status(500).json({ message: 'Error generating QR code', error: error.message });
    }
});

router.get('/qr/:tenantId', async (req, res) => {
    try {
        const tenantId = req.params.tenantId;
        console.log(`Generating QR code for tenantId: ${tenantId}`);
        
        // First check if client exists and is ready
        const clientStatus = await clientManager.getClientStatus(tenantId);
        console.log(`Client status for ${tenantId}:`, clientStatus);
        
        const qrCode = await clientManager.generateQRCode(tenantId);
        res.json({ success: true, qrCode });
    } catch (error) {
        console.error('Error generating QR code:', error);
        res.status(500).json({ 
            success: false, 
            error: error.message,
            details: 'An error occurred while generating QR code. Please try again.'
        });
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
router.get('/is-readyold/:tenantId', async (req, res) => {
    const { tenantId } = req.params;
    const isReady = clientManager.isClientReady(tenantId);
    res.status(200).json({ tenantId, isReady });
});

router.get('/is-ready/:tenantId', async (req, res) => {
    const { tenantId } = req.params;
    
    // ��� ��� ����� ����� �� ����� ������� �������� ������
    if (localCache.has(tenantId)) {
        return res.status(200).json({ tenantId, isReady: localCache.get(tenantId) });
    }

    // ��� ������ �������
    const isReady = clientManager.isClientReadyF(tenantId);
    
    // ����� ������ �� ����� ������ ���� 10 �����
    localCache.set(tenantId, isReady);
    setTimeout(() => localCache.delete(tenantId), 10 * 1000); // ��� ��� 10 �����

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

// Endpoint to upload and save client session file
router.post('/upload-session/:tenantId', authMiddleware, upload.single('sessionFile'), async (req, res) => {
    const { tenantId } = req.params;
    const file = req.file;

    if (!file) {
        return res.status(400).send({ success: false, message: 'No file uploaded' });
    }

    try {
        const sessionFilePath = path.join(__dirname, `../uploads/${file.filename}`);
        const sessionFile = fs.readFileSync(sessionFilePath);

        // Save session file to database
        await saveSessionToDatabase(tenantId, sessionFile);

        // Remove the uploaded file after processing
        fs.unlinkSync(sessionFilePath);

        res.send({ success: true, message: 'Session file uploaded and saved successfully' });
    } catch (error) {
        console.error('Error uploading session file:', error);
        res.status(500).send({ success: false, message: 'Failed to upload and save session file', error: error.message });
    }
});

// Endpoint to upload and save client session file in chunks
router.post('/upload-session-chunk/:tenantId', authMiddleware, upload.single('sessionChunk'), async (req, res) => {
    const { tenantId } = req.params;
    const { chunkIndex, totalChunks } = req.body;
    const file = req.file;

    if (!file || chunkIndex === undefined || totalChunks === undefined) {
        return res.status(400).send({ success: false, message: 'Invalid request parameters' });
    }

    const chunkFilePath = path.join(__dirname, `../uploads/${tenantId}-chunk-${chunkIndex}`);
    fs.renameSync(file.path, chunkFilePath);

    if (parseInt(chunkIndex) === parseInt(totalChunks) - 1) {
        // All chunks uploaded, assemble the file
        const sessionFilePath = path.join(__dirname, `../uploads/session-${tenantId}.zip`);
        const writeStream = fs.createWriteStream(sessionFilePath);

        for (let i = 0; i < totalChunks; i++) {
            const chunkPath = path.join(__dirname, `../uploads/${tenantId}-chunk-${i}`);
            const data = fs.readFileSync(chunkPath);
            writeStream.write(data);
            fs.unlinkSync(chunkPath); // Remove chunk after writing
        }

        writeStream.end();

        writeStream.on('finish', async () => {
            try {
                const sessionFile = fs.readFileSync(sessionFilePath);

                // Save session file to database
                await saveSessionToDatabase(tenantId, sessionFile);

                // Remove the assembled file after processing
                fs.unlinkSync(sessionFilePath);

                res.send({ success: true, message: 'Session file uploaded and saved successfully' });
            } catch (error) {
                console.error('Error uploading session file:', error);
                res.status(500).send({ success: false, message: 'Failed to upload and save session file', error: error.message });
            }
        });

        writeStream.on('error', (err) => {
            console.error('Error assembling session file:', err);
            res.status(500).send({ success: false, message: 'Failed to assemble session file', error: err.message });
        });
    } else {
        res.send({ success: true, message: `Chunk ${chunkIndex} uploaded successfully` });
    }
});

// Lock object to prevent concurrent saves
const uploadLocks = new Map();

// Function to process and save session file
async function processAndSaveSession(tenantId, sessionFilePath) {
    try {
        const sessionFile = fs.readFileSync(sessionFilePath);

        // Save session file to database
        await saveSessionToDatabase(tenantId, sessionFile);

        // Remove the assembled file after processing
        fs.unlinkSync(sessionFilePath);

        console.log(`Session file for tenantId ${tenantId} uploaded and saved successfully`);
    } catch (error) {
        console.error(`Error uploading session file for tenantId ${tenantId}:`, error);
    }
}

// Endpoint to upload and save client session file in chunks with upload ID
router.post('/upload-session-chunk/:tenantId/:uploadId', authMiddleware, upload.single('sessionChunk'), async (req, res) => {
    const { tenantId, uploadId } = req.params;
    const { chunkIndex, totalChunks } = req.body;
    const file = req.file;

    if (!file || chunkIndex === undefined || totalChunks === undefined) {
        return res.status(400).send({ success: false, message: 'Invalid request parameters' });
    }

    const chunkFilePath = path.join(__dirname, `../uploads/${tenantId}-${uploadId}-chunk-${chunkIndex}`);
    fs.renameSync(file.path, chunkFilePath);

    if (parseInt(chunkIndex) === parseInt(totalChunks) - 1) {
        // All chunks uploaded, assemble the file
        const sessionFilePath = path.join(__dirname, `../uploads/session-${tenantId}-${uploadId}.zip`);
        const writeStream = fs.createWriteStream(sessionFilePath);

        for (let i = 0; i < totalChunks; i++) {
            const chunkPath = path.join(__dirname, `../uploads/${tenantId}-${uploadId}-chunk-${i}`);
            const data = fs.readFileSync(chunkPath);
            writeStream.write(data);
            fs.unlinkSync(chunkPath); // Remove chunk after writing
        }

        writeStream.end();

        writeStream.on('finish', async () => {
            // Ensure only one save operation per tenant at a time
            if (!uploadLocks.has(tenantId)) {
                uploadLocks.set(tenantId, []);
            }

            const lockQueue = uploadLocks.get(tenantId);
            lockQueue.push(() => processAndSaveSession(tenantId, sessionFilePath));

            if (lockQueue.length === 1) {
                // Start processing the queue
                while (lockQueue.length > 0) {
                    const task = lockQueue.shift();
                    await task();
                }
                uploadLocks.delete(tenantId);
            }

            res.send({ success: true, message: 'Session file uploaded and will be processed' });
        });

        writeStream.on('error', (err) => {
            console.error('Error assembling session file:', err);
            res.status(500).send({ success: false, message: 'Failed to assemble session file', error: err.message });
        });
    } else {
        res.send({ success: true, message: `Chunk ${chunkIndex} uploaded successfully` });
    }
});

// Add a new endpoint to check initialization status
router.get('/initialization-status/:tenantId', async (req, res) => {
    const { tenantId } = req.params;
    
    try {
        const isInitializing = clientManager.initializingClients.has(tenantId.toString());
        const client = clientManager.clients.get(tenantId.toString());
        const clientInfo = client ? {
            hasClient: true,
            isReady: !!client.info,
            state: client.state || 'unknown'
        } : {
            hasClient: false
        };
        
        res.status(200).json({
            tenantId,
            isInitializing,
            clientInfo,
            lastError: clientManager.lastInitErrors?.get(tenantId.toString())
        });
    } catch (error) {
        console.error(`Error getting initialization status: ${error.message}`);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// Add endpoint to force reset a stuck client
router.post('/reset-client/:tenantId', authMiddleware, async (req, res) => {
    const { tenantId } = req.params;
    
    try {
        await clientManager.killZombieBrowsers();
        clientManager.initializingClients.delete(tenantId.toString());
        
        if (clientManager.clients.has(tenantId.toString())) {
            const client = clientManager.clients.get(tenantId.toString());
            try {
                await client.destroy();
            } catch (e) {
                console.error(`Error destroying client: ${e.message}`);
            }
            clientManager.clients.delete(tenantId.toString());
        }
        
        res.status(200).json({
            success: true,
            message: 'Client reset successfully. You can now try to initialize it again.'
        });
    } catch (error) {
        console.error(`Error resetting client: ${error.message}`);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

module.exports = router;
