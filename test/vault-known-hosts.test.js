const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const vault = require('../src/main/vault');

test('lists, updates, and forgets known host keys', (t) => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sshclient-known-hosts-'));
  t.after(() => {
    vault.shutdown();
    fs.rmSync(dataDir, { recursive: true, force: true });
  });

  vault.init(dataDir);
  vault.trustHostKey('example.com', 22, 'first-fingerprint');

  assert.deepEqual(vault.listKnownHosts(), [
    {
      host: 'example.com',
      port: 22,
      fingerprint: 'first-fingerprint',
      firstSeen: vault.listKnownHosts()[0].firstSeen,
    },
  ]);

  vault.trustHostKey('example.com', 22, 'replacement-fingerprint');
  assert.equal(vault.getKnownHostKey('example.com', 22), 'replacement-fingerprint');

  assert.deepEqual(vault.deleteKnownHost('example.com', 22), []);
  assert.equal(vault.getKnownHostKey('example.com', 22), null);
});

test('encrypts snippet and session history records in the vault', (t) => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sshclient-vault-data-'));
  t.after(() => {
    vault.shutdown();
    fs.rmSync(dataDir, { recursive: true, force: true });
  });

  vault.init(dataDir);
  vault.setup('demo-password');

  const snippets = vault.saveSnippet({ name: 'List files', command: 'ls -la' });
  assert.equal(snippets[0].name, 'List files');
  assert.equal(snippets[0].command, 'ls -la');
  assert.deepEqual(vault.deleteSnippet(snippets[0].id), []);

  const recordingId = vault.saveSessionHistory({
    host: 'example.com',
    username: 'demo',
    startedAt: 1000,
    duration: 250,
    frames: [{ at: 0, data: 'hello\r\n' }],
  });
  const history = vault.listSessionHistory();
  assert.equal(history[0].id, recordingId);
  assert.deepEqual(history[0].frames, [{ at: 0, data: 'hello\r\n' }]);
  assert.deepEqual(vault.deleteSessionHistory(recordingId), []);
});
