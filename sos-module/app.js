let currentLocation = null;

const LAST_LOCATION_KEY = "lastKnownLocation";

const locationButton = document.getElementById("locationButton");
const locationStatus = document.getElementById("locationStatus");
const sosButton = document.getElementById("sosButton");
const statusMessage = document.getElementById("statusMessage");

// ===============================
// INDEXEDDB SETUP
// ===============================

const DB_NAME = "sosDB";
const STORE_NAME = "pendingSOS";

function openDatabase() {
    return new Promise((resolve, reject) => {

        const request = indexedDB.open(DB_NAME, 2);

        request.onupgradeneeded = (event) => {

            const db = event.target.result;

            if (!db.objectStoreNames.contains(STORE_NAME)) {

                db.createObjectStore(STORE_NAME, {
                    keyPath: "id"
                });

            }

            if (!db.objectStoreNames.contains("emergencySOSQueue")) {
                db.createObjectStore("emergencySOSQueue", {
                    keyPath: "clientIncidentId"
                });
            }

            if (!db.objectStoreNames.contains("trustedDeviceStore")) {
                db.createObjectStore("trustedDeviceStore", {
                    keyPath: "id"
                });
            }

            if (!db.objectStoreNames.contains("alertsCacheStore")) {
                db.createObjectStore("alertsCacheStore", {
                    keyPath: "_id"
                });
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

// ===============================
// GET USER LOCATION
// ===============================

locationButton.addEventListener("click", () => {
    getLocationWithFallback();
});

function getLocationWithFallback() {
    if (!navigator.geolocation) {
        useLastKnownLocation();
        return;
    }

    locationStatus.textContent =
        "📍 Getting your location...";

    navigator.geolocation.getCurrentPosition(
        (position) => {
            const latitude = position.coords.latitude;
            const longitude = position.coords.longitude;

            currentLocation = {
                latitude: latitude,
                longitude: longitude
            };

            // Save the latest successful location locally
            localStorage.setItem(
                LAST_LOCATION_KEY,
                JSON.stringify(currentLocation)
            );

            locationStatus.textContent =
                `📍 Location captured: ${latitude.toFixed(5)}, ${longitude.toFixed(5)}`;

            console.log(
                "📍 Fresh GPS location:",
                currentLocation
            );
        },
        (error) => {
            console.error(
                "GPS location failed:",
                error
            );

            useLastKnownLocation();
        },
        {
            enableHighAccuracy: true,
            timeout: 10000,
            maximumAge: 60000
        }
    );
}

function useLastKnownLocation() {
    const savedLocation =
        localStorage.getItem(LAST_LOCATION_KEY);

    if (!savedLocation) {
        currentLocation = null;

        locationStatus.textContent =
            "❌ No location available. Please connect to the internet and capture your location once.";

        return;
    }

    try {
        currentLocation =
            JSON.parse(savedLocation);

        locationStatus.textContent =
            `📍 Using last known location: ${currentLocation.latitude.toFixed(5)}, ${currentLocation.longitude.toFixed(5)}`;

        console.log(
            "📍 Last known location:",
            currentLocation
        );
    } catch (error) {
        console.error(
            "Invalid saved location:",
            error
        );

        currentLocation = null;

        locationStatus.textContent =
            "❌ Saved location could not be used.";
    }
}

// ===============================
// SEND SOS
// ===============================

sosButton.addEventListener("click", async () => {

    const emergencyType =
        document.getElementById("emergencyType").value;

    // Check emergency type
    if (!emergencyType) {

        statusMessage.textContent =
            "⚠️ Please select the emergency type.";

        return;
    }

    // Check location
    if (!currentLocation) {
    useLastKnownLocation();
}

if (!currentLocation) {
    statusMessage.textContent =
        "⚠️ No location available. Please capture your location once while connected.";
    return;
}

    // Create SOS object
    const sosData = {

        emergencyType: emergencyType,

        latitude: currentLocation.latitude,

        longitude: currentLocation.longitude,

        timestamp: new Date().toISOString()
    };

    try {

        // Always save SOS locally first
        const savedSOS = await saveSOSLocally(sosData);

        console.log(
            "📦 SOS stored locally:",
            savedSOS
        );

        // ===============================
        // TRY BACKGROUND SYNC
        // ===============================

        if ("serviceWorker" in navigator) {

            const registration =
                await navigator.serviceWorker.ready;

            if ("sync" in registration) {

                try {

                    await registration.sync.register(
                        "sync-sos"
                    );

                    console.log(
                        "🔄 Background SOS sync registered"
                    );

                } catch (syncError) {

                    console.error(
                        "Background sync registration failed:",
                        syncError
                    );

                }
            }
        }

        // ===============================
        // TRY IMMEDIATE SEND IF ONLINE
        // ===============================

        if (navigator.onLine) {

            statusMessage.textContent =
                "📡 SOS saved. Sending...";

            try {

                await syncPendingSOSFromPage();

                statusMessage.textContent =
                    "✅ SOS sent successfully!";

            } catch (error) {

                console.error(
                    "Immediate SOS sync failed:",
                    error
                );

                statusMessage.textContent =
                    "📦 SOS saved locally. It will be sent when connection returns.";

            }

        } else {

            statusMessage.textContent =
                "📦 No internet. SOS saved and will be sent when connection returns.";

        }

    } catch (error) {

        console.error(
            "SOS error:",
            error
        );

        statusMessage.textContent =
            "❌ Failed to save SOS.";

    }

});

// ===============================
// SAVE SOS LOCALLY
// ===============================

function saveSOSLocally(sosData) {

    return openDatabase().then((db) => {

        return new Promise((resolve, reject) => {

            const transaction = db.transaction(
                STORE_NAME,
                "readwrite"
            );

            const store =
                transaction.objectStore(STORE_NAME);

            const sosRecord = {

                id: crypto.randomUUID(),

                ...sosData,

                syncStatus: "pending"
            };

            const request =
                store.add(sosRecord);

            request.onsuccess = () => {

                console.log(
                    "📦 SOS saved locally:",
                    sosRecord
                );

                resolve(sosRecord);

            };

            request.onerror = () => {

                console.error(
                    "Failed to save SOS:",
                    request.error
                );

                reject(request.error);

            };

        });

    });
}

// ===============================
// SYNC PENDING SOS FROM PAGE
// ===============================

async function syncPendingSOSFromPage() {

    const db = await openDatabase();

    const records = await new Promise(
        (resolve, reject) => {

            const transaction =
                db.transaction(
                    STORE_NAME,
                    "readonly"
                );

            const store =
                transaction.objectStore(STORE_NAME);

            const request =
                store.getAll();

            request.onsuccess = () => {
                resolve(request.result);
            };

            request.onerror = () => {
                reject(request.error);
            };

        }
    );

    for (const sos of records) {

        if (sos.syncStatus !== "pending") {
            continue;
        }

        const response = await fetch(
            "http://localhost:5000/api/sos",
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
                `Backend returned ${response.status}`
            );

        }

        await markSOSAsSynced(sos.id);

        console.log(
            "✅ SOS sent to backend:",
            sos.id
        );
    }
}

// ===============================
// MARK SOS AS SYNCED
// ===============================

function markSOSAsSynced(id) {

    return openDatabase().then((db) => {

        return new Promise((resolve, reject) => {

            const transaction =
                db.transaction(
                    STORE_NAME,
                    "readwrite"
                );

            const store =
                transaction.objectStore(STORE_NAME);

            const request =
                store.get(id);

            request.onsuccess = () => {

                const record =
                    request.result;

                if (record) {

                    record.syncStatus =
                        "synced";

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

// ===============================
// WHEN INTERNET RETURNS
// ===============================

window.addEventListener(
    "online",
    async () => {

        console.log(
            "🌐 Internet connection restored"
        );

        try {

            await syncPendingSOSFromPage();

            console.log(
                "✅ Pending SOS records synchronized"
            );

        } catch (error) {

            console.error(
                "❌ Could not synchronize SOS:",
                error
            );

        }

    }
);

// =====================================
// REGISTER SERVICE WORKER
// =====================================

if ("serviceWorker" in navigator) {

    window.addEventListener("load", () => {

        navigator.serviceWorker
            .register("./sw.js")

            .then((registration) => {

                console.log(
                    "✅ Service Worker registered:",
                    registration.scope
                );

            })

            .catch((error) => {

                console.error(
                    "❌ Service Worker registration failed:",
                    error
                );

            });

    });
}

// Automatic retry for pending SOS records
setInterval(async () => {
    if (!navigator.onLine) {
        return;
    }

    try {
        await syncPendingSOSFromPage();

        console.log("🔄 Automatic SOS sync check completed");
    } catch (error) {
        console.log("⏳ Backend unavailable. SOS remains pending.");
    }
}, 10000);