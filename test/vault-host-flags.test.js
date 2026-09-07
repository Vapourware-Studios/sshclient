const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const vault = require('../src/main/vault');

function openVault(t) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sshclient-host-flags-'));
  t.after(() => {
    vault.shutdown();
    fs.rmSync(dataDir, { recursive: true, force: true });
  });
  vault.init(dataDir);
  vault.setup('demo-password');
}

const HOST = {
  label: 'demo',
  host: 'example.com',
  port: 22,
  username: 'demo',
  password: 'demo-password',
};

test('saved hosts keep their flags', (t) => {
  openVault(t);

  vault.saveHost({ ...HOST, flags: 'ServerAliveInterval=30 Compression=yes' });
  const [saved] = vault.listHosts();
  assert.equal(saved.flags, 'ServerAliveInterval=30 Compression=yes');

  // Editing an unrelated field must not drop them.
  vault.saveHost({ ...HOST, id: saved.id, label: 'renamed' });
  const [edited] = vault.listHosts();
  assert.equal(edited.label, 'renamed');
  assert.equal(edited.flags, 'ServerAliveInterval=30 Compression=yes');

  // And clearing them is allowed.
  vault.saveHost({ ...HOST, id: saved.id, flags: '' });
  assert.equal(vault.listHosts()[0].flags, '');
});

test('a host with flags the connection would reject cannot be saved', (t) => {
  openVault(t);

  for (const [flags, message] of [
    ['StrictHostKeyChecking=no', /Unsupported flag/],
    ['ServerAliveInterval=abc', /whole number/],
    ['host=other.example', /comes from the saved host/],
    ['nonsense', /Invalid flag format/],
  ]) {
    assert.throws(() => vault.saveHost({ ...HOST, flags }), message, flags);
  }

  assert.deepEqual(vault.listHosts(), []);
});
