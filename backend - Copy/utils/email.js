const templates = require('./templates/emailTemplates');
const nodemailer = require('nodemailer');

const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
        user: 'your-email@gmail.com',
        pass: 'your-email-password',
    },
});

async function sendEmail(to, subject, text) {
    const mailOptions = {
        from: 'your-email@gmail.com',
        to,
        subject,
        text,
    };

    try {
        await transporter.sendMail(mailOptions);
        console.log('Email sent successfully');
    } catch (error) {
        console.error('Error sending email:', error);
    }
}

const sendSessionDisconnectedEmail = (recipient, tenantId, phoneNumber) => {
    const subject = 'WhatsApp Session Disconnected';
    const html = templates.sessionDisconnectedTemplate(tenantId, phoneNumber);
    sendEmail(recipient, subject, html);
};

const sendReconnectionFailureEmail = (recipient, tenantId, phoneNumber) => {
    const subject = 'WhatsApp Reconnection Failed';
    const html = templates.reconnectionFailureTemplate(tenantId, phoneNumber);
    sendEmail(recipient, subject, html);
};

module.exports = {
    sendSessionDisconnectedEmail,
    sendReconnectionFailureEmail,
};
