import { io } from 'socket.io-client';
import { API_URL, getToken } from '../api';

let socket = null;

export function getSocket() {
  if (!socket) {
    socket = io(API_URL, {
      auth: {
        token: getToken() || undefined
      },
      reconnection: true,
      reconnectionAttempts: 10,
      reconnectionDelay: 2000,
      transports: ['websocket', 'polling']
    });

    socket.on('connect', () => {
      console.log('✓ Socket.IO connected to Sahayta Setu Real-time Server');
    });

    socket.on('connect_error', (err) => {
      console.warn('Socket connection fallback (polling):', err.message);
    });
  }
  return socket;
}

export function subscribeToDistrict(district, role) {
  const s = getSocket();
  if (district) {
    s.emit('join:district', district);
  }
  if (role) {
    s.emit('join:role', role);
  }
}

export function refreshSocketAuth() {
  if (!socket) return;
  socket.auth = { token: getToken() || undefined };
  if (socket.connected) {
    socket.disconnect();
    socket.connect();
  }
}

export function disconnectSocket() {
  if (!socket) return;
  socket.disconnect();
  socket = null;
}
