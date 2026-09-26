const assert = require('node:assert/strict');
const test = require('node:test');
const { assetPath, pollForUpgrade, repositoryUpgradeCommand, compareSemver, pickLinuxAsset, linuxInstallCommand, verifyLinuxDownload, sweepOldDownloads } = require('../src/main/updater');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');

const ASSETS = [
  { name: 'SSH Client-0.1.8-arm64.dmg', url: 'https://example.com/dmg' },
  { name: 'SSH Client Setup 0.1.8.exe', url: 'https://example.com/exe' },
  { name: 'SSH Client-0.1.8.AppImage', url: 'https://example.com/appimage' },
  { name: 'sshclient_0.1.8_amd64.deb', url: 'https://example.com/deb' },
  { name: 'sshclient-0.1.8.x86_64.rpm', url: 'https://example.com/rpm' },
  { name: 'sshclient-0.1.8-x86_64.pacman', url: 'https://example.com/pacman-x64' },
  { name: 'sshclient-0.1.8-aarch64.pacman', url: 'https://example.com/pacman-arm64' },
];

test('compareSemver orders releases', () => {
  assert.ok(compareSemver('0.1.8', '0.1.7') > 0);
  assert.ok(compareSemver('v0.2.0', '0.10.0') < 0);
  assert.equal(compareSemver('1.2.3', 'v1.2.3'), 0);
});

test('pickLinuxAsset matches package format and architecture', () => {
  assert.equal(pickLinuxAsset(ASSETS, 'pacman', 'x64').url, 'https://example.com/pacman-x64');
  assert.equal(pickLinuxAsset(ASSETS, 'pacman', 'arm64').url, 'https://example.com/pacman-arm64');
  assert.equal(pickLinuxAsset(ASSETS, 'deb', 'x64').url, 'https://example.com/deb');
  assert.equal(pickLinuxAsset(ASSETS, 'rpm', 'x64').url, 'https://example.com/rpm');
});

test('pickLinuxAsset returns null when nothing matches', () => {
  assert.equal(pickLinuxAsset(ASSETS, 'deb', 'arm64'), null);
  assert.equal(pickLinuxAsset(ASSETS, 'appimage', 'x64'), null);
  assert.equal(pickLinuxAsset(ASSETS, 'pacman', 'ia32'), null);
  assert.equal(pickLinuxAsset(null, 'pacman', 'x64'), null);
});

test('new Linux artifact names and native Arch extensions match their CPU', () => {
  for (const [kind, arch, name] of [
    ['pacman', 'x64', 'sshclient-1.2.3-linux-x64.pacman'],
    ['pacman', 'arm64', 'sshclient-1.2.3-linux-aarch64.pacman'],
    ['pacman', 'x64', 'sshclient-1.2.3-x86_64.pkg.tar.zst'],
    ['deb', 'arm64', 'sshclient-1.2.3-linux-arm64.deb'],
    ['rpm', 'arm64', 'sshclient-1.2.3-linux-aarch64.rpm'],
  ]) {
    assert.equal(pickLinuxAsset([{ name }], kind, arch).name, name);
    assert.equal(pickLinuxAsset([{ name }], kind, arch === 'x64' ? 'arm64' : 'x64'), null);
  }
});

test('Linux upgrades resolve dependencies and quote package paths as literal arguments', async () => {
  assert.equal(await linuxInstallCommand('deb', '/tmp/demo.deb'), "sudo apt-get install -- '/tmp/demo.deb'");
  assert.equal(await linuxInstallCommand('pacman', '/tmp/demo.pacman'), "sudo pacman -U -- '/tmp/demo.pacman'");
  for (const manager of ['dnf', 'zypper', 'yum']) {
    assert.equal(await linuxInstallCommand('rpm', '/tmp/demo.rpm', async (name) => name === manager), `sudo ${manager} install -- '/tmp/demo.rpm'`);
  }
  await assert.rejects(linuxInstallCommand('rpm', '/tmp/demo.rpm', async () => false), /package manager/);
  assert.equal(await linuxInstallCommand('deb', "/tmp/demo's $(touch demo).deb"), "sudo apt-get install -- '/tmp/demo'\"'\"'s $(touch demo).deb'");
});

test('Linux package verification rejects corrupted downloads and missing checksums', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sshclient-checksum-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, 'demo.deb');
  fs.writeFileSync(file, 'demo');
  const digest = crypto.createHash('sha256').update('demo').digest('hex');
  await verifyLinuxDownload(file, `${digest}  demo.deb\n`);
  await assert.rejects(verifyLinuxDownload(file, `${digest}  other.deb\n`), /missing/);
  fs.appendFileSync(file, 'changed');
  await assert.rejects(verifyLinuxDownload(file, `${digest}  demo.deb\n`), /SHA-256/);
});

test('sweeps only update downloads older than the upgrade window', async () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'sweep-'));
  try {
    const stale = path.join(temp, 'sshclient-update-old');
    const fresh = path.join(temp, 'sshclient-update-new');
    const other = path.join(temp, 'something-else');
    for (const dir of [stale, fresh, other]) {
      fs.mkdirSync(dir);
      fs.writeFileSync(path.join(dir, 'demo.deb'), 'demo');
    }
    const hourAgo = new Date(Date.now() - 60 * 60 * 1000);
    fs.utimesSync(stale, hourAgo, hourAgo);
    fs.utimesSync(other, hourAgo, hourAgo);

    await sweepOldDownloads(temp);

    assert.equal(fs.existsSync(stale), false);
    assert.equal(fs.existsSync(fresh), true);
    assert.equal(fs.existsSync(other), true);
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
});


test('repository installations keep updates with the signed package manager', async () => {
  const read = async () => 'URIs: https://github.com/Vapourware-Studios/linux-packages/releases/download/repo-apt/';
  assert.equal(await repositoryUpgradeCommand({ kind: 'deb', pkg: 'sshclient' }, async () => true, read),
    'sudo apt-get update && sudo apt-get install --only-upgrade -- sshclient');
  for (const [manager, command] of [['dnf', 'sudo dnf upgrade --refresh -- sshclient'],
    ['zypper', 'sudo zypper refresh && sudo zypper update -- sshclient'], ['yum', 'sudo yum update -- sshclient']]) {
    assert.equal(await repositoryUpgradeCommand({ kind: 'rpm', pkg: 'sshclient' }, async (bin) => bin === manager, read), command);
  }
  assert.equal(await repositoryUpgradeCommand({ kind: 'pacman', pkg: 'sshclient' }, async () => true, read,
    async () => 'https://github.com/Vapourware-Studios/linux-packages/releases/download/repo-arch-x86_64'),
    'sudo pacman -Syu -- sshclient');
  assert.equal(await repositoryUpgradeCommand({ kind: 'pacman', pkg: 'sshclient' }, async () => true, read, async () => null), null);
  assert.equal(await repositoryUpgradeCommand({ kind: 'deb', pkg: 'sshclient' }, async () => true,
    async () => { throw new Error('missing config'); }), null);
  assert.equal(await repositoryUpgradeCommand({ kind: 'deb', pkg: 'sshclient' }, async () => true,
    async () => (await read()) + '\nEnabled: no'), null);
  assert.equal(await repositoryUpgradeCommand({ kind: 'deb', pkg: 'demo' }, async () => true, read), null);
});


test('pending update commands retain their package after the polling window', async (t) => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'pending-update-'));
  t.after(() => fs.rmSync(temp, { recursive: true, force: true }));
  const file = await assetPath({ name: 'demo.deb' }, temp);
  fs.writeFileSync(file, 'demo');
  const old = new Date(Date.now() - 60 * 60 * 1000);
  fs.utimesSync(path.dirname(file), old, old);
  await sweepOldDownloads(temp);
  assert.equal(fs.existsSync(file), true);
  t.mock.timers.enable({ apis: ['setInterval', 'Date'] });
  let cleaned = false;
  pollForUpgrade(async () => null, '1.2.3', 'demo', () => { cleaned = true; });
  t.mock.timers.tick(11 * 60 * 1000);
  await Promise.resolve();
  assert.equal(cleaned, false);
});
