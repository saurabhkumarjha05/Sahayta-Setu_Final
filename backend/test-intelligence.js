const assert = require('node:assert/strict');
const axios = require('axios');
const {
  analyzeIncidentReport,
  detectDuplicateIncidents,
  generateAutomatedReport
} = require('./services/aiIntelligenceService');
const { collectDisasterAlerts, isOfficialSource } = require('./services/tinyFishService');

async function run() {
  const critical = analyzeIncidentReport({
    type: 'Flash Flood',
    peopleAffected: 10,
    vulnerableCount: 1,
    needsMedical: true
  });
  assert.equal(critical.explainablePriority.level, 'CRITICAL');
  assert.equal(critical.evacuationOrderAuthorized, false);
  assert.equal(critical.humanVerificationRequired, true);
  assert.ok(critical.urgentNeeds.length > 0);
  assert.match(critical.explainablePriority.explanation, /life-threatening/);

  assert.equal(analyzeIncidentReport({ type: 'Medical', priority: 'HIGH' }).explainablePriority.level, 'HIGH');
  assert.equal(analyzeIncidentReport({ type: 'Flood' }).explainablePriority.level, 'MEDIUM');
  assert.equal(analyzeIncidentReport({ type: 'Other' }).explainablePriority.level, 'LOW');

  const incident = {
    _id: 'incident-1',
    clientIncidentId: 'incident-1',
    type: 'Flood',
    district: 'Gautam Buddha Nagar',
    state: 'Uttar Pradesh',
    village: 'Sector 1',
    location: { lat: 28.5355, lng: 77.391 },
    timestamp: '2026-10-10T10:00:00.000Z'
  };
  const duplicate = {
    ...incident,
    _id: 'incident-2',
    clientIncidentId: 'incident-2',
    location: { lat: 28.536, lng: 77.391 },
    timestamp: '2026-10-10T10:10:00.000Z'
  };
  assert.equal(detectDuplicateIncidents(incident, [duplicate]).isPossibleDuplicate, true);
  assert.equal(detectDuplicateIncidents(incident, [{ ...duplicate, district: 'Lucknow' }]).isPossibleDuplicate, false);
  assert.equal(detectDuplicateIncidents(incident, [{ ...duplicate, timestamp: 'not-a-date' }]).isPossibleDuplicate, false);

  const report = generateAutomatedReport({
    incident: { ...incident, location: undefined },
    tinyFishAlerts: [{ source: 'NDMA', url: 'https://ndma.gov.in/alerts', publishedAt: null }]
  });
  assert.equal(report.affectedArea.coordinates, null);
  assert.equal(report.affectedArea.district, 'Gautam Buddha Nagar');
  assert.equal(report.sourceReferences.at(-1).url, 'https://ndma.gov.in/alerts');
  assert.match(report.governanceNotice, /human approval/i);
  assert.equal(isOfficialSource('https://ndma.gov.in/alerts'), true);
  assert.equal(isOfficialSource('http://ndma.gov.in/alerts'), false);
  assert.equal(isOfficialSource('https://ndma.gov.in.example.org/alerts'), false);

  const previousKey = process.env.TINYFISH_API_KEY;
  const originalGet = axios.get;
  try {
    delete process.env.TINYFISH_API_KEY;
    await assert.rejects(
      collectDisasterAlerts(),
      (error) => error.code === 'TINYFISH_NOT_CONFIGURED'
    );

    let requestConfig;
    process.env.TINYFISH_API_KEY = 'test-key';
    axios.get = async (url, config) => {
      requestConfig = { url, ...config };
      return {
        data: {
          results: [
            { title: 'Official warning', url: 'https://ndma.gov.in/warning', site_name: 'NDMA', snippet: 'Source text' },
            { title: 'Unverified', url: 'https://example.org/warning', site_name: 'Example' }
          ]
        }
      };
    };
    const alerts = await collectDisasterAlerts({ state: 'Uttar Pradesh', district: 'Gautam Buddha Nagar' });
    assert.equal(requestConfig.url, 'https://api.search.tinyfish.ai');
    assert.equal(requestConfig.headers['X-API-Key'], 'test-key');
    assert.equal(alerts.length, 1);
    assert.equal(alerts[0].classification, 'UNVERIFIED_SOURCE_CANDIDATE');
    assert.equal(alerts[0].url, 'https://ndma.gov.in/warning');
  } finally {
    axios.get = originalGet;
    if (previousKey === undefined) delete process.env.TINYFISH_API_KEY;
    else process.env.TINYFISH_API_KEY = previousKey;
  }

  console.log('Intelligence tests passed: priority analysis, human verification, duplicate detection, reports, TinyFish auth and source allowlist.');
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
