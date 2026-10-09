console.log("🚨 SOS Service Worker loaded");

const DB_NAME = "sosDB";
const STORE_NAME = "pendingSOS";
const BACKEND_URL = `${self.location.origin}/api/sos`;

// =====================================
// INSTALL
// =====================================

self.addEventListener("install", (event) => {
    console.log("🚨 Service Worker installed");
    self.skipWaiting();
});

// =====================================
// ACTIVATE
// =====================================

self.addEventListener("activate", (event) => {
    console.log("🚨 Service Worker activated");

    event.waitUntil(
        self.clients.claim()
    );
});

// =====================================
// OPEN INDEXEDDB
// =====================================

function openDatabase() {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open(DB_NAME, 2);

        request.onupgradeneeded = (event) => {
            const db = event.target.result;

            if (!db.objectStoreNames.contains(STORE_NAME)) {
                db.createObjectStore(STORE_NAME, { keyPath: "id" });
            }

            if (!db.objectStoreNames.contains("emergencySOSQueue")) {
                db.createObjectStore("emergencySOSQueue", { keyPath: "clientIncidentId" });
            }

            if (!db.objectStoreNames.contains("trustedDeviceStore")) {
                db.createObjectStore("trustedDeviceStore", { keyPath: "id" });
            }

            if (!db.objectStoreNames.contains("alertsCacheStore")) {
                db.createObjectStore("alertsCacheStore", { keyPath: "_id" });
            }
        };

        request.onsuccess = () => {
            resolve(request.result);
        };

        request.onerror = () => {
            reject(request.error);
        };
    });
}

// =====================================
// GET PENDING SOS
// =====================================

function getPendingSOS() {
    return openDatabase().then((db) => {
        return new Promise((resolve, reject) => {

            const transaction = db.transaction(
                STORE_NAME,
                "readonly"
            );

            const store = transaction.objectStore(
                STORE_NAME
            );

            const request = store.getAll();

            request.onsuccess = () => {
                resolve(request.result);
            };

            request.onerror = () => {
                reject(request.error);
            };
        });
    });
}

// =====================================
// MARK SOS AS SYNCED
// =====================================

function markAsSynced(id) {
    return openDatabase().then((db) => {

        return new Promise((resolve, reject) => {

            const transaction = db.transaction(
                STORE_NAME,
                "readwrite"
            );

            const store = transaction.objectStore(
                STORE_NAME
            );

            const request = store.get(id);

            request.onsuccess = () => {

                const record = request.result;

                if (record) {

                    record.syncStatus = "synced";

                    store.put(record);
                }

                resolve();
            };

            request.onerror = () => {
                reject(request.error);
            };
        });
    });
}

// =====================================
// SYNC SOS DATA
// =====================================

async function syncSOS() {

    console.log("🔄 Attempting SOS synchronization...");

    const pendingSOS = await getPendingSOS();

    console.log(
        "📦 Pending SOS records:",
        pendingSOS.length
    );

    for (const sos of pendingSOS) {

        if (sos.syncStatus !== "pending") {
            continue;
        }

        try {

            const response = await fetch(
                BACKEND_URL,
                {
                    method: "POST",

                    headers: {
                        "Content-Type": "application/json"
                    },

                    body: JSON.stringify({
                        location: {
                            lat: sos.latitude,
                            lng: sos.longitude
                        },

                        village: sos.village || "Unknown",

                        type: sos.emergencyType
                    })
                }
            );

            if (!response.ok) {
                throw new Error(
                    `Server returned ${response.status}`
                );
            }

            await markAsSynced(sos.id);

            console.log(
                "✅ SOS synchronized:",
                sos.id
            );

        } catch (error) {

            console.error(
                "❌ SOS synchronization failed:",
                error.message
            );

            // Stop here so the browser can retry later.
            throw error;
        }
    }
}

// =====================================
// BACKGROUND SYNC
// =====================================

self.addEventListener("sync", (event) => {

    console.log(
        "🔄 Background sync event:",
        event.tag
    );

    if (event.tag === "sync-sos") {

        event.waitUntil(
            syncSOS()
        );
    }
});