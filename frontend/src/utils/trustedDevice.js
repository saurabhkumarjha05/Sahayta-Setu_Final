import { API_URL, getToken } from '../api.js';

const DB_NAME = 'sosDB';
const IDENTITY_STORE = 'trustedDeviceStore';
const DEVICE_ID_KEY = 'sahayta_device_id';

/**
 * Open IndexedDB for device identity store
 */
function openIdentityDB() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 2);

    request.onupgradeneeded = (event) => {
      const db = event.target.result;
      if (!db.objectStoreNames.contains(IDENTITY_STORE)) {
        db.createObjectStore(IDENTITY_STORE, { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains('emergencySOSQueue')) {
        db.createObjectStore('emergencySOSQueue', { keyPath: 'clientIncidentId' });
      }
      if (!db.objectStoreNames.contains('alertsCacheStore')) {
        db.createObjectStore('alertsCacheStore', { keyPath: '_id' });
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

/**
 * Deterministic JSON stringifier matching backend
 */
export function canonicalStringify(obj) {
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
 * Get or create unique device identity
 */
export function getOrCreateDeviceId() {
  let deviceId = localStorage.getItem(DEVICE_ID_KEY);
  if (!deviceId) {
    deviceId = `dev_${crypto.randomUUID()}`;
    localStorage.setItem(DEVICE_ID_KEY, deviceId);
  }
  return deviceId;
}

/**
 * Generate or load ECDSA P-256 WebCrypto keypair
 */
export async function getOrCreateEmergencyKeypair() {
  const db = await openIdentityDB();
  const deviceId = getOrCreateDeviceId();

  const existing = await new Promise((resolve) => {
    const tx = db.transaction(IDENTITY_STORE, 'readonly');
    const store = tx.objectStore(IDENTITY_STORE);
    const req = store.get(deviceId);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => resolve(null);
  });

  if (existing && existing.privateKey && existing.publicKeyJwk) {
    return {
      deviceId,
      privateKey: existing.privateKey,
      publicKeyJwk: existing.publicKeyJwk
    };
  }

  // Generate new ECDSA P-256 keypair
  const keyPair = await window.crypto.subtle.generateKey(
    {
      name: 'ECDSA',
      namedCurve: 'P-256'
    },
    false, // private key non-extractable from memory
    ['sign', 'verify']
  );

  const publicKeyJwk = await window.crypto.subtle.exportKey('jwk', keyPair.publicKey);

  const record = {
    id: deviceId,
    deviceId,
    privateKey: keyPair.privateKey,
    publicKeyJwk,
    createdAt: new Date().toISOString()
  };

  await new Promise((resolve, reject) => {
    const tx = db.transaction(IDENTITY_STORE, 'readwrite');
    const store = tx.objectStore(IDENTITY_STORE);
    const req = store.put(record);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });

  return {
    deviceId,
    privateKey: keyPair.privateKey,
    publicKeyJwk
  };
}

/**
 * Register trusted device with backend
 */
export async function registerDeviceWithBackend(userId) {
  try {
    const { deviceId, publicKeyJwk } = await getOrCreateEmergencyKeypair();
    const token = getToken();

    const response = await fetch(`${API_URL}/api/auth/devices/register`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {})
      },
      body: JSON.stringify({
        deviceId,
        publicKey: publicKeyJwk,
        userId,
        deviceName: `${navigator.userAgent.slice(0, 40)}...`
      })
    });

    if (response.ok) {
      console.log('✓ Trusted emergency device identity registered with backend:', deviceId);
      return true;
    }
  } catch (err) {
    console.warn('Device registration deferred (offline):', err.message);
  }
  return false;
}

/**
 * Cryptographically sign an emergency SOS payload using Web Crypto API
 */
export async function signEmergencyPayload(payload) {
  const { privateKey } = await getOrCreateEmergencyKeypair();
  const canonical = canonicalStringify(payload);
  const encoder = new TextEncoder();
  const data = encoder.encode(canonical);

  const signatureBuffer = await window.crypto.subtle.sign(
    {
      name: 'ECDSA',
      hash: { name: 'SHA-256' }
    },
    privateKey,
    data
  );

  // Convert binary signature to Base64
  let binary = '';
  const bytes = new Uint8Array(signatureBuffer);
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}
