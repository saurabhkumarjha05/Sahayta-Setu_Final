import { API_URL, getToken } from '../../api';
import { Capacitor, registerPlugin } from '@capacitor/core';

const NearbyMesh = registerPlugin('NearbyMesh');

export const hasNativeNearbyMesh = () =>
  Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'android';

export const startNativeNearbyMesh = () => NearbyMesh.start();
export const stopNativeNearbyMesh = () => NearbyMesh.stop();
export const addNativeMeshListener = (eventName, callback) =>
  NearbyMesh.addListener(eventName, callback);

/**
 * Base Emergency Transport
 */
export class EmergencyTransport {
  constructor(name) {
    this.name = name;
    this.listeners = [];
  }

  isSupported() {
    return false;
  }

  async send() {
    throw new Error('send() not implemented');
  }

  onReceive(callback) {
    if (typeof callback === 'function') {
      this.listeners.push(callback);
    }
  }

  notifyReceived(packet) {
    this.listeners.forEach((fn) => {
      try {
        fn(packet, this.name);
      } catch (e) {
        console.error(`Error in transport listener (${this.name}):`, e);
      }
    });
  }

  startListening() {}
  stopListening() {}
}

/**
 * 1. Internet Transport (REST + WebSockets)
 */
export class InternetTransport extends EmergencyTransport {
  constructor() {
    super('InternetTransport');
  }

  isSupported() {
    return typeof navigator !== 'undefined' && navigator.onLine;
  }

  async send(packet) {
    if (!this.isSupported()) return false;
    const token = getToken();

    const isRelay = packet.hopCount > 0;
    const endpoint = isRelay ? `${API_URL}/api/sos/relay` : `${API_URL}/api/sos`;

    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {})
      },
      body: JSON.stringify(packet)
    });

    if (!response.ok && response.status !== 200) {
      throw new Error(`Internet transport failed with HTTP ${response.status}`);
    }

    const data = await response.json();
    return data;
  }
}

/**
 * 2. Local Network / Tab-to-Tab Transport using BroadcastChannel
 * Enables immediate local peer simulation and LAN sync across tabs/devices
 */
export class LocalNetworkTransport extends EmergencyTransport {
  constructor() {
    super('LocalNetworkTransport');
    this.channelName = 'sahayta_setu_emergency_mesh';
    this.channel = null;
    this.lastPeerHeartbeat = 0;
  }

  isSupported() {
    return typeof window !== 'undefined' && 'BroadcastChannel' in window;
  }

  hasActivePeer() {
    // Peer active if heartbeat received in last 12 seconds
    return Date.now() - this.lastPeerHeartbeat < 12000;
  }

  startListening() {
    if (!this.isSupported() || this.channel) return;
    try {
      this.channel = new BroadcastChannel(this.channelName);
      this.channel.onmessage = (event) => {
        if (!event.data) return;
        if (event.data.type === 'PEER_HEARTBEAT') {
          this.lastPeerHeartbeat = Date.now();
          return;
        }
        if (event.data.type === 'EMERGENCY_RELAY_PACKET') {
          this.notifyReceived(event.data);
        }
      };

      // Periodic ping
      this.heartbeatTimer = setInterval(() => {
        try {
          if (this.channel) {
            this.channel.postMessage({ type: 'PEER_HEARTBEAT', time: Date.now() });
          }
        } catch {
          // channel closed
        }
      }, 5000);
    } catch (err) {
      console.warn('BroadcastChannel error:', err);
    }
  }

  stopListening() {
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
    if (this.channel) {
      this.channel.close();
      this.channel = null;
    }
  }

  async send(packet) {
    if (!this.isSupported()) return false;
    if (!this.channel) this.startListening();
    try {
      this.channel.postMessage({
        type: 'EMERGENCY_RELAY_PACKET',
        ...packet
      });
      return true;
    } catch {
      return false;
    }
  }
}

/**
 * 3. WebRTC Peer-to-Peer DataChannel Transport
 * Transports emergency packets across connected browser peers
 */
export class WebRTCTransport extends EmergencyTransport {
  constructor() {
    super('WebRTCTransport');
    this.peers = new Map();
  }

  isSupported() {
    return typeof window !== 'undefined' && 'RTCPeerConnection' in window;
  }

  hasActivePeer() {
    for (const dc of this.peers.values()) {
      if (dc.readyState === 'open') return true;
    }
    return false;
  }

  broadcastDataChannel(packet) {
    let sent = false;
    this.peers.forEach((dc) => {
      if (dc.readyState === 'open') {
        try {
          dc.send(JSON.stringify(packet));
          sent = true;
        } catch (e) {
          console.warn('DataChannel send error:', e);
        }
      }
    });
    return sent;
  }

  async send(packet) {
    if (!this.isSupported()) return false;
    return this.broadcastDataChannel(packet);
  }
}

/**
 * 4. Web Bluetooth Transport (Capability Detection & BLE Detection)
 */
export class WebBluetoothTransport extends EmergencyTransport {
  constructor() {
    super('WebBluetoothTransport');
    this.supported = false;
    if (typeof navigator !== 'undefined' && 'bluetooth' in navigator) {
      this.supported = true;
    }
  }

  isSupported() {
    return this.supported;
  }

  async send() {
    return false;
  }
}

/**
 * 5. Future Native Android / iOS Mesh Transport Adapter
 * Pluggable interface for Android Wi-Fi Direct, Nearby Connections, or BLE mesh
 */
export class FutureNativeMeshTransport extends EmergencyTransport {
  constructor() {
    super('FutureNativeMeshTransport');
    this.nativeBridge = hasNativeNearbyMesh() ? NearbyMesh : null;
    this.peerCount = 0;

    if (this.nativeBridge) {
      this.nativeBridge.addListener('meshPacketReceived', ({ packet }) => {
        try {
          const parsedPacket = JSON.parse(packet);
          this.notifyReceived(parsedPacket);
        } catch (error) {
          console.warn('Ignoring invalid nearby SOS packet:', error.message);
        }
      }).catch((error) => {
        console.warn('Nearby SOS listener could not be registered:', error.message);
      });

      this.nativeBridge.addListener('meshStatus', (status) => {
        this.peerCount = Number(status.peerCount) || 0;
        if (status.error) console.warn('Nearby SOS mesh status:', status.error);
        if (typeof window !== 'undefined') {
          window.dispatchEvent(new CustomEvent('sahayta:mesh-status', { detail: status }));
        }
      }).catch((error) => {
        console.warn('Nearby SOS status listener could not be registered:', error.message);
      });
    }
  }

  isSupported() {
    return Boolean(this.nativeBridge);
  }

  async send(packet) {
    if (this.nativeBridge && typeof this.nativeBridge.broadcastEmergencyPacket === 'function') {
      try {
        const result = await this.nativeBridge.broadcastEmergencyPacket({ packet: JSON.stringify(packet) });
        this.peerCount = Number(result.peerCount) || 0;
        return Number(result.sentCount) > 0;
      } catch (err) {
        console.warn('Native mesh broadcast error:', err);
      }
    }
    return false;
  }
}

/**
 * Transport Manager
 * Discovers available transports, manages relay forwarding, and loop prevention
 */
export class EmergencyTransportManager {
  constructor() {
    this.transports = [
      new InternetTransport(),
      new LocalNetworkTransport(),
      new WebRTCTransport(),
      new WebBluetoothTransport(),
      new FutureNativeMeshTransport()
    ];

    this.seenIncidentIds = new Set();
    this.maxHopCount = 5;
    this.onRelayReceivedCallbacks = [];

    // Start listeners
    this.transports.forEach((t) => {
      t.onReceive((packet, transportName) => this.handleIncomingPacket(packet, transportName));
      t.startListening();
    });
  }

  /**
   * Determine current operational communication state:
   * ONLINE | LOCAL_RELAY_AVAILABLE | OFFLINE_QUEUE_ONLY
   */
  getCommunicationState() {
    const isOnline = typeof navigator !== 'undefined' && navigator.onLine;
    if (isOnline) return 'ONLINE';

    const local = this.transports.find((t) => t.name === 'LocalNetworkTransport');
    const webrtc = this.transports.find((t) => t.name === 'WebRTCTransport');

    if ((local && local.hasActivePeer()) || (webrtc && webrtc.hasActivePeer())) {
      return 'LOCAL_RELAY_AVAILABLE';
    }

    return 'OFFLINE_QUEUE_ONLY';
  }

  getCapabilities() {
    const isOnline = typeof navigator !== 'undefined' && navigator.onLine;
    const local = this.transports.find((t) => t.name === 'LocalNetworkTransport');
    const localHasPeer = local && local.hasActivePeer();

    return {
      internet: {
        supported: true,
        active: isOnline,
        label: isOnline ? 'Online (REST/WebSockets)' : 'Disconnected (Offline Mode)'
      },
      localNetwork: {
        supported: typeof window !== 'undefined' && 'BroadcastChannel' in window,
        active: localHasPeer,
        label: localHasPeer ? 'Active Peer Connected (BroadcastChannel)' : 'Listening for Local Peers'
      },
      webRTC: {
        supported: typeof window !== 'undefined' && 'RTCPeerConnection' in window,
        active: false,
        label: 'Supported (P2P DataChannels)'
      },
      webBluetooth: {
        supported: typeof navigator !== 'undefined' && 'bluetooth' in navigator,
        active: false,
        label:
          typeof navigator !== 'undefined' && 'bluetooth' in navigator
            ? 'Supported (Requires BLE pairing gesture)'
            : 'Unsupported by current browser'
      },
      nativeMesh: {
        supported: hasNativeNearbyMesh(),
        active: this.transports.find((t) => t.name === 'FutureNativeMeshTransport')?.peerCount > 0,
        label: hasNativeNearbyMesh()
          ? 'Android Nearby Connections (Wi-Fi + Bluetooth)'
          : 'Install the Android companion app for automatic nearby SOS relay'
      }
    };
  }

  /**
   * Transmit packet over best available transports
   */
  async dispatch(packet) {
    const results = {};
    if (packet?.clientIncidentId) {
      this.seenIncidentIds.add(packet.clientIncidentId);
    }

    // 1. Try Internet first if online
    const internet = this.transports.find((t) => t.name === 'InternetTransport');
    if (internet && internet.isSupported()) {
      try {
        const response = await internet.send(packet);
        results.internet = { success: true, response };
        return {
          success: true,
          transport: 'InternetTransport',
          communicationState: 'SERVER_RECEIVED',
          results
        };
      } catch (err) {
        results.internet = { success: false, error: err.message };
      }
    }

    // 2. Transmit via Local Network / Mesh Relay
    const local = this.transports.find((t) => t.name === 'LocalNetworkTransport');
    let localRelayed = false;
    if (local && local.isSupported()) {
      try {
        localRelayed = await local.send(packet);
        results.localNetwork = { success: localRelayed };
      } catch (err) {
        results.localNetwork = { success: false, error: err.message };
      }
    }

    // 3. Native mesh if available
    const nativeTransport = this.transports.find((t) => t.name === 'FutureNativeMeshTransport');
    let nativeRelayed = false;
    if (nativeTransport && nativeTransport.isSupported()) {
      nativeRelayed = await nativeTransport.send(packet);
    }

    const hasPeer = (localRelayed && local && local.hasActivePeer()) || nativeRelayed;
    const commState = hasPeer ? 'LOCAL_RELAY_AVAILABLE' : 'OFFLINE_QUEUE_ONLY';

    return {
      success: false,
      queuedLocally: true,
      communicationState: commState,
      message: hasPeer
        ? 'Broadcast to a nearby device. SOS remains saved on this device until the authority server confirms receipt.'
        : 'Your SOS is securely stored on this device. No communication path is currently available.',
      results
    };
  }

  /**
   * Handle an incoming relayed packet from another device (Store-and-Forward)
   * Preserves originDeviceId, clientIncidentId, originalTimestamp, originalPayload, originalSignature
   */
  async handleIncomingPacket(packet, transportName) {
    if (!packet || !packet.clientIncidentId) return;

    // Loop prevention & hop limit
    if (this.seenIncidentIds.has(packet.clientIncidentId)) {
      return;
    }
    if ((packet.hopCount || 0) >= this.maxHopCount) {
      console.warn(`Dropped packet ${packet.clientIncidentId}: max hop count reached`);
      return;
    }

    // TTL check (discard if older than 24 hours)
    const timestamp = packet.originalTimestamp || packet.timestamp || Date.now();
    if (Date.now() - timestamp > 24 * 60 * 60 * 1000) {
      console.warn(`Dropped packet ${packet.clientIncidentId}: TTL expired`);
      return;
    }

    this.seenIncidentIds.add(packet.clientIncidentId);

    // Relay packet creation preserving the original creator's payload & signature!
    const relayPacket = {
      type: 'EMERGENCY_RELAY_PACKET',
      originDeviceId: packet.originDeviceId,
      clientIncidentId: packet.clientIncidentId,
      originalTimestamp: packet.originalTimestamp || packet.timestamp,
      originalPayload: packet.originalPayload || packet.payload,
      originalSignature: packet.originalSignature || packet.signature,
      hopCount: (packet.hopCount || 0) + 1,
      maxHopCount: this.maxHopCount,
      relayDeviceId: 'peer-relay-device',
      relayTimestamp: new Date().toISOString(),
      district: packet.district || null,
      state: packet.state || null,
      village: packet.village || null,
      payload: packet.originalPayload || packet.payload,
      signature: packet.originalSignature || packet.signature
    };

    console.log(
      `📡 Store-and-Forward Emergency Relay Packet Received via ${transportName} (Hop ${relayPacket.hopCount}) for Incident: ${packet.clientIncidentId}`
    );

    // If this device has Internet access, immediately forward the relayed packet to Sahayta Setu server!
    let serverReceived = false;
    const internet = this.transports.find((t) => t.name === 'InternetTransport');
    if (internet && internet.isSupported()) {
      try {
        await internet.send(relayPacket);
        serverReceived = true;
        console.log(`✓ Relayed SOS ${packet.clientIncidentId} successfully uploaded to Sahayta Setu server!`);
      } catch (err) {
        console.warn('Could not forward relay packet to server:', err.message);
      }
    }

    this.onRelayReceivedCallbacks.forEach((cb) => {
      Promise.resolve(cb(relayPacket, { serverReceived, transportName })).catch((error) => {
        console.error('Could not store or forward relayed SOS:', error);
      });
    });
  }

  onRelayReceived(callback) {
    if (typeof callback === 'function') {
      this.onRelayReceivedCallbacks.push(callback);
    }
  }
}

export const transportManager = new EmergencyTransportManager();
