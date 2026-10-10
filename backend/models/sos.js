const mongoose = require('mongoose');

const sosSchema = new mongoose.Schema({
  _id: { type: String, default: () => new mongoose.Types.ObjectId().toString() },
  location: {
    lat: Number,
    lng: Number
  },
  village: String,
  district: String,
  state: String,
  stateCode: { type: String, default: null },
  districtCode: { type: String, default: null },
  clientIncidentId: { type: String, unique: true, sparse: true, index: true },
  deviceId: String,
  locationAccuracy: Number,
  locationSource: {
    type: String,
    enum: ['GPS_EXACT', 'LAST_KNOWN', 'MAP_SELECTED', 'DISTRICT_FALLBACK'],
    default: 'GPS_EXACT'
  },
  isApproximateLocation: { type: Boolean, default: false },
  priority: {
    type: String,
    enum: ['LOW', 'MODERATE', 'MEDIUM', 'HIGH', 'SEVERE', 'CRITICAL'],
    default: 'HIGH'
  },
  aiAssessment: {
    level: { type: String, enum: ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW'] },
    score: { type: Number, min: 0 },
    explanation: { type: String, default: '' },
    urgentNeeds: [{ type: String }],
    assessedAt: { type: Date, default: Date.now },
    advisoryOnly: { type: Boolean, default: true }
  },
  description: String,
  type: {
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
      'Medical',
      'Medical Emergency',
      'Missing Person',
      'Evacuation',
      'Other'
    ],
    default: 'Medical'
  },
  status: { type: String, enum: ['Pending', 'Assigned', 'In Progress', 'Resolved'], default: 'Pending' },
  timestamp: { type: Date, default: Date.now },
  createdAt: { type: Date, default: Date.now },
  receivedAt: { type: Date, default: Date.now },
  sourceChannel: {
    type: String,
    enum: ['DIRECT_INTERNET', 'SMS_FALLBACK', 'PEER_RELAY', 'PANCHAYAT_LOCAL_NODE'],
    default: 'DIRECT_INTERNET'
  },
  isLite: { type: Boolean, default: false },
  detailsSynced: { type: Boolean, default: false },
  detailsSyncedAt: { type: Date, default: null },
  vulnerableCount: { type: Number, default: 0 },
  needsMedical: { type: Boolean, default: false },
  signature: String,
  hopCount: { type: Number, default: 0 },
  relayDeviceId: String,

  // Triage by Panchayat / Local Authority Control Centre
  requiredCapabilities: [{
    type: String,
    enum: [
      'Medical',
      'First Aid',
      'Flood Rescue',
      'Boat Rescue',
      'Search & Rescue',
      'Fire Response',
      'Evacuation',
      'Relief Distribution',
      'Shelter Support',
      'Transport'
    ]
  }],
  peopleAffected: { type: Number, default: 1 },
  triageNotes: { type: String, default: null },
  triagedBy: {
    id: String,
    name: String,
    role: String
  },
  triagedAt: { type: Date, default: null },
  isTriageComplete: { type: Boolean, default: false },

  // Responder handling and live tracking
  assignedTo: { type: mongoose.Schema.Types.ObjectId, ref: 'NGO', default: null },
  assignedAt: { type: Date, default: null },
  resolvedAt: { type: Date, default: null },
  responderLocation: {
    lat: Number,
    lng: Number,
    updatedAt: Date
  },
  responderDistanceKm: Number,

  // Reporter details
  reportedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  contactName: { type: String, default: null },
  contactPhone: { type: String, default: null }
});

sosSchema.index({ district: 1, state: 1, status: 1 });

module.exports = mongoose.model('SOS', sosSchema);