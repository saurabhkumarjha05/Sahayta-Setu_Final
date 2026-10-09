const mongoose = require('mongoose');

const districtRainfallSchema = new mongoose.Schema({
  district: { type: String, required: true },
  year: { type: Number, required: true },
  lat: Number,
  lng: Number,

  annualNormal: Number,
  annualActual: Number,
  annualDeparture: Number,

  preMonsoonNormal: Number,
  preMonsoonActual: Number,
  preMonsoonDeparture: Number,

  swmNormal: Number,
  swmActual: Number,
  swmDeparture: Number,

  nemNormal: Number,
  nemActual: Number,
  nemDeparture: Number
});

module.exports = mongoose.model('DistrictRainfall', districtRainfallSchema);
