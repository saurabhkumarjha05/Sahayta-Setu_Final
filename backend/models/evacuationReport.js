const mongoose = require('mongoose');

// One report per villager (family), updated whenever they change it.
// "Where did everyone in my family go after the alert?"
const evacuationReportSchema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, unique: true },
  reporterName: String,
  reporterPhone: String,
  village: String,
  district: String,
  state: String,

  totalMembers: { type: Number, required: true, min: 1 },
  inShelter: { type: Number, default: 0, min: 0 },      // went to a shelter
  withRelatives: { type: Number, default: 0, min: 0 },  // relative's house / another village
  atHome: { type: Number, default: 0, min: 0 },         // staying at home (not willing to move)
  elsewhere: { type: Number, default: 0, min: 0 },      // went somewhere, place not known

  shelter: { type: mongoose.Schema.Types.ObjectId, ref: 'Shelter', default: null },
  shelterName: { type: String, default: null },
  needsReview: { type: Boolean, default: false },
  reviewReason: { type: String, default: null }
}, { timestamps: true });

module.exports = mongoose.model('EvacuationReport', evacuationReportSchema);
