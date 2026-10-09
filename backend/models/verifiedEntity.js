const mongoose = require('mongoose');

const verifiedEntitySchema = new mongoose.Schema(
  {
    organizationName: { type: String, required: true, trim: true, maxlength: 150 },
    // Also provide 'name' alias for compatibility
    name: { type: String, trim: true, maxlength: 150 },
    organizationType: {
      type: String,
      enum: [
        'NGO',
        'PANCHAYAT',
        'DISTRICT_AUTHORITY',
        'STATE_AUTHORITY',
        'NATIONAL_AUTHORITY',
        'VOLUNTEER_TEAM'
      ],
      required: true
    },
    authorityLevel: {
      type: String,
      enum: ['GRAM_PANCHAYAT', 'DISTRICT', 'STATE'],
      default: null
    },
    registrationNumber: { type: String, default: null, trim: true, maxlength: 100 },
    representativeName: { type: String, required: true, trim: true, maxlength: 100 },
    phone: { type: String, required: true, trim: true },
    email: { type: String, trim: true, lowercase: true, maxlength: 254 },
    state: { type: String, required: true, trim: true },
    district: { type: String, required: true, trim: true },
    block: { type: String, default: null, trim: true },
    panchayatId: { type: String, default: null, trim: true },
    stateCode: { type: String, default: null, trim: true },
    districtCode: { type: String, default: null, trim: true },
    blockCode: { type: String, default: null, trim: true },
    capabilities: [
      {
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
      }
    ],
    verificationStatus: {
      type: String,
      enum: ['PENDING', 'VERIFIED', 'REJECTED', 'SUSPENDED', 'REVOKED'],
      default: 'PENDING'
    },
    status: {
      type: String,
      enum: ['PENDING', 'VERIFIED', 'REJECTED', 'SUSPENDED', 'REVOKED'],
      default: 'PENDING'
    },
    reviewedBy: { type: String, default: null },
    reviewedAt: { type: Date, default: null },
    verifiedBy: { type: String, default: null },
    verifiedAt: { type: Date, default: null },
    reason: { type: String, default: null },
    verificationNote: { type: String, default: null },
    externalVerificationReference: { type: String, default: null },
    governmentRegistryReference: { type: String, default: null },
    verificationSource: { type: String, default: 'SAHAYTA_SETU_ADMIN' },
    verificationLabel: { type: String, default: 'PENDING VERIFICATION' },
    activeStatus: {
      type: String,
      enum: ['AVAILABLE', 'BUSY', 'OFFLINE'],
      default: 'AVAILABLE'
    },
    location: {
      lat: Number,
      lng: Number
    },
    capacity: { type: Number, default: 0 },
    currentOccupancy: { type: Number, default: 0 },
    servicesOffered: [{ type: String }],
    publicContact: { type: String, default: null },
    lastStatusAt: { type: Date, default: Date.now }
  },
  { timestamps: true }
);

// Keep status and verificationStatus in sync before save
verifiedEntitySchema.pre('save', function () {
  if (this.verificationStatus && !this.status) {
    this.status = this.verificationStatus;
  } else if (this.status && !this.verificationStatus) {
    this.verificationStatus = this.status;
  }
  if (!this.name && this.organizationName) {
    this.name = this.organizationName;
  } else if (!this.organizationName && this.name) {
    this.organizationName = this.name;
  }
});

module.exports = mongoose.model('VerifiedEntity', verifiedEntitySchema);
