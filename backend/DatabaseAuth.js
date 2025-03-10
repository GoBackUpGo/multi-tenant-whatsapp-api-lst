const SQLServerAuth = require('./SQLServerAuth'); // Import SQLServerAuth
const Session = require('./models/Session');
const Auth = require('./models/Auth'); // Ensure correct import of Auth model
const logger = require('./logger'); // Ensure correct import of logger

class DatabaseAuth {
    constructor(tenantId) {
        this.tenantId = tenantId.toString(); // Ensure tenantId is a string

        this.authStrategy = new SQLServerAuth(this.tenantId);
    }

    async read() {
        try {
            logger.info(`Reading session data for tenantId: ${this.tenantId}`);
            const session = await Session.findOne({ where: { tenantId: this.tenantId } });
            if (session && session.sessionData) {
                logger.info(`Read session data for tenantId: ${this.tenantId}`, session.sessionData);
                return JSON.parse(session.sessionData);
            }
            logger.warn(`No session data found for tenantId: ${this.tenantId}`);
            return null;
        } catch (error) {
            logger.error(`Error reading session data for tenantId: ${this.tenantId}. Error: ${error.message}`);
            throw error;
        }
    }

    async write(data) {
        try {
            if (!data) {
                logger.error(`No session data to write for tenantId: ${this.tenantId}`);
                return;
            }
            const sessionData = JSON.stringify(data);
            logger.info(`Writing session data for tenantId: ${this.tenantId}`, sessionData);
            const session = await Session.findOne({ where: { tenantId: this.tenantId } });
            if (session) {
                await session.update({ sessionData });
            } else {
                await Session.create({ tenantId: this.tenantId, sessionData });
            }
            logger.info(`Session data saved for tenantId: ${this.tenantId}`);
        } catch (error) {
            logger.error(`Error writing session data for tenantId: ${this.tenantId}. Error: ${error.message}`);
            throw error;
        }
    }

    async delete() {
        try {
            logger.info(`Deleting session data for tenantId: ${this.tenantId}`);
            const session = await Session.findOne({ where: { tenantId: this.tenantId } });
            if (session) {
                await session.destroy();
            }
        } catch (error) {
            logger.error(`Error deleting session data for tenantId: ${this.tenantId}. Error: ${error.message}`);
            throw error;
        }
    }

    async extractSession(sessionId) {
        try {
            logger.info(`Extracting session data for sessionId: ${sessionId}`);
            const session = await Session.findOne({ where: { id: sessionId } });
            if (session && session.sessionData) {
                logger.info(`Extracted session data for sessionId: ${sessionId}`, session.sessionData);
                return JSON.parse(session.sessionData);
            }
            logger.warn(`No session data found for sessionId: ${sessionId}`);
            return null;
        } catch (error) {
            logger.error(`Error extracting session data for sessionId: ${sessionId}. Error: ${error.message}`);
            throw error;
        }
    }
}

module.exports = DatabaseAuth;
