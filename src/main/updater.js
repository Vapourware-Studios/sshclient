const { app, dialog, BrowserWindow } = require('electron');
const { execFile } = require('child_process');
const fsp = require('fs/promises');
const https = require('https');

const REPO_OWNER = 'Vapourware-Studios';
const REPO_NAME = 'sshclient';
// Must match the token the app is published under in Homebrew once a cask exists.
const HOMEBREW_CASK = 'sshclient';

// An app that stays open for days would otherwise only ever see the release
// that was current when it launched.
const RECHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;

function compareSemver(a, b) {
  const pa = a.replace(/^v/, '').split('.').map(Number);
  const pb = b.replace(/^v/, '').split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    const diff = (pa[i] || 0) - (pb[i] || 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

function fetchLatestRelease() {
  return new Promise((resolve) => {
    const req = https.get(
      `https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/releases/latest`,
      { headers: { 'User-Agent': 'sshclient-updater' } },
      (res) => {
        let body = '';
        res.on('data', (chunk) => (body += chunk));
        res.on('end', () => {
          try {
            const json = JSON.parse(body);
            if (!json.tag_name) return resolve(null);
            resolve({ version: json.tag_name.replace(/^v/, ''), url: json.html_url });
          } catch {
            resolve(null);
          }
        });
      }
    );
    req.on('error', () => resolve(null));
    req.setTimeout(10000, () => req.destroy());
  });
}

async function findBrewBin() {
  for (const candidate of ['/opt/homebrew/bin/brew', '/usr/local/bin/brew']) {
    try {
      await fsp.access(candidate);
      return candidate;
    } catch {}
  }
  return null;
}

function getBrewInstalledVersion(brewBin) {
  return new Promise((resolve) => {
    execFile(brewBin, ['list', '--cask', HOMEBREW_CASK, '--versions'], (err, stdout) => {
      if (err) return resolve(null);
      resolve(stdout.trim().split(/\s+/).pop() || null);
    });
  });
}

function notifyRenderer(channel, data) {
  const win = BrowserWindow.getAllWindows()[0];
  if (win && !win.isDestroyed()) {
    win.webContents.send(channel, data);
  }
}

async function promptRestart() {
  const { response } = await dialog.showMessageBox({
    type: 'info',
    buttons: ['Restart now', 'Later'],
    defaultId: 0,
    message: 'Update installed',
    detail: 'SSH Client has been updated via Homebrew. Restart now to finish?',
  });
  if (response === 0) {
    app.relaunch();
    app.quit();
  }
}

function pollForBrewUpgrade(brewBin, targetVersion) {
  const POLL_MS = 4000;
  const TIMEOUT_MS = 10 * 60 * 1000;
  const start = Date.now();
  const timer = setInterval(async () => {
    if (Date.now() - start > TIMEOUT_MS) {
      clearInterval(timer);
      return;
    }
    const installed = await getBrewInstalledVersion(brewBin);
    if (installed && compareSemver(installed, targetVersion) >= 0) {
      clearInterval(timer);
      promptRestart();
    }
  }, POLL_MS);
}

async function initMacUpdater() {
  const latest = await fetchLatestRelease();
  if (!latest || compareSemver(latest.version, app.getVersion()) <= 0) return;

  const brewBin = await findBrewBin();
  // Brew being present isn't enough — a DMG install on a Mac that also has
  // Homebrew must not be routed into `brew upgrade` (the cask isn't installed
  // there and the upgrade would fail). Only offer the Homebrew flow when the
  // cask itself is installed.
  const brewInstalled = brewBin ? await getBrewInstalledVersion(brewBin) : null;
  if (!brewBin || !brewInstalled) {
    // Not a Homebrew install of this app — just point at the release page.
    const { response } = await dialog.showMessageBox({
      type: 'info',
      buttons: ['Open download page', 'Later'],
      defaultId: 0,
      message: `SSH Client ${latest.version} is available`,
      detail: `You're on ${app.getVersion()}.`,
    });
    if (response === 0) {
      require('electron').shell.openExternal(latest.url);
    }
    return;
  }

  const { response } = await dialog.showMessageBox({
    type: 'info',
    buttons: ['Update via Homebrew', 'Later'],
    defaultId: 0,
    message: `SSH Client ${latest.version} is available`,
    detail: `You're on ${app.getVersion()}. This opens an in-app terminal with the upgrade command ready — press Enter to run it.`,
  });
  if (response !== 0) return;

  notifyRenderer('update:start', { targetVersion: latest.version });
  pollForBrewUpgrade(brewBin, latest.version);
}

/**
 * Offers the restart that finishes an already-downloaded update. Declining is
 * not the end of it — `autoInstallOnAppQuit` means the update still lands the
 * next time the app is closed — so this asks once per version and then leaves
 * the user alone.
 */
async function promptInstall(autoUpdater, version) {
  const { response } = await dialog.showMessageBox({
    type: 'info',
    buttons: ['Restart now', 'Later'],
    defaultId: 0,
    message: `SSH Client ${version} is ready to install`,
    detail: `You're on ${app.getVersion()}. Restarting finishes the update now; otherwise it installs the next time you quit.`,
  });
  if (response !== 0) return;

  // Goes through the normal quit path, so `before-quit` still gets to end
  // shares and lock the vault before the installer runs.
  autoUpdater.quitAndInstall();
}

function initWindowsLinuxUpdater() {
  // Lazily required: only touches Squirrel/NSIS/AppImage update machinery,
  // none of which applies on macOS.
  const { autoUpdater } = require('electron-updater');

  // The dialog below is this app's update UI, so electron-updater must not
  // also raise its own toast — hence checkForUpdates, not
  // checkForUpdatesAndNotify.
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;

  // A broken update feed is invisible from inside the app: nothing fails, an
  // update simply never arrives. Logging is the only trace there is, and it
  // costs nothing to keep.
  autoUpdater.on('error', (err) => {
    console.error('[updater] update failed:', err?.message || err);
  });

  autoUpdater.on('update-available', (info) => {
    console.log(`[updater] ${info?.version} available; downloading`);
  });

  autoUpdater.on('update-not-available', () => {
    console.log('[updater] already up to date');
  });

  let promptedVersion = null;

  autoUpdater.on('update-downloaded', (info) => {
    const version = info?.version;
    // Re-checks can re-emit this for a version already declined; asking again
    // every few hours would be nagging, not helping.
    if (version && version === promptedVersion) return;
    promptedVersion = version;
    console.log(`[updater] ${version} downloaded; prompting to restart`);
    promptInstall(autoUpdater, version).catch((err) => {
      console.error('[updater] restart prompt failed:', err?.message || err);
    });
  });

  // Rejections here duplicate the `error` event, which is already logged.
  const check = () => autoUpdater.checkForUpdates().catch(() => {});

  check();
  // Unref'd so a pending re-check never holds the process open at quit.
  setInterval(check, RECHECK_INTERVAL_MS).unref?.();
}

let started = false;

function init() {
  if (!app.isPackaged || started) return;
  started = true;
  if (process.platform === 'darwin') {
    initMacUpdater().catch((err) => {
      console.error('[updater] update check failed:', err?.message || err);
    });
  } else {
    initWindowsLinuxUpdater();
  }
}

module.exports = { init };
