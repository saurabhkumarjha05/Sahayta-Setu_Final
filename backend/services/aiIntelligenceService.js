const DUPLICATE_WINDOW_MS = 30 * 60 * 1000;
const DUPLICATE_RADIUS_KM = 1;

function normalizeText(value) {
  return String(value || '').trim().toLowerCase();
}

function haversineDistanceKm(first, second) {
  const toRadians = (degrees) => (degrees * Math.PI) / 180;
  const latDelta = toRadians(second.lat - first.lat);
  const lngDelta = toRadians(second.lng - first.lng);
  const a = Math.sin(latDelta / 2) ** 2
    + Math.cos(toRadians(first.lat)) * Math.cos(toRadians(second.lat))
    * Math.sin(lngDelta / 2) ** 2;
  return 6371 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function analyzeIncidentReport(incident = {}) {
  const emergencyType = incident.emergencyType || incident.type || 'Unknown emergency';
  const normalizedType = normalizeText(emergencyType);
  const peopleAffected = Math.max(1, Number(incident.peopleAffected) || 1);
  const vulnerableCount = Math.max(0, Number(incident.vulnerableCount) || 0);
  const needsMedical = Boolean(incident.needsMedical) || normalizedType.includes('medical');
  const urgentNeeds = [];
  const rationale = [];
  let score = 0;

  if (needsMedical) {
    score += 35;
    urgentNeeds.push('Immediate medical care and first aid');
    rationale.push('Medical need indicated (+35)');
  }
  if (['flash flood', 'collapse', 'landslide', 'fire', 'earthquake'].some((term) => normalizedType.includes(term))) {
    score += 30;
    urgentNeeds.push('Search and rescue assessment');
    rationale.push('Potentially life-threatening hazard type (+30)');
  } else if (normalizedType.includes('flood')) {
    score += 20;
    urgentNeeds.push('Flood response and safe-route assessment');
    rationale.push('Flood hazard reported (+20)');
  }
  if (vulnerableCount > 0) {
    const vulnerableScore = Math.min(20, vulnerableCount * 10);
    score += vulnerableScore;
    urgentNeeds.push(`Priority support for ${vulnerableCount} vulnerable person(s)`);
    rationale.push(`Vulnerable people reported (+${vulnerableScore})`);
  }
  if (peopleAffected >= 10) {
    score += 15;
    rationale.push('Ten or more people reported affected (+15)');
  } else if (peopleAffected >= 5) {
    score += 10;
    rationale.push('Five or more people reported affected (+10)');
  }
  if (peopleAffected >= 5) urgentNeeds.push(`Relief and shelter assessment for ${peopleAffected} people`);
  if (urgentNeeds.length === 0) urgentNeeds.push('Verify the reported needs with the incident reporter');

  const reportedPriority = normalizeText(incident.priority);
  let level = 'LOW';
  if (score >= 65 || reportedPriority === 'critical' || reportedPriority === 'severe') level = 'CRITICAL';
  else if (score >= 40 || reportedPriority === 'high') level = 'HIGH';
  else if (score >= 20 || reportedPriority === 'moderate' || reportedPriority === 'medium') level = 'MEDIUM';

  return {
    incidentId: incident._id || incident.id || incident.clientIncidentId || null,
    summary: `${emergencyType} report affecting ${peopleAffected} person(s). ${String(incident.description || 'No additional description provided.').trim()}`,
    explainablePriority: {
      level,
      score,
      explanation: rationale.length ? rationale.join('; ') : 'No listed escalation factors were reported.'
    },
    urgentNeeds,
    humanVerificationRequired: true,
    evacuationOrderAuthorized: false,
    evacuationPolicyNotice: 'AI analysis is advisory. An authorized human must verify critical decisions; AI cannot issue evacuation orders.'
  };
}

function detectDuplicateIncidents(newIncident, existingIncidents = []) {
  if (!newIncident || !Array.isArray(existingIncidents)) {
    return { isPossibleDuplicate: false, duplicateCount: 0, potentialMatches: [] };
  }

  const currentTime = new Date(newIncident.timestamp || newIncident.createdAt || Date.now()).getTime();
  const newLocation = newIncident.location;
  const matches = existingIncidents.filter((existing) => {
    if (newIncident.clientIncidentId && existing.clientIncidentId === newIncident.clientIncidentId) return true;

    const existingTime = new Date(existing.timestamp || existing.createdAt || 0).getTime();
    if (!Number.isFinite(currentTime) || !Number.isFinite(existingTime)
      || Math.abs(currentTime - existingTime) > DUPLICATE_WINDOW_MS) return false;
    if (normalizeText(newIncident.type || newIncident.emergencyType)
      !== normalizeText(existing.type || existing.emergencyType)) return false;
    if (normalizeText(newIncident.district) !== normalizeText(existing.district)
      || normalizeText(newIncident.state) !== normalizeText(existing.state)) return false;

    const existingLocation = existing.location;
    if (Number.isFinite(Number(newLocation?.lat)) && Number.isFinite(Number(newLocation?.lng))
      && Number.isFinite(Number(existingLocation?.lat)) && Number.isFinite(Number(existingLocation?.lng))) {
      return haversineDistanceKm(
        { lat: Number(newLocation.lat), lng: Number(newLocation.lng) },
        { lat: Number(existingLocation.lat), lng: Number(existingLocation.lng) }
      ) <= DUPLICATE_RADIUS_KM;
    }

    return normalizeText(newIncident.village) !== ''
      && normalizeText(newIncident.village) === normalizeText(existing.village);
  });

  return {
    isPossibleDuplicate: matches.length > 0,
    duplicateCount: matches.length,
    potentialMatches: matches.map((match) => ({
      id: match._id || match.id || match.clientIncidentId,
      status: match.status,
      reportedAt: match.timestamp || match.createdAt || null
    }))
  };
}

function generateAutomatedReport({ incident, tinyFishAlerts = [], analysis } = {}) {
  if (!incident) throw new TypeError('An incident is required to generate a report.');
  const incidentAnalysis = analysis || analyzeIncidentReport(incident);
  const location = incident.location;

  return {
    reportId: `RPT-${incident._id || incident.clientIncidentId || Date.now()}`,
    generatedAt: new Date().toISOString(),
    title: `Incident Summary: ${incident.type || incident.emergencyType || 'Emergency'}`,
    affectedArea: {
      state: incident.state || null,
      district: incident.district || null,
      village: incident.village || null,
      coordinates: Number.isFinite(Number(location?.lat)) && Number.isFinite(Number(location?.lng))
        ? [Number(location.lat), Number(location.lng)]
        : null
    },
    incidentTimestamp: incident.timestamp || incident.createdAt || null,
    prioritySummary: incidentAnalysis.explainablePriority,
    urgentNeeds: incidentAnalysis.urgentNeeds,
    sourceReferences: [
      {
        sourceName: incident.sourceChannel || 'Incident report',
        timestamp: incident.timestamp || incident.createdAt || null,
        reference: incident._id || incident.clientIncidentId || null
      },
      ...tinyFishAlerts.map((alert) => ({
        sourceName: alert.source,
        timestamp: alert.publishedAt || null,
        observedAt: alert.observedAt || null,
        url: alert.url
      }))
    ],
    governanceNotice: 'AI recommendations are advisory. Evacuation directives require authorized human approval.'
  };
}

module.exports = {
  analyzeIncidentReport,
  detectDuplicateIncidents,
  generateAutomatedReport
};
