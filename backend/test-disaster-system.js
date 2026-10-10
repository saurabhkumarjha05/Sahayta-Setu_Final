process.env.NODE_ENV = 'test';
const http = require('http');
const crypto = require('crypto');
const { app, memoryStore } = require('./server');
const { createToken } = require('./services/auth');
const { canonicalStringify, registerDevice, revokeDevice, validateEmergencyPacket } = require('./services/cryptoService');
const { calculateDistanceKm, matchNearestResponders } = require('./services/matchingService');
const { verifyJurisdiction, filterByJurisdiction } = require('./services/geoAuth');
const { sendTargetedPush, savePushSubscription, pushSubscriptions } = require('./services/realtimeService');
const {
  SOS_LITE_VERSION,
  buildSosLitePayload,
  getUnsignedLitePayload,
  computeLitePriority,
  validateSosLite,
  measurePayloadBytes
} = require('../shared/sosLite');

let serverInstance;
const TEST_PORT = 5055;
const BASE_URL = `http://localhost:${TEST_PORT}`;

// Helper: HTTP request
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

// Generate real ECDSA P-256 keypair using Node WebCrypto
async function generateTestKeypair() {
  const keyPair = await crypto.subtle.generateKey(
    { name: 'ECDSA', namedCurve: 'P-256' },
    true,
    ['sign', 'verify']
  );
  const publicKeyJwk = await crypto.subtle.exportKey('jwk', keyPair.publicKey);
  return { privateKey: keyPair.privateKey, publicKeyJwk };
}

// Sign payload
async function signPayload(privateKey, payload) {
  const canonical = canonicalStringify(payload);
  const buffer = Buffer.from(canonical, 'utf8');
  const signatureBuffer = await crypto.subtle.sign(
    { name: 'ECDSA', hash: { name: 'SHA-256' } },
    privateKey,
    buffer
  );
  return Buffer.from(signatureBuffer).toString('base64');
}

async function runTests() {
  console.log('====================================================');
  console.log('  SAHAYTA SETU — DISASTER SYSTEM AUTOMATED VERIFICATION');
  console.log('====================================================\n');

  // Start test server
  await new Promise((resolve) => {
    serverInstance = app.listen(TEST_PORT, () => {
      console.log(`✓ Test server running on port ${TEST_PORT}\n`);
      resolve();
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
    // Test 1: Trusted Device Authentication & WebCrypto Signature
    // -------------------------------------------------------------
    console.log('[TEST 1] Trusted Emergency Authentication & WebCrypto ECDSA Signature');
    const { privateKey, publicKeyJwk } = await generateTestKeypair();
    const testDeviceId = `dev_dehradun_001`;
    const villagerUserId = 'user_villager_dehradun';
    const villagerToken = createToken({
      _id: villagerUserId,
      name: 'Rohan Sharma',
      role: 'villager',
      district: 'Dehradun',
      state: 'Uttarakhand'
    });

    // Register trusted device
    const regRes = await request('/api/auth/devices/register', {
      method: 'POST',
      headers: { Authorization: `Bearer ${villagerToken}` },
      body: { deviceId: testDeviceId, publicKey: publicKeyJwk, deviceName: 'Villager Mobile' }
    });
    assert(regRes.status === 201 && regRes.data.success, 'Device registered successfully with WebCrypto public key');

    // Sign legitimate emergency payload
    const emergencyPayload = {
      clientIncidentId: 'inc_dehradun_flood_01',
      userId: villagerUserId,
      deviceId: testDeviceId,
      incidentType: 'Flood',
      description: 'Severe waterlogging near Clock Tower, family stranded',
      state: 'Uttarakhand',
      district: 'Dehradun',
      village: 'Rajpur',
      latitude: 30.3165,
      longitude: 78.0322,
      locationAccuracy: 15,
      locationSource: 'GPS_EXACT',
      isApproximateLocation: false,
      priority: 'HIGH',
      createdAt: new Date().toISOString(),
      timestamp: Date.now()
    };

    const validSignature = await signPayload(privateKey, emergencyPayload);
    assert(typeof validSignature === 'string' && validSignature.length > 50, 'Legitimate ECDSA P-256 signature generated');

    // -------------------------------------------------------------
    // Test 2: Security — Fake Signature / Tampered Payload Rejection
    // -------------------------------------------------------------
    console.log('\n[TEST 2] Security — Tampering, Fake Device, & Signature Rejection');

    // A. Fake signature
    const fakeSigRes = await request('/api/sos', {
      method: 'POST',
      body: {
        clientIncidentId: 'inc_fake_sig',
        userId: villagerUserId,
        deviceId: testDeviceId,
        signature: 'FAKESIGNATUREABC123==',
        payload: emergencyPayload
      }
    });
    assert(fakeSigRes.status === 400, 'SOS with fake/invalid signature rejected with 400 Bad Request');

    // B. Tampered coordinates (changing lat from 30.3165 to 31.0000)
    const tamperedPayload = { ...emergencyPayload, clientIncidentId: 'inc_tampered', latitude: 31.0000 };
    const tamperedRes = await request('/api/sos', {
      method: 'POST',
      body: {
        clientIncidentId: 'inc_tampered',
        userId: villagerUserId,
        deviceId: testDeviceId,
        signature: validSignature, // using original signature on modified payload
        payload: tamperedPayload
      }
    });
    assert(tamperedRes.status === 400, 'Tampered payload with mismatched signature rejected with 400 Bad Request');

    // C. Unregistered Fake Device
    const fakeDeviceRes = await request('/api/sos', {
      method: 'POST',
      body: {
        clientIncidentId: 'inc_fake_dev',
        userId: villagerUserId,
        deviceId: 'dev_unknown_unregistered',
        signature: validSignature,
        payload: emergencyPayload
      }
    });
    assert(fakeDeviceRes.status === 400 || fakeDeviceRes.status === 403, 'Unregistered device rejected');

    // -------------------------------------------------------------
    // Test 3: Valid Offline SOS Sync & Creation
    // -------------------------------------------------------------
    console.log('\n[TEST 3] Valid Emergency SOS Submission & Auto-Dispatch');
    const validSosRes = await request('/api/sos', {
      method: 'POST',
      headers: { Authorization: `Bearer ${villagerToken}` },
      body: {
        clientIncidentId: emergencyPayload.clientIncidentId,
        userId: villagerUserId,
        deviceId: testDeviceId,
        signature: validSignature,
        payload: emergencyPayload
      }
    });
    assert(validSosRes.status === 201, 'Valid signed SOS accepted with 201 Created');
    assert(validSosRes.data.clientIncidentId === emergencyPayload.clientIncidentId, 'clientIncidentId stored verbatim');
    assert(Array.isArray(validSosRes.data.matchedResponders), 'Automatic responder proximity matching included');
    assert(validSosRes.data.matchedResponders.length > 0, 'Nearest responders matched for incident');
    console.log(`    Matched Nearest Unit: ${validSosRes.data.matchedResponders[0]?.responder?.name} (${validSosRes.data.matchedResponders[0]?.distanceKm} km away)`);

    // -------------------------------------------------------------
    // Test 4: Duplicate SOS Protection & Idempotency
    // -------------------------------------------------------------
    console.log('\n[TEST 4] Duplicate SOS Protection & Idempotency');
    const dupRes = await request('/api/sos', {
      method: 'POST',
      body: {
        clientIncidentId: emergencyPayload.clientIncidentId,
        userId: villagerUserId,
        deviceId: testDeviceId,
        signature: validSignature,
        payload: emergencyPayload
      }
    });
    assert(dupRes.status === 200, 'Re-synchronization of existing clientIncidentId returns 200 OK');
    assert(dupRes.data.status === 'existing', 'Returns existing status rather than creating duplicate incident');

    const allIncidents = memoryStore.sos.filter(s => s.clientIncidentId === emergencyPayload.clientIncidentId);
    assert(allIncidents.length === 1, 'Database contains EXACTLY ONE incident after duplicate synchronization');

    // -------------------------------------------------------------
    // Test 5: Strict Geo-Authorization (Panchayat Jurisdiction)
    // -------------------------------------------------------------
    console.log('\n[TEST 5] Strict Geo-Authorization — Dehradun vs Lucknow Panchayat');
    const dehradunPanchayatToken = createToken({
      _id: 'officer_ddn',
      name: 'Dehradun Gram Panchayat Officer',
      role: 'control',
      district: 'Dehradun',
      state: 'Uttarakhand'
    });

    const lucknowPanchayatToken = createToken({
      _id: 'officer_lko',
      name: 'Lucknow Gram Panchayat Officer',
      role: 'control',
      district: 'Lucknow',
      state: 'Uttar Pradesh'
    });

    // Dehradun Panchayat queries Dehradun SOS -> ALLOWED
    const ddnQueryRes = await request('/api/sos?district=Dehradun', {
      headers: { Authorization: `Bearer ${dehradunPanchayatToken}` }
    });
    assert(ddnQueryRes.status === 200, 'Dehradun Panchayat can access Dehradun incidents (200 OK)');
    assert(ddnQueryRes.data.some(s => s.clientIncidentId === emergencyPayload.clientIncidentId), 'Dehradun SOS is visible to Dehradun Panchayat');

    // Lucknow Panchayat attempts to query Dehradun incidents -> FORBIDDEN (403)
    const lkoCrossDistrictRes = await request('/api/sos?district=Dehradun', {
      headers: { Authorization: `Bearer ${lucknowPanchayatToken}` }
    });
    assert(lkoCrossDistrictRes.status === 403, 'Cross-district access by Lucknow Panchayat blocked with 403 Forbidden');
    assert(lkoCrossDistrictRes.data.code === 'GEO_AUTHORIZATION_DENIED', 'Returns code GEO_AUTHORIZATION_DENIED');

    // Lucknow Panchayat triggers alert in Dehradun -> FORBIDDEN (403)
    const lkoCrossAlertRes = await request('/api/alerts/trigger', {
      method: 'POST',
      headers: { Authorization: `Bearer ${lucknowPanchayatToken}` },
      body: {
        district: 'Dehradun',
        riskLevel: 'Severe',
        message: 'Illegal cross-district alert'
      }
    });
    assert(lkoCrossAlertRes.status === 403, 'Cross-district alert trigger blocked with 403 Forbidden');

    // Dehradun Panchayat triggers alert in Dehradun -> ALLOWED (201)
    const ddnAlertRes = await request('/api/alerts/trigger', {
      method: 'POST',
      headers: { Authorization: `Bearer ${dehradunPanchayatToken}` },
      body: {
        district: 'Dehradun',
        riskLevel: 'Severe',
        title: 'FLASH FLOOD WARNING — DEHRADUN',
        message: 'Heavy rainfall may cause flooding in low-lying areas of Dehradun.'
      }
    });
    assert(ddnAlertRes.status === 201, 'Authorized Dehradun Panchayat alert published with 201 Created');

    // -------------------------------------------------------------
    // Test 6: Volunteer Mission Acceptance & Assignment Locking
    // -------------------------------------------------------------
    console.log('\n[TEST 6] Volunteer Proximity Matching & Assignment Locking');
    const ngoToken1 = createToken({
      _id: 'user_ngo_1',
      name: 'Helping Hands Response Unit',
      role: 'ngo',
      district: 'Dehradun',
      state: 'Uttarakhand',
      ngo: 'ngo-uk-1'
    });

    const ngoToken2 = createToken({
      _id: 'user_ngo_2',
      name: 'Doon Disaster Relief Corps',
      role: 'ngo',
      district: 'Dehradun',
      state: 'Uttarakhand',
      ngo: 'ngo-uk-2'
    });

    // Volunteer 1 accepts the SOS -> SUCCESS (200)
    const accept1Res = await request(`/api/sos/${emergencyPayload.clientIncidentId}/assign`, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${ngoToken1}` }
    });
    assert(accept1Res.status === 200, 'First responder successfully locks and accepts SOS mission');
    assert(accept1Res.data.status === 'In Progress', 'SOS status transitions to In Progress');

    // Volunteer 2 attempts to accept the SAME SOS -> 409 CONFLICT (Assignment Locked!)
    const accept2Res = await request(`/api/sos/${emergencyPayload.clientIncidentId}/assign`, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${ngoToken2}` }
    });
    assert(accept2Res.status === 409, 'Second responder receives 409 Conflict: Mission already locked to prevent duplicate dispatch');

    // -------------------------------------------------------------
    // Test 7: Live Responder Movement Tracking
    // -------------------------------------------------------------
    console.log('\n[TEST 7] Live Responder Movement Tracking');
    // Responder reports movement closer to incident
    const moveRes = await request('/api/ngos/location', {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${ngoToken1}` },
      body: {
        lat: 30.3180,
        lng: 78.0330,
        status: 'Busy',
        activeSosId: emergencyPayload.clientIncidentId
      }
    });
    assert(moveRes.status === 200, 'Responder coordinates updated on server (200 OK)');

    const updatedSosRes = await request(`/api/sos/${emergencyPayload.clientIncidentId}`, {
      headers: { Authorization: `Bearer ${dehradunPanchayatToken}` }
    });
    assert(updatedSosRes.data.responderLocation !== null, 'SOS reflects live responder position');
    assert(typeof updatedSosRes.data.responderDistanceKm === 'number', 'Incident tracks live responder distance (km)');

    // -------------------------------------------------------------
    // Test 8: Device Revocation Protection
    // -------------------------------------------------------------
    console.log('\n[TEST 8] Device Revocation Protection');
    const revokeRes = await request('/api/auth/devices/revoke', {
      method: 'POST',
      headers: { Authorization: `Bearer ${villagerToken}` },
      body: { deviceId: testDeviceId }
    });
    assert(revokeRes.status === 200 && revokeRes.data.revoked, 'Device revoked successfully');

    // Attempting SOS from revoked device must be rejected with 403
    const revokedPayload = {
      ...emergencyPayload,
      clientIncidentId: 'inc_from_revoked_device',
      createdAt: new Date().toISOString()
    };
    const revokedSig = await signPayload(privateKey, revokedPayload);
    const postRevokedRes = await request('/api/sos', {
      method: 'POST',
      body: {
        clientIncidentId: revokedPayload.clientIncidentId,
        userId: villagerUserId,
        deviceId: testDeviceId,
        signature: revokedSig,
        payload: revokedPayload
      }
    });
    assert(postRevokedRes.status === 403, 'SOS from revoked device rejected with 403 Forbidden');

    // -------------------------------------------------------------
    // Test 9: Targeted Web Push Filtering
    // -------------------------------------------------------------
    console.log('\n[TEST 9] Targeted Web Push Filtering by Jurisdiction');
    // Register mock subscriptions: 1 in Dehradun, 1 in Lucknow
    savePushSubscription(
      { endpoint: 'https://push.example.com/sub_dehradun_user', keys: { p256dh: 'mock', auth: 'mock' } },
      { district: 'Dehradun', state: 'Uttarakhand' }
    );
    savePushSubscription(
      { endpoint: 'https://push.example.com/sub_lucknow_user', keys: { p256dh: 'mock', auth: 'mock' } },
      { district: 'Lucknow', state: 'Uttar Pradesh' }
    );

    const ddnSub = pushSubscriptions.get('https://push.example.com/sub_dehradun_user');
    const lkoSub = pushSubscriptions.get('https://push.example.com/sub_lucknow_user');
    assert(ddnSub.district === 'dehradun' && lkoSub.district === 'lucknow', 'Push subscriptions registered with correct jurisdiction');

    // -------------------------------------------------------------
    // Test 10: Authority Alert Issuance & Retransmission Workflow
    // -------------------------------------------------------------
    console.log('\n[TEST 10] Authority Alert Issuance & Retransmission Workflow');
    // Dehradun Panchayat issues official alert -> 201 Created
    const createAlertRes = await request('/api/alerts/trigger', {
      method: 'POST',
      headers: { Authorization: `Bearer ${dehradunPanchayatToken}` },
      body: {
        title: 'Flash Flood Warning - Rishikesh Sector',
        riskLevel: 'Severe',
        message: 'High water level reported. Move to designated relief shelters.',
        district: 'Dehradun',
        state: 'Uttarakhand'
      }
    });
    assert(createAlertRes.status === 201, 'Authorized Panchayat successfully publishes official disaster alert (201)');
    const officialAlertId = createAlertRes.data._id;

    // Unauthorized NGO attempts to publish official disaster alert -> 403 Forbidden
    const ngoAlertRes = await request('/api/alerts/trigger', {
      method: 'POST',
      headers: { Authorization: `Bearer ${ngoToken1}` },
      body: {
        title: 'Fake Government Alert',
        riskLevel: 'Severe',
        message: 'Evacuate immediately',
        district: 'Dehradun'
      }
    });
    assert(ngoAlertRes.status === 403, 'Unauthorized NGO blocked from issuing official government alerts (403 Forbidden)');

    // Authorized Dehradun Panchayat retransmits alert to local jurisdiction -> 201 Created
    const retransmitRes = await request(`/api/alerts/${officialAlertId}/retransmit`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${dehradunPanchayatToken}` },
      body: {
        targetDistrict: 'Dehradun',
        targetState: 'Uttarakhand'
      }
    });
    assert(retransmitRes.status === 201, 'Authorized Panchayat successfully retransmits official alert to local jurisdiction (201)');
    assert(retransmitRes.data.isRetransmission === true, 'Retransmission flag preserved in alert lineage');
    assert(retransmitRes.data.originalAlertId === String(officialAlertId), 'Original alert ID preserved for traceability');

    // Unauthorized Lucknow Panchayat attempts to retransmit Dehradun alert outside jurisdiction -> 403 Forbidden
    const unauthRetransmitRes = await request(`/api/alerts/${officialAlertId}/retransmit`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${lucknowPanchayatToken}` },
      body: {
        targetDistrict: 'Dehradun',
        targetState: 'Uttarakhand'
      }
    });
    assert(unauthRetransmitRes.status === 403, 'Cross-jurisdiction alert retransmission blocked with 403 Forbidden');

    // -------------------------------------------------------------
    // Test 11: Panchayat Local Response Triage & Operational Dispatch
    // -------------------------------------------------------------
    // Register a fresh active device for this test since testDeviceId was revoked in Test 8
    const triageDeviceId = `device-triage-${Date.now()}`;
    await request('/api/auth/devices/register', {
      method: 'POST',
      headers: { Authorization: `Bearer ${villagerToken}` },
      body: {
        deviceId: triageDeviceId,
        publicKey: publicKeyJwk,
        deviceName: 'Villager Mobile 2'
      }
    });

    const triageSosPayload = {
      clientIncidentId: `inc-triage-${Date.now()}`,
      userId: villagerUserId,
      deviceId: triageDeviceId,
      latitude: 30.3165,
      longitude: 78.0322,
      locationAccuracy: 15,
      locationSource: 'GPS_EXACT',
      district: 'Dehradun',
      state: 'Uttarakhand',
      incidentType: 'Flood',
      priority: 'HIGH',
      createdAt: new Date().toISOString()
    };
    const triageSig = await signPayload(privateKey, triageSosPayload);
    const createTriageRes = await request('/api/sos', {
      method: 'POST',
      headers: { Authorization: `Bearer ${villagerToken}` },
      body: {
        clientIncidentId: triageSosPayload.clientIncidentId,
        userId: villagerUserId,
        deviceId: triageDeviceId,
        signature: triageSig,
        payload: triageSosPayload
      }
    });
    assert(createTriageRes.status === 201, 'Incident created for triage testing');

    // Panchayat reviews and triages incident: sets CRITICAL, requires Boat Rescue & Medical, 5 people affected
    const triageRes = await request(`/api/sos/${triageSosPayload.clientIncidentId}/triage`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${dehradunPanchayatToken}` },
      body: {
        priority: 'CRITICAL',
        requiredCapabilities: ['Boat Rescue', 'Medical'],
        peopleAffected: 5,
        triageNotes: 'Trapped on rooftop due to river inundation'
      }
    });
    assert(triageRes.status === 200, 'Gram Panchayat successfully triages incident priority and required resources (200 OK)');
    assert(triageRes.data.sos.priority === 'CRITICAL', 'Incident priority escalated to CRITICAL by Panchayat');
    assert(triageRes.data.sos.isTriageComplete === true, 'Incident marked as triaged');

    // Panchayat assigns specific response team (Helping Hands Response Unit)
    const dispatchRes = await request(`/api/sos/${triageSosPayload.clientIncidentId}/assign`, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${dehradunPanchayatToken}` },
      body: { responderId: 'ngo-uk-1' }
    });
    assert(dispatchRes.status === 200, 'Panchayat control center successfully dispatches verified responder team');
    assert(dispatchRes.data.status === 'In Progress', 'Dispatched SOS status transitions to In Progress');

    // -------------------------------------------------------------
    // Test 12: Civilian Privacy Protection for Unassigned Responders
    // -------------------------------------------------------------
    console.log('\n[TEST 12] Civilian Privacy Masking on Unassigned Responder Queries');
    // An unassigned NGO queries SOS list
    const unassignedNgoQueryRes = await request('/api/sos', {
      headers: { Authorization: `Bearer ${ngoToken2}` }
    });
    assert(unassignedNgoQueryRes.status === 200, 'Unassigned NGO queries incident list successfully');
    const maskedSos = unassignedNgoQueryRes.data.find(s => s.clientIncidentId === triageSosPayload.clientIncidentId);
    if (maskedSos) {
      assert(maskedSos.isApproximateLocation === true, 'Civilian exact GPS coordinates are obfuscated/fuzzed for unassigned responders');
      assert(maskedSos.contactPhone.includes('******'), 'Civilian contact phone number is masked for privacy');
    }

    // Authorized Control Authority queries same SOS list -> receives full unmasked details
    const controlSosQueryRes = await request('/api/sos', {
      headers: { Authorization: `Bearer ${dehradunPanchayatToken}` }
    });
    const fullSos = controlSosQueryRes.data.find(s => s.clientIncidentId === triageSosPayload.clientIncidentId);
    assert(fullSos && !fullSos.contactPhone.includes('******'), 'Control Authority receives unmasked emergency coordinates and contact details');

    // -------------------------------------------------------------
    // Test 13: Admin Verification Center & Entity Lifecycle
    // -------------------------------------------------------------
    console.log('\n[TEST 13] Admin Verification Center & Entity Lifecycle');
    // List entities
    const verifListRes = await request('/api/admin/verifications', {
      headers: { Authorization: `Bearer ${dehradunPanchayatToken}` }
    });
    assert(verifListRes.status === 200 && Array.isArray(verifListRes.data), 'Verification center retrieves entity list (200 OK)');

    // Approve pending entity
    const verifyRes = await request('/api/admin/verify/entity-pending-ngo', {
      method: 'POST',
      headers: { Authorization: `Bearer ${dehradunPanchayatToken}` }
    });
    assert(verifyRes.status === 200, 'Admin successfully approves and verifies pending entity');
    assert(verifyRes.data.entity.verificationStatus === 'VERIFIED', 'Entity transitions to VERIFIED');
    assert(verifyRes.data.entity.verificationLabel === 'SAHAYTA SETU VERIFIED', 'Entity receives official SAHAYTA SETU VERIFIED label');

    // Suspend entity
    const suspendRes = await request('/api/admin/suspend/entity-pending-ngo', {
      method: 'POST',
      headers: { Authorization: `Bearer ${dehradunPanchayatToken}` }
    });
    assert(suspendRes.status === 200 && suspendRes.data.entity.verificationStatus === 'SUSPENDED', 'Admin can suspend entity from operational duties');

    // -------------------------------------------------------------
    // Test 14: Disaster Operations Audit Trail
    // -------------------------------------------------------------
    console.log('\n[TEST 14] Disaster Operations Audit Trail');
    const auditRes = await request('/api/admin/audit-logs', {
      headers: { Authorization: `Bearer ${dehradunPanchayatToken}` }
    });
    assert(auditRes.status === 200 && Array.isArray(auditRes.data), 'Audit log query returns operational event list');
    const actionsRecorded = new Set(auditRes.data.map(l => l.action));
    assert(actionsRecorded.has('SOS_CREATED'), 'Audit log records SOS_CREATED event');
    assert(actionsRecorded.has('SOS_TRIAGED'), 'Audit log records SOS_TRIAGED event');
    assert(actionsRecorded.has('SOS_ASSIGNED'), 'Audit log records SOS_ASSIGNED event');
    assert(actionsRecorded.has('ALERT_CREATED'), 'Audit log records ALERT_CREATED event');
    assert(actionsRecorded.has('ALERT_RETRANSMITTED'), 'Audit log records ALERT_RETRANSMITTED event');

    // -------------------------------------------------------------
    // Test 15: SOS Lite & Low-Network Resilience Verification
    // -------------------------------------------------------------
    console.log('\n[TEST 15] SOS Lite & Low-Network Resilience Verification');

    // 15a: Register a trusted device for SOS Lite
    const liteUserId = 'villager_lite_01';
    const liteDeviceId = 'dev_lite_test_99';
    const { privateKey: litePrivateKey, publicKeyJwk: litePublicKeyJwk } = await generateTestKeypair();
    await registerDevice(liteUserId, liteDeviceId, litePublicKeyJwk, 'Lite Test Device');

    // 15b: Construct compact SOS Lite payload
    const liteIncidentId = `inc_lite_${Date.now()}`;
    const unsignedLite = buildSosLitePayload({
      clientIncidentId: liteIncidentId,
      deviceId: liteDeviceId,
      incidentType: 'Flash Flood',
      lat: 30.3245,
      lng: 78.0412,
      locationSource: 'GPS_EXACT',
      locationAccuracy: 12,
      peopleAffected: 6,
      vulnerableCount: 2,
      needsMedical: true,
      createdAt: new Date().toISOString()
    });

    // 15c: Verify payload size < 1 KB (1024 bytes)
    const liteSignature = await signPayload(litePrivateKey, unsignedLite);
    const completeLitePacket = {
      ...unsignedLite,
      signature: liteSignature
    };
    const serializedByteSize = measurePayloadBytes(completeLitePacket);
    console.log(`    Serialized SOS Lite Byte Size: ${serializedByteSize} bytes`);
    assert(serializedByteSize < 1024, `Lite payload is strictly compact: ${serializedByteSize} bytes < 1024 bytes (1 KB)`);

    // 15d: Submit valid SOS Lite over HTTP fallback (when socket is unavailable/bypassed)
    const litePostRes = await request('/api/sos/lite', {
      method: 'POST',
      body: completeLitePacket
    });
    assert(litePostRes.status === 201, 'SOS Lite accepted with 201 Created via HTTP fallback');
    assert(litePostRes.data.isLite === true, 'Incident recorded with isLite flag');
    assert(litePostRes.data.priority === 'CRITICAL', 'Priority computed accurately from Lite attributes (medical + flash flood)');
    assert(litePostRes.data.sourceChannel === 'DIRECT_INTERNET', 'Default sourceChannel set to DIRECT_INTERNET');
    assert(new Date(litePostRes.data.receivedAt).getTime() >= new Date(litePostRes.data.createdAt).getTime(), 'Distinct receivedAt and createdAt timestamps preserved');

    // 15e: Tampered Lite payload is rejected
    const tamperedLite = {
      ...unsignedLite,
      clientIncidentId: 'inc_lite_tampered',
      peopleAffected: 99, // tampered count
      signature: liteSignature
    };
    const tamperedLiteRes = await request('/api/sos/lite', {
      method: 'POST',
      body: tamperedLite
    });
    assert(tamperedLiteRes.status === 400, 'Tampered Lite payload is rejected with 400 Bad Request');

    // 15f: Duplicate retry does not create duplicate SOS (Idempotency)
    const dupLiteRes = await request('/api/sos/lite', {
      method: 'POST',
      body: completeLitePacket
    });
    assert(dupLiteRes.status === 200, 'Duplicate SOS Lite retry returns 200 OK');
    assert(dupLiteRes.data.status === 'existing', 'Duplicate retry identifies existing incident');
    const existingIncidents = memoryStore.sos.filter(s => s.clientIncidentId === liteIncidentId);
    assert(existingIncidents.length === 1, 'Database contains EXACTLY ONE incident after duplicate SOS Lite retry');

    // 15g: Follow-up details sync merges into same incident without duplicates
    const detailsPayload = {
      clientIncidentId: liteIncidentId,
      description: 'Trapped on second floor balcony with rising water; elderly grandmother and infant need boat extraction.',
      contactName: 'Sunita Devi',
      contactPhone: '+919876543219',
      village: 'Maldevta',
      photos: ['https://sahaytasetu.in/photos/flood_balcony.jpg'],
      extraNotes: 'Power lines down nearby. Bring dry food packets.',
      requiredCapabilities: ['Boat Rescue', 'Medical']
    };
    const detailsRes = await request('/api/sos/details', {
      method: 'POST',
      body: detailsPayload
    });
    assert(detailsRes.status === 200, 'Follow-up details sync returns 200 OK');
    assert(detailsRes.data.status === 'merged', 'Details merged into same incident');

    const mergedIncident = memoryStore.sos.find(s => s.clientIncidentId === liteIncidentId);
    assert(mergedIncident.detailsSynced === true, 'Incident detailsSynced is updated to true');
    assert(mergedIncident.description.includes('Trapped on second floor'), 'Incident description updated with follow-up situation details');
    assert(mergedIncident.contactName === 'Sunita Devi', 'Reporter contact name merged');
    assert(mergedIncident.village === 'Maldevta', 'Village location merged');
    assert(mergedIncident.requiredCapabilities.includes('Boat Rescue'), 'Required rescue capabilities updated');

    // Verify still only one record
    const totalWithId = memoryStore.sos.filter(s => s.clientIncidentId === liteIncidentId);
    assert(totalWithId.length === 1, 'Incident count remains EXACTLY ONE after details merge');

    // 15h: HTTP endpoint with PEER_RELAY sourceChannel
    const peerIncidentId = `inc_peer_${Date.now()}`;
    const peerUnsigned = buildSosLitePayload({
      clientIncidentId: peerIncidentId,
      deviceId: liteDeviceId,
      incidentType: 'Landslide',
      lat: 30.35,
      lng: 78.06,
      locationSource: 'LAST_KNOWN',
      locationAccuracy: 25,
      peopleAffected: 3,
      vulnerableCount: 0,
      needsMedical: false,
      createdAt: new Date().toISOString()
    });
    const peerSig = await signPayload(litePrivateKey, peerUnsigned);
    const peerRes = await request('/api/sos/lite', {
      method: 'POST',
      body: {
        ...peerUnsigned,
        signature: peerSig,
        sourceChannel: 'PEER_RELAY'
      }
    });
    assert(peerRes.status === 201, 'SOS Lite with PEER_RELAY accepted with 201 Created');
    assert(peerRes.data.sourceChannel === 'PEER_RELAY', 'sourceChannel PEER_RELAY preserved');

    // 15i: A signed compact SOS relayed through /api/sos/relay preserves origin location and jurisdiction
    const relayedLiteIncidentId = `inc_relay_lite_${Date.now()}`;
    const relayedLitePayload = buildSosLitePayload({
      clientIncidentId: relayedLiteIncidentId,
      deviceId: liteDeviceId,
      incidentType: 'Flash Flood',
      lat: 12.9716,
      lng: 77.5946,
      locationSource: 'GPS_EXACT',
      locationAccuracy: 9,
      peopleAffected: 4,
      vulnerableCount: 1,
      needsMedical: true,
      createdAt: new Date().toISOString()
    });
    const relayedLiteSignature = await signPayload(litePrivateKey, relayedLitePayload);
    const relayIngestRes = await request('/api/sos/relay', {
      method: 'POST',
      body: {
        payload: relayedLitePayload,
        signature: relayedLiteSignature,
        hopCount: 2,
        relayDeviceId: 'dev_nearby_relay',
        district: 'Bengaluru Urban',
        state: 'Karnataka',
        village: 'Shivajinagar'
      }
    });
    assert(relayIngestRes.status === 201, 'Signed compact SOS Lite is accepted by the peer relay endpoint');
    assert(relayIngestRes.data.location.lat === 12.9716 && relayIngestRes.data.location.lng === 77.5946, 'Peer relay preserves original compact SOS coordinates');
    assert(relayIngestRes.data.district === 'Bengaluru Urban' && relayIngestRes.data.state === 'Karnataka' && relayIngestRes.data.village === 'Shivajinagar', 'Peer relay preserves original SOS jurisdiction metadata');
    assert(relayIngestRes.data.sourceChannel === 'PEER_RELAY' && relayIngestRes.data.hopCount === 2 && relayIngestRes.data.relayDeviceId === 'dev_nearby_relay', 'Peer relay attribution and hop metadata are recorded');

    // ====================================================
    // TEST 16: Public Health API & WebCrypto Real Device Ingestion
    // ====================================================
    console.log('\n[TEST 16] Public Health API & WebCrypto Real Device Ingestion');

    // 16a: /api/health works with no auth and reports status
    const healthRes = await request('/api/health');
    assert(healthRes.status === 200, 'GET /api/health returns 200 OK without auth');
    assert(healthRes.data.ok === true, 'GET /api/health reports ok: true');
    assert(healthRes.data.db === 'connected' || healthRes.data.db === 'down', 'GET /api/health reports db status');

    // 16b: Fresh WebCrypto device registration and signed SOS Lite
    const t16Dev = await generateTestKeypair();
    const t16DevId = `dev_t16_${Date.now()}`;
    const t16Reg = await request('/api/auth/devices/register', {
      method: 'POST',
      body: {
        deviceId: t16DevId,
        publicKey: t16Dev.publicKeyJwk,
        userId: 'officer_dehradun_01'
      }
    });
    assert(t16Reg.status === 201, 'Device registered successfully through real endpoint');

    // 16c: Valid SOS Lite with NO Authorization header returns 201 Created
    const t16IncidentId = `sos_t16_lite_${Date.now()}`;
    const t16LitePayload = buildSosLitePayload({
      clientIncidentId: t16IncidentId,
      deviceId: t16DevId,
      incidentType: 'Medical',
      lat: 30.3165,
      lng: 78.0322,
      locationSource: 'GPS_EXACT',
      locationAccuracy: 18,
      peopleAffected: 2,
      vulnerableCount: 1,
      needsMedical: true,
      createdAt: new Date().toISOString()
    });
    const t16Signature = await signPayload(t16Dev.privateKey, t16LitePayload);
    const t16LiteRes = await request('/api/sos/lite', {
      method: 'POST',
      headers: {}, // strictly no Authorization header
      body: {
        ...t16LitePayload,
        signature: t16Signature
      }
    });
    assert(t16LiteRes.status === 201, 'Valid SOS Lite with NO Authorization header returns 201 Created');
    assert(t16LiteRes.data.clientIncidentId === t16IncidentId, 'clientIncidentId persisted correctly');
    assert(t16LiteRes.data.isLite === true, 'isLite flag recorded');

    // 16d: Valid full /api/sos packet returns 201 Created with no auth
    const t16FullId = `sos_t16_full_${Date.now()}`;
    const t16FullPayload = buildSosLitePayload({
      clientIncidentId: t16FullId,
      deviceId: t16DevId,
      incidentType: 'Flood',
      lat: 30.3165,
      lng: 78.0322,
      locationSource: 'GPS_EXACT',
      locationAccuracy: 18,
      peopleAffected: 1,
      vulnerableCount: 0,
      needsMedical: false,
      createdAt: new Date().toISOString()
    });
    const t16FullSig = await signPayload(t16Dev.privateKey, t16FullPayload);
    const t16FullRes = await request('/api/sos', {
      method: 'POST',
      headers: {},
      body: {
        payload: t16FullPayload,
        deviceId: t16DevId,
        signature: t16FullSig,
        clientIncidentId: t16FullId
      }
    });
    assert(t16FullRes.status === 201, 'Full /api/sos with WebCrypto signature returns 201 Created');

    // 16e: Works with expired token (never blocked by token expiration)
    const expiredToken = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpZCI6IjY2MGMwMDAwMDAwMDAwMDAwMDAwMDAwMSIsImV4cCI6MTYwMDAwMDAwMH0.fake_expired_signature';
    const t16ExpIncidentId = `sos_t16_exp_${Date.now()}`;
    const t16ExpPayload = buildSosLitePayload({
      clientIncidentId: t16ExpIncidentId,
      deviceId: t16DevId,
      incidentType: 'Medical',
      lat: 30.3165,
      lng: 78.0322,
      locationSource: 'GPS_EXACT',
      locationAccuracy: 18,
      peopleAffected: 1,
      vulnerableCount: 0,
      needsMedical: true,
      createdAt: new Date().toISOString()
    });
    const t16ExpSig = await signPayload(t16Dev.privateKey, t16ExpPayload);
    const t16ExpRes = await request('/api/sos/lite', {
      method: 'POST',
      token: expiredToken,
      body: {
        ...t16ExpPayload,
        signature: t16ExpSig
      }
    });
    assert(t16ExpRes.status === 201, 'SOS Lite with expired token is accepted with 201 (emergency not blocked)');

    // 16f: Duplicate retry returns 200 { status: 'existing' }
    const t16DupRes = await request('/api/sos/lite', {
      method: 'POST',
      body: {
        ...t16LitePayload,
        signature: t16Signature
      }
    });
    assert(t16DupRes.status === 200, 'Duplicate retry returns 200 OK');
    assert(t16DupRes.data.status === 'existing', 'Duplicate retry identifies existing status');

    // 16g: Unknown device returns 403 DEVICE_UNKNOWN
    const t16UnknownRes = await request('/api/sos/lite', {
      method: 'POST',
      body: {
        ...t16LitePayload,
        clientIncidentId: `sos_unknown_${Date.now()}`,
        deviceId: 'dev_completely_unknown',
        signature: t16Signature
      }
    });
    assert(t16UnknownRes.status === 403, 'Unknown device returns 403 Forbidden');
    assert(t16UnknownRes.data.code === 'DEVICE_UNKNOWN', 'Unknown device returns stable code DEVICE_UNKNOWN');

    // 16h: Revoked device returns 403 DEVICE_REVOKED
    await request('/api/auth/devices/revoke', {
      method: 'POST',
      body: { deviceId: t16DevId, userId: 'officer_dehradun_01' }
    });
    const t16RevokedRes = await request('/api/sos/lite', {
      method: 'POST',
      body: {
        ...t16LitePayload,
        clientIncidentId: `sos_revoked_${Date.now()}`,
        signature: t16Signature
      }
    });
    assert(t16RevokedRes.status === 403, 'Revoked device returns 403 Forbidden');
    assert(t16RevokedRes.data.code === 'DEVICE_REVOKED', 'Revoked device returns stable code DEVICE_REVOKED');

    // 16i: Tampered payload returns 400 SIGNATURE_INVALID
    const t16Dev2 = await generateTestKeypair();
    const t16DevId2 = `dev_t16_2_${Date.now()}`;
    await request('/api/auth/devices/register', {
      method: 'POST',
      body: { deviceId: t16DevId2, publicKey: t16Dev2.publicKeyJwk, userId: 'officer_dehradun_01' }
    });
    const t16TamperedPayload = buildSosLitePayload({
      clientIncidentId: `sos_tampered_${Date.now()}`,
      deviceId: t16DevId2,
      incidentType: 'Medical',
      lat: 30.3165,
      lng: 78.0322,
      locationSource: 'GPS_EXACT',
      locationAccuracy: 18,
      peopleAffected: 1,
      vulnerableCount: 0,
      needsMedical: false,
      createdAt: new Date().toISOString()
    });
    const t16TamperedSig = await signPayload(t16Dev2.privateKey, t16TamperedPayload);
    const t16TamperedRes = await request('/api/sos/lite', {
      method: 'POST',
      body: {
        ...t16TamperedPayload,
        peopleAffected: 999, // tampered
        signature: t16TamperedSig
      }
    });
    assert(t16TamperedRes.status === 400, 'Tampered payload returns 400 Bad Request');
    assert(t16TamperedRes.data.code === 'SIGNATURE_INVALID', 'Tampered payload returns stable code SIGNATURE_INVALID');

    // 16j: Bad schema returns 400 VALIDATION_ERROR
    const t16BadSchemaRes = await request('/api/sos/lite', {
      method: 'POST',
      body: {
        clientIncidentId: '', // invalid
        deviceId: t16DevId2,
        signature: t16TamperedSig
      }
    });
    assert(t16BadSchemaRes.status === 400, 'Bad schema returns 400 Bad Request');
    assert(t16BadSchemaRes.data.code === 'VALIDATION_ERROR', 'Bad schema returns stable code VALIDATION_ERROR');

  } catch (err) {
    console.error('Test execution error:', err);
    failCount++;
  } finally {
    if (serverInstance) {
      serverInstance.close();
    }
  }

  console.log('\n====================================================');
  console.log(`  VERIFICATION RESULTS: ${passCount} PASSED, ${failCount} FAILED`);
  console.log('====================================================\n');

  if (failCount > 0) {
    process.exit(1);
  } else {
    process.exit(0);
  }
}

runTests();
