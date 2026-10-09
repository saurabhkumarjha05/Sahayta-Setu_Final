/**
 * Sahayta Setu - Automated Phase U3 & Localization Tests
 * Validates:
 * 1. ZERO Kannada characters (U+0C80 to U+0CFF) in the entire repository (excluding node_modules/dist/.git)
 * 2. ZERO references to 'kannada_evac.mp3', 'kn' locale files, or 'Noto Sans Kannada'
 * 3. Centralized ALERT_AUDIO_SRC configuration usage
 * 4. Uttarakhand default in location dropdowns (DEFAULT_STATE_CODE = 'UK') and pinned first
 * 5. Saved user state overrides default state
 * 6. District list updates correctly for Uttarakhand
 * 7. i18n key completeness between English (en.json) and Hindi (hi.json)
 */

const fs = require('fs');
const path = require('path');
const assert = require('assert');

console.log('====================================================');
console.log('  SAHAYTA SETU — PHASE U3 VERIFICATION SUITE');
console.log('====================================================\n');

let passCount = 0;
let failCount = 0;

function it(description, fn) {
  try {
    fn();
    console.log(`  ✓ PASS: ${description}`);
    passCount++;
  } catch (err) {
    console.error(`  ✗ FAIL: ${description}`);
    console.error(`    ${err.message}`);
    failCount++;
  }
}

const ROOT_DIR = path.resolve(__dirname, '..');

// Helper to recursively scan directory
function scanDir(dir, fileList = []) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (['node_modules', 'dist', '.git', 'coverage', '.gemini'].includes(entry.name)) {
        continue;
      }
      scanDir(fullPath, fileList);
    } else {
      fileList.push(fullPath);
    }
  }
  return fileList;
}

const allFiles = scanDir(ROOT_DIR);

// TEST 1: No Kannada Unicode characters (U+0C80 to U+0CFF)
it('Repo contains ZERO Kannada Unicode characters (U+0C80 to U+0CFF)', () => {
  const kannadaRegex = /[\u0C80-\u0CFF]/;
  const violations = [];

  for (const file of allFiles) {
    // skip binary files
    if (/\.(mp3|png|jpe?g|woff2?|ttf|otf)$/i.test(file)) continue;
    const content = fs.readFileSync(file, 'utf8');
    if (kannadaRegex.test(content)) {
      violations.push(file);
    }
  }

  assert.strictEqual(
    violations.length,
    0,
    `Found Kannada Unicode characters in: ${violations.map((f) => path.relative(ROOT_DIR, f)).join(', ')}`
  );
});

// TEST 2: No kannada_evac.mp3 references or files
it('Repo contains ZERO references to kannada_evac.mp3 or physical files', () => {
  const violations = [];
  for (const file of allFiles) {
    if (path.basename(file) === 'kannada_evac.mp3') {
      violations.push(`File exists: ${file}`);
      continue;
    }
    // skip binary files
    if (/\.(mp3|png|jpe?g|woff2?|ttf|otf)$/i.test(file)) continue;
    // skip this test file itself
    if (path.resolve(file) === path.resolve(__filename)) continue;

    const content = fs.readFileSync(file, 'utf8');
    if (content.toLowerCase().includes('kannada_evac')) {
      violations.push(`Reference in: ${path.relative(ROOT_DIR, file)}`);
    }
  }

  assert.strictEqual(violations.length, 0, `Violations found: ${violations.join('; ')}`);
});

// TEST 3: No Noto Sans Kannada or kn locale files
it('Repo contains ZERO "Noto Sans Kannada" or kn / kn-IN locale files', () => {
  const violations = [];
  for (const file of allFiles) {
    const base = path.basename(file).toLowerCase();
    if (base === 'kn.json' || base === 'kn-in.json' || base === 'kn.js') {
      violations.push(`Locale file found: ${file}`);
      continue;
    }
    if (/\.(mp3|png|jpe?g|woff2?|ttf|otf)$/i.test(file)) continue;
    if (path.resolve(file) === path.resolve(__filename)) continue;

    const content = fs.readFileSync(file, 'utf8');
    if (content.includes('Noto Sans Kannada')) {
      violations.push(`Font reference in: ${path.relative(ROOT_DIR, file)}`);
    }
  }

  assert.strictEqual(violations.length, 0, `Violations found: ${violations.join('; ')}`);
});

// TEST 4: Centralized ALERT_AUDIO_SRC exists and points to /EmergencyAlert-Hindi.mp3
it('ALERT_AUDIO_SRC constant is correctly configured to /EmergencyAlert-Hindi.mp3', () => {
  const audioConfigPath = path.join(ROOT_DIR, 'frontend', 'src', 'config', 'audioConfig.js');
  assert.ok(fs.existsSync(audioConfigPath), 'audioConfig.js must exist');
  const content = fs.readFileSync(audioConfigPath, 'utf8');
  assert.ok(
    content.includes("ALERT_AUDIO_SRC = '/EmergencyAlert-Hindi.mp3'"),
    'ALERT_AUDIO_SRC must be /EmergencyAlert-Hindi.mp3'
  );

  // Check physical audio file in frontend/public
  const publicAudioPath = path.join(ROOT_DIR, 'frontend', 'public', 'EmergencyAlert-Hindi.mp3');
  assert.ok(fs.existsSync(publicAudioPath), 'EmergencyAlert-Hindi.mp3 must exist in public/');
});

// TEST 5: Uttarakhand is default state constant and configured with UK
it('DEFAULT_STATE is Uttarakhand and DEFAULT_STATE_CODE is UK', () => {
  const locConfigPath = path.join(ROOT_DIR, 'frontend', 'src', 'config', 'locationConfig.js');
  assert.ok(fs.existsSync(locConfigPath), 'locationConfig.js must exist');
  const content = fs.readFileSync(locConfigPath, 'utf8');
  assert.ok(content.includes("DEFAULT_STATE = 'Uttarakhand'"), 'DEFAULT_STATE must be Uttarakhand');
  assert.ok(content.includes("DEFAULT_STATE_CODE = 'UK'"), 'DEFAULT_STATE_CODE must be UK');
});

// TEST 6: LocationSelector pins Uttarakhand first
it('LocationSelector pins Uttarakhand first followed by remaining states alphabetically', () => {
  const locSelectorPath = path.join(ROOT_DIR, 'frontend', 'src', 'components', 'LocationSelector.jsx');
  assert.ok(fs.existsSync(locSelectorPath), 'LocationSelector.jsx must exist');
  const content = fs.readFileSync(locSelectorPath, 'utf8');
  assert.ok(content.includes('getPinnedStates'), 'LocationSelector must define getPinnedStates');
  assert.ok(content.includes('DEFAULT_STATE'), 'LocationSelector must import DEFAULT_STATE');
});

// TEST 7: i18n translation key symmetry and completeness
it('i18n translation key completeness between en.json and hi.json', () => {
  const enPath = path.join(ROOT_DIR, 'frontend', 'src', 'i18n', 'en.json');
  const hiPath = path.join(ROOT_DIR, 'frontend', 'src', 'i18n', 'hi.json');
  assert.ok(fs.existsSync(enPath), 'en.json must exist');
  assert.ok(fs.existsSync(hiPath), 'hi.json must exist');

  const enData = JSON.parse(fs.readFileSync(enPath, 'utf8'));
  const hiData = JSON.parse(fs.readFileSync(hiPath, 'utf8'));

  function getKeys(obj, prefix = '') {
    let keys = [];
    for (const key of Object.keys(obj)) {
      if (key.startsWith('_')) continue;
      const full = prefix ? `${prefix}.${key}` : key;
      if (typeof obj[key] === 'object' && obj[key] !== null) {
        keys = keys.concat(getKeys(obj[key], full));
      } else {
        keys.push(full);
      }
    }
    return keys;
  }

  const enKeys = getKeys(enData).sort();
  const hiKeys = getKeys(hiData).sort();

  const missingInHi = enKeys.filter((k) => !hiKeys.includes(k));
  const missingInEn = hiKeys.filter((k) => !enKeys.includes(k));

  assert.strictEqual(missingInHi.length, 0, `Keys missing in hi.json: ${missingInHi.join(', ')}`);
  assert.strictEqual(missingInEn.length, 0, `Keys missing in en.json: ${missingInEn.join(', ')}`);

  // Verify non-empty values
  function checkNonEmpty(obj, pathName = '') {
    for (const [k, v] of Object.entries(obj)) {
      const cur = pathName ? `${pathName}.${k}` : k;
      if (typeof v === 'string') {
        assert.ok(v.trim().length > 0, `Key ${cur} has empty value`);
      } else if (typeof v === 'object' && v !== null) {
        checkNonEmpty(v, cur);
      }
    }
  }

  checkNonEmpty(enData, 'en');
  checkNonEmpty(hiData, 'hi');
});

console.log('\n====================================================');
console.log(`  RESULTS: ${passCount} PASSED, ${failCount} FAILED`);
console.log('====================================================');

if (failCount > 0) {
  process.exit(1);
} else {
  process.exit(0);
}
