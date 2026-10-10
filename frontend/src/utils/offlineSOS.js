import { API_URL, getToken } from '../api.js';
import { getOrCreateDeviceId, signEmergencyPayload, registerDeviceWithBackend } from './trustedDevice.js';
import { transportManager } from './mesh/EmergencyTransport.js';
import { getSocket } from './socketClient.js';
import {
  buildSosLitePayload,
  computeLitePriority
} from './sosLite.js';

const DB_NAME = 'sosDB';
const QUEUE_STORE = 'emergencySOSQueue';
const LEGACY_STORE = 'pendingSOS';
const LAST_LOCATION_KEY = 'lastKnownLocation';

/**
 * Open IndexedDB with upgraded schema
 */
function openDatabase() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 2);

    request.onupgradeneeded = (event) => {
      const db = event.target.result;
      if (!db.objectStoreNames.contains(QUEUE_STORE)) {
        db.createObjectStore(QUEUE_STORE, { keyPath: 'clientIncidentId' });
      }
      if (!db.objectStoreNames.contains('trustedDeviceStore')) {
        db.createObjectStore('trustedDeviceStore', { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains('alertsCacheStore')) {
        db.createObjectStore('alertsCacheStore', { keyPath: '_id' });
      }
      if (!db.objectStoreNames.contains(LEGACY_STORE)) {
        db.createObjectStore(LEGACY_STORE, { keyPath: 'id' });
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function withQueueStore(mode, work) {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(QUEUE_STORE, mode);
    const store = transaction.objectStore(QUEUE_STORE);
    const request = work(store);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

transportManager.onRelayReceived(async (packet, { serverReceived }) => {
  if (serverReceived) return;

  const litePayload = packet.originalPayload || packet.payload;
  const signature = packet.originalSignature || packet.signature;
  if (!litePayload || !signature) {
    throw new Error(`Relayed SOS ${packet.clientIncidentId} is missing its signed payload.`);
  }

  const relayMetadata = {
    district: packet.district || '',
    state: packet.state || '',
    village: packet.village || '',
    sourceChannel: 'PEER_RELAY',
    hopCount: packet.hopCount,
    relayDeviceId: packet.relayDeviceId || null
  };
  const litePacket = { ...litePayload, signature };

  await withQueueStore('readwrite', (store) => store.put({
    ...litePayload,
    clientIncidentId: packet.clientIncidentId,
    deviceId: litePayload.deviceId,
    litePacket,
    relayPacket: packet,
    relayMetadata,
    detailsPayload: {
      clientIncidentId: packet.clientIncidentId,
      description: `Emergency ${litePayload.incidentType || 'Medical'} dispatch request (relayed)`,
      village: relayMetadata.village,
      district: relayMetadata.district,
      state: relayMetadata.state
    },
    sourceChannel: 'PEER_RELAY',
    latitude: litePayload.lat,
    longitude: litePayload.lng,
    priority: computeLitePriority(litePayload),
    syncStatus: 'OFFLINE_QUEUE_ONLY',
    liteSynced: false,
    detailsSynced: false,
    retryCount: 0,
    queuedAt: new Date().toISOString(),
    token: getToken(),
    signature
  }));

  if ((packet.hopCount || 0) < transportManager.maxHopCount) {
    await transportManager.dispatch(packet);
  }
});

// ---------- Smart SOS Location System ----------

export function readLastKnownLocation() {
  try {
    const saved = localStorage.getItem(LAST_LOCATION_KEY);
    return saved ? JSON.parse(saved) : null;
  } catch {
    return null;
  }
}

/**
 * Smart SOS location priority sequence:
 * 1. Current GPS (GPS_EXACT)
 * 2. Last known GPS (LAST_KNOWN)
 * 3. Selected map location (MAP_SELECTED)
 * 4. District fallback (DISTRICT_FALLBACK)
 */
export function getLocationWithSmartFallback(options = {}) {
  const { mapSelected = null, districtFallback = null } = options;

  return new Promise((resolve) => {
    const fallbackToSecondary = () => {
      // Priority 2: Last known GPS
      const lastKnown = readLastKnownLocation();
      if (lastKnown && Number.isFinite(lastKnown.latitude) && Number.isFinite(lastKnown.longitude)) {
        resolve({
          latitude: lastKnown.latitude,
          longitude: lastKnown.longitude,
          accuracy: lastKnown.accuracy || 30,
          locationSource: 'LAST_KNOWN',
          isApproximateLocation: false,
          label: `Last Known GPS (Accuracy ±${Math.round(lastKnown.accuracy || 30)}m)`
        });
        return;
      }

      // Priority 3: Selected Map Location
      if (mapSelected && Number.isFinite(mapSelected.lat) && Number.isFinite(mapSelected.lng)) {
        resolve({
          latitude: mapSelected.lat,
          longitude: mapSelected.lng,
          accuracy: 50,
          locationSource: 'MAP_SELECTED',
          isApproximateLocation: true,
          label: 'Selected Map Location'
        });
        return;
      }

      // Priority 4: District Fallback
      if (districtFallback && Number.isFinite(districtFallback.lat) && Number.isFinite(districtFallback.lng)) {
        resolve({
          latitude: districtFallback.lat,
          longitude: districtFallback.lng,
          accuracy: 5000,
          locationSource: 'DISTRICT_FALLBACK',
          isApproximateLocation: true,
          label: `Approximate District Center (${districtFallback.district || 'District'})`
        });
        return;
      }

      // Default safe coordinate if nothing is known (Dehradun centre)
      resolve({
        latitude: 30.3165,
        longitude: 78.0322,
        accuracy: 10000,
        locationSource: 'DISTRICT_FALLBACK',
        isApproximateLocation: true,
        label: 'Default District Center'
      });
    };

    if (!navigator.geolocation) {
      fallbackToSecondary();
      return;
    }

    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const accuracy = Math.round(pos.coords.accuracy || 15);
        const location = {
          latitude: pos.coords.latitude,
          longitude: pos.coords.longitude,
          accuracy,
          locationSource: 'GPS_EXACT',
          isApproximateLocation: accuracy > 100,
          label: `Exact GPS (Accuracy ±${accuracy}m)`
        };
        localStorage.setItem(LAST_LOCATION_KEY, JSON.stringify(location));
        resolve(location);
      },
      () => {
        fallbackToSecondary();
      },
      { enableHighAccuracy: true, timeout: 8000, maximumAge: 30000 }
    );
  });
}

// Backwards compatibility alias
export const getLocationWithFallback = getLocationWithSmartFallback;

// ---------- SOS Queueing & Signing ----------

// ---------- SOS Lite Queueing, Signing & Low-Network Resilience ----------

/**
 * Exponential backoff with jitter calculation (capped at 5 minutes)
 */
export function computeBackoffWithJitter(retryCount, baseMs = 2000, maxMs = 300000) {
  const exp = Math.min(Math.max(0, retryCount), 10);
  const backoff = Math.min(maxMs, baseMs * Math.pow(1.8, exp));
  // Add 0-30% randomized jitter
  const jitter = Math.random() * 0.3 * backoff;
  return Math.min(maxMs, Math.round(backoff + jitter));
}

// ---------- Connectivity Service ----------
// States: ONLINE, SERVER_UNREACHABLE, OFFLINE
let currentConnectivity = typeof navigator !== 'undefined' && !navigator.onLine ? 'OFFLINE' : 'ONLINE';
const connectivityListeners = new Set();

export function getConnectivityState() {
  return currentConnectivity;
}

export function onConnectivityChange(callback) {
  connectivityListeners.add(callback);
  return () => connectivityListeners.delete(callback);
}

function updateConnectivityState(newState) {
  if (currentConnectivity !== newState) {
    currentConnectivity = newState;
    connectivityListeners.forEach((fn) => {
      try { fn(newState); } catch (e) { console.error('Connectivity listener error:', e); }
    });
  }
}

/**
 * Check connectivity using navigator.onLine AND a 3-second ping to /api/health
 */
export async function checkConnectivity() {
  if (typeof navigator !== 'undefined' && !navigator.onLine) {
    updateConnectivityState('OFFLINE');
    return 'OFFLINE';
  }

  try {
    let timeoutId;
    const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
    if (controller) {
      timeoutId = setTimeout(() => controller.abort(), 3000);
    }

    const response = await fetch(`${API_URL}/api/health`, {
      method: 'GET',
      cache: 'no-store',
      headers: {
        'Cache-Control': 'no-cache',
        'Pragma': 'no-cache'
      },
      signal: controller?.signal
    });

    if (timeoutId) clearTimeout(timeoutId);

    if (response.ok) {
      const data = await response.json().catch(() => ({}));
      if (data.db === 'down') {
        updateConnectivityState('SERVER_UNREACHABLE');
        return 'SERVER_UNREACHABLE';
      }
      updateConnectivityState('ONLINE');
      return 'ONLINE';
    } else {
      updateConnectivityState('SERVER_UNREACHABLE');
      return 'SERVER_UNREACHABLE';
    }
  } catch {
    const fallback = typeof navigator !== 'undefined' && navigator.onLine ? 'SERVER_UNREACHABLE' : 'OFFLINE';
    updateConnectivityState(fallback);
    return fallback;
  }
}

// ---------- Error Classification ----------
/**
 * Classify errors into TRANSIENT, DEVICE_UNKNOWN, or PERMANENT
 */
export function classifySyncError(err) {
  const status = err.status || 0;
  const code = err.code || '';
  const message = String(err.message || '').toLowerCase();

  // Network or timeout
  if (status === 0 || code === 'NETWORK_ERROR' || message.includes('failed to fetch') || message.includes('networkerror') || message.includes('network request failed')) {
    return { type: 'TRANSIENT', reason: err.message || 'Network disconnected' };
  }

  // Rate limiting -> transient
  if (status === 429 || code === 'RATE_LIMITED') {
    return { type: 'TRANSIENT', reason: 'Rate limited by server, will back off' };
  }

  // Server temporary errors (500, 502, 503, 504, DB_UNAVAILABLE)
  if (status >= 500 || code === 'DB_UNAVAILABLE') {
    return { type: 'TRANSIENT', reason: 'Server or database temporarily unavailable' };
  }

  // Unknown device -> can re-register if current device
  if (code === 'DEVICE_UNKNOWN' || (status === 403 && message.includes('not registered'))) {
    return { type: 'DEVICE_UNKNOWN', code: 'DEVICE_UNKNOWN', reason: err.message || 'Device identity is not registered with server' };
  }

  // Revoked device -> permanent rejection
  if (code === 'DEVICE_REVOKED' || (status === 403 && message.includes('revoked'))) {
    return { type: 'PERMANENT', code: 'DEVICE_REVOKED', reason: err.message || 'Device identity has been revoked' };
  }

  // Expired payload (> 30 days) -> permanent rejection
  if (status === 410 || code === 'PAYLOAD_EXPIRED') {
    return { type: 'PERMANENT', code: 'PAYLOAD_EXPIRED', reason: err.message || 'Emergency payload expired (exceeds threshold)' };
  }

  // Signature invalid -> permanent rejection
  if (code === 'SIGNATURE_INVALID' || message.includes('signature')) {
    return { type: 'PERMANENT', code: 'SIGNATURE_INVALID', reason: err.message || 'Cryptographic signature verification failed' };
  }

  // Validation error / Bad Request -> permanent rejection
  if (status === 400 || code === 'VALIDATION_ERROR') {
    return { type: 'PERMANENT', code: 'VALIDATION_ERROR', reason: err.message || 'Packet validation rejected by server' };
  }

  // Any other 4xx is permanent
  if (status >= 400 && status < 500) {
    return { type: 'PERMANENT', code: 'CLIENT_ERROR', reason: err.message || `Client error (${status})` };
  }

  return { type: 'TRANSIENT', reason: err.message || 'Unexpected error' };
}

/**
 * Transmit SOS Lite via Socket.IO with timeout, falling back if unavailable
 */
export async function sendSosLiteViaSocket(litePacket, timeoutMs = 2500) {
  const socket = getSocket();
  if (!socket || !socket.connected) {
    return null;
  }

  return new Promise((resolve) => {
    let finished = false;
    const timer = setTimeout(() => {
      if (!finished) {
        finished = true;
        resolve(null);
      }
    }, timeoutMs);

    socket.emit('sos:lite', litePacket, (response) => {
      if (!finished) {
        finished = true;
        clearTimeout(timer);
        if (response && (response.status === 200 || response.status === 201 || response._id || response.clientIncidentId)) {
          resolve(response.data || response);
        } else {
          resolve(null);
        }
      }
    });
  });
}

/**
 * Transmit SOS Lite via plain HTTP POST /api/sos/lite
 */
export async function sendSosLiteHttp(litePacket, token, relayMetadata = null) {
  const authToken = token || getToken();
  const requestBody = relayMetadata
    ? {
        payload: litePacket,
        ...relayMetadata
      }
    : litePacket;
  let response;
  try {
    response = await fetch(`${API_URL}/api/sos/lite`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(authToken ? { Authorization: `Bearer ${authToken}` } : {})
      },
      body: JSON.stringify(requestBody)
    });
  } catch (netErr) {
    const err = new Error(netErr.message || 'Network request failed');
    err.status = 0;
    err.code = 'NETWORK_ERROR';
    throw err;
  }

  if (!response.ok && response.status !== 200 && response.status !== 201) {
    let errorData = null;
    try {
      errorData = await response.json();
    } catch {
      // A non-JSON response still gets the HTTP status message below.
    }
    const msg = errorData?.message || errorData?.error || `HTTP SOS Lite failed with status ${response.status}`;
    const err = new Error(msg);
    err.status = response.status;
    err.code = errorData?.code || null;
    err.details = errorData;
    throw err;
  }

  return await response.json();
}

/**
 * Transmit follow-up details via HTTP POST /api/sos/details
 */
export async function sendSosDetailsHttp(detailsPayload, token) {
  const authToken = token || getToken();
  let response;
  try {
    response = await fetch(`${API_URL}/api/sos/details`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(authToken ? { Authorization: `Bearer ${authToken}` } : {})
      },
      body: JSON.stringify(detailsPayload)
    });
  } catch (netErr) {
    const err = new Error(netErr.message || 'Network request failed');
    err.status = 0;
    err.code = 'NETWORK_ERROR';
    throw err;
  }

  if (!response.ok && response.status !== 200 && response.status !== 201) {
    let errorData = null;
    try {
      errorData = await response.json();
    } catch {
      // A non-JSON response still gets the HTTP status message below.
    }
    const msg = errorData?.message || errorData?.error || `HTTP SOS Details failed with status ${response.status}`;
    const err = new Error(msg);
    err.status = response.status;
    err.code = errorData?.code || null;
    err.details = errorData;
    throw err;
  }

  return await response.json();
}

/**
 * Flow on SOS press:
 * 1. Build canonical compact SOS Lite payload (< 1 KB)
 * 2. Sign with ECDSA P-256 WebCrypto
 * 3. Save to IndexedDB FIRST with status OFFLINE_QUEUE_ONLY
 * 4. Attempt immediate send of SOS Lite (Socket.IO -> HTTP fallback)
 * 5. Send follow-up details after SOS Lite acknowledgement
 */
export async function queueAndSendEmergencySOS(sosData) {
  const clientIncidentId = sosData.clientIncidentId || `sos_${Date.now()}_${crypto.randomUUID().slice(0, 8)}`;
  const deviceId = getOrCreateDeviceId();
  const userId = sosData.userId || 'demo-villager';
  const createdAt = new Date().toISOString();

  // 1. Build canonical compact SOS Lite structure (version 1)
  const unsignedLite = buildSosLitePayload({
    clientIncidentId,
    deviceId,
    incidentType: sosData.emergencyType || sosData.incidentType || 'Medical',
    lat: sosData.latitude,
    lng: sosData.longitude,
    locationSource: sosData.locationSource || 'GPS_EXACT',
    locationAccuracy: sosData.locationAccuracy || 18,
    peopleAffected: sosData.peopleAffected || 1,
    vulnerableCount: sosData.vulnerableCount || 0,
    needsMedical: Boolean(sosData.needsMedical),
    createdAt
  });

  // Ensure device is registered with backend before signing if online
  if (typeof navigator !== 'undefined' && navigator.onLine) {
    try {
      await registerDeviceWithBackend(userId);
    } catch (regErr) {
      console.warn('Pre-sign device registration notice:', regErr);
    }
  }

  // 2. Cryptographically sign unsigned Lite structure with WebCrypto ECDSA P-256
  const signature = await signEmergencyPayload(unsignedLite).catch((err) => {
    console.warn('WebCrypto signing fallback:', err);
    return `sim_sig_${Date.now()}_${deviceId}`;
  });

  const litePacket = {
    ...unsignedLite,
    signature
  };

  // Follow-up details linked with clientIncidentId
  const detailsPayload = {
    clientIncidentId,
    description: sosData.description || `Emergency ${unsignedLite.incidentType} dispatch request`,
    contactName: sosData.contactName || null,
    contactPhone: sosData.contactPhone || null,
    photos: sosData.photos || [],
    village: sosData.village || '',
    district: sosData.district || 'Dehradun',
    state: sosData.state || 'Uttarakhand',
    extraNotes: sosData.extraNotes || ''
  };

  // 3. Save to IndexedDB FIRST with status OFFLINE_QUEUE_ONLY
  const relayPacket = {
    type: 'EMERGENCY_RELAY_PACKET',
    originDeviceId: deviceId,
    relayDeviceId: deviceId,
    clientIncidentId,
    hopCount: 0,
    maxHopCount: 5,
    originalTimestamp: Date.now(),
    originalPayload: unsignedLite,
    originalSignature: signature,
    timestamp: Date.now(),
    payload: unsignedLite,
    signature,
    seenIncidentIds: [clientIncidentId],
    district: sosData.district || 'Dehradun',
    state: sosData.state || 'Uttarakhand',
    village: sosData.village || ''
  };

  const queueRecord = {
    clientIncidentId,
    userId,
    deviceId,
    litePacket,
    relayPacket,
    detailsPayload,
    syncStatus: 'OFFLINE_QUEUE_ONLY', // OFFLINE_QUEUE_ONLY | SYNCING | SERVER_RECEIVED | SYNC_REJECTED
    liteSynced: false,
    detailsSynced: false,
    retryCount: 0,
    lastAttemptTime: null,
    lastAttemptAt: null,
    lastErrorCode: null,
    lastErrorMessage: null,
    nextRetryDelayMs: 2000,
    queuedAt: createdAt,
    token: sosData.token || getToken(),
    // Keep flattened fields for UI & backward compatibility
    ...unsignedLite,
    latitude: unsignedLite.lat,
    longitude: unsignedLite.lng,
    description: detailsPayload.description,
    contactName: detailsPayload.contactName,
    contactPhone: detailsPayload.contactPhone,
    village: detailsPayload.village,
    district: detailsPayload.district,
    state: detailsPayload.state,
    priority: sosData.priority || computeLitePriority(unsignedLite),
    signature
  };

  await withQueueStore('readwrite', (store) => store.put(queueRecord));
  console.log(`🚨 SOS written to IndexedDB queue (status: OFFLINE_QUEUE_ONLY): ${clientIncidentId}`);

  // 4. Opportunistic mesh relay broadcast (store-and-forward)
  let dispatchResult = null;
  try {
    dispatchResult = await transportManager.dispatch(relayPacket);
  } catch (err) {
    console.warn('Opportunistic relay dispatch notice:', err);
  }
  if (dispatchResult?.communicationState === 'LOCAL_RELAY_AVAILABLE') {
    queueRecord.relayStatus = 'RELAYED_TO_NEARBY_DEVICE';
    await withQueueStore('readwrite', (store) => store.put(queueRecord));
  }

  // 5. Ask Service Worker background sync to assist
  await requestBackgroundSync();

  // 6. Attempt immediate send of SOS Lite if online
  if (navigator.onLine) {
    try {
      queueRecord.syncStatus = 'SYNCING';
      queueRecord.lastAttemptTime = Date.now();
      queueRecord.lastAttemptAt = Date.now();
      await withQueueStore('readwrite', (store) => store.put(queueRecord));

      // Try Socket.IO first, fallback to HTTP POST /api/sos/lite
      let liteAck = null;
      try {
        liteAck = await sendSosLiteViaSocket(litePacket);
      } catch (err) {
        console.warn('Socket.IO attempt failed, using HTTP fallback:', err.message);
      }

      if (!liteAck) {
        liteAck = await sendSosLiteHttp(litePacket, queueRecord.token);
      }

      queueRecord.liteSynced = true;
      queueRecord.backendAck = liteAck;
      queueRecord.lastErrorCode = null;
      queueRecord.lastErrorMessage = null;
      console.log(`✓ SOS Lite acknowledged by server: ${clientIncidentId}`);

      // Attempt follow-up details sync
      try {
        const detailsAck = await sendSosDetailsHttp(detailsPayload, queueRecord.token);
        queueRecord.detailsSynced = true;
        queueRecord.detailsAck = detailsAck;
      } catch (detailsErr) {
        console.warn('Details sync deferred for background upload:', detailsErr.message);
      }

      queueRecord.syncStatus = 'SERVER_RECEIVED';
      queueRecord.syncedAt = new Date().toISOString();
      await withQueueStore('readwrite', (store) => store.put(queueRecord));

      return {
        status: 'SERVER_RECEIVED',
        syncStatus: 'SERVER_RECEIVED',
        communicationState: 'SERVER_RECEIVED',
        clientIncidentId,
        backendAck: liteAck,
        retryCount: queueRecord.retryCount,
        lastAttemptTime: queueRecord.lastAttemptTime,
        message: '🟢 SERVER_RECEIVED: SOS has reached the Sahayta Setu command center and responders.'
      };
    } catch (err) {
      const classification = classifySyncError(err);
      queueRecord.lastAttemptTime = Date.now();
      queueRecord.lastAttemptAt = Date.now();
      queueRecord.lastErrorCode = classification.code || err.code || String(err.status || 'ERROR');
      queueRecord.lastErrorMessage = classification.reason;

      if (classification.type === 'PERMANENT') {
        queueRecord.syncStatus = 'SYNC_REJECTED';
        await withQueueStore('readwrite', (store) => store.put(queueRecord));
        return {
          status: 'SYNC_REJECTED',
          syncStatus: 'SYNC_REJECTED',
          communicationState: 'SYNC_REJECTED',
          clientIncidentId,
          lastErrorCode: queueRecord.lastErrorCode,
          lastErrorMessage: queueRecord.lastErrorMessage,
          message: `🔴 SYNC_REJECTED: Could not send report (${classification.reason})`
        };
      } else if (classification.type === 'DEVICE_UNKNOWN') {
        // Attempt re-registration once
        try {
          const regOk = await registerDeviceWithBackend(userId);
          if (regOk) {
            const retryAck = await sendSosLiteHttp(litePacket, queueRecord.token);
            queueRecord.liteSynced = true;
            queueRecord.backendAck = retryAck;
            queueRecord.syncStatus = 'SERVER_RECEIVED';
            queueRecord.syncedAt = new Date().toISOString();
            queueRecord.lastErrorCode = null;
            queueRecord.lastErrorMessage = null;
            await withQueueStore('readwrite', (store) => store.put(queueRecord));
            return {
              status: 'SERVER_RECEIVED',
              syncStatus: 'SERVER_RECEIVED',
              communicationState: 'SERVER_RECEIVED',
              clientIncidentId,
              backendAck: retryAck,
              message: '🟢 SERVER_RECEIVED: SOS has reached the Sahayta Setu command center.'
            };
          }
        } catch {
          // Fall through to rejected
        }
        queueRecord.syncStatus = 'SYNC_REJECTED';
        await withQueueStore('readwrite', (store) => store.put(queueRecord));
        return {
          status: 'SYNC_REJECTED',
          syncStatus: 'SYNC_REJECTED',
          communicationState: 'SYNC_REJECTED',
          clientIncidentId,
          lastErrorCode: 'DEVICE_UNKNOWN',
          lastErrorMessage: classification.reason,
          message: `🔴 SYNC_REJECTED: Device identity rejected (${classification.reason})`
        };
      } else {
        // TRANSIENT
        queueRecord.syncStatus = 'OFFLINE_QUEUE_ONLY';
        queueRecord.retryCount = (queueRecord.retryCount || 0) + 1;
        queueRecord.nextRetryDelayMs = computeBackoffWithJitter(queueRecord.retryCount);
        await withQueueStore('readwrite', (store) => store.put(queueRecord));
      }
    }
  }

  const commState = dispatchResult?.communicationState || transportManager.getCommunicationState();
  const isRelayed = commState === 'LOCAL_RELAY_AVAILABLE';

  return {
    status: isRelayed ? 'PEER_RELAY' : 'OFFLINE_QUEUE_ONLY',
    syncStatus: 'OFFLINE_QUEUE_ONLY',
    communicationState: isRelayed ? 'LOCAL_RELAY_AVAILABLE' : 'OFFLINE_QUEUE_ONLY',
    clientIncidentId,
    retryCount: queueRecord.retryCount,
    lastAttemptTime: queueRecord.lastAttemptTime,
    message: isRelayed
      ? '🟠 PEER_RELAY: Opportunistic forward to nearby peer. Stored safely in local offline queue.'
      : '🟠 OFFLINE_QUEUE_ONLY: SOS saved on this phone, not sent yet. Automatic store-and-forward will sync when connectivity returns.'
  };
}

// Backwards compatibility alias
export const saveSOSLocally = queueAndSendEmergencySOS;

/**
 * Mark a record as SERVER_RECEIVED in IndexedDB
 */
export async function markSOSAsSynced(clientIncidentId, backendAck = null) {
  try {
    const record = await withQueueStore('readonly', (store) => store.get(clientIncidentId));
    if (record) {
      record.syncStatus = 'SERVER_RECEIVED';
      record.liteSynced = true;
      record.detailsSynced = true;
      record.syncedAt = new Date().toISOString();
      record.lastErrorCode = null;
      record.lastErrorMessage = null;
      if (backendAck) record.backendAck = backendAck;
      await withQueueStore('readwrite', (store) => store.put(record));
    }
  } catch (err) {
    console.error('Error marking SOS as synced:', err);
  }
}

/**
 * Get count of genuinely unsynchronized SOS records (excludes SERVER_RECEIVED and SYNC_REJECTED)
 */
export async function getPendingCount() {
  try {
    const records = await withQueueStore('readonly', (store) => store.getAll());
    return records.filter(
      (sos) => sos.syncStatus === 'OFFLINE_QUEUE_ONLY' || sos.syncStatus === 'SYNCING'
    ).length;
  } catch {
    return 0;
  }
}

/**
 * Get all queued records sorted by date descending
 */
export async function getEmergencyQueue() {
  try {
    const records = await withQueueStore('readonly', (store) => store.getAll());
    return records.sort((a, b) => new Date(b.createdAt || b.queuedAt) - new Date(a.createdAt || a.queuedAt));
  } catch {
    return [];
  }
}

export async function forwardPendingSOSViaMesh() {
  const records = await withQueueStore('readonly', (store) => store.getAll());
  let relayedCount = 0;

  for (const record of records) {
    if (record.syncStatus === 'SERVER_RECEIVED' || record.syncStatus === 'SYNCED' || record.syncStatus === 'SYNC_REJECTED') {
      continue;
    }

    const litePacket = record.litePacket;
    if (!litePacket?.signature || !litePacket?.clientIncidentId) continue;

    const relayPacket = record.relayPacket || {
      type: 'EMERGENCY_RELAY_PACKET',
      originDeviceId: litePacket.deviceId,
      relayDeviceId: litePacket.deviceId,
      clientIncidentId: litePacket.clientIncidentId,
      hopCount: Number(record.relayMetadata?.hopCount) || 0,
      maxHopCount: 5,
      originalTimestamp: new Date(litePacket.createdAt || record.queuedAt || Date.now()).getTime(),
      originalPayload: Object.fromEntries(Object.entries(litePacket).filter(([key]) => key !== 'signature')),
      originalSignature: litePacket.signature,
      timestamp: Date.now(),
      payload: Object.fromEntries(Object.entries(litePacket).filter(([key]) => key !== 'signature')),
      signature: litePacket.signature,
      district: record.district || record.relayMetadata?.district || '',
      state: record.state || record.relayMetadata?.state || '',
      village: record.village || record.relayMetadata?.village || ''
    };

    const result = await transportManager.dispatch(relayPacket);
    if (result.communicationState === 'LOCAL_RELAY_AVAILABLE' || result.communicationState === 'SERVER_RECEIVED') {
      relayedCount++;
    }
  }

  return { relayedCount };
}

// Single Sync Lock to prevent parallel runs between page, timers, and background sync
let isSyncRunning = false;

/**
 * Synchronize all pending SOS requests in the queue with error classification
 */
export async function syncPendingSOS() {
  if (isSyncRunning) {
    return { locked: true };
  }

  const connState = await checkConnectivity();
  if (connState === 'OFFLINE' || connState === 'SERVER_UNREACHABLE') {
    return { skipped: true, reason: connState };
  }

  isSyncRunning = true;
  try {
    const records = await withQueueStore('readonly', (store) => store.getAll());

    for (const record of records) {
      // Skip completed or rejected
      if ((record.syncStatus === 'SERVER_RECEIVED' || record.syncStatus === 'SYNCED') && record.detailsSynced) continue;
      if (record.syncStatus === 'SYNC_REJECTED') continue;

      try {
        record.syncStatus = 'SYNCING';
        record.lastAttemptTime = Date.now();
        record.lastAttemptAt = Date.now();
        await withQueueStore('readwrite', (store) => store.put(record));

        // 1. Lite sync if not acknowledged yet
        if (!record.liteSynced) {
          const litePacket = record.litePacket || buildSosLitePayload({
            clientIncidentId: record.clientIncidentId,
            deviceId: record.deviceId,
            incidentType: record.incidentType,
            lat: record.latitude,
            lng: record.longitude,
            locationSource: record.locationSource || 'GPS_EXACT',
            locationAccuracy: record.locationAccuracy || 18,
            peopleAffected: record.peopleAffected || 1,
            vulnerableCount: record.vulnerableCount || 0,
            needsMedical: Boolean(record.needsMedical),
            createdAt: record.createdAt
          });
          litePacket.signature = record.signature;

          let ack = null;
          if (!record.relayMetadata) {
            ack = await sendSosLiteViaSocket(litePacket);
          }
          if (!ack) {
            ack = await sendSosLiteHttp(litePacket, record.token, record.relayMetadata);
          }
          record.liteSynced = true;
          record.backendAck = ack;
        }

        // 2. Details sync if lite acknowledged
        if (record.liteSynced && !record.detailsSynced) {
          const detailsPayload = record.detailsPayload || {
            clientIncidentId: record.clientIncidentId,
            description: record.description,
            contactName: record.contactName,
            contactPhone: record.contactPhone,
            village: record.village,
            district: record.district,
            state: record.state,
            photos: record.photos || []
          };
          await sendSosDetailsHttp(detailsPayload, record.token);
          record.detailsSynced = true;
        }

        record.syncStatus = 'SERVER_RECEIVED';
        record.syncedAt = new Date().toISOString();
        record.lastErrorCode = null;
        record.lastErrorMessage = null;
        await withQueueStore('readwrite', (store) => store.put(record));
        console.log(`✓ Synchronized queued SOS ${record.clientIncidentId}`);
      } catch (err) {
        const classification = classifySyncError(err);

        if (classification.type === 'DEVICE_UNKNOWN') {
          const currentDeviceId = getOrCreateDeviceId();
          if (record.deviceId === currentDeviceId) {
            try {
              console.log(`Attempting re-registration for device ${currentDeviceId}...`);
              const regOk = await registerDeviceWithBackend(record.userId);
              if (regOk) {
                // Retry once
                const ack = await sendSosLiteHttp(record.litePacket, record.token);
                record.liteSynced = true;
                record.backendAck = ack;
                record.syncStatus = 'SERVER_RECEIVED';
                record.syncedAt = new Date().toISOString();
                record.lastErrorCode = null;
                record.lastErrorMessage = null;
                await withQueueStore('readwrite', (store) => store.put(record));
                console.log(`✓ Re-registration succeeded, synchronized SOS ${record.clientIncidentId}`);
                continue;
              }
            } catch (reRegErr) {
              console.warn('Re-registration retry failed:', reRegErr.message);
            }
          }

          // Marked rejected
          record.syncStatus = 'SYNC_REJECTED';
          record.lastErrorCode = 'DEVICE_UNKNOWN';
          record.lastErrorMessage = classification.reason;
          record.lastAttemptAt = Date.now();
          await withQueueStore('readwrite', (store) => store.put(record));
          console.warn(`Record ${record.clientIncidentId} rejected: DEVICE_UNKNOWN`);
        } else if (classification.type === 'PERMANENT') {
          record.syncStatus = 'SYNC_REJECTED';
          record.lastErrorCode = classification.code || 'VALIDATION_ERROR';
          record.lastErrorMessage = classification.reason;
          record.lastAttemptAt = Date.now();
          await withQueueStore('readwrite', (store) => store.put(record));
          console.warn(`Record ${record.clientIncidentId} permanently rejected: ${classification.code} - ${classification.reason}`);
        } else {
          // TRANSIENT
          record.retryCount = (record.retryCount || 0) + 1;
          record.lastAttemptTime = Date.now();
          record.lastAttemptAt = Date.now();
          record.lastErrorCode = String(err.status || err.code || 'TRANSIENT');
          record.lastErrorMessage = classification.reason;
          record.nextRetryDelayMs = computeBackoffWithJitter(record.retryCount);
          record.syncStatus = record.liteSynced ? 'SYNCING' : 'OFFLINE_QUEUE_ONLY';
          await withQueueStore('readwrite', (store) => store.put(record));
          console.warn(`Retry pending for ${record.clientIncidentId}:`, err.message);
        }
      }
    }
  } finally {
    isSyncRunning = false;
  }
}

/**
 * Resend a rejected report as a brand-new report (never mutates or re-signs old packet)
 */
export async function resendAsNewReport(oldIncidentId) {
  const oldRecord = await withQueueStore('readonly', (store) => store.get(oldIncidentId));
  if (!oldRecord) throw new Error('Original SOS record not found');

  const newIncidentId = `sos_${Date.now()}_${crypto.randomUUID().slice(0, 8)}`;
  const currentDeviceId = getOrCreateDeviceId();
  const createdAt = new Date().toISOString();

  const unsignedLite = buildSosLitePayload({
    clientIncidentId: newIncidentId,
    deviceId: currentDeviceId,
    incidentType: oldRecord.incidentType || oldRecord.emergencyType || 'Medical',
    lat: oldRecord.latitude || oldRecord.lat,
    lng: oldRecord.longitude || oldRecord.lng,
    locationSource: oldRecord.locationSource || 'GPS_EXACT',
    locationAccuracy: oldRecord.locationAccuracy || 18,
    peopleAffected: oldRecord.peopleAffected || 1,
    vulnerableCount: oldRecord.vulnerableCount || 0,
    needsMedical: Boolean(oldRecord.needsMedical),
    createdAt
  });

  // Ensure current device identity is registered with backend before signing
  if (typeof navigator !== 'undefined' && navigator.onLine) {
    try {
      await registerDeviceWithBackend(oldRecord.userId);
    } catch (regErr) {
      console.warn('Pre-resend device registration notice:', regErr);
    }
  }

  const signature = await signEmergencyPayload(unsignedLite).catch((err) => {
    console.warn('WebCrypto resend signing fallback:', err);
    return `sim_sig_${Date.now()}_${currentDeviceId}`;
  });

  const litePacket = {
    ...unsignedLite,
    signature
  };

  const detailsPayload = oldRecord.detailsPayload || {
    clientIncidentId: newIncidentId,
    description: oldRecord.description || `Emergency ${unsignedLite.incidentType} dispatch request`,
    contactName: oldRecord.contactName || null,
    contactPhone: oldRecord.contactPhone || null,
    photos: oldRecord.photos || [],
    village: oldRecord.village || '',
    district: oldRecord.district || 'Dehradun',
    state: oldRecord.state || 'Uttarakhand',
    extraNotes: oldRecord.extraNotes || ''
  };
  detailsPayload.clientIncidentId = newIncidentId;

  const newRecord = {
    clientIncidentId: newIncidentId,
    userId: oldRecord.userId,
    deviceId: currentDeviceId,
    litePacket,
    detailsPayload,
    syncStatus: 'OFFLINE_QUEUE_ONLY',
    liteSynced: false,
    detailsSynced: false,
    retryCount: 0,
    lastAttemptTime: null,
    lastAttemptAt: null,
    lastErrorCode: null,
    lastErrorMessage: null,
    nextRetryDelayMs: 2000,
    queuedAt: createdAt,
    token: oldRecord.token || getToken(),
    ...unsignedLite,
    latitude: unsignedLite.lat,
    longitude: unsignedLite.lng,
    description: detailsPayload.description,
    contactName: detailsPayload.contactName,
    contactPhone: detailsPayload.contactPhone,
    village: detailsPayload.village,
    district: detailsPayload.district,
    state: detailsPayload.state,
    priority: computeLitePriority(unsignedLite),
    signature,
    replacedOldId: oldIncidentId
  };

  await withQueueStore('readwrite', (store) => {
    store.delete(oldIncidentId);
    return store.put(newRecord);
  });

  console.log(`✓ Replaced rejected report ${oldIncidentId} with new report ${newIncidentId}`);
  // Transmit immediately in real time
  await syncPendingSOS().catch(() => {});
  return newRecord;
}

/**
 * Discard a single report from IndexedDB
 */
export async function discardReport(clientIncidentId) {
  await withQueueStore('readwrite', (store) => store.delete(clientIncidentId));
}

/**
 * Clear all SYNC_REJECTED reports
 */
export async function clearRejectedReports() {
  const records = await withQueueStore('readonly', (store) => store.getAll());
  const rejected = records.filter((r) => r.syncStatus === 'SYNC_REJECTED');
  await withQueueStore('readwrite', (store) => {
    rejected.forEach((r) => store.delete(r.clientIncidentId));
  });
  return rejected.length;
}

/**
 * Request Service Worker Background Sync
 */
export async function requestBackgroundSync() {
  if (!('serviceWorker' in navigator)) return;
  try {
    const registration = await navigator.serviceWorker.ready;
    if ('sync' in registration) {
      await registration.sync.register('sync-sos');
    }
  } catch (error) {
    console.warn('Background sync registration notice:', error.message);
  }
}

/**
 * Automatic Sync Daemon:
 * - Listens for 'online' event and checks /api/health
 * - Listens for app focus / visibility change
 * - Periodic ping every 25s while records pending
 */
export function startAutoSync() {
  const trySync = async () => {
    const state = await checkConnectivity();
    if (state === 'ONLINE') {
      await syncPendingSOS();
    }
  };

  const onOnline = () => {
    checkConnectivity().then((st) => {
      if (st === 'ONLINE') syncPendingSOS();
    });
  };

  const onOffline = () => {
    updateConnectivityState('OFFLINE');
  };

  const onVisibilityChange = () => {
    if (document.visibilityState === 'visible') {
      trySync();
    }
  };

  window.addEventListener('online', onOnline);
  window.addEventListener('offline', onOffline);
  window.addEventListener('focus', trySync);
  document.addEventListener('visibilitychange', onVisibilityChange);

  // Periodic connectivity & pending sync check (every 25s)
  const interval = setInterval(async () => {
    const count = await getPendingCount();
    if (count > 0 || currentConnectivity !== 'ONLINE') {
      trySync();
    }
  }, 25000);

  // Initial check
  trySync();

  return () => {
    window.removeEventListener('online', onOnline);
    window.removeEventListener('offline', onOffline);
    window.removeEventListener('focus', trySync);
    document.removeEventListener('visibilitychange', onVisibilityChange);
    clearInterval(interval);
  };
}
