// src/utils/routing.js
export async function getRealRoadRoute(startCoords, endCoords) {
  try {
    // OSRM Public Driving API (lng,lat order)
    const url = `https://router.project-osrm.org/route/v1/driving/${startCoords[1]},${startCoords[0]};${endCoords[1]},${endCoords[0]}?overview=full&geometries=geojson`;
    const res = await fetch(url);
    const data = await res.json();

    if (data.routes && data.routes.length > 0) {
      // OSRM returns [lng, lat], Leaflet needs [lat, lng]
      return data.routes[0].geometry.coordinates.map(([lng, lat]) => [lat, lng]);
    }
    return [startCoords, endCoords]; // fallback straight line if network offline
  } catch (error) {
    console.warn("Routing API unavailable, using direct fallback:", error);
    return [startCoords, endCoords];
  }
}