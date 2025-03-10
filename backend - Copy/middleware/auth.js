const jwt = require('jsonwebtoken');
const User = require('../models/User');

const JWT_SECRET = process.env.JWT_SECRET || 'your_jwt_secret';

const authMiddleware = async (req, res, next) => {
    const authHeader = req.headers['authorization'];
    if (!authHeader) {
        return res.status(401).send('Authorization token is missing');
    }

    const token = authHeader.split(' ')[1]; // Extract token from "Bearer <token>"
    if (!token) {
        return res.status(401).send('Authorization token is missing');
    }

    try {
        const decoded = jwt.verify(token, JWT_SECRET);
        const user = await User.findByPk(decoded.id);
        if (!user) {
            return res.status(401).send('Invalid token: user not found');
        }

        req.user = user; // Add user to request object
        next();
    } catch (error) {
        console.error('Error verifying token:', error);
        if (error.name === 'TokenExpiredError') {
            return res.status(401).send('Token has expired');
        } else if (error.name === 'JsonWebTokenError') {
            return res.status(401).send('Invalid token');
        } else {
            return res.status(401).send('Failed to authenticate token');
        }
    }
};

module.exports = authMiddleware;
