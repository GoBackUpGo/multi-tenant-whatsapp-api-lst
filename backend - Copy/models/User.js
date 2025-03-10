const { sequelize } = require('../db');
const { DataTypes } = require('sequelize');

const User = sequelize.define('User', {
    username: { type: DataTypes.STRING, allowNull: false},
    passwordHash: { type: DataTypes.STRING, allowNull: false },
    tenantId: { type: DataTypes.INTEGER, allowNull: false }
});

User.associate = (models) => {
    User.belongsTo(models.Tenant, { foreignKey: 'tenantId', as: 'tenant' });
};

module.exports = User;
