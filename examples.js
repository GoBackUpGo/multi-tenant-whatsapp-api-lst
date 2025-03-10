const axios = require('axios');
const fs = require('fs');
const path = require('path');
const unzipper = require('unzipper');

// بيانات تسجيل الدخول
const username = 'issa'; // استبدل بـ username الصحيح
const password = '12345'; // استبدل بـ password الصحيح
let token = ''; // سيتم تعيينه بعد تسجيل الدخول
let tenantId = ''; // استبدل بـ tenantId الصحيح

// دالة لتسجيل الدخول وتوليد token
async function login() {
    try {
        const response = await axios.post('http://localhost:4001/auth/login', {
            username,
            password
        });

        token = response.data.token;
        tenantId = response.data.tenantId;
        console.log('Login successful, tenant Id:', tenantId);
        console.log('Login successful, token generated:', token);
    } catch (error) {
        console.error('Failed to login:', error);
    }
}

// دالة لتحميل ملف الجلسة
async function downloadSession() {
    try {
        const response = await axios.get(`http://localhost:4001/whatsapp/download-session/${tenantId}`, {
            headers: {
                Authorization: `Bearer ${token}`
            },
            responseType: 'stream'
        });

        const filePath = path.join(__dirname, `session-${tenantId}.zip`);
        const writer = fs.createWriteStream(filePath);

        response.data.pipe(writer);

        writer.on('finish', () => {
            console.log(`Session file downloaded successfully to ${filePath}`);
        });

        writer.on('error', (err) => {
            console.error('Error downloading session file:', err);
        });
    } catch (error) {
        console.error('Failed to download session file:', error);
    }
}

// دالة للحصول على ملف الجلسة كبيانات ثنائية
async function getSessionBinary() {
    try {
        const response = await axios.get(`http://localhost:4001/whatsapp/get-session-binary/${tenantId}`, {
            headers: {
                Authorization: `Bearer ${token}`
            },
            responseType: 'arraybuffer'
        });

        const filePath = path.join(__dirname, `session-${tenantId}-binary.zip`);
        fs.writeFileSync(filePath, response.data);

        console.log(`Session file (binary) saved successfully to ${filePath}`);
    } catch (error) {
        console.error('Failed to get session file (binary):', error);
    }
}

// دالة لاستخراج ملف الجلسة إلى مجلد .wwebjs_auth
async function extractSession() {
    const zipFilePath = path.join(__dirname, `session-${tenantId}.zip`);
    const extractPath = path.join(__dirname, '.wwebjs_auth', `session-${tenantId}`);

    try {
        await fs.createReadStream(zipFilePath)
            .pipe(unzipper.Extract({ path: extractPath }))
            .promise();

        console.log(`Session extracted successfully to ${extractPath}`);
    } catch (error) {
        console.error('Failed to extract session file:', error);
    }
}

// استدعاء الدوال
async function main() {
    await login();
    await downloadSession();
    await getSessionBinary();
    await extractSession();
}

main();
