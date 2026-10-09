import { useState, useEffect, useRef } from 'react';
import { MapContainer, TileLayer, Marker, Polyline, Popup, useMap } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';
import './maps.css';
import FixMapSize from './FixMapSize';
import L from 'leaflet';
import { SHELTERS } from '../../data/mockData';
import { userIcon, shelterIcon } from './MapIcons';
import { getRealRoadRoute } from '../../utils/routing';
import { findDistrictCoordinates } from '../../data/indiaLocations';
import { ALERT_AUDIO_SRC } from '../../config/audioConfig';

const DEFAULT_SHELTER = SHELTERS.find((s) => s.status === 'Open') || SHELTERS[0];

function AutoBounds({ points }) {
  const map = useMap();
  useEffect(() => {
    if (points && points.length > 0) {
      const bounds = L.latLngBounds(points);
      map.fitBounds(bounds, { padding: [50, 50], maxZoom: 14 });
    }
  }, [points, map]);
  return null;
}

// Length of a route in km (sum of straight segments between its points)
function routeLengthKm(points) {
  const toRad = (deg) => (deg * Math.PI) / 180;
  let total = 0;
  for (let i = 1; i < points.length; i++) {
    const [lat1, lng1] = points[i - 1];
    const [lat2, lng2] = points[i];
    const dLat = toRad(lat2 - lat1);
    const dLng = toRad(lng2 - lng1);
    const a =
      Math.sin(dLat / 2) ** 2 +
      Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
    total += 6371 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  }
  return total;
}

// shelter (optional): the shelter to route to; falls back to the demo shelter
// onRouteInfo (optional): called with { shelter, userPos, distanceKm } whenever the route changes
const UserMap = ({ shelter, onRouteInfo, state, district }) => {
  const target = shelter || DEFAULT_SHELTER;
  
  // Default position: lookup district or fallback
  const initialCoords = () => {
    const found = findDistrictCoordinates(district, state);
    return found ? [found.lat, found.lng] : [13.0032, 75.3340];
  };

  const [userPos, setUserPos] = useState(initialCoords);
  const [roadRoute, setRoadRoute] = useState([]);
  const [isLiveGPS, setIsLiveGPS] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);

  // Reference for the HTML5 audio instance
  const audioRef = useRef(null);

  useEffect(() => {
    let active = true;
    const found = findDistrictCoordinates(district, state);
    const locationTimer = setTimeout(() => {
      if (!active) return;
      if (found) {
        setUserPos([found.lat, found.lng]);
        setIsLiveGPS(false);
      } else if (navigator.geolocation) {
        navigator.geolocation.getCurrentPosition(
          (pos) => {
            if (!active) return;
            setUserPos([pos.coords.latitude, pos.coords.longitude]);
            setIsLiveGPS(true);
          },
          () => console.log('Using default district coordinate')
        );
      }
    }, 0);
    return () => {
      active = false;
      clearTimeout(locationTimer);
    };
  }, [district, state]);

  useEffect(() => {
    let active = true;
    getRealRoadRoute(userPos, [target.lat, target.lng]).then((path) => {
      if (active) setRoadRoute(path);
    });
    return () => { active = false; };
  }, [userPos, target.lat, target.lng]);

  // Tell the dashboard where the route goes and how long it is
  useEffect(() => {
    if (!onRouteInfo) return;
    const points = roadRoute.length > 1
      ? roadRoute
      : [userPos, [target.lat, target.lng]];
    onRouteInfo({
      shelter: target,
      userPos,
      distanceKm: routeLengthKm(points),
    });
  }, [roadRoute, userPos, onRouteInfo, target]);

  // Clean up audio playback when component unmounts
  useEffect(() => {
    return () => {
      if (audioRef.current) {
        audioRef.current.pause();
        audioRef.current = null;
      }
    };
  }, []);

  // Play/Stop MP3 Voice Guide
  const handleSpeakInstructions = () => {
    if (!audioRef.current) {
      audioRef.current = new Audio(ALERT_AUDIO_SRC);

      audioRef.current.onended = () => {
        setIsSpeaking(false);
      };

      audioRef.current.onerror = () => {
        setIsSpeaking(false);
        alert("Emergency voice file not found.");
      };
    }

    if (isSpeaking) {
      audioRef.current.pause();
      audioRef.current.currentTime = 0;
      setIsSpeaking(false);
    } else {
      audioRef.current.play()
        .then(() => setIsSpeaking(true))
        .catch((err) => {
          console.error("Audio playback error:", err);
          setIsSpeaking(false);
        });
    }
  };

  const boundingPoints = roadRoute.length > 0
    ? roadRoute
    : [userPos, [target.lat, target.lng]];

  return (
    <div className="map-view-container">
      <div className="role-banner banner-user">
        <div className="banner-left">
          <span>👤 <strong>VILLAGER EVACUATION ROUTE</strong></span>
          <span className={`status-pill ${isLiveGPS ? 'pill-active' : 'pill-sim'}`}>
            {isLiveGPS ? 'LIVE GPS ACTIVE' : `${district || 'LOCATION'} MODE`}
          </span>
        </div>
        <div className="banner-right">
          <button
            className={`voice-guide-btn ${isSpeaking ? 'voice-active' : ''}`}
            onClick={handleSpeakInstructions}
            type="button"
          >
            {isSpeaking ? '⏹️ Stop Voice Guide' : '🔊 Emergency Voice Guide'}
          </button>
          <span>Shelter: <strong>{target.name}</strong></span>
        </div>
      </div>

      <MapContainer center={userPos} zoom={12} scrollWheelZoom={true} className="leaflet-map-frame">
        <FixMapSize />
        <AutoBounds points={boundingPoints} />

        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />

        <Marker position={userPos} icon={userIcon}>
          <Popup>
            <div className="popup-card">
              <h4>📍 Current Location</h4>
              <p>{district ? `${district}${state ? `, ${state}` : ''}` : 'Villager Registration Point'}</p>
              <span className="coord-text">{userPos[0].toFixed(4)} N, {userPos[1].toFixed(4)} E</span>
            </div>
          </Popup>
        </Marker>

        {roadRoute.length > 0 && (
          <>
            <Polyline positions={roadRoute} pathOptions={{ color: '#1e3a8a', weight: 8, opacity: 0.35 }} />
            <Polyline positions={roadRoute} pathOptions={{ color: '#2563eb', weight: 5, opacity: 0.95 }} />
          </>
        )}

        <Marker position={[target.lat, target.lng]} icon={shelterIcon}>
          <Popup>
            <div className="popup-card">
              <h4>🏥 {target.name}</h4>
              <p>Status: <span className="status-badge open">{target.status}</span></p>
              <p>
                Places free:{' '}
                <strong>
                  {target.availableSpaces ?? Math.max(0, (target.capacity || 0) - (target.currentOccupancy || 0))}
                </strong>{' '}
                / {target.capacity}
              </p>
            </div>
          </Popup>
        </Marker>
      </MapContainer>

      {/* Compact User Legend */}
      <div className="map-legend">
        <h4>Evacuation Guide</h4>
        <div className="legend-entry">
          <span className="legend-badge pin-sky">👤</span>
          <span>Your Location ({district || 'District'})</span>
        </div>
        <div className="legend-entry">
          <span className="legend-line line-blue"></span>
          <span>Safe Route</span>
        </div>
        <div className="legend-entry">
          <span className="legend-badge pin-blue">🏥</span>
          <span>Designated Shelter</span>
        </div>
      </div>
    </div>
  );
};

export default UserMap;