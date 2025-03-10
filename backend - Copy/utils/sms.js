const templates = require('./templates/smsTemplates');
const twilio = require('twilio');

const accountSid = 'SK03cd630ae2c76ae3e7e3972eb7dda063';
const authToken = '2enU4gyjzYmTr2XGCY5asVZVb41Zj0rE';
const client = new twilio(accountSid, authToken);

async function sendSMS(to, body) {
    try {
        await client.messages.create({
            body,
            to,
            from: '+447383018921',
        });
        console.log('SMS sent successfully');
    } catch (error) {
        console.error('Error sending SMS:', error);
    }
}

const sendSessionDisconnectedSMS = (recipient, tenantId, phoneNumber) => {
    const message = templates.sessionDisconnectedTemplate(tenantId, phoneNumber);
    sendSMS(recipient, message);
};

const sendReconnectionFailureSMS = (recipient, tenantId, phoneNumber) => {
    const message = templates.reconnectionFailureTemplate(tenantId, phoneNumber);
    sendSMS(recipient, message);
};

module.exports = {
    sendSessionDisconnectedSMS,
    sendReconnectionFailureSMS,
};
