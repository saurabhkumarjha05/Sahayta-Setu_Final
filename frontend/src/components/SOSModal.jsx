import { useCallback, useEffect, useState, useRef } from "react";
import { getToken } from "../api";
import {
  getLocationWithSmartFallback,
  queueAndSendEmergencySOS,
} from "../utils/offlineSOS";
import { useI18n } from "../i18n";
import { DEFAULT_STATE, DEFAULT_DISTRICT } from "../config/locationConfig";
import { findDistrictCoordinates } from "../data/indiaLocations";

const EMERGENCY_TYPES = [
  { id: "Flood", icon: "🌊", key: "flood", fallback: "Flood / Waterlogging" },
  { id: "Flash Flood", icon: "⛈️", key: "flashFlood", fallback: "Flash Flood" },
  { id: "Landslide", icon: "⛰️", key: "landslide", fallback: "Landslide / Rockfall" },
  { id: "Medical", icon: "🚑", key: "medical", fallback: "Medical Emergency" },
  { id: "Earthquake", icon: "🏚️", key: "earthquake", fallback: "Earthquake / Tremor" },
  { id: "Fire", icon: "🔥", key: "fire", fallback: "Fire Outbreak" },
  { id: "Cyclone", icon: "🌀", key: "cyclone", fallback: "Cyclone / Storm" },
  { id: "Building Collapse", icon: "🏗️", key: "collapse", fallback: "Building Collapse" },
  { id: "Evacuation", icon: "🚶", key: "evacuation", fallback: "Trapped / Evacuation" },
  { id: "Other", icon: "⚠️", key: "other", fallback: "Other Hazard" },
];

const PRIORITIES = [
  { id: "HIGH", key: "highPriority", fallback: "High Priority" },
  { id: "CRITICAL", key: "criticalPriority", fallback: "Critical / Life Threat" }
];

function SOSModal({ user, onClose, onSent }) {
  const { t } = useI18n();
  const [emergencyType, setEmergencyType] = useState("Medical");
  const [priority, setPriority] = useState("HIGH");
  const [peopleAffected, setPeopleAffected] = useState(1);
  const [vulnerableCount, setVulnerableCount] = useState(0);
  const [needsMedical, setNeedsMedical] = useState(false);
  const [description, setDescription] = useState("");
  const [location, setLocation] = useState(null);
  const [locationState, setLocationState] = useState("loading"); // loading | ready | missing
  const [sending, setSending] = useState(false);
  const [message, setMessage] = useState("");
  const [pressProgress, setPressProgress] = useState(0);

  const pressTimerRef = useRef(null);

  const captureLocation = useCallback(async () => {
    setLocationState("loading");
    const fallbackDistrict = user?.district || DEFAULT_DISTRICT;
    const fallbackState = user?.state || DEFAULT_STATE;
    const districtCoordinates = findDistrictCoordinates(fallbackDistrict, fallbackState);
    const result = await getLocationWithSmartFallback({
      districtFallback: {
        district: fallbackDistrict,
        lat: user?.lat ?? districtCoordinates?.lat,
        lng: user?.lng ?? districtCoordinates?.lng
      }
    });
    setLocation(result);
    setLocationState(result ? "ready" : "missing");
  }, [user?.district, user?.state, user?.lat, user?.lng]);

  useEffect(() => {
    let active = true;
    const initialCapture = setTimeout(() => {
      captureLocation().catch((error) => {
        console.error("Could not determine SOS location:", error);
        if (active) {
          setLocationState("missing");
          setMessage(error.message || "Could not determine your location.");
        }
      });
    }, 0);
    return () => {
      active = false;
      clearTimeout(initialCapture);
    };
  }, [captureLocation]);

  useEffect(() => {
    const handleKey = (event) => {
      if (event.key === "Escape" && !sending) onClose();
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [onClose, sending]);

  const handleSend = async () => {
    if (!emergencyType) {
      setMessage(t('sosModal.chooseTypeMsg') || "Please choose the type of emergency.");
      return;
    }
    if (!location) {
      setMessage(t('sosModal.locationRequiredMsg') || "Location coordinates are required. Tap Refresh above.");
      return;
    }

    setSending(true);
    setMessage("");

    try {
      const result = await queueAndSendEmergencySOS({
        emergencyType,
        priority,
        peopleAffected: Number(peopleAffected) || 1,
        vulnerableCount: Number(vulnerableCount) || 0,
        needsMedical: Boolean(needsMedical),
        description: description || `Emergency ${emergencyType} dispatch request`,
        latitude: location.latitude,
        longitude: location.longitude,
        locationAccuracy: location.accuracy,
        locationSource: location.locationSource,
        isApproximateLocation: location.isApproximateLocation,
        village: user?.village || "",
        district: user?.district || DEFAULT_DISTRICT,
        state: user?.state || DEFAULT_STATE,
        contactName: user?.name,
        contactPhone: user?.phone,
        userId: user?._id || user?.id || 'demo-villager',
        token: getToken(),
      });

      if (result.syncStatus === 'SERVER_RECEIVED' || result.status === 'SERVER_RECEIVED') {
        onSent("SERVER_RECEIVED", result);
      } else if (result.syncStatus === 'SYNCING') {
        onSent("SYNCING", result);
      } else if (result.syncStatus === 'SYNC_REJECTED' || result.status === 'SYNC_REJECTED') {
        onSent("SYNC_REJECTED", result);
      } else {
        onSent("OFFLINE_QUEUE_ONLY", result);
      }
    } catch (error) {
      console.error("SOS error:", error);
      setMessage(t('sosModal.errorSaveMsg') || "Could not save the SOS on this device. Please try again.");
    } finally {
      setSending(false);
    }
  };

  // Press & Hold Handlers for Emergency Trigger
  const startPress = () => {
    if (sending) return;
    setPressProgress(0);
    const startTime = Date.now();
    const duration = 1200; // 1.2s hold

    pressTimerRef.current = setInterval(() => {
      const elapsed = Date.now() - startTime;
      const pct = Math.min(100, Math.round((elapsed / duration) * 100));
      setPressProgress(pct);

      if (elapsed >= duration) {
        clearInterval(pressTimerRef.current);
        pressTimerRef.current = null;
        setPressProgress(100);
        handleSend();
      }
    }, 40);
  };

  const cancelPress = () => {
    if (pressTimerRef.current) {
      clearInterval(pressTimerRef.current);
      pressTimerRef.current = null;
    }
    setPressProgress(0);
  };

  return (
    <div className="sos-modal-overlay" onClick={() => !sending && onClose()}>
      <div
        className="sos-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="sos-modal-title"
        onClick={(event) => event.stopPropagation()}
      >
        {/* Sticky Pinned Header */}
        <div className="sos-modal-header">
          <div>
            <p className="sos-modal-label">{t('sosModal.dispatchLabel')}</p>
            <h3 id="sos-modal-title">{t('sosModal.title')}</h3>
          </div>

          <button
            type="button"
            className="sos-modal-close"
            onClick={onClose}
            disabled={sending}
            aria-label={t('sosModal.close') || "Close"}
          >
            ✕
          </button>
        </div>

        {/* Scrollable Modal Body */}
        <div className="sos-modal-body">
          {/* Emergency Type Grid */}
          <div className="sos-type-grid">
            {EMERGENCY_TYPES.map((type) => {
              const label = t(`sosModal.${type.key}`) || type.fallback;
              const isSelected = emergencyType === type.id;
              return (
                <button
                  key={type.id}
                  type="button"
                  className={`sos-type ${isSelected ? "selected" : ""}`}
                  onClick={() => {
                    setEmergencyType(type.id);
                    setMessage("");
                  }}
                >
                  <span>{type.icon}</span>
                  {label}
                </button>
              );
            })}
          </div>

          {/* Priority Selector */}
          <div style={{ display: 'flex', gap: '8px', margin: '2px 0' }}>
            {PRIORITIES.map((p) => {
              const pLabel = t(`sosModal.${p.key}`) || p.fallback;
              const isSelected = priority === p.id;
              return (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => setPriority(p.id)}
                  style={{
                    flex: 1,
                    padding: '8px 12px',
                    borderRadius: '8px',
                    fontSize: '0.82rem',
                    fontWeight: '700',
                    cursor: 'pointer',
                    minHeight: '42px',
                    border: isSelected ? '2px solid #dc2626' : '1px solid #cbd5e1',
                    backgroundColor: isSelected ? '#fef2f2' : '#f8fafc',
                    color: isSelected ? '#b91c1c' : '#475569',
                    transition: 'all 0.15s ease'
                  }}
                >
                  {pLabel}
                </button>
              );
            })}
          </div>

          {/* Location Detection Box */}
          <div className={`sos-location sos-location-${locationState}`}>
            <span style={{ fontSize: '1.25rem' }}>📍</span>

            <div>
              {locationState === "loading" && (
                <strong>{t('sosModal.acquiringLocation')}</strong>
              )}

              {locationState === "ready" && (
                <>
                  <strong>
                    {location.locationSource === "GPS_EXACT"
                      ? t('sosModal.exactGps', { accuracy: location.accuracy })
                      : t('sosModal.approxDistrict', { district: user?.district || 'Uttarakhand' })}
                  </strong>
                  <small>
                    {location.latitude.toFixed(5)}, {location.longitude.toFixed(5)} ({user?.district || 'KCC Institude ,Greater Noida'})
                  </small>
                </>
              )}

              {locationState === "missing" && (
                <>
                  <strong>{t('sosModal.locationNotDetected')}</strong>
                  <small>{t('sosModal.fallbackDesc')}</small>
                </>
              )}
            </div>

            {locationState !== "loading" && (
              <button type="button" onClick={captureLocation} disabled={sending}>
                {t('sosModal.refresh')}
              </button>
            )}
          </div>

          {/* SOS Lite Critical Counts (Compact < 1 KB payload) */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
            <div style={{ backgroundColor: '#f8fafc', padding: '8px 10px', borderRadius: '8px', border: '1px solid #e2e8f0' }}>
              <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 'bold', color: '#475569', marginBottom: '4px' }}>
                👥 {t('sosModal.peopleAffected')}
              </label>
              <input
                type="number"
                min="1"
                max="100"
                value={peopleAffected}
                onChange={(e) => setPeopleAffected(Math.max(1, parseInt(e.target.value) || 1))}
                disabled={sending}
                style={{ width: '100%', padding: '6px 8px', borderRadius: '6px', border: '1px solid #cbd5e1', fontSize: '0.9rem' }}
              />
            </div>

            <div style={{ backgroundColor: '#f8fafc', padding: '8px 10px', borderRadius: '8px', border: '1px solid #e2e8f0' }}>
              <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 'bold', color: '#475569', marginBottom: '4px' }}>
                👶 {t('sosModal.vulnerable')}
              </label>
              <input
                type="number"
                min="0"
                max="50"
                value={vulnerableCount}
                onChange={(e) => setVulnerableCount(Math.max(0, parseInt(e.target.value) || 0))}
                disabled={sending}
                style={{ width: '100%', padding: '6px 8px', borderRadius: '6px', border: '1px solid #cbd5e1', fontSize: '0.9rem' }}
              />
            </div>
          </div>

          {/* Needs Urgent Medical Checkbox */}
          <label style={{
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            padding: '8px 12px',
            backgroundColor: needsMedical ? '#fef2f2' : '#f8fafc',
            borderRadius: '8px',
            border: `1px solid ${needsMedical ? '#fca5a5' : '#e2e8f0'}`,
            cursor: 'pointer',
            fontSize: '0.82rem',
            fontWeight: '600',
            color: needsMedical ? '#b91c1c' : '#334155',
            minHeight: '40px'
          }}>
            <input
              type="checkbox"
              checked={needsMedical}
              onChange={(e) => setNeedsMedical(e.target.checked)}
              disabled={sending}
              style={{ width: '18px', height: '18px' }}
            />
            🚑 {t('sosModal.immediateMedical')}
          </label>

          {/* Optional Brief Details (synced in follow-up) */}
          <input
            type="text"
            placeholder={t('sosModal.notesPlaceholder')}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            style={{
              width: '100%',
              padding: '10px 12px',
              borderRadius: '8px',
              border: '1px solid #cbd5e1',
              fontSize: '0.85rem',
              boxSizing: 'border-box'
            }}
            disabled={sending}
          />

          {message && <p className="sos-modal-message">{message}</p>}
        </div>

        {/* Pinned Sticky Footer - Always Visible */}
        <div className="sos-modal-footer">
          <button
            type="button"
            className="sos-modal-send"
            onClick={handleSend}
            onMouseDown={startPress}
            onMouseUp={cancelPress}
            onTouchStart={startPress}
            onTouchEnd={cancelPress}
            disabled={sending || locationState === "loading"}
            style={{
              position: 'relative',
              overflow: 'hidden',
              userSelect: 'none'
            }}
          >
            {pressProgress > 0 && pressProgress < 100 && (
              <span
                style={{
                  position: 'absolute',
                  left: 0,
                  top: 0,
                  bottom: 0,
                  width: `${pressProgress}%`,
                  backgroundColor: 'rgba(0,0,0,0.25)',
                  transition: 'width 0.05s linear'
                }}
              />
            )}
            <span style={{ position: 'relative', zIndex: 2 }}>
              {sending
                ? t('sosModal.signingAndSending')
                : pressProgress > 0
                ? t('sosModal.holdToConfirm', { pct: pressProgress })
                : t('sosModal.sendButton')}
            </span>
          </button>

          <p className="sos-modal-note">
            🔒 <strong>{t('sosModal.cryptoNote')}</strong>
          </p>
        </div>
      </div>
    </div>
  );
}

export default SOSModal;
