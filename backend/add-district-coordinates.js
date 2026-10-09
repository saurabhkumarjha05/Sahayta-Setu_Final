require('dotenv').config();
const mongoose = require('mongoose');
const DistrictRainfall = require('./models/districtRainfall');
const DISTRICT_COORDINATES = require('./data/districtCoordinates');

// "Chikkaballapura" and "chikka ballapura" both become "chikkaballapura"
function normalize(name) {
  return name.toLowerCase().replace(/[^a-z]/g, '');
}

async function main() {
  // Make a lookup table: every name and alias -> its location
  const lookup = {};
  for (const d of DISTRICT_COORDINATES) {
    for (const n of [d.name, ...(d.aliases || [])]) {
      lookup[normalize(n)] = d;
    }
  }

  await mongoose.connect(process.env.MONGO_URI);

  const districts = await DistrictRainfall.find();
  const notFound = [];
  let updated = 0;

  for (const district of districts) {
    const match = lookup[normalize(district.district)];
    if (!match) {
      notFound.push(district.district);
      continue;
    }
    district.lat = match.lat;
    district.lng = match.lng;
    await district.save();
    updated++;
  }

  console.log(`Added locations to ${updated} of ${districts.length} districts`);
  if (notFound.length > 0) {
    console.log('No location found for:', notFound.join(', '));
  }

  await mongoose.disconnect();
}

main().catch((err) => {
  console.error('Failed:', err.message);
  process.exit(1);
});