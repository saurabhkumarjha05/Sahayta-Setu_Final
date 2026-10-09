const { INDIA_LOCATIONS } = require('../data/indiaLocations');
const { normalizePhone } = require('../services/auth');

// State Code Mappings
const STATE_TO_CODE = {
  'uttarakhand': 'UK',
  'uttar pradesh': 'UP',
  'himachal pradesh': 'HP',
  'jammu and kashmir': 'JK',
  'delhi': 'DL',
  'punjab': 'PB',
  'haryana': 'HR',
  'rajasthan': 'RJ',
  'bihar': 'BR',
  'west bengal': 'WB',
  'assam': 'AS',
  'karnataka': 'KA',
  'maharashtra': 'MH',
  'kerala': 'KL',
  'tamil nadu': 'TN',
  'gujarat': 'GJ',
  'madhya pradesh': 'MP',
  'odisha': 'OD',
  'andhra pradesh': 'AP',
  'telangana': 'TG',
  'goa': 'GA',
  'jharkhand': 'JH',
  'chhattisgarh': 'CG'
};

const CODE_TO_STATE = {};
for (const [state, code] of Object.entries(STATE_TO_CODE)) {
  CODE_TO_STATE[code.toUpperCase()] = state;
}

// Check for HTML injection or dangerous tags
const HTML_TAG_REGEX = /<[^>]*>/g;
const SCRIPT_INJECTION_REGEX = /<\s*script[^>]*>|javascript:|data:\s*text\/html/i;

function containsHtml(str) {
  if (typeof str !== 'string') return false;
  return HTML_TAG_REGEX.test(str) || SCRIPT_INJECTION_REGEX.test(str);
}

function stripHtml(str) {
  if (typeof str !== 'string') return str;
  return str.replace(HTML_TAG_REGEX, '').trim();
}

function normalizeEmail(email) {
  if (!email || typeof email !== 'string') return null;
  const clean = email.trim().toLowerCase();
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(clean) || clean.length > 254) {
    return null;
  }
  return clean;
}

/**
 * Resolve state name and code
 */
function resolveState(input) {
  if (!input) return { state: null, stateCode: null };
  const str = String(input).trim();
  const upper = str.toUpperCase();

  // If input is already a code (e.g. UK, UP, KA)
  if (CODE_TO_STATE[upper]) {
    const rawName = CODE_TO_STATE[upper];
    // Find canonical capitalization in INDIA_LOCATIONS
    const canonical = Object.keys(INDIA_LOCATIONS).find(
      (s) => s.toLowerCase() === rawName.toLowerCase()
    ) || rawName;
    return { state: canonical, stateCode: upper };
  }

  // If input is a state name
  const match = Object.keys(INDIA_LOCATIONS).find(
    (s) => s.toLowerCase() === str.toLowerCase()
  );
  if (match) {
    const code = STATE_TO_CODE[match.toLowerCase()] || str.slice(0, 2).toUpperCase();
    return { state: match, stateCode: code };
  }

  return { state: str, stateCode: str.slice(0, 2).toUpperCase() };
}

/**
 * Resolve district name and code within a state
 */
function resolveDistrict(stateName, districtInput) {
  if (!districtInput) return { district: null, districtCode: null };
  const dStr = String(districtInput).trim();
  const dUpper = dStr.toUpperCase();

  const districts = INDIA_LOCATIONS[stateName] || [];
  const found = districts.find(
    (d) => d.name.toLowerCase() === dStr.toLowerCase()
  );

  if (found) {
    const code = dUpper.slice(0, 3);
    return { district: found.name, districtCode: code };
  }

  return { district: dStr, districtCode: dUpper.slice(0, 3) };
}

/**
 * Validate and sanitize auth input
 */
function validateAuthInput({
  name,
  orgName,
  village,
  email,
  phone,
  password,
  state,
  stateCode,
  district,
  districtCode,
  blockCode,
  panchayatId,
  isRegistration = false
}) {
  const errors = [];

  // Check for HTML injection
  const fieldsToCheck = { name, orgName, village, email, state, district, blockCode, panchayatId };
  for (const [key, val] of Object.entries(fieldsToCheck)) {
    if (val && typeof val === 'string' && containsHtml(val)) {
      errors.push(`Field '${key}' contains invalid characters or HTML tags`);
    }
  }

  // Name validation
  let cleanName = name ? String(name).trim() : '';
  if (cleanName) {
    if (cleanName.length > 100) {
      errors.push('Name cannot exceed 100 characters');
    }
  }

  // Organization name validation
  let cleanOrgName = orgName ? String(orgName).trim() : '';
  if (cleanOrgName) {
    if (cleanOrgName.length > 150) {
      errors.push('Organization name cannot exceed 150 characters');
    }
  }

  // Village validation
  let cleanVillage = village ? String(village).trim() : '';
  if (cleanVillage && cleanVillage.length > 100) {
    errors.push('Village name cannot exceed 100 characters');
  }

  // Email validation
  let cleanEmail = null;
  if (email !== undefined && email !== null && String(email).trim() !== '') {
    cleanEmail = normalizeEmail(email);
    if (!cleanEmail) {
      errors.push('Please provide a valid email address');
    }
  }

  // Phone validation
  let cleanPhone = null;
  if (phone !== undefined && phone !== null && String(phone).trim() !== '') {
    cleanPhone = normalizePhone(phone);
    if (!cleanPhone) {
      errors.push('Please provide a valid 10-digit Indian mobile number');
    }
  }

  // Password validation (if supplied)
  if (password !== undefined && password !== null) {
    const pwStr = String(password);
    if (pwStr.length < 8) {
      errors.push('Password must be at least 8 characters long');
    } else if (pwStr.length > 72) {
      errors.push('Password cannot exceed 72 characters');
    }
  }

  // Resolve state and district
  const resolvedState = resolveState(state || stateCode);
  const resolvedDistrict = resolveDistrict(resolvedState.state, district || districtCode);

  return {
    isValid: errors.length === 0,
    errors,
    sanitized: {
      name: cleanName,
      orgName: cleanOrgName,
      village: cleanVillage,
      email: cleanEmail,
      phone: cleanPhone,
      state: resolvedState.state,
      stateCode: stateCode ? String(stateCode).trim().toUpperCase() : resolvedState.stateCode,
      district: resolvedDistrict.district,
      districtCode: districtCode ? String(districtCode).trim().toUpperCase() : resolvedDistrict.districtCode,
      blockCode: blockCode ? String(blockCode).trim() : null,
      panchayatId: panchayatId ? String(panchayatId).trim() : null
    }
  };
}

module.exports = {
  containsHtml,
  stripHtml,
  normalizeEmail,
  resolveState,
  resolveDistrict,
  validateAuthInput
};
