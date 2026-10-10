import { useCallback, useEffect, useState } from 'react';
import { MapContainer, TileLayer, Marker, CircleMarker, Polyline, Popup, useMap } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';
import './maps.css';
import FixMapSize from './FixMapSize';
import { needyIcon, shelterIcon } from './MapIcons';
import { calculateDistanceKm } from '../../data/verifiedResources';
import { findDistrictCoordinates } from '../../data/indiaLocations';
import { apiFetch } from '../../api';
import { DEFAULT_STATE, DEFAULT_DISTRICT } from '../../config/locationConfig';

function MapFlyTo({ center, zoom = 11 }) {
  const map = useMap();
  useEffect(() => {
    if (center && Number.isFinite(center[0]) && Number.isFinite(center[1])) {
      map.flyTo(center, zoom, { duration: 1 });
    }
  }, [center, zoom, map]);
  return null;
}

export default function NgoMap({
  state = DEFAULT_STATE,
  district = DEFAULT_DISTRICT,
  ngoLocation = null,
  ngoName = 'Response organization',
  ngoStatus = 'Available',
  sosList = [],
  onAcceptSos
}) {
  const [shelters, setShelters] = useState([]);
  const [riskZones, setRiskZones] = useState([]);
  const [mapError, setMapError] = useState('');
  const [loading, setLoading] = useState(true);

  const districtCenter = findDistrictCoordinates(district, state);
  const mapCenter = districtCenter ? [districtCenter.lat, districtCenter.lng] : null;
  const liveNgoCoordinates = ngoLocation
    && Number.isFinite(Number(ngoLocation.lat))
    && Number.isFinite(Number(ngoLocation.lng))
    ? [Number(ngoLocation.lat), Number(ngoLocation.lng)]
    : null;
  const mapFocus = liveNgoCoordinates || mapCenter;

  const fetchLayers = useCallback(async () => {
    const query = `state=${encodeURIComponent(state)}&district=${encodeURIComponent(district)}`;
    const results = await Promise.allSettled([
      apiFetch(`/api/shelters?${query}`),
      apiFetch(`/api/risk-zones?${query}`)
    ]);
    const errors = [];
    if (results[0].status === 'fulfilled') {
      const records = Array.isArray(results[0].value) ? results[0].value : [];
      setShelters(records.filter((shelter) =>
        shelter.status === 'ACTIVE'
        && shelter.verified !== false
        && Number(shelter.availableSpaces) > 0
        && Number.isFinite(Number(shelter.lat))
        && Number.isFinite(Number(shelter.lng))
      ));
    } else errors.push('shelters');
    if (results[1].status === 'fulfilled') {
      setRiskZones(Array.isArray(results[1].value) ? results[1].value : []);
    } else errors.push('risk zones');
    setMapError(errors.length ? `Unable to refresh ${errors.join(' and ')}.` : '');
    setLoading(false);
  }, [state, district]);

  useEffect(() => {
    const initialLoad = setTimeout(fetchLayers, 0);
    const interval = setInterval(fetchLayers, 30000);
    return () => {
      clearTimeout(initialLoad);
      clearInterval(interval);
    };
  }, [fetchLayers]);

  const activeSos = sosList.filter((incident) => incident.status !== 'Resolved'
    && (!incident.state || incident.state.toLowerCase() === state.toLowerCase())
    && (!incident.district || incident.district.toLowerCase() === district.toLowerCase()));
  const locatedIncidents = activeSos.filter((incident) =>
    Number.isFinite(Number(incident.location?.lat))
    && Number.isFinite(Number(incident.location?.lng))
  );
  const sosRoutes = liveNgoCoordinates ? locatedIncidents.map((incident) => ({
    incident,
    coords: [Number(incident.location.lat), Number(incident.location.lng)],
    distanceKm: calculateDistanceKm(liveNgoCoordinates, [
      Number(incident.location.lat),
      Number(incident.location.lng)
    ])
  })) : [];
  const scopedRiskZones = riskZones.filter((zone) =>
    (!zone.state || zone.state.toLowerCase() === state.toLowerCase())
    && (!zone.district || zone.district.toLowerCase() === district.toLowerCase())
    && Number.isFinite(Number(zone.lat))
    && Number.isFinite(Number(zone.lng))
  );

  if (!mapFocus) {
    return (
      <div className="map-view-container" role="status" style={{ padding: 24 }}>
        No verified map center is available for {district}, {state}. Select a supported district or provide the responder's current GPS position.
      </div>
    );
  }

  return (
    <div className="map-view-container">
      <div className="role-banner banner-ngo">
        <div className="banner-left">
          <span>🚑 <strong>NGO OPERATIONS MAP</strong></span>
          <span className="live-badge">LIVE DATA · {district.toUpperCase()}, {state.toUpperCase()}</span>
        </div>
        <div className="banner-right">
          <span>Status: <strong>{ngoStatus.toUpperCase()}</strong></span>
          <span>{liveNgoCoordinates ? 'Current responder position available' : 'Responder position not shared'}</span>
        </div>
      </div>

      {mapError && <div role="status" style={{ padding: '10px 16px', color: '#9a3412', background: '#fff7ed' }}>{mapError}</div>}
      {loading && <div role="status" style={{ padding: '10px 16px' }}>Loading operational map data…</div>}

      <MapContainer center={mapFocus} zoom={11} scrollWheelZoom className="leaflet-map-frame">
        <FixMapSize />
        <MapFlyTo center={mapFocus} zoom={11} />
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />

        {liveNgoCoordinates && (
          <Marker position={liveNgoCoordinates}>
            <Popup>
              <strong>{ngoName}</strong>
              <br />Reported current location · {ngoStatus}
            </Popup>
          </Marker>
        )}

        {shelters.map((shelter) => {
          const shelterPosition = [Number(shelter.lat), Number(shelter.lng)];
          const distance = liveNgoCoordinates ? calculateDistanceKm(liveNgoCoordinates, shelterPosition) : null;
          return (
            <Marker key={shelter._id || shelter.id} position={shelterPosition} icon={shelterIcon}>
              <Popup>
                <strong>🏠 {shelter.name}</strong>
                <br />{shelter.type || 'Shelter'} · {shelter.status}
                <br />Available: {shelter.availableSpaces} / {shelter.capacity}
                {distance !== null && <><br />{distance.toFixed(1)} km from current responder location</>}
              </Popup>
            </Marker>
          );
        })}

        {locatedIncidents.map((incident) => (
          <Marker
            key={incident._id || incident.clientIncidentId}
            position={[Number(incident.location.lat), Number(incident.location.lng)]}
            icon={needyIcon}
          >
            <Popup>
              <strong style={{ color: '#dc2626' }}>🆘 {incident.type || 'Emergency'} · {incident.priority || 'Untriaged'}</strong>
              <br />{incident.village ? `${incident.village}, ` : ''}{incident.district || district}
              <br />Status: {incident.status || 'Pending'}
              {onAcceptSos && incident.status === 'Pending' && (
                <button type="button" onClick={() => onAcceptSos(incident._id || incident.id || incident.clientIncidentId)}>
                  Accept dispatch
                </button>
              )}
            </Popup>
          </Marker>
        ))}

        {sosRoutes.map(({ incident, coords, distanceKm }) => (
          <Polyline
            key={`route-${incident._id || incident.clientIncidentId}`}
            positions={[liveNgoCoordinates, coords]}
            pathOptions={{ color: '#dc2626', weight: 3, dashArray: '8, 8', opacity: 0.8 }}
          >
            <Popup>{distanceKm.toFixed(1)} km straight-line distance to reported incident</Popup>
          </Polyline>
        ))}

        {scopedRiskZones.map((zone) => (
          <CircleMarker
            key={zone._id || zone.id}
            center={[Number(zone.lat), Number(zone.lng)]}
            radius={14}
            pathOptions={{ color: '#dc2626', fillColor: '#dc2626', fillOpacity: 0.35 }}
          >
            <Popup>{zone.village || zone.district || 'Registered risk zone'} · {zone.riskLevel || 'Risk area'}</Popup>
          </CircleMarker>
        ))}
      </MapContainer>

      <div className="map-legend">
        <h4>NGO Operations · {district}</h4>
        <div className="legend-entry"><span className="legend-badge pin-sos">🆘</span><span>Unresolved incidents with coordinates</span></div>
        <div className="legend-entry"><span className="legend-badge pin-blue">🏠</span><span>Open verified shelters with available spaces</span></div>
        <div className="legend-entry"><span className="legend-badge pin-red">🟠</span><span>Registered risk zones</span></div>
        {!liveNgoCoordinates && <p>Set a current GPS location to show responder distance and routes. The district center is only the map viewport.</p>}
        {!loading && shelters.length === 0 && <p>No verified open shelters with available space are registered for this district.</p>}
        {!loading && locatedIncidents.length === 0 && <p>No unresolved incidents with coordinates are registered for this district.</p>}
      </div>
    </div>
  );
}
