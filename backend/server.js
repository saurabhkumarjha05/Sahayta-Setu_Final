const dns = require('dns');
dns.setServers(['8.8.8.8', '1.1.1.1']);
require('dotenv').config();
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const User = require('./models/user');
const Otp = require('./models/otp');
const { normalizePhone, createToken, optionalAuth, requireAuth, requireVerified, requireRole } = require('./services/auth');
const { limiter } = require('./utils/rateLimiter');
const { validateAuthInput, normalizeEmail } = require('./utils/validation');
const { getRainfall, getRainfall24h, getRainfall24hMany } = require('./services/weather');
const { calculateRisk } = require('./services/risk');
const DistrictRainfall = require('./models/districtRainfall');
const { getVerifiedShelters } = require('./data/verifiedResources');
const http = require('http');
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');

const { registerDevice, revokeDevice, validateEmergencyPacket, findDevice, deviceStore } = require('./services/cryptoService');
const { calculateDistanceKm, matchNearestResponders } = require('./services/matchingService');
const { verifyJurisdiction, filterByJurisdiction, maskLocationForPrivacy } = require('./services/geoAuth');
const { logAuditEvent, queryAuditLogs, memoryAuditLogs } = require('./services/auditService');
const VerifiedEntity = require('./models/verifiedEntity');
const AuditLog = require('./models/auditLog');
const {
  initRealtime,
  getIo,
  setSosLiteSocketHandler,
  broadcastNewSOS,
  broadcastSOSAssigned,
  broadcastResponderLocation,
  emitAccountStatusChanged,
  emitAdminPendingUpdate,
  emitAdminEntityUpdated,
  emitResourceCreated,
  emitResourceUpdated,
  emitResourceClosed,
  savePushSubscription,
  sendTargetedPush,
  VAPID_PUBLIC_KEY
} = require('./services/realtimeService');
const {
  SOS_LITE_VERSION,
  buildSosLitePayload,
  getUnsignedLitePayload,
  computeLitePriority,
  validateSosLite,
  SOURCE_CHANNELS
} = require('../shared/sosLite');

const app = express();
const allowedOrigins = (process.env.CORS_ORIGINS || '')
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean);

app.use(cors({
  origin(origin, callback) {
    if (!origin || allowedOrigins.length === 0 || allowedOrigins.includes(origin)) {
      callback(null, true);
      return;
    }
    callback(new Error(`Origin ${origin} is not allowed by CORS`));
  }
}));
app.use(express.json());

// Public health check (no auth, tiny JSON, no-cache)
app.get('/api/health', (req, res) => {
  res.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  res.set('Pragma', 'no-cache');
  res.set('Expires', '0');
  const isDbConnected = mongoose.connection && mongoose.connection.readyState === 1;
  res.json({
    ok: true,
    db: isDbConnected ? 'connected' : 'down',
    time: new Date().toISOString()
  });
});

// Public runtime configuration
app.get('/api/config/public', (req, res) => {
  res.json({
    citizenAuthMode: isDemoPhoneOnlyMode() ? 'phone_only' : 'otp',
    languages: ['en', 'hi'],
    platformName: 'Sahayta Setu'
  });
});

function isDemoPhoneOnlyMode() {
  return process.env.NODE_ENV !== 'production'
    && process.env.APP_MODE === 'demo'
    && process.env.CITIZEN_AUTH_MODE === 'phone_only';
}

function requireOtpUnlessDemo(req, res, next) {
  if (!isDemoPhoneOnlyMode()) {
    return res.status(403).json({
      error: 'Citizen phone-only authentication is available only in explicitly configured demo mode.',
      code: 'OTP_REQUIRED'
    });
  }
  return next();
}

// In-memory test store harness (used only when NODE_ENV=test and disconnected from MongoDB)
const isDbMode = () => Boolean(mongoose.connection && mongoose.connection.readyState === 1);

const memoryStore = {
  shelters: [],
  sos: [],
  alerts: [],
  users: [],
  ngos: [],
  entities: []
};

// Seed test fixtures for offline unit tests only
if (process.env.NODE_ENV === 'test') {
  memoryStore.shelters = [
    { _id: 'shelter-uk-1', name: 'Dehradun DEOC & Relief Base', lat: 30.3256, lng: 78.0412, capacity: 500, currentOccupancy: 120, status: 'Available', state: 'Uttarakhand', district: 'Dehradun', type: 'Relief Centre', publicContact: '+91 0135-2726066', verified: true },
    { _id: 'shelter-uk-2', name: 'Doon Govt Hospital Disaster Wing', lat: 30.3210, lng: 78.0380, capacity: 350, currentOccupancy: 210, status: 'Available', state: 'Uttarakhand', district: 'Dehradun', type: 'Hospital', publicContact: '+91 0135-2659000', verified: true }
  ];
  memoryStore.ngos = [
    {
      _id: 'ngo-uk-1',
      name: 'Helping Hands Response Unit',
      contactPerson: 'Arun Rawat',
      phone: '+919876543210',
      district: 'Dehradun',
      state: 'Uttarakhand',
      location: { lat: 30.3165, lng: 78.0322 },
      available: true,
      status: 'Available',
      resourceType: 'rescue_team',
      services: ['Rescue', 'Medical', 'Flood']
    },
    {
      _id: 'ngo-uk-2',
      name: 'Doon Disaster Relief Corps',
      contactPerson: 'Meera Negi',
      phone: '+919876543211',
      district: 'Dehradun',
      state: 'Uttarakhand',
      location: { lat: 30.3250, lng: 78.0400 },
      available: true,
      status: 'Available',
      resourceType: 'medical_unit',
      services: ['Medical', 'First Aid', 'Food']
    },
    {
      _id: 'ngo-up-1',
      name: 'Awadh Emergency Relief Taskforce',
      contactPerson: 'Rajesh Mishra',
      phone: '+919876543212',
      district: 'Lucknow',
      state: 'Uttar Pradesh',
      location: { lat: 26.8467, lng: 80.9462 },
      available: true,
      status: 'Available',
      resourceType: 'rescue_team',
      services: ['Rescue', 'Medical']
    },
    {
      _id: 'ngo-ka-1',
      name: 'Dakshina Sahaya Rescue',
      contactPerson: 'Ramesh Kumar',
      phone: '+919876543213',
      district: 'Dakshina Kannada',
      state: 'Karnataka',
      location: { lat: 12.9985, lng: 75.3280 },
      available: true,
      status: 'Available',
      resourceType: 'rescue_team',
      services: ['Rescue', 'Medical'],
      verificationStatus: 'VERIFIED',
      verificationLabel: 'SAHAYTA SETU VERIFIED'
    }
  ];
  memoryStore.entities = [
    {
      _id: 'entity-ddn-gp',
      organizationName: 'Gram Panchayat Raipur (Dehradun)',
      organizationType: 'PANCHAYAT',
      representativeName: 'Smt. Kavita Sharma (Gram Pradhan)',
      phone: '+919876543220',
      email: 'panchayat.raipur@uk.gov.in',
      district: 'Dehradun',
      state: 'Uttarakhand',
      block: 'Raipur',
      panchayatId: 'DDN-GP-01',
      stateCode: 'UK',
      districtCode: 'DDN',
      capabilities: ['Evacuation', 'Relief Distribution', 'Shelter Support'],
      verificationStatus: 'VERIFIED',
      verificationLabel: 'SAHAYTA SETU VERIFIED',
      verifiedBy: 'Super Admin',
      verifiedAt: new Date('2026-01-15'),
      activeStatus: 'AVAILABLE',
      location: { lat: 30.3165, lng: 78.0322 }
    },
    {
      _id: 'entity-ddn-ddma',
      organizationName: 'Dehradun DDMA (District Disaster Management Authority)',
      organizationType: 'DISTRICT_AUTHORITY',
      representativeName: 'Dr. R. K. Joshi (Disaster Management Officer)',
      phone: '+919876543221',
      email: 'ddma.dehradun@uk.gov.in',
      district: 'Dehradun',
      state: 'Uttarakhand',
      stateCode: 'UK',
      districtCode: 'DDN',
      capabilities: ['Search & Rescue', 'Evacuation', 'Relief Distribution', 'Transport'],
      verificationStatus: 'VERIFIED',
      verificationLabel: 'SAHAYTA SETU VERIFIED',
      verifiedBy: 'National Disaster Registry',
      verifiedAt: new Date('2026-01-10'),
      activeStatus: 'AVAILABLE',
      location: { lat: 30.3200, lng: 78.0400 }
    },
    {
      _id: 'entity-hh-ngo',
      organizationName: 'Helping Hands Response Unit',
      organizationType: 'NGO',
      representativeName: 'Arun Rawat (Rescue Lead)',
      phone: '+919876543210',
      email: 'help@helpinghandsuk.org',
      district: 'Dehradun',
      state: 'Uttarakhand',
      stateCode: 'UK',
      districtCode: 'DDN',
      capabilities: ['Rescue', 'Medical', 'Flood Rescue', 'First Aid'],
      verificationStatus: 'VERIFIED',
      verificationLabel: 'SAHAYTA SETU VERIFIED',
      verifiedBy: 'DDMA Dehradun',
      verifiedAt: new Date('2026-02-01'),
      activeStatus: 'AVAILABLE',
      location: { lat: 30.3165, lng: 78.0322 }
    },
    {
      _id: 'entity-doon-rescue',
      organizationName: 'Doon Valley Rapid Rescue Team',
      organizationType: 'VOLUNTEER_TEAM',
      representativeName: 'Meera Negi',
      phone: '+919876543211',
      district: 'Dehradun',
      state: 'Uttarakhand',
      stateCode: 'UK',
      districtCode: 'DDN',
      capabilities: ['Boat Rescue', 'Search & Rescue', 'Evacuation'],
      verificationStatus: 'VERIFIED',
      verificationLabel: 'SAHAYTA SETU VERIFIED',
      verifiedBy: 'DDMA Dehradun',
      verifiedAt: new Date('2026-02-10'),
      activeStatus: 'AVAILABLE',
      location: { lat: 30.3250, lng: 78.0400 }
    },
    {
      _id: 'entity-lko-gp',
      organizationName: 'Gram Panchayat Mohanlalganj (Lucknow)',
      organizationType: 'PANCHAYAT',
      representativeName: 'Shri Ramesh Yadav',
      phone: '+919876543222',
      district: 'Lucknow',
      state: 'Uttar Pradesh',
      stateCode: 'UP',
      districtCode: 'LKO',
      capabilities: ['Evacuation', 'Relief Distribution'],
      verificationStatus: 'VERIFIED',
      verificationLabel: 'SAHAYTA SETU VERIFIED',
      verifiedBy: 'DDMA Lucknow',
      verifiedAt: new Date('2026-01-20'),
      activeStatus: 'AVAILABLE',
      location: { lat: 26.8467, lng: 80.9462 }
    },
    {
      _id: 'entity-pending-ngo',
      organizationName: 'Unverified Citizen Volunteer Taskforce',
      organizationType: 'NGO',
      representativeName: 'Vikram Singh',
      phone: '+919876543223',
      district: 'Dehradun',
      state: 'Uttarakhand',
      stateCode: 'UK',
      districtCode: 'DDN',
      capabilities: ['First Aid'],
      verificationStatus: 'PENDING',
      verificationLabel: 'PENDING VERIFICATION',
      verifiedBy: null,
      verifiedAt: null,
      activeStatus: 'AVAILABLE',
      location: { lat: 30.3300, lng: 78.0500 }
    }
  ];
}

// ---------- CITIZEN AUTHENTICATION (Phone-First Flow) ----------

// Citizen Lookup: POST /api/auth/citizen/lookup
// Body: { phone } -> { exists: boolean, accountType: 'citizen' | 'organization' | null }
// Strict privacy: Does NOT return name or profile details
app.post('/api/auth/citizen/lookup', requireOtpUnlessDemo, async (req, res) => {
  const ipCheck = limiter.check(`ip:${req.ip}:citizen-lookup`, 30, 15 * 60 * 1000);
  if (!ipCheck.allowed) {
    res.setHeader('Retry-After', ipCheck.retryAfterSeconds);
    return res.status(429).json({
      error: `Too many lookup requests from this IP. Please try again in ${ipCheck.retryAfterSeconds} seconds.`,
      code: 'RATE_LIMIT_EXCEEDED',
      retryAfter: ipCheck.retryAfterSeconds
    });
  }

  const phone = normalizePhone(req.body.phone);
  if (!phone) {
    return res.status(400).json({ error: 'Please provide a valid 10-digit Indian mobile number', code: 'INVALID_PHONE' });
  }

  const phoneCheck = limiter.check(`phone:${phone}:lookup`, 15, 10 * 60 * 1000);
  if (!phoneCheck.allowed) {
    res.setHeader('Retry-After', phoneCheck.retryAfterSeconds);
    return res.status(429).json({
      error: `Too many lookup attempts for this phone number. Please try again in ${phoneCheck.retryAfterSeconds} seconds.`,
      code: 'RATE_LIMIT_EXCEEDED',
      retryAfter: phoneCheck.retryAfterSeconds
    });
  }

  try {
    let user = null;
    if (mongoose.connection && mongoose.connection.readyState === 1) {
      user = await User.findOne({ phone });
    } else if (process.env.NODE_ENV === 'test') {
      user = (memoryStore.users || []).find((u) => u.phone === phone);
    }

    if (!user) {
      return res.json({ exists: false, accountType: null });
    }

    const isOrg = ['ngo', 'control', 'super_admin'].includes(user.role);
    return res.json({
      exists: true,
      accountType: isOrg ? 'organization' : 'citizen'
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Citizen Direct Login: POST /api/auth/citizen/login
// Body: { phone } -> { token, user }
app.post('/api/auth/citizen/login', requireOtpUnlessDemo, async (req, res) => {
  const ipCheck = limiter.check(`ip:${req.ip}:citizen-login`, 20, 15 * 60 * 1000);
  if (!ipCheck.allowed) {
    res.setHeader('Retry-After', ipCheck.retryAfterSeconds);
    return res.status(429).json({
      error: `Too many login attempts from this IP. Please try again in ${ipCheck.retryAfterSeconds} seconds.`,
      code: 'RATE_LIMIT_EXCEEDED',
      retryAfter: ipCheck.retryAfterSeconds
    });
  }

  const phone = normalizePhone(req.body.phone);
  if (!phone) {
    return res.status(400).json({ error: 'Please provide a valid 10-digit Indian mobile number', code: 'INVALID_PHONE' });
  }

  try {
    let user = null;
    if (mongoose.connection && mongoose.connection.readyState === 1) {
      user = await User.findOne({ phone });
    } else if (process.env.NODE_ENV === 'test') {
      user = (memoryStore.users || []).find((u) => u.phone === phone);
    }

    if (!user) {
      return res.status(404).json({
        error: 'Account not found. Please register first.',
        code: 'ACCOUNT_NOT_FOUND'
      });
    }

    if (user.role !== 'villager') {
      return res.status(409).json({
        error: 'This phone is linked to an organization account. Please use organization login.',
        code: 'USE_ORG_LOGIN'
      });
    }

    if (user.accountStatus === 'DISABLED') {
      return res.status(403).json({
        error: 'This account has been disabled. Please contact the administrator.',
        code: 'ACCOUNT_DISABLED'
      });
    }

    if (mongoose.connection && mongoose.connection.readyState === 1) {
      user.lastLoginAt = new Date();
      await user.save();
    }

    await logAuditEvent({
      actorId: user._id || user.id,
      actorName: user.name,
      actorRole: user.role,
      action: 'CITIZEN_LOGIN',
      targetId: user._id || user.id,
      targetType: 'User',
      jurisdiction: { state: user.state, district: user.district, village: user.village },
      details: { method: 'PHONE_ONLY' }
    });

    res.json({
      token: createToken(user),
      user: publicUser(user)
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Citizen Registration: POST /api/auth/citizen/register
// Body: { phone, name, stateCode, districtCode, village, state, district } -> { token, user }
app.post('/api/auth/citizen/register', requireOtpUnlessDemo, async (req, res) => {
  const ipCheck = limiter.check(`ip:${req.ip}:citizen-register`, 15, 15 * 60 * 1000);
  if (!ipCheck.allowed) {
    res.setHeader('Retry-After', ipCheck.retryAfterSeconds);
    return res.status(429).json({
      error: `Too many registration attempts. Please try again in ${ipCheck.retryAfterSeconds} seconds.`,
      code: 'RATE_LIMIT_EXCEEDED',
      retryAfter: ipCheck.retryAfterSeconds
    });
  }

  const phone = normalizePhone(req.body.phone);
  if (!phone) {
    return res.status(400).json({ error: 'Please provide a valid 10-digit Indian mobile number', code: 'INVALID_PHONE' });
  }

  const rawName = String(req.body.name || '').replace(/<[^>]*>?/gm, '').trim();
  if (!rawName || rawName.length < 2 || rawName.length > 100) {
    return res.status(400).json({ error: 'Please provide a valid full name (2 to 100 characters)', code: 'INVALID_NAME' });
  }

  const { stateCode, districtCode, village, state, district } = req.body;
  const validation = validateAuthInput({
    name: rawName,
    phone,
    village,
    state,
    district,
    stateCode,
    districtCode
  });

  if (!validation.isValid) {
    return res.status(400).json({ error: validation.errors[0], errors: validation.errors, code: 'VALIDATION_ERROR' });
  }

  const { sanitized } = validation;

  try {
    let user = null;
    if (mongoose.connection && mongoose.connection.readyState === 1) {
      try {
        user = await User.create({
          name: sanitized.name,
          phone,
          role: 'villager',
          accountStatus: 'ACTIVE',
          verificationStatus: 'NOT_REQUIRED',
          state: sanitized.state || 'Uttarakhand',
          district: sanitized.district || 'Dehradun',
          stateCode: sanitized.stateCode || 'UK',
          districtCode: sanitized.districtCode || 'DDN',
          village: sanitized.village || '',
          lastLoginAt: new Date()
        });
      } catch (createErr) {
        if (createErr.code === 11000 || String(createErr.message).includes('E11000')) {
          return res.status(409).json({
            error: 'This mobile number is already registered. Please log in.',
            code: 'PHONE_EXISTS'
          });
        }
        throw createErr;
      }
    } else if (process.env.NODE_ENV === 'test') {
      const existing = (memoryStore.users || []).find((u) => u.phone === phone);
      if (existing) {
        return res.status(409).json({
          error: 'This mobile number is already registered. Please log in.',
          code: 'PHONE_EXISTS'
        });
      }
      user = {
        _id: `citizen_${Date.now()}`,
        id: `citizen_${Date.now()}`,
        name: sanitized.name,
        phone,
        role: 'villager',
        accountStatus: 'ACTIVE',
        verificationStatus: 'NOT_REQUIRED',
        state: sanitized.state || 'Uttarakhand',
        district: sanitized.district || 'Dehradun',
        stateCode: sanitized.stateCode || 'UK',
        districtCode: sanitized.districtCode || 'DDN',
        village: sanitized.village || '',
        lastLoginAt: new Date()
      };
      memoryStore.users.push(user);
    }

    await logAuditEvent({
      actorId: user._id || user.id,
      actorName: user.name,
      actorRole: 'villager',
      action: 'CITIZEN_REGISTERED',
      targetId: user._id || user.id,
      targetType: 'User',
      jurisdiction: { state: user.state, district: user.district, village: user.village },
      details: { phone }
    });

    res.status(201).json({
      token: createToken(user),
      user: publicUser(user)
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ---------- AUTH (Real MongoDB-Backed Authentication) ----------

// What we send back about a user (never the passwordHash)
function publicUser(user) {
  if (!user) return null;
  const uid = user._id ? user._id.toString() : (user.id ? String(user.id) : null);
  const status = user.verificationStatus || (user.role === 'villager' ? 'NOT_REQUIRED' : user.role === 'super_admin' ? 'VERIFIED' : 'PENDING');

  return {
    _id: uid,
    id: uid,
    name: user.name,
    email: user.email || null,
    phone: user.phone || null,
    role: user.role || 'villager',
    accountStatus: user.accountStatus || 'ACTIVE',
    verificationStatus: status,
    verificationNote: user.verificationNote || null,
    verifiedBy: user.verifiedBy || null,
    verifiedAt: user.verifiedAt || null,
    organizationId: user.organizationId ? (user.organizationId._id ? user.organizationId._id.toString() : user.organizationId.toString()) : null,
    organizationType: user.organizationType || (user.organizationId?.organizationType) || null,
    organizationName: user.organizationId?.organizationName || null,
    authorityLevel: user.authorityLevel || null,
    stateCode: user.stateCode || null,
    districtCode: user.districtCode || null,
    blockCode: user.blockCode || null,
    panchayatId: user.panchayatId || null,
    village: user.village || null,
    district: user.district || null,
    state: user.state || null,
    ngo: user.ngo ? (user.ngo._id ? user.ngo._id.toString() : user.ngo.toString()) : null,
    mustChangePassword: Boolean(user.mustChangePassword),
    isDemo: Boolean(user.isDemo)
  };
}

// Step 1 of Citizen Login: Request OTP
// Body: { "phone": "9876543210" }
app.post('/api/auth/request-otp', async (req, res) => {
  // Rate limit: 10 per IP per hour
  const ipCheck = limiter.check(`ip:${req.ip}:request-otp`, 10, 60 * 60 * 1000);
  if (!ipCheck.allowed) {
    res.setHeader('Retry-After', ipCheck.retryAfterSeconds);
    return res.status(429).json({
      error: `Too many OTP requests from this IP. Please try again in ${ipCheck.retryAfterSeconds} seconds.`,
      code: 'RATE_LIMIT_EXCEEDED',
      retryAfter: ipCheck.retryAfterSeconds
    });
  }

  const phone = normalizePhone(req.body.phone);
  if (!phone) {
    return res.status(400).json({ error: 'Please give a valid 10-digit Indian mobile number' });
  }

  // Rate limit: 3 per phone per 10 minutes
  const phoneCheck = limiter.check(`phone:${phone}`, 3, 10 * 60 * 1000);
  if (!phoneCheck.allowed) {
    res.setHeader('Retry-After', phoneCheck.retryAfterSeconds);
    return res.status(429).json({
      error: `Too many OTP requests for this phone number. Please try again in ${phoneCheck.retryAfterSeconds} seconds.`,
      code: 'RATE_LIMIT_EXCEEDED',
      retryAfter: phoneCheck.retryAfterSeconds
    });
  }

  try {
    // If phone belongs to an organization account, direct to email login
    if (mongoose.connection && mongoose.connection.readyState === 1) {
      const existingUser = await User.findOne({ phone });
      if (existingUser && existingUser.role !== 'villager') {
        return res.status(400).json({
          error: 'This mobile number belongs to an organization account. Please log in using your official email and password.',
          code: 'USE_EMAIL_LOGIN'
        });
      }
    }

    const code = crypto.randomInt(100000, 1000000).toString(); // 6 digits

    if (mongoose.connection && mongoose.connection.readyState === 1) {
      await Otp.deleteMany({ phone }); // remove any older code for this phone
      await Otp.create({
        phone,
        codeHash: await bcrypt.hash(code, 10),
        expiresAt: new Date(Date.now() + 5 * 60 * 1000) // 5 minutes
      });
    }

    const isNewUser = (mongoose.connection && mongoose.connection.readyState === 1)
      ? !(await User.exists({ phone }))
      : true;

    const deliveryMode = process.env.OTP_DELIVERY || (process.env.APP_MODE === 'demo' ? 'console' : 'sms');
    const response = { message: 'Code sent', isNewUser, sms: 'live' };

    // Console / demo delivery
    if (deliveryMode === 'console' || process.env.APP_MODE === 'demo') {
      response.sms = 'simulated';
      response.demoOtp = code;
      console.log(`[AUTH OTP CONSOLE] Mobile: ${phone} -> Code: ${code} (expires in 5 min)`);
      return res.json(response);
    }

    // Live SMS delivery
    const sms = await deliverSMS(
      [phone],
      `Your Sahayta Setu login code is ${code}. It expires in 5 minutes.`,
      'OTP_SMS_ENABLED'
    );
    if (sms.mode === 'live' && sms.sent === 0) {
      return res.status(502).json({ error: 'Could not send the code via SMS. Please try again.' });
    }

    res.json({ message: 'Code sent', isNewUser, sms: sms.mode });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Step 2 of Citizen Login: Verify OTP
// Body: { "phone": "...", "code": "123456", "name": "...", "village": "...", "state": "...", "district": "..." }
// Citizens ALWAYS receive role=villager. Client-sent privileged roles are rejected/ignored.
app.post('/api/auth/verify-otp', async (req, res) => {
  const phone = normalizePhone(req.body.phone);
  const code = String(req.body.code || '').trim();
  if (!phone || !code) {
    return res.status(400).json({ error: 'Please provide mobile number and verification code' });
  }

  try {
    let otp = null;
    if (mongoose.connection && mongoose.connection.readyState === 1) {
      otp = await Otp.findOne({ phone });
      if (!otp || otp.expiresAt < new Date()) {
        return res.status(400).json({ error: 'Code expired or not found. Please request a new one.' });
      }
      if (otp.attempts >= 5) {
        await otp.deleteOne();
        return res.status(429).json({ error: 'Too many wrong tries. Please request a new code.' });
      }

      const correct = await bcrypt.compare(code, otp.codeHash);
      if (!correct) {
        otp.attempts += 1;
        await otp.save();
        return res.status(400).json({ error: 'Wrong code' });
      }
    } else {
      // Memory fallback for tests
      if (code !== '123456' && code.length !== 6) {
        return res.status(400).json({ error: 'Wrong code' });
      }
    }

    // Role checks BEFORE deleting OTP
    let user = null;
    if (mongoose.connection && mongoose.connection.readyState === 1) {
      user = await User.findOne({ phone });
    }

    if (user) {
      if (user.role !== 'villager') {
        return res.status(400).json({
          error: 'This mobile number belongs to an organization account. Please log in using your official email and password.',
          code: 'USE_EMAIL_LOGIN'
        });
      }
      if (user.accountStatus === 'DISABLED') {
        return res.status(403).json({ error: 'This account has been disabled. Please contact the administrator.', code: 'ACCOUNT_DISABLED' });
      }
    } else {
      // First-time citizen registration
      const { name, village, state, district, stateCode, districtCode } = req.body;
      if (!name || !String(name).trim()) {
        return res.status(400).json({ error: 'New user: please give your name', needsName: true });
      }

      const validation = validateAuthInput({
        name,
        village,
        phone,
        state,
        district,
        stateCode,
        districtCode
      });

      if (!validation.isValid) {
        return res.status(400).json({ error: validation.errors[0], errors: validation.errors });
      }

      const { sanitized } = validation;

      try {
        if (mongoose.connection && mongoose.connection.readyState === 1) {
          user = await User.create({
            name: sanitized.name,
            phone,
            role: 'villager',
            village: sanitized.village || 'Demo Village',
            district: sanitized.district || 'Dehradun',
            districtCode: sanitized.districtCode || 'DDN',
            state: sanitized.state || 'Uttarakhand',
            stateCode: sanitized.stateCode || 'UK',
            accountStatus: 'ACTIVE',
            verificationStatus: 'NOT_REQUIRED'
          });
        } else {
          user = {
            _id: `villager-${Date.now()}`,
            id: `villager-${Date.now()}`,
            name: sanitized.name,
            phone,
            role: 'villager',
            village: sanitized.village || 'Demo Village',
            district: sanitized.district || 'Dehradun',
            districtCode: sanitized.districtCode || 'DDN',
            state: sanitized.state || 'Uttarakhand',
            stateCode: sanitized.stateCode || 'UK',
            verificationStatus: 'NOT_REQUIRED'
          };
        }
      } catch (createErr) {
        if (createErr.code === 11000 || String(createErr.message).includes('E11000')) {
          user = await User.findOne({ phone });
          if (!user) {
            return res.status(409).json({ error: 'An account with this mobile number already exists.' });
          }
        } else {
          throw createErr;
        }
      }
    }

    // OTP was verified and user checked/created successfully: delete OTP now
    if (otp && typeof otp.deleteOne === 'function') {
      await otp.deleteOne();
    }

    await logAuditEvent({
      actorId: user._id || user.id,
      actorName: user.name,
      actorRole: user.role,
      action: 'LOGIN_SUCCESS',
      targetId: user._id || user.id,
      targetType: 'User',
      jurisdiction: { state: user.state, district: user.district, village: user.village },
      details: { method: 'OTP' }
    });

    res.json({ token: createToken(user), user: publicUser(user) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Organization Registration: POST /api/auth/register-org
// Body: orgType (NGO | PANCHAYAT | DISTRICT_AUTHORITY), orgName, contactName, email, phone, password, stateCode, districtCode, blockCode, panchayatId, registrationNumber
app.post('/api/auth/register-org', async (req, res) => {
  const {
    orgType,
    orgName,
    contactName,
    email,
    phone,
    password,
    stateCode,
    districtCode,
    state,
    district,
    blockCode,
    panchayatId,
    registrationNumber
  } = req.body;

  const validTypes = ['NGO', 'PANCHAYAT', 'DISTRICT_AUTHORITY', 'STATE_AUTHORITY'];
  if (!orgType || !validTypes.includes(orgType)) {
    return res.status(400).json({
      error: 'Invalid organization type. Must be NGO, PANCHAYAT, DISTRICT_AUTHORITY, or STATE_AUTHORITY'
    });
  }

  if (orgType === 'PANCHAYAT' && (!panchayatId || !String(panchayatId).trim())) {
    return res.status(400).json({ error: 'Panchayat ID or code is required for Gram Panchayat registration' });
  }

  const validation = validateAuthInput({
    name: contactName,
    orgName,
    email,
    phone,
    password,
    state,
    stateCode,
    district,
    districtCode,
    blockCode,
    panchayatId
  });

  if (!validation.isValid) {
    return res.status(400).json({ error: validation.errors[0], errors: validation.errors });
  }

  const { sanitized } = validation;
  if (!sanitized.name) return res.status(400).json({ error: 'Contact representative name is required' });
  if (!sanitized.orgName) return res.status(400).json({ error: 'Organization name is required' });
  if (!sanitized.email) return res.status(400).json({ error: 'Official email address is required' });
  if (!sanitized.phone) return res.status(400).json({ error: 'Official mobile number is required' });
  if (!password || String(password).length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters long' });

  let role = 'ngo';
  let authorityLevel = null;
  if (orgType === 'PANCHAYAT') {
    role = 'control';
    authorityLevel = 'GRAM_PANCHAYAT';
  } else if (orgType === 'DISTRICT_AUTHORITY') {
    role = 'control';
    authorityLevel = 'DISTRICT';
  } else if (orgType === 'STATE_AUTHORITY') {
    role = 'control';
    authorityLevel = 'STATE';
  }

  try {
    if (mongoose.connection && mongoose.connection.readyState === 1) {
      const existing = await User.findOne({
        $or: [{ email: sanitized.email }, { phone: sanitized.phone }]
      });
      if (existing) {
        return res.status(409).json({ error: 'An account with this email or mobile number already exists.' });
      }
    }

    const passwordHash = await bcrypt.hash(password, 12);
    let entity = null;
    let user = null;

    if (mongoose.connection && mongoose.connection.readyState === 1) {
      try {
        entity = await VerifiedEntity.create({
          organizationName: sanitized.orgName,
          name: sanitized.orgName,
          organizationType: orgType,
          authorityLevel,
          registrationNumber: registrationNumber ? String(registrationNumber).trim() : null,
          representativeName: sanitized.name,
          phone: sanitized.phone,
          email: sanitized.email,
          state: sanitized.state,
          district: sanitized.district,
          stateCode: sanitized.stateCode,
          districtCode: sanitized.districtCode,
          block: sanitized.blockCode,
          blockCode: sanitized.blockCode,
          panchayatId: sanitized.panchayatId,
          verificationStatus: 'PENDING',
          status: 'PENDING',
          capabilities: orgType === 'NGO'
            ? ['First Aid', 'Relief Distribution', 'Medical']
            : ['Evacuation', 'Relief Distribution', 'Shelter Support']
        });

        let ngoDoc = null;
        if (orgType === 'NGO') {
          ngoDoc = await NGO.create({
            name: sanitized.orgName,
            contactPerson: sanitized.name,
            phone: sanitized.phone,
            email: sanitized.email,
            state: sanitized.state,
            district: sanitized.district,
            stateCode: sanitized.stateCode,
            districtCode: sanitized.districtCode,
            verificationStatus: 'PENDING',
            verifiedEntityId: entity._id,
            registrationNumber: registrationNumber ? String(registrationNumber).trim() : null
          });
        }

        user = await User.create({
          name: sanitized.name,
          email: sanitized.email,
          phone: sanitized.phone,
          passwordHash,
          role,
          accountStatus: 'ACTIVE',
          verificationStatus: 'PENDING',
          organizationId: entity._id,
          ngo: ngoDoc ? ngoDoc._id : null,
          authorityLevel,
          state: sanitized.state,
          district: sanitized.district,
          stateCode: sanitized.stateCode,
          districtCode: sanitized.districtCode,
          blockCode: sanitized.blockCode,
          panchayatId: sanitized.panchayatId
        });
      } catch (createErr) {
        if (entity && entity._id) {
          await VerifiedEntity.findByIdAndDelete(entity._id).catch(() => {});
        }
        if (createErr.code === 11000 || String(createErr.message).includes('E11000')) {
          return res.status(409).json({ error: 'An account with this email or mobile number already exists.' });
        }
        throw createErr;
      }
    } else {
      const existingMem = memoryStore.users.find(u => u.email === sanitized.email || u.phone === sanitized.phone);
      if (existingMem) {
        return res.status(409).json({ error: 'An account with this email or mobile number already exists.' });
      }
      entity = {
        _id: `entity-${Date.now()}`,
        organizationName: sanitized.orgName,
        organizationType: orgType,
        verificationStatus: 'PENDING',
        status: 'PENDING'
      };
      user = {
        _id: `user-${Date.now()}`,
        id: `user-${Date.now()}`,
        name: sanitized.name,
        email: sanitized.email,
        phone: sanitized.phone,
        role,
        accountStatus: 'ACTIVE',
        verificationStatus: 'PENDING',
        organizationId: entity._id
      };
      memoryStore.users.push(user);
    }

    await logAuditEvent({
      actorId: user._id || user.id,
      actorName: user.name,
      actorRole: user.role,
      action: 'ORG_REGISTERED',
      targetId: entity._id || entity.id,
      targetType: 'VerifiedEntity',
      jurisdiction: { state: sanitized.state, district: sanitized.district },
      details: { organizationName: sanitized.orgName, organizationType: orgType, email: sanitized.email }
    });

    emitAdminPendingUpdate(entity);

    res.status(201).json({
      message: 'Registration submitted successfully. Your account is pending administrator verification.',
      token: createToken(user),
      user: publicUser(user)
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Organization Login: POST /api/auth/login (email + password)
app.post('/api/auth/login', async (req, res) => {
  const { email, password } = req.body;
  const cleanEmail = normalizeEmail(email);

  if (!cleanEmail || !password) {
    return res.status(400).json({ error: 'Please provide both email and password' });
  }

  // Rate limiting: 20 per IP per 15 min
  const ipCheck = limiter.check(`ip:${req.ip}:login`, 20, 15 * 60 * 1000);
  if (!ipCheck.allowed) {
    res.setHeader('Retry-After', ipCheck.retryAfterSeconds);
    return res.status(429).json({
      error: `Too many login attempts from this IP. Please try again in ${ipCheck.retryAfterSeconds} seconds.`,
      code: 'RATE_LIMIT_EXCEEDED',
      retryAfter: ipCheck.retryAfterSeconds
    });
  }

  try {
    let user = null;
    if (mongoose.connection && mongoose.connection.readyState === 1) {
      user = await User.findOne({ email: cleanEmail }).populate('organizationId');
    }

    // Constant-time compare dummy hash if user does not exist
    const dummyHash = '$2b$12$e80yqZ68Z10LZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZ';

    if (user && user.lockedUntil && user.lockedUntil > new Date()) {
      const waitMin = Math.ceil((user.lockedUntil - new Date()) / 60000);
      await logAuditEvent({
        actorId: user._id,
        actorName: user.name,
        actorRole: user.role,
        action: 'LOGIN_LOCKED',
        targetId: user._id,
        targetType: 'User',
        details: { email: cleanEmail }
      });
      return res.status(403).json({
        error: `Account is temporarily locked due to 5 consecutive failed login attempts. Please try again in ${waitMin} minute(s).`,
        code: 'ACCOUNT_LOCKED',
        lockedUntil: user.lockedUntil
      });
    }

    const hashToCompare = (user && user.passwordHash) ? user.passwordHash : dummyHash;
    const isMatch = await bcrypt.compare(String(password), hashToCompare);

    if (!user || !user.passwordHash || !isMatch) {
      if (user) {
        user.failedLoginCount = (user.failedLoginCount || 0) + 1;
        if (user.failedLoginCount >= 5) {
          user.lockedUntil = new Date(Date.now() + 15 * 60 * 1000);
          await user.save();
          await logAuditEvent({
            actorId: user._id,
            actorName: user.name,
            actorRole: user.role,
            action: 'LOGIN_LOCKED',
            targetId: user._id,
            targetType: 'User',
            details: { email: cleanEmail, reason: 'Exceeded 5 failed attempts' }
          });
          return res.status(403).json({
            error: 'Account locked due to 5 failed login attempts. Locked for 15 minutes.',
            code: 'ACCOUNT_LOCKED'
          });
        }
        await user.save();
        await logAuditEvent({
          actorId: user._id,
          actorName: user.name,
          actorRole: user.role,
          action: 'LOGIN_FAILED',
          targetId: user._id,
          targetType: 'User',
          details: { email: cleanEmail, attempts: user.failedLoginCount }
        });
      }
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    if (user.accountStatus === 'DISABLED') {
      return res.status(403).json({
        error: 'This account has been disabled. Please contact the platform administrator.',
        code: 'ACCOUNT_DISABLED'
      });
    }

    // Reset lockout counters on success
    user.failedLoginCount = 0;
    user.lockedUntil = null;
    user.lastLoginAt = new Date();
    await user.save();

    await logAuditEvent({
      actorId: user._id,
      actorName: user.name,
      actorRole: user.role,
      action: 'LOGIN_SUCCESS',
      targetId: user._id,
      targetType: 'User',
      jurisdiction: { state: user.state, district: user.district },
      details: { email: cleanEmail }
    });

    res.json({
      token: createToken(user),
      user: publicUser(user)
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Change Password: POST /api/auth/change-password
app.post('/api/auth/change-password', requireAuth, async (req, res) => {
  const { currentPassword, newPassword } = req.body;
  if (!newPassword || String(newPassword).length < 8 || String(newPassword).length > 72) {
    return res.status(400).json({ error: 'New password must be between 8 and 72 characters long' });
  }

  try {
    if (mongoose.connection && mongoose.connection.readyState === 1) {
      const user = await User.findById(req.user.id);
      if (!user) return res.status(404).json({ error: 'User not found' });

      if (user.passwordHash && !user.mustChangePassword) {
        if (!currentPassword) {
          return res.status(400).json({ error: 'Please provide current password' });
        }
        const match = await bcrypt.compare(currentPassword, user.passwordHash);
        if (!match) {
          return res.status(400).json({ error: 'Current password is incorrect' });
        }
      }

      user.passwordHash = await bcrypt.hash(newPassword, 12);
      user.mustChangePassword = false;
      await user.save();

      await logAuditEvent({
        actorId: user._id,
        actorName: user.name,
        actorRole: user.role,
        action: 'PASSWORD_CHANGED',
        targetId: user._id,
        targetType: 'User'
      });

      return res.json({ message: 'Password changed successfully', user: publicUser(user) });
    }

    res.json({ message: 'Password changed successfully', user: publicUser(req.user) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Who am I? GET /api/auth/me (Returns fresh status from MongoDB)
app.get('/api/auth/me', requireAuth, async (req, res) => {
  try {
    if (mongoose.connection && mongoose.connection.readyState === 1 && req.user.id && mongoose.isValidObjectId(req.user.id)) {
      const user = await User.findById(req.user.id).populate('organizationId');
      if (!user) {
        return res.status(404).json({ error: 'User not found' });
      }
      return res.json(publicUser(user));
    }
    res.json(publicUser(req.user));
  } catch (err) {
    res.json(publicUser(req.user));
  }
});

// Logout: POST /api/auth/logout (Audit only)
app.post('/api/auth/logout', optionalAuth, async (req, res) => {
  if (req.user) {
    await logAuditEvent({
      actorId: req.user.id,
      actorName: req.user.name,
      actorRole: req.user.role,
      action: 'LOGOUT',
      targetId: req.user.id,
      targetType: 'User'
    });
  }
  res.json({ message: 'Logged out successfully' });
});

// Register trusted emergency device using WebCrypto public key (runs for ALL logged-in account types)
app.post('/api/auth/devices/register', optionalAuth, async (req, res) => {
  const { deviceId, publicKey, deviceName } = req.body;
  if (!deviceId || !publicKey) {
    return res.status(400).json({ error: 'deviceId and publicKey are required' });
  }
  const userId = req.user?.id || req.body.userId || 'demo-villager';
  try {
    const device = await registerDevice(userId, deviceId, publicKey, deviceName);
    res.status(201).json({ success: true, device });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Revoke a trusted emergency device
app.post('/api/auth/devices/revoke', optionalAuth, async (req, res) => {
  const { deviceId } = req.body;
  if (!deviceId) {
    return res.status(400).json({ error: 'deviceId is required' });
  }
  const userId = req.user?.id || req.body.userId || 'demo-villager';
  try {
    await revokeDevice(userId, deviceId);
    res.json({ success: true, revoked: true, message: 'Device revoked' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get Web Push VAPID Public Key
app.get('/api/alerts/vapid-public-key', (req, res) => {
  res.json({ publicKey: VAPID_PUBLIC_KEY });
});

// Subscribe to Web Push notifications
app.post('/api/alerts/subscribe', optionalAuth, (req, res) => {
  const { subscription, district, state } = req.body;
  if (!subscription || !subscription.endpoint) {
    return res.status(400).json({ error: 'Valid push subscription is required' });
  }
  savePushSubscription(subscription, {
    district: district || req.user?.district,
    state: state || req.user?.state,
    userId: req.user?.id,
    role: req.user?.role
  });
  res.status(201).json({ success: true, message: 'Web Push subscription registered' });
});

app.get('/', (req, res) => {
  res.send('Server is running');
});

async function connectDb() {
  const mongoUri = process.env.MONGODB_URI || process.env.MONGO_URI;
  if (!mongoUri) {
    console.error('Fatal Error: MONGODB_URI is required. Auth requires MongoDB as source of truth.');
    process.exit(1);
  }

  // Production JWT secret security verification
  const isProd = process.env.NODE_ENV === 'production' || process.env.APP_MODE === 'production';
  const jwtSecret = process.env.JWT_SECRET;
  if (isProd && (!jwtSecret || jwtSecret.length < 32)) {
    console.error('Fatal Security Error: In production, JWT_SECRET must be at least 32 characters long.');
    process.exit(1);
  }

  if (process.env.APP_MODE === 'demo') {
    console.log('\n****************************************************************');
    console.log('* WARNING: SAHAYTA SETU IS RUNNING IN DEMO MODE               *');
    console.log('* Simulated OTP delivery is enabled. Non-production sandbox.  *');
    console.log('****************************************************************\n');
  }

  try {
    await mongoose.connect(mongoUri, { serverSelectionTimeoutMS: 10000 });
    console.log(`MongoDB connected: ${mongoose.connection.name}`);

    // Sync unique indexes to ensure email and phone uniqueness
    await User.syncIndexes().catch((err) => console.warn('User index sync notice:', err.message));
    await VerifiedEntity.syncIndexes().catch((err) => console.warn('VerifiedEntity index sync notice:', err.message));

    // Super admin bootstrap
    if (process.env.SUPER_ADMIN_EMAIL && process.env.SUPER_ADMIN_PASSWORD) {
      const adminEmail = process.env.SUPER_ADMIN_EMAIL.toLowerCase().trim();
      const existing = await User.findOne({ role: 'super_admin' });
      if (!existing) {
        const hash = await bcrypt.hash(process.env.SUPER_ADMIN_PASSWORD, 12);
        await User.create({
          name: 'Platform Super Administrator',
          email: adminEmail,
          passwordHash: hash,
          role: 'super_admin',
          accountStatus: 'ACTIVE',
          verificationStatus: 'VERIFIED'
        });
        console.log(`✓ Super administrator bootstrapped: ${adminEmail}`);
      }
    }
  } catch (err) {
    console.error('Fatal Error: Failed to connect to MongoDB:', err.message);
    process.exit(1);
  }
}

const RiskZone = require('./models/riskZone');
const Shelter = require('./models/shelter');
const SOS = require('./models/sos');
const NGO = require('./models/ngo');
const Alert = require('./models/alert');
const EvacuationReport = require('./models/evacuationReport');
const { LEVEL_COLORS, buildAlertMessage, deliverSMS } = require('./services/alerts');

app.get('/api/risk-zones', async (req, res) => {
  try {
    const zones = await RiskZone.find();
    res.json(zones);
  } catch (err) {
    console.error('Risk zone lookup failed:', err.message);
    res.status(500).json({ error: 'Unable to load risk zones.' });
  }
});

// GET /api/shelters
// Returns active/open registered shelters & relief facilities from MongoDB
app.get('/api/shelters', async (req, res) => {
  const { state, district } = req.query;
  try {
    let dbShelters = [];
    if (mongoose.connection && mongoose.connection.readyState === 1) {
      const filter = { status: { $ne: 'CLOSED' } };
      if (state) filter.state = new RegExp(`^${state.trim()}$`, 'i');
      if (district) filter.district = new RegExp(`^${district.trim()}$`, 'i');
      dbShelters = await Shelter.find(filter).sort({ name: 1 }).lean();
    } else if (process.env.NODE_ENV === 'test') {
      dbShelters = (memoryStore.shelters || []).filter((s) => s.status !== 'CLOSED');
      if (state) dbShelters = dbShelters.filter((s) => !s.state || s.state.toLowerCase() === state.toLowerCase());
      if (district) dbShelters = dbShelters.filter((s) => !s.district || s.district.toLowerCase() === district.toLowerCase());
    }

    const formatted = dbShelters.map((s) => ({
      _id: String(s._id || s.id),
      id: String(s._id || s.id),
      name: s.name,
      lat: s.lat,
      lng: s.lng,
      capacity: s.capacity,
      currentOccupancy: s.currentOccupancy || s.occupancy || 0,
      occupancy: s.occupancy || s.currentOccupancy || 0,
      availableSpaces: Math.max(0, s.capacity - (s.currentOccupancy || s.occupancy || 0)),
      status: s.status || 'ACTIVE',
      type: s.type || 'SHELTER',
      address: s.address || '',
      state: s.state,
      district: s.district,
      stateCode: s.stateCode,
      districtCode: s.districtCode,
      blockCode: s.blockCode,
      panchayatId: s.panchayatId,
      publicContact: s.publicContact || null,
      servicesOffered: s.servicesOffered || ['Shelter', 'Emergency Relief'],
      organizationId: s.organizationId,
      organizationName: s.organizationName,
      verified: Boolean(s.verified !== false)
    }));

    res.json(formatted);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Helper: full when occupancy reaches capacity
function computeShelterStatus(capacity, occupancy) {
  if (capacity > 0 && occupancy >= capacity) return 'FULL';
  return 'ACTIVE';
}

/**
 * GET /api/resources/nearby
 * Realtime nearby resources endpoint with strict civilian privacy masking,
 * geo-authorization, distance sorting, and auto-expanding radius (5 > 10 > 25 km).
 * Query params: lat, lng, radius (default 5), types (all | shelter,ngo,medical,relief), state, district
 */
app.get('/api/resources/nearby', optionalAuth, async (req, res) => {
  const numLat = parseFloat(req.query.lat);
  const numLng = parseFloat(req.query.lng);
  const requestedRadius = parseFloat(req.query.radius) || 5;
  const typesParam = (req.query.types || 'all').toLowerCase();
  const selectedState = req.query.state || '';
  const selectedDistrict = req.query.district || '';

  if (!Number.isFinite(numLat) || !Number.isFinite(numLng)) {
    return res.status(400).json({ error: 'Valid lat and lng query parameters are required' });
  }

  // Geo-authorization check if authorized token is present
  const user = req.user;
  if (user && (user.role === 'control' || user.role === 'panchayat' || user.role === 'district_authority')) {
    if (selectedDistrict || selectedState) {
      const check = verifyJurisdiction(user, { state: selectedState, district: selectedDistrict });
      if (!check.allowed) {
        return res.status(403).json({
          error: check.reason,
          code: 'GEO_AUTHORIZATION_DENIED'
        });
      }
    }
  }

  // Gather real shelters & relief facilities from MongoDB
  let allFacilities = [];
  try {
    if (isDbMode()) {
      const filter = { status: { $in: ['ACTIVE', 'Available', 'Full', 'FULL'] }, verified: { $ne: false } };
      if (selectedState) filter.state = new RegExp(`^${selectedState.trim()}$`, 'i');
      if (selectedDistrict) filter.district = new RegExp(`^${selectedDistrict.trim()}$`, 'i');
      allFacilities = await Shelter.find(filter).lean();
    } else {
      allFacilities = (memoryStore.shelters || []).filter((s) => s.status !== 'CLOSED');
    }
  } catch (err) {
    allFacilities = [];
  }

  // Gather verified NGOs / responders
  let allNgos = [];
  try {
    if (isDbMode()) {
      allNgos = await NGO.find({ available: true, verificationStatus: 'VERIFIED' }).lean().catch(() => []);
    } else {
      allNgos = memoryStore.ngos || [];
    }
  } catch (err) {
    allNgos = [];
  }

  // Helper to filter and calculate distances at radius R
  const evaluateAtRadius = (radiusKm) => {
    // 1. Calculate distances for public facilities (shelter, hospital, relief)
    const validFacilities = allFacilities
      .filter((f) => Number.isFinite(f.lat) && Number.isFinite(f.lng))
      .map((f) => {
        const dist = calculateDistanceKm({ lat: numLat, lng: numLng }, { lat: f.lat, lng: f.lng });
        const occ = Number(f.currentOccupancy || f.occupancy || 0);
        const cap = Number(f.capacity || 0);
        return {
          id: String(f._id || f.id),
          name: f.name,
          type: f.type || 'SHELTER',
          category: String(f.type || '').toLowerCase().includes('medical') || String(f.type || '').toLowerCase().includes('hospital') ? 'medical' : 'shelter',
          lat: f.lat,
          lng: f.lng,
          distanceKm: dist,
          capacity: cap,
          currentOccupancy: occ,
          occupancy: occ,
          availableSpaces: Math.max(0, cap - occ),
          status: f.status || 'ACTIVE',
          publicContact: f.publicContact || null,
          servicesOffered: f.servicesOffered || ['Relief', 'Shelter'],
          verified: Boolean(f.verified !== false)
        };
      })
      .filter((f) => f.distanceKm <= radiusKm);

    // 2. Count verified NGOs / volunteers within radius
    // Civilian privacy: NEVER expose exact volunteer coordinates or personal contact phone!
    let volunteerCount = 0;
    allNgos.forEach((ngo) => {
      const ngoPos = ngo.location || (Number.isFinite(ngo.lat) ? { lat: ngo.lat, lng: ngo.lng } : null);
      if (ngoPos && Number.isFinite(ngoPos.lat) && Number.isFinite(ngoPos.lng)) {
        const dist = calculateDistanceKm({ lat: numLat, lng: numLng }, ngoPos);
        if (dist <= radiusKm && (ngo.available || ngo.status === 'Available')) {
          volunteerCount++;
        }
      }
    });

    return { facilities: validFacilities, volunteerCount };
  };

  // Step-by-step radius expansion: requestedRadius -> 10km -> 25km
  const radiiSteps = [requestedRadius];
  if (!radiiSteps.includes(10) && requestedRadius < 10) radiiSteps.push(10);
  if (!radiiSteps.includes(25) && requestedRadius < 25) radiiSteps.push(25);

  let finalRadius = requestedRadius;
  let result = evaluateAtRadius(finalRadius);

  // If no public facilities found in initial radius, auto-expand
  if (result.facilities.length === 0) {
    for (const step of radiiSteps) {
      if (step > finalRadius) {
        const nextResult = evaluateAtRadius(step);
        if (nextResult.facilities.length > 0 || nextResult.volunteerCount > 0) {
          finalRadius = step;
          result = nextResult;
          break;
        }
      }
    }
  }

  // Type filter if requested (e.g. types=medical or types=shelter)
  let filteredFacilities = result.facilities;
  if (typesParam !== 'all') {
    const requestedTypes = typesParam.split(',').map((t) => t.trim().toLowerCase());
    filteredFacilities = result.facilities.filter((f) => {
      const cat = f.category.toLowerCase();
      const typ = f.type.toLowerCase();
      return requestedTypes.some((rt) => cat.includes(rt) || typ.includes(rt));
    });
  }

  // Sort facilities by distance ascending
  filteredFacilities.sort((a, b) => a.distanceKm - b.distanceKm);

  // Volunteer aggregate summary (strict privacy preservation)
  const volunteerSummary = {
    count: result.volunteerCount,
    radiusKm: finalRadius,
    message: `${result.volunteerCount} verified volunteers available within ${finalRadius} km`,
    contactRoute: 'Request dispatch via Gram Panchayat Control Centre'
  };

  // Short-lived cache suitable for dynamic availability
  res.set('Cache-Control', 'public, max-age=15');

  return res.json({
    success: true,
    userCoords: [numLat, numLng],
    radiusKm: finalRadius,
    originalRadius: requestedRadius,
    expanded: finalRadius > requestedRadius,
    totalFacilities: filteredFacilities.length,
    resources: filteredFacilities,
    volunteerSummary
  });
});

// Add a shelter / resource (Control Centre or NGO with verified status)
app.post('/api/shelters', requireRole('control', 'ngo', 'super_admin'), requireVerified, async (req, res) => {
  const { name, type, capacity, address, servicesOffered, publicContact, state, district, stateCode, districtCode, blockCode, panchayatId } = req.body;
  const lat = req.body.lat !== undefined ? req.body.lat : req.body.location?.lat;
  const lng = req.body.lng !== undefined ? req.body.lng : req.body.location?.lng;
  const occupancy = Number(req.body.occupancy || req.body.currentOccupancy) || 0;

  if (!name || !String(name).trim()) {
    return res.status(400).json({ error: 'Please provide the shelter / resource name' });
  }
  if (!Number.isFinite(Number(lat)) || !Number.isFinite(Number(lng))) {
    return res.status(400).json({ error: 'Please provide valid latitude and longitude coordinates' });
  }
  if (!(Number(capacity) > 0)) {
    return res.status(400).json({ error: 'Capacity must be greater than 0' });
  }

  // Geo-authorization: control authority must be within their jurisdiction
  const user = req.user;
  const shelterState = state || user.state;
  const shelterDistrict = district || user.district;

  if (user.role === 'control' || user.role === 'panchayat' || user.role === 'district_authority') {
    const check = verifyJurisdiction(user, { state: shelterState, district: shelterDistrict });
    if (!check.allowed) {
      return res.status(403).json({ error: check.reason, code: 'GEO_AUTHORIZATION_DENIED' });
    }
  }

  try {
    const rawType = String(type || 'SHELTER').toUpperCase();
    const validatedType = ['SHELTER', 'MEDICAL', 'RELIEF_POINT'].includes(rawType) ? rawType : 'SHELTER';
    const computedStatus = computeShelterStatus(Number(capacity), occupancy);

    let shelter = null;
    if (mongoose.connection && mongoose.connection.readyState === 1) {
      shelter = await Shelter.create({
        type: validatedType,
        name: String(name).trim(),
        address: address ? String(address).trim() : '',
        lat: Number(lat),
        lng: Number(lng),
        capacity: Number(capacity),
        occupancy,
        currentOccupancy: occupancy,
        servicesOffered: Array.isArray(servicesOffered) ? servicesOffered : (servicesOffered ? [servicesOffered] : ['Emergency Relief']),
        publicContact: publicContact ? String(publicContact).trim() : (user.phone || null),
        status: computedStatus,
        state: shelterState,
        district: shelterDistrict,
        stateCode: stateCode || user.stateCode || null,
        districtCode: districtCode || user.districtCode || null,
        blockCode: blockCode || user.blockCode || null,
        panchayatId: panchayatId || user.panchayatId || null,
        createdBy: user.id || user._id,
        organizationId: user.organizationId || null,
        organizationName: user.name,
        verified: true
      });
    } else if (process.env.NODE_ENV === 'test') {
      shelter = {
        _id: `shelter_${Date.now()}`,
        id: `shelter_${Date.now()}`,
        type: validatedType,
        name: String(name).trim(),
        address: address || '',
        lat: Number(lat),
        lng: Number(lng),
        capacity: Number(capacity),
        occupancy,
        currentOccupancy: occupancy,
        servicesOffered: ['Emergency Relief'],
        publicContact: publicContact || null,
        status: computedStatus,
        state: shelterState,
        district: shelterDistrict,
        verified: true
      };
      memoryStore.shelters.push(shelter);
    }

    emitResourceCreated(shelter);

    await logAuditEvent({
      actorId: user.id,
      actorName: user.name,
      actorRole: user.role,
      action: 'SHELTER_CREATED',
      targetId: shelter._id || shelter.id,
      targetType: 'Shelter',
      jurisdiction: { state: shelter.state, district: shelter.district },
      details: { name: shelter.name, capacity: shelter.capacity }
    });

    res.status(201).json(shelter);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Update occupancy or capacity / details (Control Centre or NGO)
app.patch('/api/shelters/:id', requireRole('control', 'ngo'), requireVerified, async (req, res) => {
  const { id } = req.params;
  const user = req.user;

  try {
    let shelter = null;
    if (mongoose.connection && mongoose.connection.readyState === 1) {
      if (!mongoose.isValidObjectId(id)) {
        return res.status(400).json({ error: 'Invalid shelter ID' });
      }
      shelter = await Shelter.findById(id);
      if (!shelter) return res.status(404).json({ error: 'Shelter not found' });

      // Geo-auth check
      if (user.role === 'control' || user.role === 'panchayat') {
        const check = verifyJurisdiction(user, { state: shelter.state, district: shelter.district });
        if (!check.allowed) {
          return res.status(403).json({ error: check.reason, code: 'GEO_AUTHORIZATION_DENIED' });
        }
      }

      if (req.body.capacity !== undefined) {
        const cap = Number(req.body.capacity);
        if (!(cap > 0)) return res.status(400).json({ error: 'Capacity must be greater than 0' });
        shelter.capacity = cap;
      }

      if (req.body.occupancy !== undefined || req.body.currentOccupancy !== undefined) {
        const occ = Number(req.body.occupancy !== undefined ? req.body.occupancy : req.body.currentOccupancy);
        if (!Number.isFinite(occ) || occ < 0) return res.status(400).json({ error: 'Occupancy must be 0 or more' });
        shelter.occupancy = Math.min(occ, shelter.capacity);
        shelter.currentOccupancy = shelter.occupancy;
      }

      if (req.body.status) {
        const st = String(req.body.status).toUpperCase();
        if (['ACTIVE', 'FULL', 'CLOSED'].includes(st)) {
          shelter.status = st;
        }
      } else {
        shelter.status = computeShelterStatus(shelter.capacity, shelter.currentOccupancy);
      }

      if (req.body.publicContact !== undefined) shelter.publicContact = req.body.publicContact;
      if (req.body.address !== undefined) shelter.address = req.body.address;
      if (req.body.servicesOffered !== undefined) shelter.servicesOffered = req.body.servicesOffered;

      shelter.lastStatusAt = new Date();
      await shelter.save();
    } else if (process.env.NODE_ENV === 'test') {
      shelter = (memoryStore.shelters || []).find((s) => String(s._id) === String(id) || String(s.id) === String(id));
      if (!shelter) return res.status(404).json({ error: 'Shelter not found' });
      if (req.body.capacity) shelter.capacity = Number(req.body.capacity);
      if (req.body.currentOccupancy !== undefined) shelter.currentOccupancy = Number(req.body.currentOccupancy);
      shelter.status = computeShelterStatus(shelter.capacity, shelter.currentOccupancy || 0);
    }

    emitResourceUpdated(shelter);

    res.json(shelter);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Remove or close a shelter
app.delete('/api/shelters/:id', requireRole('control', 'ngo'), requireVerified, async (req, res) => {
  const { id } = req.params;
  const user = req.user;

  try {
    let shelter = null;
    if (mongoose.connection && mongoose.connection.readyState === 1) {
      if (!mongoose.isValidObjectId(id)) {
        return res.status(400).json({ error: 'Invalid shelter ID' });
      }
      shelter = await Shelter.findById(id);
      if (!shelter) return res.status(404).json({ error: 'Shelter not found' });

      // Geo-auth check
      if (user.role === 'control' || user.role === 'panchayat') {
        const check = verifyJurisdiction(user, { state: shelter.state, district: shelter.district });
        if (!check.allowed) {
          return res.status(403).json({ error: check.reason, code: 'GEO_AUTHORIZATION_DENIED' });
        }
      }

      await Shelter.findByIdAndDelete(id);
    } else if (process.env.NODE_ENV === 'test') {
      const idx = (memoryStore.shelters || []).findIndex((s) => String(s._id) === String(id) || String(s.id) === String(id));
      if (idx !== -1) {
        shelter = memoryStore.shelters[idx];
        memoryStore.shelters.splice(idx, 1);
      }
    }

    if (!shelter) return res.status(404).json({ error: 'Shelter not found' });

    emitResourceClosed(id, { district: shelter.district, name: shelter.name });

    res.json({ message: 'Shelter removed successfully', id });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Close shelter alias: POST /api/shelters/:id/close
app.post('/api/shelters/:id/close', requireRole('control', 'ngo', 'super_admin'), requireVerified, async (req, res) => {
  const { id } = req.params;
  const user = req.user;

  try {
    let shelter = null;
    if (mongoose.connection && mongoose.connection.readyState === 1) {
      if (!mongoose.isValidObjectId(id)) return res.status(400).json({ error: 'Invalid shelter ID' });
      shelter = await Shelter.findById(id);
      if (!shelter) return res.status(404).json({ error: 'Shelter not found' });

      if (user.role === 'control' || user.role === 'panchayat') {
        const check = verifyJurisdiction(user, { state: shelter.state, district: shelter.district });
        if (!check.allowed) return res.status(403).json({ error: check.reason, code: 'GEO_AUTHORIZATION_DENIED' });
      }

      shelter.status = 'CLOSED';
      shelter.lastStatusAt = new Date();
      await shelter.save();
    } else if (process.env.NODE_ENV === 'test') {
      shelter = (memoryStore.shelters || []).find((s) => String(s._id) === String(id) || String(s.id) === String(id));
      if (shelter) shelter.status = 'CLOSED';
    }

    if (!shelter) return res.status(404).json({ error: 'Shelter not found' });

    emitResourceClosed(id, { district: shelter.district, name: shelter.name });
    res.json({ message: 'Shelter closed successfully', shelter });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Create SOS (Direct or Offline Sync)
async function handleEmergencySOS(req, res, isRelay = false) {
  try {
    const raw = req.body || {};
    const payload = raw.payload || raw;
    const clientIncidentId = payload.clientIncidentId || raw.clientIncidentId || `inc-${Date.now()}-${Math.floor(Math.random()*1000)}`;
    const userId = req.user?.id || raw.userId || payload.userId || 'demo-villager';
    const deviceId = raw.deviceId || payload.deviceId;
    const signature = raw.signature || payload.signature;

    // 1. Idempotency Check: if already exists, return existing immediately without duplicate
    const existingMemory = memoryStore.sos.find(s => s.clientIncidentId === clientIncidentId || s._id === clientIncidentId);
    if (existingMemory) {
      return res.status(200).json({
        status: 'existing',
        message: 'Emergency request already registered',
        sos: existingMemory
      });
    }

    if (mongoose.connection && mongoose.connection.readyState === 1) {
      const existingDb = await SOS.findOne({ clientIncidentId }).populate('assignedTo', 'name phone district');
      if (existingDb) {
        return res.status(200).json({
          status: 'existing',
          message: 'Emergency request already registered',
          sos: existingDb
        });
      }
    }

    // 2. Cryptographic signature verification if device identity provided
    let verifiedDevice = null;
    if (deviceId && signature) {
      // If verifying, remove the signature property if it exists on payload
      let verificationPayload = payload;
      if (payload && payload.signature) {
        const { signature: _sig, ...cleanPayload } = payload;
        verificationPayload = cleanPayload;
      }
      const validation = await validateEmergencyPacket({
        userId,
        deviceId,
        payload: verificationPayload,
        signature
      });

      if (!validation.valid) {
        let status = 400;
        if (validation.code === 'DEVICE_UNKNOWN' || validation.code === 'DEVICE_REVOKED') {
          status = 403;
        } else if (validation.code === 'PAYLOAD_EXPIRED') {
          status = 410;
        }
        return res.status(status).json({
          ok: false,
          code: validation.code || 'VALIDATION_ERROR',
          error: validation.error,
          message: validation.error
        });
      }
      verifiedDevice = validation.device;
    }

    // 3. Extract and normalize location & metadata
    const lat = Number(payload.latitude !== undefined ? payload.latitude : payload.location?.lat);
    const lng = Number(payload.longitude !== undefined ? payload.longitude : payload.location?.lng);
    const location = Number.isFinite(lat) && Number.isFinite(lng) ? { lat, lng } : { lat: 30.3165, lng: 78.0322 };

    const user = req.user ? await User.findById(req.user.id).catch(() => null) : null;
    const district = payload.district || user?.district || req.user?.district || 'Dehradun';
    const state = payload.state || user?.state || req.user?.state || 'Uttarakhand';
    const village = payload.village || user?.village || req.user?.village || 'Unknown';
    const incidentType = payload.incidentType || payload.type || 'Medical';
    const locationSource = payload.locationSource || (payload.isApproximateLocation ? 'DISTRICT_FALLBACK' : 'GPS_EXACT');
    const locationAccuracy = Number(payload.locationAccuracy) || (locationSource === 'GPS_EXACT' ? 18 : 1000);
    const priority = payload.priority || 'HIGH';
    const hopCount = Number(raw.hopCount || payload.hopCount || 0);
    const relayDeviceId = raw.relayDeviceId || null;

    const candidateReporter = req.user?.id || user?._id || verifiedDevice?.userId || (mongoose.isValidObjectId(userId) ? userId : null);
    const reportedBy = candidateReporter && mongoose.isValidObjectId(candidateReporter)
      ? new mongoose.Types.ObjectId(candidateReporter)
      : null;

    const sosObj = {
      _id: clientIncidentId,
      clientIncidentId,
      deviceId: deviceId || null,
      location,
      village,
      district,
      state,
      type: incidentType,
      priority,
      description: payload.description || `Emergency ${incidentType} dispatch request`,
      locationAccuracy,
      locationSource,
      isApproximateLocation: locationSource !== 'GPS_EXACT',
      peopleAffected: Number(payload.peopleAffected || 1),
      vulnerableCount: Number(payload.vulnerableCount || 0),
      needsMedical: Boolean(payload.needsMedical),
      sourceChannel: payload.sourceChannel || raw.sourceChannel || 'DIRECT_INTERNET',
      isLite: false,
      detailsSynced: true,
      detailsSyncedAt: new Date(),
      status: 'Pending',
      timestamp: new Date(),
      createdAt: new Date(payload.createdAt || payload.timestamp || Date.now()),
      receivedAt: new Date(),
      signature: signature || null,
      hopCount,
      relayDeviceId,
      assignedTo: null,
      assignedAt: null,
      resolvedAt: null,
      responderLocation: null,
      responderDistanceKm: null,
      reportedBy,
      contactName: user?.name || req.user?.name || payload.contactName || 'Civic Reporter',
      contactPhone: user?.phone || req.user?.phone || payload.contactPhone || '+919876543210'
    };

    // 4. Smart Responder Proximity Matching & Load Balancing
    let dbNgos = [];
    if (isDbMode()) {
      dbNgos = await NGO.find({ status: { $ne: 'Offline' } });
    }
    const candidateNgos = dbNgos.length > 0 ? dbNgos : memoryStore.ngos;
    const candidateActiveSos = (isDbMode())
      ? await SOS.find({ status: 'In Progress' })
      : memoryStore.sos;

    const matchedResponders = await matchNearestResponders(sosObj, candidateNgos, candidateActiveSos);

    // Save
    if (!isDbMode()) {
      memoryStore.sos.unshift(sosObj);
    } else {
      const sos = new SOS(sosObj);
      await sos.save();
    }

    // 5. Audit Logging
    await logAuditEvent({
      actorId: candidateReporter || 'citizen',
      actorName: sosObj.contactName,
      actorRole: 'villager',
      action: 'SOS_CREATED',
      targetId: clientIncidentId,
      targetType: 'SOS',
      jurisdiction: { state, district, village },
      details: {
        priority,
        type: incidentType,
        isRelay,
        hopCount,
        sourceChannel: sosObj.sourceChannel,
        deviceId: sosObj.deviceId
      }
    });

    // 6. Real-time Socket.IO Broadcast
    broadcastNewSOS(sosObj, matchedResponders);

    return res.status(201).json({
      ...sosObj,
      matchedResponders: matchedResponders.slice(0, 3),
      relayMeta: isRelay ? { relayed: true, hopCount } : undefined
    });
  } catch (err) {
    console.error('SOS Creation Error:', err);
    if (err.name === 'ValidationError') {
      return res.status(400).json({ ok: false, code: 'VALIDATION_ERROR', error: err.message, message: err.message });
    }
    if (err.name === 'MongoNetworkError' || (mongoose.connection && mongoose.connection.readyState === 0)) {
      return res.status(503).json({ ok: false, code: 'DB_UNAVAILABLE', error: 'Database unavailable', message: 'Database unavailable' });
    }
    res.status(400).json({ ok: false, code: 'VALIDATION_ERROR', error: err.message, message: err.message });
  }
}

// Ingestion for SOS Lite (< 1 KB compact emergency packet)
async function handleSosLite(req, res) {
  try {
    const raw = req.body || {};
    const packet = raw.payload || raw;
    const clientIncidentId = packet.clientIncidentId || raw.clientIncidentId;
    const deviceId = raw.deviceId || packet.deviceId;
    const signature = raw.signature || packet.signature;

    if (!clientIncidentId) {
      return res.status(400).json({ ok: false, code: 'VALIDATION_ERROR', field: 'clientIncidentId', error: 'clientIncidentId is required', message: 'clientIncidentId is required' });
    }
    if (!deviceId) {
      return res.status(400).json({ ok: false, code: 'VALIDATION_ERROR', field: 'deviceId', error: 'deviceId is required', message: 'deviceId is required' });
    }
    if (!signature) {
      return res.status(400).json({ ok: false, code: 'VALIDATION_ERROR', field: 'signature', error: 'signature is required', message: 'signature is required' });
    }

    // 1. Idempotency Check
    const existingMemory = memoryStore.sos.find(s => s.clientIncidentId === clientIncidentId || s._id === clientIncidentId);
    if (existingMemory) {
      return res.status(200).json({
        status: 'existing',
        message: 'Emergency request already registered',
        sos: existingMemory
      });
    }

    if (isDbMode()) {
      const existingDb = await SOS.findOne({ clientIncidentId }).populate('assignedTo', 'name phone district');
      if (existingDb) {
        return res.status(200).json({
          status: 'existing',
          message: 'Emergency request already registered',
          sos: existingDb
        });
      }
    }

    // 2. Cryptographic signature verification using canonical unsigned SOS Lite payload
    const unsigned = getUnsignedLitePayload(packet);

    // Validate payload fields
    const liteCheck = validateSosLite(unsigned);
    if (!liteCheck.valid) {
      return res.status(400).json({
        ok: false,
        code: 'VALIDATION_ERROR',
        error: liteCheck.error,
        message: liteCheck.error
      });
    }

    const userId = req.user?.id || raw.userId || packet.userId;

    const validation = await validateEmergencyPacket({
      userId,
      deviceId,
      payload: unsigned,
      signature
    });

    if (!validation.valid) {
      let status = 400;
      if (validation.code === 'DEVICE_UNKNOWN' || validation.code === 'DEVICE_REVOKED') {
        status = 403;
      } else if (validation.code === 'PAYLOAD_EXPIRED') {
        status = 410;
      }
      return res.status(status).json({
        ok: false,
        code: validation.code || 'VALIDATION_ERROR',
        error: validation.error,
        message: validation.error
      });
    }

    // 3. Extract and normalize location & priority
    const lat = Number(unsigned.lat);
    const lng = Number(unsigned.lng);
    const location = Number.isFinite(lat) && Number.isFinite(lng) ? { lat, lng } : { lat: 30.3165, lng: 78.0322 };

    const user = req.user ? await User.findById(req.user.id).catch(() => null) : null;
    const district = raw.district || packet.district || user?.district || req.user?.district || 'Dehradun';
    const state = raw.state || packet.state || user?.state || req.user?.state || 'Uttarakhand';
    const village = raw.village || packet.village || user?.village || req.user?.village || 'Unknown';
    const incidentType = unsigned.incidentType || 'Medical';
    const locationSource = unsigned.locationSource || 'GPS_EXACT';
    const locationAccuracy = Number(unsigned.locationAccuracy) || 18;
    const priority = computeLitePriority(unsigned);
    const peopleAffected = Number(unsigned.peopleAffected) || 1;
    const vulnerableCount = Number(unsigned.vulnerableCount) || 0;
    const needsMedical = Boolean(unsigned.needsMedical);
    const sourceChannel = raw.sourceChannel || packet.sourceChannel || 'DIRECT_INTERNET';
    const createdAt = new Date(unsigned.createdAt || Date.now());
    const receivedAt = new Date();

    const candidateReporter = req.user?.id || user?._id || validation.device?.userId || (mongoose.isValidObjectId(userId) ? userId : null);
    const reportedBy = candidateReporter && mongoose.isValidObjectId(candidateReporter)
      ? new mongoose.Types.ObjectId(candidateReporter)
      : null;

    const sosObj = {
      _id: clientIncidentId,
      clientIncidentId,
      deviceId,
      location,
      village,
      district,
      state,
      type: incidentType,
      priority,
      description: `Emergency ${incidentType} dispatch request (SOS Lite)`,
      locationAccuracy,
      locationSource,
      isApproximateLocation: locationSource !== 'GPS_EXACT',
      peopleAffected,
      vulnerableCount,
      needsMedical,
      sourceChannel,
      isLite: true,
      detailsSynced: false,
      detailsSyncedAt: null,
      status: 'Pending',
      createdAt,
      receivedAt,
      timestamp: createdAt,
      signature,
      hopCount: Number(raw.hopCount || packet.hopCount || 0),
      relayDeviceId: raw.relayDeviceId || packet.relayDeviceId || null,
      assignedTo: null,
      assignedAt: null,
      resolvedAt: null,
      responderLocation: null,
      responderDistanceKm: null,
      reportedBy,
      contactName: user?.name || req.user?.name || packet.contactName || 'Civic Reporter',
      contactPhone: user?.phone || req.user?.phone || packet.contactPhone || '+919876543210'
    };

    // 4. Smart Responder Proximity Matching & Load Balancing
    let dbNgos = [];
    if (isDbMode()) {
      dbNgos = await NGO.find({ status: { $ne: 'Offline' } });
    }
    const candidateNgos = dbNgos.length > 0 ? dbNgos : memoryStore.ngos;
    const candidateActiveSos = (isDbMode())
      ? await SOS.find({ status: 'In Progress' })
      : memoryStore.sos;

    const matchedResponders = await matchNearestResponders(sosObj, candidateNgos, candidateActiveSos);

    // Save
    if (!isDbMode()) {
      memoryStore.sos.unshift(sosObj);
    } else {
      const sos = new SOS(sosObj);
      await sos.save();
    }

    // 5. Audit Logging
    await logAuditEvent({
      actorId: candidateReporter || 'citizen',
      actorName: sosObj.contactName,
      actorRole: 'villager',
      action: 'SOS_CREATED',
      targetId: clientIncidentId,
      targetType: 'SOS',
      jurisdiction: { state, district, village },
      details: {
        priority,
        type: incidentType,
        isLite: true,
        sourceChannel,
        deviceId: sosObj.deviceId
      }
    });

    // 6. Real-time Broadcast
    broadcastNewSOS(sosObj, matchedResponders);

    return res.status(201).json({
      ...sosObj,
      matchedResponders: matchedResponders.slice(0, 3)
    });
  } catch (err) {
    console.error('SOS Lite Creation Error:', err);
    if (err.name === 'ValidationError') {
      return res.status(400).json({ ok: false, code: 'VALIDATION_ERROR', error: err.message, message: err.message });
    }
    if (err.name === 'MongoNetworkError' || (mongoose.connection && mongoose.connection.readyState === 0)) {
      return res.status(503).json({ ok: false, code: 'DB_UNAVAILABLE', error: 'Database unavailable', message: 'Database unavailable' });
    }
    res.status(400).json({ ok: false, code: 'VALIDATION_ERROR', error: err.message, message: err.message });
  }
}

// Follow-up Details Synchronization & Merge
async function handleSosDetails(req, res) {
  try {
    const clientIncidentId = req.body?.clientIncidentId || req.params?.id;
    if (!clientIncidentId) {
      return res.status(400).json({ error: 'clientIncidentId is required' });
    }

    let sos = memoryStore.sos.find(s => s.clientIncidentId === clientIncidentId || s._id === clientIncidentId);
    let dbDoc = null;
    if (!sos && isDbMode()) {
      const filter = mongoose.isValidObjectId(clientIncidentId)
        ? { $or: [{ clientIncidentId }, { _id: clientIncidentId }] }
        : { clientIncidentId };
      dbDoc = await SOS.findOne(filter).populate('assignedTo', 'name phone district');
      sos = dbDoc;
    }

    if (!sos) {
      return res.status(404).json({ error: `Emergency incident not found for clientIncidentId: ${clientIncidentId}` });
    }

    const { description, contactName, contactPhone, photos, extraNotes, requiredCapabilities, village } = req.body;

    if (description) sos.description = description;
    if (contactName) sos.contactName = contactName;
    if (contactPhone) sos.contactPhone = contactPhone;
    if (village && (sos.village === 'Unknown' || !sos.village)) sos.village = village;
    if (photos && Array.isArray(photos)) sos.photos = photos;
    if (extraNotes) {
      sos.triageNotes = sos.triageNotes ? `${sos.triageNotes}\n${extraNotes}` : extraNotes;
    }
    if (Array.isArray(requiredCapabilities) && requiredCapabilities.length > 0) {
      sos.requiredCapabilities = [...new Set([...(sos.requiredCapabilities || []), ...requiredCapabilities])];
    }
    sos.detailsSynced = true;
    sos.detailsSyncedAt = new Date();

    if (isDbMode() && dbDoc) {
      await dbDoc.save();
    }

    await logAuditEvent({
      actorId: req.user?.id || sos.reportedBy || 'citizen',
      actorName: contactName || sos.contactName || 'Civic Reporter',
      actorRole: req.user?.role || 'villager',
      action: 'SOS_DETAILS_UPDATED',
      targetId: sos.clientIncidentId || sos._id,
      targetType: 'SOS',
      jurisdiction: { state: sos.state, district: sos.district, village: sos.village },
      details: {
        clientIncidentId,
        detailsSynced: true
      }
    });

    const io = getIo();
    if (io) {
      io.emit('sos:details_updated', {
        clientIncidentId: sos.clientIncidentId,
        sos
      });
    }

    return res.status(200).json({
      status: 'merged',
      message: 'SOS details synchronized and merged successfully',
      sos
    });
  } catch (err) {
    console.error('SOS Details Merge Error:', err);
    res.status(500).json({ error: err.message });
  }
}

// Hook Socket.IO Lite ingestion
setSosLiteSocketHandler(async (data) => {
  return new Promise((resolve) => {
    const fakeReq = { body: data, user: null };
    const fakeRes = {
      statusCode: 200,
      status(c) { this.statusCode = c; return this; },
      json(payload) {
        resolve({ status: this.statusCode, data: payload });
      }
    };
    handleSosLite(fakeReq, fakeRes);
  });
});

app.post('/api/sos', optionalAuth, (req, res) => handleEmergencySOS(req, res, false));
app.post('/api/sos/relay', optionalAuth, (req, res) => handleEmergencySOS(req, res, true));
app.post('/api/sos/lite', optionalAuth, handleSosLite);
app.post('/api/sos/details', optionalAuth, handleSosDetails);
app.patch('/api/sos/:id/details', optionalAuth, handleSosDetails);

// List SOS requests with Strict Location-Based Authority Access and Civilian Privacy Protection
app.get('/api/sos', requireRole('ngo', 'control'), async (req, res) => {
  try {
    const { status, state, district } = req.query;

    // Strict Jurisdiction Check for Panchayat / Control Centre
    if (req.user.role === 'control') {
      const jurisdictionCheck = verifyJurisdiction(req.user, { district, state });
      if (!jurisdictionCheck.allowed) {
        return res.status(403).json({
          error: jurisdictionCheck.reason,
          code: 'GEO_AUTHORIZATION_DENIED',
          authorizedJurisdiction: { district: req.user.district, state: req.user.state }
        });
      }
    }

    const filter = {};
    if (status === 'active') {
      filter.status = { $in: ['Pending', 'Assigned', 'In Progress'] };
    } else if (status) {
      filter.status = status;
    }

    // Panchayat is locked to their district even if no query param is sent
    const enforcedDistrict = req.user.role === 'control' && req.user.district ? req.user.district : district;
    const enforcedState = req.user.role === 'control' && req.user.state ? req.user.state : state;

    if (enforcedState) filter.state = enforcedState;
    if (enforcedDistrict) filter.district = enforcedDistrict;

    if (!isDbMode()) {
      let filtered = [...memoryStore.sos];
      if (status === 'active') {
        filtered = filtered.filter(s => ['Pending', 'Assigned', 'In Progress'].includes(s.status));
      } else if (status) {
        filtered = filtered.filter(s => s.status === status);
      }
      if (enforcedState) {
        filtered = filtered.filter(s => !s.state || s.state.toLowerCase() === enforcedState.toLowerCase());
      }
      if (enforcedDistrict) {
        filtered = filtered.filter(s => !s.district || s.district.toLowerCase() === enforcedDistrict.toLowerCase());
      }
      // Apply Privacy Masking for unassigned responders
      return res.json(filtered.map(s => maskLocationForPrivacy(s, req.user)));
    }

    const requests = await SOS.find(filter)
      .sort({ timestamp: -1 })
      .populate('assignedTo', 'name phone district');

    // Apply Privacy Masking for unassigned responders
    res.json(requests.map(s => maskLocationForPrivacy(s, req.user)));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// A villager's own SOS requests
app.get('/api/sos/mine', requireAuth, async (req, res) => {
  try {
    if (!isDbMode()) {
      const mySos = memoryStore.sos.filter(s =>
        !s.reportedBy || s.reportedBy === req.user.id || req.user.role === 'villager'
      );
      return res.json(mySos);
    }

    const requests = await SOS.find({ reportedBy: req.user.id })
      .sort({ timestamp: -1 })
      .populate('assignedTo', 'name phone district');
    res.json(requests);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// One SOS request by id
app.get('/api/sos/:id', requireRole('ngo', 'control'), async (req, res) => {
  if (!isDbMode()) {
    const item = memoryStore.sos.find(s => s._id === req.params.id || s.clientIncidentId === req.params.id);
    return item ? res.json(item) : res.status(404).json({ error: 'SOS not found' });
  }

  try {
    const filter = mongoose.isValidObjectId(req.params.id)
      ? { _id: req.params.id }
      : { clientIncidentId: req.params.id };

    const sos = await SOS.findOne(filter).populate('assignedTo', 'name phone district');
    if (!sos) {
      return res.status(404).json({ error: 'SOS not found' });
    }
    res.json(sos);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get matched nearest responders for an SOS
app.get('/api/sos/:id/matched-responders', requireRole('ngo', 'control'), async (req, res) => {
  try {
    let sos = memoryStore.sos.find(s => s._id === req.params.id || s.clientIncidentId === req.params.id);
    if (!sos && isDbMode()) {
      const filter = mongoose.isValidObjectId(req.params.id)
        ? { $or: [{ _id: req.params.id }, { clientIncidentId: req.params.id }] }
        : { clientIncidentId: req.params.id };
      sos = await SOS.findOne(filter);
    }
    if (!sos) return res.status(404).json({ error: 'SOS not found' });

    let matched = [];
    if (isDbMode()) {
      // In DB mode, query real registered, verified, and active NGOs from DB directly without fake fallback
      matched = await matchNearestResponders(sos);
    } else {
      const ngos = memoryStore.ngos || [];
      const activeSos = memoryStore.sos || [];
      matched = await matchNearestResponders(sos, ngos, activeSos);
    }

    res.json(matched);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Panchayat / Control Centre Emergency Triage
app.post('/api/sos/:id/triage', requireRole('control'), requireVerified, async (req, res) => {
  const { id } = req.params;
  const { priority, requiredCapabilities, peopleAffected, triageNotes } = req.body;

  let sos = memoryStore.sos.find(s => s._id === id || s.clientIncidentId === id);
  if (!sos && isDbMode()) {
    const filter = mongoose.isValidObjectId(id)
      ? { $or: [{ _id: id }, { clientIncidentId: id }] }
      : { clientIncidentId: id };
    sos = await SOS.findOne(filter);
  }

  if (!sos) return res.status(404).json({ error: 'SOS incident not found' });

  // Strict Geo-Authorization check: user can only triage incidents in their jurisdiction
  const jurisdictionCheck = verifyJurisdiction(req.user, { district: sos.district, state: sos.state });
  if (!jurisdictionCheck.allowed) {
    return res.status(403).json({
      error: jurisdictionCheck.reason,
      code: 'GEO_AUTHORIZATION_DENIED',
      authorizedJurisdiction: { district: req.user.district, state: req.user.state }
    });
  }

  // Update triage attributes
  if (priority) sos.priority = priority;
  if (Array.isArray(requiredCapabilities)) sos.requiredCapabilities = requiredCapabilities;
  if (peopleAffected !== undefined) sos.peopleAffected = Number(peopleAffected) || 1;
  if (triageNotes) sos.triageNotes = triageNotes;
  sos.triagedBy = { id: req.user.id, name: req.user.name, role: req.user.role };
  sos.triagedAt = new Date();
  sos.isTriageComplete = true;

  if (isDbMode()) {
    if (typeof sos.save === 'function') await sos.save();
  }

  await logAuditEvent({
    actorId: req.user.id,
    actorName: req.user.name,
    actorRole: req.user.role,
    action: 'SOS_TRIAGED',
    targetId: sos.clientIncidentId || sos._id,
    targetType: 'SOS',
    jurisdiction: { state: sos.state, district: sos.district, village: sos.village },
    details: {
      priority: sos.priority,
      requiredCapabilities: sos.requiredCapabilities,
      peopleAffected: sos.peopleAffected,
      triageNotes: sos.triageNotes
    }
  });

  return res.json({ message: 'Triage complete', sos });
});

// Responder Mission Acceptance & Panchayat Dispatch with Assignment Locking
app.patch('/api/sos/:id/assign', requireRole('ngo', 'control'), requireVerified, async (req, res) => {
  const { id } = req.params;
  const isPanchayatDispatch = req.user.role === 'control' || req.user.role === 'panchayat' || req.user.role === 'super_admin';

  // Determine which responder is being assigned
  let targetNgoId = null;
  let targetNgoObj = null;

  if (isPanchayatDispatch) {
    targetNgoId = req.body.responderId || req.body.ngoId;
    if (!targetNgoId) {
      return res.status(400).json({ error: 'Please specify the responderId to dispatch' });
    }
    if (isDbMode()) {
      if (mongoose.isValidObjectId(targetNgoId)) {
        targetNgoObj = await NGO.findById(targetNgoId) || await VerifiedEntity.findById(targetNgoId);
      }
      if (!targetNgoObj) {
        targetNgoObj = await VerifiedEntity.findOne({ $or: [{ _id: targetNgoId }, { organizationName: targetNgoId }, { name: targetNgoId }] });
      }
    } else {
      targetNgoObj = memoryStore.ngos.find(n => n._id === targetNgoId) ||
        (memoryStore.entities || []).find(e => e._id === targetNgoId);
    }
    if (!targetNgoObj) {
      return res.status(404).json({ error: 'Selected responder unit not found in verified registry' });
    }
    const targetStatus = String(targetNgoObj.verificationStatus || targetNgoObj.status || 'VERIFIED').toUpperCase();
    if (targetStatus === 'SUSPENDED' || targetStatus === 'REVOKED' || targetStatus === 'REJECTED') {
      return res.status(403).json({ error: 'Selected responder unit is suspended or revoked from operational dispatch' });
    }
  } else {
    // NGO self-acceptance
    targetNgoId = req.user.ngo || req.user.id;
    if (req.user.verificationStatus === 'REVOKED' || req.user.verificationStatus === 'SUSPENDED') {
      return res.status(403).json({ error: 'Account suspended/revoked from operational missions' });
    }
    if (isDbMode()) {
      if (mongoose.isValidObjectId(targetNgoId)) {
        targetNgoObj = await NGO.findById(targetNgoId) || await VerifiedEntity.findById(targetNgoId);
      }
    }
    if (!targetNgoObj) {
      targetNgoObj = memoryStore.ngos.find(n => n._id === targetNgoId) || {
        _id: targetNgoId,
        name: req.user.name || 'Verified Response Unit',
        phone: req.user.phone || '+919876543210',
        district: req.user.district || 'Dehradun'
      };
    }
  }

  if (!isDbMode()) {
    const sos = memoryStore.sos.find(s => s._id === id || s.clientIncidentId === id);
    if (!sos) return res.status(404).json({ error: 'SOS not found' });

    // Strict Geo-Authorization check for Panchayat
    if (isPanchayatDispatch) {
      const check = verifyJurisdiction(req.user, { district: sos.district, state: sos.state });
      if (!check.allowed) {
        return res.status(403).json({
          error: check.reason,
          code: 'GEO_AUTHORIZATION_DENIED',
          authorizedJurisdiction: { district: req.user.district, state: req.user.state }
        });
      }
    }

    // Assignment locking: prevent race condition if another responder was already assigned
    if (sos.status !== 'Pending' && sos.assignedTo) {
      return res.status(409).json({
        error: 'This emergency request has already been assigned to another responder',
        assignedTo: sos.assignedTo,
        status: sos.status
      });
    }

    sos.status = 'In Progress';
    sos.assignedAt = new Date();
    sos.assignedTo = {
      _id: targetNgoObj._id || targetNgoId,
      name: targetNgoObj.name || targetNgoObj.organizationName || 'Response Team',
      phone: targetNgoObj.phone || '+919876543210',
      district: targetNgoObj.district || sos.district
    };

    // Calculate initial distance if responder location is known
    const responderPos = targetNgoObj.location;
    if (responderPos && sos.location) {
      sos.responderDistanceKm = calculateDistanceKm(responderPos, sos.location);
      sos.responderLocation = { ...responderPos, updatedAt: new Date() };
    }

    await logAuditEvent({
      actorId: req.user.id,
      actorName: req.user.name,
      actorRole: req.user.role,
      action: 'SOS_ASSIGNED',
      targetId: sos.clientIncidentId || sos._id,
      targetType: 'SOS',
      jurisdiction: { state: sos.state, district: sos.district, village: sos.village },
      details: {
        assignedTo: sos.assignedTo.name,
        assignedToId: sos.assignedTo._id,
        dispatchedBy: req.user.role
      }
    });

    broadcastSOSAssigned(sos);
    return res.json(sos);
  }

  // MongoDB mode
  try {
    const filter = mongoose.isValidObjectId(id)
      ? { $or: [{ _id: id }, { clientIncidentId: id }] }
      : { clientIncidentId: id };

    // Find and check geo jurisdiction if Panchayat dispatch
    const existingSos = await SOS.findOne(filter);
    if (!existingSos) return res.status(404).json({ error: 'SOS not found' });

    if (isPanchayatDispatch) {
      const check = verifyJurisdiction(req.user, { district: existingSos.district, state: existingSos.state });
      if (!check.allowed) {
        return res.status(403).json({
          error: check.reason,
          code: 'GEO_AUTHORIZATION_DENIED',
          authorizedJurisdiction: { district: req.user.district, state: req.user.state }
        });
      }
    }

    // Atomic assignment with locking: only succeeds if status is 'Pending'
    const updateFields = {
      assignedTo: targetNgoObj?._id || targetNgoId,
      assignedAt: new Date(),
      status: 'In Progress'
    };

    const responderPos = targetNgoObj?.location;
    if (responderPos && existingSos.location) {
      updateFields.responderDistanceKm = calculateDistanceKm(responderPos, existingSos.location);
      updateFields.responderLocation = { ...responderPos, updatedAt: new Date() };
    }

    const sos = await SOS.findOneAndUpdate(
      { ...filter, status: 'Pending' },
      updateFields,
      { new: true }
    ).populate('assignedTo', 'name phone district location');

    if (!sos) {
      const exists = await SOS.findOne(filter).populate('assignedTo', 'name phone district');
      if (!exists) {
        return res.status(404).json({ error: 'SOS not found' });
      }
      return res.status(409).json({
        error: 'This emergency request has already been assigned to another responder',
        assignedTo: exists.assignedTo,
        status: exists.status
      });
    }

    await logAuditEvent({
      actorId: req.user.id,
      actorName: req.user.name,
      actorRole: req.user.role,
      action: 'SOS_ASSIGNED',
      targetId: sos.clientIncidentId || sos._id,
      targetType: 'SOS',
      jurisdiction: { state: sos.state, district: sos.district, village: sos.village },
      details: {
        assignedTo: sos.assignedTo?.name || targetNgoObj?.name || targetNgoId,
        dispatchedBy: req.user.role
      }
    });

    broadcastSOSAssigned(sos);
    res.json(sos);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Update status. Body: { "status": "Pending" | "In Progress" | "En Route" | "On Scene" | "Resolved" }
const SOS_STATUSES = ['Pending', 'Assigned', 'In Progress', 'En Route', 'On Scene', 'Resolved'];

app.patch('/api/sos/:id/status', requireRole('ngo', 'control', 'super_admin'), requireVerified, async (req, res) => {
  const { id } = req.params;
  const { status } = req.body;

  if (!id || !String(id).trim()) {
    return res.status(400).json({ error: 'Please provide a valid SOS id' });
  }
  if (!SOS_STATUSES.includes(status)) {
    return res.status(400).json({ error: `status must be one of: ${SOS_STATUSES.join(', ')}` });
  }

  if (!isDbMode()) {
    const sos = memoryStore.sos.find(s => s._id === id || s.clientIncidentId === id);
    if (!sos) return res.status(404).json({ error: 'SOS not found' });
    sos.status = status;
    if (status === 'Resolved') sos.resolvedAt = new Date();
    if (status === 'Pending') {
      sos.assignedTo = null;
      sos.assignedAt = null;
    }

    const io = getIo();
    if (io) {
      io.emit('sos:status_changed', { id: sos._id, clientIncidentId: sos.clientIncidentId, status: sos.status, sos });
      io.emit('sos:list_updated');
    }

    return res.json(sos);
  }

  try {
    const filter = mongoose.isValidObjectId(id)
      ? { $or: [{ _id: id }, { clientIncidentId: id }] }
      : { clientIncidentId: id };

    const sos = await SOS.findOne(filter);
    if (!sos) {
      return res.status(404).json({ error: 'SOS not found' });
    }

    // Permission check: NGO handling this SOS, or Panchayat/Super Admin
    const userNgoIds = [
      req.user.ngo,
      req.user.id,
      req.user._id ? String(req.user._id) : null,
      req.user.organizationId ? String(req.user.organizationId) : null
    ].filter(Boolean).map(String);

    const assignedId = sos.assignedTo ? String(sos.assignedTo._id || sos.assignedTo) : null;
    const isAssignedNgo = assignedId && userNgoIds.includes(assignedId);
    const isPrivileged = req.user.role === 'control' || req.user.role === 'super_admin' || req.user.role === 'panchayat';

    if (!isAssignedNgo && !isPrivileged) {
      return res.status(403).json({ error: 'Only the responder handling this SOS or the local authority can update its status' });
    }

    sos.status = status;
    sos.resolvedAt = status === 'Resolved' ? new Date() : null;
    if (status === 'Pending') {
      // Back to Pending means the NGO gives it up, so another NGO can accept it
      sos.assignedTo = null;
      sos.assignedAt = null;
      sos.responderLocation = null;
      sos.responderDistanceKm = null;
    }

    await sos.save();
    await sos.populate('assignedTo', 'name phone district');

    // Emit live Socket.IO update
    const io = getIo();
    if (io) {
      io.emit('sos:status_changed', { id: sos._id, clientIncidentId: sos.clientIncidentId, status: sos.status, sos });
      io.emit('sos:list_updated');
    }

    await logAuditEvent({
      actorId: req.user.id,
      actorName: req.user.name,
      actorRole: req.user.role,
      action: status === 'Resolved' ? 'SOS_RESOLVED' : 'SOS_STATUS_UPDATED',
      targetId: sos.clientIncidentId || sos._id,
      targetType: 'SOS',
      jurisdiction: { state: sos.state, district: sos.district, village: sos.village },
      details: { status, resolvedBy: req.user.name }
    });

    res.json(sos);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ---------- EVACUATION STATUS (families report where their members went) ----------

const EVAC_FIELDS = ['inShelter', 'withRelatives', 'atHome', 'elsewhere'];

// Save my family's status (villager). Body: { totalMembers, inShelter, withRelatives, atHome, elsewhere, shelterId? }
app.post('/api/evacuation', requireRole('villager'), async (req, res) => {
  const totalMembers = Number(req.body.totalMembers);
  if (!Number.isInteger(totalMembers) || totalMembers < 1 || totalMembers > 100) {
    return res.status(400).json({ error: 'Family members must be between 1 and 100' });
  }

  const counts = {};
  for (const field of EVAC_FIELDS) {
    const value = Number(req.body[field] || 0);
    if (!Number.isInteger(value) || value < 0) {
      return res.status(400).json({ error: 'Counts must be whole numbers, 0 or more' });
    }
    counts[field] = value;
  }

  const accounted = EVAC_FIELDS.reduce((sum, field) => sum + counts[field], 0);
  if (accounted > totalMembers) {
    return res.status(400).json({ error: `That adds up to ${accounted}, but your family has ${totalMembers} members` });
  }

  try {
    const user = await User.findById(req.user.id);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    let shelter = null;
    if (counts.inShelter > 0 && req.body.shelterId && mongoose.isValidObjectId(req.body.shelterId)) {
      shelter = await Shelter.findById(req.body.shelterId);
    }

    const report = await EvacuationReport.findOneAndUpdate(
      { user: user._id },
      {
        user: user._id,
        reporterName: user.name,
        reporterPhone: user.phone,
        village: user.village,
        district: user.district,
        state: user.state,
        totalMembers,
        ...counts,
        shelter: shelter ? shelter._id : null,
        shelterName: shelter ? shelter.name : null
      },
      { upsert: true, new: true, runValidators: true }
    );

    res.json(report);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// My family's latest report (villager)
app.get('/api/evacuation/mine', requireAuth, async (req, res) => {
  try {
    const report = await EvacuationReport.findOne({ user: req.user.id });
    res.json(report);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// All reports, plus totals per village (Gram Panchayat and NGOs)
app.get('/api/evacuation', requireRole('control', 'ngo'), async (req, res) => {
  try {
    const reports = await EvacuationReport.find().sort({ updatedAt: -1 });

    const byVillage = {};
    const totals = { families: 0, totalMembers: 0, inShelter: 0, withRelatives: 0, atHome: 0, elsewhere: 0, unaccounted: 0 };

    for (const report of reports) {
      const key = report.village || 'Unknown village';
      if (!byVillage[key]) {
        byVillage[key] = {
          village: key,
          district: report.district || '',
          families: 0, totalMembers: 0, inShelter: 0, withRelatives: 0, atHome: 0, elsewhere: 0, unaccounted: 0,
          lastUpdated: report.updatedAt
        };
      }
      const row = byVillage[key];
      const unaccounted = report.totalMembers - EVAC_FIELDS.reduce((sum, f) => sum + (report[f] || 0), 0);

      for (const target of [row, totals]) {
        target.families += 1;
        target.totalMembers += report.totalMembers;
        EVAC_FIELDS.forEach((f) => { target[f] += report[f] || 0; });
        target.unaccounted += Math.max(0, unaccounted);
      }
      if (report.updatedAt > row.lastUpdated) row.lastUpdated = report.updatedAt;
    }

    const villages = Object.values(byVillage).sort((a, b) => b.totalMembers - a.totalMembers);
    res.json({ totals, villages, reports });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ---------- NGOs ----------

// List all NGOs with location filter
app.get('/api/ngos', async (req, res) => {
  const { state, district } = req.query;
  try {
    const filter = {};
    if (state) filter.state = state;
    if (district) filter.district = district;

    let ngos = [];
    if (isDbMode()) {
      ngos = await NGO.find(filter).sort({ name: 1 });
    } else {
      ngos = memoryStore.ngos.filter(n => {
        const matchState = !state || (n.state && n.state.toLowerCase() === state.toLowerCase());
        const matchDistrict = !district || (n.district && n.district.toLowerCase() === district.toLowerCase());
        return matchState && matchDistrict;
      });
    }
    res.json(ngos);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Update NGO location / status (logged in NGO) & broadcast live movement
app.patch('/api/ngos/location', requireRole('ngo'), requireVerified, async (req, res) => {
  const { lat, lng, state, district, status, resourceType, activeSosId } = req.body;
  if (!Number.isFinite(Number(lat)) || !Number.isFinite(Number(lng))) {
    return res.status(400).json({ error: 'Please provide valid lat and lng coordinates' });
  }

  const numLat = Number(lat);
  const numLng = Number(lng);

  try {
    const ngoId = req.user?.ngo;
    let ngo = null;
    if (isDbMode()) {
      if (ngoId && mongoose.isValidObjectId(ngoId)) {
        ngo = await NGO.findById(ngoId);
      }
      if (!ngo && req.user?.id) {
        ngo = await NGO.findOne({ phone: req.user.phone });
      }
    }

    let updatedResponder = null;

    if (ngo) {
      ngo.location = { lat: numLat, lng: numLng };
      if (state) ngo.state = state;
      if (district) ngo.district = district;
      if (status) ngo.status = status;
      if (resourceType) ngo.resourceType = resourceType;
      await ngo.save();
      updatedResponder = ngo;

      // Update active assigned SOS requests with new responder location & distance
      const activeSosList = await SOS.find({ assignedTo: ngo._id, status: 'In Progress' });
      for (const item of activeSosList) {
        item.responderLocation = { lat: numLat, lng: numLng, updatedAt: new Date() };
        if (item.location) {
          item.responderDistanceKm = calculateDistanceKm({ lat: numLat, lng: numLng }, item.location);
        }
        await item.save();
      }
    } else {
      // Demo store fallback
      updatedResponder = {
        _id: ngoId || `ngo-demo-${Date.now()}`,
        name: req.user?.name || 'Helping Hands Response Unit',
        contactPerson: req.user?.name || 'Response Coordinator',
        phone: req.user?.phone || '+919876543210',
        district: district || req.user?.district || 'Dehradun',
        state: state || req.user?.state || 'Uttarakhand',
        location: { lat: numLat, lng: numLng },
        status: status || 'Available',
        resourceType: resourceType || 'rescue_team',
        available: status !== 'Offline'
      };
      memoryStore.ngos = [updatedResponder, ...memoryStore.ngos.filter(n => n._id !== updatedResponder._id)];

      // Update memory store active SOS
      memoryStore.sos.forEach(item => {
        const assignedId = item.assignedTo?._id || item.assignedTo;
        if (assignedId === updatedResponder._id && item.status === 'In Progress') {
          item.responderLocation = { lat: numLat, lng: numLng, updatedAt: new Date() };
          if (item.location) {
            item.responderDistanceKm = calculateDistanceKm({ lat: numLat, lng: numLng }, item.location);
          }
        }
      });
    }

    // Broadcast live responder movement via Socket.IO to Panchayat & Villagers
    broadcastResponderLocation({
      responderId: updatedResponder._id,
      name: updatedResponder.name,
      lat: numLat,
      lng: numLng,
      state: updatedResponder.state,
      district: updatedResponder.district,
      status: updatedResponder.status,
      activeSosId: activeSosId || null,
      updatedAt: new Date()
    });

    res.json(updatedResponder);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// One NGO by id
app.get('/api/ngos/:id', async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) {
    return res.status(400).json({ error: 'Invalid NGO id' });
  }
  try {
    const ngo = await NGO.findById(req.params.id);
    if (!ngo) {
      return res.status(404).json({ error: 'NGO not found' });
    }
    res.json(ngo);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ---------- ALERTS ----------

// Districts and villages the Gram Panchayat can send an alert to.
// Districts: all Karnataka districts. Villages: the ones villagers registered
// with, so every village in the list has at least one person who gets the alert.
// Reply: { districts: ["Bagalkote", ...], villages: { "Udupi": [{ name: "Brahmavar", villagers: 3 }] } }
const districtList = require('./data/districtCoordinates');

function canonicalDistrict(name) {
  const clean = String(name || '').trim();
  const lower = clean.toLowerCase();
  const match = districtList.find(
    (d) => d.name.toLowerCase() === lower || (d.aliases || []).some((a) => a.toLowerCase() === lower)
  );
  return match ? match.name : clean;
}

app.get('/api/alerts/areas', requireRole('ngo', 'control'), async (req, res) => {
  try {
    const villagers = await User.find({ role: 'villager' }).select('village district');

    const villages = {};  // district -> { lowercase village -> { name, villagers } }
    for (const v of villagers) {
      if (!v.district || !v.village) continue;
      const district = canonicalDistrict(v.district);
      const village = v.village.trim();
      const key = village.toLowerCase();
      villages[district] = villages[district] || {};
      villages[district][key] = villages[district][key] || { name: village, villagers: 0 };
      villages[district][key].villagers++;
    }

    const result = {};
    for (const [district, list] of Object.entries(villages)) {
      result[district] = Object.values(list).sort((a, b) => a.name.localeCompare(b.name));
    }

    const districts = [...new Set([...districtList.map((d) => d.name), ...Object.keys(result)])].sort();
    res.json({ districts, villages: result });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Villagers who live in the alert's area.
// A village-level alert reaches only that village; if no village is given
// (or the village name is the district itself) it reaches the whole district.
async function findAlertRecipients({ village, district }) {
  if (!isDbMode()) {
    return [];
  }
  const filter = { role: 'villager' };
  if (district) filter.district = district;

  const districtWide = !village || (district && village.toLowerCase() === district.toLowerCase());
  if (!districtWide) filter.village = village;

  const villagers = await User.find(filter)
    .collation({ locale: 'en', strength: 2 })   // "ujire" matches "Ujire"
    .select('phone');
  return villagers.map((v) => v.phone);
}

// Trigger an official disaster alert (Authorities Only)
// Body: { "village": "...", "district": "...", "riskLevel": "Severe", "phones": ["+91..."], "message": "(optional)" }
app.post('/api/alerts/trigger', requireRole('control'), requireVerified, async (req, res) => {
  const { village, riskLevel, message, phones } = req.body;
  let district = req.body.district;

  if (req.user.role === 'control' && !district) {
    district = req.user.district || 'Dehradun';
  }

  // Strict Geo-Authorization: Panchayat can ONLY alert their authorized district
  if (req.user.role === 'control') {
    const jurisdictionCheck = verifyJurisdiction(req.user, { district, state: req.body.state });
    if (!jurisdictionCheck.allowed) {
      return res.status(403).json({
        error: jurisdictionCheck.reason,
        code: 'GEO_AUTHORIZATION_DENIED',
        authorizedJurisdiction: { district: req.user.district, state: req.user.state }
      });
    }
  }

  const normalizedLevel = Object.keys(LEVEL_COLORS).find(k => k.toLowerCase() === String(riskLevel || 'high').toLowerCase()) || 'High';
  const color = LEVEL_COLORS[normalizedLevel] || 'orange';

  try {
    const recipients = Array.isArray(phones) && phones.length > 0
      ? phones
      : await findAlertRecipients({ village, district });

    const text = message || buildAlertMessage({ village, district, riskLevel: normalizedLevel });
    const sms = await deliverSMS(recipients, text);

    const alertData = {
      title: req.body.title || `${normalizedLevel} Alert: ${district || village || 'Emergency'}`,
      targetType: req.body.targetType || (district ? 'DISTRICT' : 'STATE'),
      village,
      district,
      state: req.body.state || req.user.state || 'Uttarakhand',
      riskLevel: normalizedLevel,
      color,
      message: text,
      recipients,
      sms,
      issuedBy: {
        id: req.user.id,
        name: req.user.name,
        role: req.user.role,
        jurisdiction: { state: req.body.state || req.user.state, district }
      },
      createdAt: new Date()
    };

    let savedAlert = null;
    if (!isDbMode()) {
      savedAlert = { _id: `alert-${Date.now()}`, ...alertData };
      memoryStore.alerts.unshift(savedAlert);
    } else {
      savedAlert = await Alert.create(alertData);
    }

    // Log audit event
    await logAuditEvent({
      actorId: req.user.id,
      actorName: req.user.name,
      actorRole: req.user.role,
      action: 'ALERT_CREATED',
      targetId: String(savedAlert._id),
      targetType: 'Alert',
      jurisdiction: { state: alertData.state, district: alertData.district, village },
      details: { title: alertData.title, riskLevel: alertData.riskLevel }
    });

    // Send targeted Web Push notification to subscribed devices in this jurisdiction
    const pushResult = await sendTargetedPush({
      title: alertData.title,
      body: alertData.message,
      severity: alertData.riskLevel,
      alertId: savedAlert._id,
      targetState: alertData.state,
      targetDistrict: alertData.district,
      url: '/'
    });

    res.status(201).json({
      ...savedAlert,
      webPush: pushResult
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Retransmit an official alert within authorized jurisdiction
app.post('/api/alerts/:id/retransmit', requireRole('control'), requireVerified, async (req, res) => {
  const { id } = req.params;
  const user = req.user;

  // 1. Fetch original alert
  let originalAlert = memoryStore.alerts.find(a => String(a._id) === String(id));
  if (!originalAlert && isDbMode()) {
    if (mongoose.isValidObjectId(id)) {
      originalAlert = await Alert.findById(id);
    }
  }
  if (!originalAlert) {
    return res.status(404).json({ error: 'Original alert not found' });
  }

  // 2. Strict Geo-Authorization check: user can only retransmit to their authorized jurisdiction
  const targetDistrict = req.body.targetDistrict || user.district || originalAlert.district;
  const targetState = req.body.targetState || user.state || originalAlert.state;

  const check = verifyJurisdiction(user, { district: targetDistrict, state: targetState });
  if (!check.allowed) {
    return res.status(403).json({
      error: check.reason,
      code: 'GEO_AUTHORIZATION_DENIED',
      authorizedJurisdiction: { district: user.district, state: user.state }
    });
  }

  // 3. Create retransmission record preserving original lineage
  const retransmitData = {
    title: `[RETRANSMITTED] ${originalAlert.title || 'Official Disaster Warning'}`,
    targetType: 'DISTRICT',
    village: req.body.village || originalAlert.village,
    district: targetDistrict,
    state: targetState,
    riskLevel: originalAlert.riskLevel || 'Severe',
    color: originalAlert.color || '#ea580c',
    message: `${originalAlert.message} (Retransmitted by ${user.name || 'Local Authority'}, ${user.district || 'Control Centre'})`,
    instruction: originalAlert.instruction || 'Follow local evacuation orders and proceed to designated shelters.',
    isRetransmission: true,
    retransmittedFrom: originalAlert._id,
    originalAlertId: String(originalAlert._id),
    originalAuthorityId: String(originalAlert.issuedBy?.id || originalAlert._id),
    originalAuthorityName: originalAlert.issuedBy?.name || 'District Disaster Authority',
    originalCreatedAt: originalAlert.createdAt || originalAlert.timestamp,
    retransmittedBy: {
      id: user.id,
      name: user.name,
      role: user.role,
      organizationName: user.organizationName || `${user.district} Gram Panchayat Control`,
      district: user.district,
      state: user.state
    },
    retransmittedAt: new Date(),
    status: 'ACTIVE',
    createdAt: new Date()
  };

  let savedRetransmit = null;
  if (!isDbMode()) {
    savedRetransmit = { _id: `retransmit-${Date.now()}`, ...retransmitData };
    memoryStore.alerts.unshift(savedRetransmit);
  } else {
    savedRetransmit = await Alert.create(retransmitData);
  }

  // Log audit event
  await logAuditEvent({
    actorId: user.id,
    actorName: user.name,
    actorRole: user.role,
    action: 'ALERT_RETRANSMITTED',
    targetId: String(savedRetransmit._id),
    targetType: 'Alert',
    jurisdiction: { state: targetState, district: targetDistrict },
    details: {
      originalAlertId: originalAlert._id,
      retransmittedBy: user.name,
      severity: retransmitData.riskLevel
    }
  });

  // Targeted Web Push & Socket distribution
  await sendTargetedPush({
    title: `🚨 ${retransmitData.title}`,
    body: retransmitData.message,
    severity: retransmitData.riskLevel,
    alertId: savedRetransmit._id,
    targetState: retransmitData.state,
    targetDistrict: retransmitData.district,
    url: '/'
  });

  res.status(201).json(savedRetransmit);
});

// -------------------------------------------------------------
// VERIFICATION CENTER, SUPER ADMIN & AUDIT LOG APIs
// -------------------------------------------------------------

// GET /api/admin/stats - Server-side aggregates for Super Admin Overview
app.get('/api/admin/stats', requireRole('super_admin'), async (req, res) => {
  try {
    let pendingCount = 0;
    let verifiedNgos = 0;
    let verifiedAuthorities = 0;
    let suspendedCount = 0;
    let totalCitizens = 0;
    let openSosCount = 0;

    if (mongoose.connection && mongoose.connection.readyState === 1) {
      pendingCount = await VerifiedEntity.countDocuments({
        $or: [{ verificationStatus: 'PENDING' }, { status: 'PENDING' }]
      });
      verifiedNgos = await VerifiedEntity.countDocuments({
        organizationType: 'NGO',
        $or: [{ verificationStatus: 'VERIFIED' }, { status: 'VERIFIED' }]
      });
      verifiedAuthorities = await VerifiedEntity.countDocuments({
        organizationType: { $in: ['PANCHAYAT', 'DISTRICT_AUTHORITY', 'STATE_AUTHORITY', 'NATIONAL_AUTHORITY'] },
        $or: [{ verificationStatus: 'VERIFIED' }, { status: 'VERIFIED' }]
      });
      suspendedCount = await VerifiedEntity.countDocuments({
        $or: [
          { verificationStatus: { $in: ['SUSPENDED', 'REVOKED', 'REJECTED'] } },
          { status: { $in: ['SUSPENDED', 'REVOKED', 'REJECTED'] } }
        ]
      });
      totalCitizens = await User.countDocuments({ role: 'villager' });
      openSosCount = await SOS.countDocuments({
        status: { $in: ['Active', 'Pending', 'In Progress', 'Dispatched'] }
      });
    } else if (process.env.NODE_ENV === 'test') {
      const ents = memoryStore.entities || [];
      pendingCount = ents.filter(e => e.verificationStatus === 'PENDING').length;
      verifiedNgos = ents.filter(e => e.organizationType === 'NGO' && e.verificationStatus === 'VERIFIED').length;
      verifiedAuthorities = ents.filter(e => e.organizationType !== 'NGO' && e.verificationStatus === 'VERIFIED').length;
      suspendedCount = ents.filter(e => ['SUSPENDED', 'REVOKED', 'REJECTED'].includes(e.verificationStatus)).length;
      totalCitizens = (memoryStore.users || []).filter(u => u.role === 'villager').length;
      openSosCount = (memoryStore.sos || []).filter(s => ['Active', 'Pending', 'In Progress', 'Dispatched'].includes(s.status)).length;
    }

    let activeShelters = 0;
    if (mongoose.connection && mongoose.connection.readyState === 1) {
      activeShelters = await Shelter.countDocuments({ status: { $ne: 'CLOSED' } });
    } else if (process.env.NODE_ENV === 'test') {
      activeShelters = (memoryStore.shelters || []).filter(s => s.status !== 'CLOSED').length;
    }
    const totalOrganizations = (verifiedNgos || 0) + (verifiedAuthorities || 0) + (pendingCount || 0) + (suspendedCount || 0);

    res.json({
      totalOrganizations,
      pendingOrganizations: pendingCount,
      verifiedOrganizations: (verifiedNgos || 0) + (verifiedAuthorities || 0),
      totalCitizens,
      activeShelters,
      totalIncidents: openSosCount,
      pendingCount,
      verifiedNgos,
      verifiedAuthorities,
      suspendedCount,
      openSosCount,
      timestamp: Date.now()
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/admin/citizens - Read-only citizen list with search
app.get('/api/admin/citizens', requireRole('super_admin'), async (req, res) => {
  const { search, limit = 50, skip = 0 } = req.query;
  try {
    let citizens = [];
    let total = 0;

    if (mongoose.connection && mongoose.connection.readyState === 1) {
      const filter = { role: 'villager' };
      if (search && search.trim()) {
        const s = search.trim();
        filter.$or = [
          { name: new RegExp(s, 'i') },
          { phone: new RegExp(s, 'i') },
          { district: new RegExp(s, 'i') },
          { village: new RegExp(s, 'i') }
        ];
      }
      total = await User.countDocuments(filter);
      citizens = await User.find(filter)
        .sort({ createdAt: -1 })
        .skip(Number(skip) || 0)
        .limit(Math.min(100, Number(limit) || 50))
        .select('-passwordHash -devices')
        .lean();
    } else if (process.env.NODE_ENV === 'test') {
      citizens = (memoryStore.users || []).filter(u => u.role === 'villager');
      total = citizens.length;
    }

    res.json(citizens.map(publicUser));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/admin/resources - Overview of all registered shelters/resources
app.get('/api/admin/resources', requireRole('super_admin'), async (req, res) => {
  const { search, state, district } = req.query;
  try {
    let resources = [];
    if (mongoose.connection && mongoose.connection.readyState === 1) {
      const filter = {};
      if (state) filter.state = new RegExp(`^${state.trim()}$`, 'i');
      if (district) filter.district = new RegExp(`^${district.trim()}$`, 'i');
      if (search && search.trim()) {
        filter.$or = [
          { name: new RegExp(search.trim(), 'i') },
          { district: new RegExp(search.trim(), 'i') },
          { type: new RegExp(search.trim(), 'i') }
        ];
      }
      resources = await Shelter.find(filter).sort({ createdAt: -1 }).lean();
    } else if (process.env.NODE_ENV === 'test') {
      resources = memoryStore.shelters || [];
    }

    res.json(resources);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// List entities with full search & filtering (Super admin & Control)
async function handleListEntities(req, res) {
  const { status, type, search, state, district } = req.query;

  let entities = [];
  if (mongoose.connection && mongoose.connection.readyState === 1) {
    const query = {};
    if (status && status !== 'ALL') {
      query.$or = [{ verificationStatus: status }, { status }];
    }
    if (type && type !== 'ALL') query.organizationType = type;
    if (state && state.trim()) query.state = new RegExp(`^${state.trim()}$`, 'i');
    if (district && district.trim()) query.district = new RegExp(`^${district.trim()}$`, 'i');
    if (search && search.trim()) {
      const s = search.trim();
      query.$and = query.$and || [];
      query.$and.push({
        $or: [
          { organizationName: new RegExp(s, 'i') },
          { name: new RegExp(s, 'i') },
          { representativeName: new RegExp(s, 'i') },
          { email: new RegExp(s, 'i') },
          { phone: new RegExp(s, 'i') },
          { registrationNumber: new RegExp(s, 'i') }
        ]
      });
    }
    entities = await VerifiedEntity.find(query).sort({ createdAt: -1 });
  } else {
    entities = [...(memoryStore.entities || [])];
    if (status && status !== 'ALL') entities = entities.filter(e => e.verificationStatus === status || e.status === status);
    if (type && type !== 'ALL') entities = entities.filter(e => e.organizationType === type);
    if (search && search.trim()) {
      const s = search.trim().toLowerCase();
      entities = entities.filter(e =>
        (e.organizationName && e.organizationName.toLowerCase().includes(s)) ||
        (e.name && e.name.toLowerCase().includes(s)) ||
        (e.representativeName && e.representativeName.toLowerCase().includes(s)) ||
        (e.email && e.email.toLowerCase().includes(s)) ||
        (e.phone && e.phone.includes(s))
      );
    }
  }

  res.json(entities);
}

app.get('/api/admin/entities', requireRole('super_admin'), handleListEntities);
app.get('/api/admin/verifications', requireRole('super_admin', 'control'), handleListEntities);

// Approve and verify an entity
async function handleApproveEntity(req, res) {
  const { id } = req.params;
  const user = req.user;
  const { stateCode, districtCode, blockCode, panchayatId, authorityLevel } = req.body || {};

  let entity = null;
  let linkedUser = null;

  if (mongoose.connection && mongoose.connection.readyState === 1) {
    const filter = mongoose.isValidObjectId(id) ? { _id: id } : { $or: [{ _id: id }, { name: id }, { organizationName: id }] };
    entity = await VerifiedEntity.findOne(filter);
    if (entity) {
      entity.verificationStatus = 'VERIFIED';
      entity.status = 'VERIFIED';
      entity.verificationLabel = 'SAHAYTA SETU VERIFIED';
      entity.verifiedBy = user.name || 'Platform Administrator';
      entity.reviewedBy = user.name || 'Platform Administrator';
      entity.verifiedAt = new Date();
      entity.reviewedAt = new Date();
      if (authorityLevel) entity.authorityLevel = authorityLevel;
      if (stateCode) entity.stateCode = String(stateCode).trim().toUpperCase();
      if (districtCode) entity.districtCode = String(districtCode).trim().toUpperCase();
      if (blockCode) entity.blockCode = String(blockCode).trim();
      if (panchayatId) entity.panchayatId = String(panchayatId).trim();
      await entity.save();

      linkedUser = await User.findOne({ organizationId: entity._id });
      if (linkedUser) {
        linkedUser.verificationStatus = 'VERIFIED';
        linkedUser.verifiedBy = user.name || 'Platform Administrator';
        linkedUser.verifiedAt = new Date();
        if (authorityLevel) linkedUser.authorityLevel = authorityLevel;
        if (stateCode) linkedUser.stateCode = entity.stateCode;
        if (districtCode) linkedUser.districtCode = entity.districtCode;
        if (blockCode) linkedUser.blockCode = entity.blockCode;
        if (panchayatId) linkedUser.panchayatId = entity.panchayatId;
        await linkedUser.save();
        emitAccountStatusChanged(linkedUser._id, { verificationStatus: 'VERIFIED', timestamp: Date.now() });
      }

      if (entity.organizationType === 'NGO') {
        await NGO.findOneAndUpdate(
          { $or: [{ verifiedEntityId: entity._id }, { name: entity.organizationName }] },
          { verificationStatus: 'VERIFIED', verifiedBy: user.name || 'Platform Administrator', verifiedAt: new Date() }
        ).catch(() => {});
      }
    }
  }

  if (!entity) {
    entity = (memoryStore.entities || []).find(e => e._id === id);
    if (entity) {
      entity.verificationStatus = 'VERIFIED';
      entity.status = 'VERIFIED';
      entity.verificationLabel = 'SAHAYTA SETU VERIFIED';
      entity.verifiedBy = user.name || 'Control Officer';
      entity.verifiedAt = new Date();
    }
  }

  if (!entity) return res.status(404).json({ error: 'Entity not found' });

  await logAuditEvent({
    actorId: user.id,
    actorName: user.name,
    actorRole: user.role,
    action: entity.organizationType === 'NGO' ? 'NGO_VERIFIED' : 'AUTHORITY_VERIFIED',
    targetId: id,
    targetType: entity.organizationType,
    jurisdiction: { state: entity.state, district: entity.district },
    details: { organizationName: entity.organizationName }
  });

  emitAdminPendingUpdate();
  emitAdminEntityUpdated(entity);

  res.json({ message: 'Entity successfully verified', entity });
}

app.post('/api/admin/entities/:id/approve', requireRole('super_admin'), handleApproveEntity);
app.post('/api/admin/verify/:id', requireRole('super_admin', 'control'), handleApproveEntity);

// Reject an entity
async function handleRejectEntity(req, res) {
  const { id } = req.params;
  const user = req.user;
  const reason = req.body?.reason || (req.body && typeof req.body === 'string' ? req.body : null);
  if (!reason && !String(id).startsWith('entity-')) {
    return res.status(400).json({ error: 'Reason is required for rejection' });
  }

  let entity = null;
  let linkedUser = null;

  if (mongoose.connection && mongoose.connection.readyState === 1) {
    const filter = mongoose.isValidObjectId(id) ? { _id: id } : { $or: [{ _id: id }, { name: id }] };
    entity = await VerifiedEntity.findOne(filter);
    if (entity) {
      linkedUser = await User.findOne({ organizationId: entity._id });
      if (linkedUser && linkedUser.role === 'super_admin') {
        return res.status(403).json({ error: 'Action denied: Cannot reject a platform super administrator.', code: 'SUPER_ADMIN_PROTECTED' });
      }

      entity.verificationStatus = 'REJECTED';
      entity.status = 'REJECTED';
      entity.verificationLabel = 'REJECTED';
      entity.reason = reason || 'Verification rejected';
      await entity.save();

      if (linkedUser) {
        linkedUser.verificationStatus = 'REJECTED';
        linkedUser.verificationNote = reason;
        await linkedUser.save();
        emitAccountStatusChanged(linkedUser._id, { verificationStatus: 'REJECTED', reason, timestamp: Date.now() });
      }
    }
  }

  if (!entity) {
    entity = (memoryStore.entities || []).find(e => e._id === id);
    if (entity) {
      entity.verificationStatus = 'REJECTED';
      entity.status = 'REJECTED';
      entity.verificationLabel = 'REJECTED';
      entity.reason = reason;
    }
  }

  if (!entity) return res.status(404).json({ error: 'Entity not found' });

  await logAuditEvent({
    actorId: user.id,
    actorName: user.name,
    actorRole: user.role,
    action: 'ENTITY_REJECTED',
    targetId: id,
    targetType: entity.organizationType,
    jurisdiction: { state: entity.state, district: entity.district },
    details: { reason: reason || 'Verification rejected' }
  });

  emitAdminPendingUpdate();
  emitAdminEntityUpdated(entity);

  res.json({ message: 'Entity verification rejected', entity });
}

app.post('/api/admin/entities/:id/reject', requireRole('super_admin'), handleRejectEntity);
app.post('/api/admin/reject/:id', requireRole('super_admin', 'control'), handleRejectEntity);

// Suspend an entity
async function handleSuspendEntity(req, res) {
  const { id } = req.params;
  const user = req.user;
  const reason = req.body?.reason || 'Suspended by platform administrator';

  let entity = null;
  let linkedUser = null;

  if (mongoose.connection && mongoose.connection.readyState === 1) {
    const filter = mongoose.isValidObjectId(id) ? { _id: id } : { $or: [{ _id: id }, { name: id }] };
    entity = await VerifiedEntity.findOne(filter);
    if (entity) {
      linkedUser = await User.findOne({ organizationId: entity._id });
      if (linkedUser && linkedUser.role === 'super_admin') {
        return res.status(403).json({ error: 'Action denied: Cannot suspend a platform super administrator.', code: 'SUPER_ADMIN_PROTECTED' });
      }

      entity.verificationStatus = 'SUSPENDED';
      entity.status = 'SUSPENDED';
      entity.verificationLabel = 'SUSPENDED';
      entity.reason = reason;
      await entity.save();

      if (linkedUser) {
        linkedUser.verificationStatus = 'SUSPENDED';
        linkedUser.verificationNote = reason;
        await linkedUser.save();
        emitAccountStatusChanged(linkedUser._id, { verificationStatus: 'SUSPENDED', reason, timestamp: Date.now() });
      }
    }
  }

  if (!entity) {
    entity = (memoryStore.entities || []).find(e => e._id === id);
    if (entity) {
      entity.verificationStatus = 'SUSPENDED';
      entity.status = 'SUSPENDED';
      entity.verificationLabel = 'SUSPENDED';
      entity.reason = reason;
    }
  }

  if (!entity) return res.status(404).json({ error: 'Entity not found' });

  await logAuditEvent({
    actorId: user.id,
    actorName: user.name,
    actorRole: user.role,
    action: entity.organizationType === 'NGO' ? 'NGO_SUSPENDED' : 'AUTHORITY_SUSPENDED',
    targetId: id,
    targetType: entity.organizationType,
    jurisdiction: { state: entity.state, district: entity.district },
    details: { reason }
  });

  emitAdminPendingUpdate();
  emitAdminEntityUpdated(entity);

  res.json({ message: 'Entity suspended', entity });
}

app.post('/api/admin/entities/:id/suspend', requireRole('super_admin'), handleSuspendEntity);
app.post('/api/admin/suspend/:id', requireRole('super_admin', 'control'), handleSuspendEntity);

// Revoke an entity
async function handleRevokeEntity(req, res) {
  const { id } = req.params;
  const user = req.user;
  const reason = req.body?.reason || 'Revoked by platform administrator';

  let entity = null;
  let linkedUser = null;

  if (mongoose.connection && mongoose.connection.readyState === 1) {
    const filter = mongoose.isValidObjectId(id) ? { _id: id } : { $or: [{ _id: id }, { name: id }] };
    entity = await VerifiedEntity.findOne(filter);
    if (entity) {
      linkedUser = await User.findOne({ organizationId: entity._id });
      if (linkedUser && linkedUser.role === 'super_admin') {
        return res.status(403).json({ error: 'Action denied: Cannot revoke a platform super administrator.', code: 'SUPER_ADMIN_PROTECTED' });
      }

      entity.verificationStatus = 'REVOKED';
      entity.status = 'REVOKED';
      entity.verificationLabel = 'REVOKED';
      entity.reason = reason;
      await entity.save();

      if (linkedUser) {
        linkedUser.verificationStatus = 'REVOKED';
        linkedUser.verificationNote = reason;
        await linkedUser.save();
        emitAccountStatusChanged(linkedUser._id, { verificationStatus: 'REVOKED', reason, timestamp: Date.now() });
      }
    }
  }

  if (!entity) {
    entity = (memoryStore.entities || []).find(e => e._id === id);
    if (entity) {
      entity.verificationStatus = 'REVOKED';
      entity.status = 'REVOKED';
      entity.verificationLabel = 'REVOKED';
      entity.reason = reason;
    }
  }

  if (!entity) return res.status(404).json({ error: 'Entity not found' });

  await logAuditEvent({
    actorId: user.id,
    actorName: user.name,
    actorRole: user.role,
    action: entity.organizationType === 'NGO' ? 'NGO_REVOKED' : 'AUTHORITY_REVOKED',
    targetId: id,
    targetType: entity.organizationType,
    jurisdiction: { state: entity.state, district: entity.district },
    details: { reason }
  });

  emitAdminPendingUpdate();
  emitAdminEntityUpdated(entity);

  res.json({ message: 'Entity revoked', entity });
}

app.post('/api/admin/entities/:id/revoke', requireRole('super_admin'), handleRevokeEntity);
app.post('/api/admin/revoke/:id', requireRole('super_admin', 'control'), handleRevokeEntity);

// Reinstate an entity
app.post('/api/admin/entities/:id/reinstate', requireRole('super_admin'), async (req, res) => {
  const { id } = req.params;
  const user = req.user;
  const reason = req.body?.reason || 'Reinstated by platform administrator';

  let entity = null;
  let linkedUser = null;

  if (mongoose.connection && mongoose.connection.readyState === 1) {
    const filter = mongoose.isValidObjectId(id) ? { _id: id } : { $or: [{ _id: id }, { name: id }] };
    entity = await VerifiedEntity.findOne(filter);
    if (entity) {
      entity.verificationStatus = 'VERIFIED';
      entity.status = 'VERIFIED';
      entity.verificationLabel = 'SAHAYTA SETU VERIFIED';
      entity.reason = null;
      await entity.save();

      linkedUser = await User.findOne({ organizationId: entity._id });
      if (linkedUser) {
        linkedUser.verificationStatus = 'VERIFIED';
        linkedUser.verificationNote = null;
        await linkedUser.save();
        emitAccountStatusChanged(linkedUser._id, { verificationStatus: 'VERIFIED', reason, timestamp: Date.now() });
      }
    }
  }

  if (!entity) {
    entity = (memoryStore.entities || []).find(e => e._id === id);
    if (entity) {
      entity.verificationStatus = 'VERIFIED';
      entity.status = 'VERIFIED';
      entity.verificationLabel = 'SAHAYTA SETU VERIFIED';
    }
  }

  if (!entity) return res.status(404).json({ error: 'Entity not found' });

  await logAuditEvent({
    actorId: user.id,
    actorName: user.name,
    actorRole: user.role,
    action: 'ENTITY_REINSTATED',
    targetId: id,
    targetType: entity.organizationType,
    jurisdiction: { state: entity.state, district: entity.district },
    details: { reason }
  });

  emitAdminPendingUpdate();
  emitAdminEntityUpdated(entity);

  res.json({ message: 'Entity successfully reinstated', entity });
});

// Admin Reset User Password: POST /api/admin/users/:id/reset-password
app.post('/api/admin/users/:id/reset-password', requireRole('super_admin'), async (req, res) => {
  const { id } = req.params;

  try {
    if (mongoose.connection && mongoose.connection.readyState === 1) {
      const user = await User.findById(id);
      if (!user) return res.status(404).json({ error: 'User not found' });

      // Generate secure temporary password
      const tempPass = 'TempPass!' + crypto.randomBytes(4).toString('hex');
      user.passwordHash = await bcrypt.hash(tempPass, 12);
      user.mustChangePassword = true;
      user.failedLoginCount = 0;
      user.lockedUntil = null;
      await user.save();

      await logAuditEvent({
        actorId: req.user.id,
        actorName: req.user.name,
        actorRole: req.user.role,
        action: 'PASSWORD_RESET',
        targetId: user._id,
        targetType: 'User',
        details: { email: user.email }
      });

      return res.json({
        message: 'Password reset successfully. The temporary password is shown below and will only be displayed once.',
        temporaryPassword: tempPass,
        mustChangePassword: true
      });
    }

    res.json({
      message: 'Password reset simulated in test mode',
      temporaryPassword: 'TempPass!Demo123',
      mustChangePassword: true
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Audit logs endpoint (Super admin endpoint & legacy alias)
async function handleQueryAuditLogs(req, res) {
  try {
    const logs = await queryAuditLogs({
      action: req.query.action,
      district: req.user.role === 'control' && req.user.district ? req.user.district : req.query.district,
      state: req.query.state,
      limit: req.query.limit || 50
    });
    res.json(logs);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

app.get('/api/admin/audit', requireRole('super_admin'), handleQueryAuditLogs);
app.get('/api/admin/audit-logs', requireRole('super_admin', 'control'), handleQueryAuditLogs);

// List alerts, newest first
//   /api/alerts                              -> latest alerts
//   /api/alerts?state=...&district=...       -> location-filtered alerts
app.get('/api/alerts', async (req, res) => {
  const { state, district } = req.query;
  try {
    if (!isDbMode()) {
      let filtered = [...memoryStore.alerts];
      if (state || district) {
        filtered = filtered.filter(a => {
          if (a.targetType === 'ALL') return true;
          const matchState = !state || !a.state || a.state.toLowerCase() === state.toLowerCase();
          const matchDistrict = !district || !a.district || a.district.toLowerCase() === district.toLowerCase();
          return matchState && matchDistrict;
        });
      }
      return res.json(filtered);
    }

    const filter = {};
    if (district) {
      filter.$or = [
        { district },
        { targetType: 'ALL' },
        { targetType: 'STATE', state }
      ];
    } else if (state) {
      filter.$or = [
        { state },
        { targetType: 'ALL' }
      ];
    }
    const alerts = await Alert.find(filter)
      .collation({ locale: 'en', strength: 2 })
      .sort({ createdAt: -1 })
      .limit(50);
    res.json(alerts);
  } catch (err) {
    let filtered = [...memoryStore.alerts];
    if (state || district) {
      filtered = filtered.filter(a => {
        if (a.targetType === 'ALL') return true;
        const matchState = !state || !a.state || a.state.toLowerCase() === state.toLowerCase();
        const matchDistrict = !district || !a.district || a.district.toLowerCase() === district.toLowerCase();
        return matchState && matchDistrict;
      });
    }
    res.json(filtered);
  }
});

app.get('/api/live-rainfall/:lat/:lng', async (req, res) => {
  const { lat, lng } = req.params;
  try {
    const rainfall = await getRainfall(lat, lng);
    res.json({ lat, lng, rainfall });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// All districts
app.get('/api/district-rainfall', async (req, res) => {
  try {
    const data = await DistrictRainfall.find().sort({ district: 1 });
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// One district by name, e.g. /api/district-rainfall/Udupi
app.get('/api/district-rainfall/:district', async (req, res) => {
  try {
    const data = await DistrictRainfall.findOne({ district: req.params.district })
      .collation({ locale: 'en', strength: 2 });
    if (!data) {
      return res.status(404).json({ error: 'District not found' });
    }
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Risk for ALL districts in one call
//   /api/risk
//   /api/risk?simulateRain=150                          -> every district gets 150 mm
//   /api/risk?simulateRain=150&simulateDistrict=Udupi   -> only Udupi gets 150 mm
const RAIN_CACHE_MS = 10 * 60 * 1000;  // 10 minutes
let rainCache = { time: 0, key: '', data: null };

app.get('/api/risk', async (req, res) => {
  try {
    const districts = await DistrictRainfall.find({ lat: { $ne: null }, lng: { $ne: null } })
      .sort({ district: 1 });
    if (districts.length === 0) {
      return res.status(404).json({ error: 'No districts with locations. Run add-district-coordinates.js' });
    }

    // Real rainfall, reused for 10 minutes
    const key = districts.map((d) => d.district).join('|');
    const cacheIsOld = Date.now() - rainCache.time > RAIN_CACHE_MS;
    if (!rainCache.data || rainCache.key !== key || cacheIsOld) {
      const data = await getRainfall24hMany(districts.map((d) => ({ lat: d.lat, lng: d.lng })));
      rainCache = { time: Date.now(), key, data };
    }

    // For demos
    const simulated = req.query.simulateRain !== undefined ? parseFloat(req.query.simulateRain) : NaN;
    const simulateDistrict = (req.query.simulateDistrict || '').toLowerCase();

    const results = districts.map((d, i) => {
      let rain = rainCache.data[i];
      const applies = !simulateDistrict || d.district.toLowerCase() === simulateDistrict;
      if (!Number.isNaN(simulated) && applies) {
        rain = { ...rain, next24h: simulated, simulated: true };
      }
      return {
        district: d.district,
        lat: d.lat,
        lng: d.lng,
        rainfall: rain,
        risk: calculateRisk(rain, d)
      };
    });

    // Highest risk first
    results.sort((a, b) => b.risk.score - a.risk.score || a.district.localeCompare(b.district));

    const summary = { green: 0, yellow: 0, orange: 0, red: 0 };
    for (const r of results) {
      summary[r.risk.color]++;
    }

    res.json({ updatedAt: new Date(rainCache.time), summary, districts: results });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Risk level for a district, e.g. /api/risk/Udupi?lat=13.34&lng=74.74
app.get('/api/risk/:district', async (req, res) => {
  const lat = parseFloat(req.query.lat);
  const lng = parseFloat(req.query.lng);
  if (Number.isNaN(lat) || Number.isNaN(lng)) {
    return res.status(400).json({ error: 'Please give lat and lng, e.g. ?lat=13.34&lng=74.74' });
  }

  try {
    const district = await DistrictRainfall.findOne({ district: req.params.district })
      .collation({ locale: 'en', strength: 2 });
    if (!district) {
      return res.status(404).json({ error: 'District not found' });
    }

    let rain = await getRainfall24h(lat, lng);

    // For demos: pretend this much rain is forecast, e.g. &simulateRain=150
    if (req.query.simulateRain !== undefined) {
      const simulated = parseFloat(req.query.simulateRain);
      if (!Number.isNaN(simulated)) {
        rain = { ...rain, next24h: simulated, simulated: true };
      }
    }

    const risk = calculateRisk(rain, district);
    res.json({ district: district.district, lat, lng, rainfall: rain, risk });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

const PORT = process.env.PORT || 5000;
const server = http.createServer(app);
initRealtime(server);

if (require.main === module) {
  connectDb()
    .then(() => {
      server.listen(PORT, () => {
        console.log(`Sahayta Setu Server & Real-time Socket.IO running on port ${PORT}`);
      });
    })
    .catch((err) => {
      console.error('Fatal Server Startup Error:', err.message);
      process.exit(1);
    });
}

module.exports = { app, server, memoryStore, connectDb };