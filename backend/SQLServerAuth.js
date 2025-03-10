const sql = require('mssql');
const { v4: uuidv4 } = require('uuid');
const os = require('os');
const fs = require('fs-extra'); // Use fs-extra instead of fs
const path = require('path');
const { promisify } = require('util');
const archiver = require('archiver');
const unzipper = require('unzipper');
const { exec } = require('child_process');
const logger = require('./logger');

async function setWindowsPermissions(path) {
    return new Promise((resolve, reject) => {
        exec(`icacls "${path}" /grant Everyone:F /T`, (error) => {
            if (error) {
                logger.error(`Permission Error: ${error.message}`);
                reject(error);
            } else {
                resolve();
            }
        });
    });
}

const config = {
    user: 'sa',
    password: 'W$SerVr@Pi2025',
    server: 'TOOLSSRV\\WSAPISERVER',
    database: 'WhatsappApi',
    options: {
        encrypt: false,
        trustServerCertificate: false
    }
};

async function zipFolder(sourceDir, zipFilePath) {
    return new Promise((resolve, reject) => {
        if (!fs.existsSync(sourceDir)) {
            return reject(new Error(`Directory does not exist: ${sourceDir}`));
        }

        const output = fs.createWriteStream(zipFilePath);
        const archive = archiver('zip', { zlib: { level: 9 } });

        output.on('close', () => {
            console.log(`Zipped folder to: ${zipFilePath}`);
            resolve();
        });

        output.on('error', (err) => {
            console.error(`Error writing zip file: ${err.message}`);
            reject(err);
        });

        archive.on('error', (err) => {
            console.error(`Error creating archive: ${err.message}`);
            reject(err);
        });

        archive.pipe(output);
        archive.directory(sourceDir, false);
        archive.finalize();
    });
}

async function unzipFolder(zipFilePath, targetDir) {
    return new Promise((resolve, reject) => {
        fs.createReadStream(zipFilePath)
            .pipe(unzipper.Extract({ path: targetDir }))
            .on('close', () => {
                console.log(`Unzipped file to: ${targetDir}`);
                resolve();
            })
            .on('error', (err) => {
                reject(err);
            });
    });
}

async function safeReadFileWithRetry(filePath, retries = 5, delay = 1000) {
    for (let i = 0; i < retries; i++) {
        try {
            const data = await fs.readFile(filePath);
            return data;
        } catch (error) {
            if (error.code === 'EBUSY' || error.code === 'EPERM') {
                console.warn(`File is busy or permission denied, retrying... (${i + 1}/${retries})`);
                await new Promise(resolve => setTimeout(resolve, delay));
            } else {
                console.error(error);
                throw error;
            }
        }
    }
    console.error(`Failed to read file after ${retries} attempts.`);
    throw new Error(`Failed to read file after ${retries} attempts.`);
}

async function safeCopyFileWithRetry(src, dest, retries = 5, delay = 1000) {
    for (let i = 0; i < retries; i++) {
        try {
            await fs.copy(src, dest);
            return;
        } catch (error) {
            if (error.code === 'EBUSY' || error.code === 'EPERM') {
                console.warn(`File is busy or permission denied, retrying... (${i + 1}/${retries})`);
                await new Promise(resolve => setTimeout(resolve, delay));
            } else {
                console.error(error);
                throw error;
            }
        }
    }
    console.error(`Failed to copy file after ${retries} attempts.`);
    throw new Error(`Failed to copy file after ${retries} attempts.`);
}

async function safeRemoveFileWithRetry(filePath, retries = 10, delay = 5000) {
    for (let i = 0; i < retries; i++) {
        try {
            await fs.remove(filePath);
            return;
        } catch (error) {
            if (error.code === 'EBUSY' || error.code === 'EPERM' || error.code === 'ENOTEMPTY') {
                console.warn(`File is busy, permission denied, or directory not empty, retrying... (${i + 1}/${retries})`);
                await new Promise(resolve => setTimeout(resolve, delay* (i + 1)));
            } else {
                console.error(error);
                throw error;
            }
        }
    }
    console.error(`Failed to remove file after ${retries} attempts.`);
    throw new Error(`Failed to remove file after ${retries} attempts.`);
}

async function saveSessionToDatabase(tenantId, sessionFileData = null) {
    const sessionFolderPath = path.join(__dirname, '.wwebjs_auth', `session-${tenantId}`);
    const tempFolderPath = path.join(__dirname, 'temp', `session-${tenantId}`);
    const zipFilePath = path.join(__dirname,'temp', `session-${tenantId}.zip`);

    let pool;
    try {
        if (!sessionFileData) {
            await safeCopyFileWithRetry(sessionFolderPath, tempFolderPath);
            await zipFolder(tempFolderPath, zipFilePath);
            sessionFileData = await safeReadFileWithRetry(zipFilePath);

            if (!sessionFileData) {
                console.error('Failed to read session file.');
                return;
            }
        }

        pool = await sql.connect(config);
        const sessionName = `session-${tenantId}`;
        const deviceInfo = {
            device_name: os.hostname(),
            os: os.type() + ' ' + os.release(),
            platform: os.platform(),
            architecture: os.arch(),
            memory: os.totalmem()
        };

        const checkRequest = pool.request();
        const checkResult = await checkRequest
            .input('tenantId', sql.NVarChar, tenantId)
            .query('SELECT * FROM sessions WHERE tenantId = @tenantId');

        if (checkResult.recordset.length > 0) {
            const updateRequest = pool.request();
            await updateRequest
                .input('tenantId', sql.NVarChar, tenantId)
                .input('sessionData', sql.NVarChar, sessionName)
                .input('sessionFile', sql.VarBinary, sessionFileData)
                .input('deviceInfo', sql.NVarChar, JSON.stringify(deviceInfo))
                .input('updatedAt', sql.DateTime, new Date())
                .query(`
                    UPDATE sessions 
                    SET sessionFile = @sessionFile, updatedAt = @updatedAt, sessionData = @sessionData, deviceInfo = @deviceInfo
                    WHERE tenantId = @tenantId
                `);
        } else {
            const insertRequest = pool.request();
            await insertRequest
                .input('id', sql.NVarChar, uuidv4())
                .input('tenantId', sql.NVarChar, tenantId)
                .input('sessionData', sql.NVarChar, sessionName)
                .input('deviceInfo', sql.NVarChar, JSON.stringify(deviceInfo))
                .input('sessionFile', sql.VarBinary, sessionFileData)
                .input('sessionFilePath', sql.NVarChar, zipFilePath)
                .input('createdAt', sql.DateTime, new Date())
                .input('updatedAt', sql.DateTime, new Date())
                .query(`
                    INSERT INTO sessions 
                    (id, tenantId, sessionFile, sessionFilePath, createdAt, updatedAt, sessionData, deviceInfo) 
                    VALUES (@id, @tenantId, @sessionFile, @sessionFilePath, @createdAt, @updatedAt, @sessionData, @deviceInfo)
                `);
        }

        console.log('Session saved to database successfully.');
    } catch (error) {
        console.error('Failed to save session to database:', error);
    } finally {
        if (pool) {
            await pool.close();
        }
        await safeRemoveFileWithRetry(tempFolderPath);
        await safeRemoveFileWithRetry(zipFilePath);
    }
}

async function restoreSessionFromDatabase(tenantId) {
    const sessionFolderPath = path.join(__dirname, '.wwebjs_auth', `session-${tenantId}`);
    const zipFilePath = path.join(__dirname, `session-${tenantId}.zip`);

    let pool;
    try {
        pool = await sql.connect(config);
        const request = pool.request();
        const result = await request
            .input('tenantId', sql.NVarChar, tenantId)
            .query('SELECT sessionFile FROM sessions WHERE tenantId = @tenantId');

        if (result.recordset.length > 0) {
            
            const sessionFile = result.recordset[0].sessionFile;
            await fs.writeFile(zipFilePath, sessionFile);
            await unzipFolder(zipFilePath, sessionFolderPath);
            console.log(`Session restored to: ${sessionFolderPath}`);
        } else {
            console.log('No saved session found for this tenant.');
        }
    } catch (error) {
        console.error('Failed to restore session from database:', error);
    } finally {
        if (pool) {
            await pool.close();
        }
        await safeRemoveFileWithRetry(zipFilePath);
    }
}

async function getSessionFileFromDatabase(tenantId) {
    let pool;
    try {
        pool = await sql.connect(config);
        const request = pool.request();
        const result = await request
            .input('tenantId', sql.NVarChar, tenantId)
            .query('SELECT sessionFile FROM sessions WHERE tenantId = @tenantId');

        if (result.recordset.length > 0) {
            const sessionFile = result.recordset[0].sessionFile;
            console.log(`Session file retrieved for tenantId: ${tenantId}`);
            return sessionFile;
        } else {
            console.log('No saved session found for this tenant.');
            return null;
        }
    } catch (error) {
        console.error('Failed to retrieve session file from database:', error);
        return null;
    } finally {
        if (pool) {
            await pool.close();
        }
    }
}

module.exports = {
    saveSessionToDatabase,
    restoreSessionFromDatabase,
    getSessionFileFromDatabase
};