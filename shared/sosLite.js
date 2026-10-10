// Sahayta Setu — Shared SOS Lite Utility
// Used by both Backend (Node.js) and Frontend (Vite React)

const SOS_LITE_VERSION = 1;

const SOURCE_CHANNELS = Object.freeze({
  DIRECT_INTERNET: 'DIRECT_INTERNET',
  SMS_FALLBACK: 'SMS_FALLBACK',
  PEER_RELAY: 'PEER_RELAY',
  PANCHAYAT_LOCAL_NODE: 'PANCHAYAT_LOCAL_NODE'
});

const LOCATION_SOURCES = Object.freeze({
  GPS_EXACT: 'GPS_EXACT',
  LAST_KNOWN: 'LAST_KNOWN',
  MAP_SELECTED: 'MAP_SELECTED',
  DISTRICT_FALLBACK: 'DISTRICT_FALLBACK'
});

/**
 * Deterministic JSON stringifier to ensure exact byte-level match
 * between Web Crypto API on client and Node.js verification on server.
 */
function canonicalStringify(obj) {
  if (obj === null || typeof obj !== 'object') {
    return JSON.stringify(obj);
  }
  if (Array.isArray(obj)) {
    return '[' + obj.map(canonicalStringify).join(',') + ']';
  }
  const keys = Object.keys(obj).sort();
  return '{' + keys.map(k => `${JSON.stringify(k)}:${canonicalStringify(obj[k])}`).join(',') + '}';
}

/**
 * Creates the canonical, compact SOS Lite unsigned payload.
 * Strictly contains ONLY:
 * clientIncidentId, deviceId, incidentType, lat, lng,
 * locationSource, locationAccuracy, peopleAffected, vulnerableCount,
 * needsMedical, createdAt, v: 1.
 */
function buildSosLitePayload(data) {
  const lat = Number(data.lat !== undefined ? data.lat : data.latitude);
  const lng = Number(data.lng !== undefined ? data.lng : data.longitude);
  if (!Number.isFinite(lat) || lat < -90 || lat > 90
    || !Number.isFinite(lng) || lng < -180 || lng > 180) {
    throw new TypeError('A valid incident latitude and longitude are required.');
  }

  return {
    v: SOS_LITE_VERSION,
    clientIncidentId: String(data.clientIncidentId || ''),
    deviceId: String(data.deviceId || ''),
    incidentType: String(data.incidentType || data.type || 'Medical'),
    lat: Math.round(lat * 1e6) / 1e6,
    lng: Math.round(lng * 1e6) / 1e6,
    locationSource: data.locationSource || 'GPS_EXACT',
    locationAccuracy: Math.round(Number(data.locationAccuracy || 18)),
    peopleAffected: Math.max(1, Math.round(Number(data.peopleAffected || 1))),
    vulnerableCount: Math.max(0, Math.round(Number(data.vulnerableCount || 0))),
    needsMedical: Boolean(data.needsMedical),
    createdAt: data.createdAt ? new Date(data.createdAt).toISOString() : new Date().toISOString()
  };
}

/**
 * Returns payload ready for signing or verification (excluding signature)
 */
function getUnsignedLitePayload(litePacket) {
  const { signature, ...unsigned } = litePacket;
  return buildSosLitePayload(unsigned);
}

/**
 * Calculates priority from available SOS Lite fields
 */
function computeLitePriority(lite) {
  if (!lite) return 'HIGH';
  if (lite.needsMedical || lite.incidentType === 'Medical Emergency' || lite.incidentType === 'Flash Flood' || lite.vulnerableCount >= 3 || lite.peopleAffected >= 10) {
    return 'CRITICAL';
  }
  if (lite.vulnerableCount > 0 || lite.peopleAffected >= 4 || lite.incidentType === 'Landslide' || lite.incidentType === 'Building Collapse') {
    return 'SEVERE';
  }
  if (lite.peopleAffected >= 2 || lite.incidentType === 'Flood' || lite.incidentType === 'Fire') {
    return 'HIGH';
  }
  return 'HIGH';
}

/**
 * Validates SOS Lite payload structure
 */
function validateSosLite(packet) {
  if (!packet || typeof packet !== 'object') {
    return { valid: false, error: 'Packet must be a valid object' };
  }
  if (!packet.clientIncidentId) {
    return { valid: false, error: 'clientIncidentId is required' };
  }
  if (!packet.deviceId) {
    return { valid: false, error: 'deviceId is required' };
  }
  if (typeof packet.lat !== 'number' || isNaN(packet.lat)) {
    return { valid: false, error: 'lat must be a valid number' };
  }
  if (typeof packet.lng !== 'number' || isNaN(packet.lng)) {
    return { valid: false, error: 'lng must be a valid number' };
  }
  const validSources = Object.values(LOCATION_SOURCES);
  if (packet.locationSource && !validSources.includes(packet.locationSource)) {
    return { valid: false, error: `locationSource must be one of ${validSources.join(', ')}` };
  }
  return { valid: true };
}

/**
 * Measure serialized byte length in UTF-8
 */
function measurePayloadBytes(packet) {
  const str = canonicalStringify(packet);
  if (typeof TextEncoder !== 'undefined') {
    return new TextEncoder().encode(str).length;
  }
  return Buffer.byteLength(str, 'utf8');
}

// Universal export
export {
  SOS_LITE_VERSION,
  SOURCE_CHANNELS,
  LOCATION_SOURCES,
  canonicalStringify,
  buildSosLitePayload,
  getUnsignedLitePayload,
  computeLitePriority,
  validateSosLite,
  measurePayloadBytes
};

export default {
  SOS_LITE_VERSION,
  SOURCE_CHANNELS,
  LOCATION_SOURCES,
  canonicalStringify,
  buildSosLitePayload,
  getUnsignedLitePayload,
  computeLitePriority,
  validateSosLite,
  measurePayloadBytes
};
