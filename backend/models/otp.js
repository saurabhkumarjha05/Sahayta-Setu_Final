const mongoose = require('mongoose');

const otpSchema = new mongoose.Schema({
  phone: { type: String, required: true },
  codeHash: { type: String, required: true },   // scrambled code, never the real one
  attempts: { type: Number, default: 0 },       // wrong tries so far
  // MongoDB deletes the code automatically once this time has passed
  expiresAt: { type: Date, required: true, index: { expires: 0 } }
});

module.exports = mongoose.model('Otp', otpSchema);