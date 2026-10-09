import { useCallback, useState, useEffect } from "react";
import { apiFetch } from "../api";
import GramPanchayatMap from "./map/GramPanchayatMap";

// Full-page sections of the Control Centre, opened from the sidebar
// and from the "View all" / "Manage" buttons on the dashboard.

function timeAgo(timestamp) {
  if (!timestamp) return "";
  const minutes = Math.floor((Date.now() - new Date(timestamp).getTime()) / 60000);
  if (minutes < 1) return "Just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"} ago`;
  const days = Math.floor(hours / 24);
  return `${days} day${days === 1 ? "" : "s"} ago`;
}

function ViewHeader({ title, subtitle, children }) {
  return (
    <div className="cc-view-header">
      <div>
        <h2>{title}</h2>
        <p>{subtitle}</p>
      </div>
      {children && <div className="cc-view-actions">{children}</div>}
    </div>
  );
}

function EmptyState({ icon, title, text }) {
  return (
    <div className="cc-empty">
      <span>{icon}</span>
      <strong>{title}</strong>
      <p>{text}</p>
    </div>
  );
}

// ---------------------------------------------------------------
// LIVE ALERTS
// ---------------------------------------------------------------

export function AlertsView({ alerts, loading, error, onNewAlert, onRetransmitAlert }) {
  const [retransmittingId, setRetransmittingId] = useState(null);
  const [notice, setNotice] = useState("");

  const handleRetransmit = async (alertItem) => {
    if (!confirm(`Retransmit official alert "${alertItem.title || alertItem.message}" to your authorized local jurisdiction?`)) return;
    setRetransmittingId(alertItem._id);
    setNotice("");
    try {
      if (typeof onRetransmitAlert === "function") {
        await onRetransmitAlert(alertItem);
      } else {
        await apiFetch(`/api/alerts/${alertItem._id}/retransmit`, { method: "POST" });
      }
      setNotice(`✓ Alert successfully retransmitted with local authority endorsement.`);
    } catch (err) {
      alert(`Retransmission failed: ${err.message}`);
    } finally {
      setRetransmittingId(null);
    }
  };

  return (
    <section className="cc-view">
      <ViewHeader title="Live Disaster Alerts" subtitle="Official warnings published and retransmitted across India">
        <button className="cc-primary-btn" onClick={onNewAlert}>
          📢 Issue New Authority Alert
        </button>
      </ViewHeader>

      {notice && (
        <div style={{ backgroundColor: '#f0fdf4', border: '1px solid #86efac', color: '#166534', padding: '10px 14px', borderRadius: '8px', marginBottom: '12px', fontSize: '0.9rem' }}>
          {notice}
        </div>
      )}

      <div className="panel cc-list">
        {loading && <EmptyState icon="⏳" title="Loading alerts..." text="Connecting to the alert service." />}
        {!loading && error && <EmptyState icon="⚠" title="Unable to load alerts" text={error} />}
        {!loading && !error && alerts.length === 0 && (
          <EmptyState icon="✓" title="No alerts yet" text="Alerts you send will appear here." />
        )}

        {!loading && !error && alerts.map((alert) => (
          <div className="cc-row" key={alert._id}>
            <span className={`cc-level cc-level-${String(alert.riskLevel || "").toLowerCase()}`}>
              {alert.riskLevel || "Alert"}
            </span>

            <div className="cc-row-main">
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                <strong>
                  {[alert.village, alert.district].filter(Boolean).join(", ") || "Region-wide"}
                </strong>
                {alert.isRetransmission && (
                  <span style={{ fontSize: '0.72rem', backgroundColor: '#eff6ff', color: '#1d4ed8', padding: '2px 6px', borderRadius: '4px', border: '1px solid #bfdbfe' }}>
                    🔄 Retransmitted
                  </span>
                )}
                {alert.issuedBy?.name && (
                  <span style={{ fontSize: '0.72rem', backgroundColor: '#f1f5f9', color: '#475569', padding: '2px 6px', borderRadius: '4px' }}>
                    Issued by: {alert.issuedBy.name}
                  </span>
                )}
              </div>
              <p>{alert.message}</p>
              {alert.instruction && (
                <small style={{ color: '#0369a1', display: 'block', marginTop: '2px' }}>
                  📌 Instruction: {alert.instruction}
                </small>
              )}
            </div>

            <div className="cc-row-meta" style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '6px' }}>
              <span>{timeAgo(alert.createdAt || alert.timestamp)}</span>
              <button
                className="cc-secondary-btn"
                style={{ fontSize: '0.75rem', padding: '4px 8px', cursor: 'pointer' }}
                onClick={() => handleRetransmit(alert)}
                disabled={retransmittingId === alert._id}
              >
                {retransmittingId === alert._id ? 'Retransmitting...' : '📢 Retransmit'}
              </button>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

// ---------------------------------------------------------------
// TRIAGE & DISPATCH MODAL
// ---------------------------------------------------------------

function TriageModal({ sos, onClose, onAssigned }) {
  const sosId = sos?._id || sos?.id || sos?.clientIncidentId;
  const [priority, setPriority] = useState(sos?.priority || 'HIGH');
  const [capabilities, setCapabilities] = useState(
    Array.isArray(sos?.requiredCapabilities) && sos.requiredCapabilities.length > 0
      ? sos.requiredCapabilities
      : ['Medical', 'Rescue']
  );
  const [peopleAffected, setPeopleAffected] = useState(sos?.peopleAffected || 1);
  const [notes, setNotes] = useState(sos?.triageNotes || '');
  const [responders, setResponders] = useState([]);
  const [loadingResponders, setLoadingResponders] = useState(true);
  const [selectedResponderId, setSelectedResponderId] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  const CAP_OPTIONS = [
    'Medical',
    'First Aid',
    'Flood Rescue',
    'Boat Rescue',
    'Search & Rescue',
    'Fire Response',
    'Evacuation',
    'Relief Distribution',
    'Shelter Support',
    'Transport'
  ];

  const sosLat = sos?.location?.lat ?? sos?.latitude;
  const sosLng = sos?.location?.lng ?? sos?.longitude;
  const hasSosCoords = Number.isFinite(sosLat) && Number.isFinite(sosLng);

  useEffect(() => {
    let active = true;
    const requestTimer = setTimeout(() => {
      if (!sosId) {
        setLoadingResponders(false);
        return;
      }
      setLoadingResponders(true);
      setError('');

      apiFetch(`/api/sos/${encodeURIComponent(sosId)}/matched-responders`)
        .then((data) => {
          if (!active) return;
          const list = Array.isArray(data) ? data : [];
          setResponders(list);
          if (list.length > 0) {
            setSelectedResponderId(String(list[0].responder._id));
          }
        })
        .catch((e) => {
          if (!active) return;
          console.warn('Could not load matched responders:', e.message);
          setError(e.message || 'Unable to query registered responders');
        })
        .finally(() => {
          if (active) setLoadingResponders(false);
        });
    }, 0);

    return () => {
      active = false;
      clearTimeout(requestTimer);
    };
  }, [sosId]);

  const toggleCap = (c) => {
    setCapabilities((prev) =>
      prev.includes(c) ? prev.filter((x) => x !== c) : [...prev, c]
    );
  };

  const handleDispatch = async () => {
    if (!selectedResponderId) {
      setError('Please select a verified response team from the recommendations list.');
      return;
    }
    setSubmitting(true);
    setError('');
    try {
      // 1. Triage update
      await apiFetch(`/api/sos/${encodeURIComponent(sosId)}/triage`, {
        method: 'POST',
        body: JSON.stringify({
          priority,
          requiredCapabilities: capabilities,
          peopleAffected: Number(peopleAffected) || 1,
          triageNotes: notes
        })
      });

      // 2. Dispatch / Assign with atomic conflict protection
      const assignRes = await apiFetch(`/api/sos/${encodeURIComponent(sosId)}/assign`, {
        method: 'PATCH',
        body: JSON.stringify({ responderId: selectedResponderId })
      });

      if (typeof onAssigned === 'function') onAssigned(assignRes);
      onClose();
    } catch (err) {
      console.error('Dispatch error:', err);
      if (err.status === 409) {
        setError('⚠️ ASSIGNMENT CONFLICT: Another responder unit or authority already locked this mission.');
      } else {
        setError(err.message || 'Dispatch failed. Please check network connection.');
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      className="modal-backdrop"
      onClick={onClose}
      style={{
        position: 'fixed',
        inset: 0,
        backgroundColor: 'rgba(15, 23, 42, 0.7)',
        backdropFilter: 'blur(4px)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 1000,
        padding: '16px'
      }}
    >
      <div
        className="modal-card"
        onClick={(e) => e.stopPropagation()}
        style={{
          backgroundColor: '#ffffff',
          borderRadius: '16px',
          width: '100%',
          maxWidth: '720px',
          maxHeight: '92vh',
          overflowY: 'auto',
          padding: '24px',
          boxShadow: '0 25px 50px -12px rgba(0,0,0,0.3)',
          border: '1px solid #e2e8f0',
          display: 'flex',
          flexDirection: 'column',
          gap: '18px'
        }}
      >
        {/* Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', borderBottom: '1px solid #f1f5f9', paddingBottom: '14px' }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <span style={{ fontSize: '1.4rem' }}>⚖️</span>
              <h3 style={{ margin: 0, fontSize: '1.3rem', fontWeight: 800, color: '#0f172a' }}>
                SOS Emergency Triage & Responder Dispatch
              </h3>
            </div>
            <p style={{ margin: '4px 0 0', color: '#64748b', fontSize: '0.85rem' }}>
              Incident ID: <strong style={{ color: '#0f172a' }}>{sos?.clientIncidentId || sosId}</strong> · Reported {timeAgo(sos?.timestamp)}
            </p>
          </div>
          <button
            onClick={onClose}
            style={{
              background: '#f1f5f9',
              border: 'none',
              borderRadius: '50%',
              width: '32px',
              height: '32px',
              fontSize: '1rem',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: '#64748b'
            }}
          >
            ✕
          </button>
        </div>

        {error && (
          <div style={{ backgroundColor: '#fef2f2', border: '1px solid #fecaca', color: '#991b1b', padding: '12px 14px', borderRadius: '8px', fontSize: '0.88rem', fontWeight: 600 }}>
            {error}
          </div>
        )}

        {/* 1. Real SOS Location Information */}
        <div style={{ backgroundColor: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '10px', padding: '14px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
            <span style={{ fontSize: '0.8rem', fontWeight: 700, color: '#475569', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
              📍 Real SOS Location & Jurisdiction
            </span>
            {hasSosCoords && (
              <a
                href={`https://www.google.com/maps?q=${sosLat},${sosLng}`}
                target="_blank"
                rel="noreferrer"
                style={{
                  fontSize: '0.78rem',
                  color: '#2563eb',
                  textDecoration: 'none',
                  fontWeight: 600,
                  display: 'flex',
                  alignItems: 'center',
                  gap: '4px'
                }}
              >
                🗺️ Open Satellite Map ↗
              </a>
            )}
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '10px', fontSize: '0.86rem' }}>
            <div>
              <span style={{ color: '#64748b' }}>Area / Village: </span>
              <strong>{sos?.village || 'Local Community'}</strong>, <strong>{sos?.district}</strong>, {sos?.state || 'Uttarakhand'}
            </div>
            <div>
              <span style={{ color: '#64748b' }}>Coordinates: </span>
              {hasSosCoords ? (
                <code style={{ backgroundColor: '#e2e8f0', padding: '2px 6px', borderRadius: '4px', fontSize: '0.8rem' }}>
                  {Number(sosLat).toFixed(5)}, {Number(sosLng).toFixed(5)}
                </code>
              ) : (
                <span style={{ color: '#c2410c' }}>District Fallback</span>
              )}
            </div>
            <div>
              <span style={{ color: '#64748b' }}>Accuracy & Source: </span>
              <span style={{
                fontSize: '0.75rem',
                fontWeight: 700,
                backgroundColor: sos?.locationSource === 'GPS_EXACT' ? '#dcfce7' : '#fef3c7',
                color: sos?.locationSource === 'GPS_EXACT' ? '#166534' : '#92400e',
                padding: '2px 6px',
                borderRadius: '4px'
              }}>
                {sos?.locationSource === 'GPS_EXACT' ? `GPS Exact (±${sos?.locationAccuracy || 18}m)` : (sos?.locationSource || 'Local Node')}
              </span>
            </div>
          </div>
        </div>

        {/* 2. Priority Selection */}
        <div>
          <label style={{ display: 'block', fontSize: '0.85rem', fontWeight: 700, color: '#334155', marginBottom: '6px' }}>
            Emergency Priority Level
          </label>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '8px' }}>
            {[
              { id: 'LOW', label: 'Low', color: '#16a34a', bg: '#f0fdf4' },
              { id: 'MODERATE', label: 'Moderate', color: '#ca8a04', bg: '#fefce8' },
              { id: 'HIGH', label: 'High', color: '#ea580c', bg: '#fff7ed' },
              { id: 'CRITICAL', label: 'Critical', color: '#dc2626', bg: '#fef2f2' }
            ].map((p) => {
              const active = priority === p.id;
              return (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => setPriority(p.id)}
                  style={{
                    padding: '8px 10px',
                    borderRadius: '8px',
                    border: `2px solid ${active ? p.color : '#e2e8f0'}`,
                    backgroundColor: active ? p.bg : '#ffffff',
                    color: active ? p.color : '#64748b',
                    fontWeight: active ? 800 : 600,
                    fontSize: '0.82rem',
                    cursor: 'pointer',
                    transition: 'all 0.15s ease'
                  }}
                >
                  {p.label}
                </button>
              );
            })}
          </div>
        </div>

        {/* 3. Required Capabilities */}
        <div>
          <label style={{ display: 'block', fontSize: '0.85rem', fontWeight: 700, color: '#334155', marginBottom: '6px' }}>
            Required Capabilities (Specialist Matching)
          </label>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
            {CAP_OPTIONS.map((c) => {
              const selected = capabilities.includes(c);
              return (
                <button
                  key={c}
                  type="button"
                  onClick={() => toggleCap(c)}
                  style={{
                    padding: '6px 12px',
                    borderRadius: '20px',
                    border: `1px solid ${selected ? '#2563eb' : '#cbd5e1'}`,
                    backgroundColor: selected ? '#eff6ff' : '#ffffff',
                    color: selected ? '#1d4ed8' : '#64748b',
                    fontSize: '0.8rem',
                    fontWeight: 600,
                    cursor: 'pointer'
                  }}
                >
                  {selected ? '✓ ' : '+ '}
                  {c}
                </button>
              );
            })}
          </div>
        </div>

        {/* 4. People Affected & Operational Notes */}
        <div style={{ display: 'flex', gap: '12px' }}>
          <div style={{ width: '130px' }}>
            <label style={{ display: 'block', fontSize: '0.82rem', fontWeight: 700, color: '#334155', marginBottom: '4px' }}>
              People Affected
            </label>
            <input
              type="number"
              min="1"
              value={peopleAffected}
              onChange={(e) => setPeopleAffected(e.target.value)}
              style={{ width: '100%', padding: '8px 10px', borderRadius: '6px', border: '1px solid #cbd5e1', fontSize: '0.9rem' }}
            />
          </div>
          <div style={{ flex: 1 }}>
            <label style={{ display: 'block', fontSize: '0.82rem', fontWeight: 700, color: '#334155', marginBottom: '4px' }}>
              Operational Notes for Responders
            </label>
            <input
              type="text"
              placeholder="e.g. Floodwater 3ft; need boat & stretcher; access via bridge"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              style={{ width: '100%', padding: '8px 10px', borderRadius: '6px', border: '1px solid #cbd5e1', fontSize: '0.9rem' }}
            />
          </div>
        </div>

        {/* 5. Recommended Verified Responders */}
        <div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
            <label style={{ fontSize: '0.88rem', fontWeight: 700, color: '#0f172a' }}>
              🎯 Recommended Verified Responders (Ranked by Real Proximity & Capability)
            </label>
            <span style={{ fontSize: '0.75rem', color: '#64748b' }}>
              {responders.length} verified unit{responders.length === 1 ? '' : 's'} found
            </span>
          </div>

          {loadingResponders && (
            <div style={{ padding: '24px', textAlign: 'center', color: '#64748b', fontSize: '0.9rem', backgroundColor: '#f8fafc', borderRadius: '8px' }}>
              ⏳ Calculating distances from real SOS coordinates and matching capabilities...
            </div>
          )}

          {!loadingResponders && responders.length === 0 && (
            <div style={{ padding: '20px', backgroundColor: '#fff7ed', border: '1px solid #ffedd5', borderRadius: '8px', color: '#9a3412', textAlign: 'center' }}>
              <div style={{ fontSize: '1.2rem', marginBottom: '4px' }}>⚠️</div>
              <strong style={{ display: 'block', fontSize: '0.92rem' }}>
                No verified responder currently available in this operational area.
              </strong>
              <p style={{ margin: '4px 0 0', fontSize: '0.82rem', color: '#c2410c' }}>
                No registered NGO with verified credentials and active status is currently available in {sos?.district || 'this jurisdiction'}.
              </p>
            </div>
          )}

          {!loadingResponders && responders.length > 0 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', maxHeight: '250px', overflowY: 'auto', paddingRight: '4px' }}>
              {responders.map(({ responder, distanceKm, capabilityFit, activeAssignments, estimatedArrivalMin }) => {
                const isSelected = selectedResponderId === responder._id;
                return (
                  <div
                    key={responder._id}
                    onClick={() => setSelectedResponderId(responder._id)}
                    style={{
                      padding: '12px 14px',
                      borderRadius: '10px',
                      border: `2px solid ${isSelected ? '#2563eb' : '#e2e8f0'}`,
                      backgroundColor: isSelected ? '#eff6ff' : '#ffffff',
                      cursor: 'pointer',
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      gap: '12px',
                      transition: 'all 0.15s ease'
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flex: 1 }}>
                      <input
                        type="radio"
                        name="selectedResponder"
                        checked={isSelected}
                        onChange={() => setSelectedResponderId(responder._id)}
                        style={{ cursor: 'pointer', accentColor: '#2563eb', width: '18px', height: '18px' }}
                      />
                      <div style={{ flex: 1 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
                          <strong style={{ fontSize: '0.95rem', color: '#0f172a' }}>{responder.name}</strong>
                          <span style={{ fontSize: '0.68rem', backgroundColor: '#dcfce7', color: '#15803d', padding: '1px 6px', borderRadius: '4px', fontWeight: 700 }}>
                            ✓ VERIFIED
                          </span>
                          <span style={{ fontSize: '0.7rem', color: activeAssignments > 0 ? '#b45309' : '#15803d', backgroundColor: activeAssignments > 0 ? '#fef3c7' : '#f0fdf4', padding: '1px 6px', borderRadius: '4px' }}>
                            {activeAssignments > 0 ? `Busy (${activeAssignments} active)` : 'Available'}
                          </span>
                        </div>
                        <div style={{ fontSize: '0.8rem', color: '#64748b', marginTop: '2px' }}>
                          <span>{responder.district || sos?.district}, {responder.state || sos?.state}</span>
                          {responder.phone && <span> · 📞 {responder.phone}</span>}
                          {responder.contactPerson && <span> · Rep: {responder.contactPerson}</span>}
                        </div>
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px', marginTop: '4px' }}>
                          {(responder.services || responder.capabilities || []).map((s) => (
                            <span
                              key={s}
                              style={{
                                fontSize: '0.7rem',
                                padding: '1px 6px',
                                borderRadius: '4px',
                                backgroundColor: capabilities.some(c => String(s).toLowerCase().includes(c.toLowerCase())) ? '#dbeafe' : '#f1f5f9',
                                color: capabilities.some(c => String(s).toLowerCase().includes(c.toLowerCase())) ? '#1e40af' : '#475569',
                                fontWeight: 600
                              }}
                            >
                              {s}
                            </span>
                          ))}
                        </div>
                      </div>
                    </div>

                    <div style={{ textAlign: 'right', minWidth: '100px' }}>
                      <strong style={{ fontSize: '1.05rem', color: '#16a34a', display: 'block' }}>
                        {distanceKm > 0 ? `${distanceKm.toFixed(1)} km` : 'Local Unit'}
                      </strong>
                      <small style={{ color: capabilityFit ? '#15803d' : '#64748b', fontSize: '0.72rem', fontWeight: 600, display: 'block' }}>
                        {capabilityFit ? '✓ Capability Match' : 'General Support'}
                      </small>
                      {estimatedArrivalMin && (
                        <small style={{ color: '#475569', fontSize: '0.7rem', display: 'block' }}>
                          ETA: ~{estimatedArrivalMin} min
                        </small>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Footer Actions */}
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px', paddingTop: '10px', borderTop: '1px solid #f1f5f9' }}>
          <button
            type="button"
            onClick={onClose}
            style={{
              padding: '10px 18px',
              borderRadius: '8px',
              border: '1px solid #cbd5e1',
              backgroundColor: '#ffffff',
              color: '#475569',
              fontWeight: 600,
              fontSize: '0.9rem',
              cursor: 'pointer'
            }}
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleDispatch}
            disabled={submitting || responders.length === 0 || !selectedResponderId}
            style={{
              padding: '10px 22px',
              borderRadius: '8px',
              border: 'none',
              backgroundColor: responders.length === 0 || !selectedResponderId ? '#94a3b8' : '#dc2626',
              color: '#ffffff',
              fontWeight: 800,
              fontSize: '0.92rem',
              cursor: responders.length === 0 || !selectedResponderId ? 'not-allowed' : 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              boxShadow: responders.length > 0 && selectedResponderId ? '0 4px 12px rgba(220, 38, 38, 0.35)' : 'none',
              transition: 'all 0.15s ease'
            }}
          >
            {submitting ? '⚡ Dispatching...' : '⚡ Confirm & Dispatch Responder'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------
// SOS REQUESTS
// ---------------------------------------------------------------

const SOS_FILTERS = [
  { id: "active", label: "Active" },
  { id: "Pending", label: "Pending" },
  { id: "In Progress", label: "In Progress" },
  { id: "Resolved", label: "Resolved" },
  { id: "all", label: "All" },
];

export function SOSView({ requests, loading, error, filter, onFilterChange, onAssignResponder }) {
  const [triageSos, setTriageSos] = useState(null);

  const shown = requests.filter((sos) => {
    if (filter === "all") return true;
    if (filter === "active") return sos.status !== "Resolved";
    return sos.status === filter;
  });

  const countFor = (id) =>
    requests.filter((sos) =>
      id === "all" ? true : id === "active" ? sos.status !== "Resolved" : sos.status === id
    ).length;

  return (
    <section className="cc-view">
      <ViewHeader title="SOS Requests & Local Dispatch" subtitle="Help requests from villagers with priority triage and responder locking" />

      {triageSos && (
        <TriageModal
          sos={triageSos}
          onClose={() => setTriageSos(null)}
          onAssigned={(updated) => {
            if (typeof onAssignResponder === 'function') onAssignResponder(updated);
          }}
        />
      )}

      <div className="cc-tabs">
        {SOS_FILTERS.map((tab) => (
          <button
            key={tab.id}
            className={`cc-tab ${filter === tab.id ? "active" : ""}`}
            onClick={() => onFilterChange(tab.id)}
          >
            {tab.label} <b>{countFor(tab.id)}</b>
          </button>
        ))}
      </div>

      <div className="panel cc-list">
        {loading && <EmptyState icon="⏳" title="Loading SOS requests..." text="Connecting to the server." />}
        {!loading && error && <EmptyState icon="⚠" title="Unable to load SOS requests" text={error} />}
        {!loading && !error && shown.length === 0 && (
          <EmptyState icon="✓" title="No requests here" text="Nothing matches this filter right now." />
        )}

        {!loading && !error && shown.map((sos) => (
          <div className="cc-row" key={sos._id || sos.id || sos.clientIncidentId}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
              <span className={`cc-status cc-status-${String(sos.status).replace(/\s+/g, "-").toLowerCase()}`}>
                {sos.status}
              </span>
              <span style={{
                fontSize: '0.7rem',
                fontWeight: '700',
                color: sos.priority === 'CRITICAL' ? '#b91c1c' : '#c2410c',
                backgroundColor: sos.priority === 'CRITICAL' ? '#fef2f2' : '#fff7ed',
                padding: '2px 6px',
                borderRadius: '4px',
                textAlign: 'center'
              }}>
                {sos.priority || 'HIGH'}
              </span>
            </div>

            <div className="cc-row-main">
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                <strong>
                  {sos.type || "Emergency"} · {sos.village || "Unknown village"} ({sos.district || "Region"})
                </strong>
                <span style={{ fontSize: '0.75rem', color: '#16a34a', backgroundColor: '#f0fdf4', padding: '1px 6px', borderRadius: '4px' }}>
                  🔒 WebCrypto Signed
                </span>
                {sos.locationSource && (
                  <span style={{ fontSize: '0.72rem', color: '#475569', backgroundColor: '#f1f5f9', padding: '1px 6px', borderRadius: '4px' }}>
                    {sos.locationSource === 'GPS_EXACT' ? `📍 GPS (±${sos.locationAccuracy || 18}m)` : `⚠️ ${sos.locationSource}`}
                  </span>
                )}
              </div>
              <p>
                {sos.contactName
                  ? `${sos.contactName}${sos.contactPhone ? ` · ${sos.contactPhone}` : ""}`
                  : "Contact not shared"}
                {sos.assignedTo ? ` · Handled by ${sos.assignedTo.name || 'Response Unit'}` : " · Unassigned (Awaiting nearest responder)"}
                {sos.responderDistanceKm ? ` · Responder ±${sos.responderDistanceKm.toFixed(1)} km away` : ''}
              </p>
              <small style={{ color: '#94a3b8', fontSize: '0.72rem' }}>
                Incident ID: {sos.clientIncidentId || sos._id} {sos.hopCount > 0 ? `· Relayed (Hop ${sos.hopCount})` : ''}
              </small>
            </div>

            <div className="cc-row-meta" style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '6px' }}>
              <span>{timeAgo(sos.timestamp)}</span>
              {sos.status !== 'Resolved' && (
                <button
                  className="cc-primary-btn"
                  style={{ fontSize: '0.75rem', padding: '4px 10px', cursor: 'pointer' }}
                  onClick={() => setTriageSos(sos)}
                >
                  ⚖️ Triage & Assign
                </button>
              )}
              {sos.location?.lat && sos.location?.lng && (
                <a
                  href={`https://www.google.com/maps?q=${sos.location.lat},${sos.location.lng}`}
                  target="_blank"
                  rel="noreferrer"
                  style={{ fontSize: '0.75rem' }}
                >
                  📍 Open map
                </a>
              )}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

// ---------------------------------------------------------------
// RISK MAP
// ---------------------------------------------------------------

export function MapView() {
  return (
    <section className="cc-view">
      <ViewHeader
        title="Risk Map"
        subtitle="Risk zones, shelters, NGO units and SOS across the region. Click the map to add a test SOS."
      />
      <div className="embedded-map cc-map-large">
        <GramPanchayatMap />
      </div>
    </section>
  );
}

// ---------------------------------------------------------------
// SHELTERS (Control Centre can add, update occupancy, remove)
// ---------------------------------------------------------------

const EMPTY_SHELTER = { name: "", lat: "", lng: "", capacity: "", currentOccupancy: "" };

function AddShelterForm({ onAdded, onCancel }) {
  const [form, setForm] = useState(EMPTY_SHELTER);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const update = (field) => (event) => setForm({ ...form, [field]: event.target.value });

  const useMyLocation = () => {
    if (!navigator.geolocation) return;
    navigator.geolocation.getCurrentPosition((pos) =>
      setForm((current) => ({
        ...current,
        lat: pos.coords.latitude.toFixed(5),
        lng: pos.coords.longitude.toFixed(5),
      }))
    );
  };

  const save = async () => {
    setSaving(true);
    setError("");
    try {
      await apiFetch("/api/shelters", {
        method: "POST",
        body: JSON.stringify({
          name: form.name,
          lat: Number(form.lat),
          lng: Number(form.lng),
          capacity: Number(form.capacity),
          currentOccupancy: Number(form.currentOccupancy) || 0,
        }),
      });
      setForm(EMPTY_SHELTER);
      onAdded();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="panel cc-form">
      <h3>New shelter</h3>

      <div className="cc-form-grid">
        <label className="cc-field cc-field-wide">
          <span>Name</span>
          <input value={form.name} onChange={update("name")} placeholder="e.g. Ujire Community Hall" />
        </label>

        <label className="cc-field">
          <span>Latitude</span>
          <input value={form.lat} onChange={update("lat")} placeholder="12.99850" inputMode="decimal" />
        </label>

        <label className="cc-field">
          <span>Longitude</span>
          <input value={form.lng} onChange={update("lng")} placeholder="75.32650" inputMode="decimal" />
        </label>

        <label className="cc-field">
          <span>Capacity (people)</span>
          <input value={form.capacity} onChange={update("capacity")} placeholder="300" inputMode="numeric" />
        </label>

        <label className="cc-field">
          <span>People there now</span>
          <input value={form.currentOccupancy} onChange={update("currentOccupancy")} placeholder="0" inputMode="numeric" />
        </label>
      </div>

      <p className="cc-form-hint">
        Tip: in Google Maps, right-click the building and click the numbers at the top to copy its latitude and longitude.
      </p>

      {error && <p className="cc-form-error">{error}</p>}

      <div className="cc-form-actions">
        <button type="button" className="cc-secondary-btn" onClick={useMyLocation}>
          📍 Use my location
        </button>
        <span className="cc-spacer"></span>
        <button type="button" className="cc-secondary-btn" onClick={onCancel} disabled={saving}>
          Cancel
        </button>
        <button type="button" className="cc-primary-btn" onClick={save} disabled={saving}>
          {saving ? "Saving..." : "Save shelter"}
        </button>
      </div>
    </div>
  );
}

function ShelterRow({ shelter, onChanged }) {
  const [draft, setDraft] = useState(null);   // typed occupancy, while editing
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const capacity = shelter.capacity || 0;
  const used = shelter.currentOccupancy || 0;
  const percent = capacity ? Math.min(100, Math.round((used / capacity) * 100)) : 0;
  const full = shelter.status === "Full" || (capacity > 0 && used >= capacity);

  const setOccupancy = async (value) => {
    const occupancy = Math.max(0, Math.min(capacity, Math.round(Number(value))));
    if (!Number.isFinite(occupancy)) return;
    setSaving(true);
    setError("");
    try {
      await apiFetch(`/api/shelters/${shelter._id}`, {
        method: "PATCH",
        body: JSON.stringify({ currentOccupancy: occupancy }),
      });
      setDraft(null);
      onChanged();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    if (!window.confirm(`Remove "${shelter.name}"?`)) return;
    try {
      await apiFetch(`/api/shelters/${shelter._id}`, { method: "DELETE" });
      onChanged();
    } catch (err) {
      setError(err.message);
    }
  };

  return (
    <div className="cc-row">
      <span className={`cc-status ${full ? "cc-status-full" : "cc-status-available"}`}>
        {full ? "Full" : "Available"}
      </span>

      <div className="cc-row-main">
        <strong>{shelter.name}</strong>
        <div className="cc-capacity">
          <div className="cc-capacity-bar">
            <div
              className={`cc-capacity-fill ${percent >= 85 ? "high" : percent >= 60 ? "medium" : ""}`}
              style={{ width: `${percent}%` }}
            ></div>
          </div>
          <small>{used} / {capacity} people · {capacity - used} places left</small>
        </div>
        {error && <p className="cc-form-error">{error}</p>}
      </div>

      <div className="cc-occupancy" title="People in the shelter now">
        <button type="button" onClick={() => setOccupancy(used - 1)} disabled={saving || used <= 0}>−</button>
        <input
          value={draft ?? used}
          inputMode="numeric"
          onChange={(e) => setDraft(e.target.value.replace(/\D/g, ""))}
          onBlur={() => draft !== null && setOccupancy(draft)}
          onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
          disabled={saving}
        />
        <button type="button" onClick={() => setOccupancy(used + 1)} disabled={saving || used >= capacity}>+</button>
      </div>

      <div className="cc-row-meta">
        {shelter.lat && shelter.lng && (
          <a href={`https://www.google.com/maps?q=${shelter.lat},${shelter.lng}`} target="_blank" rel="noreferrer">
            📍 Location
          </a>
        )}
        <button type="button" className="cc-link-danger" onClick={remove}>Remove</button>
      </div>
    </div>
  );
}

export function SheltersView({ shelters, loading, error, onChanged }) {
  const [adding, setAdding] = useState(false);

  const totalCapacity = shelters.reduce((sum, s) => sum + (s.capacity || 0), 0);
  const totalOccupied = shelters.reduce((sum, s) => sum + (s.currentOccupancy || 0), 0);

  return (
    <section className="cc-view">
      <ViewHeader
        title="Shelters"
        subtitle={
          shelters.length
            ? `${shelters.length} shelters · ${totalOccupied} of ${totalCapacity} places in use · use − / + as people arrive or leave`
            : "Evacuation centres and their current occupancy"
        }
      >
        {!adding && (
          <button className="cc-primary-btn" onClick={() => setAdding(true)}>
            + Add shelter
          </button>
        )}
      </ViewHeader>

      {adding && (
        <AddShelterForm
          onAdded={() => {
            setAdding(false);
            onChanged();
          }}
          onCancel={() => setAdding(false)}
        />
      )}

      <div className="panel cc-list">
        {loading && <EmptyState icon="⏳" title="Loading shelters..." text="Connecting to the server." />}
        {!loading && error && <EmptyState icon="⚠" title="Unable to load shelters" text={error} />}
        {!loading && !error && shelters.length === 0 && (
          <EmptyState
            icon="⌂"
            title="No shelters registered yet"
            text="Click “+ Add shelter” to register an authorized evacuation facility."
          />
        )}

        {!loading && !error && shelters.map((shelter) => (
          <ShelterRow key={shelter._id} shelter={shelter} onChanged={onChanged} />
        ))}
      </div>
    </section>
  );
}

// ---------------------------------------------------------------
// RESPONDERS
// ---------------------------------------------------------------

export function RespondersView({ ngos, loading, error, sosRequests }) {
  // How many open SOS each NGO is handling right now
  const activeCount = (ngoId) =>
    sosRequests.filter(
      (sos) => sos.status === "In Progress" && (sos.assignedTo?._id || sos.assignedTo) === ngoId
    ).length;

  return (
    <section className="cc-view">
      <ViewHeader title="Responders" subtitle="Registered NGOs and what they are handling now" />

      <div className="panel cc-list">
        {loading && <EmptyState icon="⏳" title="Loading responders..." text="Connecting to the server." />}
        {!loading && error && <EmptyState icon="⚠" title="Unable to load responders" text={error} />}
        {!loading && !error && ngos.length === 0 && (
          <EmptyState
            icon="🚑"
            title="No NGOs registered yet"
            text="NGOs appear here after they log in once with their phone number."
          />
        )}

        {!loading && !error && ngos.map((ngo) => {
          const busy = activeCount(ngo._id);
          return (
            <div className="cc-row" key={ngo._id}>
              <span className={`cc-status ${busy ? "cc-status-in-progress" : ngo.available === false ? "cc-status-full" : "cc-status-available"}`}>
                {busy ? `${busy} active` : ngo.available === false ? "Unavailable" : "Available"}
              </span>

              <div className="cc-row-main">
                <strong>{ngo.name}</strong>
                <p>
                  {[ngo.contactPerson, ngo.phone, ngo.district].filter(Boolean).join(" · ")}
                  {ngo.services?.length ? ` · ${ngo.services.join(", ")}` : ""}
                </p>
              </div>

              <div className="cc-row-meta">
                {ngo.phone && <a href={`tel:${ngo.phone}`}>📞 Call</a>}
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}

// ---------------------------------------------------------------
// EVACUATION STATUS (from villagers' family reports)
// ---------------------------------------------------------------

const EVAC_GROUPS = [
  { field: "inShelter", label: "In shelter", className: "evac-shelter" },
  { field: "withRelatives", label: "With relatives", className: "evac-relatives" },
  { field: "atHome", label: "Stayed home", className: "evac-home" },
  { field: "elsewhere", label: "Place unknown", className: "evac-elsewhere" },
  { field: "unaccounted", label: "Not reported", className: "evac-unaccounted" },
];

export function EvacuationBar({ row }) {
  const total = row.totalMembers || 0;
  return (
    <div className="evac-bar" title={`${total} people`}>
      {total > 0 &&
        EVAC_GROUPS.map((group) =>
          row[group.field] > 0 ? (
            <div
              key={group.field}
              className={group.className}
              style={{ width: `${(row[group.field] / total) * 100}%` }}
            ></div>
          ) : null
        )}
    </div>
  );
}

export function EvacuationLegend() {
  return (
    <div className="evac-legend">
      {EVAC_GROUPS.map((group) => (
        <span key={group.field}>
          <i className={group.className}></i>
          {group.label}
        </span>
      ))}
    </div>
  );
}

export function EvacuationView({ data, loading, error }) {
  const totals = data?.totals;
  const villages = data?.villages || [];
  const reports = data?.reports || [];

  return (
    <section className="cc-view">
      <ViewHeader
        title="Evacuation Status"
        subtitle="Where people went after the alert, as reported by each family"
      />

      {loading && <div className="panel cc-list"><EmptyState icon="⏳" title="Loading reports..." text="Connecting to the server." /></div>}
      {!loading && error && <div className="panel cc-list"><EmptyState icon="⚠" title="Unable to load reports" text={error} /></div>}
      {!loading && !error && villages.length === 0 && (
        <div className="panel cc-list">
          <EmptyState
            icon="👪"
            title="No family reports yet"
            text="When villagers fill in “Where is your family?” on their app, the numbers appear here."
          />
        </div>
      )}

      {!loading && !error && totals && villages.length > 0 && (
        <>
          <div className="evac-totals">
            <div className="evac-total-card">
              <small>PEOPLE REPORTED</small>
              <strong>{totals.totalMembers}</strong>
              <span>{totals.families} families</span>
            </div>
            {EVAC_GROUPS.map((group) => (
              <div className={`evac-total-card ${group.className}-text`} key={group.field}>
                <small>{group.label.toUpperCase()}</small>
                <strong>{totals[group.field]}</strong>
                <span>
                  {totals.totalMembers ? Math.round((totals[group.field] / totals.totalMembers) * 100) : 0}%
                </span>
              </div>
            ))}
          </div>

          <div className="panel cc-list">
            <div className="evac-list-head">
              <h3>By village</h3>
              <EvacuationLegend />
            </div>

            {villages.map((row) => (
              <div className="cc-row evac-row" key={row.village}>
                <div className="cc-row-main">
                  <strong>{row.village}{row.district ? `, ${row.district}` : ""}</strong>
                  <EvacuationBar row={row} />
                  <p>
                    {row.totalMembers} people from {row.families} families ·{" "}
                    {row.inShelter} in shelter · {row.withRelatives} with relatives ·{" "}
                    {row.atHome} at home · {row.elsewhere} place unknown
                    {row.unaccounted > 0 ? ` · ${row.unaccounted} not reported` : ""}
                  </p>
                </div>
                <div className="cc-row-meta">
                  <span>{timeAgo(row.lastUpdated)}</span>
                  {row.atHome + row.elsewhere + row.unaccounted > 0 && (
                    <small className="evac-followup">
                      ⚠ {row.atHome + row.elsewhere + row.unaccounted} need follow-up
                    </small>
                  )}
                </div>
              </div>
            ))}
          </div>

          <div className="panel cc-list">
            <div className="evac-list-head">
              <h3>Family reports</h3>
            </div>
            {reports.map((report) => {
              const unaccounted =
                report.totalMembers -
                (report.inShelter + report.withRelatives + report.atHome + report.elsewhere);
              return (
                <div className="cc-row" key={report._id}>
                  <div className="cc-row-main">
                    <strong>
                      {report.reporterName || "Villager"} · {report.village || "Unknown village"}
                    </strong>
                    <p>
                      {report.totalMembers} members · {report.inShelter} in shelter
                      {report.shelterName ? ` (${report.shelterName})` : ""} · {report.withRelatives} with relatives ·{" "}
                      {report.atHome} at home · {report.elsewhere} place unknown
                      {unaccounted > 0 ? ` · ${unaccounted} not reported` : ""}
                    </p>
                  </div>
                  <div className="cc-row-meta">
                    <span>{timeAgo(report.updatedAt)}</span>
                    {report.reporterPhone && <a href={`tel:${report.reporterPhone}`}>📞 Call</a>}
                  </div>
                </div>
              );
            })}
          </div>
        </>
      )}
    </section>
  );
}

// ---------------------------------------------------------------
// VERIFICATION CENTER VIEW (Admin & Authority Onboarding)
// ---------------------------------------------------------------

export function VerificationCenterView() {
  const [entities, setEntities] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [filter, setFilter] = useState("PENDING");
  const [actionLoading, setActionLoading] = useState(null);
  const [msg, setMsg] = useState("");

  // Modal states for action details
  const [activeEntity, setActiveEntity] = useState(null);
  const [actionType, setActionType] = useState(null); // 'approve' | 'reject' | 'suspend' | 'revoke' | 'reinstate'
  const [modalReason, setModalReason] = useState("");
  const [editState, setEditState] = useState("");
  const [editDistrict, setEditDistrict] = useState("");
  const [editAuthorityLevel, setEditAuthorityLevel] = useState("GRAM_PANCHAYAT");

  const loadEntities = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const data = await apiFetch("/api/admin/entities");
      setEntities(Array.isArray(data) ? data : []);
    } catch (err) {
      // Fallback to legacy endpoint if role was control
      try {
        const legacy = await apiFetch("/api/admin/verifications");
        setEntities(Array.isArray(legacy) ? legacy : []);
      } catch {
        setError(err.message || "Failed to load verified entities");
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const initialLoad = setTimeout(loadEntities, 0);

    // Listen for live entity registration or updates
    const socket = typeof window !== 'undefined' ? window.__sahayta_socket : null;
    if (socket) {
      const handleLiveEntity = () => {
        loadEntities();
      };
      socket.on('admin:entity-registered', handleLiveEntity);
      socket.on('admin:pending-count', handleLiveEntity);
      return () => {
        clearTimeout(initialLoad);
        socket.off('admin:entity-registered', handleLiveEntity);
        socket.off('admin:pending-count', handleLiveEntity);
      };
    }
    return () => clearTimeout(initialLoad);
  }, [loadEntities]);

  const openActionModal = (entity, type) => {
    setActiveEntity(entity);
    setActionType(type);
    setModalReason("");
    setEditState(entity.state || "Uttarakhand");
    setEditDistrict(entity.district || "Dehradun");
    setEditAuthorityLevel(entity.authorityLevel || (entity.organizationType === 'NGO' ? 'DISTRICT' : 'GRAM_PANCHAYAT'));
  };

  const closeModal = () => {
    setActiveEntity(null);
    setActionType(null);
    setModalReason("");
  };

  const handleModalSubmit = async () => {
    if (!activeEntity || !actionType) return;
    if (['reject', 'suspend', 'revoke'].includes(actionType) && !modalReason.trim()) {
      alert("A reason is strictly required for this administrative action.");
      return;
    }

    setActionLoading(activeEntity._id);
    setMsg("");
    try {
      const body = { reason: modalReason.trim() };
      if (actionType === 'approve') {
        body.stateCode = editState;
        body.districtCode = editDistrict;
        body.authorityLevel = editAuthorityLevel;
      }

      await apiFetch(`/api/admin/entities/${activeEntity._id}/${actionType}`, {
        method: "POST",
        body: JSON.stringify(body),
      });

      setMsg(`✓ Entity successfully updated: ${actionType.toUpperCase()}`);
      closeModal();
      await loadEntities();
    } catch (err) {
      alert(`Action failed: ${err.message}`);
    } finally {
      setActionLoading(null);
    }
  };

  const filtered = entities.filter((e) => {
    if (filter === "ALL") return true;
    return e.verificationStatus === filter;
  });

  return (
    <section className="cc-view">
      <ViewHeader
        title="Verification Center"
        subtitle="Review, authenticate and manage Panchayats, District Authorities, NGOs and Rescue Units"
      >
        <button className="cc-secondary-btn" onClick={loadEntities}>
          🔄 Refresh
        </button>
      </ViewHeader>

      {msg && (
        <div style={{ backgroundColor: '#f0fdf4', border: '1px solid #86efac', color: '#166534', padding: '10px 14px', borderRadius: '8px', marginBottom: '12px', fontSize: '0.9rem' }}>
          {msg}
        </div>
      )}

      <div className="cc-tabs">
        {["PENDING", "VERIFIED", "REJECTED", "SUSPENDED", "ALL"].map((tab) => (
          <button
            key={tab}
            className={`cc-tab ${filter === tab ? "active" : ""}`}
            onClick={() => setFilter(tab)}
          >
            {tab} <b>{entities.filter((e) => tab === "ALL" ? true : e.verificationStatus === tab).length}</b>
          </button>
        ))}
      </div>

      <div className="panel cc-list">
        {loading && <EmptyState icon="⏳" title="Loading entities..." text="Connecting to verification registry." />}
        {!loading && error && <EmptyState icon="⚠" title="Unable to load entities" text={error} />}
        {!loading && !error && filtered.length === 0 && (
          <EmptyState icon="✓" title="No entities match this filter" text="Registered authorities and responders will appear here." />
        )}

        {!loading && !error && filtered.map((e) => (
          <div className="cc-row" key={e._id}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', minWidth: '95px' }}>
              <span style={{
                fontSize: '0.72rem',
                fontWeight: 700,
                padding: '3px 8px',
                borderRadius: '4px',
                textAlign: 'center',
                backgroundColor: e.verificationStatus === 'VERIFIED' ? '#f0fdf4' : e.verificationStatus === 'PENDING' ? '#fffbeb' : '#fef2f2',
                color: e.verificationStatus === 'VERIFIED' ? '#166534' : e.verificationStatus === 'PENDING' ? '#b45309' : '#991b1b',
                border: `1px solid ${e.verificationStatus === 'VERIFIED' ? '#bbf7d0' : e.verificationStatus === 'PENDING' ? '#fde68a' : '#fecaca'}`
              }}>
                {e.verificationStatus}
              </span>
              <span style={{ fontSize: '0.68rem', color: '#64748b', textAlign: 'center' }}>
                {e.organizationType}
              </span>
            </div>

            <div className="cc-row-main">
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                <strong style={{ fontSize: '1rem', color: '#0f172a' }}>{e.organizationName}</strong>
                {e.verificationStatus === 'VERIFIED' && (
                  <span style={{ fontSize: '0.7rem', backgroundColor: '#fef3c7', color: '#92400e', padding: '1px 6px', borderRadius: '4px', fontWeight: 700, border: '1px solid #fde68a' }}>
                    ★ Verified by Sahayta Setu's authorized platform administrator
                  </span>
                )}
                {e.registrationNumber && (
                  <span style={{ fontSize: '0.7rem', backgroundColor: '#f1f5f9', color: '#475569', padding: '1px 6px', borderRadius: '4px' }}>
                    Reg: {e.registrationNumber}
                  </span>
                )}
              </div>
              <p style={{ margin: '4px 0', color: '#475569' }}>
                Representative: <strong>{e.representativeName}</strong> · Phone: {e.phone} {e.email ? `· ${e.email}` : ''}
              </p>
              <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', alignItems: 'center', fontSize: '0.75rem', color: '#64748b' }}>
                <span>📍 Jurisdiction: <b>{e.district}, {e.state}</b></span>
                {e.block && <span>· Block: {e.block}</span>}
                {e.authorityLevel && <span>· Authority Level: {e.authorityLevel}</span>}
                {e.verifiedBy && <span>· Reviewed by: <em>{e.verifiedBy}</em></span>}
                {e.reason && <span style={{ color: '#b91c1c' }}>· Note: {e.reason}</span>}
              </div>
            </div>

            <div className="cc-row-meta" style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
              {e.verificationStatus !== 'VERIFIED' && (
                <button
                  className="cc-primary-btn"
                  style={{ fontSize: '0.75rem', padding: '4px 10px', backgroundColor: '#16a34a', borderColor: '#16a34a' }}
                  onClick={() => openActionModal(e, 'approve')}
                  disabled={actionLoading === e._id}
                >
                  ✓ Approve
                </button>
              )}
              {e.verificationStatus === 'PENDING' && (
                <button
                  className="cc-secondary-btn"
                  style={{ fontSize: '0.75rem', padding: '4px 8px', color: '#b91c1c', borderColor: '#fecaca' }}
                  onClick={() => openActionModal(e, 'reject')}
                  disabled={actionLoading === e._id}
                >
                  ✕ Reject
                </button>
              )}
              {e.verificationStatus === 'VERIFIED' && (
                <button
                  className="cc-secondary-btn"
                  style={{ fontSize: '0.75rem', padding: '4px 8px', color: '#b45309', borderColor: '#fde68a' }}
                  onClick={() => openActionModal(e, 'suspend')}
                  disabled={actionLoading === e._id}
                >
                  ⏸ Suspend
                </button>
              )}
              {['VERIFIED', 'SUSPENDED'].includes(e.verificationStatus) && (
                <button
                  className="cc-secondary-btn"
                  style={{ fontSize: '0.75rem', padding: '4px 8px', color: '#991b1b', borderColor: '#fca5a5' }}
                  onClick={() => openActionModal(e, 'revoke')}
                  disabled={actionLoading === e._id}
                >
                  🚫 Revoke
                </button>
              )}
              {['REJECTED', 'SUSPENDED', 'REVOKED'].includes(e.verificationStatus) && (
                <button
                  className="cc-secondary-btn"
                  style={{ fontSize: '0.75rem', padding: '4px 8px', color: '#0284c7', borderColor: '#bae6fd' }}
                  onClick={() => openActionModal(e, 'reinstate')}
                  disabled={actionLoading === e._id}
                >
                  ↺ Reinstate
                </button>
              )}
            </div>
          </div>
        ))}
      </div>

      {/* ACTION MODAL */}
      {activeEntity && actionType && (
        <div style={{ position: 'fixed', inset: 0, backgroundColor: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: '20px' }}>
          <div style={{ background: '#ffffff', borderRadius: '12px', padding: '24px', maxWidth: '480px', width: '100%', boxShadow: '0 20px 25px -5px rgba(0,0,0,0.1)' }}>
            <h3 style={{ margin: '0 0 12px 0', fontSize: '1.2rem', color: '#0f172a' }}>
              {actionType === 'approve' ? 'Approve & Confirm Jurisdiction' : `${actionType.toUpperCase()} Entity`}
            </h3>
            <p style={{ fontSize: '0.875rem', color: '#475569', marginBottom: '16px' }}>
              Organization: <strong>{activeEntity.organizationName}</strong> ({activeEntity.organizationType})
            </p>

            {actionType === 'approve' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', marginBottom: '16px' }}>
                <div>
                  <label style={{ fontSize: '0.75rem', fontWeight: 600, color: '#475569', display: 'block', marginBottom: '4px' }}>
                    AUTHORITY LEVEL / SCOPE
                  </label>
                  <select
                    value={editAuthorityLevel}
                    onChange={(e) => setEditAuthorityLevel(e.target.value)}
                    style={{ width: '100%', padding: '8px 12px', borderRadius: '6px', border: '1px solid #cbd5e1' }}
                  >
                    <option value="GRAM_PANCHAYAT">Gram Panchayat</option>
                    <option value="DISTRICT">District Authority</option>
                    <option value="STATE">State Authority</option>
                  </select>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
                  <div>
                    <label style={{ fontSize: '0.75rem', fontWeight: 600, color: '#475569', display: 'block', marginBottom: '4px' }}>
                      CONFIRMED STATE
                    </label>
                    <input
                      type="text"
                      value={editState}
                      onChange={(e) => setEditState(e.target.value)}
                      style={{ width: '100%', padding: '8px 12px', borderRadius: '6px', border: '1px solid #cbd5e1' }}
                    />
                  </div>
                  <div>
                    <label style={{ fontSize: '0.75rem', fontWeight: 600, color: '#475569', display: 'block', marginBottom: '4px' }}>
                      CONFIRMED DISTRICT
                    </label>
                    <input
                      type="text"
                      value={editDistrict}
                      onChange={(e) => setEditDistrict(e.target.value)}
                      style={{ width: '100%', padding: '8px 12px', borderRadius: '6px', border: '1px solid #cbd5e1' }}
                    />
                  </div>
                </div>
              </div>
            )}

            <div style={{ marginBottom: '16px' }}>
              <label style={{ fontSize: '0.75rem', fontWeight: 600, color: '#475569', display: 'block', marginBottom: '4px' }}>
                {actionType === 'approve' ? 'ADMINISTRATIVE NOTES (OPTIONAL)' : 'REASON (REQUIRED)'}
              </label>
              <textarea
                value={modalReason}
                onChange={(e) => setModalReason(e.target.value)}
                placeholder={actionType === 'approve' ? "Optional notes on verified credentials..." : "Provide clear administrative rationale..."}
                style={{ width: '100%', height: '80px', padding: '8px 12px', borderRadius: '6px', border: '1px solid #cbd5e1', fontSize: '0.875rem' }}
              />
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px' }}>
              <button
                type="button"
                className="cc-secondary-btn"
                onClick={closeModal}
                disabled={Boolean(actionLoading)}
              >
                Cancel
              </button>
              <button
                type="button"
                className="cc-primary-btn"
                onClick={handleModalSubmit}
                disabled={Boolean(actionLoading)}
                style={{
                  backgroundColor: ['reject', 'revoke', 'suspend'].includes(actionType) ? '#dc2626' : '#16a34a',
                  borderColor: ['reject', 'revoke', 'suspend'].includes(actionType) ? '#dc2626' : '#16a34a',
                }}
              >
                {actionLoading ? 'Processing...' : `Confirm ${actionType.toUpperCase()}`}
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}

// ---------------------------------------------------------------
// AUDIT LOG VIEW (Disaster Coordination Audit Trail)
// ---------------------------------------------------------------

export function AuditLogView() {
  const [logs, setLogs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [actionFilter, setActionFilter] = useState("ALL");

  const loadLogs = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const data = await apiFetch("/api/admin/audit-logs");
      setLogs(Array.isArray(data) ? data : []);
    } catch (err) {
      setError(err.message || "Failed to load audit logs");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const initialLoad = setTimeout(loadLogs, 0);
    const interval = setInterval(loadLogs, 10000);
    return () => {
      clearTimeout(initialLoad);
      clearInterval(interval);
    };
  }, [loadLogs]);

  const ACTIONS = ["ALL", "SOS_CREATED", "SOS_TRIAGED", "SOS_ASSIGNED", "ALERT_CREATED", "ALERT_RETRANSMITTED", "AUTHORITY_VERIFIED", "NGO_VERIFIED"];

  const filtered = logs.filter((l) => {
    if (actionFilter === "ALL") return true;
    return l.action === actionFilter;
  });

  return (
    <section className="cc-view">
      <ViewHeader
        title="Disaster Operations Audit Log"
        subtitle="Immutable chronological audit trail of all emergency reports, authority triage, responder dispatches and public warnings"
      >
        <button className="cc-secondary-btn" onClick={loadLogs}>
          🔄 Refresh
        </button>
      </ViewHeader>

      <div className="cc-tabs">
        {ACTIONS.map((act) => (
          <button
            key={act}
            className={`cc-tab ${actionFilter === act ? "active" : ""}`}
            onClick={() => setActionFilter(act)}
          >
            {act.replace(/_/g, ' ')}
          </button>
        ))}
      </div>

      <div className="panel cc-list">
        {loading && <EmptyState icon="⏳" title="Loading audit logs..." text="Querying immutable audit service." />}
        {!loading && error && <EmptyState icon="⚠" title="Unable to load audit logs" text={error} />}
        {!loading && !error && filtered.length === 0 && (
          <EmptyState icon="✓" title="No audit entries found" text="Actions performed in the system will be recorded here." />
        )}

        {!loading && !error && filtered.map((log) => {
          const isSos = log.action?.startsWith('SOS');
          const isAlert = log.action?.startsWith('ALERT');
          const isVerify = log.action?.includes('VERIF');

          const badgeColor = isSos ? '#dc2626' : isAlert ? '#ea580c' : isVerify ? '#16a34a' : '#2563eb';
          const badgeBg = isSos ? '#fef2f2' : isAlert ? '#fff7ed' : isVerify ? '#f0fdf4' : '#eff6ff';

          return (
            <div className="cc-row" key={log._id || log.timestamp}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', minWidth: '130px' }}>
                <span style={{
                  fontSize: '0.7rem',
                  fontWeight: 700,
                  padding: '3px 6px',
                  borderRadius: '4px',
                  textAlign: 'center',
                  backgroundColor: badgeBg,
                  color: badgeColor,
                  border: `1px solid ${badgeColor}33`
                }}>
                  {log.action}
                </span>
                <span style={{ fontSize: '0.68rem', color: '#64748b', textAlign: 'center' }}>
                  {timeAgo(log.timestamp)}
                </span>
              </div>

              <div className="cc-row-main">
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                  <strong>Actor: {log.actorName || log.actorId}</strong>
                  <span style={{ fontSize: '0.72rem', backgroundColor: '#f1f5f9', color: '#475569', padding: '1px 6px', borderRadius: '4px' }}>
                    Role: {log.actorRole}
                  </span>
                  {log.targetId && (
                    <span style={{ fontSize: '0.72rem', backgroundColor: '#f8fafc', color: '#64748b', padding: '1px 6px', borderRadius: '4px', border: '1px solid #e2e8f0' }}>
                      Target: {log.targetType || 'Item'} ({log.targetId})
                    </span>
                  )}
                </div>
                <div style={{ marginTop: '4px', fontSize: '0.8rem', color: '#334155' }}>
                  {log.jurisdiction?.district && (
                    <span>📍 Jurisdiction: <b>{log.jurisdiction.district}{log.jurisdiction.state ? `, ${log.jurisdiction.state}` : ''}</b> · </span>
                  )}
                  <span>Details: {JSON.stringify(log.details || {})}</span>
                </div>
              </div>

              <div className="cc-row-meta">
                <small style={{ color: '#94a3b8', fontSize: '0.72rem' }}>
                  {new Date(log.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                </small>
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
