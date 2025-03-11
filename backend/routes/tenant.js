const express = require('express');
const mysql = require('mysql2');
const router = express.Router();
const Tenant = require('../models/Tenant');
const authMiddleware = require('../middleware/auth');

// إعدادات قاعدة البيانات
const pool = mysql.createPool({
    host: 'localhost',
    user: 'root',
    password: '',
    database: 'WsAppBot',
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0
  });

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

// نقطة وصول لمعرفة عدد الأجهزة المتبقية للعميل
router.get('/devices-remaining', authMiddleware, async (req, res) => {
    const clientId = req.user.tenantId;
    console.log('clientId:',clientId);
    const query = `
      SELECT s.device_limit, COUNT(cd.id) AS used_devices
      FROM subscriptions s
      LEFT JOIN client_devices cd ON s.client_id = cd.client_id
      WHERE s.client_id = ?
      GROUP BY s.client_id;
    `;
  
    pool.query(query, [clientId], (err, results) => {
      if (err) {
        return res.status(500).json({ error: err.message });
      }
  
      if (results.length === 0) {
        return res.status(404).json({ message: 'Client not found or no subscription available.' });
      }

      const remainingDevices = results[0].device_limit - results[0].used_devices;
      res.send({ remaining_devices: remainingDevices });
    });
  });
  
  // نقطة وصول لإضافة جهاز جديد للعميل مع فحص الأجهزة المتبقية
  router.post('/add-device', authMiddleware, async (req, res) => {
    const clientId = req.user.tenantId;
    console.log('start add device for client id:', clientId);
    const { device_name, device_serial, device_info, description } = req.body;

    try {
        // التحقق من عدد الأجهزة المتبقية
        const checkSubscriptionQuery = `
            SELECT s.device_limit, COUNT(cd.id) AS used_devices
            FROM subscriptions s
            LEFT JOIN client_devices cd ON s.client_id = cd.client_id
            WHERE s.client_id = ?
            GROUP BY s.client_id;
        `;

        const [subscriptionResults] = await pool.promise().query(checkSubscriptionQuery, [clientId]);

        if (subscriptionResults.length === 0) {
            console.info('Client not found or no subscription available.');
            return res.status(404).json({ message: 'Client not found or no subscription available.', deviceId: 0 });
        }

        const remainingDevices = subscriptionResults[0].device_limit - subscriptionResults[0].used_devices;

        if (remainingDevices <= 0) {
            console.info('No remaining devices allowed for this client.');
            return res.status(400).json({ message: 'No remaining devices allowed for this client.', deviceId: 0 });
        }

        // إضافة الجهاز الجديد
        const insertDeviceQuery = `
            INSERT INTO client_devices (device_name, device_serial, device_info, description, client_id)
            VALUES (?, ?, ?, ?, ?);
        `;

        const [insertResults] = await pool.promise().query(insertDeviceQuery, [
            device_name,
            device_serial,
            device_info,
            description,
            clientId
        ]);

        res.status(201).send({ message: 'Device added successfully.', deviceId: insertResults.insertId });
    } catch (error) {
        console.error('Error adding device:', error);
        res.status(500).send({ error: error.message, deviceId: 0 });
    }
});
  
  // نقطة وصول لفحص اشتراك العميل وحالة الاشتراك
  router.get('/subscription-status', authMiddleware, async (req, res) => {
    const clientId = req.user.tenantId;
  
    const query = `
      SELECT status, expire_date, DATEDIFF(expire_date, NOW()) AS days_remaining
      FROM subscriptions
      WHERE client_id = ?;
    `;
  
    pool.query(query, [clientId], (err, results) => {
      if (err) {
        return res.status(500).json({ error: err.message });
      }
  
      if (results.length === 0) {
        return res.status(404).json({ message: 'Client not found or no subscription available.' });
      }
  
      const subscription = results[0];
      const isActive = subscription.status === 1 && subscription.days_remaining > 0;
  
      res.send({
        status: subscription.status,
        days_remaining: subscription.days_remaining,
        is_active: isActive
      });
    });
  });
// نقطة وصول للتحقق من وجود جهاز مسبقًا باستخدام device_serial
router.get('/check-device/:deviceSerial', authMiddleware, async (req, res) => {
    const deviceSerial = req.params.deviceSerial;
    console.log('deviceSerial:',deviceSerial);
    
    const query = `
      SELECT id, device_name, client_id, created_at
      FROM client_devices
      WHERE device_serial = ?;
    `;
  
    pool.query(query, [deviceSerial], (err, results) => {
      if (err) {
        return res.status(500).json({ error: err.message });
      }
  
      if (results.length > 0) {
        const device = results[0];
        return res.send({
          exists: true,
          message: 'Device already exists.',
          device: {
            id: device.id,
            device_name: device.device_name,
            client_id: device.client_id,
            created_at: device.created_at
          }
        });
      } else {
        return res.send({
          exists: false,
          message: 'Device does not exist.'
        });
      }
    });
  });

module.exports = router;
