const axios = require('axios');

const SEARCH_API_URL = 'https://api.search.tinyfish.ai';
const OFFICIAL_HOST_SUFFIXES = ['.gov.in', '.nic.in'];

function isOfficialSource(url) {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'https:'
      && OFFICIAL_HOST_SUFFIXES.some((suffix) => parsed.hostname.endsWith(suffix));
  } catch {
    return false;
  }
}

async function collectDisasterAlerts({
  state = 'Uttar Pradesh',
  district = 'Gautam Buddha Nagar',
  keywords = ['disaster alert', 'weather warning', 'flood', 'heavy rainfall']
} = {}) {
  const apiKey = process.env.TINYFISH_API_KEY;
  if (!apiKey) {
    const error = new Error('TinyFish is not configured. Set TINYFISH_API_KEY on the backend.');
    error.code = 'TINYFISH_NOT_CONFIGURED';
    throw error;
  }

  const searchTerms = Array.isArray(keywords) ? keywords.slice(0, 8).join(' ') : String(keywords);
  const query = `${district}, ${state} ${searchTerms} site:gov.in OR site:nic.in`;
  const response = await axios.get(SEARCH_API_URL, {
    headers: { 'X-API-Key': apiKey },
    params: {
      query,
      recency_minutes: 1440,
      purpose: 'Find source-backed current disaster alerts from Indian government agencies'
    },
    timeout: 15000
  });

  const results = Array.isArray(response.data?.results) ? response.data.results : [];
  return results
    .filter((result) => result && isOfficialSource(result.url))
    .slice(0, 20)
    .map((result) => ({
      source: result.site_name || new URL(result.url).hostname,
      title: result.title || 'Untitled source result',
      description: result.snippet || '',
      url: result.url,
      publishedAt: result.published_at || result.published_date || null,
      observedAt: new Date().toISOString(),
      affectedAreaQuery: `${district}, ${state}`,
      classification: 'UNVERIFIED_SOURCE_CANDIDATE'
    }));
}

module.exports = { collectDisasterAlerts, isOfficialSource };
