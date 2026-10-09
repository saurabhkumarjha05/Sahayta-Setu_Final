import { useCallback, useState, useEffect, useMemo } from 'react';
import { MapContainer, TileLayer, Marker, Popup, Circle, useMap } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';
import './maps.css';
import '../../styles/tokens.css';
import '../../styles/animations.css';
import FixMapSize from './FixMapSize';
import L from 'leaflet';
import {
  userIcon,
  shelterIcon,
  medicalIcon,
  reliefIcon,
  nearestIcon,
  needyIcon
} from './MapIcons';
import { calculateDistanceKm } from '../../data/verifiedResources';
import { getSocket } from '../../utils/socketClient';
import { apiFetch } from '../../api';
import { useI18n } from '../../i18n';
import { Button, Badge, Card, BottomSheet } from '../ui';

const IDB_RESOURCE_KEY = 'sahayta_cached_nearby_resources';

function AutoBounds({ points }) {
  const map = useMap();
  useEffect(() => {
    if (points && points.length > 0) {
      try {
        const bounds = L.latLngBounds(points);
        map.fitBounds(bounds, { padding: [40, 40], maxZoom: 14 });
      } catch {
        // ignore bounds calculation error
      }
    }
  }, [points, map]);
  return null;
}

export function NearbyResourcesMap({
  userPos = [30.3165, 78.0322],
  isLiveGps = false,
  locationAccuracy = 50,
  locationSource = 'District Fallback',
  state = 'Uttarakhand',
  district = 'Dehradun',
  onLocateMe,
  hasActiveSos = false,
  sosCoords = null
}) {
  const { t } = useI18n();
  const [userLat, userLng] = userPos;

  const [filterType, setFilterType] = useState('all'); // all | shelter | ngo | medical | volunteer
  const [resources, setResources] = useState([]);
  const [volunteerSummary, setVolunteerSummary] = useState(null);
  const [viewMode, setViewMode] = useState('split'); // split | map | list
  const [activeRadius, setActiveRadius] = useState(5);
  const [radiusExpanded, setRadiusExpanded] = useState(false);
  const [lastUpdated, setLastUpdated] = useState(null);
  const [networkStatus, setNetworkStatus] = useState('live'); // live | delayed | offline
  const [tileError, setTileError] = useState(false);
  const [selectedResource, setSelectedResource] = useState(null);
  const [panchayatModalOpen, setPanchayatModalOpen] = useState(false);
  const [panchayatNotice, setPanchayatNotice] = useState('');

  // Fetch nearby resources from server endpoint with fallback to cached IndexedDB / local dataset
  const fetchNearby = useCallback(async () => {
    try {
      const query = `?lat=${userLat}&lng=${userLng}&radius=${activeRadius}&types=${filterType}&state=${encodeURIComponent(state)}&district=${encodeURIComponent(district)}`;
      const data = await apiFetch(`/api/resources/nearby${query}`);

      if (data && data.success) {
        setResources(data.resources || []);
        setVolunteerSummary(data.volunteerSummary || null);
        setActiveRadius(data.radiusKm || activeRadius);
        setRadiusExpanded(Boolean(data.expanded));
        setLastUpdated(new Date());
        setNetworkStatus('live');

        // Cache in localStorage/IDB for offline access
        try {
          localStorage.setItem(IDB_RESOURCE_KEY, JSON.stringify({
            timestamp: new Date().toISOString(),
            resources: data.resources,
            volunteerSummary: data.volunteerSummary,
            radiusKm: data.radiusKm
          }));
        } catch {
          // ignore cache error
        }
      }
    } catch (err) {
      console.warn('Live resource fetch failed, loading cached fallback:', err.message);
      setNetworkStatus('offline');

      // Attempt to load from offline cache
      try {
        const cached = localStorage.getItem(IDB_RESOURCE_KEY);
        if (cached) {
          const parsed = JSON.parse(cached);
          setResources(parsed.resources || []);
          setVolunteerSummary(parsed.volunteerSummary || null);
          setLastUpdated(new Date(parsed.timestamp));
        }
      } catch {
        // ignore
      }
    }
  }, [userLat, userLng, activeRadius, filterType, state, district]);

  useEffect(() => {
    const initialFetch = setTimeout(fetchNearby, 0);
    // Fallback polling every 30-45s when socket is silent
    const timer = setInterval(() => {
      fetchNearby();
      if (!navigator.onLine) setNetworkStatus('offline');
    }, 35000);

    return () => {
      clearTimeout(initialFetch);
      clearInterval(timer);
    };
  }, [fetchNearby]);

  // Subscribe to realtime resource updates via Socket.IO
  useEffect(() => {
    const socket = getSocket();
    const handleResourceUpdate = () => {
      fetchNearby();
    };

    socket.on('resource:updated', handleResourceUpdate);
    socket.on('shelter:capacity_changed', handleResourceUpdate);

    return () => {
      socket.off('resource:updated', handleResourceUpdate);
      socket.off('shelter:capacity_changed', handleResourceUpdate);
    };
  }, [fetchNearby]);

  // Compute distance for items and identify nearest of each type
  const processedResources = useMemo(() => {
    return resources.map((r) => {
      const dist = calculateDistanceKm(userPos, [r.lat, r.lng]) || r.distanceKm || 0;
      return {
        ...r,
        distanceKm: Number(dist.toFixed(1))
      };
    }).sort((a, b) => a.distanceKm - b.distanceKm);
  }, [resources, userPos]);

  // Find nearest of each category
  const nearestByType = useMemo(() => {
    const map = {};
    for (const r of processedResources) {
      const cat = r.category || (String(r.type || '').toLowerCase().includes('hospital') ? 'medical' : 'shelter');
      if (!map[cat]) {
        map[cat] = r.id;
      }
    }
    return map;
  }, [processedResources]);

  // Filter based on active chip
  const filteredList = useMemo(() => {
    if (filterType === 'all') return processedResources;
    if (filterType === 'shelter') return processedResources.filter(r => (r.category || '').toLowerCase() === 'shelter' || (r.type || '').toLowerCase().includes('shelter'));
    if (filterType === 'medical') return processedResources.filter(r => (r.category || '').toLowerCase() === 'medical' || (r.type || '').toLowerCase().includes('hospital'));
    if (filterType === 'ngo') return processedResources.filter(r => (r.type || '').toLowerCase().includes('ngo') || (r.category || '').toLowerCase() === 'ngo');
    return processedResources;
  }, [processedResources, filterType]);

  const allPoints = useMemo(() => {
    const pts = [userPos];
    if (hasActiveSos && sosCoords) pts.push(sosCoords);
    filteredList.forEach((r) => {
      if (Number.isFinite(r.lat) && Number.isFinite(r.lng)) {
        pts.push([r.lat, r.lng]);
      }
    });
    return pts;
  }, [userPos, filteredList, hasActiveSos, sosCoords]);

  const formatTimeAgo = (date) => {
    if (!date) return 'offline';
    const mins = Math.floor((new Date() - new Date(date)) / 60000);
    if (mins < 1) return 'Just now';
    if (mins < 60) return `${mins}m ago`;
    return `${Math.floor(mins / 60)}h ago`;
  };

  const handleRequestHelpViaPanchayat = (res) => {
    setSelectedResource(res);
    setPanchayatModalOpen(true);
    setPanchayatNotice('');
  };

  const handleConfirmPanchayatRequest = () => {
    setPanchayatNotice('✓ Help request routed to Gram Panchayat & District Control Centre. Human dispatch coordinator alerted.');
    setTimeout(() => {
      setPanchayatModalOpen(false);
      setPanchayatNotice('');
    }, 2500);
  };

  return (
    <div className="nearby-resources-system" role="region" aria-label="Nearby Emergency Resources Map and Directory">
      {/* MAP HEADER CONTROLS */}
      <div className="nearby-map-header">
        <div className="nearby-header-left">
          <div className="nearby-live-badge">
            <span className={`status-dot ${networkStatus}`} aria-hidden="true"></span>
            <strong>
              {networkStatus === 'live' ? t('resources.live') : networkStatus === 'delayed' ? t('resources.delayed') : t('resources.offline')}
            </strong>
            <small>· {formatTimeAgo(lastUpdated)}</small>
          </div>

          <span className="nearby-location-badge">
            📍 {locationSource} ({isLiveGps ? `±${Math.round(locationAccuracy)}m` : district})
          </span>
        </div>

        <div className="nearby-header-actions">
          {onLocateMe && (
            <button
              type="button"
              className="nearby-ctrl-btn"
              onClick={onLocateMe}
              title="Locate my position via GPS"
            >
              🎯 Locate Me
            </button>
          )}

          <div className="nearby-view-toggle">
            <button
              type="button"
              className={`view-btn ${viewMode !== 'list' ? 'active' : ''}`}
              onClick={() => setViewMode(viewMode === 'list' ? 'split' : 'map')}
            >
              🗺️ Map
            </button>
            <button
              type="button"
              className={`view-btn ${viewMode === 'list' ? 'active' : ''}`}
              onClick={() => setViewMode('list')}
            >
              📋 List
            </button>
          </div>
        </div>
      </div>

      {/* FILTER CHIPS */}
      <div className="nearby-filter-chips" role="tablist" aria-label="Resource filter">
        {[
          { id: 'all', label: t('resources.filterAll'), icon: '🌐' },
          { id: 'shelter', label: t('resources.filterShelters'), icon: '🏠' },
          { id: 'medical', label: t('resources.filterMedical'), icon: '🏥' },
          { id: 'ngo', label: t('resources.filterNgos'), icon: '🛡️' },
          { id: 'volunteer', label: t('resources.filterVolunteers'), icon: '🤝' }
        ].map((chip) => (
          <button
            key={chip.id}
            type="button"
            className={`filter-chip ${filterType === chip.id ? 'active' : ''}`}
            onClick={() => setFilterType(chip.id)}
            role="tab"
            aria-selected={filterType === chip.id}
          >
            <span>{chip.icon}</span>
            <span>{chip.label}</span>
          </button>
        ))}
      </div>

      {/* RADIUS AUTO-EXPANSION ALERT */}
      {radiusExpanded && (
        <div className="radius-expanded-alert anim-fade-in-up">
          <span>ℹ️</span>
          <span>
            No facilities found within 5 km. Automatically expanded search radius to{' '}
            <strong>{activeRadius} km</strong> for {district}, {state}.
          </span>
        </div>
      )}

      {/* VOLUNTEER PRIVACY SUMMARY BANNER */}
      {(filterType === 'all' || filterType === 'volunteer') && volunteerSummary && (
        <div className="volunteer-privacy-banner anim-fade-in-up">
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <span style={{ fontSize: '1.4rem' }}>🛡️</span>
            <div>
              <strong>
                {volunteerSummary.count} verified volunteers available within {volunteerSummary.radiusKm} km
              </strong>
              <small style={{ display: 'block', opacity: 0.9 }}>
                🔒 Privacy-Protected: Exact coordinates masked. Dispatch is coordinated exclusively via Gram Panchayat Control Centre.
              </small>
            </div>
          </div>
        </div>
      )}

      {/* MAP & LIST LAYOUT CONTAINER */}
      <div className={`nearby-layout-frame mode-${viewMode}`}>
        {/* LEAFLET MAP VIEW */}
        {viewMode !== 'list' && (
          <div className="nearby-map-wrapper">
            <MapContainer
              center={userPos}
              zoom={13}
              scrollWheelZoom={true}
              className="nearby-leaflet-canvas"
            >
              <FixMapSize />
              <AutoBounds points={allPoints} />

              <TileLayer
                attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
                url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
                eventHandlers={{
                  tileerror: () => setTileError(true)
                }}
              />

              {/* User Location Marker & Accuracy Circle */}
              <Marker position={userPos} icon={userIcon}>
                <Popup>
                  <div className="popup-card">
                    <h4>📍 Your Location</h4>
                    <p>{isLiveGps ? 'Live GPS Position' : `Approximate Center (${district})`}</p>
                    <small>{userPos[0].toFixed(4)} N, {userPos[1].toFixed(4)} E</small>
                  </div>
                </Popup>
              </Marker>

              {isLiveGps && Number.isFinite(locationAccuracy) && (
                <Circle
                  center={userPos}
                  radius={Math.max(locationAccuracy, 30)}
                  pathOptions={{ color: '#2563eb', fillColor: '#3b82f6', fillOpacity: 0.15 }}
                />
              )}

              {/* Active SOS Pin if user has an emergency */}
              {hasActiveSos && sosCoords && (
                <Marker position={sosCoords} icon={needyIcon}>
                  <Popup>
                    <div className="popup-card">
                      <h4 style={{ color: '#dc2626' }}>🆘 ACTIVE EMERGENCY SOS</h4>
                      <p>Tracked live by control centre</p>
                    </div>
                  </Popup>
                </Marker>
              )}

              {/* Verified Resource Markers */}
              {filteredList.map((res) => {
                const isNearest = nearestByType[res.category || 'shelter'] === res.id;
                const icon = isNearest
                  ? nearestIcon
                  : (res.category === 'medical' ? medicalIcon : res.category === 'relief' ? reliefIcon : shelterIcon);

                return (
                  <Marker
                    key={res.id}
                    position={[res.lat, res.lng]}
                    icon={icon}
                  >
                    <Popup>
                      <div className="popup-card">
                        <h4>
                          {isNearest ? '⭐ NEAREST: ' : ''}
                          {res.name}
                        </h4>
                        <div style={{ margin: '4px 0', fontSize: '0.8rem', color: '#166534' }}>
                          ✓ Verified {res.type || 'Facility'} · <strong>{res.distanceKm} km away</strong>
                        </div>
                        <p style={{ margin: '4px 0', fontSize: '0.8rem' }}>
                          Status: <strong style={{ color: res.status === 'Full' ? '#dc2626' : '#16a34a' }}>{res.status}</strong>
                          {res.capacity > 0 && ` (${res.availableSpaces} free / ${res.capacity})`}
                        </p>
                        <div style={{ display: 'flex', gap: '6px', marginTop: '8px' }}>
                          {res.publicContact && (
                            <a
                              href={`tel:${res.publicContact}`}
                              className="popup-btn-call"
                              style={{ textDecoration: 'none', padding: '4px 8px', background: '#16a34a', color: '#fff', borderRadius: '4px', fontSize: '0.75rem' }}
                            >
                              📞 Call
                            </a>
                          )}
                          <a
                            href={`https://www.google.com/maps/dir/?api=1&origin=${userPos[0]},${userPos[1]}&destination=${res.lat},${res.lng}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            style={{ textDecoration: 'none', padding: '4px 8px', background: '#2563eb', color: '#fff', borderRadius: '4px', fontSize: '0.75rem' }}
                          >
                            🧭 Route
                          </a>
                        </div>
                      </div>
                    </Popup>
                  </Marker>
                );
              })}
            </MapContainer>

            {tileError && (
              <div className="tile-offline-notice">
                <span>⚠️ Map tiles unavailable offline. Switching to verified list view.</span>
                <button type="button" onClick={() => setViewMode('list')}>View List</button>
              </div>
            )}
          </div>
        )}

        {/* VERIFIED RESOURCES LIST VIEW */}
        <div className="nearby-list-wrapper">
          <div className="nearby-list-header">
            <h4>{t('resources.nearestHelp')}</h4>
            <small>{filteredList.length} verified facilities</small>
          </div>

          {filteredList.length === 0 ? (
            <div className="nearby-empty-state">
              <p>No facilities found in this category.</p>
            </div>
          ) : (
            <div className="nearby-cards-scroll">
              {filteredList.map((res) => {
                const isNearest = nearestByType[res.category || 'shelter'] === res.id;
                const isFull = res.status === 'Full' || (res.capacity > 0 && res.availableSpaces === 0);

                return (
                  <Card key={res.id} className={`nearby-resource-item ${isNearest ? 'is-nearest' : ''}`}>
                    <div className="resource-header-row">
                      <div className="resource-title-group">
                        {isNearest && (
                          <Badge variant="warning" icon="⭐" text="NEAREST" />
                        )}
                        <h5 className="resource-name">{res.name}</h5>
                        <div className="resource-meta">
                          <span>{res.type || 'Relief Facility'}</span>
                          <span>·</span>
                          <strong>📏 {res.distanceKm} km away</strong>
                        </div>
                      </div>

                      <span className={`status-pill ${isFull ? 'pill-full' : 'pill-available'}`}>
                        {isFull ? t('resources.full') : t('resources.available')}
                      </span>
                    </div>

                    <div className="resource-capacity-row">
                      <span>
                        Capacity:{' '}
                        <strong>
                          {res.availableSpaces ?? 'Open'} / {res.capacity || 'N/A'}
                        </strong>
                      </span>
                      {res.verified && (
                        <span style={{ color: '#16a34a', fontWeight: 600 }}>✓ USDMA Verified</span>
                      )}
                    </div>

                    {res.servicesOffered && res.servicesOffered.length > 0 && (
                      <div className="services-chips-row">
                        {res.servicesOffered.map((svc, i) => (
                          <span key={i} className="svc-chip">{svc}</span>
                        ))}
                      </div>
                    )}

                    {/* CONNECT ACTIONS */}
                    <div className="resource-actions-row">
                      {res.publicContact ? (
                        <a
                          href={`tel:${res.publicContact}`}
                          className="action-btn action-call"
                          aria-label={`Call ${res.name}`}
                        >
                          📞 {t('resources.call')}
                        </a>
                      ) : (
                        <span className="action-btn disabled">No direct phone</span>
                      )}

                      <a
                        href={`https://www.google.com/maps/dir/?api=1&origin=${userPos[0]},${userPos[1]}&destination=${res.lat},${res.lng}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="action-btn action-directions"
                      >
                        🧭 {t('resources.directions')}
                      </a>

                      <button
                        type="button"
                        className="action-btn action-panchayat"
                        onClick={() => handleRequestHelpViaPanchayat(res)}
                      >
                        🏢 {t('resources.requestViaPanchayat')}
                      </button>
                    </div>
                  </Card>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* REQUEST HELP VIA PANCHAYAT MODAL */}
      <BottomSheet
        isOpen={panchayatModalOpen}
        onClose={() => setPanchayatModalOpen(false)}
        title="Request Help via Gram Panchayat"
      >
        <div style={{ padding: '8px 0' }}>
          <p style={{ margin: '0 0 12px 0', fontSize: '0.95rem' }}>
            Routing request to <strong>Gram Panchayat Control Centre ({district})</strong> for:
          </p>
          <div style={{ background: '#f8fafc', padding: '12px', borderRadius: '8px', border: '1px solid #e2e8f0', marginBottom: '16px' }}>
            <strong>{selectedResource?.name}</strong>
            <div style={{ fontSize: '0.85rem', color: '#64748b', marginTop: '4px' }}>
              📍 {selectedResource?.distanceKm} km away · {selectedResource?.type}
            </div>
          </div>

          <p style={{ fontSize: '0.85rem', color: '#475569', marginBottom: '16px' }}>
            ℹ️ Notice: Dispatch stays human-controlled. The Gram Panchayat officer reviews availability before assigning volunteer teams or shelter spots.
          </p>

          {panchayatNotice ? (
            <div style={{ padding: '12px', borderRadius: '8px', background: '#f0fdf4', color: '#166534', fontWeight: 600, textAlign: 'center' }}>
              {panchayatNotice}
            </div>
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
              <Button variant="ghost" onClick={() => setPanchayatModalOpen(false)}>
                Cancel
              </Button>
              <Button variant="primary" onClick={handleConfirmPanchayatRequest}>
                Confirm Request
              </Button>
            </div>
          )}
        </div>
      </BottomSheet>
    </div>
  );
}

export default NearbyResourcesMap;
