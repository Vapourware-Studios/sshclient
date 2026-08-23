const { app, dialog, BrowserWindow } = require('electron');
const { execFile } = require('child_process');
const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
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
            resolve({
              version: json.tag_name.replace(/^v/, ''),
              url: json.html_url,
              assets: Array.isArray(json.assets)
                ? json.assets.map((a) => ({ name: a.name, url: a.browser_download_url }))
                : [],
            });
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

/** Resolves to trimmed stdout, or null if the binary is missing or exits non-zero. */
function run(bin, args) {
  return new Promise((resolve) => {
    execFile(bin, args, { timeout: 15000 }, (err, stdout) => {
      if (err) return resolve(null);
      resolve(String(stdout).trim() || null);
    });
  });
}

async function which(bin) {
  const dirs = (process.env.PATH || '/usr/bin:/bin:/usr/local/bin').split(path.delimiter);
  for (const dir of dirs) {
    if (!dir) continue;
    const candidate = path.join(dir, bin);
    try {
      await fsp.access(candidate);
      return candidate;
    } catch {}
  }
  return null;
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

async function getBrewInstalledVersion(brewBin) {
  const out = await run(brewBin, ['list', '--cask', HOMEBREW_CASK, '--versions']);
  if (!out) return null;
  return out.split(/\s+/).pop() || null;
}

function notifyRenderer(channel, data) {
  const win = BrowserWindow.getAllWindows()[0];
  if (win && !win.isDestroyed()) {
    win.webContents.send(channel, data);
  }
}

async function promptRestart(detail) {
  const { response } = await dialog.showMessageBox({
    type: 'info',
    buttons: ['Restart now', 'Later'],
    defaultId: 0,
    message: 'Update installed',
    detail,
  });
  if (response === 0) {
    app.relaunch();
    app.quit();
  }
}

/**
 * Watches an out-of-process package manager finish the upgrade the user just
 * ran in the in-app terminal, then offers the restart that picks it up.
 */
function pollForUpgrade(readInstalledVersion, targetVersion, detail) {
  const POLL_MS = 4000;
  const TIMEOUT_MS = 10 * 60 * 1000;
  const start = Date.now();
  const timer = setInterval(async () => {
    if (Date.now() - start > TIMEOUT_MS) {
      clearInterval(timer);
      return;
    }
    const installed = await readInstalledVersion();
    if (installed && compareSemver(installed, targetVersion) >= 0) {
      clearInterval(timer);
      promptRestart(detail);
    }
  }, POLL_MS);
  timer.unref?.();
}

/** The fallback for installs no package manager owns: point at the release page. */
async function offerDownloadPage(latest) {
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
    await offerDownloadPage(latest);
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

  notifyRenderer('update:start', {
    targetVersion: latest.version,
    command: `brew upgrade --cask ${HOMEBREW_CASK}`,
  });
  pollForUpgrade(
    () => getBrewInstalledVersion(brewBin),
    latest.version,
    'SSH Client has been updated via Homebrew. Restart now to finish?'
  );
}

// How each Linux package format spells this machine's CPU in a file name, and
// the command that installs a downloaded package of that format.
const LINUX_PACKAGE_KINDS = {
  pacman: {
    ext: '.pacman',
    arches: { x64: ['x86_64'], arm64: ['aarch64', 'arm64'] },
    install: (file) => `sudo pacman -U "${file}"`,
  },
  deb: {
    ext: '.deb',
    arches: { x64: ['amd64', 'x86_64'], arm64: ['arm64', 'aarch64'] },
    install: (file) => `sudo dpkg -i "${file}"`,
  },
  rpm: {
    ext: '.rpm',
    arches: { x64: ['x86_64'], arm64: ['aarch64', 'arm64'] },
    install: (file) => `sudo rpm -U "${file}"`,
  },
};

/**
 * Picks the release asset matching this install's package format and CPU. Both
 * have to match: a .deb cannot upgrade a pacman install, and an aarch64 build
 * will not run on x86_64.
 */
function pickLinuxAsset(assets, kind, arch) {
  const spec = LINUX_PACKAGE_KINDS[kind];
  if (!spec || !Array.isArray(assets)) return null;
  const tokens = spec.arches[arch] || [];
  const sameKind = assets.filter((a) => a?.name?.toLowerCase().endsWith(spec.ext));
  for (const token of tokens) {
    const match = sameKind.find((a) => a.name.toLowerCase().includes(token));
    if (match) return match;
  }
  return null;
}

function download(url, dest, redirects = 0) {
  return new Promise((resolve, reject) => {
    if (redirects > 5) return reject(new Error('too many redirects'));
    const req = https.get(url, { headers: { 'User-Agent': 'sshclient-updater' } }, (res) => {
      // GitHub serves release assets as a redirect to its object storage.
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume();
        return resolve(download(res.headers.location, dest, redirects + 1));
      }
      if (res.statusCode !== 200) {
        res.resume();
        return reject(new Error(`download failed with HTTP ${res.statusCode}`));
      }
      const file = fs.createWriteStream(dest);
      res.pipe(file);
      file.on('finish', () => file.close(() => resolve(dest)));
      file.on('error', reject);
    });
    req.on('error', reject);
    req.setTimeout(120000, () => req.destroy(new Error('download timed out')));
  });
}

/**
 * Which Linux package owns the running binary. AppImage answers itself through
 * the environment; everything else has to be asked of the distro's package
 * database, because the same tarball can be shipped as a .deb, an .rpm or a
 * pacman package and each of them updates differently.
 */
async function detectLinuxInstall() {
  // Set by the AppImage runtime itself, so it is the one reliable marker that
  // the app is running from an AppImage and that electron-updater can patch it
  // in place.
  if (process.env.APPIMAGE) return { kind: 'appimage' };

  const exe = app.getPath('exe');

  if (await which('pacman')) {
    const owner = await run('pacman', ['-Qoq', exe]);
    if (owner) return { kind: 'pacman', pkg: owner.split('\n')[0].trim() };
  }

  if (await which('dpkg')) {
    // `dpkg -S <path>` prints "package: /path".
    const owner = await run('dpkg', ['-S', exe]);
    const pkg = owner ? owner.split('\n')[0].split(':')[0].trim() : null;
    if (pkg) return { kind: 'deb', pkg };
  }

  if (await which('rpm')) {
    const owner = await run('rpm', ['-qf', '--queryformat', '%{NAME}', exe]);
    if (owner && !owner.includes('not owned')) return { kind: 'rpm', pkg: owner.trim() };
  }

  return { kind: 'unknown' };
}

/** The version a distro package database reports for the installed app. */
async function getLinuxInstalledVersion(install) {
  if (install.kind === 'pacman') {
    // "sshclient 0.1.7-1" → "0.1.7"
    const out = await run('pacman', ['-Q', install.pkg]);
    const version = out ? out.split(/\s+/)[1] : null;
    return version ? version.split('-')[0] : null;
  }
  if (install.kind === 'deb') {
    const out = await run('dpkg-query', ['-W', '-f', '${Version}', install.pkg]);
    return out ? out.split('-')[0] : null;
  }
  if (install.kind === 'rpm') {
    return await run('rpm', ['-q', '--queryformat', '%{VERSION}', install.pkg]);
  }
  return null;
}

/**
 * The command that upgrades an AUR-built package, or null when the install did
 * not come from the AUR. A package named exactly like the official artifact is
 * assumed to be that artifact, installed by hand.
 */
async function aurHelperFor(pkg) {
  if (!pkg || pkg === 'sshclient') return null;
  for (const helper of ['yay', 'paru']) {
    if (await which(helper)) return `${helper} -S ${pkg}`;
  }
  if (await which('pamac')) return 'pamac upgrade -a';
  return null;
}

/** Where a downloaded package is staged before the install command runs. */
async function assetPath(asset) {
  const dir = path.join(app.getPath('temp'), 'sshclient-update');
  await fsp.mkdir(dir, { recursive: true });
  return path.join(dir, asset.name);
}

async function initLinuxUpdater() {
  const install = await detectLinuxInstall();

  // The AppImage is a single self-contained file, so electron-updater can
  // download the new one and swap it in — the same flow Windows gets.
  if (install.kind === 'appimage') {
    initElectronUpdater();
    return;
  }

  // Everything else is owned by a package manager (or by nothing at all).
  // electron-updater cannot rewrite those files without root, so the update is
  // handed to the tool that installed the app instead of failing silently.
  const latest = await fetchLatestRelease();
  if (!latest || compareSemver(latest.version, app.getVersion()) <= 0) return;

  const spec = LINUX_PACKAGE_KINDS[install.kind];
  const asset = spec ? pickLinuxAsset(latest.assets, install.kind, process.arch) : null;

  // An AUR helper owns a package it built itself; handing it a downloaded file
  // would leave two copies of the app in the package database, so let the
  // helper do the upgrade instead.
  const helper = install.kind === 'pacman' ? await aurHelperFor(install.pkg) : null;
  const file = helper || !asset ? null : await assetPath(asset);
  const command = helper || (file ? spec.install(file) : null);

  if (!command) {
    await offerDownloadPage(latest);
    return;
  }

  const { response } = await dialog.showMessageBox({
    type: 'info',
    buttons: ['Update now', 'Open download page', 'Later'],
    defaultId: 0,
    message: `SSH Client ${latest.version} is available`,
    detail: helper
      ? `You're on ${app.getVersion()}. This opens an in-app terminal with the upgrade command ready — press Enter to run it.`
      : `You're on ${app.getVersion()}. This downloads the new package and opens an in-app terminal with the install command ready — press Enter to run it. It asks for your password because replacing a system package needs root.`,
  });
  if (response === 1) {
    require('electron').shell.openExternal(latest.url);
    return;
  }
  if (response !== 0) return;

  if (!helper) {
    try {
      await download(asset.url, file);
    } catch (err) {
      console.error('[updater] package download failed:', err?.message || err);
      await offerDownloadPage(latest);
      return;
    }
  }

  notifyRenderer('update:start', { targetVersion: latest.version, command });
  pollForUpgrade(
    () => getLinuxInstalledVersion(install),
    latest.version,
    'SSH Client has been updated. Restart now to finish?'
  );
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

function initElectronUpdater() {
  // Lazily required: only touches NSIS/AppImage update machinery, neither of
  // which applies on macOS.
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
  const fail = (err) => console.error('[updater] update check failed:', err?.message || err);
  if (process.platform === 'darwin') {
    initMacUpdater().catch(fail);
  } else if (process.platform === 'linux') {
    initLinuxUpdater().catch(fail);
  } else {
    initElectronUpdater();
  }
}

module.exports = { init, compareSemver, pickLinuxAsset };
