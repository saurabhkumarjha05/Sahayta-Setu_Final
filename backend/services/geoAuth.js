/**
 * Strict Location-Based Authority Access Control & Geo-Fencing Service
 * Enforces geographic jurisdiction and privacy masking at the backend level.
 * Prefers stored codes (stateCode, districtCode, blockCode, panchayatId) with string fallback.
 */

/**
 * Checks whether an authenticated user has jurisdiction over a target location
 * @param {Object} user - The user object from req.user
 * @param {Object} target - { state, district, village, stateCode, districtCode, blockCode, panchayatId }
 * @returns {{ allowed: boolean, reason?: string }}
 */
function verifyJurisdiction(user, target = {}) {
  if (!user) {
    return { allowed: false, reason: 'Authentication required' };
  }

  // Super admin / National authority has national scope
  if (user.role === 'super_admin' || user.role === 'national_control') {
    return { allowed: true };
  }

  const userRole = user.role;

  // Code preferences
  const userStateCode = user.stateCode ? String(user.stateCode).trim().toUpperCase() : null;
  const userDistrictCode = user.districtCode ? String(user.districtCode).trim().toUpperCase() : null;
  const userBlockCode = user.blockCode ? String(user.blockCode).trim().toUpperCase() : null;
  const userPanchayatId = user.panchayatId ? String(user.panchayatId).trim().toUpperCase() : null;

  const targetStateCode = target.stateCode ? String(target.stateCode).trim().toUpperCase() : null;
  const targetDistrictCode = target.districtCode ? String(target.districtCode).trim().toUpperCase() : null;
  const targetBlockCode = target.blockCode ? String(target.blockCode).trim().toUpperCase() : null;
  const targetPanchayatId = target.panchayatId ? String(target.panchayatId).trim().toUpperCase() : null;

  // Legacy string fallbacks
  const userDistrict = user.district ? String(user.district).trim().toLowerCase() : null;
  const userState = user.state ? String(user.state).trim().toLowerCase() : null;

  const targetDistrict = target.district ? String(target.district).trim().toLowerCase() : null;
  const targetState = target.state ? String(target.state).trim().toLowerCase() : null;

  // 1. State Authority
  if (userRole === 'state_authority') {
    if (userStateCode && targetStateCode && userStateCode !== targetStateCode) {
      return {
        allowed: false,
        reason: `Access forbidden: Scope restricted to state ${user.stateCode || user.state}. Target state is ${target.stateCode || target.state}.`
      };
    }
    if (userState && targetState && targetState !== userState) {
      return {
        allowed: false,
        reason: `Access forbidden: Scope restricted to ${user.state}. Target state is ${target.state}.`
      };
    }
    return { allowed: true };
  }

  // 2. Gram Panchayat / Local Control Centre / District Authority
  if (userRole === 'control' || userRole === 'panchayat' || userRole === 'district_authority') {
    // If checking specific Panchayat jurisdiction
    if (userRole === 'panchayat' && userPanchayatId && targetPanchayatId && userPanchayatId !== targetPanchayatId) {
      return {
        allowed: false,
        reason: `Access forbidden: You do not have jurisdiction over Panchayat ${target.panchayatId}. Authorized Panchayat is ${user.panchayatId}.`
      };
    }

    // Code comparison for district
    if (userDistrictCode && targetDistrictCode && userDistrictCode !== targetDistrictCode) {
      return {
        allowed: false,
        reason: `Access forbidden: You do not have jurisdiction over district ${target.districtCode || target.district}. Authorized jurisdiction is ${user.districtCode || user.district}.`
      };
    }

    // String fallback for district
    if (userDistrict && targetDistrict && targetDistrict !== userDistrict) {
      return {
        allowed: false,
        reason: `Access forbidden: You do not have jurisdiction over ${target.district}. Authorized jurisdiction is ${user.district}.`
      };
    }

    // State comparison
    if (userStateCode && targetStateCode && userStateCode !== targetStateCode) {
      return {
        allowed: false,
        reason: `Access forbidden: You do not have jurisdiction over state ${target.stateCode || target.state}. Authorized state is ${user.stateCode || user.state}.`
      };
    }
    if (userState && targetState && targetState !== userState) {
      return {
        allowed: false,
        reason: `Access forbidden: You do not have jurisdiction over ${target.state}. Authorized state is ${user.state}.`
      };
    }

    return { allowed: true };
  }

  // 3. NGO / Volunteer Responder
  if (userRole === 'ngo' || userRole === 'volunteer') {
    // Check state boundaries
    if (userStateCode && targetStateCode && userStateCode !== targetStateCode) {
      return {
        allowed: false,
        reason: `Access forbidden: Operational boundary restricted to state ${user.stateCode || user.state}.`
      };
    }
    if (userState && targetState && targetState !== userState) {
      return {
        allowed: false,
        reason: `Access forbidden: Operational boundary restricted to ${user.state}.`
      };
    }
    return { allowed: true };
  }

  // 4. Villager
  if (userRole === 'villager') {
    return { allowed: true };
  }

  return { allowed: true };
}

/**
 * Express middleware to enforce geographic authorization
 * @param {Function} extractTarget - Function that extracts { state, district, stateCode, districtCode } from req
 */
function requireJurisdiction(extractTarget) {
  return (req, res, next) => {
    const user = req.user;
    if (!user) {
      return res.status(401).json({ error: 'Please log in' });
    }

    const target = typeof extractTarget === 'function' ? extractTarget(req) : {};
    const check = verifyJurisdiction(user, target);

    if (!check.allowed) {
      return res.status(403).json({
        error: check.reason,
        code: 'GEO_AUTHORIZATION_DENIED',
        authorizedJurisdiction: {
          district: user.district,
          state: user.state,
          stateCode: user.stateCode,
          districtCode: user.districtCode,
          role: user.role
        }
      });
    }

    next();
  };
}

/**
 * Filter an array of incidents/items according to user's authorized jurisdiction
 * Prefers codes with string fallback.
 */
function filterByJurisdiction(items, user) {
  if (!user || user.role === 'super_admin' || user.role === 'national_control') {
    return items;
  }

  const userDistrictCode = user.districtCode ? String(user.districtCode).trim().toUpperCase() : null;
  const userStateCode = user.stateCode ? String(user.stateCode).trim().toUpperCase() : null;
  const userDistrict = user.district ? String(user.district).trim().toLowerCase() : null;
  const userState = user.state ? String(user.state).trim().toLowerCase() : null;

  if (user.role === 'control' || user.role === 'panchayat' || user.role === 'district_authority') {
    if (!userDistrictCode && !userDistrict) return items;
    return items.filter((item) => {
      if (userDistrictCode && item.districtCode) {
        return String(item.districtCode).trim().toUpperCase() === userDistrictCode;
      }
      if (!item.district) return true;
      return String(item.district).trim().toLowerCase() === userDistrict;
    });
  }

  if (user.role === 'ngo' || user.role === 'volunteer') {
    if (!userDistrict && !userState && !userDistrictCode && !userStateCode) return items;
    return items.filter((item) => {
      const matchDistrict = !userDistrictCode || !item.districtCode
        ? (!userDistrict || !item.district || String(item.district).trim().toLowerCase() === userDistrict)
        : String(item.districtCode).trim().toUpperCase() === userDistrictCode;

      const matchState = !userStateCode || !item.stateCode
        ? (!userState || !item.state || String(item.state).trim().toLowerCase() === userState)
        : String(item.stateCode).trim().toUpperCase() === userStateCode;

      return matchDistrict && matchState;
    });
  }

  return items;
}

/**
 * Privacy Rule:
 * Unassigned responders receive approximate area, priority, and required capability.
 * Exact civilian location & contact phone are ONLY visible to Control Authority and the Assigned Responder.
 */
function maskLocationForPrivacy(sosItem, user) {
  if (!sosItem || !user) return sosItem;

  const item = typeof sosItem.toObject === 'function' ? sosItem.toObject() : { ...sosItem };

  // Super Admin and Control Authority (Panchayat) always see full location
  if (user.role === 'super_admin' || user.role === 'control' || user.role === 'panchayat' || user.role === 'district_authority') {
    return item;
  }

  // Reporter sees their own request
  if (user.id && (String(item.reportedBy) === String(user.id) || String(item.userId) === String(user.id))) {
    return item;
  }

  // Assigned responder sees full location
  const assignedNgoId = item.assignedTo?._id ? String(item.assignedTo._id) : (item.assignedTo ? String(item.assignedTo) : null);
  const userNgoId = user.ngo ? String(user.ngo) : (user.id ? String(user.id) : null);

  if (assignedNgoId && userNgoId && assignedNgoId === userNgoId) {
    return item;
  }

  // For unassigned responders: fuzz exact lat/lng to 2 decimal places (~1.1 km precision) and mask contact phone
  if (item.location && Number.isFinite(item.location.lat) && Number.isFinite(item.location.lng)) {
    item.location = {
      lat: Math.round(item.location.lat * 100) / 100,
      lng: Math.round(item.location.lng * 100) / 100
    };
    item.isApproximateLocation = true;
    item.locationAccuracy = Math.max(item.locationAccuracy || 1000, 1000);
  }

  if (item.contactPhone) {
    item.contactPhone = item.contactPhone.slice(0, 3) + '******' + item.contactPhone.slice(-2);
  }

  return item;
}

module.exports = {
  verifyJurisdiction,
  requireJurisdiction,
  filterByJurisdiction,
  maskLocationForPrivacy
};
