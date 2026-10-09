const NGO = require('../models/ngo');
const VerifiedEntity = require('../models/verifiedEntity');
const SOS = require('../models/sos');

/**
 * Calculate distance between two coordinates in kilometers using Haversine formula
 */
function calculateDistanceKm(coord1, coord2) {
  if (!coord1 || !coord2) return Infinity;
  const lat1 = Number(coord1.lat !== undefined ? coord1.lat : (Array.isArray(coord1) ? coord1[0] : coord1.latitude));
  const lon1 = Number(coord1.lng !== undefined ? coord1.lng : (Array.isArray(coord1) ? coord1[1] : coord1.longitude));
  const lat2 = Number(coord2.lat !== undefined ? coord2.lat : (Array.isArray(coord2) ? coord2[0] : coord2.latitude));
  const lon2 = Number(coord2.lng !== undefined ? coord2.lng : (Array.isArray(coord2) ? coord2[1] : coord2.longitude));

  if (!Number.isFinite(lat1) || !Number.isFinite(lon1) || !Number.isFinite(lat2) || !Number.isFinite(lon2)) {
    return Infinity;
  }

  const R = 6371; // Earth's radius in km
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return Number((R * c).toFixed(2));
}

/**
 * Check if responder capabilities match the incident type or required capabilities
 */
function matchesCapability(responderServices = [], incidentType = 'Medical', requiredCaps = []) {
  const combinedServices = [
    ...(Array.isArray(responderServices) ? responderServices : [])
  ].map((s) => String(s).toLowerCase());

  if (combinedServices.length === 0) return true;

  // If specific required capabilities are requested by Panchayat triage
  if (Array.isArray(requiredCaps) && requiredCaps.length > 0) {
    const requiredLower = requiredCaps.map((c) => String(c).toLowerCase());
    const matchesRequired = requiredLower.some((req) =>
      combinedServices.some((serv) => serv.includes(req) || req.includes(serv))
    );
    if (matchesRequired) return true;
  }

  const typeLower = String(incidentType).toLowerCase();
  if (typeLower === 'medical' || typeLower === 'medical emergency') {
    return combinedServices.some((s) =>
      s.includes('medic') || s.includes('first aid') || s.includes('hospital') || s.includes('ambulance') || s.includes('rescue')
    );
  }
  if (typeLower.includes('flood')) {
    return combinedServices.some((s) =>
      s.includes('rescue') || s.includes('boat') || s.includes('flood') || s.includes('evac') || s.includes('shelter') || s.includes('food')
    );
  }
  if (typeLower.includes('landslide')) {
    return combinedServices.some((s) =>
      s.includes('rescue') || s.includes('heavy') || s.includes('search') || s.includes('clearance')
    );
  }
  if (typeLower.includes('fire')) {
    return combinedServices.some((s) => s.includes('fire') || s.includes('rescue') || s.includes('evac'));
  }
  if (typeLower.includes('cyclone') || typeLower.includes('storm')) {
    return combinedServices.some((s) => s.includes('evac') || s.includes('shelter') || s.includes('rescue'));
  }
  if (typeLower.includes('evac') || typeLower.includes('building')) {
    return combinedServices.some((s) => s.includes('evac') || s.includes('rescue') || s.includes('transport'));
  }

  return true;
}

/**
 * Match and rank the nearest suitable responders for a given SOS incident
 * Applies distance from real SOS location, availability, capability matching, and load balancing
 */
async function matchNearestResponders(sos, ngosList = null, activeSosList = null) {
  const sosLocation = sos.location || { lat: sos.latitude || sos.lat, lng: sos.longitude || sos.lng };
  const hasValidSosCoords = sosLocation && Number.isFinite(sosLocation.lat) && Number.isFinite(sosLocation.lng);

  // Fetch responders if not provided
  let responders = ngosList;
  if (!responders) {
    try {
      const dbNgos = await NGO.find({
        verificationStatus: 'VERIFIED',
        status: { $nin: ['Offline', 'SUSPENDED', 'REVOKED', 'REJECTED'] }
      });
      const dbEntities = await VerifiedEntity.find({
        organizationType: { $in: ['NGO', 'VOLUNTEER_TEAM'] },
        verificationStatus: 'VERIFIED',
        status: { $nin: ['SUSPENDED', 'REVOKED', 'REJECTED'] },
        activeStatus: { $ne: 'OFFLINE' }
      });

      const mergedMap = new Map();
      dbNgos.forEach(n => mergedMap.set(String(n._id), n));
      dbEntities.forEach(e => {
        const id = String(e._id);
        if (!mergedMap.has(id)) {
          mergedMap.set(id, {
            _id: e._id,
            name: e.organizationName || e.name,
            contactPerson: e.representativeName,
            phone: e.phone,
            email: e.email,
            district: e.district,
            state: e.state,
            location: e.location,
            services: e.capabilities || [],
            capabilities: e.capabilities || [],
            status: e.activeStatus === 'AVAILABLE' ? 'Available' : (e.activeStatus === 'BUSY' ? 'Busy' : 'Available'),
            verificationStatus: e.verificationStatus || 'VERIFIED',
            verificationLabel: e.verificationLabel || 'SAHAYTA SETU VERIFIED'
          });
        }
      });
      responders = Array.from(mergedMap.values());
    } catch {
      responders = [];
    }
  }

  // Filter to verified and active responders only (strictly exclude revoked/suspended/offline/rejected/pending)
  const availableResponders = (responders || []).filter((r) => {
    const status = String(r.status || r.activeStatus || (r.available ? 'Available' : 'Offline')).toLowerCase();
    const verification = String(r.verificationStatus || r.status || 'VERIFIED').toUpperCase();
    return status !== 'offline' && verification === 'VERIFIED';
  });

  if (availableResponders.length === 0) {
    return [];
  }

  // Count active assignments per responder for smart load balancing
  const assignmentCounts = new Map();
  if (activeSosList) {
    activeSosList.forEach((item) => {
      if (item.status === 'In Progress' && item.assignedTo) {
        const id = String(item.assignedTo._id || item.assignedTo);
        assignmentCounts.set(id, (assignmentCounts.get(id) || 0) + 1);
      }
    });
  } else {
    try {
      const activeIncidents = await SOS.find({ status: 'In Progress' }).select('assignedTo');
      activeIncidents.forEach((item) => {
        if (item.assignedTo) {
          const id = String(item.assignedTo._id || item.assignedTo);
          assignmentCounts.set(id, (assignmentCounts.get(id) || 0) + 1);
        }
      });
    } catch {
      // In-memory or fallback
    }
  }

  // Score each responder based on real SOS location & capabilities
  const ranked = availableResponders.map((responder) => {
    const responderPos = responder.location || { lat: responder.lat || responder.latitude, lng: responder.lng || responder.longitude };
    const hasResponderCoords = responderPos && Number.isFinite(responderPos.lat) && Number.isFinite(responderPos.lng);

    let distanceKm = Infinity;
    if (hasValidSosCoords && hasResponderCoords) {
      distanceKm = calculateDistanceKm(sosLocation, responderPos);
    } else if (responder.district && sos.district && responder.district.toLowerCase() === sos.district.toLowerCase()) {
      // Same district fallback distance if GPS is not yet beaconed
      distanceKm = 5.0;
    }

    const activeAssignments = assignmentCounts.get(String(responder._id)) || 0;
    const services = responder.services || responder.capabilities || [];
    const capabilityFit = matchesCapability(
      services,
      sos.type || sos.incidentType,
      sos.requiredCapabilities
    );

    // Load-balancing & matching score: lower score is ranked higher
    // 1. Distance penalty (+1.0 per km, or +50 if distance is unknown outside district)
    // 2. Active assignments workload penalty (+15.0 per active mission)
    // 3. Capability match bonus (-10.0 if specialist service matches incident)
    // 4. District jurisdiction bonus (-5.0 if in same district)
    let score = (distanceKm !== Infinity ? distanceKm * 1.0 : 50.0) + (activeAssignments * 15.0);
    if (capabilityFit) score -= 10;
    if (responder.district && sos.district && responder.district.toLowerCase() === sos.district.toLowerCase()) {
      score -= 5;
    }

    return {
      responder: {
        _id: String(responder._id),
        name: responder.name || responder.organizationName || 'Response Team',
        contactPerson: responder.contactPerson || responder.representativeName,
        phone: responder.phone,
        email: responder.email,
        district: responder.district,
        state: responder.state,
        location: hasResponderCoords ? responderPos : null,
        services,
        capabilities: services,
        resourceType: responder.resourceType || 'rescue_team',
        status: responder.status || 'Available',
        verificationStatus: responder.verificationStatus || 'VERIFIED',
        verificationLabel: responder.verificationLabel || 'SAHAYTA SETU VERIFIED'
      },
      distanceKm: distanceKm !== Infinity ? distanceKm : 0,
      hasExactDistance: distanceKm !== Infinity,
      activeAssignments,
      capabilityFit,
      score: Number(score.toFixed(2)),
      estimatedArrivalMin: (distanceKm !== Infinity && distanceKm > 0) ? Math.max(2, Math.round((distanceKm / 35) * 60)) : null
    };
  });

  // Sort by score ascending (lowest score = highest priority / best recommendation)
  ranked.sort((a, b) => a.score - b.score);
  return ranked;
}

module.exports = {
  calculateDistanceKm,
  matchesCapability,
  matchNearestResponders
};
