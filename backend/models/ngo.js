const mongoose = require('mongoose');

const ngoSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 150 },
    contactPerson: { type: String, trim: true, maxlength: 100 },
    phone: { type: String, required: true, trim: true },
    email: { type: String, trim: true, lowercase: true, maxlength: 254 },
    district: String,
    state: String,
    stateCode: { type: String, default: null, trim: true },
    districtCode: { type: String, default: null, trim: true },
    blockCode: { type: String, default: null, trim: true },
    panchayatId: { type: String, default: null, trim: true },
    registrationNumber: { type: String, default: null, trim: true },
    location: {
      lat: Number,
      lng: Number
    },
    services: [String],
    capabilities: [String],
    available: { type: Boolean, default: true },
    status: { type: String, enum: ['Available', 'Busy', 'Offline'], default: 'Available' },
    resourceType: { type: String, default: 'rescue_team' },
    organizationType: {
      type: String,
      enum: ['NGO', 'VOLUNTEER_TEAM', 'RESCUE_UNIT', 'MEDICAL_CORPS'],
      default: 'NGO'
    },
    verificationStatus: {
      type: String,
      enum: ['PENDING', 'VERIFIED', 'REJECTED', 'SUSPENDED', 'REVOKED'],
      default: 'PENDING'
    },
    verificationLabel: { type: String, default: 'PENDING VERIFICATION' },
    verifiedBy: { type: String, default: null },
    verifiedAt: { type: Date, default: null },
    verifiedEntityId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'VerifiedEntity',
      default: null
    },
    externalVerificationReference: { type: String, default: null },
    governmentRegistryReference: { type: String, default: null }
  },
  { timestamps: true }
);

module.exports = mongoose.model('NGO', ngoSchema);