const mongoose = require('mongoose');

const auditLogSchema = new mongoose.Schema(
  {
    actorId: { type: String, required: true },
    actorName: { type: String, default: 'System' },
    actorRole: { type: String, required: true },
    organizationId: { type: String, default: null },
    action: {
      type: String,
      enum: [
        'ORG_REGISTERED',
        'LOGIN_SUCCESS',
        'LOGIN_FAILED',
        'LOGIN_LOCKED',
        'LOGOUT',
        'PASSWORD_RESET',
        'PASSWORD_CHANGED',
        'AUTHORITY_CREATED',
        'AUTHORITY_VERIFIED',
        'AUTHORITY_SUSPENDED',
        'AUTHORITY_REVOKED',
        'NGO_CREATED',
        'NGO_VERIFIED',
        'NGO_SUSPENDED',
        'NGO_REVOKED',
        'VOLUNTEER_VERIFIED',
        'VOLUNTEER_REVOKED',
        'ENTITY_APPROVED',
        'ENTITY_REJECTED',
        'ENTITY_SUSPENDED',
        'ENTITY_REVOKED',
        'ENTITY_REINSTATED',
        'SOS_CREATED',
        'SOS_TRIAGED',
        'SOS_ASSIGNED',
        'SOS_STATUS_UPDATED',
        'ALERT_CREATED',
        'ALERT_RETRANSMITTED',
        'ALERT_REVOKED',
        'DEVICE_REGISTERED',
        'DEVICE_REVOKED'
      ],
      required: true
    },
    targetId: { type: String, default: null },
    targetType: { type: String, default: null },
    jurisdiction: {
      state: String,
      district: String,
      block: String,
      panchayatId: String
    },
    details: { type: mongoose.Schema.Types.Mixed, default: {} },
    timestamp: { type: Date, default: Date.now }
  },
  { timestamps: true }
);

auditLogSchema.index({ action: 1, timestamp: -1 });
auditLogSchema.index({ 'jurisdiction.district': 1, 'jurisdiction.state': 1 });

module.exports = mongoose.model('AuditLog', auditLogSchema);
