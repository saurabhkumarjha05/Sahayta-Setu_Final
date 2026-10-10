<div align="center">

# 🌉 Sahayta Setu

### From Emergency Reports to Coordinated Response

An AI-assisted, location-aware, offline-first disaster-response coordination platform connecting **Citizens • Responders • NGOs • Authorities**.

Lead of **Team Byte CodeX** · Build for Bharat · Domain: Disaster Management

</div>

## Install and test the mobile PWA

### Intelligence and geographic data configuration

Set `TINYFISH_API_KEY` only in the backend environment to enable the official TinyFish Search API integration. Search results are restricted to HTTPS `.gov.in` and `.nic.in` sources, returned as unverified source candidates, and are not treated as confirmed alerts. Without the key (or if the service is unavailable), core SOS reporting continues and the intelligence endpoint returns an explicit unavailable/error response. Incident priority and urgent-needs analysis currently uses explainable deterministic rules; it is advisory and cannot issue evacuation orders.

Optional Web Push requires backend-only `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, and `VAPID_EMAIL`. Do not expose backend secrets through `VITE_*` variables. The map's default view is Uttar Pradesh → Gautam Buddha Nagar; a district center is approximate and must not be presented as an individual's GPS position. Exact district-boundary geofencing is not available without a vetted boundary dataset. Evacuation records are family-status reports rather than versioned, approved operational evacuation plans.

Run the focused intelligence tests with `npm --prefix backend run test:intelligence`; the existing backend suite is `npm --prefix backend test`, and the frontend production build/lint commands are run from `frontend`.

The PWA is the installable browser version of the web app. It needs an HTTPS URL (or `localhost` on the same phone) for installation and Service Worker support. For a phone test, deploy the frontend and backend to a staging environment first; use one HTTPS origin with `/api` and `/socket.io` reverse-proxied to the backend where possible. If the API has a separate origin, set `VITE_API_URL` to that HTTPS API origin at frontend build time and allow the frontend origin in the backend's `CORS_ORIGINS`.

Do not use a real emergency or production authority accounts for testing. Test SOS, alerts, push notifications, and responder actions can create operational records or contact real subscribers. Use a staging database, test accounts, and disabled/test-only SMS and push integrations.

### Install on a phone

1. Open the deployed staging HTTPS URL in Chrome on Android (or Safari on iPhone) and sign in with a staging account. In this repository's local demo configuration, OTP delivery can be set to `console`; use only the OTP returned/logged by that demo backend. Production should use its configured OTP provider.
2. Keep the app open while it loads, then allow location and notifications if prompted. Visit the screens you plan to test so their static files are cached. Confirm the browser reports the Service Worker as active; on Android Chrome, use **⋮ → Install app** or **Add to Home screen**. On iPhone Safari, use **Share → Add to Home Screen**.
3. Open the installed Sahayta Setu icon and verify login and navigation. Do not clear browser/site data or use a private tab during offline tests; those can remove the cached app shell and IndexedDB SOS queue.

### Safe PWA test checklist

| Test | Steps | Expected result |
| --- | --- | --- |
| App install and cached shell | Install as above, close and reopen the installed app while online. | App opens in standalone mode and the signed-in session remains available. |
| Villager map and resources | Sign in as a staging villager; allow location; open the map, shelters, and alerts. | Map/resources render, location permission is handled, and available alert/shelter data is shown. |
| Online SOS | Submit a clearly labelled test SOS while connected to the staging backend. | SOS receives `SERVER_RECEIVED`; verify the same incident ID appears on the staging authority dashboard. |
| Offline SOS queue | While still signed in and online, first submit one staging SOS so the originating device can register. Then turn on Airplane mode, reopen the installed app, and submit a second clearly labelled test SOS. | New SOS is saved locally and shown as `OFFLINE_QUEUE_ONLY`. This means **saved on this phone only**, not delivered to an authority or another phone. |
| Reconnect and synchronize | Turn connectivity back on, reopen/foreground the PWA, and wait for sync. | Queued incident changes to `SERVER_RECEIVED`; verify its original incident ID appears once on the staging authority dashboard. A visible local queue alone is not server receipt. |
| Area-targeted authority notification | On staging, create a verified authority account with the same test district, allow notifications, and open its control dashboard to register the subscription. Publish a test alert or submit a test SOS from that district. | Matching authority receives the relevant in-app/push notification; an authority in a different district must not receive a jurisdiction-targeted notification. Browser/OS notification permission and configured push credentials are required. |
| Responder workflow | Sign in on a separate staging responder/NGO account, view the test SOS, and exercise assignment/status changes supported by that account. | Authorized responder can act; unauthorized or out-of-jurisdiction actions are rejected. |
| Offline shell | After the app has loaded online at least once, disconnect the phone from the internet and reopen it. | Cached app shell can open if its files were cached. Live APIs, maps/tiles, new alerts, push delivery, and dashboard updates are not guaranteed offline. |

Restore connectivity and verify the backend/dashboard after each offline test. Do not infer successful delivery from a green browser icon, `navigator.onLine`, or an SOS queue entry; use the SOS status and confirm the incident on the staging server.

### Cross-phone offline mesh test (Android companion app required)

**This is not a browser-PWA capability.** A PWA installed from Chrome/Safari cannot automatically discover other phones or transmit SOS over nearby Bluetooth/Wi-Fi. For this test use the Capacitor Android companion app and the debug APK described below. The APK uses the same web UI but adds the native Nearby Connections bridge.

1. Use two physical Android phones with Google Play services. Install the same staging build on both, sign in to separate staging accounts, and open the app on each phone.
2. While both have internet, submit a harmless test SOS from phone A so its device is registered with the staging backend. Then enable **Nearby SOS relay** on both phones and grant the Android nearby-device permissions. Keep both apps open in the foreground and Bluetooth/Wi-Fi enabled.
3. Remove internet from phone A but leave its radios on; keep phone B connected to the internet. Submit a new, clearly labelled test SOS on phone A.
4. Verify phone A reports a nearby peer/relay (not just local queue), then verify the test incident ID appears once on the staging authority dashboard after phone B forwards it. If phone B has no internet either, allow it to receive/store the packet first, then restore its internet while the app remains open and verify upload.
5. Repeat with both phones offline, then reconnect one relay phone. Record each state separately: `OFFLINE_QUEUE_ONLY` = only saved on source phone; nearby relay = packet reached a peer; `SERVER_RECEIVED` plus staging dashboard entry = server confirmed receipt.

If the devices do not discover each other, check that Nearby relay is active on both, permissions are granted, Bluetooth/Wi-Fi are on, the apps remain foregrounded, and both APKs are from the same compatible build. Nearby discovery can be affected by Android battery restrictions. This implementation has no persistent foreground service, so do not assume it will relay while closed or suspended. Do not enable this test against a production backend.

---

## 📌 The Problem

During a disaster, the biggest bottleneck is often not a lack of resources but **fragmented information and poor coordination**. Reports arrive through different channels and formats, and authorities struggle to know:

- What happened, and how many people are affected?
- Who is vulnerable, and how urgent is it?
- Which verified responder is suitable and nearby?
- Who is already assigned, and what is the current status?

> **Reporting an emergency ≠ Coordinating the response.**

## 💡 Our Solution

Sahayta Setu turns an emergency report into a structured incident, helps prioritize it, recommends suitable **verified** responders, and keeps a shared response lifecycle visible to everyone involved.

```
REPORT → UNDERSTAND → PRIORITIZE → LOCATE → MATCH → DISPATCH → TRACK → RESOLVE
```

Shared lifecycle shown to the citizen: **Reported → Prioritized → Assigned → In Progress → Resolved**

---

## ✨ Key Features

| Pillar | What it does |
|---|---|
| **Offline-first SOS** | SOS is saved to IndexedDB *before* any network call, then synced with retry, backoff and jitter. The UI never says "sent" until the server has persisted it. |
| **SOS Lite** | A compact (< 1 KB), versioned, ECDSA-signed payload that reaches the server first on weak networks. Description and extra details follow separately. |
| **Trusted emergency devices** | Web Crypto ECDSA P-256 device identity, server-side registration and revocation. Tampered or fake-device packets are rejected. |
| **Verified organizations** | NGOs and authorities register, stay `PENDING`, and only get access after the Super Admin verifies them. Suspension takes effect immediately. |
| **Jurisdiction-aware access** | State → District → Block/Tehsil → Gram Panchayat. Unauthorized access is rejected server-side with privacy masking for unassigned responders. |
| **Human-controlled dispatch** | The platform recommends verified responders using proximity, capability, availability and workload. The Gram Panchayat / Control Centre makes the final assignment. |
| **Duplicate-response prevention** | Assignment locking stops several responders from converging on the same incident. |
| **Official alerts** | Only verified authorities can issue or retransmit alerts, with lineage preserved. |
| **Live shelters & resources** | Verified authorities and NGOs add shelters/resources. Citizens see them live on a map, sorted by distance. |
| **Realtime updates** | Socket.IO for incident status, account verification, admin approvals and resource changes, with polling fallback. |
| **Audit trail** | Registration, login, verification and dispatch actions are logged. |

---

## 👥 Roles

| Role | Login | Access |
|---|---|---|
| **Citizen / Villager** | Mobile number (new users add name, state, district) | Submit and track SOS, view alerts, find nearby shelters and resources |
| **NGO / Responder** | Email + password, then Super Admin verification | Receive assignments, update status, manage own resources |
| **Gram Panchayat / Authority** | Email + password, then Super Admin verification | Triage, review recommended responders, assign, issue/retransmit alerts, manage local shelters |
| **Super Admin** | Email + password (bootstrapped from environment) | Approve / reject / suspend / revoke organizations, view audit log and platform stats |

> The role is decided by the **server**, never chosen by the user. Verification wording: *"Verified by Sahayta Setu's authorized platform administrator."*

---

## 🏗️ Architecture

```
┌──────────────┐   HTTPS / Socket.IO   ┌───────────────────────┐   ┌──────────────┐
│ React + Vite │ ────────────────────► │ Node.js + Express     │──►│ MongoDB Atlas│
│ PWA          │ ◄──────────────────── │ JWT • RBAC • Geo-auth │   └──────────────┘
│ IndexedDB    │                       │ Audit • Matching      │
│ Service Wkr  │                       └───────────────────────┘
└──────────────┘
   offline queue → signed SOS Lite → sync when a path exists
```

### Offline SOS flow

<<<<<<< HEAD
The system can additionally support an SMS-based SOS mechanism.

A predefined SMS keyword can be received through a messaging service and forwarded to the backend through a webhook.

This provides an alternative communication channel when internet access is unavailable but cellular SMS service is available.

### Android nearby SOS relay

The PWA queues SOS reports in IndexedDB, but browser APIs alone cannot automatically discover and relay messages between nearby phones. For cross-device, internet-free forwarding, this repository also includes an Android companion shell using Google Nearby Connections. Nearby phones can pass the signed SOS packet over Bluetooth/Wi-Fi; each phone keeps a copy until it can upload the original report to the server. Authority/responders can participate as relay devices too.

Build and install the Android app:

1. Install Android Studio with an Android SDK, Java 21, and Node.js 22.12 or later. Connect an Android phone or start an emulator with Google Play services.
2. Configure `frontend/.env` with the deployed HTTPS API origin, for example `VITE_API_URL=https://api.example.org`. The packaged Android WebView cannot use the Vite development proxy.
3. Run `npm --prefix frontend install`, then `npm --prefix frontend run android:sync`.
4. Open `frontend/android` in Android Studio and run the `app` configuration on a device, or build a debug APK from PowerShell:

   ```powershell
   cd frontend\android
   .\gradlew.bat assembleDebug
   ```

   The debug APK is written to `frontend/android/app/build/outputs/apk/debug/app-debug.apk`.
5. Install the app on each participating Android phone, sign in, and enable Nearby SOS relay in the dashboard. Grant the requested nearby-device permissions. Register the originating device with the backend while online before relying on its signed SOS offline.

Keep the app open with Nearby relay enabled on phones expected to forward messages. Android may pause discovery when the app is backgrounded or battery restricted; this implementation does not yet run a persistent foreground service. Bluetooth/Wi-Fi radios must remain enabled even when internet service is unavailable, and delivery to another phone is not confirmation that authorities have received the SOS. The SOS stays queued until the server acknowledges it. Browser-only PWA installations continue to support local offline queueing and later synchronization, but do not provide automatic cross-phone mesh relay.

---

### 4. 📊 Role-Based Disaster Coordination Dashboard

A centralized dashboard helps coordinate emergency response.

Different stakeholders can have different views and responsibilities.

#### 👥 Villagers

- Receive localized alerts
- View risk information
- Access shelter information
- Send SOS requests
- View evacuation information

#### 🏛️ Gram Panchayat / DDMA

- Monitor incoming SOS requests
- View affected locations
- Monitor shelters
- Track available resources
- Coordinate volunteers and response teams

#### 🚑 NDRF / SDRF / Emergency Responders

- View emergency locations
- Receive assigned tasks
- Access map-based information
- Identify affected areas
- Coordinate response operations

#### 🤝 NGOs / Volunteers

- View pending community requirements
- Coordinate available resources
- Update request status
- Support relief operations

---

# 🏗️ System Architecture

```text
                         ┌─────────────────────┐
                         │ Environmental Data  │
                         │                     │
                         │ KSNDMC              │
                         │ IMD                 │
                         │ SRTM                │
                         └──────────┬──────────┘
                                    │
                                    ▼
                         ┌─────────────────────┐
                         │ Risk Analysis / ML  │
                         │                     │
                         │ Rainfall            │
                         │ River Level         │
                         │ Elevation           │
                         │ Slope               │
                         └──────────┬──────────┘
                                    │
                                    ▼
                         ┌─────────────────────┐
                         │   Risk Assessment   │
                         └──────────┬──────────┘
                                    │
                                    ▼
                    ┌──────────────────────────────┐
                    │       Disaster Platform      │
                    └──────────────┬───────────────┘
                                   │
              ┌────────────────────┼────────────────────┐
              │                    │                    │
              ▼                    ▼                    ▼
       🗺️ Risk Map          🚨 Alerts             🆘 SOS
              │                    │                    │
              │             ┌──────┼──────┐             │
              │             │      │      │             │
              │            App    SMS   Siren           │
              │                                           
              │                              ┌────────────┘
              │                              │
              │                         Online/Offline
              │                              │
              │                         IndexedDB
              │                              │
              └──────────────┬───────────────┘
                             ▼
                  ┌────────────────────────┐
                  │ Backend API            │
                  │ Node.js / Express      │
                  └────────────┬───────────┘
                               │
                               ▼
                     ┌──────────────────┐
                     │ MongoDB Atlas    │
                     └────────┬─────────┘
                              │
                              ▼
                  ┌────────────────────────┐
                  │ Response Dashboard     │
                  └────────────────────────┘
=======
```
Press SOS → save to IndexedDB (OFFLINE_QUEUE_ONLY)
          → try Socket.IO, then HTTP fallback (SYNCING)
          → server persists (SERVER_RECEIVED)
>>>>>>> 95f895595e3bc76483f945aabbaa767a8f215842
```

Permanent errors (revoked device, invalid signature, validation) become `SYNC_REJECTED` and never retry in a loop. Transient errors retry with backoff.

---

## 🧰 Tech Stack

**Frontend:** React, Vite, JavaScript/JSX, PWA, Service Worker, IndexedDB, Leaflet maps, Socket.IO client
**Backend:** Node.js, Express, MongoDB (Mongoose), Socket.IO
**Security:** JWT, bcrypt, Web Crypto ECDSA P-256, role-based and geographic authorization, rate limiting, input validation, audit logging
**Notifications:** Web Push, Socket.IO (no Firebase)

---

## 📁 Project Structure

```
disaster-management-app/
├── backend/
│   ├── server.js            # routes, auth, SOS, alerts, admin, shelters
│   ├── models/              # user, sos, alert, shelter, ngo, verifiedEntity, auditLog
│   ├── services/            # auth, cryptoService, geoAuth, matchingService, realtimeService
│   ├── utils/               # rateLimiter, validation
│   ├── scripts/clean-db.js  # safe database cleanup tool
│   └── .env.example
├── frontend/
│   ├── public/              # sw.js, manifest, fonts, icons
│   └── src/
│       ├── Login.jsx, App.jsx, VillagerDashboard.jsx, NgoDashboard.jsx
│       ├── components/      # AdminDashboard, ControlViews, StatusScreen, SOSModal ...
│       ├── utils/           # offlineSOS, trustedDevice, mesh/EmergencyTransport
│       ├── i18n/            # en.json, hi.json
│       └── styles/          # design system, auth.css
└── shared/
    └── sosLite.js           # canonical SOS Lite spec (used by frontend and backend)
```

---

## 🚀 Getting Started

### Prerequisites

- Node.js 20+ (tested on 22)
- A MongoDB database (MongoDB Atlas free M0 works)

### 1. Clone and install

```bash
git clone <your-repo-url>
cd disaster-management-app

cd backend && npm install
cd ../frontend && npm install
```

### 2. Configure the backend

Copy `backend/.env.example` to `backend/.env` and fill in real values:

```env
MONGODB_URI=mongodb+srv://<user>:<password>@<cluster>.mongodb.net/sahayta_setu?retryWrites=true&w=majority
JWT_SECRET=<at least 32 random characters>
JWT_EXPIRES_IN=12h
SUPER_ADMIN_EMAIL=<admin email>
SUPER_ADMIN_PASSWORD=<strong password>
CITIZEN_AUTH_MODE=phone_only
CORS_ORIGINS=http://localhost:5173
```

Generate a JWT secret:

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
```

> ⚠️ **Never commit `.env`.** It is git-ignored. Special characters in a MongoDB password must be URL-encoded (`@` → `%40`).

### 3. Run

```bash
# Terminal 1
cd backend
npm start

# Terminal 2
cd frontend
npm run dev
```

Open **http://localhost:5173**. On startup the backend prints `MongoDB connected: sahayta_setu` and creates the Super Admin from your environment variables if one does not exist.

### 4. Try the full flow

1. **Citizen:** enter a mobile number, then name, state and district for a new account.
2. **Organization:** NGO / Authority tab → *Register your organization*. You land on the pending screen.
3. **Super Admin:** log in from a second window. The registration appears live. Approve it and the organization's dashboard opens without a refresh.
4. **Authority:** add a shelter. The citizen sees it live on the map.
5. **Citizen SOS:** press SOS and see it reach the control panel, with offline queuing if the network is off.

---

## 🧪 Testing

```bash
cd backend
npm test                       # core disaster system suite (93)
npm run test:auth              # authentication and access control (18)
node test-real-data-flow.js    # real-data and citizen flow (28)

cd ../frontend
node test-client-sync.js       # offline sync and UI honesty (5)
npm run build                  # production build
```

Tests must use a separate test database, never your real one.

### Database cleanup

```bash
cd backend
npm run db:clean                    # dry run, deletes nothing
npm run db:clean -- --list-users    # list remaining users
```

Actual deletion needs an explicit confirmation flag and environment variable (see `scripts/clean-db.js`). The Super Admin is always protected.

---

## 🔐 Security Notes

- Passwords hashed with bcrypt; login lockout after repeated failures; rate limiting on auth routes.
- Every protected request reloads the user from MongoDB, so suspension applies instantly.
- Clients cannot set `role`, `verificationStatus` or `organizationId`. Super Admin cannot be created through any public route.
- SOS ingestion authenticates by **device signature**, so it works even with an expired session.
- Inputs are length-limited and HTML-stripped server-side.

**Known tradeoffs (prototype):**

- Citizen login is **phone-number only** (`CITIZEN_AUTH_MODE=phone_only`). Production should set `CITIZEN_AUTH_MODE=otp` with a real SMS gateway.
- The session token is stored in `localStorage` so the PWA works offline. HttpOnly cookies are a future improvement.
- No email verification or password reset by email yet. The Super Admin can issue a one-time temporary password.

---

## ⚠️ Honest Limitations

We deliberately avoid overclaiming:

- Without any connectivity, a browser PWA **cannot** reach the server. The SOS is stored securely on the device and synced when a path returns.
- We do **not** claim an automatic phone-to-phone mesh. Browser support for nearby transports is limited and environment-dependent.
- Dispatch is **never automatic**. The platform recommends, and an authorized human assigns.
- Organizations are verified by the platform administrator, not by a government integration.
- AI is used for *decision support*, not for making disaster decisions.
- iOS Safari has no Background Sync, so retries there happen when the app is open.

---

## 🗺️ Roadmap

- [ ] **SMS fallback:** compact signed SMS (`SS1|...`) parsed by a webhook when mobile data is unavailable
- [ ] **QR "Scan & Relay":** user-assisted signed-packet relay between devices
- [ ] **Authority channel badges:** show how each SOS arrived (direct, SMS, relay) and late-arrival info
- [ ] **PWA finalization:** install prompt, versioned service-worker cache, offline app shell
- [ ] **Panchayat local node:** local server on a Wi-Fi hotspot that syncs to central when internet returns
- [ ] **Native Android mesh adapter:** Nearby Connections / BLE / Wi-Fi Direct
- [ ] Hindi UI re-enabled after native-speaker review
- [ ] Real SMS gateway for OTP

---

## 🌐 Location Model

Designed for India-wide scale: **28 States and 8 Union Territories**, with State → District → Block/Tehsil → Gram Panchayat hierarchy and normalized codes (`stateCode`, `districtCode`, `blockCode`, `panchayatId`). Uttarakhand is the default selection.

---

<<<<<<< HEAD
**Focus:** Flood and Landslide Early Warning & Community Response
=======
## 🤝 Team

**Byte CodeX**: Saurabh Kumar Jha And Team.

## 📄 License
MIT License
>>>>>>> 95f895595e3bc76483f945aabbaa767a8f215842
