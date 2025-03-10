const { DataTypes } = require('sequelize');
const sequelize = require('../db').sequelize; // Ensure correct import of sequelize instance

const Auth = sequelize.define('Auth', {
    tenantId: {
        type: DataTypes.STRING,
        allowNull: false,
        primaryKey: true
    },
    phoneNumber: {
        type: DataTypes.STRING,
        allowNull: false
    },
    qrCode: {
        type: DataTypes.TEXT,
        allowNull: true
    },
    sessionData: {
        type: DataTypes.TEXT,
        allowNull: true
    }
});

module.exports = Auth;
