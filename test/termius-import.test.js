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
