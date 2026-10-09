import { useEffect } from "react";
import { MapContainer, Marker, TileLayer } from "react-leaflet";
import "leaflet/dist/leaflet.css";
import "./map/maps.css";
import FixMapSize from "./map/FixMapSize";
import { needyIcon } from "./map/MapIcons";

// Shows where an SOS came from, who sent it, and buttons to navigate there.
function LocationModal({ sos, onClose }) {
  const { lat, lng } = sos.location || {};
  const hasLocation = Number.isFinite(lat) && Number.isFinite(lng);

  // Close with the Escape key
  useEffect(() => {
    const handleKey = (event) => event.key === "Escape" && onClose();
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [onClose]);

  return (
    <div className="sos-modal-overlay" onClick={onClose}>
      <div
        className="sos-modal loc-modal"
        role="dialog"
        aria-modal="true"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="sos-modal-header">
          <div>
            <p className="sos-modal-label">SOS LOCATION</p>
            <h3>
              {sos.type || "Emergency"} · {sos.village || "Unknown village"}
            </h3>
          </div>

          <button type="button" className="sos-modal-close" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>

        {hasLocation ? (
          <div className="loc-modal-map map-view-container">
            <MapContainer center={[lat, lng]} zoom={14} scrollWheelZoom className="leaflet-map-frame">
              <FixMapSize />
              <TileLayer
                attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
                url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
              />
              <Marker position={[lat, lng]} icon={needyIcon} />
            </MapContainer>
          </div>
        ) : (
          <p className="sos-modal-message">This SOS was sent without a location.</p>
        )}

        <div className="loc-modal-info">
          <div>
            <small>CONTACT</small>
            <strong>{sos.contactName || "Not shared"}</strong>
            {sos.contactPhone && <a href={`tel:${sos.contactPhone}`}>📞 {sos.contactPhone}</a>}
          </div>

          {hasLocation && (
            <div>
              <small>COORDINATES</small>
              <strong>
                {lat.toFixed(5)}, {lng.toFixed(5)}
              </strong>
            </div>
          )}
        </div>

        {hasLocation && (
          <div className="loc-modal-actions">
            <a
              className="cc-secondary-btn"
              href={`https://www.google.com/maps?q=${lat},${lng}`}
              target="_blank"
              rel="noreferrer"
            >
              Open in Google Maps
            </a>
            <a
              className="cc-primary-btn"
              href={`https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}&travelmode=driving`}
              target="_blank"
              rel="noreferrer"
            >
              🧭 Get directions
            </a>
          </div>
        )}
      </div>
    </div>
  );
}

export default LocationModal;
