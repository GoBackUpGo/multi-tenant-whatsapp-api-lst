const { Sequelize, DataTypes } = require('sequelize');
const bcrypt = require('bcrypt');
const crypto = require('crypto');

// Log to verify sequelize initialization
console.log('Initializing Sequelize...');

// Connect to SQL Server
const sequelize = new Sequelize('WhatsappApi', 'sa', 'W$SerVr@Pi2025', {
    host: 'TOOLSSRV\\WSAPISERVER',
    port: 53678, // Make sure this matches your SQL Server configuration
    dialect: 'mssql',
    logging: false,
    timezone: '+03:00', // ��� ������� ������� �������� (����� ������� �������)
    dialectOptions: {
        options: {
            encrypt: false,
            trustServerCertificate: false // Use if necessary for your server's certificate
        }
    }
});

// Define models
const Tenant = sequelize.define('Tenant', {
    name: { type: DataTypes.STRING, allowNull: false },
    apiKey: { type: DataTypes.STRING, allowNull: false }
});

Tenant.prototype.generateApiKey = function() {
    this.apiKey = crypto.randomBytes(20).toString('hex');
};

Tenant.beforeCreate((tenant) => {
    tenant.generateApiKey();
});

const User = sequelize.define('User', {
    username: { type: DataTypes.STRING, allowNull: false },
    passwordHash: { type: DataTypes.STRING, allowNull: false },
    hashPassword: { type: DataTypes.STRING, allowNull: false },
    tenantId: { type: DataTypes.INTEGER, allowNull: false },
});

const Admin = sequelize.define('Admin', {
    username: { type: DataTypes.STRING, allowNull: false, unique: true }, // Correctly define UNIQUE constraint
    passwordHash: { type: DataTypes.STRING, allowNull: false },
});

const Message = sequelize.define('Message', {
    userId: { type: DataTypes.INTEGER, allowNull: true },
    tenantId: { type: DataTypes.INTEGER, allowNull: false },
    phoneNumber: { type: DataTypes.STRING, allowNull: false },
    message: { type: DataTypes.TEXT, allowNull: false },
    createdAt: { type: DataTypes.DATE, allowNull: true, defaultValue: DataTypes.NOW },
    updatedAt: { type: DataTypes.DATE, allowNull: true, defaultValue: DataTypes.NOW },
    msgId: { type: DataTypes.INTEGER, allowNull: true }, // Define primary key and auto-increment
    attachPath: { type: DataTypes.STRING, allowNull: true }, // Allow NULL for attachmentPath
    attachType: { type: DataTypes.STRING, allowNull: true }, // Allow NULL for attachType    
    attachName: { type: DataTypes.STRING, allowNull: true }, // Allow NULL for attachName    
    attachfile: { type: DataTypes.BLOB('long'), allowNull: true }, // Allow NULL for attachfile 
    machineName: { type: DataTypes.STRING, allowNull: true },
    docType: { type: DataTypes.INTEGER, allowNull: true }, // Allow NULL for docType
    docSrl: { type: DataTypes.BIGINT, allowNull: true }, // Allow NULL for docSrl
    cmpNo: { type: DataTypes.INTEGER, allowNull: true }, // Allow NULL for cmpNo
    brnNo: { type: DataTypes.INTEGER, allowNull: true }, // Allow NULL for brnNo
    brnUsr: { type: DataTypes.INTEGER, allowNull: true }, // Allow NULL for brnUsr
    brnYear: { type: DataTypes.INTEGER, allowNull: true }, // Allow NULL for brnYear
    adUsrId: { type: DataTypes.INTEGER, allowNull: true }, // Allow NULL for adUsrId
    // ... الحقول الحالية ...
    templateName: { type: DataTypes.STRING, allowNull: true },
    templateParams: { type: DataTypes.TEXT, allowNull: true },
    interactiveData: { type: DataTypes.TEXT, allowNull: true },
    mediaId: { type: DataTypes.STRING, allowNull: true },
    status: {
        type: DataTypes.ENUM('sent', 'delivered', 'read', 'failed'),
        defaultValue: 'sent'
    },
    direction: { type:  DataTypes.STRING, allowNull: true },
    whatsappMessageId: { type: DataTypes.STRING, allowNull: true },
    whatsappGroupId: { type: DataTypes.STRING, allowNull: true },
    whatsappGroupMessageId: { type: DataTypes.STRING, allowNull: true },
    timestamp: { type: DataTypes.DATE, allowNull: true },
});

const Session = sequelize.define('Session', {
    id: { type: DataTypes.STRING, allowNull: false, primaryKey: true },
    tenantId: { type: DataTypes.STRING, allowNull: false },
    sessionName: { type: DataTypes.TEXT, allowNull: true },
    sessionData: { type: DataTypes.TEXT, allowNull: true },
    sessionFilePath: { type: DataTypes.STRING, allowNull: true },
    deviceInfo: { type: DataTypes.STRING, allowNull: true },
    createdAt: { type: DataTypes.DATE, allowNull: true, defaultValue: DataTypes.NOW },
    updatedAt: { type: DataTypes.DATE, allowNull: true, defaultValue: DataTypes.NOW }
});

// Define associations
Tenant.hasMany(User, { foreignKey: 'tenantId' });
Tenant.hasMany(Message, { foreignKey: 'tenantId' });
User.belongsTo(Tenant, { foreignKey: 'tenantId' });
Message.belongsTo(User, { foreignKey: 'userId' });
Message.belongsTo(Tenant, { foreignKey: 'tenantId' });

// Ensure tables are created if they do not exist
async function seedDefaultData() {
    const [defaultTenant] = await Tenant.findOrCreate({
        where: { name: 'Default Tenant' },
        defaults: { apiKey: 'default-api-key' }
    });

    const adminPasswordHash = await bcrypt.hash('pass123', 10);
    await User.findOrCreate({
        where: { username: 'admin' },
        defaults: { passwordHash: adminPasswordHash, tenantId: defaultTenant.id }
    });

    await Admin.findOrCreate({
        where: { username: 'admin' },
        defaults: { passwordHash: adminPasswordHash }
    });
}

module.exports = {
    sequelize, // Ensure sequelize is exported here
    seedDefaultData, // Export seedDefaultData function
    Tenant,
    User,
    Admin,
    Message,
    Session
};

// Ensure tables are created if they do not exist and seed default data
sequelize.sync({ alter: true }).then(() => {
    console.log('Database synchronized.');
    seedDefaultData();
}).catch((error) => {
    console.error('Error synchronizing database:', error);
});
