const mongoose = require('mongoose');

const riskZoneSchema = new mongoose.Schema({
  village: String,
  lat: Number,
  lng: Number,
  riskLevel: { type: String, enum: ['Low', 'Medium', 'High', 'Critical'] }
});

module.exports = mongoose.model('RiskZone', riskZoneSchema);