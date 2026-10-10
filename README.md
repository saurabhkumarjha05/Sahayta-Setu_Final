# disaster-management-app
# 🌊 Disaster Management & Early Warning System

> **An Early Warning and Community Response System for Floods and Landslides in Karnataka**

A disaster-management platform designed to help vulnerable communities, local authorities, emergency responders, NGOs, and volunteers **detect risks early, receive localized alerts, send emergency SOS requests, and coordinate relief operations**.

The system focuses particularly on flood- and landslide-prone regions of Karnataka, where communication and coordination can become difficult during severe weather events.

## Run locally

Requirements: Node.js 22.12+ and MongoDB.

1. Copy `backend/.env.example` to `backend/.env`, set `MONGODB_URI` and a unique `JWT_SECRET`, then keep `OTP_DELIVERY=console` for local testing.
2. Install and start the backend with `npm --prefix backend install` and `npm --prefix backend start`.
3. In another terminal, start the frontend with `npm --prefix frontend install` and `npm --prefix frontend run dev`.
4. Open the Vite URL printed in the frontend terminal. In development, Vite proxies `/api` and `/socket.io` to `http://localhost:5000`.

The frontend uses same-origin API requests by default. Set `VITE_API_URL` in `frontend/.env` only when the backend is hosted at a different origin, and configure `CORS_ORIGINS` in the backend to include that exact frontend origin. Production deployments must set `NODE_ENV=production`, use OTP authentication, configure SMS delivery, and set a restrictive CORS allowlist.

## Install and test the mobile PWA

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

## 📌 Problem Statement

Floods and landslides during the monsoon season can cause loss of life, livestock, infrastructure, and property.

Some of the major challenges are:

- Generic alerts may not provide sufficient village-level information.
- Vulnerable areas, shelters, and evacuation routes are not always available in one system.
- Network and power failures can disrupt communication during disasters.
- Emergency requests may be difficult to coordinate manually.
- Officials, responders, volunteers, and affected communities need a common platform for coordination.

The project aims to address these challenges through a **localized, map-based, offline-capable disaster response system**.

---

# 💡 Proposed Solution

The platform consists of four major modules:

### 1. 🗺️ Risk-Zone Mapping & Data Integration

The system combines environmental and geographical information to identify areas that may be vulnerable to floods and landslides.

Potential data sources include:

- **KSNDMC** — rainfall and river-level information
- **IMD** — weather and forecast information
- **SRTM** — elevation data
- Slope and other geographical factors
- Historical environmental data

A machine-learning-based risk model can classify areas into different risk levels.

The interactive map can display:

- 🔴 High/Critical-risk zones
- 🟠 Medium-risk zones
- 🟢 Low-risk zones
- 🏠 Relief shelters
- 🛣️ Evacuation routes

---

### 2. 🚨 Localized Multi-Channel Alerts

Instead of relying only on general alerts, the system is designed to provide warnings based on the affected geographical zone.

Alerts can be delivered through:

- 📱 Web/app notifications
- 📩 SMS
- 🔊 Siren integration/simulation

Alerts can be triggered when monitored parameters such as rainfall or river levels cross predefined thresholds.

The SMS channel is intended to provide communication support even for users with basic mobile phones.

---

### 3. 🆘 Offline SOS

The Offline SOS module is one of the key features of the system.

During a disaster, internet connectivity may become unreliable or unavailable. The SOS module therefore follows an **offline-first approach**.

The web application uses:

- Progressive Web App concepts
- Service Workers
- IndexedDB
- Background synchronization

### SOS workflow

```text
User presses SOS
       ↓
Capture emergency information
       ↓
Capture GPS location
       ↓
Check network availability
       ↓
 ┌───────────────┐
 │               │
Online         Offline
 │               │
 ↓               ↓
Backend       IndexedDB
 │               │
 └───────┬───────┘
         ↓
   Synchronization
         ↓
      Backend
         ↓
 Response Dashboard
```

Each SOS request represents an individual emergency request and contains information such as:

```json
{
  "emergencyType": "Flood",
  "latitude": 12.34567,
  "longitude": 76.54321,
  "timestamp": "2026-09-25T10:30:00.000Z"
}
```

### SMS SOS fallback

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
```

---

# 🛠️ Technology Stack

## Frontend

- React 19 and Vite 8
- JavaScript, HTML, and CSS
- Leaflet 1.9 and React Leaflet 5

## Backend

- Node.js and Express 5
- MongoDB through Mongoose 9
- Socket.IO 4

## Disaster Alerts

- Twilio SMS API (optional; configured through backend environment variables)
- Web Push API

## Offline SOS

- Service Workers
- IndexedDB
- Progressive Web App (PWA)
- Background Sync API

## Maps & Geographical Data

- Leaflet and React Leaflet
- Open-Meteo rainfall data
- Geographic coordinates / GPS

---

# 📂 Project Structure

```text
disaster-management-app/
├── backend/        Express API, MongoDB models, services, and tests
├── frontend/       React/Vite app, PWA assets, and client tests
├── shared/         Payload contracts shared by frontend and backend
├── sos-module/     Standalone offline SOS prototype
├── twilio-test/    Separate Twilio SMS test server
└── README.md
```

Backend models and services are organized under `backend/models/` and `backend/services/`. The API routes currently live in `backend/server.js`.

---

# 🆘 Offline SOS Module

The current SOS module is implemented as a standalone web module.

### Current functionality

- Emergency type selection
- GPS location capture
- SOS data creation
- Local SOS storage using IndexedDB
- Service Worker registration
- Service Worker fetch interception

### Current SOS data structure

```javascript
{
    emergencyType: "Flood",
    latitude: 12.34567,
    longitude: 76.54321,
    timestamp: "2026-09-25T10:30:00.000Z"
}
```

# 🔐 Security Considerations

Sensitive credentials must never be stored in frontend source code.

For example, the following must **not** be committed to GitHub:

- MongoDB passwords
- MongoDB connection strings
- Twilio Account SID
- Twilio Auth Token
- API keys
- Authentication secrets

Backend secrets should be stored using environment variables.

Example:

```env
MONGODB_URI=your_mongodb_connection_string
TWILIO_ACCOUNT_SID=your_account_sid
TWILIO_AUTH_TOKEN=your_auth_token
```

The `.env` file should be included in `.gitignore`.

Citizen accounts use OTP by default. Phone-only authentication is permitted only when both `APP_MODE=demo` and `CITIZEN_AUTH_MODE=phone_only` are explicitly configured, and is disabled automatically when `NODE_ENV=production`.

To publish this working tree to a newly created GitHub repository after creating the initial commit, add that repository as `origin` and push the `main` branch. Do not add the ignored `.env` files, `node_modules`, or build output.

---


# 🎯 Expected Outcomes

The system aims to provide:

### Early Warning

Localized warnings based on environmental and geographical risk information.

### Better Situational Awareness

Interactive maps showing risk zones, shelters, and evacuation routes.

### Reliable Emergency Communication

An SOS mechanism designed to continue functioning during temporary network outages.

### Faster Response

Centralized SOS and resource information for emergency response teams.

### Better Coordination

A shared platform for authorities, responders, NGOs, volunteers, and communities.

### Community Preparedness

Access to risk information, shelters, evacuation routes, and emergency communication tools.

---

# 🌍 Target Users

The platform is designed for:

- 👨‍👩‍👧‍👦 Communities in flood- and landslide-prone areas
- 🏛️ Gram Panchayats
- 🏢 District Disaster Management Authorities (DDMA)
- 🚑 NDRF / SDRF teams
- 🤝 NGOs
- 🙋 Volunteers
- 🚨 Emergency response teams

---

# 📈 Potential Impact

The proposed system can support:

- Earlier evacuation through localized warnings
- Faster reporting of emergencies
- Better visibility of affected locations
- Improved coordination of relief resources
- Better access to shelters and evacuation routes
- Communication support during temporary network disruptions
- Improved disaster preparedness at the community level

---

# 🚀 Future Enhancements

Possible future improvements include:

- Real-time government data integration
- More accurate ML-based flood and landslide prediction
- Real-time river-level monitoring
- Advanced weather forecasting integration
- Automated village-level alert generation
- Full Background Sync implementation
- SMS-based SOS integration through Twilio
- Hardware-based siren integration using ESP32/Raspberry Pi
- Real-time responder tracking
- Shelter capacity monitoring
- Resource allocation optimization
- Mobile application version
- Multilingual support, including Hindi (Devanagari) and English
- Authentication and role-based access control
- Advanced analytics and disaster-response reports

---

# 👩‍💻 Team

**Project:** Jagruti

**Theme:** Disaster Management

**Focus:** Flood and Landslide Early Warning & Community Response
