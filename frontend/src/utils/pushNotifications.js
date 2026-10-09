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
    if (!keyRes.ok) throw new Error('Could not fetch VAPID key');
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
    await fetch(`${API_URL}/api/alerts/subscribe`, {
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

    console.log(`✓ Web Push subscription registered for ${district}, ${state}`);
    return { supported: true, status: 'subscribed', subscription };
  } catch (err) {
    console.warn('Web Push registration notice:', err.message);
    return { supported: true, status: 'error', error: err.message };
  }
}
