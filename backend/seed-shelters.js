// Adds the demo shelters to MongoDB (the same ones the maps show).
// Safe to run more than once: shelters are matched by name and updated, not duplicated.
//
// Run from the backend folder:  node seed-shelters.js

require('dotenv').config();
const mongoose = require('mongoose');
const Shelter = require('./models/shelter');

const SHELTERS = [
  { name: 'Belthangady Community Hall', lat: 12.9850, lng: 75.2600, capacity: 350, currentOccupancy: 210 },
  { name: 'Mudigere Relief Camp', lat: 13.1360, lng: 75.6410, capacity: 500, currentOccupancy: 290 },
  { name: 'Thirthahalli Indoor Stadium Shelter', lat: 13.6934, lng: 75.2447, capacity: 300, currentOccupancy: 265 },
  { name: 'Karkala High School Safe Shelter', lat: 13.2200, lng: 75.0100, capacity: 250, currentOccupancy: 250 },
];

async function seed() {
  await mongoose.connect(process.env.MONGO_URI);

  for (const shelter of SHELTERS) {
    const status = shelter.currentOccupancy >= shelter.capacity ? 'Full' : 'Available';
    await Shelter.findOneAndUpdate(
      { name: shelter.name },
      { ...shelter, status },
      { upsert: true, new: true }
    );
    console.log(`✓ ${shelter.name} (${shelter.currentOccupancy}/${shelter.capacity}, ${status})`);
  }

  console.log(`Done: ${SHELTERS.length} shelters in the database.`);
  await mongoose.disconnect();
}

seed().catch((err) => {
  console.error('Seeding failed:', err.message);
  process.exit(1);
});
