const mongoose = require('mongoose');

const alertSchema = new mongoose.Schema({
  title: String,
  targetType: { type: String, enum: ['ALL', 'STATE', 'DISTRICT'], default: 'DISTRICT' },
  village: String,
  district: String,
  state: String,
  stateCode: { type: String, default: null },
  districtCode: { type: String, default: null },
  incidentCategory: {
    type: String,
    enum: [
      'Flood',
      'Flash Flood',
      'Landslide',
      'Earthquake',
      'Fire',
      'Cyclone',
      'Storm',
      'Cloudburst',
      'Lightning',
      'Heatwave',
      'Cold Wave',
      'Building Collapse',
      'Road Accident',
      'Medical Emergency',
      'Missing Person',
      'Evacuation',
      'General Alert'
    ],
    default: 'General Alert'
  },
  riskLevel: { type: String, enum: ['Low', 'Moderate', 'High', 'Severe', 'Critical'], required: true },
  color: String,
  message: { type: String, required: true },
  instruction: { type: String, default: 'Follow official guidance and move to verified shelters if instructed.' },

  // Official Authority Identity
  issuedBy: {
    id: String,
    name: String,
    role: String,
    organizationType: String,
    jurisdiction: { state: String, district: String }
  },

  // Retransmission Lineage
  isRetransmission: { type: Boolean, default: false },
  retransmittedFrom: { type: mongoose.Schema.Types.ObjectId, ref: 'Alert', default: null },
  originalAlertId: { type: String, default: null },
  originalAuthorityId: { type: String, default: null },
  originalAuthorityName: { type: String, default: null },
  originalCreatedAt: { type: Date, default: null },
  retransmittedBy: {
    id: String,
    name: String,
    role: String,
    organizationName: String,
    district: String,
    state: String
  },
  retransmittedAt: { type: Date, default: null },

  status: { type: String, enum: ['ACTIVE', 'EXPIRED', 'REVOKED'], default: 'ACTIVE' },
  recipients: [String],  // phone numbers the SMS is meant for
  sms: {
    mode: { type: String, enum: ['simulated', 'live'], default: 'simulated' },
    sent: { type: Number, default: 0 },
    failed: { type: Number, default: 0 }
  }
}, { timestamps: true });

alertSchema.index({ district: 1, state: 1, createdAt: -1 });

module.exports = mongoose.model('Alert', alertSchema);