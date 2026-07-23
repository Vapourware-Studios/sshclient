// Decides when to proactively nag for feedback. Deliberately its own tiny
// JSON file in userData, not vault_meta — it has to work before the vault
// is unlocked (or even set up), and it's not sensitive enough to need
// encryption or lock-state coupling.
const fs = require('fs');
const path = require('path');

// Minimum gap between any two proactive prompts, regardless of reason —
// keeps triggers from piling up (e.g. a crash right before a milestone).
const COOLDOWN_MS = 10 * 24 * 60 * 60 * 1000;
const MILESTONE_STEP = 50;
const INSTALL_DAYS_THRESHOLD = 14 * 24 * 60 * 60 * 1000;

let statePath = null;
let state = null;

function defaultState() {
  return {
    connCount: 0,
    installedAt: Date.now(),
    lastSeenVersion: null,
    lastPromptAt: 0,
    optedOut: false,
    crashedLastSession: false,
    shownInstallDays: false,
    shownUpdateForVersion: null,
    shownFirstSftpTransfer: false,
  };
}

function init(userDataPath) {
  statePath = path.join(userDataPath, 'feedback-state.json');
  try {
    state = { ...defaultState(), ...JSON.parse(fs.readFileSync(statePath, 'utf8')) };
  } catch {
    state = defaultState();
  }
}

function save() {
  try {
    fs.writeFileSync(statePath, JSON.stringify(state));
  } catch {}
}

function coolingDown() {
  return Date.now() - state.lastPromptAt < COOLDOWN_MS;
}

// Marks a prompt as shown (starts the cooldown) and returns its reason —
// the one value every trigger function hands back to main.js.
function consume(reason) {
  state.lastPromptAt = Date.now();
  save();
  return reason;
}

// Run once at startup, after init(). Covers the two triggers that can only
// be known at launch: a crash the previous session, and a version bump
// (update) since the last run. If cooldown blocks one, it's consumed and
// skipped rather than queued — simpler, and losing an occasional one-shot
// prompt to unlucky timing isn't worth a pending-trigger queue here.
function checkStartupTriggers(currentVersion) {
  if (!state || state.optedOut) return null;

  if (state.crashedLastSession) {
    state.crashedLastSession = false;
    save();
    if (!coolingDown()) return consume('crash');
  }

  const isFreshInstall = state.lastSeenVersion === null;
  const isUpdate = !isFreshInstall && state.lastSeenVersion !== currentVersion;
  if (isUpdate && state.shownUpdateForVersion !== currentVersion) {
    state.shownUpdateForVersion = currentVersion;
    save();
    if (!coolingDown()) return consume('update');
  }

  if (state.lastSeenVersion !== currentVersion) {
    state.lastSeenVersion = currentVersion;
    save();
  }

  if (!state.shownInstallDays && Date.now() - state.installedAt >= INSTALL_DAYS_THRESHOLD) {
    state.shownInstallDays = true;
    save();
    if (!coolingDown()) return consume('install-days');
  }

  return null;
}

// Best-effort, synchronous — called from a crash handler with no time for
// anything fancy. Silently no-ops if init() never ran (crash before ready).
function recordCrash() {
  if (!state) return;
  state.crashedLastSession = true;
  try {
    fs.writeFileSync(statePath, JSON.stringify(state));
  } catch {}
}

function recordConnection() {
  if (!state || state.optedOut) return null;
  state.connCount += 1;
  const isMilestone = state.connCount === 1 || state.connCount % MILESTONE_STEP === 0;
  if (!isMilestone) {
    save();
    return null;
  }
  save();
  if (coolingDown()) return null;
  return consume(state.connCount === 1 ? 'first-connection' : 'milestone');
}

function recordSftpTransfer() {
  if (!state || state.optedOut || state.shownFirstSftpTransfer) return null;
  state.shownFirstSftpTransfer = true;
  save();
  if (coolingDown()) return null;
  return consume('first-sftp-transfer');
}

function optOut() {
  if (!state) return;
  state.optedOut = true;
  save();
}

module.exports = {
  init,
  checkStartupTriggers,
  recordCrash,
  recordConnection,
  recordSftpTransfer,
  optOut,
};
