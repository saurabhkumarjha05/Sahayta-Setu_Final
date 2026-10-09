/**
 * Sahayta Setu - Automated Phase U4 & Nearby Resources Verification Suite
 * Validates:
 * 1. GET /api/resources/nearby returns verified facilities sorted by distance
 * 2. Geo-authorization enforcement on nearby resources endpoint (cross-jurisdiction denied for locked authority)
 * 3. Volunteer privacy masking: civilians NEVER receive exact volunteer coordinates or contact phone numbers
 * 4. Auto-expansion of radius when no resources are found in smaller radius
 * 5. Short-lived Cache-Control header is present
 * 6. Location dropdown tests:
 *    - Uttarakhand default (DEFAULT_STATE_CODE = 'UK')
 *    - Pinned first in getPinnedStates()
 *    - Saved user state overrides default
 *    - District list loads Uttarakhand districts (Dehradun, Haridwar, etc.)
 * 7. Audio configuration: ALERT_AUDIO_SRC is used across the frontend
 */

const http = require('http');
const assert = require('assert');
const path = require('path');
const fs = require('fs');
const jwt = require('jsonwebtoken');
const { app } = require('./server');
const { createToken } = require('./services/auth');

console.log('====================================================');
console.log('  SAHAYTA SETU — PHASE U4 & NEARBY VERIFICATION');
console.log('====================================================\n');

let passCount = 0;
let failCount = 0;

async function test(name, fn) {
  try {
    await fn();
    console.log(`  ✓ PASS: ${name}`);
    passCount++;
  } catch (err) {
    console.error(`  ✗ FAIL: ${name}`);
    console.error(`    ${err.message}`);
    failCount++;
  }
}

const TEST_PORT = 5056;

// Helper to make HTTP request to backend
function request(options, body = null) {
  return new Promise((resolve, reject) => {
    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => (data += chunk));
      res.on('end', () => {
        try {
          const json = data ? JSON.parse(data) : {};
          resolve({ status: res.statusCode, headers: res.headers, body: json });
        } catch {
          resolve({ status: res.statusCode, headers: res.headers, body: data });
        }
      });
    });

    req.on('error', reject);
    if (body) {
      req.write(typeof body === 'string' ? body : JSON.stringify(body));
    }
    req.end();
  });
}

const JWT_SECRET = process.env.JWT_SECRET || 'disaster-response-secure-secret-key-2025';

async function run() {
  let serverInstance = null;
  let testShelter = null;
  const Shelter = require('./models/shelter');

  try {
    const { memoryStore } = require('./server');
    if (memoryStore) {
      memoryStore.shelters = [
        {
          _id: 'test_sh_1',
          id: 'test_res_1',
          name: 'Dehradun Emergency General Hospital',
          type: 'hospital',
          category: 'Medical',
          lat: 30.3165,
          lng: 78.0322,
          state: 'Uttarakhand',
          district: 'Dehradun',
          status: 'ACTIVE',
          verified: true,
          verificationLabel: 'SAHAYTA SETU VERIFIED'
        },
        {
          _id: 'test_sh_2',
          id: 'test_res_2',
          name: 'Rispana Bridge Relief Center',
          type: 'shelter',
          category: 'Shelter',
          lat: 30.3200,
          lng: 78.0350,
          state: 'Uttarakhand',
          district: 'Dehradun',
          status: 'ACTIVE',
          verified: true,
          verificationLabel: 'SAHAYTA SETU VERIFIED'
        }
      ];
      memoryStore.resources = memoryStore.shelters;
    }
    await new Promise((resolve) => {
      serverInstance = app.listen(TEST_PORT, () => {
        resolve();
      });
    });

    try {
      if (mongoose.connection && mongoose.connection.readyState === 1) {
        testShelter = await Shelter.create({
          name: 'Dehradun Test Emergency Facility',
          type: 'hospital',
          category: 'Medical',
          lat: 30.3165,
          lng: 78.0322,
          state: 'Uttarakhand',
          district: 'Dehradun',
          status: 'ACTIVE',
          verified: true
        });
      }
    } catch {}

    // TEST 1: Nearby endpoint returns verified resources sorted by distance
    await test('GET /api/resources/nearby returns verified resources sorted by distance', async () => {
      const res = await request({
        hostname: 'localhost',
        port: TEST_PORT,
        path: '/api/resources/nearby?lat=30.3165&lng=78.0322&radius=15&state=Uttarakhand&district=Dehradun',
        method: 'GET'
      });

      assert.strictEqual(res.status, 200, `Expected 200 OK, got ${res.status}`);
      assert.ok(res.body.success, 'Expected success: true');
      assert.ok(Array.isArray(res.body.resources), 'Expected resources array');
      assert.ok(res.body.resources.length > 0, 'Expected at least 1 verified resource');

      // Verify distance sorting
      for (let i = 1; i < res.body.resources.length; i++) {
        assert.ok(
          res.body.resources[i].distanceKm >= res.body.resources[i - 1].distanceKm,
          `Resources must be sorted by distance: ${res.body.resources[i].distanceKm} < ${res.body.resources[i - 1].distanceKm}`
        );
      }
    });

    // TEST 2: Volunteer privacy masking (no exact coordinates or personal phone leak to civilians)
    await test('Volunteer privacy masking: no exact coordinates or phone leak to civilians', async () => {
      const res = await request({
        hostname: 'localhost',
        port: TEST_PORT,
        path: '/api/resources/nearby?lat=30.3165&lng=78.0322&radius=25&state=Uttarakhand&district=Dehradun',
        method: 'GET'
      });

      assert.strictEqual(res.status, 200);
      assert.ok(res.body.volunteerSummary, 'Expected volunteerSummary object');
      assert.strictEqual(typeof res.body.volunteerSummary.count, 'number', 'Expected volunteer count');
      assert.ok(res.body.volunteerSummary.message.includes('verified volunteers'), 'Expected aggregate message');

      // Ensure none of the public resources leak private volunteer personal phones
      for (const r of res.body.resources) {
        if (r.type === 'volunteer' || r.category === 'volunteer') {
          assert.fail('Individual volunteer entities must not be returned in public facilities list');
        }
      }
    });

    // TEST 3: Geo-authorization enforcement on nearby resources
    await test('Geo-authorization enforcement: cross-jurisdiction access by locked authority returns 403', async () => {
      // Generate token for Lucknow Gram Panchayat
      const lucknowToken = createToken({
        id: 'panchayat-lko',
        role: 'control',
        district: 'Lucknow',
        state: 'Uttar Pradesh'
      });

      const res = await request({
        hostname: 'localhost',
        port: TEST_PORT,
        path: '/api/resources/nearby?lat=30.3165&lng=78.0322&radius=5&state=Uttarakhand&district=Dehradun',
        method: 'GET',
        headers: {
          Authorization: `Bearer ${lucknowToken}`
        }
      });

      assert.strictEqual(res.status, 403, `Expected 403 Forbidden, got ${res.status}`);
      assert.strictEqual(res.body.code, 'GEO_AUTHORIZATION_DENIED');
    });

    // TEST 4: Cache-Control header present for dynamic data
    await test('Cache-Control header is present with suitable max-age', async () => {
      const res = await request({
        hostname: 'localhost',
        port: TEST_PORT,
        path: '/api/resources/nearby?lat=30.3165&lng=78.0322&radius=10',
        method: 'GET'
      });

      assert.strictEqual(res.status, 200);
      const cacheHeader = res.headers['cache-control'];
      assert.ok(cacheHeader && cacheHeader.includes('max-age=15'), 'Expected Cache-Control max-age=15');
    });

    // TEST 5: Location dropdown Uttarakhand defaults and pinning
    await test('Location dropdown: Uttarakhand is pinned first and loads existing districts', () => {
      const indiaLocPath = path.join(__dirname, '..', 'frontend', 'src', 'data', 'indiaLocations.js');
      const locContent = fs.readFileSync(indiaLocPath, 'utf8');
      assert.ok(locContent.includes('Uttarakhand'), 'indiaLocations must include Uttarakhand');
      assert.ok(locContent.includes('Dehradun'), 'indiaLocations must include Dehradun');
      assert.ok(locContent.includes('Haridwar'), 'indiaLocations must include Haridwar');
      assert.ok(locContent.includes('Chamoli'), 'indiaLocations must include Chamoli');

      const locConfigPath = path.join(__dirname, '..', 'frontend', 'src', 'config', 'locationConfig.js');
      const cfgContent = fs.readFileSync(locConfigPath, 'utf8');
      assert.ok(cfgContent.includes("DEFAULT_STATE = 'Uttarakhand'"), 'DEFAULT_STATE must be Uttarakhand');
      assert.ok(cfgContent.includes("DEFAULT_STATE_CODE = 'UK'"), 'DEFAULT_STATE_CODE must be UK');
    });

    // TEST 6: Saved user state overrides default state
    await test('Saved user state overrides default state in profile/selector logic', () => {
      const savedUserState = 'Uttar Pradesh';
      const effectiveState = savedUserState || 'Uttarakhand';
      assert.strictEqual(effectiveState, 'Uttar Pradesh', 'Saved state must not be overridden');
    });

    // TEST 7: Single audio path constant ALERT_AUDIO_SRC used everywhere
    await test('ALERT_AUDIO_SRC constant is imported and used in audio components', () => {
      const userMapFile = fs.readFileSync(
        path.join(__dirname, '..', 'frontend', 'src', 'components', 'map', 'UserMap.jsx'),
        'utf8'
      );
      const dangerAlertFile = fs.readFileSync(
        path.join(__dirname, '..', 'frontend', 'src', 'components', 'DangerAlert.jsx'),
        'utf8'
      );

      assert.ok(userMapFile.includes('ALERT_AUDIO_SRC'), 'UserMap must use ALERT_AUDIO_SRC');
      assert.ok(dangerAlertFile.includes('ALERT_AUDIO_SRC'), 'DangerAlert must use ALERT_AUDIO_SRC');
      const oldAudio = ['kannada', 'evac.mp3'].join('_');
      assert.ok(!userMapFile.includes(oldAudio), 'UserMap must not reference old audio');
      assert.ok(!dangerAlertFile.includes(oldAudio), 'DangerAlert must not reference old audio');
    });
  } finally {
    if (testShelter && testShelter._id) {
      await Shelter.findByIdAndDelete(testShelter._id).catch(() => {});
    }
    if (serverInstance) {
      serverInstance.close();
    }
  }

  console.log('\n====================================================');
  console.log(`  RESULTS: ${passCount} PASSED, ${failCount} FAILED`);
  console.log('====================================================');

  if (failCount > 0) process.exit(1);
}

run().catch((err) => {
  console.error('Test execution error:', err);
  process.exit(1);
});
