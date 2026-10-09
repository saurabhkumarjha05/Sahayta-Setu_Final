const { sendSMS } = require('./sms');

const LEVEL_COLORS = { Low: 'green', Moderate: 'yellow', High: 'orange', Severe: 'red' };

const LEVEL_ACTIONS = {
  Low: 'No action needed.',
  Moderate: 'Be aware and stay updated.',
  High: 'Be prepared to move to a safe place.',
  Severe: 'Move to the nearest shelter now.'
};

// Builds the alert text, e.g.
// "[RED ALERT] Flood/landslide risk is SEVERE in Brahmavar, Udupi. Move to the nearest shelter now."
function buildAlertMessage({ village, district, riskLevel }) {
  const place = [village, district].filter(Boolean).join(', ');
  const color = LEVEL_COLORS[riskLevel].toUpperCase();
  return `[${color} ALERT] Flood/landslide risk is ${riskLevel.toUpperCase()} in ${place}. ${LEVEL_ACTIONS[riskLevel]}`;
}

// Sends SMS only if the switch in .env is "true". Otherwise it's simulated.
//   SMS_ENABLED=true      -> danger alerts go out by SMS
//   OTP_SMS_ENABLED=true  -> login codes go out by SMS (otherwise shown on screen)
// They are separate so alerts can be live while demo logins still work for
// numbers a Twilio trial account can't text.
async function deliverSMS(phones, message, switchName = 'SMS_ENABLED') {
  if (process.env[switchName] !== 'true') {
    return { mode: 'simulated', sent: 0, failed: 0 };
  }

  let sent = 0;
  let failed = 0;
  for (const phone of phones) {
    try {
      await sendSMS(phone, message);
      sent++;
    } catch (err) {
      failed++;
      console.error(`SMS to ${phone} failed:`, err.message);
    }
  }
  return { mode: 'live', sent, failed };
}

module.exports = { LEVEL_COLORS, buildAlertMessage, deliverSMS };