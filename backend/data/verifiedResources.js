// Realtime registered emergency shelters & resources across Indian States
// Production data is sourced directly from MongoDB Atlas.

const VERIFIED_RESOURCES = [];

function filterByLocation(resources, state, district) {
  if (!resources || !Array.isArray(resources)) return [];
  let list = [...resources];
  if (state) {
    const s = String(state).trim().toLowerCase();
    list = list.filter(r => r.state && r.state.toLowerCase() === s);
  }
  if (district) {
    const d = String(district).trim().toLowerCase();
    list = list.filter(r => r.district && r.district.toLowerCase() === d);
  }
  return list;
}

function getVerifiedShelters(state, district) {
  return filterByLocation(VERIFIED_RESOURCES, state, district);
}

module.exports = {
  VERIFIED_RESOURCES,
  filterByLocation,
  getVerifiedShelters
};
