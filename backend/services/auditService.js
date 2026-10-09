const mongoose = require('mongoose');
const AuditLog = require('../models/auditLog');

// In-memory audit log ring buffer for demo and tests
const memoryAuditLogs = [];
const MAX_MEMORY_LOGS = 500;

/**
 * Log an operational or administrative action in the disaster response audit trail
 */
async function logAuditEvent({
  actorId = 'system',
  actorName = 'System',
  actorRole = 'system',
  organizationId = null,
  action,
  targetId = null,
  targetType = null,
  jurisdiction = {},
  details = {}
}) {
  const entry = {
    _id: `audit-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
    actorId: String(actorId),
    actorName: String(actorName),
    actorRole: String(actorRole),
    organizationId: organizationId ? String(organizationId) : null,
    action,
    targetId: targetId ? String(targetId) : null,
    targetType: targetType ? String(targetType) : null,
    jurisdiction: {
      state: jurisdiction.state || null,
      district: jurisdiction.district || null,
      block: jurisdiction.block || null,
      panchayatId: jurisdiction.panchayatId || null
    },
    details: details || {},
    timestamp: new Date()
  };

  // Add to memory ring buffer
  memoryAuditLogs.unshift(entry);
  if (memoryAuditLogs.length > MAX_MEMORY_LOGS) {
    memoryAuditLogs.pop();
  }

  // Persist to MongoDB if active
  if (mongoose.connection && mongoose.connection.readyState === 1) {
    try {
      await AuditLog.create(entry);
    } catch (err) {
      console.warn('AuditLog persistence warning:', err.message);
    }
  }

  return entry;
}

/**
 * Query recent audit logs with optional filters
 */
async function queryAuditLogs(filters = {}) {
  const { action, district, state, limit = 50 } = filters;

  if (mongoose.connection && mongoose.connection.readyState === 1) {
    try {
      const query = {};
      if (action) query.action = action;
      if (district) query['jurisdiction.district'] = new RegExp(`^${district}$`, 'i');
      if (state) query['jurisdiction.state'] = new RegExp(`^${state}$`, 'i');
      return await AuditLog.find(query).sort({ timestamp: -1 }).limit(Number(limit));
    } catch {
      // Fallback to memory
    }
  }

  let results = [...memoryAuditLogs];
  if (action) {
    results = results.filter((l) => l.action === action);
  }
  if (district) {
    results = results.filter(
      (l) => l.jurisdiction.district && l.jurisdiction.district.toLowerCase() === district.toLowerCase()
    );
  }
  if (state) {
    results = results.filter(
      (l) => l.jurisdiction.state && l.jurisdiction.state.toLowerCase() === state.toLowerCase()
    );
  }
  return results.slice(0, Number(limit));
}

module.exports = {
  logAuditEvent,
  queryAuditLogs,
  memoryAuditLogs
};
