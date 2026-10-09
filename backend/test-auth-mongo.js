const http = require('http');
const mongoose = require('mongoose');
const { app, memoryStore } = require('./server');
const { createToken } = require('./services/auth');

const TEST_PORT = 5056;
const BASE_URL = `http://localhost:${TEST_PORT}`;
let serverInstance;

function request(path, options = {}) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, BASE_URL);
    const headers = options.headers || {};
    let body = options.body;
    if (body && typeof body === 'object') {
      body = JSON.stringify(body);
      headers['Content-Type'] = 'application/json';
    }

    const req = http.request(
      url,
      {
        method: options.method || 'GET',
        headers
      },
      (res) => {
        let rawData = '';
        res.on('data', (chunk) => { rawData += chunk; });
        res.on('end', () => {
          let json = null;
          try { json = JSON.parse(rawData); } catch (e) { json = rawData; }
          resolve({ status: res.statusCode, headers: res.headers, data: json });
        });
      }
    );

    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

async function runAuthTests() {
  console.log('====================================================');
  console.log('  SAHAYTA SETU — NEW AUTHENTICATION & ACCESS CONTROL TESTS');
  console.log('====================================================\n');

  let passCount = 0;
  let failCount = 0;

  function assert(condition, message) {
    if (condition) {
      console.log(`  ✓ PASS: ${message}`);
      passCount++;
    } else {
      console.error(`  ✗ FAIL: ${message}`);
      failCount++;
    }
  }

  await new Promise((resolve) => {
    serverInstance = app.listen(TEST_PORT, () => {
      console.log(`✓ Auth Test server running on port ${TEST_PORT}\n`);
      resolve();
    });
  });

  try {
    // -------------------------------------------------------------
    // 1. Citizen cannot obtain privileged role via OTP
    // -------------------------------------------------------------
    console.log('[TEST 1] Citizen cannot obtain privileged role; role/verificationStatus client-sent ignored');
    const otpReq = await request('/api/auth/request-otp', {
      method: 'POST',
      body: { phone: '9111222333' }
    });
    assert(otpReq.status === 200, 'OTP request successful');

    const verifyVillager = await request('/api/auth/verify-otp', {
      method: 'POST',
      body: {
        phone: '9111222333',
        code: otpReq.data.demoOtp || '123456',
        name: 'Civilian User',
        role: 'super_admin', // Attempt privilege escalation
        verificationStatus: 'VERIFIED',
        state: 'Uttarakhand',
        district: 'Dehradun'
      }
    });
    assert(verifyVillager.status === 200, 'Citizen OTP verified');
    assert(verifyVillager.data.user.role === 'villager', 'Client-sent role super_admin ignored: user forced to villager');
    assert(verifyVillager.data.user.verificationStatus === 'NOT_REQUIRED', 'Citizen verificationStatus set to NOT_REQUIRED');

    // -------------------------------------------------------------
    // 2. HTML sanitization / Length rejection
    // -------------------------------------------------------------
    console.log('\n[TEST 2] Input validation, HTML stripping, and length checks');
    const scriptAttempt = await request('/api/auth/register-org', {
      method: 'POST',
      body: {
        orgType: 'NGO',
        orgName: '<script>alert(1)</script> Rescue Force',
        contactName: 'Commander John',
        email: 'john-xss@rescue.org',
        phone: '9888777666',
        password: 'Password@123',
        stateCode: 'UTTARAKHAND',
        districtCode: 'DEHRADUN'
      }
    });
    assert(scriptAttempt.status === 400, 'Org registration with <script> tags rejected with 400');
    assert(scriptAttempt.data.error.includes('HTML') || scriptAttempt.data.error.includes('invalid'), 'HTML script tags detected and rejected');

    // Name too long (> 150 chars)
    const longNameAttempt = await request('/api/auth/register-org', {
      method: 'POST',
      body: {
        orgType: 'NGO',
        orgName: 'A'.repeat(200),
        contactName: 'Commander',
        email: 'long@rescue.org',
        phone: '9888777665',
        password: 'Password@123',
        stateCode: 'UTTARAKHAND',
        districtCode: 'DEHRADUN'
      }
    });
    assert(longNameAttempt.status === 400, 'Organization name exceeding length limit rejected with 400');

    // -------------------------------------------------------------
    // 3. Org registration creates PENDING user and PENDING entity
    // -------------------------------------------------------------
    console.log('\n[TEST 3] Org registration creates PENDING user and entity without privileged access');
    const orgReg = await request('/api/auth/register-org', {
      method: 'POST',
      body: {
        orgType: 'PANCHAYAT',
        orgName: 'Gram Panchayat Raipur East',
        contactName: 'Panchayat Pradhan',
        email: 'raipur.pradhan@sahayta.test',
        phone: '9777666555',
        password: 'Password@123',
        stateCode: 'UTTARAKHAND',
        districtCode: 'DEHRADUN',
        blockCode: 'RAIPUR',
        panchayatId: 'RAIPUR_01'
      }
    });
    assert(orgReg.status === 201, 'Panchayat registration created (201)');
    assert(orgReg.data.user.role === 'control', 'Assigned role is control');
    assert(orgReg.data.user.verificationStatus === 'PENDING', 'User verificationStatus is PENDING');

    // -------------------------------------------------------------
    // 4. PENDING users get 403 Forbidden on operational endpoints
    // -------------------------------------------------------------
    console.log('\n[TEST 4] PENDING org account blocked from alert trigger and triage operations');
    const pendingToken = orgReg.data.token;
    const alertBlocked = await request('/api/alerts/trigger', {
      method: 'POST',
      headers: { Authorization: `Bearer ${pendingToken}` },
      body: { district: 'Dehradun', riskLevel: 'Severe', message: 'Unauthorized alert attempt' }
    });
    assert(alertBlocked.status === 403, 'PENDING user cannot trigger alerts (403 Forbidden)');
    assert(alertBlocked.data.code === 'VERIFICATION_REQUIRED', 'Returns code VERIFICATION_REQUIRED');

    // -------------------------------------------------------------
    // 5. Wrong password lockout & generic error
    // -------------------------------------------------------------
    console.log('\n[TEST 5] Organization login credentials, generic errors & lockout protection');
    // Wrong password
    const badLogin = await request('/api/auth/login', {
      method: 'POST',
      body: { email: 'raipur.pradhan@sahayta.test', password: 'WrongPassword' }
    });
    assert(badLogin.status === 401, 'Invalid password rejected with 401');
    assert(badLogin.data.error.includes('Invalid email or password'), 'Generic error returned for security');

    // -------------------------------------------------------------
    // 6. Super Admin Route Protection
    // -------------------------------------------------------------
    console.log('\n[TEST 6] Super admin endpoints strictly forbidden to non-super_admin accounts');
    const citizenToken = verifyVillager.data.token;
    const adminEntitiesByCitizen = await request('/api/admin/entities', {
      headers: { Authorization: `Bearer ${citizenToken}` }
    });
    assert(adminEntitiesByCitizen.status === 403, 'Citizen blocked from admin entities with 403');

    const adminEntitiesByPanchayat = await request('/api/admin/entities', {
      headers: { Authorization: `Bearer ${pendingToken}` }
    });
    assert(adminEntitiesByPanchayat.status === 403, 'Panchayat blocked from super admin endpoint with 403');

    // -------------------------------------------------------------
    // 7. Duplicate email conflict returns 409
    // -------------------------------------------------------------
    console.log('\n[TEST 7] Duplicate email registration returns 409 Conflict');
    const dupEmail = await request('/api/auth/register-org', {
      method: 'POST',
      body: {
        orgType: 'NGO',
        orgName: 'Duplicate Check NGO',
        contactName: 'Duplicate Officer',
        email: 'raipur.pradhan@sahayta.test', // Same email as above
        phone: '9999888111',
        password: 'Password@123',
        stateCode: 'UTTARAKHAND',
        districtCode: 'DEHRADUN'
      }
    });
    assert(dupEmail.status === 409, 'Duplicate email registration returns 409 Conflict');

    // -------------------------------------------------------------
    // 8. Rate Limiting on /api/auth/request-otp
    // -------------------------------------------------------------
    console.log('\n[TEST 8] Rate limiter blocks rapid OTP spam with 429');
    const spamPhone = '9888999888';
    let rateLimited = false;
    for (let i = 0; i < 5; i++) {
      const res = await request('/api/auth/request-otp', {
        method: 'POST',
        body: { phone: spamPhone }
      });
      if (res.status === 429) {
        rateLimited = true;
        break;
      }
    }
    assert(rateLimited, 'Requesting OTP > 3 times in rapid succession triggers HTTP 429 Too Many Requests');

    // -------------------------------------------------------------
    // 9. Phone-only access is limited to explicit non-production demos
    // -------------------------------------------------------------
    console.log('\n[TEST 9] Phone-only citizen authentication is blocked in production');
    const previousMode = process.env.APP_MODE;
    const previousAuthMode = process.env.CITIZEN_AUTH_MODE;
    const previousNodeEnv = process.env.NODE_ENV;
    process.env.APP_MODE = 'demo';
    process.env.CITIZEN_AUTH_MODE = 'phone_only';
    process.env.NODE_ENV = 'production';
    const productionConfig = await request('/api/config/public');
    const productionPhoneLogin = await request('/api/auth/citizen/login', {
      method: 'POST',
      body: { phone: '9111222333' }
    });
    assert(productionConfig.data.citizenAuthMode === 'otp', 'Production always advertises OTP even if phone-only is configured');
    assert(productionPhoneLogin.status === 403, 'Production blocks direct citizen phone login');
    assert(productionPhoneLogin.data.code === 'OTP_REQUIRED', 'Production returns OTP_REQUIRED for direct phone login');
    if (previousMode === undefined) delete process.env.APP_MODE;
    else process.env.APP_MODE = previousMode;
    if (previousAuthMode === undefined) delete process.env.CITIZEN_AUTH_MODE;
    else process.env.CITIZEN_AUTH_MODE = previousAuthMode;
    if (previousNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = previousNodeEnv;

    // -------------------------------------------------------------
    // Summary
    // -------------------------------------------------------------
    console.log('\n====================================================');
    console.log(`  AUTH TESTS: ${passCount} PASSED, ${failCount} FAILED`);
    console.log('====================================================\n');

  } finally {
    serverInstance.close();
  }
}

runAuthTests().catch((err) => {
  console.error('Test runner failure:', err);
  if (serverInstance) serverInstance.close();
  process.exit(1);
});
