import { useState, useEffect } from 'react';
import { MapContainer, TileLayer, CircleMarker, Marker, Popup, useMapEvents, useMap } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';
import './maps.css';
import FixMapSize from './FixMapSize';
import L from 'leaflet';
import { ALL_VILLAGE_ZONES, NEEDY_PEOPLE, NGO_TEAMS } from '../../data/mockData';
import { ngoIcon, needyIcon, shelterIcon } from './MapIcons';
import LocationSelector from '../LocationSelector';
import { getDistrictCoordinates } from '../../data/indiaLocations';
import { getVerifiedShelters, filterByLocation } from '../../data/verifiedResources';

const RED_DISPATCH_ROUTE = [
  [12.9850, 75.2600],
  [12.9910, 75.2830],
  [12.9995, 75.3050],
  [13.0110, 75.3280],
  [13.0210, 75.3420],
  [13.0280, 75.3550]
];

const getRiskColor = (level) => {
  switch (level?.toLowerCase()) {
    case 'critical': return '#991b1b';
    case 'high':     return '#dc2626';
    case 'moderate': return '#d97706';
    default:         return '#16a34a';
  }
};

function MapFlyTo({ center, zoom = 10 }) {
  const map = useMap();
  useEffect(() => {
    if (center && Number.isFinite(center[0]) && Number.isFinite(center[1])) {
      map.flyTo(center, zoom, { duration: 1.5 });
    }
  }, [center, zoom, map]);
  return null;
}

function ClickToAddDistress({ onNewSOS, state, district }) {
  useMapEvents({
    click(e) {
      onNewSOS({
        id: `sos-${Date.now()}`,
        groupName: `Live SOS (${district || 'Local'})`,
        state,
        district,
        lat: e.latlng.lat,
        lng: e.latlng.lng,
        urgency: "Immediate Disaster Rescue Required"
      });
    }
  });
  return null;
}

const createSelectedPin = (districtName) => {
  return L.divIcon({
    className: 'custom-district-pin-wrapper',
    html: `
      <div style="
        background: linear-gradient(135deg, #1e3a8a, #3b82f6);
        color: #ffffff;
        padding: 6px 14px;
        border-radius: 20px;
        font-weight: 700;
        font-size: 13px;
        border: 2px solid #ffffff;
        box-shadow: 0 4px 12px rgba(0,0,0,0.35);
        display: flex;
        align-items: center;
        gap: 6px;
        white-space: nowrap;
        transform: translate(-50%, -100%);
      ">
        <span>📍</span>
        <span>${districtName}</span>
      </div>
    `,
    iconSize: [0, 0],
    iconAnchor: [0, 0]
  });
};

const GramPanchayatMap = ({ initialPropsState = "", initialPropsDistrict = "" }) => {
  const [selectedState, setSelectedState] = useState(initialPropsState || "Uttarakhand");
  const [selectedDistrict, setSelectedDistrict] = useState(initialPropsDistrict || "Dehradun");
  const [selectedCoords, setSelectedCoords] = useState(() => {
    const coords = getDistrictCoordinates(
      initialPropsState || "Uttarakhand",
      initialPropsDistrict || "Dehradun"
    );
    return coords ? [coords.lat, coords.lng] : [30.3165, 78.0322];
  });

  const [distressList, setDistressList] = useState(NEEDY_PEOPLE);
  const [liveNgoPos, setLiveNgoPos] = useState(RED_DISPATCH_ROUTE[0]);

  useEffect(() => {
    if (selectedState === "Karnataka") {
      let idx = 0;
      const interval = setInterval(() => {
        idx = (idx + 1) % RED_DISPATCH_ROUTE.length;
        setLiveNgoPos(RED_DISPATCH_ROUTE[idx]);
      }, 1500);
      return () => clearInterval(interval);
    }
  }, [selectedState]);

  const handleLocationChange = ({ state, district, coordinates }) => {
    setSelectedState(state);
    setSelectedDistrict(district);
    if (coordinates && Number.isFinite(coordinates.lat) && Number.isFinite(coordinates.lng)) {
      setSelectedCoords([coordinates.lat, coordinates.lng]);
    }
  };

  // Location-aware filtering
  const filteredRiskZones = filterByLocation(ALL_VILLAGE_ZONES, selectedState, selectedDistrict);
  const isKarnataka = selectedState === "Karnataka";
  const verifiedShelters = getVerifiedShelters(selectedState, selectedDistrict);
  const filteredNgoTeams = isKarnataka ? NGO_TEAMS : [];
  const filteredDistress = filterByLocation(distressList, selectedState, selectedDistrict);

  return (
    <div className="map-view-container">
      <div className="role-banner banner-gp">
        <div className="banner-left">
          <span>🏛️ <strong>COMMAND CENTER RISK MAP</strong></span>
          <span className="live-badge">INDIA-WIDE DISASTER MONITOR</span>
        </div>
        <div className="banner-right">
          <span style={{ color: '#4338ca', fontSize: '0.8rem' }}>💡 Click map to add live SOS in {selectedDistrict}</span>
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

        {selectedDistrict && selectedState && selectedCoords && (
          <div style={{
            backgroundColor: '#eff6ff',
            border: '1px solid #bfdbfe',
            borderRadius: '8px',
            padding: '8px 14px',
            color: '#1e40af',
            fontSize: '0.85rem',
            fontWeight: '600'
          }}>
            📍 <strong>{selectedDistrict}</strong>, {selectedState}
            <div style={{ fontSize: '0.75rem', color: '#3b82f6', fontWeight: '400' }}>
              Lat: {selectedCoords[0].toFixed(4)}, Lng: {selectedCoords[1].toFixed(4)}
            </div>
          </div>
        )}
      </div>

      <MapContainer center={selectedCoords} zoom={10} scrollWheelZoom={true} className="leaflet-map-frame">
        <FixMapSize />
        <MapFlyTo center={selectedCoords} zoom={10} />
        <ClickToAddDistress
          state={selectedState}
          district={selectedDistrict}
          onNewSOS={(newSOS) => setDistressList((prev) => [...prev, newSOS])}
        />

        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />

        {selectedDistrict && selectedCoords && (
          <Marker position={selectedCoords} icon={createSelectedPin(selectedDistrict)}>
            <Popup>
              <div className="popup-card">
                <h4>📍 {selectedDistrict}</h4>
                <p>State: <strong>{selectedState}</strong></p>
                <p>Center: {selectedCoords[0].toFixed(4)}° N, {selectedCoords[1].toFixed(4)}° E</p>
                <span className="status-badge open">Active District Focus</span>
              </div>
            </Popup>
          </Marker>
        )}

        {/* Risk Zones */}
        {filteredRiskZones.map((zone) => (
          <CircleMarker
            key={`gp-${zone.id}`}
            center={[zone.lat, zone.lng]}
            radius={18}
            pathOptions={{ color: getRiskColor(zone.riskLevel), fillColor: getRiskColor(zone.riskLevel), fillOpacity: 0.6 }}
          >
            <Popup>
              <div className="popup-card">
                <h4>⚠️ {zone.name}</h4>
                <p>Risk: <strong>{zone.riskLevel}</strong></p>
                <p>Citizens at Risk: {zone.populationAtRisk}</p>
              </div>
            </Popup>
          </CircleMarker>
        ))}

        {/* Verified Public Shelters & Emergency Centers */}
        {verifiedShelters.map((s) => (
          <Marker key={s.id} position={[s.latitude, s.longitude]} icon={shelterIcon}>
            <Popup>
              <div className="popup-card">
                <h4>🏠 {s.name}</h4>
                <p>Type: <strong>{s.type}</strong></p>
                <p>Location: {s.district}, {s.state}</p>
                <p>Capacity: {Math.max(0, s.capacity - s.currentOccupancy)} / {s.capacity} beds available</p>
                <div style={{ marginTop: '6px', fontSize: '0.75rem', color: '#166534' }} title="Verified by Sahayta Setu's authorized platform administrator">
                  {s.verified ? '✓ Verified Resource' : 'Community Facility'}
                  {s.source && <div>Source: {s.source}</div>}
                </div>
              </div>
            </Popup>
          </Marker>
        ))}

        {/* NGO Units */}
        {filteredNgoTeams.map((team) => (
          <Marker key={team.id} position={liveNgoPos} icon={ngoIcon}>
            <Popup>
              <div className="popup-card">
                <h4>🚐 {team.name}</h4>
                <p>Status: <strong>Active Rescue Unit</strong></p>
                <p>Contact: {team.contact}</p>
              </div>
            </Popup>
          </Marker>
        ))}

        {/* Active SOS Distress */}
        {filteredDistress.map((needy) => (
          <Marker key={needy.id} position={[needy.lat, needy.lng]} icon={needyIcon}>
            <Popup>
              <div className="popup-card">
                <h4 style={{ color: '#dc2626' }}>🆘 {needy.groupName}</h4>
                <p>Urgency: {needy.urgency}</p>
                <p>District: {needy.district || selectedDistrict}</p>
              </div>
            </Popup>
          </Marker>
        ))}
      </MapContainer>

      <div className="map-legend">
        <h4>Command Center ({selectedDistrict})</h4>

        {selectedDistrict && (
          <div className="legend-entry">
            <span className="legend-badge pin-blue">📍</span>
            <span>{selectedDistrict} ({selectedState})</span>
          </div>
        )}

        <div className="legend-section-title">Verified Resources</div>
        <div className="legend-entry">
          <span className="legend-badge pin-blue">🏠</span>
          <span>Public Relief & Emergency Shelter</span>
        </div>
        <div className="legend-entry">
          <span className="legend-badge pin-sos">🆘</span>
          <span>Active SOS Incident</span>
        </div>
        {filteredNgoTeams.length > 0 && (
          <div className="legend-entry">
            <span className="legend-badge pin-red">🚐</span>
            <span>NGO Rescue Unit</span>
          </div>
        )}
      </div>
    </div>
  );
};

export default GramPanchayatMap;