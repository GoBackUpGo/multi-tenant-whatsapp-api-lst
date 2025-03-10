const { sequelize } = require('../db');
const { DataTypes } = require('sequelize');

const User = sequelize.define('User', {
    id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: false
    },
    username: { type: DataTypes.STRING, allowNull: false},
    passwordHash: { type: DataTypes.STRING, allowNull: false },
    hashPassword: { type: DataTypes.STRING, allowNull: false },
    tenantId: { type: DataTypes.INTEGER, allowNull: false }
});

User.associate = (models) => {
    User.belongsTo(models.Tenant, { foreignKey: 'tenantId', as: 'tenant' });
};

module.exports = User;
