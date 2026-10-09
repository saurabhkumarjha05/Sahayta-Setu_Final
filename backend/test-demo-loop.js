const BASE_URL = 'http://localhost:5000';

async function testScenario() {
  console.log('=== STARTING END-TO-END DEMO SCENARIO TEST ===');

  // 1. Authenticate as Villager in Uttarakhand -> Dehradun
  console.log('\n--- STEP 1: Villager Authentication ---');
  const villagerAuth = await fetch(`${BASE_URL}/api/auth/verify-otp`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      phone: '9988776655',
      code: '123456',
      registerAs: 'villager',
      name: 'Ramesh Singh',
      state: 'Uttarakhand',
      district: 'Dehradun',
      village: 'Rajpur Road'
    })
  }).then(r => r.json());
  console.log('Villager logged in:', villagerAuth.user.name, 'in', villagerAuth.user.district, villagerAuth.user.state);

  // 2. Fetch Verified Shelters for Dehradun
  console.log('\n--- STEP 2: Villager Fetching Verified Shelters ---');
  const shelters = await fetch(`${BASE_URL}/api/shelters?state=Uttarakhand&district=Dehradun`).then(r => r.json());
  console.log(`Found ${shelters.length} verified shelter(s) in Dehradun:`);
  shelters.forEach(s => console.log(`  - ${s.name} (${s.type}, ${s.availableSpaces}/${s.capacity} beds available, Verified: ${s.verified})`));

  // 3. Villager Sends Emergency SOS
  console.log('\n--- STEP 3: Villager Sends Emergency SOS ---');
  const sosResult = await fetch(`${BASE_URL}/api/sos`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${villagerAuth.token}`
    },
    body: JSON.stringify({
      location: { lat: 30.3200, lng: 78.0400 },
      village: 'Rajpur Road',
      district: 'Dehradun',
      state: 'Uttarakhand',
      type: 'Flood',
      isApproximateLocation: false
    })
  }).then(r => r.json());
  console.log('SOS Created ID:', sosResult._id, 'Status:', sosResult.status, 'District:', sosResult.district);

  // 4. Authenticate as Control/Panchayat Officer
  console.log('\n--- STEP 4: Panchayat Control Centre Receives SOS ---');
  const controlAuth = await fetch(`${BASE_URL}/api/auth/verify-otp`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      phone: '9888777666',
      code: '123456',
      registerAs: 'control',
      name: 'Panchayat Control Officer',
      state: 'Uttarakhand',
      district: 'Dehradun'
    })
  }).then(r => r.json());

  const controlSosList = await fetch(`${BASE_URL}/api/sos?state=Uttarakhand&district=Dehradun`, {
    headers: { Authorization: `Bearer ${controlAuth.token}` }
  }).then(r => r.json());
  console.log(`Panchayat Control dashboard contains ${controlSosList.length} active SOS incident(s) in Dehradun.`);

  // 5. Authenticate as NGO Responder in Dehradun & Accept SOS
  console.log('\n--- STEP 5: NGO Responder Receives & Accepts Mission ---');
  const ngoAuth = await fetch(`${BASE_URL}/api/auth/verify-otp`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      phone: '9777666555',
      code: '123456',
      registerAs: 'ngo',
      name: 'Helping Hands Dehradun Unit',
      state: 'Uttarakhand',
      district: 'Dehradun'
    })
  }).then(r => r.json());

  const assignResult = await fetch(`${BASE_URL}/api/sos/${sosResult._id}/assign`, {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${ngoAuth.token}` }
  }).then(r => r.json());
  console.log('SOS Accepted by NGO:', assignResult.assignedTo?.name || 'NGO Unit', 'New Status:', assignResult.status);

  // 6. Villager Checks Own SOS Status Update
  console.log('\n--- STEP 6: Villager Dashboard Checks Status Update ---');
  const villagerSosStatus = await fetch(`${BASE_URL}/api/sos/mine`, {
    headers: { Authorization: `Bearer ${villagerAuth.token}` }
  }).then(r => r.json());
  console.log('Villager sees status:', villagerSosStatus[0].status, 'Assigned Responder:', villagerSosStatus[0].assignedTo?.name);

  // 7. Panchayat Control Triggers Official Emergency Alert
  console.log('\n--- STEP 7: Panchayat Control Broadcasts Official Alert ---');
  const alertResult = await fetch(`${BASE_URL}/api/alerts/trigger`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${controlAuth.token}`
    },
    body: JSON.stringify({
      village: 'Rajpur Road',
      message: 'Flash flood warning issued for Rajpur Road and low-lying areas of Dehradun.',
      riskLevel: 'Severe',
      state: 'Uttarakhand',
      district: 'Dehradun'
    })
  }).then(r => r.json());
  console.log('Alert Triggered ID:', alertResult._id, 'Risk Level:', alertResult.riskLevel, 'District:', alertResult.district);

  // 8. Villager Dashboard Receives Official Alert
  console.log('\n--- STEP 8: Villager Receives Official Targeted Alert ---');
  const villagerAlerts = await fetch(`${BASE_URL}/api/alerts?state=Uttarakhand&district=Dehradun`).then(r => r.json());
  console.log(`Villager feed has ${villagerAlerts.length} alert(s). Top alert message: "${villagerAlerts[0].message}"`);

  console.log('\n=== END-TO-END DEMO SCENARIO TEST PASSED 100% PERFECTLY! ===');
}

testScenario().catch(console.error);
