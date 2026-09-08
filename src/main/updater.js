const { app, dialog, BrowserWindow, shell } = require('electron');
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

// Release notes are shown in a scrolling panel, not stored — a runaway
// changelog would only bloat the IPC payload.
const MAX_NOTES_CHARS = 8000;

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
              name: json.name || json.tag_name,
              url: json.html_url,
              publishedAt: json.published_at || null,
              notes: String(json.body || '').slice(0, MAX_NOTES_CHARS),
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
function run(bin, args, timeout = 15000) {
  return new Promise((resolve) => {
    execFile(bin, args, { timeout }, (err, stdout) => {
      if (err) return resolve(null);
      resolve(String(stdout).trim() || null);
    });
  });
}

/**
 * Like `run`, but keeps the failure. The in-process Homebrew upgrade has to be
 * able to tell the user *why* it could not finish before falling back.
 */
function runVerbose(bin, args, timeout = 600000) {
  return new Promise((resolve) => {
    execFile(
      bin,
      args,
      { timeout, maxBuffer: 4 * 1024 * 1024, env: { ...process.env, HOMEBREW_NO_ENV_HINTS: '1' } },
      (err, stdout, stderr) => {
        const output = `${stdout || ''}${stderr || ''}`.trim();
        resolve({ ok: !err, output, error: err ? err.message : null });
      }
    );
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

/** `/opt/homebrew` from `/opt/homebrew/bin/brew`. */
function brewPrefix(brewBin) {
  return path.dirname(path.dirname(brewBin));
}

/**
 * The version Homebrew has installed, or null if the cask isn't installed.
 *
 * The Caskroom is read directly first. Shelling out to `brew` from a GUI app is
 * slow enough to hit a timeout on a cold cache, and every failure of that call
 * used to read as "not installed via Homebrew" — which is exactly how a
 * Homebrew install ended up being told to download a DMG by hand.
 */
async function getBrewInstalledVersion(brewBin) {
  try {
    const dir = path.join(brewPrefix(brewBin), 'Caskroom', HOMEBREW_CASK);
    const entries = await fsp.readdir(dir, { withFileTypes: true });
    const versions = entries
      .filter((e) => e.isDirectory() && !e.name.startsWith('.'))
      .map((e) => e.name);
    if (versions.length) {
      return versions.sort(compareSemver)[versions.length - 1];
    }
  } catch {}

  const out = await run(brewBin, ['list', '--cask', HOMEBREW_CASK, '--versions'], 60000);
  if (!out) return null;
  return out.split(/\s+/).pop() || null;
}

function notifyRenderer(channel, data) {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.webContents.send(channel, data);
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
      const total = Number(res.headers['content-length']) || 0;
      let received = 0;
      res.on('data', (chunk) => {
        received += chunk.length;
        if (total) notifyRenderer('update:status', { state: 'downloading', percent: (received / total) * 100 });
      });
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

// ---------------------------------------------------------------------------
// Update plans
//
// Both the automatic check at unlock and the manual "Check for updates" button
// in Settings go through the same two steps: work out how this particular copy
// of the app is installed, then build the plan that upgrades that kind of
// install. Keeping the two flows on one plan is what stops them drifting apart
// — the dialog and the settings panel can only ever offer the same upgrade.
// ---------------------------------------------------------------------------

/** How this copy of the app was installed, and therefore how it can update. */
async function describeInstall() {
  if (process.platform === 'darwin') {
    const brewBin = await findBrewBin();
    // Brew being present isn't enough — a DMG install on a Mac that also has
    // Homebrew must not be routed into `brew upgrade` (the cask isn't installed
    // there and the upgrade would fail). Only offer the Homebrew flow when the
    // cask itself is installed.
    const brewVersion = brewBin ? await getBrewInstalledVersion(brewBin) : null;
    if (brewBin && brewVersion) return { channel: 'homebrew', brewBin };
    return { channel: 'manual' };
  }

  if (process.platform === 'linux') {
    const install = await detectLinuxInstall();
    if (install.kind === 'appimage') return { channel: 'appimage' };
    if (install.kind === 'unknown') return { channel: 'manual' };
    const helper = install.kind === 'pacman' ? await aurHelperFor(install.pkg) : null;
    if (helper) return { channel: 'aur', install, helper };
    return { channel: install.kind, install };
  }

  return { channel: 'electron' };
}

/** Human-readable one-liner for the Settings panel: where updates come from. */
const CHANNEL_LABELS = {
  homebrew: 'Homebrew cask',
  appimage: 'AppImage (updates in place)',
  electron: 'Installer (updates in place)',
  aur: 'AUR helper',
  deb: 'Debian package',
  rpm: 'RPM package',
  pacman: 'pacman package',
  manual: 'Manual download',
};

/**
 * What running the update would actually do, given an install and a release.
 * `kind` is how the UI should describe it:
 *   'in-app'   — downloaded and applied by the app, ending in a restart
 *   'terminal' — a command handed to an in-app terminal for the user to run
 *   'page'     — nothing automatic; open the release page
 */
async function buildPlan(desc, latest) {
  if (desc.channel === 'appimage' || desc.channel === 'electron') {
    return { kind: 'in-app', run: () => runElectronInstall() };
  }

  if (desc.channel === 'homebrew') {
    return {
      // Homebrew installs the app into /Applications as the logged-in user, so
      // the upgrade needs no root and nothing has to be typed: the app runs
      // brew itself and only comes back to ask for the restart.
      kind: 'auto',
      run: () => runBrewUpgrade(desc, latest),
      // Whatever the automatic attempt could not do, the user can still finish
      // by hand — so the same command stays available as the fallback.
      command: `brew update && brew upgrade --greedy --cask ${HOMEBREW_CASK}`,
      readInstalledVersion: () => getBrewInstalledVersion(desc.brewBin),
      restartDetail: 'SSH Client has been updated via Homebrew. Restart now to finish?',
    };
  }

  // An AUR helper owns a package it built itself; handing it a downloaded file
  // would leave two copies of the app in the package database, so let the
  // helper do the upgrade instead.
  if (desc.channel === 'aur') {
    return {
      kind: 'terminal',
      command: desc.helper,
      readInstalledVersion: () => getLinuxInstalledVersion(desc.install),
      restartDetail: 'SSH Client has been updated. Restart now to finish?',
    };
  }

  const spec = LINUX_PACKAGE_KINDS[desc.channel];
  const asset = spec ? pickLinuxAsset(latest.assets, desc.channel, process.arch) : null;
  if (!spec || !asset) return { kind: 'page' };

  return {
    kind: 'terminal',
    needsRoot: true,
    asset,
    // The package has to be on disk before there is a command worth running,
    // so the file name is only known once the download has happened.
    prepare: async () => {
      const file = await assetPath(asset);
      await download(asset.url, file);
      return spec.install(file);
    },
    readInstalledVersion: () => getLinuxInstalledVersion(desc.install),
    restartDetail: 'SSH Client has been updated. Restart now to finish?',
  };
}

/**
 * Upgrades the Homebrew cask in the background and offers the restart.
 *
 * `brew update` first, because the cask describing the new release only reaches
 * the machine when the tap is refreshed. `--greedy` because a cask marked
 * `auto_updates true` is skipped by a plain upgrade — silently, printing
 * nothing, which is indistinguishable from being up to date.
 */
async function runBrewUpgrade(desc, latest) {
  notifyRenderer('update:status', { state: 'installing', version: latest.version, percent: 0 });

  // A stale tap is only a problem if the upgrade then fails, so a failure here
  // is not worth reporting on its own.
  await runVerbose(desc.brewBin, ['update', '--quiet'], 180000);

  const result = await runVerbose(
    desc.brewBin,
    ['upgrade', '--greedy', '--cask', HOMEBREW_CASK],
    600000
  );

  const installed = await getBrewInstalledVersion(desc.brewBin);
  const landed = installed && compareSemver(installed, latest.version) >= 0;

  if (!landed) {
    // `brew` exiting 0 without installing anything is a real outcome (a cask
    // pinned, or a tap that never got the new version), so the installed
    // version — not the exit code — decides whether this worked.
    const detail = result.output || result.error || 'Homebrew did not install the new version.';
    console.error('[updater] brew upgrade failed:', detail);
    notifyRenderer('update:status', { state: 'error', error: detail });
    return { error: detail.split('\n').slice(-6).join('\n') };
  }

  console.log(`[updater] brew upgraded to ${installed}`);
  notifyRenderer('update:status', { state: 'downloaded', version: installed, percent: 100 });
  await promptRestart(desc.restartDetail || 'SSH Client has been updated via Homebrew. Restart now to finish?');
  return { mode: 'installed', version: installed };
}

/**
 * Runs a plan: downloads whatever it needs, hands the command to the in-app
 * terminal, and starts watching for the upgrade to land.
 */
async function executePlan(plan, latest) {
  if (plan.kind === 'page') {
    shell.openExternal(latest.url);
    return { mode: 'page' };
  }

  if (plan.kind === 'in-app') {
    return plan.run();
  }

  // An automatic upgrade that fails leaves the user stuck unless the manual
  // command is offered instead, so a failure falls through to the terminal
  // rather than ending the flow.
  if (plan.kind === 'auto') {
    const result = await plan.run();
    if (!result?.error || !plan.command) return result;
    console.log('[updater] falling back to the terminal command');
    notifyRenderer('update:status', { state: 'terminal', version: latest.version });
    notifyRenderer('update:start', { targetVersion: latest.version, command: plan.command });
    pollForUpgrade(plan.readInstalledVersion, latest.version, plan.restartDetail);
    return { mode: 'terminal', command: plan.command, warning: result.error };
  }

  let command = plan.command;
  if (!command && plan.prepare) {
    notifyRenderer('update:status', { state: 'downloading', percent: 0 });
    try {
      command = await plan.prepare();
    } catch (err) {
      const message = err?.message || String(err);
      console.error('[updater] package download failed:', message);
      notifyRenderer('update:status', { state: 'error', error: message });
      return { error: message };
    }
  }
  if (!command) return { error: 'No update command is available for this install.' };

  notifyRenderer('update:start', { targetVersion: latest.version, command });
  notifyRenderer('update:status', { state: 'terminal', version: latest.version });
  pollForUpgrade(plan.readInstalledVersion, latest.version, plan.restartDetail);
  return { mode: 'terminal', command };
}

// ---------------------------------------------------------------------------
// electron-updater (Windows installers and Linux AppImages)
// ---------------------------------------------------------------------------

// Mirrors what electron-updater is doing, so a Settings panel opened halfway
// through a download can show where it got to instead of starting over.
let electronState = { state: 'idle', version: null, percent: 0, error: null };
let autoUpdaterRef = null;
let promptedVersion = null;

function setElectronState(patch) {
  electronState = { ...electronState, ...patch };
  notifyRenderer('update:status', electronState);
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

/** Wires up electron-updater exactly once and hands back the instance. */
function ensureElectronUpdater() {
  if (autoUpdaterRef) return autoUpdaterRef;

  // Lazily required: only touches NSIS/AppImage update machinery, neither of
  // which applies to a Homebrew or distro-package install.
  const { autoUpdater } = require('electron-updater');
  autoUpdaterRef = autoUpdater;

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
    setElectronState({ state: 'error', error: err?.message || String(err) });
  });

  autoUpdater.on('checking-for-update', () => setElectronState({ state: 'checking', error: null }));

  autoUpdater.on('update-available', (info) => {
    console.log(`[updater] ${info?.version} available; downloading`);
    setElectronState({ state: 'downloading', version: info?.version || null, percent: 0 });
  });

  autoUpdater.on('update-not-available', () => {
    console.log('[updater] already up to date');
    setElectronState({ state: 'up-to-date', percent: 0 });
  });

  autoUpdater.on('download-progress', (p) => {
    setElectronState({ state: 'downloading', percent: p?.percent || 0 });
  });

  autoUpdater.on('update-downloaded', (info) => {
    const version = info?.version;
    setElectronState({ state: 'downloaded', version: version || null, percent: 100 });
    // Re-checks can re-emit this for a version already declined; asking again
    // every few hours would be nagging, not helping.
    if (version && version === promptedVersion) return;
    promptedVersion = version;
    console.log(`[updater] ${version} downloaded; prompting to restart`);
    promptInstall(autoUpdater, version).catch((err) => {
      console.error('[updater] restart prompt failed:', err?.message || err);
    });
  });

  return autoUpdater;
}

let electronTimerStarted = false;

function initElectronUpdater() {
  const autoUpdater = ensureElectronUpdater();

  // Rejections here duplicate the `error` event, which is already logged.
  const check = () => autoUpdater.checkForUpdates().catch(() => {});

  check();
  electronTimerStarted = true;
  // Unref'd so a pending re-check never holds the process open at quit.
  setInterval(check, RECHECK_INTERVAL_MS).unref?.();
}

/**
 * The Settings-panel install for the in-place formats. A download that already
 * finished only needs the restart; anything else starts (or rejoins) one.
 */
async function runElectronInstall() {
  if (!app.isPackaged) return { error: 'Updates only apply to a packaged build.' };
  const autoUpdater = ensureElectronUpdater();

  if (electronState.state === 'downloaded') {
    autoUpdater.quitAndInstall();
    return { mode: 'restarting' };
  }

  try {
    await autoUpdater.checkForUpdates();
    return { mode: 'in-app' };
  } catch (err) {
    const message = err?.message || String(err);
    setElectronState({ state: 'error', error: message });
    return { error: message };
  }
}

// ---------------------------------------------------------------------------
// The automatic check, run once the vault is unlocked
// ---------------------------------------------------------------------------

/** The fallback for installs no package manager owns: point at the release page. */
async function offerDownloadPage(latest) {
  const { response } = await dialog.showMessageBox({
    type: 'info',
    buttons: ['Open download page', 'Later'],
    defaultId: 0,
    message: `SSH Client ${latest.version} is available`,
    detail: `You're on ${app.getVersion()}.`,
  });
  if (response === 0) shell.openExternal(latest.url);
}

// A release is only ever put in front of you once per run. The check repeats so
// a release published while the app is open is still found, but somebody who
// said "Later" should not be asked again every six hours.
let offeredVersion = null;

async function autoCheck() {
  const desc = await describeInstall();

  // The AppImage and the Windows installer are single self-contained artifacts,
  // so electron-updater can download the new one and swap it in. It runs its
  // own periodic check, so it takes over from here.
  if (desc.channel === 'appimage' || desc.channel === 'electron') {
    // Once it is running it re-checks on its own; the periodic check has
    // nothing left to do on this channel.
    if (!electronTimerStarted) initElectronUpdater();
    return;
  }

  // Everything else is owned by a package manager (or by nothing at all).
  // electron-updater cannot rewrite those files without root, so the update is
  // handed to the tool that installed the app instead of failing silently.
  const latest = await fetchLatestRelease();
  if (!latest || compareSemver(latest.version, app.getVersion()) <= 0) return;
  if (offeredVersion === latest.version) return;
  offeredVersion = latest.version;

  const plan = await buildPlan(desc, latest);
  if (plan.kind === 'page') {
    await offerDownloadPage(latest);
    return;
  }

  const { response } = await dialog.showMessageBox({
    type: 'info',
    buttons: ['Update now', 'Open download page', 'Later'],
    defaultId: 0,
    message: `SSH Client ${latest.version} is available`,
    detail:
      plan.kind === 'auto'
        ? `You're on ${app.getVersion()}. This installs it for you in the background; you'll be asked to restart when it's done.`
        : plan.needsRoot
          ? `You're on ${app.getVersion()}. This downloads the new package and opens an in-app terminal with the install command ready — press Enter to run it. It asks for your password because replacing a system package needs root.`
          : `You're on ${app.getVersion()}. This opens an in-app terminal with the upgrade command ready — press Enter to run it.`,
  });
  if (response === 1) {
    shell.openExternal(latest.url);
    return;
  }
  if (response !== 0) return;

  const result = await executePlan(plan, latest);
  if (result?.error) await offerDownloadPage(latest);
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Everything the Settings panel needs to describe the update situation. Safe to
 * call from an unpackaged dev build — it just reports that updating is off.
 */
async function check() {
  const currentVersion = app.getVersion();
  const desc = await describeInstall();
  const base = {
    currentVersion,
    channel: desc.channel,
    channelLabel: CHANNEL_LABELS[desc.channel] || desc.channel,
    packaged: app.isPackaged,
    checkedAt: Date.now(),
    progress: desc.channel === 'appimage' || desc.channel === 'electron' ? electronState : null,
  };

  const latest = await fetchLatestRelease();
  if (!latest) {
    return { ...base, error: 'Could not reach GitHub to check for updates.' };
  }

  const hasUpdate = compareSemver(latest.version, currentVersion) > 0;
  const plan = hasUpdate ? await buildPlan(desc, latest) : null;

  return {
    ...base,
    hasUpdate,
    latestVersion: latest.version,
    releaseName: latest.name,
    releaseUrl: latest.url,
    publishedAt: latest.publishedAt,
    notes: latest.notes,
    // 'page' means the app cannot do it for you, so the button has to say so.
    action: plan ? plan.kind : null,
    needsRoot: Boolean(plan?.needsRoot),
  };
}

/** Runs the update the last `check()` described. Returns `{ error }` on failure. */
async function install() {
  if (!app.isPackaged) return { error: 'Updates only apply to a packaged build.' };
  const desc = await describeInstall();
  const latest = await fetchLatestRelease();
  if (!latest) return { error: 'Could not reach GitHub to check for updates.' };
  if (compareSemver(latest.version, app.getVersion()) <= 0) {
    return { error: 'Already up to date.' };
  }
  const plan = await buildPlan(desc, latest);
  return executePlan(plan, latest);
}

/** Opens the GitHub release page for the newest release. */
async function openReleasePage() {
  const latest = await fetchLatestRelease();
  shell.openExternal(latest?.url || `https://github.com/${REPO_OWNER}/${REPO_NAME}/releases`);
  return {};
}

let started = false;

function init() {
  if (!app.isPackaged || started) return;
  started = true;

  const run = () =>
    autoCheck().catch((err) =>
      console.error('[updater] update check failed:', err?.message || err)
    );

  run();
  // Every channel re-checks, not just the ones electron-updater drives: an app
  // left running on Homebrew, a Linux package or the AUR would otherwise never
  // see a release published after launch. Unref'd so it never delays a quit.
  setInterval(run, RECHECK_INTERVAL_MS).unref?.();
}

module.exports = { init, check, install, openReleasePage, compareSemver, pickLinuxAsset };
