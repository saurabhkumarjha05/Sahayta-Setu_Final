import { useCallback, useEffect, useState } from "react";
import NgoMap from "./components/map/NgoMap";
import ProfileMenu from "./components/ProfileMenu";
import LocationModal from "./components/LocationModal";
import LocationSelector from "./components/LocationSelector";
import { apiFetch, initials } from "./api";
import { calculateDistanceKm } from "./data/verifiedResources";
import { getSocket, subscribeToDistrict } from "./utils/socketClient";
import { DEFAULT_STATE, DEFAULT_DISTRICT } from "./config/locationConfig";

// The id of the NGO an SOS is assigned to (populated object or plain id)
const assignedId = (sos) => sos.assignedTo?._id || sos.assignedTo || null;

function NgoDashboard({ user, onLogout }) {
  const [allRequests, setAllRequests] = useState([]);
  const [loading, setLoading] = useState(true);
  const [listError, setListError] = useState("");
  const [actionError, setActionError] = useState("");
  const [notice, setNotice] = useState("");
  const [actionLoading, setActionLoading] = useState(false);
  const [selectedId, setSelectedId] = useState(null);
  const [locationSOS, setLocationSOS] = useState(null);

  // NGO Location State
  const [selectedState, setSelectedState] = useState(user?.state || DEFAULT_STATE);
  const [selectedDistrict, setSelectedDistrict] = useState(user?.district || DEFAULT_DISTRICT);
  const [ngoStatus, setNgoStatus] = useState("Unknown");
  const [ngoCoords, setNgoCoords] = useState(null);
  const [verifiedSheltersCount, setVerifiedSheltersCount] = useState(null);
  const [locationUpdateStatus, setLocationUpdateStatus] = useState("");

  const myNgoId = user?.ngo || null;

  useEffect(() => {
    let active = true;
    apiFetch('/api/ngos/me')
      .then((data) => {
        if (active && ['Available', 'Busy', 'Offline'].includes(data.status)) setNgoStatus(data.status);
      })
      .catch((error) => {
        console.warn("Could not load responder status:", error.message);
      });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    let active = true;
    apiFetch(`/api/shelters?state=${encodeURIComponent(selectedState)}&district=${encodeURIComponent(selectedDistrict)}`)
      .then((data) => {
        if (!active) return;
        const eligible = (Array.isArray(data) ? data : []).filter((shelter) =>
          shelter.status === 'ACTIVE'
          && shelter.verified !== false
          && Number(shelter.availableSpaces) > 0
        );
        setVerifiedSheltersCount(eligible.length);
      })
      .catch((error) => {
        console.warn("Could not load verified shelter count:", error.message);
        if (active) setVerifiedSheltersCount(null);
      });
    return () => { active = false; };
  }, [selectedState, selectedDistrict]);

  // All SOS requests refreshed every 4 seconds (real-time stream)
  const fetchSOS = useCallback(async () => {
    try {
      const data = await apiFetch(`/api/sos?state=${encodeURIComponent(selectedState)}&district=${encodeURIComponent(selectedDistrict)}`);
      setAllRequests(Array.isArray(data) ? data : []);
      setListError("");
    } catch (err) {
      console.error("SOS fetch error:", err);
      setListError(
        err.status === 401 || err.status === 403
          ? "Your login has expired. Please log out and log in again."
          : "Unable to load emergency requests. Is the backend running?"
      );
    } finally {
      setLoading(false);
    }
  }, [selectedState, selectedDistrict]);

  // Real-time Socket.IO listener for new emergencies, assignments, and responder movement
  useEffect(() => {
    subscribeToDistrict(selectedDistrict, "ngo");
    const s = getSocket();

    const handleNewSOS = (data) => {
      console.log("🚨 Emergency Alert dispatched to NGO:", data);
      fetchSOS();
    };

    const handleSOSAssigned = (data) => {
      console.log("🚑 Mission assignment locked:", data);
      fetchSOS();
    };

    s.on("emergency:new_sos", handleNewSOS);
    s.on("sos:assigned", handleSOSAssigned);
    s.on("sos:list_updated", fetchSOS);

    return () => {
      s.off("emergency:new_sos", handleNewSOS);
      s.off("sos:assigned", handleSOSAssigned);
      s.off("sos:list_updated", fetchSOS);
    };
  }, [selectedDistrict, fetchSOS]);

  useEffect(() => {
    const first = setTimeout(fetchSOS, 0);
    const interval = setInterval(fetchSOS, 4000);
    return () => {
      clearTimeout(first);
      clearInterval(interval);
    };
  }, [fetchSOS]);

  // Handle Location Selector change
  const handleLocationChange = ({ state, district, coordinates }) => {
    setSelectedState(state);
    setSelectedDistrict(district);
    setNgoCoords(null);
    if (!coordinates) setLocationUpdateStatus("No verified map center is available for that district.");
    else setLocationUpdateStatus("Region updated. Share your current GPS location before publishing your operational position.");
  };

  // Status Change Handler (Available / Busy / Offline)
  const handleStatusChange = async (newStatus) => {
    if (!ngoCoords) {
      setLocationUpdateStatus("Share your current GPS location before updating operational status.");
      return;
    }
    try {
      const response = await apiFetch('/api/ngos/location', {
        method: 'PATCH',
        body: JSON.stringify({
          lat: ngoCoords.lat,
          lng: ngoCoords.lng,
          state: selectedState,
          district: selectedDistrict,
          status: newStatus
        })
      });
      setNgoStatus(response.status);
      setLocationUpdateStatus(`✓ Availability status updated to: ${newStatus.toUpperCase()}`);
      setTimeout(() => setLocationUpdateStatus(""), 3000);
    } catch (error) {
      setLocationUpdateStatus(`Status update failed: ${error.message}`);
    }
  };

  // GPS Update My Location action
  const handleUpdateGpsLocation = () => {
    if (!navigator.geolocation) {
      setLocationUpdateStatus("Geolocation is not supported by your browser");
      return;
    }
    setLocationUpdateStatus("Fetching GPS coordinates...");
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        const lat = pos.coords.latitude;
        const lng = pos.coords.longitude;
        try {
          const response = await apiFetch('/api/ngos/location', {
            method: 'PATCH',
            body: JSON.stringify({
              lat,
              lng,
              state: selectedState,
              district: selectedDistrict,
              status: ['Available', 'Busy', 'Offline'].includes(ngoStatus) ? ngoStatus : undefined
            })
          });
          setNgoCoords({ lat, lng });
          if (['Available', 'Busy', 'Offline'].includes(response.status)) setNgoStatus(response.status);
          setLocationUpdateStatus(`✓ Operational location updated to GPS (${lat.toFixed(4)}, ${lng.toFixed(4)})`);
        } catch (error) {
          setLocationUpdateStatus(`Could not publish GPS location: ${error.message}`);
        }
        setTimeout(() => setLocationUpdateStatus(""), 5000);
      },
      (err) => {
        console.warn("GPS error:", err);
        setLocationUpdateStatus(`Could not determine current GPS position: ${err.message}. No simulated location was shared.`);
        setTimeout(() => setLocationUpdateStatus(""), 4000);
      }
    );
  };

  // Filter requests
  const pending = allRequests.filter((sos) => sos.status === "Pending");
  const mine = allRequests.filter(
    (sos) => sos.status === "In Progress" && myNgoId && assignedId(sos) === myNgoId
  );
  const visible = [...mine, ...pending];

  // Stats calculation
  const currentRequest = visible.find((sos) => sos._id === selectedId) || visible[0];
  const otherRequests = visible.filter((sos) => sos !== currentRequest).slice(0, 4);
  const isMine = currentRequest && assignedId(currentRequest) === myNgoId;

  // Compute distance from NGO to current request
  const currentReqDistance = ngoCoords && currentRequest && currentRequest.location?.lat
    ? calculateDistanceKm([ngoCoords.lat, ngoCoords.lng], [currentRequest.location.lat, currentRequest.location.lng])
    : null;

  const runAction = async (action, successMessage) => {
    if (!currentRequest || actionLoading) return;
    setActionLoading(true);
    setActionError("");
    setNotice("");
    try {
      await action(currentRequest);
      setNotice(successMessage);
      await fetchSOS();
    } catch (err) {
      console.error("SOS action error:", err);
      if (err.status === 409) {
        setActionError("🚑 RESPONDER ALREADY ASSIGNED: Another response unit accepted and locked this mission first. Moving to the next available emergency.");
        setSelectedId(null);
        await fetchSOS();
      } else if (err.status === 401 || err.status === 403) {
        setActionError(`${err.message}. Try logging out and logging in again as NGO.`);
      } else {
        setActionError(err.status ? err.message : "Cannot reach the server. Is the backend running on port 5000?");
      }
    } finally {
      setActionLoading(false);
    }
  };

  const handleAccept = () =>
    runAction(
      (sos) => apiFetch(`/api/sos/${encodeURIComponent(sos._id || sos.id || sos.clientIncidentId)}/assign`, { method: "PATCH" }),
      "Request accepted. The villager can now see that help is on the way."
    );

  const handleResolve = () =>
    runAction(
      (sos) =>
        apiFetch(`/api/sos/${encodeURIComponent(sos._id || sos.id || sos.clientIncidentId)}/status`, {
          method: "PATCH",
          body: JSON.stringify({ status: "Resolved" }),
        }),
      "Marked as resolved. Thank you!"
    );

  const formatTime = (timestamp) => {
    if (!timestamp) return "Just now";
    const diffMinutes = Math.floor((new Date() - new Date(timestamp)) / 60000);
    if (diffMinutes < 1) return "Just now";
    if (diffMinutes === 1) return "1 minute ago";
    if (diffMinutes < 60) return `${diffMinutes} minutes ago`;
    const diffHours = Math.floor(diffMinutes / 60);
    if (diffHours === 1) return "1 hour ago";
    if (diffHours < 24) return `${diffHours} hours ago`;
    const diffDays = Math.floor(diffHours / 24);
    return diffDays === 1 ? "1 day ago" : `${diffDays} days ago`;
  };

  const TYPE_ICONS = { Flood: "🌊", Landslide: "⛰️", Medical: "🚑", Other: "⚠️" };

  return (
    <div className="ngo-dashboard">
      {/* HEADER */}
      <header className="ngo-header">
        <div className="ngo-brand">
          <div className="ngo-logo">🛡️</div>
          <div>
            <h2>SAHAYTA SETU</h2>
            <span>NGO Response Control</span>
          </div>
        </div>

        <div className="ngo-location" style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <div>
            <small>OPERATIONAL REGION</small>
            <strong>{selectedDistrict}, {selectedState}</strong>
          </div>
        </div>

        <ProfileMenu
          className="ngo-profile"
          avatarClassName="ngo-avatar"
          initials={initials(user?.name || "NGO")}
          name={user?.name || "Responder"}
          subtitle="NGO Account"
          phone={user?.phone}
          onLogout={onLogout}
        />
      </header>

      {/* LOCATION SELECTION BAR */}
      <div style={{
        backgroundColor: '#1e293b',
        color: '#f8fafc',
        padding: '12px 24px',
        display: 'flex',
        flexWrap: 'wrap',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: '16px',
        borderBottom: '1px solid #334155'
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '16px', flex: '1 1 350px' }}>
          <span style={{ fontSize: '0.85rem', color: '#94a3b8', fontWeight: '600', whiteSpace: 'nowrap' }}>📍 Target Region:</span>
          <LocationSelector
            selectedState={selectedState}
            selectedDistrict={selectedDistrict}
            onChange={handleLocationChange}
            showLabels={false}
          />
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <button
            onClick={handleUpdateGpsLocation}
            style={{
              backgroundColor: '#2563eb',
              color: '#ffffff',
              border: 'none',
              borderRadius: '6px',
              padding: '8px 16px',
              fontSize: '0.85rem',
              fontWeight: '600',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              boxShadow: '0 2px 4px rgba(0,0,0,0.2)'
            }}
          >
            🎯 UPDATE MY LOCATION (GPS)
          </button>

          <select
            value={ngoStatus}
            onChange={(e) => handleStatusChange(e.target.value)}
            disabled={!ngoCoords}
            title={ngoCoords ? "Update organization operational status" : "Share your current GPS position first"}
            style={{
              backgroundColor: ngoStatus === 'Available' ? '#166534' : '#9a3412',
              color: '#ffffff',
              border: 'none',
              borderRadius: '6px',
              padding: '8px 12px',
              fontSize: '0.85rem',
              fontWeight: '700',
              cursor: 'pointer'
            }}
          >
            <option value="Unknown" disabled>● STATUS NOT SET</option>
            <option value="Available">● AVAILABLE</option>
            <option value="Busy">● BUSY</option>
            <option value="Offline">● OFFLINE</option>
          </select>
        </div>
      </div>

      {locationUpdateStatus && (
        <div style={{
          backgroundColor: '#eff6ff',
          color: '#1e40af',
          padding: '8px 24px',
          fontSize: '0.85rem',
          fontWeight: '600',
          borderBottom: '1px solid #bfdbfe'
        }}>
          {locationUpdateStatus}
        </div>
      )}

      {/* MAIN */}
      <main className="ngo-main">
        {/* WELCOME */}
        <section className="ngo-welcome">
          <div>
            <p className="section-label">RESPONSE CENTRE</p>
            <h1>Operational Command Dashboard</h1>
            <p>
              Real-time disaster coordination map, live emergency SOS feeds and verified relief shelters in {selectedDistrict}, {selectedState}.
            </p>
          </div>

          <div className="availability-badge" style={{ backgroundColor: ngoStatus === 'Available' ? '#16a34a' : '#d97706' }}>
            <span></span>
            Unit Status: {ngoStatus}
          </div>
        </section>

        {/* 4 LIVE COUNTERS */}
        <section className="ngo-stats ngo-stats-4" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '16px' }}>
          <div className="ngo-stat-card">
            <span style={{ fontSize: '1.5rem' }}>🚨</span>
            <div>
              <small>ACTIVE SOS</small>
              <strong style={{ color: pending.length > 0 ? '#dc2626' : '#16a34a' }}>
                {loading ? "--" : String(pending.length).padStart(2, "0")}
              </strong>
            </div>
          </div>

          <div className="ngo-stat-card">
            <span style={{ fontSize: '1.5rem' }}>🏠</span>
            <div>
              <small>NEARBY SHELTERS</small>
              <strong>{verifiedSheltersCount === null ? "--" : String(verifiedSheltersCount).padStart(2, "0")}</strong>
            </div>
          </div>

          <div className="ngo-stat-card">
            <span style={{ fontSize: '1.5rem' }}>🚑</span>
            <div>
              <small>ORGANIZATION STATUS</small>
              <strong>{ngoStatus.toUpperCase()}</strong>
            </div>
          </div>

          <div className="ngo-stat-card">
            <span style={{ fontSize: '1.5rem' }}>📋</span>
            <div>
              <small>ASSIGNED CASES</small>
              <strong>{loading ? "--" : String(mine.length).padStart(2, "0")}</strong>
            </div>
          </div>
        </section>

        {/* EMERGENCY REQUEST */}
        <section className="ngo-request-section">
          <div className="section-heading">
            <div>
              <h2>Live Emergency Dispatch Stream</h2>
              <p>SOS incidents matching {selectedDistrict}, {selectedState}</p>
            </div>

            <span className="request-count" style={{ backgroundColor: '#dc2626', color: '#fff' }}>
              {visible.length} ACTIVE INCIDENTS
            </span>
          </div>

          {listError && <div className="ngo-banner ngo-banner-error">{listError}</div>}

          {!myNgoId && (
            <div className="ngo-banner ngo-banner-error">
              Your account is not linked to a responder organization. Contact an administrator to complete verification.
            </div>
          )}

          {actionError && (
            <div className="ngo-banner ngo-banner-error">
              <span>{actionError}</span>
              <button type="button" onClick={() => setActionError("")} aria-label="Dismiss">✕</button>
            </div>
          )}

          {notice && (
            <div className="ngo-banner ngo-banner-success">
              <span>{notice}</span>
              <button type="button" onClick={() => setNotice("")} aria-label="Dismiss">✕</button>
            </div>
          )}

          {/* LOADING */}
          {loading && (
            <div className="emergency-request">
              <h3>Scanning real-time emergency signals...</h3>
              <p>Connecting to the Sahayta Setu response network.</p>
            </div>
          )}

          {/* NO REQUEST */}
          {!loading && !currentRequest && (
            <div className="emergency-request">
              <div className="request-top">
                <div className="severity">
                  <span className="severity-icon">✓</span>
                  <div>
                    <small>ALL CLEAR IN {selectedDistrict.toUpperCase()}</small>
                    <h3>No active distress calls reported in this district</h3>
                  </div>
                </div>
                <span className="request-status">Monitoring</span>
              </div>

              <div className="request-message">
                <strong>Live Radar Active</strong>
                <p>New villager SOS alerts in {selectedDistrict} will automatically stream here without refreshing.</p>
              </div>
            </div>
          )}

          {/* CURRENT REQUEST */}
          {!loading && currentRequest && (
            <div className={`emergency-request ${isMine ? "request-mine" : ""}`}>
              <div className="request-top">
                <div className="severity">
                  <span className="severity-icon">{isMine ? "🚐" : "🚨"}</span>
                  <div>
                    <small>{isMine ? "MISSION ASSIGNED TO YOUR UNIT" : "DISTRESS SOS RECEIVED"}</small>
                    <h3>
                      {currentRequest.type || "Emergency Rescue"} at {currentRequest.village || selectedDistrict}
                    </h3>
                  </div>
                </div>

                <span className="request-status" style={{ backgroundColor: isMine ? '#15803d' : '#dc2626', color: '#fff' }}>
                  {currentRequest.status}
                </span>
              </div>

              <div className="request-details">
                <div className="request-detail">
                  <span>📍</span>
                  <div>
                    <small>LOCATION</small>
                    <strong>{currentRequest.village ? `${currentRequest.village}, ` : ''}{currentRequest.district || selectedDistrict}</strong>
                    {currentReqDistance !== null && (
                      <div style={{ color: '#2563eb', fontWeight: '700', fontSize: '0.8rem' }}>
                        📏 ~{currentReqDistance.toFixed(1)} km from your base
                      </div>
                    )}
                  </div>
                </div>

                <div className="request-detail">
                  <span>{TYPE_ICONS[currentRequest.type] || "⚠️"}</span>
                  <div>
                    <small>TYPE</small>
                    <strong>{currentRequest.type || "Rescue Request"}</strong>
                  </div>
                </div>

                <div className="request-detail">
                  <span>🕐</span>
                  <div>
                    <small>REPORTED</small>
                    <strong>{formatTime(currentRequest.timestamp)}</strong>
                  </div>
                </div>
              </div>

              <div className="request-message">
                <strong>Contact / Details:</strong>
                <p>
                  {currentRequest.contactName
                    ? `${currentRequest.contactName}${currentRequest.contactPhone ? ` · 📞 ${currentRequest.contactPhone}` : ""}`
                    : "Anonymous distress signal received."}
                  {currentRequest.isApproximateLocation && (
                    <span style={{ display: 'block', color: '#d97706', marginTop: '4px', fontSize: '0.8rem' }}>
                      ⚠️ Location is set to approximate District coordinates.
                    </span>
                  )}
                </p>
              </div>

              <div className="request-actions">
                <button
                  className="view-location"
                  onClick={() => setLocationSOS(currentRequest)}
                >
                  📍 View Location Details
                </button>

                {currentRequest.status === "Pending" && (
                  <button className="accept-request" onClick={handleAccept} disabled={actionLoading}>
                    {actionLoading ? "Accepting..." : "Accept Dispatch Mission →"}
                  </button>
                )}

                {isMine && (
                  <button className="accept-request resolve-request" onClick={handleResolve} disabled={actionLoading}>
                    {actionLoading ? "Saving..." : "✓ Mark as Resolved"}
                  </button>
                )}
              </div>
            </div>
          )}

          {/* OTHER REQUESTS */}
          {otherRequests.length > 0 && (
            <div className="other-requests">
              {otherRequests.map((sos) => (
                <button
                  type="button"
                  className="mini-request"
                  key={sos._id}
                  onClick={() => {
                    setSelectedId(sos._id);
                    setActionError("");
                    setNotice("");
                  }}
                >
                  <div>
                    <span className="medium-dot"></span>
                    <div>
                      <strong>{sos.type || "Emergency"} · {sos.village || sos.district || "Distress Point"}</strong>
                      <small>{formatTime(sos.timestamp)}</small>
                    </div>
                  </div>

                  <span className="mini-status">
                    {assignedId(sos) === myNgoId ? "YOURS" : "NEW"}
                  </span>
                </button>
              ))}
            </div>
          )}
        </section>

        {/* RESPONSE MAP */}
        <section className="ngo-map-section">
          <div className="section-heading">
            <div>
              <h2>NGO Operations Map</h2>
              <p>Live disaster coordination radar for {selectedDistrict}, {selectedState}</p>
            </div>
          </div>

          <div className="embedded-map">
            <NgoMap
              state={selectedState}
              district={selectedDistrict}
              ngoLocation={ngoCoords}
              ngoName={user?.name || "Helping Hands Unit"}
              ngoStatus={ngoStatus}
              sosList={allRequests}
              assignedSosList={mine}
              onAcceptSos={(sosId) => {
                const sos = visible.find(s => s._id === sosId || s.id === sosId);
                if (sos) {
                  setSelectedId(sos._id || sos.id);
                  handleAccept();
                }
              }}
            />
          </div>
        </section>

        {/* FOOTER */}
        <footer className="ngo-footer">
          <div>
            <strong>SAHAYTA SETU</strong>
            <span> | Emergency Response Network</span>
          </div>
          <span>● System Operational (India-Wide Architecture)</span>
        </footer>
      </main>

      {locationSOS && (
        <LocationModal sos={locationSOS} onClose={() => setLocationSOS(null)} />
      )}
    </div>
  );
}

export default NgoDashboard;