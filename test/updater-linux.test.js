const assert = require('node:assert/strict');
const test = require('node:test');
const { compareSemver, pickLinuxAsset } = require('../src/main/updater');

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
