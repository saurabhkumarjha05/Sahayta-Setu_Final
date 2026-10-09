// IMD categories for rainfall in 24 hours (mm)
function rainCategory(mm) {
  if (mm >= 204.5) return { name: 'Extremely heavy', score: 3 };
  if (mm >= 115.6) return { name: 'Very heavy', score: 2 };
  if (mm >= 64.5)  return { name: 'Heavy', score: 1 };
  if (mm >= 15.6)  return { name: 'Moderate', score: 0 };
  if (mm >= 2.5)   return { name: 'Light', score: 0 };
  if (mm > 0)      return { name: 'Very light', score: 0 };
  return { name: 'No rain', score: 0 };
}

const LEVELS = [
  { level: 'Low',      color: 'green',  action: 'No action needed' },
  { level: 'Moderate', color: 'yellow', action: 'Be aware and stay updated' },
  { level: 'High',     color: 'orange', action: 'Be prepared' },
  { level: 'Severe',   color: 'red',    action: 'Take action' }
];

function calculateRisk(rain, district) {
  const reasons = [];

  // Step 1 and 2: rainfall score
  const worst = Math.max(rain.past24h, rain.next24h);
  const category = rainCategory(worst);
  let score = category.score;
  reasons.push(`${category.name} rainfall: ${worst} mm in 24 hours`);

  // Step 3: soaked-ground adjustment from KSNDMC data
  if (district && district.swmDeparture >= 20 && category.score >= 1) {
    score += 1;
    reasons.push(`Monsoon rainfall was ${district.swmDeparture}% above normal, so the ground is likely saturated`);
  }

  // Step 4: score to colour (anything above 3 is still red)
  const result = LEVELS[Math.min(score, 3)];
  return { score, ...result, reasons };
}

module.exports = { calculateRisk };