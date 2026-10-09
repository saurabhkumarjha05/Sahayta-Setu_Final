const crypto = require('crypto');
const User = require('../models/user');

// In-memory store for trusted devices (useful in demo mode / fallback)
const deviceStore = new Map();

/**
 * Deterministic JSON stringifier to ensure exact byte-level match
 * between Web Crypto API on the client and Node.js verification on the server.
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
 * Register or update a trusted device for a user
 */
async function registerDevice(userId, deviceId, publicKey, deviceName = 'Web Client') {
  if (!deviceId || !publicKey) {
    throw new Error('deviceId and publicKey are required');
  }

  const deviceRecord = {
    userId: String(userId),
    deviceId,
    publicKey,
    deviceName,
    createdAt: new Date(),
    revoked: false
  };

  // Cache in memory
  const userDevices = deviceStore.get(String(userId)) || [];
  const existingIdx = userDevices.findIndex(d => d.deviceId === deviceId);
  if (existingIdx >= 0) {
    userDevices[existingIdx] = deviceRecord;
  } else {
    userDevices.push(deviceRecord);
  }
  deviceStore.set(String(userId), userDevices);

  // Persist to MongoDB if active
  try {
    const user = await User.findById(userId);
    if (user) {
      user.devices = user.devices || [];
      const dbIdx = user.devices.findIndex(d => d.deviceId === deviceId);
      if (dbIdx >= 0) {
        user.devices[dbIdx] = deviceRecord;
      } else {
        user.devices.push(deviceRecord);
      }
      // Deduplicate in case concurrent writes added duplicates
      user.devices = user.devices.filter((d, idx) => user.devices.findIndex(x => x.deviceId === d.deviceId) === idx);
      await user.save();
    }
  } catch (err) {
    // If running in demo mode or DB not available, in-memory store remains active
  }

  return deviceRecord;
}

/**
 * Revoke a trusted device
 */
async function revokeDevice(userId, deviceId) {
  const userDevices = deviceStore.get(String(userId)) || [];
  const dev = userDevices.find(d => d.deviceId === deviceId);
  if (dev) {
    dev.revoked = true;
  }

  try {
    const user = await User.findById(userId);
    if (user && user.devices) {
      const dbDev = user.devices.find(d => d.deviceId === deviceId);
      if (dbDev) {
        dbDev.revoked = true;
        await user.save();
      }
    }
  } catch (err) {
    // ignore
  }

  return { deviceId, revoked: true };
}

/**
 * Find a trusted device by user and device ID
 */
async function findDevice(userId, deviceId) {
  // If userId provided, check memory store first
  if (userId) {
    const userDevices = deviceStore.get(String(userId));
    if (userDevices) {
      const dev = userDevices.find(d => d.deviceId === deviceId);
      if (dev) return { ...dev, userId: String(userId) };
    }
  }

  // If not found yet, scan memory store across all devices
  for (const [uid, devices] of deviceStore.entries()) {
    const dev = devices.find(d => d.deviceId === deviceId);
    if (dev) return { ...dev, userId: dev.userId || uid };
  }

  // Check DB
  try {
    if (userId) {
      const user = await User.findById(userId);
      if (user && user.devices) {
        const dev = user.devices.find(d => d.deviceId === deviceId);
        if (dev) {
          const devObj = dev.toObject ? dev.toObject() : { ...dev };
          devObj.userId = String(user._id);
          // Cache it in memory
          const list = deviceStore.get(String(userId)) || [];
          if (!list.some(d => d.deviceId === deviceId)) {
            list.push(devObj);
            deviceStore.set(String(userId), list);
          }
          return devObj;
        }
      }
    }

    // Lookup by deviceId in MongoDB across all users (uses index on devices.deviceId)
    const userWithDevice = await User.findOne({ 'devices.deviceId': deviceId });
    if (userWithDevice && userWithDevice.devices) {
      const dev = userWithDevice.devices.find(d => d.deviceId === deviceId);
      if (dev) {
        const devObj = dev.toObject ? dev.toObject() : { ...dev };
        devObj.userId = String(userWithDevice._id);
        const list = deviceStore.get(String(userWithDevice._id)) || [];
        if (!list.some(d => d.deviceId === deviceId)) {
          list.push(devObj);
          deviceStore.set(String(userWithDevice._id), list);
        }
        return devObj;
      }
    }
  } catch (err) {
    // ignore
  }

  return null;
}

/**
 * Verifies an ECDSA P-256 signature using Node's crypto.subtle or Node crypto
 * @param {Object} publicKeyJWK - The public key in JWK format
 * @param {string} signatureBase64 - Base64 encoded signature
 * @param {string|Object} payload - The payload to verify
 */
async function verifyEmergencySignature(publicKeyJWK, signatureBase64, payload) {
  try {
    const canonicalPayload = typeof payload === 'string' ? payload : canonicalStringify(payload);
    const dataBuffer = Buffer.from(canonicalPayload, 'utf8');
    const signatureBuffer = Buffer.from(signatureBase64, 'base64');

    // Import the JWK public key into WebCrypto subtle API in Node.js
    const key = await crypto.subtle.importKey(
      'jwk',
      publicKeyJWK,
      { name: 'ECDSA', namedCurve: 'P-256' },
      true,
      ['verify']
    );

    const isValid = await crypto.subtle.verify(
      { name: 'ECDSA', hash: { name: 'SHA-256' } },
      key,
      signatureBuffer,
      dataBuffer
    );

    return isValid;
  } catch (err) {
    console.error('Signature verification error:', err.message);
    return false;
  }
}

/**
 * Validate emergency packet authenticity, replay protection, and device validity
 */
async function validateEmergencyPacket({ userId, deviceId, payload, signature }) {
  if (!deviceId) {
    return { valid: false, code: 'VALIDATION_ERROR', field: 'deviceId', error: 'Device identity is missing from emergency packet' };
  }
  if (!signature) {
    return { valid: false, code: 'VALIDATION_ERROR', field: 'signature', error: 'Cryptographic signature is missing from emergency packet' };
  }
  if (!payload || !payload.clientIncidentId) {
    return { valid: false, code: 'VALIDATION_ERROR', field: 'clientIncidentId', error: 'Emergency payload or clientIncidentId is missing' };
  }

  // Check timestamp: reject future timestamps > 10 mins or ancient replay > 30 days
  const now = Date.now();
  const pktTime = new Date(payload.createdAt || payload.timestamp).getTime();
  if (isNaN(pktTime)) {
    return { valid: false, code: 'VALIDATION_ERROR', field: 'createdAt', error: 'Invalid timestamp in emergency payload' };
  }
  if (pktTime > now + 10 * 60 * 1000) {
    return { valid: false, code: 'VALIDATION_ERROR', field: 'createdAt', error: 'Replay protection: timestamp is in the future' };
  }
  if (now - pktTime > 30 * 24 * 60 * 60 * 1000) {
    return { valid: false, code: 'PAYLOAD_EXPIRED', error: 'Emergency request expired (exceeds 30-day offline threshold)' };
  }

  // Lookup trusted device
  const device = await findDevice(userId, deviceId);
  if (!device) {
    return { valid: false, code: 'DEVICE_UNKNOWN', error: `Device ${deviceId} is not registered as a trusted emergency device` };
  }
  if (device.revoked) {
    return { valid: false, code: 'DEVICE_REVOKED', error: `Device ${deviceId} has been revoked by the user/authority` };
  }

  // Verify signature
  const isSignatureValid = await verifyEmergencySignature(device.publicKey, signature, payload);
  if (!isSignatureValid) {
    return { valid: false, code: 'SIGNATURE_INVALID', error: 'Cryptographic signature verification failed: Payload may have been tampered with' };
  }

  return { valid: true, device };
}

module.exports = {
  canonicalStringify,
  registerDevice,
  revokeDevice,
  findDevice,
  verifyEmergencySignature,
  validateEmergencyPacket,
  deviceStore
};
