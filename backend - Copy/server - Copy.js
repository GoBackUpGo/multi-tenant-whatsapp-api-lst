const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const cors = require('cors');

const db = require('./db');
const logger = require('./logger');
const clientManager = require('./whatsappClientManager');

const authRoutes = require('./routes/auth');
const messageRoutes = require('./routes/message');
const notificationRoutes = require('./routes/notification');
const monitorRoutes = require('./routes/monitor');
const adminRoutes = require('./routes/admin');
const tenantRoutes = require('./routes/tenant');
const whatsappRoutes = require('./routes/whatsapp');
const authMiddleware = require('./middleware/auth');

const app = express();
const server = http.createServer(app);
const io = socketIo(server, { cors: { origin: '*' } });

app.use(cors());
app.use(express.json());

// Increase the maximum number of listeners for the process object
process.setMaxListeners(20);

// Routes
app.use('/auth', authRoutes);
app.use('/messages', messageRoutes); // Ensure this line is present
app.use('/notifications', notificationRoutes);
app.use('/monitor', monitorRoutes);
app.use('/admin', adminRoutes);
app.use('/tenant', tenantRoutes); // Corrected route mounting
app.use('/whatsapp', whatsappRoutes); // Ensure this line is present
app.use(authMiddleware);

// WebSocket for Monitoring Dashboard
io.on('connection', (socket) => {
    logger.info('WebSocket connected');
    socket.on('request-monitoring-data', async () => {
        const monitoringData = await clientManager.getMonitoringData();
        socket.emit('monitoring-data', monitoringData);
    });
});

// Reinitialize WhatsApp Clients on Startup
(async () => {
    try {
        // Log to verify database synchronization
        console.log('Synchronizing database...');
        await db.sequelize.sync(); // Ensure tables are created
        console.log('Database synchronized.');

        // Log to verify client reinitialization
        console.log('Reinitializing WhatsApp clients...');
        await clientManager.reinitializeClients();
        console.log('WhatsApp clients reinitialized.');

        // Log to verify update check
        console.log('Checking for updates...');
        await clientManager.checkForUpdates();
        console.log('Updates checked.');

        setInterval(async () => {
            console.log('Checking connectivity...');
            await clientManager.checkConnectivity();
            console.log('Connectivity checked.');
        }, 600000); // Check connectivity every 10 minutes

        setInterval(async () => {
            console.log('Checking client status...');
            await clientManager.checkClientStatus();
            console.log('Client status checked.');
        }, 300000); // Check client status every 5 minutes

        setInterval(async () => {
            console.log('Checking session status...');
            await clientManager.checkSessionStatus();
            console.log('Session status checked.');
        }, 300000); // Check session status every 5 minutes
    } catch (error) {
        console.error('Error during initialization:', error);
    }
})();

// Quick endpoint to send a message
app.get('/send-message', authMiddleware, async (req, res) => { // Add authMiddleware here
    const { number, message, tenant_id } = req.query;

    if (!number || !message || !tenant_id) {
        return res.status(400).send('يجب توفير رقم الهاتف والرسالة ومعرف المستأجر.');
    }

    try {
        // Check client status
        let client = clientManager.getClient(tenant_id);
        if (client && client.info) {
            // Client is ready, send the message directly
            const chatId = `${number}@c.us`; // Format the phone number
            await client.sendMessage(chatId, message);
            return res.send('تم إرسال الرسالة بنجاح.');
        } else {
            // Client is not ready, restore session from the database
            await clientManager.restoreSessionFromDatabase(tenant_id);

            // Reinitialize the client using the restored session
            await clientManager.initializeClient(tenant_id);

            // Wait until the client is ready
            client = clientManager.getClient(tenant_id);
            client.on('ready', async () => {
                const chatId = `${number}@c.us`; // Format the phone number
                await client.sendMessage(chatId, message);
                res.send('تم إرسال الرسالة بنجاح.');
            });
        }
    } catch (error) {
        console.error('خطأ في إرسال الرسالة:', error);
        res.status(500).send('فشل في إرسال الرسالة.');
    }
});

// Server Listen
const PORT = 4000;
server.listen(PORT, () => {
    logger.info(`Server running on http://localhost:${PORT}`);
});
