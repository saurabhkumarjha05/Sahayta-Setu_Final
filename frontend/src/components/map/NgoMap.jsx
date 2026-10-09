import { useEffect } from 'react';
import { MapContainer, TileLayer, Marker, CircleMarker, Polyline, Popup, useMap } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';
import './maps.css';
import FixMapSize from './FixMapSize';
import L from 'leaflet';
import { needyIcon, shelterIcon } from './MapIcons';
import { getVerifiedShelters, calculateDistanceKm, filterByLocation } from '../../data/verifiedResources';
import { findDistrictCoordinates } from '../../data/indiaLocations';
import { ALL_VILLAGE_ZONES } from '../../data/mockData';

function MapFlyTo({ center, zoom = 11 }) {
  const map = useMap();
  useEffect(() => {
    if (center && Number.isFinite(center[0]) && Number.isFinite(center[1])) {
      map.flyTo(center, zoom, { duration: 1.5 });
    }
  }, [center, zoom, map]);
  return null;
}

const createNgoBasePin = (name, status = 'Available') => {
  const isAvailable = status.toLowerCase() === 'available';
  const color = isAvailable ? '#16a34a' : '#d97706';
  return L.divIcon({
    className: 'custom-ngo-base-pin',
    html: `
      <div style="
        background: linear-gradient(135deg, ${color}, #065f46);
        color: #ffffff;
        padding: 6px 12px;
        border-radius: 20px;
        font-weight: 700;
        font-size: 12px;
        border: 2px solid #ffffff;
        box-shadow: 0 4px 10px rgba(0,0,0,0.3);
        display: flex;
        align-items: center;
        gap: 6px;
        white-space: nowrap;
        transform: translate(-50%, -100%);
      ">
        <span>🚑</span>
        <span>${name}</span>
        <span style="background: rgba(255,255,255,0.25); padding: 2px 6px; border-radius: 10px; font-size: 10px;">${status}</span>
      </div>
    `,
    iconSize: [0, 0],
    iconAnchor: [0, 0]
  });
};

const NgoMap = ({
  state = "Uttarakhand",
  district = "Dehradun",
  ngoLocation = null,
  ngoName = "Helping Hands Response Unit",
  ngoStatus = "Available",
  sosList = [],
  onAcceptSos
}) => {
  // Determine NGO Base Position
  const defaultDistrictCoords = findDistrictCoordinates(district, state);
  const baseCoords = ngoLocation && Number.isFinite(ngoLocation.lat) && Number.isFinite(ngoLocation.lng)
    ? [ngoLocation.lat, ngoLocation.lng]
    : (defaultDistrictCoords ? [defaultDistrictCoords.lat, defaultDistrictCoords.lng] : [30.3165, 78.0322]);

  // Verified shelters for NGO operational location
  const shelters = getVerifiedShelters(state, district);

  // Active & assigned SOS filtered for this location
  const activeSos = sosList.filter(s => {
    if (s.state && s.state.toLowerCase() !== state.toLowerCase()) return false;
    if (s.district && s.district.toLowerCase() !== district.toLowerCase()) return false;
    return s.status === 'Pending' || s.status === 'ACTIVE';
  });

  // Calculate distance lines from NGO base to active SOS incidents
  const sosRoutes = activeSos.map(sos => {
    const sosLat = sos.location?.lat || sos.lat;
    const sosLng = sos.location?.lng || sos.lng;
    if (!sosLat || !sosLng) return null;
    const dist = calculateDistanceKm(baseCoords, [sosLat, sosLng]);
    return {
      sos,
      coords: [sosLat, sosLng],
      distKm: dist
    };
  }).filter(Boolean);

  return (
    <div className="map-view-container">
      <div className="role-banner banner-ngo">
        <div className="banner-left">
          <span>🚑 <strong>NGO OPERATIONS MAP</strong></span>
          <span className="live-badge">OPERATIONAL HUB — {district.toUpperCase()}, {state.toUpperCase()}</span>
        </div>
        <div className="banner-right">
          <span>Status: <strong>{ngoStatus.toUpperCase()}</strong></span>
        </div>
      </div>

      <MapContainer center={baseCoords} zoom={11} scrollWheelZoom={true} className="leaflet-map-frame">
        <FixMapSize />
        <MapFlyTo center={baseCoords} zoom={11} />

        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />

        {/* 1. NGO Base / Operational Unit Position */}
        <Marker position={baseCoords} icon={createNgoBasePin(ngoName, ngoStatus)}>
          <Popup>
            <div className="popup-card">
              <h4>🚑 NGO RESPONSE UNIT</h4>
              <p><strong>{ngoName}</strong></p>
              <p>Status: <span className="status-badge open">{ngoStatus}</span></p>
              <p>District: {district}, {state}</p>
              <p className="coord-text">{baseCoords[0].toFixed(4)} N, {baseCoords[1].toFixed(4)} E</p>
            </div>
          </Popup>
        </Marker>

        {/* 2. Nearby Verified Shelters & Emergency Centers */}
        {shelters.map((s) => {
          const distFromNgo = calculateDistanceKm(baseCoords, [s.latitude, s.longitude]);
          return (
            <Marker key={s.id} position={[s.latitude, s.longitude]} icon={shelterIcon}>
              <Popup>
                <div className="popup-card">
                  <h4>🏠 {s.name}</h4>
                  <p>Type: <strong>{s.type}</strong></p>
                  <p>Distance: <strong>{distFromNgo.toFixed(1)} km</strong> from NGO Base</p>
                  <p>Capacity: {Math.max(0, s.capacity - s.currentOccupancy)} / {s.capacity} beds free</p>
                  <div style={{ marginTop: '4px', fontSize: '0.75rem', color: '#166534' }}>
                    {s.verified ? '✓ Verified Public Resource' : 'Demo Resource'}
                  </div>
                </div>
              </Popup>
            </Marker>
          );
        })}

        {/* 3. Active SOS Incidents */}
        {sosRoutes.map(({ sos, coords, distKm }) => (
          <Marker key={sos._id || sos.id} position={coords} icon={needyIcon}>
            <Popup>
              <div className="popup-card">
                <h4 style={{ color: '#dc2626' }}>🚨 ACTIVE SOS INCIDENT</h4>
                <p>Type: <strong>{sos.type || 'Emergency Rescue'}</strong></p>
                <p>Location: <strong>{distKm.toFixed(1)} km away</strong></p>
                <p>Location Precision: {sos.isApproximateLocation ? '⚠️ District Fallback' : '📍 Exact GPS'}</p>
                {sos.village && <p>Village: {sos.village}</p>}
                {sos.contactPhone && <p>Contact: {sos.contactPhone}</p>}
                {onAcceptSos && (
                  <button
                    onClick={() => onAcceptSos(sos._id || sos.id)}
                    style={{
                      marginTop: '8px',
                      padding: '6px 12px',
                      backgroundColor: '#dc2626',
                      color: '#fff',
                      border: 'none',
                      borderRadius: '4px',
                      fontWeight: '600',
                      cursor: 'pointer',
                      width: '100%'
                    }}
                  >
                    Accept Dispatch Mission
                  </button>
                )}
              </div>
            </Popup>
          </Marker>
        ))}

        {/* 4. Distance line from NGO Base to closest SOS */}
        {sosRoutes.map(({ sos, coords, distKm }) => (
          <Polyline
            key={`line-${sos._id || sos.id}`}
            positions={[baseCoords, coords]}
            pathOptions={{ color: '#dc2626', weight: 3, dashArray: '8, 8', opacity: 0.8 }}
          >
            <Popup>
              <div className="popup-card">
                <strong style={{ color: '#dc2626' }}>Distance Corridor: {distKm.toFixed(1)} km</strong>
                <p>From NGO Base → SOS Incident</p>
              </div>
            </Popup>
          </Polyline>
        ))}

        {/* Regional operational zones */}
        {filterByLocation(ALL_VILLAGE_ZONES, state, district).map((zone) => (
          <CircleMarker
            key={`ngo-zone-${zone.id}`}
            center={[zone.lat, zone.lng]}
            radius={16}
            pathOptions={{ color: '#dc2626', fillColor: '#dc2626', fillOpacity: 0.4 }}
          />
        ))}
      </MapContainer>

      {/* NGO Operations Legend */}
      <div className="map-legend">
        <h4>NGO Operations Center</h4>
        <div className="legend-entry">
          <span className="legend-badge pin-red">🚑</span>
          <span>NGO Operational Base ({district})</span>
        </div>
        <div className="legend-entry">
          <span className="legend-badge pin-sos">🚨</span>
          <span>Active SOS Incident</span>
        </div>
        <div className="legend-entry">
          <span className="legend-badge pin-blue">🏠</span>
          <span>Verified Emergency Shelter</span>
        </div>
        {sosRoutes.length > 0 && (
          <div className="legend-entry">
            <span className="legend-line line-red"></span>
            <span>Direct Response Line ({sosRoutes[0].distKm.toFixed(1)} km)</span>
          </div>
        )}
      </div>
    </div>
  );
};

export default NgoMap;