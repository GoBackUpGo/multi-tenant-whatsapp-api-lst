const bcrypt = require('bcrypt');
const { User } = require('../db'); // Ensure correct import of User model from db.js

async function seedUser() {
    const username = 'testuser';
    const password = 'password123';
    const tenantId = 1;

    const passwordHash = await bcrypt.hash(password, 10);

    await User.create({ username, passwordHash, tenantId });
    console.log('User seeded successfully');
}

seedUser().catch((error) => {
    console.error('Error seeding user:', error);
});
