const assert = require('node:assert/strict');
const test = require('node:test');
const nacl = require('tweetnacl');
const {
  decodeEnvelope,
  decodeIdbKey,
  buildDbNameMap,
  decryptBlob,
  extractRecord,
  indexRecords,
  buildKeys,
  buildIdentityBySshConfigId,
  buildConnections,
  buildSnippets,
  collectRecords,
  decryptedFieldCount,
} = require('../src/main/termiusImport');

function pushVarint(v, out) {
  v = BigInt(v);
  for (;;) {
    let b = Number(v & 0x7fn);
    v >>= 7n;
    if (v !== 0n) b |= 0x80;
    out.push(b);
    if (v === 0n) break;
  }
}

function pushStr(s, out) {
  out.push(0x22);
  pushVarint(s.length, out);
  for (let i = 0; i < s.length; i++) out.push(s.charCodeAt(i));
}

function pushInt(value, out) {
  out.push(0x49);
  const zigzag = (BigInt(value) << 1n) ^ (BigInt(value) >> 63n);
  pushVarint(zigzag, out);
}

function pushKeyInt(key, value, out) {
  pushStr(key, out);
  pushInt(value, out);
}

function pushKeyStr(key, value, out) {
  pushStr(key, out);
  pushStr(value, out);
}

function pushKeyNull(key, out) {
  pushStr(key, out);
  out.push(0x30);
}

function pushKeyObjId(key, id, out) {
  pushStr(key, out);
  out.push(0x6f);
  pushKeyInt('id', id, out);
  out.push(0x7b);
  pushVarint(1, out);
}

function closeObj(props, out) {
  out.push(0x7b);
  pushVarint(props, out);
}

test('decodeEnvelope decodes a flat object', () => {
  const bytes = [0x6f];
  pushKeyInt('id', 7347589, bytes);
  pushKeyStr('updated_at', '2026-04-08T16:37:59', bytes);
  pushKeyStr('status', 'SYNCHRONIZED', bytes);
  closeObj(3, bytes);

  const obj = decodeEnvelope(Buffer.from(bytes));
  assert.equal(obj.id, 7347589);
  assert.equal(obj.updated_at, '2026-04-08T16:37:59');
  assert.equal(obj.status, 'SYNCHRONIZED');
});

test('decodeEnvelope decodes nested objects as foreign keys', () => {
  const bytes = [0x6f];
  pushKeyInt('id', 45716684, bytes);
  pushKeyObjId('ssh_config', 45672876, bytes);
  pushKeyNull('group', bytes);
  closeObj(3, bytes);

  const obj = decodeEnvelope(Buffer.from(bytes));
  assert.equal(obj.id, 45716684);
  assert.equal(obj.ssh_config.id, 45672876);
  assert.equal(obj.group, null);
});

test('extractRecord separates foreign keys from plaintext', () => {
  const bytes = [0x6f];
  pushKeyInt('id', 45716684, bytes);
  pushKeyStr('updated_at', '2026-05-25T10:07:45', bytes);
  pushKeyStr('status', 'SYNCHRONIZED', bytes);
  pushKeyObjId('ssh_config', 45672876, bytes);
  pushKeyNull('group', bytes);
  pushKeyStr('backspace', 'default', bytes);
  pushKeyInt('local_id', 16, bytes);
  closeObj(7, bytes);

  const envelope = decodeEnvelope(Buffer.from(bytes));
  const masterKey = Buffer.alloc(32);
  const rec = extractRecord(envelope, masterKey);

  assert.equal(rec.termiusId, 45716684);
  assert.equal(rec.status, 'SYNCHRONIZED');
  assert.equal(rec.foreignKeys.ssh_config, 45672876);
  assert.equal(rec.body.backspace, 'default');
  assert.equal(rec.body.group, null);
});

test('decryptBlob round-trips an XSalsa20-Poly1305 blob', () => {
  const masterKey = nacl.randomBytes(32);
  const nonce = nacl.randomBytes(24);
  const plaintext = Buffer.from('super secret password');
  const sealed = nacl.secretbox(new Uint8Array(plaintext), nonce, masterKey);

  const versionByte = Buffer.from([0x04, 0x00]);
  const blob = Buffer.concat([versionByte, Buffer.from(nonce), Buffer.from(sealed)]);
  const b64 = blob.toString('base64');

  assert.equal(decryptBlob(masterKey, b64), plaintext.toString('utf8'));
});

test('decryptBlob rejects a bad version tag', () => {
  const masterKey = nacl.randomBytes(32);
  const bogus = Buffer.concat([Buffer.from([0x01, 0x00]), Buffer.alloc(40)]);
  assert.equal(decryptBlob(masterKey, bogus.toString('base64')), null);
});

function record(dbName, termiusId, decrypted, foreignKeys = {}) {
  return { dbName, termiusId, foreignKeys, decrypted };
}

test('buildConnections resolves password auth via ssh_config_identities', () => {
  const records = [
    record('hosts', 1, { address: 'example.com', label: 'Example' }, { ssh_config: 10 }),
    record('settings', 10, { port: 2222 }),
    record('ssh_identities', 20, { username: 'root', password: 'hunter2', is_visible: true }),
    record('ssh_config_identities', 30, {}, { ssh_config: 10, identity: 20 }),
  ];

  const idx = indexRecords(records);
  const { keys, keyLocalIdByTermiusId } = buildKeys(idx);
  const identityBySshConfigId = buildIdentityBySshConfigId(idx);
  const connections = buildConnections(idx, keyLocalIdByTermiusId, identityBySshConfigId);

  assert.equal(keys.length, 0);
  assert.equal(connections.length, 1);
  const conn = connections[0];
  assert.equal(conn.name, 'Example');
  assert.equal(conn.host, 'example.com');
  assert.equal(conn.port, 2222);
  assert.equal(conn.username, 'root');
  assert.equal(conn.authType, 'password');
  assert.equal(conn.password, 'hunter2');
  assert.equal(conn.valid, true);
});

test('buildConnections resolves key auth and links the imported key', () => {
  const records = [
    record('hosts', 1, { address: 'example.com', label: 'Example' }, { ssh_config: 10 }),
    record('settings', 10, { port: 22 }),
    record('keys', 40, { label: 'my key', private_key: 'PRIVATE', public_key: 'PUBLIC', username: 'deploy' }),
    record('ssh_identities', 20, { is_visible: false }, { ssh_key: 40 }),
    record('ssh_config_identities', 30, {}, { ssh_config: 10, identity: 20 }),
  ];

  const idx = indexRecords(records);
  const { keys, keyLocalIdByTermiusId } = buildKeys(idx);
  const identityBySshConfigId = buildIdentityBySshConfigId(idx);
  const connections = buildConnections(idx, keyLocalIdByTermiusId, identityBySshConfigId);

  assert.equal(keys.length, 1);
  assert.equal(keys[0].private, 'PRIVATE');
  const conn = connections[0];
  assert.equal(conn.authType, 'key');
  assert.equal(conn.username, 'deploy');
  assert.equal(conn.keyLocalId, keys[0].localId);
  assert.equal(conn.valid, true);
});

test('buildConnections marks hosts without resolvable credentials invalid', () => {
  const records = [record('hosts', 1, { address: 'example.com', label: 'Example' })];
  const idx = indexRecords(records);
  const { keyLocalIdByTermiusId } = buildKeys(idx);
  const identityBySshConfigId = buildIdentityBySshConfigId(idx);
  const connections = buildConnections(idx, keyLocalIdByTermiusId, identityBySshConfigId);

  assert.equal(connections[0].valid, false);
});

test('buildSnippets extracts command text and maps target host ids', () => {
  const records = [
    record('snippets', 100, { label: 'Restart nginx', script: 'sudo systemctl restart nginx' }),
    record('hosts', 1, { address: 'a.example.com' }),
    record('hosts', 2, { address: 'b.example.com' }),
    record('host_snippets', 200, {}, { host: 1, snippet: 100 }),
    record('host_snippets', 201, {}, { host: 2, snippet: 100 }),
  ];

  const idx = indexRecords(records);
  const snippets = buildSnippets(idx);

  assert.equal(snippets.length, 1);
  assert.equal(snippets[0].name, 'Restart nginx');
  assert.equal(snippets[0].command, 'sudo systemctl restart nginx');
  assert.deepEqual(snippets[0].termiusHostIds.sort(), [1, 2]);
});

test('buildSnippets skips snippets with no script content', () => {
  const records = [record('snippets', 100, { label: 'Empty' })];
  const idx = indexRecords(records);
  assert.equal(buildSnippets(idx).length, 0);
});

const fs = require('node:fs');
const os = require('node:os');
const nodePath = require('node:path');
const {
  rankLeveldbName,
  termiusDbCandidates,
  windowsCredTargets,
} = require('../src/main/termiusImport');

function withPlatform(platform, fn) {
  const original = Object.getOwnPropertyDescriptor(process, 'platform');
  Object.defineProperty(process, 'platform', { value: platform, configurable: true });
  try {
    return fn();
  } finally {
    Object.defineProperty(process, 'platform', original);
  }
}

test('rankLeveldbName prefers the file:// origin store', () => {
  const names = [
    'https_termius.com_0.indexeddb.leveldb',
    'chrome-extension_x_0.indexeddb.leveldb',
    'file__0.indexeddb.leveldb',
    'file__1.indexeddb.leveldb',
  ];
  const sorted = [...names].sort((a, b) => rankLeveldbName(a) - rankLeveldbName(b));
  assert.equal(sorted[0], 'file__0.indexeddb.leveldb');
  assert.equal(sorted[1], 'file__1.indexeddb.leveldb');
  assert.equal(sorted[3], 'chrome-extension_x_0.indexeddb.leveldb');
});

test('termiusDbCandidates finds stores under an XDG config dir and skips empty ones', () => {
  const root = fs.mkdtempSync(nodePath.join(os.tmpdir(), 'sshclient-termius-test-'));
  const idb = nodePath.join(root, 'Termius', 'IndexedDB');
  const real = nodePath.join(idb, 'file__0.indexeddb.leveldb');
  const empty = nodePath.join(idb, 'https_termius.com_0.indexeddb.leveldb');
  fs.mkdirSync(real, { recursive: true });
  fs.mkdirSync(empty, { recursive: true });
  fs.writeFileSync(nodePath.join(real, '000003.log'), '');

  const previous = process.env.XDG_CONFIG_HOME;
  process.env.XDG_CONFIG_HOME = root;
  try {
    const found = withPlatform('linux', () => termiusDbCandidates());
    assert.deepEqual(found, [real]);
  } finally {
    if (previous === undefined) delete process.env.XDG_CONFIG_HOME;
    else process.env.XDG_CONFIG_HOME = previous;
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('windowsCredTargets covers both keytar service names', () => {
  const targets = withPlatform('win32', () => windowsCredTargets());
  assert.ok(targets.includes('Termius/localKey'));
  assert.ok(targets.includes('termius-app/localKey'));
  assert.equal(new Set(targets).size, targets.length);
});

test('a stale credential under one service name does not mask the live key', () => {
  const { looksLikeMasterKey } = require('../src/main/termiusImport');
  const key = Buffer.alloc(32, 7).toString('base64');
  const stale = Buffer.from('not-a-key').toString('base64');

  assert.equal(looksLikeMasterKey(key), true);
  assert.equal(looksLikeMasterKey(stale), false);
  assert.equal(looksLikeMasterKey(''), false);
  assert.equal(looksLikeMasterKey(null), false);
  assert.equal(looksLikeMasterKey(undefined), false);
  // Whitespace around the value is how the shell tools hand it back.
  assert.equal(looksLikeMasterKey(`  ${key}\n`), true);
});

// An IndexedDB row key: 0x00, then db / object-store / index ids.
function idbKey(dbId) {
  return Buffer.from([0x00, dbId, 0x01, 0x01]);
}

function sealed(masterKey, plaintext) {
  const nonce = nacl.randomBytes(24);
  const box = nacl.secretbox(new Uint8Array(Buffer.from(plaintext)), nonce, masterKey);
  return Buffer.concat([Buffer.from([0x04, 0x00]), Buffer.from(nonce), Buffer.from(box)]).toString(
    'base64'
  );
}

test('a stale key of the right length still yields nothing, so the live one is reached', () => {
  const live = nacl.randomBytes(32);
  const stale = nacl.randomBytes(32);
  // Both are real keys as far as any shape check goes.
  assert.equal(live.length, stale.length);

  const bytes = [0x6f];
  pushKeyInt('id', 4242, bytes);
  pushKeyStr('status', 'SYNCHRONIZED', bytes);
  pushKeyStr('label', sealed(live, 'web-01'), bytes);
  closeObj(3, bytes);

  const entries = [[idbKey(1), Buffer.from(bytes)]];
  const dbNames = new Map([[1, 'host']]);

  // The wrong key does not fail loudly: the record still comes back, because
  // its id and status were never encrypted. Only the encrypted field is gone —
  // so record count says nothing and the decrypted-field count says everything.
  const withStale = collectRecords(entries, dbNames, Buffer.from(stale));
  assert.equal(withStale.length, 1, 'the record survives the wrong key');
  assert.equal(decryptedFieldCount(withStale), 0, 'but nothing was opened');

  const found = collectRecords(entries, dbNames, Buffer.from(live));
  assert.equal(decryptedFieldCount(found), 1);
  assert.equal(found.length, 1);
  assert.equal(found[0].dbName, 'host');
  assert.equal(found[0].termiusId, 4242);
  assert.equal(found[0].decrypted.label, 'web-01');
});
