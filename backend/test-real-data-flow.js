process.env.NODE_ENV = 'test';
process.env.NODE_ENV = 'test';
process.env.APP_MODE = 'demo';
process.env.CITIZEN_AUTH_MODE = 'phone_only';
process.env.CORS_ORIGINS = 'http://trusted.test';

const http = require('http');
const { app, memoryStore } = require('./server');
const { createToken } = require('./services/auth');

const TEST_PORT = 5057;
const BASE_URL = `http://localhost:${TEST_PORT}`;

function request(path, options = {}) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, BASE_URL);
    const req = http.request(
      url,
      {
        method: options.method || 'GET',
        headers: {
          'Content-Type': 'application/json',
          ...(options.headers || {})
        }
      },
      (res) => {
        let body = '';
        res.on('data', (chunk) => (body += chunk));
        res.on('end', () => {
          let data = body;
          try {
            data = JSON.parse(body);
          } catch {
            // Raw text
          }
          resolve({ status: res.statusCode, headers: res.headers, data });
        });
      }
    );
    req.on('error', reject);
    if (options.body) {
      req.write(typeof options.body === 'string' ? options.body : JSON.stringify(options.body));
    }
    req.end();
  });
}

async function runRealDataTests() {
  console.log('====================================================');
  console.log('  SAHAYTA SETU — REAL DATA & CITIZEN AUTH TEST SUITE');
  console.log('====================================================\n');

  const serverInstance = await new Promise((resolve) => {
    const server = app.listen(TEST_PORT, () => {
      console.log(`✓ Real data test server running on port ${TEST_PORT}\n`);
      resolve(server);
    });
  });

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

  try {
    // -------------------------------------------------------------
    // Test 1: Public Config Endpoint
    // -------------------------------------------------------------
    console.log('[TEST 1] Public Configuration Endpoint');
    const configRes = await request('/api/config/public');
    assert(configRes.status === 200, 'GET /api/config/public returns 200 OK');
    assert(configRes.data.citizenAuthMode === 'phone_only', 'Citizen auth mode is phone_only');

    const allowedOrigin = await request('/api/health', {
      headers: { Origin: 'http://trusted.test' }
    });
    const blockedOrigin = await request('/api/health', {
      headers: { Origin: 'http://untrusted.test' }
    });
    assert(allowedOrigin.headers['access-control-allow-origin'] === 'http://trusted.test', 'Configured CORS origin is allowed');
    assert(blockedOrigin.status >= 400, 'Unconfigured CORS origin is rejected');

    // -------------------------------------------------------------
    // Test 2: Citizen Phone Lookup (Unregistered Number)
    // -------------------------------------------------------------
    console.log('\n[TEST 2] Citizen Phone-First Flow: Unregistered Number');
    const testPhone = '9876543299';
    const lookup1 = await request('/api/auth/citizen/lookup', {
      method: 'POST',
      body: { phone: testPhone }
    });
    assert(lookup1.status === 200, 'Lookup returns 200 OK');
    assert(lookup1.data.exists === false, 'exists is false for unregistered phone');
    assert(lookup1.data.accountType === null, 'accountType is null');

    // -------------------------------------------------------------
    // Test 3: Citizen Registration (Atomically creates villager)
    // -------------------------------------------------------------
    console.log('\n[TEST 3] Citizen Registration (Phone + Name + Location)');
    const regRes = await request('/api/auth/citizen/register', {
      method: 'POST',
      body: {
        phone: testPhone,
        name: 'Ramesh Kumar',
        state: 'Uttarakhand',
        district: 'Dehradun',
        village: 'Maldevta'
      }
    });
    assert(regRes.status === 201, 'Citizen registration returns 201 Created');
    assert(Boolean(regRes.data.token), 'Returns session token');
    assert(regRes.data.user.role === 'villager', 'Assigned role is villager');
    assert(regRes.data.user.verificationStatus === 'NOT_REQUIRED', 'Citizen verificationStatus is NOT_REQUIRED');
    assert(regRes.data.user.village === 'Maldevta', 'Village saved accurately');

    // -------------------------------------------------------------
    // Test 4: Citizen Phone Lookup (Privacy Protected)
    // -------------------------------------------------------------
    console.log('\n[TEST 4] Citizen Phone Lookup (Privacy Enforcement)');
    const lookup2 = await request('/api/auth/citizen/lookup', {
      method: 'POST',
      body: { phone: testPhone }
    });
    assert(lookup2.status === 200, 'Lookup returns 200 OK');
    assert(lookup2.data.exists === true, 'exists is true for registered citizen');
    assert(lookup2.data.accountType === 'citizen', 'accountType is citizen');
    assert(!lookup2.data.name && !lookup2.data.village, 'Does not expose name/village to prevent phone enumeration');

    // -------------------------------------------------------------
    // Test 5: Citizen Direct Phone-Only Login
    // -------------------------------------------------------------
    console.log('\n[TEST 5] Citizen Direct Phone-Only Login');
    const loginRes = await request('/api/auth/citizen/login', {
      method: 'POST',
      body: { phone: testPhone }
    });
    assert(loginRes.status === 200, 'Direct phone login returns 200 OK');
    assert(Boolean(loginRes.data.token), 'Returns valid session token');
    assert(loginRes.data.user.name === 'Ramesh Kumar', 'Returns citizen user name');

    // -------------------------------------------------------------
    // Test 6: Super Admin Stats & Citizens Directory
    // -------------------------------------------------------------
    console.log('\n[TEST 6] Super Admin Dashboard Endpoints');
    const superAdminToken = createToken({
      id: 'super-admin-root',
      name: 'Sahayta Setu Administrator',
      email: 'superadmin@sahaytasetu.gov.in',
      role: 'super_admin'
    });

    const statsRes = await request('/api/admin/stats', {
      headers: { Authorization: `Bearer ${superAdminToken}` }
    });
    assert(statsRes.status === 200, 'GET /api/admin/stats returns 200 OK');
    assert(typeof statsRes.data.totalCitizens === 'number', 'Stats contains totalCitizens count');
    assert(typeof statsRes.data.totalOrganizations === 'number', 'Stats contains totalOrganizations count');

    const citizensRes = await request('/api/admin/citizens', {
      headers: { Authorization: `Bearer ${superAdminToken}` }
    });
    assert(citizensRes.status === 200, 'GET /api/admin/citizens returns 200 OK');
    assert(Array.isArray(citizensRes.data), 'Citizens list is array');

    // -------------------------------------------------------------
    // Test 7: Super Admin Shelters Overview & Management
    // -------------------------------------------------------------
    console.log('\n[TEST 7] Super Admin Shelter CRUD & Close Endpoint');
    const sheltersRes = await request('/api/shelters');
    assert(sheltersRes.status === 200, 'GET /api/shelters returns 200 OK');
    assert(Array.isArray(sheltersRes.data), 'Shelters list is array');

    const createShelterRes = await request('/api/shelters', {
      method: 'POST',
      headers: { Authorization: `Bearer ${superAdminToken}` },
      body: {
        name: 'Dehradun Sports Complex Evacuation Center',
        type: 'SHELTER',
        state: 'Uttarakhand',
        district: 'Dehradun',
        capacity: 400,
        address: 'Parade Ground, Dehradun',
        publicContact: '+91 0135-2712345',
        location: { lat: 30.325, lng: 78.041 }
      }
    });
    assert(createShelterRes.status === 201, 'Super admin can create shelter (201 Created)');
    assert(createShelterRes.data.verified === true, 'Shelter is verified by admin');

    const newShelterId = createShelterRes.data._id || createShelterRes.data.id;
    const closeRes = await request(`/api/shelters/${newShelterId}/close`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${superAdminToken}` }
    });
    assert(closeRes.status === 200, 'Shelter close endpoint returns 200 OK');
    assert(closeRes.data.shelter.status === 'CLOSED', 'Shelter status transitions to CLOSED');

    console.log(`\n====================================================`);
    console.log(`  REAL DATA VERIFICATION: ${passCount} PASSED, ${failCount} FAILED`);
    console.log(`====================================================\n`);
  } catch (err) {
    console.error('Test Suite Error:', err);
    failCount++;
  } finally {
    serverInstance.close();
    if (failCount > 0) process.exit(1);
  }
}

runRealDataTests();
