const mongoose = require('mongoose');

class MongoStore {
    constructor({ mongoose, collectionName }) {
        this.mongoose = mongoose;
        this.collection = this.mongoose.connection.collection(collectionName);
    }

    async save({ session, data }) {
        try {
            await this.collection.updateOne(
                { session },
                { $set: { data } },
                { upsert: true }
            );
            console.log(`Session data saved to MongoDB for session: ${session}`);
        } catch (error) {
            console.error(`Error saving session data to MongoDB for session: ${session}. Error: ${error.message}`);
            throw error;
        }
    }

    async sessionExists(session) {
        try {
            const count = await this.collection.countDocuments({ session });
            return count > 0;
        } catch (error) {
            console.error(`Error checking session existence in MongoDB for session: ${session}. Error: ${error.message}`);
            throw error;
        }
    }

    async delete(session) {
        try {
            await this.collection.deleteOne({ session });
            console.log(`Session data deleted from MongoDB for session: ${session}`);
        } catch (error) {
            console.error(`Error deleting session data from MongoDB for session: ${session}. Error: ${error.message}`);
            throw error;
        }
    }
}

module.exports = MongoStore;
