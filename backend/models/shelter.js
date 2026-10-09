const mongoose = require('mongoose');

const shelterSchema = new mongoose.Schema(
  {
    type: {
      type: String,
      enum: ['SHELTER', 'MEDICAL', 'RELIEF_POINT'],
      default: 'SHELTER'
    },
    name: { type: String, required: true, trim: true, maxlength: 150 },
    address: { type: String, default: '', trim: true, maxlength: 300 },
    lat: { type: Number, required: true },
    lng: { type: Number, required: true },
    state: { type: String, default: null, trim: true },
    district: { type: String, default: null, trim: true },
    stateCode: { type: String, default: null, trim: true },
    districtCode: { type: String, default: null, trim: true },
    blockCode: { type: String, default: null, trim: true },
    panchayatId: { type: String, default: null, trim: true },
    capacity: { type: Number, required: true, min: 1 },
    occupancy: { type: Number, default: 0, min: 0 },
    currentOccupancy: { type: Number, default: 0, min: 0 },
    servicesOffered: [{ type: String, trim: true }],
    publicContact: { type: String, default: null, trim: true },
    status: {
      type: String,
      enum: ['ACTIVE', 'FULL', 'CLOSED'],
      default: 'ACTIVE'
    },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null
    },
    organizationId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'VerifiedEntity',
      default: null
    },
    organizationName: { type: String, default: null, trim: true },
    verified: { type: Boolean, default: true },
    lastStatusAt: { type: Date, default: Date.now }
  },
  { timestamps: true }
);

shelterSchema.index({ district: 1, state: 1, status: 1 });
shelterSchema.index({ lat: 1, lng: 1 });

module.exports = mongoose.model('Shelter', shelterSchema);