const { DataTypes } = require('sequelize');
const sequelize = require('../db').sequelize; // Ensure correct import of sequelize instance

const Session = sequelize.define('Session', {
    id: {
        type: DataTypes.STRING,
        allowNull: false,
        primaryKey: true
    },
    tenantId: {
        type: DataTypes.STRING,
        allowNull: false
    },
    sessionName: {
        type: DataTypes.TEXT,
        allowNull: true
    },
    sessionData: {
        type: DataTypes.TEXT,
        allowNull: true
    },
    sessionFilePath: {
        type: DataTypes.STRING,
        allowNull: true
    },
    deviceInfo: {
        type: DataTypes.STRING,
        allowNull: true
    },
    createdAt: {
        type: DataTypes.DATE,
        allowNull: true,
        defaultValue: DataTypes.NOW
    },
    updatedAt: {
        type: DataTypes.DATE,
        allowNull: true,
        defaultValue: DataTypes.NOW
    }
});

module.exports = Session;
