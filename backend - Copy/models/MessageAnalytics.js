const { DataTypes } = require('sequelize');
const db = require('../db'); // Import the entire db module to verify its contents

// Log to verify the contents of the db module
//console.log('DB module in MessageAnalytics:', db);

const { sequelize } = db; // Destructure sequelize from the db module

// Log to verify sequelize import
//console.log('Sequelize imported in MessageAnalytics:', sequelize);

const Tenant = require('./Tenant');

const MessageAnalytics = sequelize.define('MessageAnalytics', {
    tenantId: { type: DataTypes.INTEGER, allowNull: false },
    messageCount: { type: DataTypes.INTEGER, allowNull: false },
});

// Associations
MessageAnalytics.belongsTo(Tenant, { foreignKey: 'tenantId' });

module.exports = MessageAnalytics;
