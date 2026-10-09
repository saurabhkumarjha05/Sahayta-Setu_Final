// Sahayta Setu Service Worker
// Offline SOS Queue Synchronization, Web Push Alerts & Emergency Audio Precaching

const CACHE_NAME = "sahayta-assets-v1";
const DB_NAME = "sosDB";
const QUEUE_STORE = "emergencySOSQueue";
const ALERTS_STORE = "alertsCacheStore";
const configuredBackend = new URLSearchParams(self.location.search).get("api");
const BACKEND_BASE = configuredBackend || self.location.origin;
const LITE_URL = `${BACKEND_BASE}/api/sos/lite`;
const DETAILS_URL = `${BACKEND_BASE}/api/sos/details`;
const BACKEND_URL = `${BACKEND_BASE}/api/sos`;

const PRECACHE_URLS = [
  "/",
  "/index.html",
  "/favicon.svg",
  "/icons.svg",
  "/EmergencyAlert-Hindi.mp3",
  "/manifest.webmanifest",
  "/fonts/PublicSans-Regular.woff2",
  "/fonts/PublicSans-SemiBold.woff2",
  "/fonts/PublicSans-Bold.woff2",
  "/fonts/JetBrainsMono-Regular.woff2",
  "/fonts/JetBrainsMono-Medium.woff2"
];

self.addEventListener("install", (event) => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      // Non-blocking precaching so app shell never stalls
      return cache.addAll(PRECACHE_URLS).catch((err) => {
        console.warn("SW precaching notice (non-blocking):", err.message);
      });
    })
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.map((key) => {
          if (key !== CACHE_NAME) return caches.delete(key);
        })
      );
    }).then(() => self.clients.claim())
  );
});

// Safari & Chrome range request handler for audio in SW cache
async function handleAudioRequest(request) {
  const cache = await caches.open(CACHE_NAME);
  let cachedResponse = await cache.match(request, { ignoreSearch: true });

  if (!cachedResponse) {
    try {
      const networkResponse = await fetch(request);
      if (networkResponse.ok || networkResponse.status === 206) {
        cache.put(request, networkResponse.clone()).catch(() => {});
      }
      return networkResponse;
    } catch {
      return new Response("Audio offline fallback", { status: 404 });
    }
  }

  const rangeHeader = request.headers.get("range");
  if (!rangeHeader) {
    return cachedResponse;
  }

  const arrayBuffer = await cachedResponse.arrayBuffer();
  const bytes = /^bytes=(\d+)-(\d+)?$/.exec(rangeHeader);
  if (!bytes) {
    return cachedResponse;
  }

  const total = arrayBuffer.byteLength;
  const start = parseInt(bytes[1], 10);
  const end = bytes[2] ? parseInt(bytes[2], 10) : total - 1;

  if (start >= total || end >= total) {
    return new Response("", {
      status: 416,
      headers: { "Content-Range": `bytes */${total}` }
    });
  }

  const sliced = arrayBuffer.slice(start, end + 1);
  return new Response(sliced, {
    status: 206,
    statusText: "Partial Content",
    headers: {
      "Content-Type": cachedResponse.headers.get("Content-Type") || "audio/mpeg",
      "Content-Range": `bytes ${start}-${end}/${total}`,
      "Content-Length": String(sliced.byteLength),
      "Accept-Ranges": "bytes"
    }
  });
}

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);

  // Skip API, socket, and chrome extension calls
  if (url.pathname.startsWith("/api/") || url.pathname.startsWith("/socket.io/") || !url.protocol.startsWith("http")) {
    return;
  }

  // Handle emergency alert audio (safari range requests)
  if (url.pathname.endsWith(".mp3") || url.pathname.includes("EmergencyAlert-Hindi")) {
    event.respondWith(handleAudioRequest(event.request));
    return;
  }

  // Handle HTML navigation (network-first, falling back to cached index.html)
  if (event.request.mode === "navigate") {
    event.respondWith(
      fetch(event.request).catch(async () => {
        const cache = await caches.open(CACHE_NAME);
        return cache.match("/index.html") || cache.match("/");
      })
    );
    return;
  }

  // Cache-first for local static assets (svg, css, js)
  if (url.origin === self.location.origin) {
    event.respondWith(
      caches.match(event.request).then((cached) => {
        if (cached) return cached;
        return fetch(event.request).then((response) => {
          if (response.ok && event.request.method === "GET") {
            const clone = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone)).catch(() => {});
          }
          return response;
        });
      })
    );
  }
});

function openDatabase() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 2);

    request.onupgradeneeded = (event) => {
      const db = event.target.result;
      if (!db.objectStoreNames.contains(QUEUE_STORE)) {
        db.createObjectStore(QUEUE_STORE, { keyPath: "clientIncidentId" });
      }
      if (!db.objectStoreNames.contains("trustedDeviceStore")) {
        db.createObjectStore("trustedDeviceStore", { keyPath: "id" });
      }
      if (!db.objectStoreNames.contains(ALERTS_STORE)) {
        db.createObjectStore(ALERTS_STORE, { keyPath: "_id" });
      }
      if (!db.objectStoreNames.contains("pendingSOS")) {
        db.createObjectStore("pendingSOS", { keyPath: "id" });
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function withStore(storeName, mode, work) {
  return openDatabase().then(
    (db) =>
      new Promise((resolve, reject) => {
        const store = db.transaction(storeName, mode).objectStore(storeName);
        const request = work(store);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      })
  );
}

// Background Synchronization for Emergency SOS Queue
async function syncEmergencyQueue() {
  const records = await withStore(QUEUE_STORE, "readonly", (store) => store.getAll()).catch(() => []);

  for (const record of records) {
    if ((record.syncStatus === "SERVER_RECEIVED" || record.syncStatus === "SYNCED") && record.detailsSynced) continue;
    if (record.syncStatus === "SYNC_REJECTED") continue;

    try {
      const authHeader = record.token ? { Authorization: `Bearer ${record.token}` } : {};

      // If record contains compact SOS Lite packet
      if (record.litePacket) {
        if (!record.liteSynced) {
          const liteRes = await fetch(LITE_URL, {
            method: "POST",
            headers: { "Content-Type": "application/json", ...authHeader },
            body: JSON.stringify(record.litePacket)
          });
          if (liteRes.ok || liteRes.status === 200 || liteRes.status === 201) {
            record.liteSynced = true;
          } else if (liteRes.status >= 400 && liteRes.status < 500 && liteRes.status !== 429) {
            record.syncStatus = "SYNC_REJECTED";
            record.lastAttemptAt = Date.now();
            await withStore(QUEUE_STORE, "readwrite", (store) => store.put(record));
            continue;
          }
        }

        if (record.liteSynced && !record.detailsSynced && record.detailsPayload) {
          const detailsRes = await fetch(DETAILS_URL, {
            method: "POST",
            headers: { "Content-Type": "application/json", ...authHeader },
            body: JSON.stringify(record.detailsPayload)
          });
          if (detailsRes.ok || detailsRes.status === 200 || detailsRes.status === 201) {
            record.detailsSynced = true;
          }
        }

        record.syncStatus = "SERVER_RECEIVED";
        record.syncedAt = new Date().toISOString();
        await withStore(QUEUE_STORE, "readwrite", (store) => store.put(record));
        continue;
      }

      // Legacy fallback
      const response = await fetch(BACKEND_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...authHeader,
        },
        body: JSON.stringify({
          clientIncidentId: record.clientIncidentId,
          userId: record.userId,
          deviceId: record.deviceId,
          signature: record.signature,
          payload: {
            clientIncidentId: record.clientIncidentId,
            userId: record.userId,
            deviceId: record.deviceId,
            incidentType: record.incidentType,
            description: record.description,
            state: record.state,
            district: record.district,
            village: record.village,
            latitude: record.latitude,
            longitude: record.longitude,
            locationAccuracy: record.locationAccuracy,
            locationSource: record.locationSource,
            isApproximateLocation: record.isApproximateLocation,
            priority: record.priority,
            createdAt: record.createdAt,
            timestamp: record.timestamp,
            contactName: record.contactName,
            contactPhone: record.contactPhone
          }
        }),
      });

      if (response.ok || response.status === 200 || response.status === 201) {
        record.syncStatus = "SERVER_RECEIVED";
        record.syncedAt = new Date().toISOString();
        await withStore(QUEUE_STORE, "readwrite", (store) => store.put(record));
      }
    } catch (err) {
      console.warn("SW SOS sync retry scheduled:", err.message);
    }
  }
}

self.addEventListener("sync", (event) => {
  if (event.tag === "sync-sos") {
    event.waitUntil(syncEmergencyQueue());
  }
});

// ---------- Web Push Emergency Alerts ----------

self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { title: "🚨 SAHAYTA SETU ALERT", body: event.data ? event.data.text() : "Emergency notification" };
  }

  const title = data.title || "🚨 SAHAYTA SETU EMERGENCY ALERT";
  const severity = String(data.severity || "High").toLowerCase();

  // Vibration pattern based on severity
  let vibrationPattern = [200, 100, 200];
  if (severity === "critical" || severity === "severe") {
    vibrationPattern = [300, 100, 300, 100, 300, 100, 500];
  } else if (severity === "high") {
    vibrationPattern = [200, 100, 200, 100, 400];
  }

  const options = {
    body: data.body || "Critical warning issued for your region. Tap for safety instructions.",
    icon: "/favicon.svg",
    badge: "/favicon.svg",
    vibrate: vibrationPattern,
    tag: `sahayta-alert-${data.alertId || Date.now()}`,
    renotify: true,
    requireInteraction: severity === "critical" || severity === "severe" || severity === "high",
    data: {
      url: data.url || "/",
      alertId: data.alertId,
      timestamp: data.timestamp || Date.now()
    }
  };

  // Cache alert locally in IndexedDB for offline access
  const cachePromise = withStore(ALERTS_STORE, "readwrite", (store) => {
    return store.put({
      _id: data.alertId || `push-${Date.now()}`,
      title,
      message: data.body,
      riskLevel: data.severity || "High",
      district: data.targetDistrict,
      state: data.targetState,
      createdAt: new Date().toISOString()
    });
  }).catch(() => {});

  event.waitUntil(
    Promise.all([
      self.registration.showNotification(title, options),
      cachePromise
    ])
  );
});

// Tapping an emergency notification focuses or opens Sahayta Setu
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const targetUrl = (event.notification.data && event.notification.data.url) || "/";

  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clients) => {
      for (const client of clients) {
        if ("focus" in client) {
          return client.focus();
        }
      }
      return self.clients.openWindow(targetUrl);
    })
  );
});
