const webpush = require('web-push');
const mongoose = require('mongoose');
const { verifyTokenString } = require('./auth');

let io = null;
let sosLiteSocketHandler = null;
const pushSubscriptions = new Map(); // endpoint -> { subscription, district, state, userId, role }

// Setup VAPID keys for Web Push
const VAPID_PUBLIC_KEY = process.env.VAPID_PUBLIC_KEY || 'BEl62iUYgUivxIkv69yViEuiBIa-Ib9-SkvMeAtA3LFgDzkrxZJjSgSnfckjBJuBkr3qBUYIHBQFLXYp5Nksh8U';
const VAPID_PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY || 'UUxI4O84qWn5s65n6N_W8vjZ9_V5t5R3N_V_Q8P_n_s';
const VAPID_EMAIL = process.env.VAPID_EMAIL || 'mailto:alerts@sahaytasetu.gov.in';

try {
  webpush.setVapidDetails(VAPID_EMAIL, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);
} catch (err) {
  console.warn('VAPID setup notice:', err.message);
}

/**
 * Initialize Socket.IO with HTTP Server
 */
function initRealtime(server) {
  const { Server } = require('socket.io');
  io = new Server(server, {
    cors: {
      origin: '*',
      methods: ['GET', 'POST', 'PATCH']
    }
  });

  // Socket.IO authentication middleware
  io.use(async (socket, next) => {
    try {
      const authHeader = socket.handshake.auth?.token || socket.handshake.headers?.authorization;
      let token = authHeader;
      if (token && token.startsWith('Bearer ')) {
        token = token.slice(7).trim();
      }

      if (!token) {
        // Allow unauthenticated connection for anonymous SOS reception, but without privileged rooms
        socket.user = null;
        return next();
      }

      const decoded = verifyTokenString(token);
      if (!decoded) {
        socket.user = null;
        return next();
      }

      // Check DB if connected
      if (mongoose.connection && mongoose.connection.readyState === 1 && decoded.id && mongoose.isValidObjectId(decoded.id)) {
        try {
          const User = require('../models/user');
          const dbUser = await User.findById(decoded.id);
          if (dbUser && dbUser.accountStatus !== 'DISABLED') {
            socket.user = {
              id: dbUser._id.toString(),
              role: dbUser.role,
              name: dbUser.name,
              verificationStatus: dbUser.verificationStatus,
              district: dbUser.district,
              state: dbUser.state,
              stateCode: dbUser.stateCode,
              districtCode: dbUser.districtCode,
              organizationId: dbUser.organizationId
            };
            return next();
          } else if (dbUser && dbUser.accountStatus === 'DISABLED') {
            return next(new Error('ACCOUNT_DISABLED'));
          }
        } catch (err) {
          console.warn('Socket user lookup error:', err.message);
        }
      }

      socket.user = decoded;
      next();
    } catch (err) {
      next();
    }
  });

  io.on('connection', (socket) => {
    const user = socket.user;

    // Join private room for user
    if (user && user.id) {
      socket.join(`user:${user.id}`);

      // Super admin joins admin room
      if (user.role === 'super_admin') {
        socket.join('admin');
      }

      // Verified control users join control & jurisdiction rooms
      if (['control', 'panchayat', 'district_authority', 'state_authority'].includes(user.role)) {
        if (user.verificationStatus === 'VERIFIED') {
          socket.join('role:control');
          if (user.district) {
            socket.join(`district:${String(user.district).trim().toLowerCase()}`);
          }
        }
      }

      // Verified NGO users join ngo room
      if (user.role === 'ngo') {
        if (user.verificationStatus === 'VERIFIED') {
          socket.join('role:ngo');
          if (user.district) {
            socket.join(`district:${String(user.district).trim().toLowerCase()}`);
          }
        }
      }
    }

    // Join district room with verification check
    socket.on('join:district', (district) => {
      if (!district) return;
      const room = `district:${String(district).trim().toLowerCase()}`;

      // Villagers can always join district room; orgs must be verified
      if (socket.user && ['control', 'ngo'].includes(socket.user.role)) {
        if (socket.user.verificationStatus !== 'VERIFIED') return;
      }
      socket.join(room);
    });

    // Join role room with verification check
    socket.on('join:role', (role) => {
      if (!role) return;
      if (role === 'admin') {
        if (socket.user?.role === 'super_admin') {
          socket.join('admin');
        }
        return;
      }

      if (['control', 'ngo'].includes(role)) {
        if (!socket.user || socket.user.verificationStatus !== 'VERIFIED') {
          return; // Block unverified/pending/suspended from joining privileged role rooms
        }
      }

      socket.join(`role:${role}`);
    });

    // Join SOS tracking room
    socket.on('track:sos', (sosId) => {
      if (sosId) {
        socket.join(`sos:${sosId}`);
      }
    });

    // Responder live location updates via socket
    socket.on('responder:position', (data) => {
      if (data && data.responderId) {
        io.emit('responder:location_changed', data);
        if (data.activeSosId) {
          io.to(`sos:${data.activeSosId}`).emit('sos:responder_location', data);
        }
      }
    });

    // SOS Lite real-time ingestion over Socket.IO
    socket.on('sos:lite', async (data, ack) => {
      try {
        if (typeof sosLiteSocketHandler === 'function') {
          const result = await sosLiteSocketHandler(data);
          if (typeof ack === 'function') ack(result);
        } else if (typeof ack === 'function') {
          ack({ error: 'Socket SOS Lite handler not registered' });
        }
      } catch (err) {
        if (typeof ack === 'function') ack({ error: err.message });
      }
    });
  });

  return io;
}

function getIo() {
  return io;
}

/**
 * Emit account status changed to a specific user's private room.
 * On suspend or revoke, also remove the socket from privileged rooms.
 */
function emitAccountStatusChanged(userId, payload) {
  if (!io || !userId) return;
  const userRoom = `user:${userId}`;
  io.to(userRoom).emit('account:status-changed', {
    verificationStatus: payload.verificationStatus,
    reason: payload.reason || null,
    timestamp: payload.timestamp || Date.now()
  });

  // If suspended or revoked, strip privileged rooms from active sockets of this user
  if (['SUSPENDED', 'REVOKED', 'REJECTED'].includes(payload.verificationStatus)) {
    const sockets = io.sockets.adapter.rooms.get(userRoom);
    if (sockets) {
      for (const socketId of sockets) {
        const s = io.sockets.sockets.get(socketId);
        if (s) {
          s.leave('role:control');
          s.leave('role:ngo');
          s.leave('admin');
          if (s.user) {
            s.user.verificationStatus = payload.verificationStatus;
          }
        }
      }
    }
  }
}

/**
 * Emit admin updates: pending count and new entity registration
 */
async function emitAdminPendingUpdate(newEntity = null) {
  if (!io) return;
  try {
    let pendingCount = 0;
    if (mongoose.connection && mongoose.connection.readyState === 1) {
      const VerifiedEntity = require('../models/verifiedEntity');
      pendingCount = await VerifiedEntity.countDocuments({
        $or: [{ verificationStatus: 'PENDING' }, { status: 'PENDING' }]
      });
    }

    io.to('admin').emit('admin:pending-count', { pendingCount, timestamp: Date.now() });

    if (newEntity) {
      io.to('admin').emit('admin:entity-registered', {
        entity: newEntity,
        pendingCount,
        timestamp: Date.now()
      });
    }
  } catch (err) {
    console.warn('emitAdminPendingUpdate error:', err.message);
  }
}

/**
 * Broadcast an emergency SOS to relevant rooms
 */
function broadcastNewSOS(sos, matchedResponders = []) {
  if (!io) return;
  const districtRoom = sos.district ? `district:${String(sos.district).trim().toLowerCase()}` : null;
  const payload = {
    sos,
    matchedResponders: matchedResponders.slice(0, 5),
    timestamp: Date.now()
  };

  if (districtRoom) {
    io.to(districtRoom).emit('emergency:new_sos', payload);
  }
  io.to('role:control').emit('emergency:new_sos', payload);
  io.to('role:ngo').emit('emergency:new_sos', payload);
  io.emit('sos:list_updated');
}

/**
 * Broadcast responder assignment locking
 */
function broadcastSOSAssigned(sos) {
  if (!io) return;
  const districtRoom = sos.district ? `district:${String(sos.district).trim().toLowerCase()}` : null;
  const payload = {
    sosId: sos._id,
    clientIncidentId: sos.clientIncidentId,
    assignedTo: sos.assignedTo,
    status: sos.status,
    assignedAt: sos.assignedAt
  };

  if (districtRoom) {
    io.to(districtRoom).emit('sos:assigned', payload);
  }
  io.to(`sos:${sos._id}`).emit('sos:status_changed', payload);
  io.emit('sos:list_updated');
}

/**
 * Broadcast responder live location update
 */
function broadcastResponderLocation(update) {
  if (!io) return;
  io.emit('responder:location_changed', update);
  if (update.activeSosId) {
    io.to(`sos:${update.activeSosId}`).emit('sos:responder_location', update);
  }
}

/**
 * Register a Web Push Subscription
 */
function savePushSubscription(subscription, metadata = {}) {
  if (!subscription || !subscription.endpoint) return;
  pushSubscriptions.set(subscription.endpoint, {
    subscription,
    district: metadata.district ? String(metadata.district).trim().toLowerCase() : null,
    state: metadata.state ? String(metadata.state).trim().toLowerCase() : null,
    userId: metadata.userId || null,
    role: metadata.role || 'villager',
    updatedAt: Date.now()
  });
}

/**
 * Send targeted Web Push notification to users in an affected district/state
 */
async function sendTargetedPush({ title, body, severity = 'High', alertId, targetState, targetDistrict, url = '/' }) {
  const payload = JSON.stringify({
    title: title || `🚨 SAHAYTA SETU ALERT: ${targetDistrict || 'Emergency'}`,
    body: body || 'Official emergency instructions issued. Tap to view.',
    icon: '/favicon.svg',
    badge: '/favicon.svg',
    severity,
    alertId,
    targetState,
    targetDistrict,
    timestamp: Date.now(),
    url
  });

  const distLower = targetDistrict ? String(targetDistrict).trim().toLowerCase() : null;
  const stateLower = targetState ? String(targetState).trim().toLowerCase() : null;

  let sentCount = 0;
  let failCount = 0;

  for (const [endpoint, subMeta] of pushSubscriptions.entries()) {
    const matchesDistrict = !distLower || !subMeta.district || subMeta.district === distLower;
    const matchesState = !stateLower || !subMeta.state || subMeta.state === stateLower;

    if (matchesDistrict && matchesState) {
      try {
        await webpush.sendNotification(subMeta.subscription, payload);
        sentCount++;
      } catch (err) {
        failCount++;
        if (err.statusCode === 404 || err.statusCode === 410) {
          pushSubscriptions.delete(endpoint);
        }
      }
    }
  }

  if (io) {
    const alertData = { title, body, severity, alertId, targetState, targetDistrict, timestamp: Date.now() };
    if (distLower) {
      io.to(`district:${distLower}`).emit('alert:published', alertData);
    }
    io.emit('alert:published', alertData);
  }

  return { sentCount, failCount, totalSubscribers: pushSubscriptions.size };
}

/**
 * Send a new SOS notification only to authority subscriptions covering its area.
 */
async function sendSOSAuthorityNotification(sos) {
  const authorityRoles = new Set([
    'control',
    'panchayat',
    'district_authority',
    'state_authority'
  ]);
  const targetDistrict = sos.district ? String(sos.district).trim().toLowerCase() : null;
  const targetState = sos.state ? String(sos.state).trim().toLowerCase() : null;
  const village = sos.village && sos.village !== 'Unknown' ? sos.village : sos.district || 'your area';
  const payload = JSON.stringify({
    title: `🚨 SOS ${sos.priority || 'HIGH'} · ${sos.district || 'Emergency'}`,
    body: `${sos.type || 'Emergency'} reported from ${village}. Open Sahayta Setu to respond.`,
    icon: '/favicon.svg',
    badge: '/favicon.svg',
    severity: sos.priority || 'HIGH',
    alertId: sos.clientIncidentId || sos._id,
    targetState: sos.state,
    targetDistrict: sos.district,
    timestamp: Date.now(),
    url: '/'
  });

  let sentCount = 0;
  let failCount = 0;

  for (const [endpoint, subMeta] of pushSubscriptions.entries()) {
    if (!authorityRoles.has(subMeta.role)) continue;

    const matchesState = !targetState || subMeta.state === targetState;
    const matchesDistrict = subMeta.role === 'state_authority'
      ? true
      : !targetDistrict || subMeta.district === targetDistrict;

    if (!matchesState || !matchesDistrict) continue;

    try {
      await webpush.sendNotification(subMeta.subscription, payload);
      sentCount++;
    } catch (err) {
      failCount++;
      if (err.statusCode === 404 || err.statusCode === 410) {
        pushSubscriptions.delete(endpoint);
      } else {
        console.warn('SOS authority push delivery failed:', err.message);
      }
    }
  }

  return { sentCount, failCount };
}

/**
 * Broadcast resource creation/update/deletion to jurisdiction rooms and general listeners
 */
function emitResourceCreated(shelter) {
  if (!io) return;
  const payload = { resource: shelter, action: 'created', timestamp: Date.now() };
  if (shelter.district) {
    io.to(`district:${String(shelter.district).trim().toLowerCase()}`).emit('resource:created', payload);
  }
  io.emit('resource:created', payload);
}

function emitResourceUpdated(shelter) {
  if (!io) return;
  const payload = { resource: shelter, action: 'updated', timestamp: Date.now() };
  if (shelter.district) {
    io.to(`district:${String(shelter.district).trim().toLowerCase()}`).emit('resource:updated', payload);
  }
  io.emit('resource:updated', payload);
}

function emitResourceClosed(shelterId, details = {}) {
  if (!io) return;
  const payload = { id: shelterId, ...details, action: 'closed', timestamp: Date.now() };
  if (details.district) {
    io.to(`district:${String(details.district).trim().toLowerCase()}`).emit('resource:closed', payload);
  }
  io.emit('resource:closed', payload);
}

/**
 * Emit entity status updated event to admin room and to the user's private room
 */
function emitAdminEntityUpdated(entity) {
  if (!io) return;
  io.to('admin').emit('admin:entity-updated', {
    entity,
    timestamp: Date.now()
  });
}

function setSosLiteSocketHandler(handler) {
  sosLiteSocketHandler = handler;
}

module.exports = {
  initRealtime,
  getIo,
  setSosLiteSocketHandler,
  VAPID_PUBLIC_KEY,
  broadcastNewSOS,
  broadcastSOSAssigned,
  broadcastResponderLocation,
  emitAccountStatusChanged,
  emitAdminPendingUpdate,
  emitAdminEntityUpdated,
  emitResourceCreated,
  emitResourceUpdated,
  emitResourceClosed,
  savePushSubscription,
  sendTargetedPush,
  sendSOSAuthorityNotification,
  pushSubscriptions
};
