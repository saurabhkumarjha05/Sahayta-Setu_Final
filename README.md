<div align="center">

# 🌉 Sahayta Setu

### From Emergency Reports to Coordinated Response

An AI-assisted, location-aware, offline-first disaster-response coordination platform connecting **Citizens • Responders • NGOs • Authorities**.

**Team Byte CodeX** · Build for Bharat · Domain: Disaster Management

</div>

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

```
Press SOS → save to IndexedDB (OFFLINE_QUEUE_ONLY)
          → try Socket.IO, then HTTP fallback (SYNCING)
          → server persists (SERVER_RECEIVED)
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

## 🤝 Team

**Byte CodeX**:

## 📄 License
