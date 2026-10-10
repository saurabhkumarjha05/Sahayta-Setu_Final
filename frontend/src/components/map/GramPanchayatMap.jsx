import { useCallback, useEffect, useState } from 'react';
import { MapContainer, TileLayer, CircleMarker, Marker, Popup, useMap } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';
import './maps.css';
import FixMapSize from './FixMapSize';
import L from 'leaflet';
import { shelterIcon, needyIcon } from './MapIcons';
import LocationSelector from '../LocationSelector';
import { findDistrictCoordinates } from '../../data/indiaLocations';
import { apiFetch } from '../../api';
import { DEFAULT_STATE, DEFAULT_DISTRICT } from '../../config/locationConfig';

const DEFAULT_COORDINATES = findDistrictCoordinates(DEFAULT_DISTRICT, DEFAULT_STATE);
const DEFAULT_CENTER = [DEFAULT_COORDINATES.lat, DEFAULT_COORDINATES.lng];

const priorityColor = (priority) => {
  switch (String(priority || '').toUpperCase()) {
    case 'CRITICAL':
    case 'SEVERE': return '#991b1b';
    case 'HIGH': return '#dc2626';
    case 'MEDIUM':
    case 'MODERATE': return '#d97706';
    default: return '#16a34a';
  }
};

function MapFlyTo({ center, zoom = 10 }) {
  const map = useMap();
  useEffect(() => {
    if (center && Number.isFinite(center[0]) && Number.isFinite(center[1])) {
      map.flyTo(center, zoom, { duration: 1 });
    }
  }, [center, zoom, map]);
  return null;
}

function createSelectedPin(districtName) {
  return L.divIcon({
    className: 'custom-district-pin-wrapper',
    html: `<div class="map-district-pin">📍 ${districtName}</div>`,
    iconSize: [0, 0],
    iconAnchor: [0, 0]
  });
}

export default function GramPanchayatMap({ initialPropsState = '', initialPropsDistrict = '' }) {
  const [selectedState, setSelectedState] = useState(initialPropsState || DEFAULT_STATE);
  const [selectedDistrict, setSelectedDistrict] = useState(initialPropsDistrict || DEFAULT_DISTRICT);
  const [selectedCoords, setSelectedCoords] = useState(() => {
    const coords = findDistrictCoordinates(
      initialPropsDistrict || DEFAULT_DISTRICT,
      initialPropsState || DEFAULT_STATE
    );
    return coords ? [coords.lat, coords.lng] : DEFAULT_CENTER;
  });
  const [shelters, setShelters] = useState([]);
  const [incidents, setIncidents] = useState([]);
  const [riskZones, setRiskZones] = useState([]);
  const [responders, setResponders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [mapError, setMapError] = useState('');

  const fetchMapData = useCallback(async () => {
    const locationQuery = `state=${encodeURIComponent(selectedState)}&district=${encodeURIComponent(selectedDistrict)}`;
    const results = await Promise.allSettled([
      apiFetch(`/api/shelters?${locationQuery}`),
      apiFetch(`/api/sos?${locationQuery}`),
      apiFetch(`/api/risk-zones?${locationQuery}`),
      apiFetch(`/api/ngos?${locationQuery}`)
    ]);
    const errors = [];
    const [shelterResult, incidentResult, riskResult, responderResult] = results;

    if (shelterResult.status === 'fulfilled') setShelters(Array.isArray(shelterResult.value) ? shelterResult.value : []);
    else errors.push('shelters');
    if (incidentResult.status === 'fulfilled') setIncidents(Array.isArray(incidentResult.value) ? incidentResult.value : []);
    else errors.push('incidents');
    if (riskResult.status === 'fulfilled') setRiskZones(Array.isArray(riskResult.value) ? riskResult.value : []);
    else errors.push('risk zones');
    if (responderResult.status === 'fulfilled') setResponders(Array.isArray(responderResult.value) ? responderResult.value : []);
    else errors.push('responders');

    setMapError(errors.length ? `Unable to refresh ${errors.join(', ')}.` : '');
    setLoading(false);
  }, [selectedState, selectedDistrict]);

  useEffect(() => {
    const initialLoad = setTimeout(fetchMapData, 0);
    const interval = setInterval(fetchMapData, 30000);
    return () => {
      clearTimeout(initialLoad);
      clearInterval(interval);
    };
  }, [fetchMapData]);

  const handleLocationChange = ({ state, district, coordinates }) => {
    setSelectedState(state);
    setSelectedDistrict(district);
    if (coordinates && Number.isFinite(coordinates.lat) && Number.isFinite(coordinates.lng)) {
      setSelectedCoords([coordinates.lat, coordinates.lng]);
    }
  };

  const activeIncidents = incidents.filter((incident) => incident.status !== 'Resolved');
  const activeShelters = shelters.filter((shelter) => shelter.status !== 'CLOSED' && shelter.status !== 'FULL');
  const activeResponders = responders.filter((responder) =>
    responder.verificationStatus === 'VERIFIED'
    && responder.location
    && Number.isFinite(Number(responder.location.lat))
    && Number.isFinite(Number(responder.location.lng))
  );
  const scopedRiskZones = riskZones.filter((zone) =>
    (!zone.state || zone.state.toLowerCase() === selectedState.toLowerCase())
    && (!zone.district || zone.district.toLowerCase() === selectedDistrict.toLowerCase())
  );

  return (
    <div className="map-view-container">
      <div className="role-banner banner-gp">
        <div className="banner-left">
          <span>🏛️ <strong>AUTHORITY OPERATIONS MAP</strong></span>
          <span className="live-badge">LIVE DATABASE LAYERS · REFRESHES EVERY 30 SECONDS</span>
        </div>
        <div className="banner-right">
          <span style={{ color: '#4338ca', fontSize: '0.8rem' }}>Showing registered operational data for {selectedDistrict}</span>
        </div>
      </div>

      <div className="map-location-bar" style={{
        padding: '12px 16px',
        backgroundColor: '#f8fafc',
        borderBottom: '1px solid #e2e8f0',
        display: 'flex',
        flexWrap: 'wrap',
        alignItems: 'center',
        gap: '16px',
        zIndex: 10
      }}>
        <div style={{ flex: '1 1 300px' }}>
          <LocationSelector
            selectedState={selectedState}
            selectedDistrict={selectedDistrict}
            onChange={handleLocationChange}
            showLabels={true}
            className="map-location-inputs"
          />
        </div>
        <div style={{ backgroundColor: '#eff6ff', border: '1px solid #bfdbfe', borderRadius: '8px', padding: '8px 14px', color: '#1e40af', fontSize: '0.85rem' }}>
          📍 <strong>{selectedDistrict}</strong>, {selectedState}
          {selectedCoords && <div style={{ fontSize: '0.75rem' }}>Map center: {selectedCoords[0].toFixed(4)}, {selectedCoords[1].toFixed(4)}</div>}
        </div>
      </div>

      {mapError && <div role="status" style={{ padding: '10px 16px', color: '#9a3412', background: '#fff7ed' }}>{mapError} Data shown may be incomplete.</div>}
      {loading && <div role="status" style={{ padding: '10px 16px' }}>Loading live operational data…</div>}

      <MapContainer center={selectedCoords} zoom={10} scrollWheelZoom className="leaflet-map-frame">
        <FixMapSize />
        <MapFlyTo center={selectedCoords} zoom={10} />
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />

        {selectedCoords && (
          <Marker position={selectedCoords} icon={createSelectedPin(selectedDistrict)}>
            <Popup><strong>{selectedDistrict}, {selectedState}</strong><br />District map center</Popup>
          </Marker>
        )}

        {scopedRiskZones.filter((zone) => Number.isFinite(Number(zone.lat)) && Number.isFinite(Number(zone.lng))).map((zone) => {
          const color = priorityColor(zone.riskLevel);
          return (
            <CircleMarker
              key={zone._id || zone.id}
              center={[Number(zone.lat), Number(zone.lng)]}
              radius={14}
              pathOptions={{ color, fillColor: color, fillOpacity: 0.35 }}
            >
              <Popup>
                <strong>Risk zone: {zone.name || zone.district || 'Registered area'}</strong>
                <br />Risk level: {zone.riskLevel || 'Unspecified'}
                {zone.populationAtRisk != null && <><br />Population at risk: {zone.populationAtRisk}</>}
              </Popup>
            </CircleMarker>
          );
        })}

        {activeShelters.filter((shelter) => Number.isFinite(Number(shelter.lat)) && Number.isFinite(Number(shelter.lng))).map((shelter) => (
          <Marker key={shelter._id || shelter.id} position={[Number(shelter.lat), Number(shelter.lng)]} icon={shelterIcon}>
            <Popup>
              <strong>🏠 {shelter.name}</strong>
              <br />Status: {shelter.status || 'Unknown'}
              <br />Available spaces: {shelter.availableSpaces ?? Math.max(0, (shelter.capacity || 0) - (shelter.currentOccupancy || 0))} / {shelter.capacity || 0}
              {shelter.address && <><br />{shelter.address}</>}
            </Popup>
          </Marker>
        ))}

        {activeResponders.map((responder) => (
          <Marker
            key={responder._id}
            position={[Number(responder.location.lat), Number(responder.location.lng)]}
          >
            <Popup><strong>{responder.name || responder.organizationName || 'Verified responder'}</strong><br />{responder.status || responder.activeStatus || 'Status unavailable'}</Popup>
          </Marker>
        ))}

        {activeIncidents.filter((incident) =>
          Number.isFinite(Number(incident.location?.lat)) && Number.isFinite(Number(incident.location?.lng))
        ).map((incident) => (
          <Marker
            key={incident._id || incident.clientIncidentId}
            position={[Number(incident.location.lat), Number(incident.location.lng)]}
            icon={needyIcon}
          >
            <Popup>
              <strong style={{ color: priorityColor(incident.priority) }}>🆘 {incident.type || 'Emergency'} · {incident.priority || 'Untriaged'}</strong>
              <br />{incident.village ? `${incident.village}, ` : ''}{incident.district || selectedDistrict}
              <br />Status: {incident.status || 'Pending'}
            </Popup>
          </Marker>
        ))}
      </MapContainer>

      <div className="map-legend">
        <h4>Operations · {selectedDistrict}</h4>
        <div className="legend-entry"><span className="legend-badge pin-blue">🏠</span><span>Open registered shelters</span></div>
        <div className="legend-entry"><span className="legend-badge pin-sos">🆘</span><span>Unresolved incidents</span></div>
        <div className="legend-entry"><span className="legend-badge pin-red">🟠</span><span>Database risk zones</span></div>
        <div className="legend-entry"><span className="legend-badge">🚑</span><span>Verified responders with coordinates</span></div>
        {!loading && !mapError && activeShelters.length + activeIncidents.length + scopedRiskZones.length + activeResponders.length === 0
          && <p>No registered operational data for this location yet.</p>}
      </div>
    </div>
  );
}
