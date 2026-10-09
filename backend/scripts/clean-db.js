#!/usr/bin/env node
const dns = require('dns');
dns.setServers(['8.8.8.8', '1.1.1.1']);
require('dotenv').config();
const readline = require('readline');
const mongoose = require('mongoose');

const User = require('../models/user');
const VerifiedEntity = require('../models/verifiedEntity');
const NGO = require('../models/ngo');
const Shelter = require('../models/shelter');
const Alert = require('../models/alert');
const SOS = require('../models/sos');
const AuditLog = require('../models/auditLog');
const Otp = require('../models/otp');
const EvacuationReport = require('../models/evacuationReport');

const args = process.argv.slice(2);
const isConfirm = args.includes('--confirm');
const isAllOperational = args.includes('--all-operational');
const isListUsers = args.includes('--list-users');

async function promptUser(question) {
  if (!process.stdin.isTTY) {
    return 'yes';
  }
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

async function run() {
  const uri = process.env.MONGODB_URI;
  if (!uri) {
    console.error('❌ Error: MONGODB_URI is not set in environment.');
    process.exit(1);
  }

  if (process.env.NODE_ENV === 'production') {
    console.error('❌ Refusing to run db:clean in production environment (NODE_ENV=production).');
    process.exit(1);
  }

  console.log('Connecting to database...');
  await mongoose.connect(uri);
  const dbName = mongoose.connection.name;
  console.log(`✓ Connected to MongoDB database: [${dbName}]\n`);

  const superAdminEmail = (process.env.SUPER_ADMIN_EMAIL || '').toLowerCase().trim();

  // If --list-users requested
  if (isListUsers) {
    console.log('========================================================================');
    console.log(`  CURRENT USERS IN DATABASE [${dbName}]`);
    console.log('========================================================================');
    const users = await User.find({}).sort({ createdAt: -1 });
    if (users.length === 0) {
      console.log('  (No users found)');
    } else {
      console.table(
        users.map((u) => ({
          ID: String(u._id),
          Name: u.name,
          Email: u.email || '—',
          Phone: u.phone || '—',
          Role: u.role,
          Status: u.accountStatus,
          Verification: u.verificationStatus,
          isDemo: Boolean(u.isDemo)
        }))
      );
    }
    console.log(`Total users: ${users.length}\n`);
    if (!isConfirm) {
      await mongoose.disconnect();
      process.exit(0);
    }
  }

  // Demo user filter: isDemo: true, phone matches 9000000001, or email ends with @sahayta.test
  // NEVER matching superAdminEmail
  const demoUserQuery = {
    $and: [
      {
        $or: [
          { isDemo: true },
          { phone: { $in: ['9000000001', '+919000000001', '+919000000000'] } },
          { email: { $regex: /@sahayta\.test$/i } }
        ]
      },
      ...(superAdminEmail ? [{ email: { $ne: superAdminEmail } }] : [])
    ]
  };

  const demoUsers = await User.find(demoUserQuery);
  const demoUserIds = demoUsers.map((u) => u._id);
  const demoOrgIds = demoUsers.map((u) => u.organizationId).filter(Boolean);
  const demoNgoIds = demoUsers.map((u) => u.ngo).filter(Boolean);

  const demoEntitiesCount = await VerifiedEntity.countDocuments({
    $or: [{ _id: { $in: demoOrgIds } }, { email: { $regex: /@sahayta\.test$/i } }]
  });

  const demoNgosCount = await NGO.countDocuments({
    $or: [{ _id: { $in: demoNgoIds } }, { verifiedEntityId: { $in: demoOrgIds } }]
  });

  const totalSos = await SOS.countDocuments({});
  const totalAlerts = await Alert.countDocuments({});
  const totalShelters = await Shelter.countDocuments({});
  const totalAudits = await AuditLog.countDocuments({});
  const totalOtps = await Otp.countDocuments({});
  const totalEvac = await EvacuationReport.countDocuments({});

  console.log('========================================================================');
  console.log(`  DATABASE CLEANUP AUDIT FOR [${dbName}]`);
  console.log('========================================================================');
  console.log(`  Mode: ${isConfirm ? 'EXECUTE DELETION' : 'DRY RUN (No data will be deleted)'}`);
  if (superAdminEmail) {
    console.log(`  Protected Super Admin: ${superAdminEmail} (WILL NEVER BE DELETED)`);
  }
  console.log('------------------------------------------------------------------------');
  console.log(`  Demo Users to delete:         ${demoUsers.length}`);
  console.log(`  Demo VerifiedEntities:        ${demoEntitiesCount}`);
  console.log(`  Demo NGOs:                    ${demoNgosCount}`);
  if (isAllOperational) {
    console.log(`  [--all-operational enabled]`);
    console.log(`  SOS Incidents to delete:      ${totalSos}`);
    console.log(`  Alerts to delete:             ${totalAlerts}`);
    console.log(`  Shelters/Resources to delete: ${totalShelters}`);
    console.log(`  Audit Logs to delete:         ${totalAudits}`);
    console.log(`  OTPs to delete:               ${totalOtps}`);
    console.log(`  Evacuation Reports to delete: ${totalEvac}`);
  }
  console.log('========================================================================\n');

  if (!isConfirm) {
    console.log('ℹ️  DRY RUN COMPLETED: 0 records deleted.');
    console.log('   To execute actual deletion, run:');
    console.log(`   CONFIRM_CLEAN=${dbName} npm run db:clean -- --confirm ${isAllOperational ? '--all-operational' : ''}\n`);
    await mongoose.disconnect();
    process.exit(0);
  }

  // Safety checks for actual deletion
  const requiredEnv = process.env.CONFIRM_CLEAN;
  if (!requiredEnv || requiredEnv.trim() !== dbName) {
    console.error(`❌ Refusing to delete: CONFIRM_CLEAN="${requiredEnv}" does not match connected database name "${dbName}".`);
    console.error(`   Please set CONFIRM_CLEAN=${dbName} in your environment.`);
    await mongoose.disconnect();
    process.exit(1);
  }

  if (process.stdin.isTTY) {
    const confirmation = await promptUser(`⚠️ Type the database name "${dbName}" to permanently delete demo records: `);
    if (confirmation !== dbName) {
      console.log('❌ Confirmation failed. Operation cancelled.');
      await mongoose.disconnect();
      process.exit(1);
    }
  }

  console.log('\nExecuting cleanup...');

  // Delete demo users
  const deletedUsersRes = await User.deleteMany(demoUserQuery);
  // Delete associated entities and NGOs
  const deletedEntitiesRes = await VerifiedEntity.deleteMany({
    $or: [{ _id: { $in: demoOrgIds } }, { email: { $regex: /@sahayta\.test$/i } }]
  });
  const deletedNgosRes = await NGO.deleteMany({
    $or: [{ _id: { $in: demoNgoIds } }, { verifiedEntityId: { $in: demoOrgIds } }]
  });

  let deletedSosCount = 0;
  let deletedAlertsCount = 0;
  let deletedSheltersCount = 0;
  let deletedAuditsCount = 0;
  let deletedOtpsCount = 0;
  let deletedEvacCount = 0;

  if (isAllOperational) {
    const resSos = await SOS.deleteMany({});
    deletedSosCount = resSos.deletedCount;

    const resAlerts = await Alert.deleteMany({});
    deletedAlertsCount = resAlerts.deletedCount;

    const resShelters = await Shelter.deleteMany({});
    deletedSheltersCount = resShelters.deletedCount;

    const resAudits = await AuditLog.deleteMany({});
    deletedAuditsCount = resAudits.deletedCount;

    const resOtps = await Otp.deleteMany({});
    deletedOtpsCount = resOtps.deletedCount;

    const resEvac = await EvacuationReport.deleteMany({});
    deletedEvacCount = resEvac.deletedCount;
  }

  console.log('========================================================================');
  console.log('  CLEANUP EXECUTION SUMMARY');
  console.log('========================================================================');
  console.log(`  ✓ Users deleted:             ${deletedUsersRes.deletedCount}`);
  console.log(`  ✓ VerifiedEntities deleted:  ${deletedEntitiesRes.deletedCount}`);
  console.log(`  ✓ NGOs deleted:              ${deletedNgosRes.deletedCount}`);
  if (isAllOperational) {
    console.log(`  ✓ SOS records deleted:       ${deletedSosCount}`);
    console.log(`  ✓ Alerts deleted:            ${deletedAlertsCount}`);
    console.log(`  ✓ Shelters deleted:          ${deletedSheltersCount}`);
    console.log(`  ✓ Audit logs deleted:        ${deletedAuditsCount}`);
    console.log(`  ✓ OTPs deleted:              ${deletedOtpsCount}`);
    console.log(`  ✓ Evacuation reports deleted:${deletedEvacCount}`);
  }
  console.log('========================================================================\n');

  const remainingUsers = await User.find({}).sort({ createdAt: -1 });
  console.log(`Remaining users in database (${remainingUsers.length}):`);
  console.table(
    remainingUsers.map((u) => ({
      ID: String(u._id),
      Name: u.name,
      Email: u.email || '—',
      Phone: u.phone || '—',
      Role: u.role,
      Status: u.accountStatus,
      Verification: u.verificationStatus
    }))
  );

  await mongoose.disconnect();
  console.log('✓ Disconnected cleanly.');
  process.exit(0);
}

run().catch((err) => {
  console.error('Fatal cleanup error:', err);
  process.exit(1);
});
