const mongoose = require('mongoose');

const userSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 100 },
    email: {
      type: String,
      lowercase: true,
      trim: true,
      maxlength: 254,
      sparse: true,
      unique: true,
      default: undefined
    },
    passwordHash: { type: String, default: null },
    phone: {
      type: String,
      trim: true,
      sparse: true,
      unique: true,
      default: undefined
    },
    role: {
      type: String,
      enum: ['villager', 'ngo', 'control', 'super_admin'],
      default: 'villager'
    },
    accountStatus: {
      type: String,
      enum: ['ACTIVE', 'DISABLED'],
      default: 'ACTIVE'
    },
    verificationStatus: {
      type: String,
      enum: ['NOT_REQUIRED', 'PENDING', 'VERIFIED', 'REJECTED', 'SUSPENDED', 'REVOKED'],
      default: function () {
        if (this.role === 'villager') return 'NOT_REQUIRED';
        if (this.role === 'super_admin') return 'VERIFIED';
        return 'PENDING';
      }
    },
    verificationNote: { type: String, default: null },
    verifiedBy: { type: String, default: null },
    verifiedAt: { type: Date, default: null },
    organizationId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'VerifiedEntity',
      default: null
    },
    ngo: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'NGO',
      default: null
    },
    authorityLevel: {
      type: String,
      enum: ['GRAM_PANCHAYAT', 'DISTRICT', 'STATE'],
      default: null
    },
    stateCode: { type: String, default: null, trim: true },
    districtCode: { type: String, default: null, trim: true },
    blockCode: { type: String, default: null, trim: true },
    panchayatId: { type: String, default: null, trim: true },
    state: { type: String, default: null, trim: true },
    district: { type: String, default: null, trim: true },
    village: { type: String, default: null, trim: true },
    mustChangePassword: { type: Boolean, default: false },
    failedLoginCount: { type: Number, default: 0 },
    lockedUntil: { type: Date, default: null },
    lastLoginAt: { type: Date, default: null },
    isDemo: { type: Boolean, default: false },
    devices: [
      {
        deviceId: { type: String, required: true },
        publicKey: { type: Object, required: true },
        deviceName: { type: String, default: 'Web Client' },
        createdAt: { type: Date, default: Date.now },
        revoked: { type: Boolean, default: false }
      }
    ]
  },
  { timestamps: true }
);

userSchema.index({ 'devices.deviceId': 1 });

module.exports = mongoose.model('User', userSchema);