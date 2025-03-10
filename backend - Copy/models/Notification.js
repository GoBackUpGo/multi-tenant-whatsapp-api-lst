const { sequelize } = require('../db'); // Import sequelize from db.js
const { DataTypes } = require('sequelize'); // Import DataTypes from sequelize

const Tenant = require('./Tenant');

// Log to verify sequelize import
//console.log('Sequelize imported in Notification:', sequelize);

const Notification = sequelize.define('Notification', {
    tenantId: { type: DataTypes.INTEGER, allowNull: false },
    message: { type: DataTypes.TEXT, allowNull: false },
    read: { type: DataTypes.BOOLEAN, allowNull: false },
});

// Associations
Notification.belongsTo(Tenant, { foreignKey: 'tenantId' });

module.exports = Notification;
