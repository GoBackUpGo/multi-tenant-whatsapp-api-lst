const sessionDisconnectedTemplate = (tenantId, phoneNumber) => `
    <h1>WhatsApp Session Disconnected</h1>
    <p>Dear Tenant (ID: ${tenantId}),</p>
    <p>Your WhatsApp session for phone number <strong>${phoneNumber}</strong> has been disconnected. 
    We are attempting to reconnect automatically. You will be notified of the outcome shortly.</p>
    <p>If the reconnection fails, please log in and scan the QR code to reauthenticate.</p>
    <p>Thank you,<br>Multi-Tenant WhatsApp API Team</p>
`;

const reconnectionFailureTemplate = (tenantId, phoneNumber) => `
    <h1>WhatsApp Reconnection Failed</h1>
    <p>Dear Tenant (ID: ${tenantId}),</p>
    <p>We attempted to reconnect your WhatsApp session for phone number <strong>${phoneNumber}</strong> but were unsuccessful.</p>
    <p>Please log in to your dashboard and scan the QR code to reauthenticate.</p>
    <p>Thank you,<br>Multi-Tenant WhatsApp API Team</p>
`;

module.exports = {
    sessionDisconnectedTemplate,
    reconnectionFailureTemplate,
};
