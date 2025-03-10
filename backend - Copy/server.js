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
app.use('/messages', messageRoutes);
app.use('/notifications', notificationRoutes);
app.use('/monitor', monitorRoutes);
app.use('/admin', adminRoutes);
app.use('/tenant', tenantRoutes);
app.use('/whatsapp', whatsappRoutes);
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
        await db.sequelize.sync();
        await clientManager.checkForUpdates();
        await clientManager.reinitializeClients();

        setInterval(async () => {
            await clientManager.checkConnectivity();
        }, 600000); // Check connectivity every 10 minutes

        setInterval(async () => {
            await clientManager.checkClientStatus();
        }, 300000); // Check client status every 5 minutes

        setInterval(async () => {
            await clientManager.checkSessionStatus();
        }, 300000); // Check session status every 5 minutes
    } catch (error) {
        console.error('Error during initialization:', error);
    }
})();

// Quick endpoint to send a message
app.get('/send-message', authMiddleware, async (req, res) => {
    const { number, message, tenant_id } = req.query;

    if (!number || !message || !tenant_id) {
        return res.status(400).send('يجب توفير رقم الهاتف والرسالة ومعرف المستأجر.');
    }

    try {
        await clientManager.sendMessage(tenant_id, number, message);
        res.send('تم إرسال الرسالة بنجاح.');
    } catch (error) {
        console.error('خطأ في إرسال الرسالة:', error);
        res.status(500).send('فشل في إرسال الرسالة.');
    }
});

// Server Listen
const PORT = 4001;
server.listen(PORT, () => {
    logger.info(`Server running on http://localhost:${PORT}`);
});