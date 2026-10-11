import { API_URL, getToken } from '../api';

function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = window.atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}

/**
 * Register Web Push Subscription for PWA Emergency Alerts
 */
export async function registerPushNotifications({ state, district, user }) {
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
    return { supported: false, status: 'unsupported' };
  }

  try {
    const permission = await Notification.requestPermission();
    if (permission !== 'granted') {
      return { supported: true, status: 'denied' };
    }

    // Get VAPID public key from backend
    const keyRes = await fetch(`${API_URL}/api/alerts/vapid-public-key`);
    if (!keyRes.ok) {
      const details = await keyRes.json().catch(() => ({}));
      throw new Error(details.error || `Web Push setup unavailable (${keyRes.status})`);
    }
    const { publicKey } = await keyRes.json();

    const registration = await navigator.serviceWorker.ready;
    let subscription = await registration.pushManager.getSubscription();

    if (!subscription) {
      const applicationServerKey = urlBase64ToUint8Array(publicKey);
      subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey
      });
    }

    // Send subscription to backend with district & state targeting
    const token = getToken();
    const subscribeRes = await fetch(`${API_URL}/api/alerts/subscribe`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {})
      },
      body: JSON.stringify({
        subscription,
        district: district || user?.district || 'Dehradun',
        state: state || user?.state || 'Uttarakhand'
      })
    });
    if (!subscribeRes.ok) {
      const details = await subscribeRes.json().catch(() => ({}));
      throw new Error(details.error || `Push subscription failed (${subscribeRes.status})`);
    }

    console.log(`✓ Web Push subscription registered for ${district}, ${state}`);
    return { supported: true, status: 'subscribed', subscription };
  } catch (err) {
    console.warn('Web Push registration notice:', err.message);
    return { supported: true, status: 'error', error: err.message };
  }
}

export async function getCachedAlerts() {
  if (!('indexedDB' in window)) return [];
  return new Promise((resolve) => {
    const request = indexedDB.open('sosDB', 2);
    request.onerror = () => resolve([]);
    request.onsuccess = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains('alertsCacheStore')) {
        db.close();
        resolve([]);
        return;
      }

      const read = db.transaction('alertsCacheStore', 'readonly')
        .objectStore('alertsCacheStore')
        .getAll();
      read.onsuccess = () => {
        db.close();
        resolve(Array.isArray(read.result)
          ? read.result.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
          : []);
      };
      read.onerror = () => {
        db.close();
        resolve([]);
      };
    };
  });
}

export async function showRealtimeAlertNotification(alert) {
  if (!alert || !('serviceWorker' in navigator)) return;
  try {
    const registration = await navigator.serviceWorker.ready;
    const severity = String(alert.severity || alert.riskLevel || 'High').toLowerCase();
    await registration.showNotification(
      alert.title || '🚨 Sahayta Setu emergency alert',
      {
        body: alert.body || alert.message || 'Official emergency alert issued for your region.',
        icon: '/logo-192.png',
        badge: '/logo-192.png',
        tag: `sahayta-current-alert-${String(alert.targetDistrict || alert.district || 'region').toLowerCase()}`,
        renotify: true,
        requireInteraction: ['critical', 'severe', 'high'].includes(severity),
        vibrate: ['critical', 'severe'].includes(severity)
          ? [300, 100, 300, 100, 500]
          : [200, 100, 300],
        data: { url: '/', alertId: alert.alertId || alert._id }
      }
    );
  } catch (error) {
    console.warn('Realtime notification notice:', error.message);
  }
}
