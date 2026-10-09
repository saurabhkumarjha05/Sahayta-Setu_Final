const twilio = require('twilio');

// Sends one SMS. "to" must look like +91XXXXXXXXXX
async function sendSMS(to, message) {
  const client = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
  const result = await client.messages.create({
    body: message,
    from: process.env.TWILIO_PHONE_NUMBER,
    to
  });
  return result.sid;  // Twilio's ID for this message
}

module.exports = { sendSMS };