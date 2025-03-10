const sessionDisconnectedTemplate = (tenantId, phoneNumber) =>
    `WhatsApp session disconnected for tenant ID ${tenantId} (Phone: ${phoneNumber}). Attempting to reconnect.`;

const reconnectionFailureTemplate = (tenantId, phoneNumber) =>
    `WhatsApp reconnection failed for tenant ID ${tenantId} (Phone: ${phoneNumber}). Please reauthenticate.`;

module.exports = {
    sessionDisconnectedTemplate,
    reconnectionFailureTemplate,
};
