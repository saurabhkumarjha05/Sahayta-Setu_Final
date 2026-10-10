import { useCallback, useEffect, useRef, useState } from "react";
import ProfileMenu from "./components/ProfileMenu";
import SOSModal from "./components/SOSModal";
import FamilyStatusCard from "./components/FamilyStatusCard";
import DangerAlert from "./components/DangerAlert";
import LocationSelector from "./components/LocationSelector";
import { apiFetch, getToken, initials } from "./api";
import {
  getPendingCount,
  getEmergencyQueue,
  syncPendingSOS,
  startAutoSync,
  resendAsNewReport,
  discardReport,
  clearRejectedReports
} from "./utils/offlineSOS";
import { registerDeviceWithBackend } from "./utils/trustedDevice";
import { registerPushNotifications } from "./utils/pushNotifications";
import { getSocket, subscribeToDistrict } from "./utils/socketClient";
import NearbyResourcesMap from "./components/map/NearbyResourcesMap";
import { useI18n } from "./i18n";
import { LanguageSwitcher, InstallPrompt, OfflineBanner, StatusStepper } from "./components/ui";
import { calculateDistanceKm } from "./data/verifiedResources";
import { findDistrictCoordinates } from "./data/indiaLocations";
import { DEFAULT_STATE, DEFAULT_DISTRICT } from "./config/locationConfig";

function VillagerDashboard({ user, onLogout }) {
  const { t } = useI18n();
  const [showSOS, setShowSOS] = useState(false);
  const [myRequests, setMyRequests] = useState([]);
  const [pendingOffline, setPendingOffline] = useState(0);
  const [queueItems, setQueueItems] = useState([]);
  const [latestQueued, setLatestQueued] = useState(null);
  const [syncingManual, setSyncingManual] = useState(false);
  const [syncResultMsg, setSyncResultMsg] = useState("");
  const [shelters, setShelters] = useState([]);
  const [alerts, setAlerts] = useState([]);

  // Location selector state
  const [selectedState, setSelectedState] = useState(user?.state || DEFAULT_STATE);
  const [selectedDistrict, setSelectedDistrict] = useState(user?.district || DEFAULT_DISTRICT);
  const [isGpsActive, setIsGpsActive] = useState(false);
  const [userPos, setUserPos] = useState(() => {
    const coords = findDistrictCoordinates(user?.district || DEFAULT_DISTRICT, user?.state || DEFAULT_STATE);
    return coords ? [coords.lat, coords.lng] : undefined;
  });

  const evacuationRef = useRef(null);

  // Attempt browser geolocation on mount
  useEffect(() => {
    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          setUserPos([pos.coords.latitude, pos.coords.longitude]);
          setIsGpsActive(true);
        },
        () => console.log("Using selected district coordinates for Villager")
      );
    }
  }, []);

  const handleLocationChange = ({ state, district, coordinates }) => {
    setSelectedState(state);
    setSelectedDistrict(district);
    if (coordinates && Number.isFinite(coordinates.lat) && Number.isFinite(coordinates.lng)) {
      setUserPos([coordinates.lat, coordinates.lng]);
    }
  };

  const handleLocateMe = () => {
    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          setUserPos([pos.coords.latitude, pos.coords.longitude]);
          setIsGpsActive(true);
        },
        (err) => console.warn("GPS lookup failed:", err.message),
        { enableHighAccuracy: true, timeout: 8000 }
      );
    }
  };

  // Fetch villager's own SOS requests and local offline queue for real-time tracking
  const fetchMyRequests = useCallback(async () => {
    try {
      const count = await getPendingCount();
      setPendingOffline(count);
      const queue = await getEmergencyQueue();
      setQueueItems(queue || []);
      if (queue && queue.length > 0) {
        setLatestQueued(queue[0]);
      } else {
        setLatestQueued(null);
      }
    } catch {
      // IndexedDB fallback
    }

    if (!getToken()) return;

    try {
      const data = await apiFetch("/api/sos/mine");
      setMyRequests(Array.isArray(data) ? data : []);
    } catch (err) {
      console.warn("Could not load SOS status:", err.message);
    }
  }, []);

  // Fetch verified shelters for current location
  const loadShelters = useCallback(async () => {
    try {
      const query = `?state=${encodeURIComponent(selectedState)}&district=${encodeURIComponent(selectedDistrict)}`;
      const data = await apiFetch(`/api/shelters${query}`);
      const list = Array.isArray(data) ? data : [];
      setShelters(list.filter((shelter) =>
        shelter.status === 'ACTIVE'
        && shelter.verified !== false
        && Number(shelter.availableSpaces) > 0
        && Number.isFinite(Number(shelter.lat))
        && Number.isFinite(Number(shelter.lng))
        && calculateDistanceKm(userPos, [Number(shelter.lat), Number(shelter.lng)]) <= 25
      ));
    } catch (error) {
      console.warn("Live shelter lookup failed:", error.message);
      setShelters([]);
    }
  }, [selectedState, selectedDistrict, userPos]);

  useEffect(() => {
    const initialLoad = setTimeout(loadShelters, 0);
    const interval = setInterval(loadShelters, 15000);
    return () => {
      clearTimeout(initialLoad);
      clearInterval(interval);
    };
  }, [loadShelters]);

  // Fetch location-targeted official alerts
  useEffect(() => {
    const loadAlerts = async () => {
      try {
        const query = `?state=${encodeURIComponent(selectedState)}&district=${encodeURIComponent(selectedDistrict)}`;
        const data = await apiFetch(`/api/alerts${query}`);
        setAlerts(Array.isArray(data) ? data : []);
      } catch (err) {
        console.warn("Could not load alerts:", err.message);
      }
    };
    loadAlerts();
    const interval = setInterval(loadAlerts, 10000);
    return () => clearInterval(interval);
  }, [selectedState, selectedDistrict]);

  // Register trusted emergency device & Web Push notifications
  useEffect(() => {
    registerDeviceWithBackend(user?._id || user?.id);
    registerPushNotifications({ state: selectedState, district: selectedDistrict, user });
  }, [selectedState, selectedDistrict, user]);

  // Real-time Socket.IO subscriptions for district alerts and SOS updates
  useEffect(() => {
    subscribeToDistrict(selectedDistrict, "villager");
    const s = getSocket();

    const handleAlertPublished = (alertData) => {
      setAlerts((prev) => [alertData, ...prev.filter(a => a._id !== alertData._id)]);
    };

    const handleSosStatusUpdate = () => {
      fetchMyRequests();
    };

    const handleResourceChange = () => {
      loadShelters();
    };

    s.on("alert:published", handleAlertPublished);
    s.on("sos:status_changed", handleSosStatusUpdate);
    s.on("sos:responder_location", handleSosStatusUpdate);
    s.on("resource:created", handleResourceChange);
    s.on("resource:updated", handleResourceChange);
    s.on("resource:closed", handleResourceChange);

    return () => {
      s.off("alert:published", handleAlertPublished);
      s.off("sos:status_changed", handleSosStatusUpdate);
      s.off("sos:responder_location", handleSosStatusUpdate);
      s.off("resource:created", handleResourceChange);
      s.off("resource:updated", handleResourceChange);
      s.off("resource:closed", handleResourceChange);
    };
  }, [selectedDistrict, fetchMyRequests, loadShelters]);

  useEffect(() => {
    const stopAutoSync = startAutoSync();
    const first = setTimeout(fetchMyRequests, 0);
    const interval = setInterval(fetchMyRequests, 4000);

    return () => {
      stopAutoSync();
      clearTimeout(first);
      clearInterval(interval);
    };
  }, [fetchMyRequests]);

  const handleSOSSent = () => {
    setShowSOS(false);
    fetchMyRequests();
  };

  const handleManualSync = async () => {
    setSyncingManual(true);
    setSyncResultMsg("");
    try {
      const res = await syncPendingSOS();
      await fetchMyRequests();
      if (res?.skipped) {
        setSyncResultMsg(t('offlineBanner.serverUnreachable') || "Server unreachable. Sync deferred.");
      } else if (res?.locked) {
        setSyncResultMsg("Sync already in progress...");
      } else {
        setSyncResultMsg("Synchronization run completed.");
      }
    } catch (err) {
      setSyncResultMsg("Sync notice: " + err.message);
    } finally {
      setSyncingManual(false);
      setTimeout(() => setSyncResultMsg(""), 6000);
    }
  };

  const handleResendAsNew = async (clientIncidentId) => {
    if (window.confirm(t('sosStatus.sendAgainConfirm') || "This will create and sign a brand-new emergency report with your current device identity. Proceed?")) {
      try {
        await resendAsNewReport(clientIncidentId);
        await fetchMyRequests();
      } catch (err) {
        alert("Could not send new report: " + err.message);
      }
    }
  };

  const handleDiscard = async (clientIncidentId) => {
    if (window.confirm(t('sosStatus.discardConfirm') || "Are you sure you want to discard this report?")) {
      await discardReport(clientIncidentId);
      await fetchMyRequests();
    }
  };

  const handleClearAllRejected = async () => {
    if (window.confirm(t('sosStatus.confirmClear') || "Are you sure you want to remove all permanently rejected reports?")) {
      await clearRejectedReports();
      await fetchMyRequests();
    }
  };

  const activeRequest = myRequests.find((sos) => sos.status !== "Resolved");
  const hasActiveSOS = Boolean(activeRequest) || pendingOffline > 0;

  // Nearby resources sorted by distance
  const currentPos = userPos;
  const sortedResources = shelters
    .filter((s) => Number.isFinite(s.lat) && Number.isFinite(s.lng))
    .map((s) => ({
      ...s,
      distance: calculateDistanceKm(currentPos, [s.lat, s.lng]),
      isFull: s.status === "Full" || (s.capacity > 0 && s.currentOccupancy >= s.capacity)
    }))
    .sort((a, b) => a.distance - b.distance);
  const eligibleNearbyResources = sortedResources.filter((s) =>
    !s.isFull && s.status !== 'CLOSED' && Number(s.availableSpaces ?? s.capacity - s.currentOccupancy) > 0
    && s.distance <= 25
  );
  const nearestOpenId = eligibleNearbyResources[0]?._id;

  const latestAlert = alerts[0];

  const alertTime = (timestamp) => {
    if (!timestamp) return "Just now";
    const date = new Date(timestamp);
    if (Number.isNaN(date.getTime())) return "Just now";
    const minutes = Math.floor((new Date().getTime() - date.getTime()) / 60000);
    if (minutes < 1) return "Just now";
    if (minutes < 60) return `${minutes} min ago`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"} ago`;
    const days = Math.floor(hours / 24);
    return `${days} day${days === 1 ? "" : "s"} ago`;
  };

  const scrollToMap = () => {
    evacuationRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  // SOS Tracker Details
  let statusTitle = "No active emergency request";
  let statusText = "If you are in danger, tap SEND SOS below to alert responders.";
  let statusBadge = "Standby";

  if (activeRequest?.status === "In Progress") {
    const ngo = activeRequest.assignedTo;
    statusTitle = "🚨 Help is on the way!";
    statusText = ngo
      ? `Assigned Unit: ${ngo.name || 'Response Team'}${ngo.phone ? ` · Contact: ${ngo.phone}` : ""}. Stay in a safe location.`
      : "A nearby responder has accepted your dispatch request. Stay safe.";
    statusBadge = "IN PROGRESS";
  } else if (activeRequest?.status === "Pending") {
    statusTitle = t('sosStatus.serverReceived') || "Emergency report received by the server";
    statusText = t('sosStatus.serverReceivedDesc') || "Waiting for nearest responder unit assignment. Keep phone nearby.";
    statusBadge = "SERVER_RECEIVED";
  } else if (latestQueued && latestQueued.syncStatus === 'SYNCING') {
    statusTitle = t('sosStatus.syncing') || "Sending...";
    statusText = t('sosStatus.syncingDesc') || `Transmitting compact SOS Lite.${latestQueued.retryCount ? ` Attempt #${latestQueued.retryCount}` : ''}`;
    statusBadge = "SYNCING";
  } else if (latestQueued && latestQueued.syncStatus === 'SYNC_REJECTED') {
    statusTitle = t('sosStatus.couldNotSend') || "Could not send";
    statusText = latestQueued.lastErrorMessage || "Validation rejected by server. Tap below to send as new or discard.";
    statusBadge = "SYNC_REJECTED";
  } else if (latestQueued?.relayStatus === 'RELAYED_TO_NEARBY_DEVICE') {
    statusTitle = t('sosStatus.peerRelayTitle');
    statusText = t('sosStatus.peerRelayDesc');
    statusBadge = "PEER_RELAY";
  } else if (latestQueued && latestQueued.syncStatus === 'OFFLINE_QUEUE_ONLY') {
    statusTitle = t('sosStatus.savedLocally') || "SOS saved on this phone, not sent yet";
    statusText = `Saved locally in IndexedDB.${latestQueued.retryCount ? ` · Retries: ${latestQueued.retryCount}` : ''}${latestQueued.lastAttemptTime ? ` · Last attempt: ${alertTime(latestQueued.lastAttemptTime)}` : ''}`;
    statusBadge = "OFFLINE_QUEUE_ONLY";
  } else if (pendingOffline > 0) {
    statusTitle = t('sosStatus.savedLocally') || "SOS saved on this phone, not sent yet";
    statusText = t('sosStatus.savedLocallyDesc') || "Will automatically upload as soon as cellular or Wi-Fi connection returns.";
    statusBadge = "OFFLINE_QUEUE_ONLY";
  }

  const locationText = `${selectedDistrict}, ${selectedState}`;

  return (
    <div className="villager-page">
      {/* OFFLINE BANNER */}
      <OfflineBanner
        queuedCount={pendingOffline}
        onSync={handleManualSync}
        syncing={syncingManual}
      />
      <InstallPrompt />

      {/* HEADER */}
      <header className="villager-header">
        <div className="villager-brand">
          <div className="villager-brand-icon">🛡️</div>
          <div>
            <h2>SAHAYTA SETU</h2>
            <span>Disaster Response Network</span>
          </div>
        </div>

        <div className="villager-location">
          <span>●</span>
          <div>
            <small>{t('app.yourLocation')}</small>
            <strong>{locationText}</strong>
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <LanguageSwitcher />
          <ProfileMenu
            className="villager-profile"
            avatarClassName="villager-avatar"
            initials={initials(user?.name || "Villager")}
            name={user?.name || "Villager"}
            subtitle={t('app.civilianAccount')}
            phone={user?.phone}
            onLogout={onLogout}
          />
        </div>
      </header>

      {/* LOCATION SELECTION BAR */}
      <div style={{
        backgroundColor: '#f8fafc',
        borderBottom: '1px solid #e2e8f0',
        padding: '12px 24px',
        display: 'flex',
        flexWrap: 'wrap',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: '16px'
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flex: '1 1 300px' }}>
          <span style={{ fontSize: '0.85rem', color: '#475569', fontWeight: '700' }}>📍 Active Region:</span>
          <LocationSelector
            selectedState={selectedState}
            selectedDistrict={selectedDistrict}
            onChange={handleLocationChange}
            showLabels={false}
          />
        </div>

        <div style={{
          fontSize: '0.8rem',
          fontWeight: '600',
          color: isGpsActive ? '#15803d' : '#b45309',
          backgroundColor: isGpsActive ? '#f0fdf4' : '#fffbe6',
          padding: '6px 12px',
          borderRadius: '20px',
          border: `1px solid ${isGpsActive ? '#bbf7d0' : '#fef08a'}`
        }}>
          {isGpsActive ? '📍 EXACT GPS ACTIVE' : `⚠️ USING APPROXIMATE DISTRICT CENTER (${selectedDistrict})`}
        </div>
      </div>

      {/* MAIN */}
      <main className="villager-main">
        {/* WELCOME */}
        <section className="villager-welcome">
          <div>
            <p className="villager-label">COMMUNITY SAFETY</p>
            <h1>Stay safe, <span>stay informed.</span></h1>
            <p className="villager-subtitle">
              Sahayta Setu is monitoring {selectedDistrict}, {selectedState} for flood, landslide, and disaster risks.
            </p>
          </div>

          <div className="monitor-status">
            <span></span>
            Active Monitoring in {selectedDistrict}
          </div>
        </section>

        {/* DANGER ALERT POPUP */}
        <DangerAlert
          alerts={alerts}
          user={{ state: selectedState, district: selectedDistrict }}
          onFindShelter={scrollToMap}
          onSendSOS={() => setShowSOS(true)}
        />

        {/* OFFICIAL ALERTS FEED */}
        <section className="official-alerts-section" style={{ marginBottom: '24px' }}>
          {latestAlert ? (
            <div className={`risk-card risk-${String(latestAlert.riskLevel || 'high').toLowerCase()}`} style={{ borderRadius: '12px' }}>
              <div className="risk-card-left">
                <div className="risk-icon">⚠️</div>
                <div>
                  <p className="card-label">OFFICIAL GOVERNMENT ALERT — {selectedDistrict.toUpperCase()}</p>
                  <h2>{latestAlert.title || `${String(latestAlert.riskLevel).toUpperCase()} RISK ALERT`}</h2>
                  <p>{latestAlert.message}</p>
                </div>
              </div>
              <div className="risk-time">
                <small>ISSUED</small>
                <strong>{alertTime(latestAlert.createdAt)}</strong>
              </div>
            </div>
          ) : (
            <div className="risk-card risk-none" style={{ borderRadius: '12px' }}>
              <div className="risk-card-left">
                <div className="risk-icon">✓</div>
                <div>
                  <p className="card-label">OFFICIAL ALERT STATUS</p>
                  <h2>NO ACTIVE ALERTS IN {selectedDistrict.toUpperCase()}</h2>
                  <p>Command center has not issued any emergency warnings for {selectedDistrict}, {selectedState}.</p>
                </div>
              </div>
            </div>
          )}
        </section>

        {/* SOS + NEAREST HELP GRID */}
        <section className="villager-grid">
          {/* EMERGENCY SOS CARD */}
          <div className="villager-panel sos-card">
            <div className="villager-panel-heading">
              <div>
                <h3>Emergency SOS</h3>
                <p>Trapped or need immediate rescue?</p>
              </div>
              <span className="offline-badge">● Offline Ready</span>
            </div>

            <div className="sos-action">
              <button
                className={`big-sos ${hasActiveSOS ? "sos-sent" : "anim-sos-idle"}`}
                onClick={() => setShowSOS(true)}
              >
                <span>{hasActiveSOS ? (pendingOffline > 0 ? "💾" : "✓") : "🆘"}</span>
                <strong>{hasActiveSOS ? (pendingOffline > 0 ? "SOS STORED LOCALLY" : "SOS ACTIVE") : "SEND SOS"}</strong>
                <small>{hasActiveSOS ? (pendingOffline > 0 ? "Stored offline · Awaiting communication path" : "Tracked live by control centre") : "Instant alert to responders"}</small>
              </button>
            </div>

            <div className="sos-info-row">
              <div>
                <span>📍</span>
                <p>
                  <strong>{isGpsActive ? "Exact GPS shared" : "District location shared"}</strong>
                  <small>{isGpsActive ? "Coordinates auto-sent" : "District fallback active"}</small>
                </p>
              </div>
              <div>
                <span>📡</span>
                <p>
                  <strong>Works Offline</strong>
                  <small>Auto-syncs when online</small>
                </p>
              </div>
            </div>

            {/* TRUTHFUL PER-SOS STATUS CARDS */}
            {(() => {
              // Combine queued items and server requests (deduplicating by incidentId)
              const seen = new Set();
              const items = [];
              for (const q of queueItems) {
                if (q.clientIncidentId) seen.add(q.clientIncidentId);
                items.push(q);
              }
              for (const r of myRequests) {
                const id = r.clientIncidentId || r._id;
                if (!seen.has(id) && r.status !== 'Resolved') {
                  seen.add(id);
                  items.push({
                    clientIncidentId: id,
                    syncStatus: 'SERVER_RECEIVED',
                    receivedAt: r.receivedAt || r.timestamp,
                    type: r.type,
                    status: r.status
                  });
                }
              }

              if (items.length === 0) return null;

              return (
                <div className="sos-status-list" style={{ marginTop: '16px', display: 'flex', flexDirection: 'column', gap: '10px' }}>
                  {items.map((item) => {
                    const id = item.clientIncidentId || item._id;
                    const st = item.syncStatus;

                    if (st === 'SERVER_RECEIVED') {
                      return (
                        <div
                          key={id}
                          className="sos-status-card status-card-received"
                          style={{
                            padding: '12px 16px',
                            backgroundColor: '#f0fdf4',
                            border: '1px solid #86efac',
                            borderRadius: '8px',
                            display: 'flex',
                            alignItems: 'flex-start',
                            gap: '12px'
                          }}
                        >
                          <span style={{ fontSize: '1.25rem', lineHeight: 1 }}>✅</span>
                          <div style={{ flex: 1 }}>
                            <strong style={{ color: '#166534', fontSize: '0.92rem', display: 'block' }}>
                              {t('sosStatus.serverReceived')}
                            </strong>
                            <p style={{ margin: '4px 0 0 0', fontSize: '0.82rem', color: '#15803d' }}>
                              {t('sosStatus.incident', { id })} · {alertTime(item.receivedAt || item.syncedAt || item.timestamp)}
                            </p>
                            <small style={{ color: '#166534', fontSize: '0.78rem' }}>
                              {t('sosStatus.serverReceivedDesc')}
                            </small>
                          </div>
                        </div>
                      );
                    }

                    if (st === 'SYNCING') {
                      return (
                        <div
                          key={id}
                          className="sos-status-card status-card-syncing"
                          style={{
                            padding: '12px 16px',
                            backgroundColor: '#eff6ff',
                            border: '1px solid #93c5fd',
                            borderRadius: '8px',
                            display: 'flex',
                            alignItems: 'flex-start',
                            gap: '12px'
                          }}
                        >
                          <span style={{ fontSize: '1.25rem', lineHeight: 1 }}>🔄</span>
                          <div style={{ flex: 1 }}>
                            <strong style={{ color: '#1e40af', fontSize: '0.92rem', display: 'block' }}>
                              {t('sosStatus.syncing')}
                            </strong>
                            <p style={{ margin: '4px 0 0 0', fontSize: '0.82rem', color: '#1d4ed8' }}>
                              {t('sosStatus.incident', { id })}
                            </p>
                            <small style={{ color: '#1e40af', fontSize: '0.78rem' }}>
                              {t('sosStatus.syncingDesc')}
                            </small>
                          </div>
                        </div>
                      );
                    }

                    if (st === 'SYNC_REJECTED') {
                      return (
                        <div
                          key={id}
                          className="sos-status-card status-card-rejected"
                          style={{
                            padding: '12px 16px',
                            backgroundColor: '#fef2f2',
                            border: '1px solid #fca5a5',
                            borderRadius: '8px',
                            display: 'flex',
                            flexDirection: 'column',
                            gap: '10px'
                          }}
                        >
                          <div style={{ display: 'flex', alignItems: 'flex-start', gap: '12px' }}>
                            <span style={{ fontSize: '1.25rem', lineHeight: 1 }}>❌</span>
                            <div style={{ flex: 1 }}>
                              <strong style={{ color: '#991b1b', fontSize: '0.92rem', display: 'block' }}>
                                {t('sosStatus.couldNotSend')}
                              </strong>
                              <p style={{ margin: '4px 0 0 0', fontSize: '0.82rem', color: '#b91c1c' }}>
                                {t('sosStatus.incident', { id })} · {t('sosStatus.reason', { reason: item.lastErrorMessage || item.lastErrorCode || 'Server rejected packet' })}
                              </p>
                            </div>
                          </div>
                          <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', marginTop: '4px' }}>
                            <button
                              type="button"
                              onClick={() => handleResendAsNew(id)}
                              style={{
                                minHeight: '48px',
                                minWidth: '48px',
                                padding: '10px 16px',
                                backgroundColor: '#dc2626',
                                color: '#ffffff',
                                border: 'none',
                                borderRadius: '6px',
                                fontWeight: 700,
                                fontSize: '0.82rem',
                                cursor: 'pointer'
                              }}
                            >
                              🔄 {t('sosStatus.sendAgainAsNew')}
                            </button>
                            <button
                              type="button"
                              onClick={() => handleDiscard(id)}
                              style={{
                                minHeight: '48px',
                                minWidth: '48px',
                                padding: '10px 16px',
                                backgroundColor: '#f1f5f9',
                                color: '#475569',
                                border: '1px solid #cbd5e1',
                                borderRadius: '6px',
                                fontWeight: 600,
                                fontSize: '0.82rem',
                                cursor: 'pointer'
                              }}
                            >
                              🗑️ {t('sosStatus.discard')}
                            </button>
                          </div>
                        </div>
                      );
                    }

                    // OFFLINE_QUEUE_ONLY
                    return (
                      <div
                        key={id}
                        className="sos-status-card status-card-offline"
                        style={{
                          padding: '12px 16px',
                          backgroundColor: '#fffbeb',
                          border: '1px solid #fde68a',
                          borderRadius: '8px',
                          display: 'flex',
                          alignItems: 'flex-start',
                          gap: '12px'
                        }}
                      >
                        <span style={{ fontSize: '1.25rem', lineHeight: 1 }}>💾</span>
                        <div style={{ flex: 1 }}>
                          <strong style={{ color: '#92400e', fontSize: '0.92rem', display: 'block' }}>
                            {t('sosStatus.savedLocally')}
                          </strong>
                          <p style={{ margin: '4px 0 0 0', fontSize: '0.82rem', color: '#b45309' }}>
                            {t('sosStatus.incident', { id })}
                            {item.retryCount ? ` · ${t('sosStatus.retries', { count: item.retryCount })}` : ''}
                            {item.lastAttemptAt || item.lastAttemptTime ? ` · ${t('sosStatus.lastAttempt', { time: alertTime(item.lastAttemptAt || item.lastAttemptTime) })}` : ''}
                          </p>
                          <small style={{ color: '#92400e', fontSize: '0.78rem' }}>
                            {t('sosStatus.savedLocallyDesc')}
                          </small>
                        </div>
                      </div>
                    );
                  })}

                  {queueItems.some((q) => q.syncStatus === 'SYNC_REJECTED') && (
                    <div style={{ textAlign: 'right', marginTop: '4px' }}>
                      <button
                        type="button"
                        onClick={handleClearAllRejected}
                        style={{
                          minHeight: '48px',
                          minWidth: '48px',
                          background: 'none',
                          border: 'none',
                          color: '#dc2626',
                          textDecoration: 'underline',
                          fontWeight: 600,
                          fontSize: '0.82rem',
                          cursor: 'pointer'
                        }}
                      >
                        🗑️ {t('sosStatus.clearStuckReports')}
                      </button>
                    </div>
                  )}

                  {syncResultMsg && (
                    <div style={{
                      padding: '8px 12px',
                      borderRadius: '6px',
                      backgroundColor: '#f8fafc',
                      border: '1px solid #e2e8f0',
                      fontSize: '0.82rem',
                      color: '#334155'
                    }}>
                      ℹ️ {syncResultMsg}
                    </div>
                  )}
                </div>
              );
            })()}
          </div>

          {/* NEAREST HELP PANEL */}
          <div className="villager-panel">
            <div className="villager-panel-heading">
              <div>
                <h3>NEAREST HELP</h3>
                <p>Verified public emergency facilities in {selectedDistrict}</p>
              </div>
            </div>

            {eligibleNearbyResources.length === 0 && (
              <p className="shelter-empty">No verified open shelter with available capacity was found within 25 km of your current map location.</p>
            )}

            {eligibleNearbyResources.slice(0, 3).map((res) => {
              const icon = res.type === 'Hospital' ? '🏥' : res._id === nearestOpenId ? '⭐' : '🏠';
              return (
                <div className="shelter-card" key={res._id}>
                  <div className="shelter-icon">{icon}</div>
                  <div className="shelter-info">
                    <strong>{res.name}</strong>
                    <span>
                      📏 <strong>{res.distance.toFixed(1)} km away</strong>
                      {res._id === nearestOpenId ? " · Recommended Shelter" : ""}
                    </span>
                    <div
                      style={{ fontSize: '0.75rem', color: '#166534', marginTop: '2px' }}
                      title="Verified by Sahayta Setu's authorized platform administrator"
                    >
                      {res.type || 'Relief Centre'} · ✓ Verified · {res.availableSpaces} spaces available
                    </div>
                  </div>
                  <span className={res.isFull ? "shelter-full" : "available"}>
                    {res.isFull ? "Full" : "Available"}
                  </span>
                </div>
              );
            })}

            <button className="route-button" onClick={scrollToMap}>
              🧭 View Navigation Route →
            </button>
          </div>
        </section>

        {/* FAMILY EVACUATION STATUS */}
        <FamilyStatusCard shelters={shelters} />

        {/* REALTIME NEARBY RESOURCES & SAFE EVACUATION MAP */}
        <section className="villager-panel evacuation-panel" ref={evacuationRef}>
          <div className="villager-panel-heading">
            <div>
              <h3>{t('resources.safeEvacuationRoute')}</h3>
              <p>{t('resources.turnByTurn', { district: selectedDistrict })}</p>
            </div>
          </div>

          <NearbyResourcesMap
            userPos={userPos}
            isLiveGps={isGpsActive}
            locationAccuracy={isGpsActive ? 30 : 2000}
            locationSource={isGpsActive ? t('app.exactGps') : t('app.approxDistrict', { district: selectedDistrict })}
            state={selectedState}
            district={selectedDistrict}
            onLocateMe={handleLocateMe}
            hasActiveSos={hasActiveSOS}
            sosCoords={activeRequest?.location ? [activeRequest.location.lat, activeRequest.location.lng] : null}
          />
        </section>

        {/* SOS REAL-TIME STATUS TRACKER */}
        <section className="status-section" style={{ display: 'block', padding: '24px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '12px', marginBottom: '16px' }}>
            <div>
              <p className="card-label" style={{ margin: 0 }}>LIVE EMERGENCY REQUEST TRACKER</p>
              <h3 style={{ margin: '4px 0 0 0' }}>{activeRequest ? `MY ACTIVE SOS: ${activeRequest.clientIncidentId || activeRequest._id}` : statusTitle}</h3>
              <p style={{ margin: '4px 0 0 0', color: '#64748b' }}>{statusText}</p>
            </div>
            <div className={`status-indicator ${hasActiveSOS ? "active" : ""}`}>
              <span></span>
              {statusBadge}
            </div>
          </div>

          {activeRequest && (
            <div style={{ backgroundColor: '#ffffff', borderRadius: '10px', padding: '16px', border: '1px solid #e2e8f0', marginTop: '12px' }}>
              {/* Stepper Progress */}
              <StatusStepper currentStatus={activeRequest.status} />
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: '12px', marginBottom: '16px' }}>
                <div style={{ padding: '8px', borderRadius: '8px', backgroundColor: '#f0fdf4', border: '1px solid #bbf7d0', fontSize: '0.8rem' }}>
                  <div style={{ color: '#16a34a', fontWeight: 'bold' }}>✓ Recorded Locally</div>
                  <small style={{ color: '#475569' }}>WebCrypto Signed</small>
                </div>
                <div style={{ padding: '8px', borderRadius: '8px', backgroundColor: '#f0fdf4', border: '1px solid #bbf7d0', fontSize: '0.8rem' }}>
                  <div style={{ color: '#16a34a', fontWeight: 'bold' }}>✓ Control Centre</div>
                  <small style={{ color: '#475569' }}>Received & Verified</small>
                </div>
                <div style={{ padding: '8px', borderRadius: '8px', backgroundColor: '#f0fdf4', border: '1px solid #bbf7d0', fontSize: '0.8rem' }}>
                  <div style={{ color: '#16a34a', fontWeight: 'bold' }}>✓ Priority</div>
                  <small style={{ color: '#dc2626', fontWeight: 'bold' }}>{activeRequest.priority || 'HIGH'}</small>
                </div>
                <div style={{
                  padding: '8px',
                  borderRadius: '8px',
                  backgroundColor: activeRequest.assignedTo ? '#f0fdf4' : '#fffbe6',
                  border: `1px solid ${activeRequest.assignedTo ? '#bbf7d0' : '#fef08a'}`,
                  fontSize: '0.8rem'
                }}>
                  <div style={{ color: activeRequest.assignedTo ? '#16a34a' : '#b45309', fontWeight: 'bold' }}>
                    {activeRequest.assignedTo ? '✓ Assigned' : '○ Matching'}
                  </div>
                  <small style={{ color: '#475569' }}>
                    {activeRequest.assignedTo ? (activeRequest.assignedTo.name || 'Unit Assigned') : 'Finding nearest unit'}
                  </small>
                </div>
                <div style={{
                  padding: '8px',
                  borderRadius: '8px',
                  backgroundColor: activeRequest.status === 'In Progress' ? '#eff6ff' : '#f8fafc',
                  border: `1px solid ${activeRequest.status === 'In Progress' ? '#bfdbfe' : '#e2e8f0'}`,
                  fontSize: '0.8rem'
                }}>
                  <div style={{ color: activeRequest.status === 'In Progress' ? '#2563eb' : '#64748b', fontWeight: 'bold' }}>
                    {activeRequest.status === 'In Progress' ? '→ En Route' : '○ En Route'}
                  </div>
                  <small style={{ color: '#475569' }}>
                    {activeRequest.responderDistanceKm ? `±${activeRequest.responderDistanceKm.toFixed(1)} km away` : 'Active mission'}
                  </small>
                </div>
                <div style={{
                  padding: '8px',
                  borderRadius: '8px',
                  backgroundColor: activeRequest.status === 'Resolved' ? '#f0fdf4' : '#f8fafc',
                  border: `1px solid ${activeRequest.status === 'Resolved' ? '#bbf7d0' : '#e2e8f0'}`,
                  fontSize: '0.8rem'
                }}>
                  <div style={{ color: activeRequest.status === 'Resolved' ? '#16a34a' : '#64748b', fontWeight: 'bold' }}>
                    {activeRequest.status === 'Resolved' ? '✓ Resolved' : '○ Resolved'}
                  </div>
                  <small style={{ color: '#475569' }}>Rescue completed</small>
                </div>
              </div>

              {/* Responder Details Box */}
              {activeRequest.assignedTo && (
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '16px', alignItems: 'center', justifyContent: 'space-between', backgroundColor: '#f8fafc', padding: '12px', borderRadius: '8px' }}>
                  <div>
                    <span style={{ fontSize: '0.75rem', color: '#64748b', fontWeight: 'bold', textTransform: 'uppercase' }}>Assigned Response Unit</span>
                    <div style={{ fontSize: '0.95rem', fontWeight: 'bold', color: '#0f172a' }}>
                      🚑 {activeRequest.assignedTo.name || 'Emergency Response Unit'}
                    </div>
                    {activeRequest.assignedTo.phone && (
                      <div style={{ fontSize: '0.8rem', color: '#2563eb' }}>
                        📞 Direct Line: <a href={`tel:${activeRequest.assignedTo.phone}`}>{activeRequest.assignedTo.phone}</a>
                      </div>
                    )}
                  </div>
                  {activeRequest.responderDistanceKm && (
                    <div style={{ textAlign: 'right' }}>
                      <span style={{ fontSize: '0.75rem', color: '#64748b', fontWeight: 'bold' }}>APPROX DISTANCE</span>
                      <div style={{ fontSize: '1.1rem', fontWeight: '800', color: '#16a34a' }}>
                        {activeRequest.responderDistanceKm.toFixed(1)} km
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {!activeRequest && latestQueued && (
            <div style={{ backgroundColor: '#ffffff', borderRadius: '10px', padding: '16px', border: '1px solid #fed7aa', marginTop: '12px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '8px', marginBottom: '12px' }}>
                <div>
                  <span style={{ fontSize: '0.75rem', fontWeight: 'bold', color: '#c2410c', textTransform: 'uppercase' }}>
                    📱 LOCAL EMERGENCY QUEUE · STORE-AND-FORWARD
                  </span>
                  <h4 style={{ margin: '4px 0 0 0', color: '#0f172a' }}>
                    {latestQueued.incidentType || 'Emergency'} Incident ({latestQueued.clientIncidentId})
                  </h4>
                </div>
                <button
                  type="button"
                  className="cc-secondary-btn"
                  onClick={handleManualSync}
                  disabled={syncingManual}
                  style={{ fontSize: '0.8rem', padding: '6px 12px', cursor: 'pointer' }}
                >
                  {syncingManual ? '⏳ Syncing...' : '🔄 Retry Sync Now'}
                </button>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: '8px', marginBottom: '12px' }}>
                <div style={{ padding: '8px', borderRadius: '8px', backgroundColor: '#fff7ed', border: '1px solid #ffedd5', fontSize: '0.8rem' }}>
                  <div style={{ color: '#c2410c', fontWeight: 'bold' }}>Status</div>
                  <small style={{ color: '#475569', fontWeight: '600' }}>{latestQueued.syncStatus || 'OFFLINE_QUEUE_ONLY'}</small>
                </div>
                <div style={{ padding: '8px', borderRadius: '8px', backgroundColor: '#f8fafc', border: '1px solid #e2e8f0', fontSize: '0.8rem' }}>
                  <div style={{ color: '#334155', fontWeight: 'bold' }}>Retry Count</div>
                  <small style={{ color: '#475569' }}>{latestQueued.retryCount || 0} attempts</small>
                </div>
                <div style={{ padding: '8px', borderRadius: '8px', backgroundColor: '#f8fafc', border: '1px solid #e2e8f0', fontSize: '0.8rem' }}>
                  <div style={{ color: '#334155', fontWeight: 'bold' }}>Last Attempt</div>
                  <small style={{ color: '#475569' }}>{latestQueued.lastAttemptTime ? alertTime(latestQueued.lastAttemptTime) : 'Pending first try'}</small>
                </div>
                <div style={{ padding: '8px', borderRadius: '8px', backgroundColor: '#f8fafc', border: '1px solid #e2e8f0', fontSize: '0.8rem' }}>
                  <div style={{ color: '#334155', fontWeight: 'bold' }}>Payload Size</div>
                  <small style={{ color: '#16a34a', fontWeight: 'bold' }}>&lt; 1 KB (SOS Lite)</small>
                </div>
              </div>

              <p style={{ margin: 0, fontSize: '0.8rem', color: '#64748b' }}>
                🔒 <strong>Offline-First Guarantee:</strong> Your emergency request is cryptographically signed and stored in this device's IndexedDB. Automatic store-and-forward will synchronize via background sync, cellular reconnection, or opportunistic relay.
              </p>
            </div>
          )}
        </section>

        {/* FOOTER */}
        <footer className="villager-footer">
          <span>🛡️ SAHAYTA SETU</span>
          <span>Emergency Assistance & Disaster Response Network</span>
          <span>System Online ●</span>
        </footer>
      </main>

      {showSOS && (
        <SOSModal
          user={{ ...user, state: selectedState, district: selectedDistrict }}
          onClose={() => setShowSOS(false)}
          onSent={handleSOSSent}
        />
      )}
    </div>
  );
}

export default VillagerDashboard;