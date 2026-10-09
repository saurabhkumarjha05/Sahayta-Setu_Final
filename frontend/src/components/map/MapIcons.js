import L from 'leaflet';

export const shelterIcon = L.divIcon({
  className: 'custom-map-icon',
  html: `<div class="badge-pin pin-blue">🏠</div>`,
  iconSize: [36, 36],
  iconAnchor: [18, 36],
  popupAnchor: [0, -36]
});

export const medicalIcon = L.divIcon({
  className: 'custom-map-icon',
  html: `<div class="badge-pin pin-red">🏥</div>`,
  iconSize: [36, 36],
  iconAnchor: [18, 36],
  popupAnchor: [0, -36]
});

export const reliefIcon = L.divIcon({
  className: 'custom-map-icon',
  html: `<div class="badge-pin pin-green">📦</div>`,
  iconSize: [36, 36],
  iconAnchor: [18, 36],
  popupAnchor: [0, -36]
});

export const userIcon = L.divIcon({
  className: 'custom-map-icon',
  html: `<div class="badge-pin pin-sky anim-marker-pulse">👤</div>`,
  iconSize: [36, 36],
  iconAnchor: [18, 36],
  popupAnchor: [0, -36]
});

export const nearestIcon = L.divIcon({
  className: 'custom-map-icon',
  html: `<div class="badge-pin pin-blue anim-marker-pulse">⭐</div>`,
  iconSize: [40, 40],
  iconAnchor: [20, 40],
  popupAnchor: [0, -40]
});

export const ngoIcon = L.divIcon({
  className: 'custom-map-icon',
  html: `<div class="badge-pin pin-red">🛡️</div>`,
  iconSize: [36, 36],
  iconAnchor: [18, 36],
  popupAnchor: [0, -36]
});

export const needyIcon = L.divIcon({
  className: 'custom-map-icon',
  html: `<div class="badge-pin pin-sos anim-sos-idle">🆘</div>`,
  iconSize: [38, 38],
  iconAnchor: [19, 38],
  popupAnchor: [0, -38]
});