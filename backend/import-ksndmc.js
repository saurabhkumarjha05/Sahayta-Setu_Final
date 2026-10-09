require('dotenv').config();
const fs = require('fs');
const csv = require('csv-parser');
const mongoose = require('mongoose');
const DistrictRainfall = require('./models/districtRainfall');

const CSV_FILE = 'ksndmc-data.csv';
const YEAR = 2025;

// Turns text like "725" into the number 725. Empty cells become null.
function toNumber(value) {
  if (value === undefined || value === null) return null;
  const n = parseFloat(String(value).trim());
  return Number.isNaN(n) ? null : n;
}

// Reads the whole CSV file and gives back a list of rows.
function readCsv(file) {
  return new Promise((resolve, reject) => {
    const rows = [];
    fs.createReadStream(file)
      .pipe(csv({ mapHeaders: ({ header }) => header.replace(/^\uFEFF/, '').trim() }))
      .on('data', (row) => rows.push(row))
      .on('end', () => resolve(rows))
      .on('error', reject);
  });
}

async function main() {
  const rows = await readCsv(CSV_FILE);

  const records = [];
  for (const row of rows) {
    const district = (row['District'] || '').trim();
    // Skip blank lines and total rows that don't have a serial number
    if (!district || toNumber(row['Sl No']) === null) continue;

    records.push({
      district,
      year: YEAR,
      annualNormal: toNumber(row['Annual Normal']),
      annualActual: toNumber(row['Annual Actual']),
      annualDeparture: toNumber(row['Annual Departure (%)']),
      preMonsoonNormal: toNumber(row['Pre Monsoon Normal']),
      preMonsoonActual: toNumber(row['Pre Monsoon Actual']),
      preMonsoonDeparture: toNumber(row['Pre Monsoon Dep (%)']),
      swmNormal: toNumber(row['SWM Normal']),
      swmActual: toNumber(row['SWM Actual']),
      swmDeparture: toNumber(row['SWM Departure']),
      nemNormal: toNumber(row['NEM Normal']),
      nemActual: toNumber(row['NEM Actual']),
      nemDeparture: toNumber(row['NEM Departure'])
    });
  }

  console.log(`Read ${rows.length} rows from the CSV, ${records.length} are districts`);

  await mongoose.connect(process.env.MONGO_URI);

  // Remove old 2025 data first, so running this script twice doesn't create duplicates
  await DistrictRainfall.deleteMany({ year: YEAR });
  await DistrictRainfall.insertMany(records);

  console.log(`Imported ${records.length} districts for ${YEAR}`);
  await mongoose.disconnect();
}

main().catch((err) => {
  console.error('Import failed:', err.message);
  process.exit(1);
});