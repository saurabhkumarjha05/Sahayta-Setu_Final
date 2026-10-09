// Realtime verified emergency shelters, relief facilities, and emergency resources
// Sourced purely from real data returned by the backend API.

export const VERIFIED_RESOURCES = [];

// Helper: Calculate distance in km between two [lat, lng] points (Haversine)
export function calculateDistanceKm([lat1, lng1], [lat2, lng2]) {
  if (
    !Number.isFinite(Number(lat1)) ||
    !Number.isFinite(Number(lng1)) ||
    !Number.isFinite(Number(lat2)) ||
    !Number.isFinite(Number(lng2))
  ) {
    return null;
  }
  const toRad = (deg) => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return 6371 * c;
}

// Helper: Filter items (shelters, NGOs, SOS, hazard zones) by State & District
export function filterByLocation(items, selectedState, selectedDistrict) {
  if (!items || !Array.isArray(items)) return [];

  const sLower = String(selectedState || '').trim().toLowerCase();
  const dLower = String(selectedDistrict || '').trim().toLowerCase();

  if (!sLower && !dLower) return items;

  return items.filter((item) => {
    const itemState = String(item.state || '').trim().toLowerCase();
    const itemDist = String(item.district || '').trim().toLowerCase();

    // 1. State matching
    if (sLower && itemState) {
      if (itemState !== sLower) return false;
    }

    // 2. District matching (if district specified)
    if (dLower && itemDist) {
      if (itemDist !== dLower) return false;
    }

    return true;
  });
}

// Helper: Get verified shelters for state and district
export function getVerifiedShelters(selectedState, selectedDistrict) {
  return filterByLocation(VERIFIED_RESOURCES, selectedState, selectedDistrict);
}
