require('dotenv').config();
const { sendSMS } = require('./services/sms');

const to = process.argv[2];
if (!to) {
  console.log('Usage: node test-sms.js +91XXXXXXXXXX');
  process.exit(1);
}

sendSMS(to, 'Test alert from Disaster Management app')
  .then((sid) => console.log('SMS sent! Message ID:', sid))
  .catch((err) => {
    console.error('SMS failed:', err.message, err.code ? `(code ${err.code})` : '');
    process.exit(1);
  });