const { sequelize } = require('../db');
const { DataTypes } = require('sequelize');

const Tenant = sequelize.define('Tenant', {
    name: { type: DataTypes.STRING, allowNull: false },
    apiKey: { type: DataTypes.STRING, allowNull: false }
});

Tenant.prototype.generateApiKey = function() {
    this.apiKey = require('crypto').randomBytes(16).toString('hex');
};

Tenant.associate = (models) => {
    Tenant.hasMany(models.User, { foreignKey: 'tenantId', as: 'users' });
};

module.exports = Tenant;
