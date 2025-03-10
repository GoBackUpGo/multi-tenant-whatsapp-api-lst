const { sequelize, User, Tenant, Message } = require('../db'); // Import sequelize, User, Tenant, and Message from db.js

// Log to verify sequelize import
//console.log('Sequelize imported in Message:', sequelize);

// Log to verify User and Tenant imports
console.log('User model:', User);
console.log('Tenant model:', Tenant);

// Log to verify Message import
console.log('Message model:', Message);

module.exports = Message;
