const assert = require('node:assert/strict');
const test = require('node:test');
const ssh = require('../src/main/ssh');

function osRelease(id, idLike) {
  return `NAME="whatever"\nID=${id}\n${idLike ? `ID_LIKE=${idLike}\n` : ''}VERSION_ID="1"\n`;
}

test('detectOsIcon matches known distro IDs', () => {
  assert.equal(ssh.detectOsIcon(osRelease('ubuntu')), 'ubuntu');
  assert.equal(ssh.detectOsIcon(osRelease('debian')), 'debian');
  assert.equal(ssh.detectOsIcon(osRelease('fedora')), 'fedora');
  assert.equal(ssh.detectOsIcon(osRelease('centos')), 'centos');
  assert.equal(ssh.detectOsIcon(osRelease('rhel')), 'redhat');
  assert.equal(ssh.detectOsIcon(osRelease('arch')), 'archlinux');
  assert.equal(ssh.detectOsIcon(osRelease('alpine')), 'alpinelinux');
});

test('detectOsIcon falls back to ID_LIKE for derivative distros', () => {
  assert.equal(ssh.detectOsIcon(osRelease('linuxmint', 'ubuntu debian')), 'ubuntu');
  assert.equal(ssh.detectOsIcon(osRelease('pop', 'ubuntu debian')), 'ubuntu');
});

test('detectOsIcon recognizes a Raspberry Pi device-tree marker regardless of distro', () => {
  const probe = `${osRelease('debian')}RASPBERRY_PI_MODEL\nLinux\n`;
  assert.equal(ssh.detectOsIcon(probe), 'raspberrypi');
});

test('detectOsIcon falls back to uname when there is no os-release', () => {
  assert.equal(ssh.detectOsIcon('Darwin\n'), 'apple');
  assert.equal(ssh.detectOsIcon('FreeBSD\n'), 'freebsd');
  assert.equal(ssh.detectOsIcon('Linux\n'), 'linux');
});

test('detectOsIcon returns null when nothing is recognizable', () => {
  assert.equal(ssh.detectOsIcon(''), null);
  assert.equal(ssh.detectOsIcon('bash: os-release: command not found\n'), null);
});
