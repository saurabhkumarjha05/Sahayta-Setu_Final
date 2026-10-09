const axios = require('axios');

function round1(n) {
  return Math.round(n * 10) / 10;
}

// Rain falling right now (from Part 1)
async function getRainfall(lat, lng) {
  const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lng}&current=precipitation`;
  const response = await axios.get(url, { timeout: 10000 });
  return response.data.current.precipitation;
}

// Adds up hourly rain into "past 24 hours" and "next 24 hours"
function sumPastAndNext24h(hourly) {
  const now = Date.now() / 1000;
  const DAY = 24 * 60 * 60;
  let past24h = 0;
  let next24h = 0;

  for (let i = 0; i < hourly.time.length; i++) {
    const t = hourly.time[i];
    const mm = hourly.precipitation[i] || 0;
    if (t >= now - DAY && t < now) {
      past24h += mm;
    } else if (t >= now && t < now + DAY) {
      next24h += mm;
    }
  }
  return { past24h: round1(past24h), next24h: round1(next24h) };
}

// Rainfall for MANY locations in ONE request. points = [{ lat, lng }, ...]
async function getRainfall24hMany(points) {
  const lats = points.map((p) => p.lat).join(',');
  const lngs = points.map((p) => p.lng).join(',');
  const url = `https://api.open-meteo.com/v1/forecast?latitude=${lats}&longitude=${lngs}&hourly=precipitation&past_days=1&forecast_days=2&timeformat=unixtime`;
  const response = await axios.get(url, { timeout: 15000 });

  // One location gives back an object, many locations give back a list
  const list = Array.isArray(response.data) ? response.data : [response.data];
  return list.map((item) => sumPastAndNext24h(item.hourly));
}

// Rainfall for one location (used by /api/risk/:district)
async function getRainfall24h(lat, lng) {
  const results = await getRainfall24hMany([{ lat, lng }]);
  return results[0];
}

module.exports = { getRainfall, getRainfall24h, getRainfall24hMany };