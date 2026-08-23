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

test('the current service name is tried ahead of the legacy one', () => {
  // Every key found is tried against every database, so this order decides
  // nothing until two keys open a database equally well and no other signal
  // separates them. The first key found wins that tie, so the name current
  // Termius writes has to come before the one only older versions wrote.
  const targets = withPlatform('win32', () => windowsCredTargets());
  assert.ok(
    targets.indexOf('termius-app/localKey') < targets.indexOf('Termius/localKey'),
    'a stale key under the legacy name cannot win a tie against the current one'
  );
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

const {
  findTermiusDbDirs,
  isBetterAttempt,
  dbLastWritten,
  recordSignals,
} = require('../src/main/termiusImport');

test('findTermiusDbDirs returns every candidate, not just the first', () => {
  const root = fs.mkdtempSync(nodePath.join(os.tmpdir(), 'sshclient-termius-test-'));
  const home = nodePath.join(root, 'home');
  const xdg = nodePath.join(root, 'xdg');

  // A plain install left behind, and a Snap that replaced it.
  const stale = nodePath.join(xdg, 'Termius', 'IndexedDB', 'file__0.indexeddb.leveldb');
  const snap = nodePath.join(
    home,
    'snap',
    'termius-app',
    'current',
    '.config',
    'Termius',
    'IndexedDB',
    'file__0.indexeddb.leveldb'
  );
  for (const dir of [stale, snap]) {
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(nodePath.join(dir, '000003.log'), '');
  }

  const previousXdg = process.env.XDG_CONFIG_HOME;
  const previousHome = process.env.HOME;
  process.env.XDG_CONFIG_HOME = xdg;
  process.env.HOME = home;
  try {
    const found = withPlatform('linux', () => findTermiusDbDirs());
    assert.ok(found.includes(stale), 'the plain install is offered');
    assert.ok(found.includes(snap), 'and so is the Snap that replaced it');
  } finally {
    if (previousXdg === undefined) delete process.env.XDG_CONFIG_HOME;
    else process.env.XDG_CONFIG_HOME = previousXdg;
    if (previousHome === undefined) delete process.env.HOME;
    else process.env.HOME = previousHome;
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('findTermiusDbDirs throws when no database exists', () => {
  const root = fs.mkdtempSync(nodePath.join(os.tmpdir(), 'sshclient-termius-test-'));
  const previousXdg = process.env.XDG_CONFIG_HOME;
  const previousHome = process.env.HOME;
  process.env.XDG_CONFIG_HOME = nodePath.join(root, 'xdg');
  process.env.HOME = nodePath.join(root, 'home');
  try {
    assert.throws(
      () => withPlatform('linux', () => findTermiusDbDirs()),
      /Termius database not found/
    );
  } finally {
    if (previousXdg === undefined) delete process.env.XDG_CONFIG_HOME;
    else process.env.XDG_CONFIG_HOME = previousXdg;
    if (previousHome === undefined) delete process.env.HOME;
    else process.env.HOME = previousHome;
    fs.rmSync(root, { recursive: true, force: true });
  }
});

// Two keys tried against the same database share both of its age signals.
const SAME_DB = { recordTime: 5000, highestId: 500, lastWritten: 1000 };

test('within one database, the key that opens the most wins', () => {
  const staleKey = { score: 1, records: [{}, {}, {}, {}], ...SAME_DB };
  const liveKey = { score: 12, records: [{}, {}], ...SAME_DB };

  // First-that-works would have kept the stale key on its one legacy field.
  assert.equal(isBetterAttempt(null, staleKey), true);
  assert.equal(isBetterAttempt(staleKey, liveKey), true);
  assert.equal(isBetterAttempt(liveKey, staleKey), false);
});

test('within one database, an exact tie falls to the fuller result', () => {
  const fewer = { score: 4, records: [{}, {}], ...SAME_DB };
  const more = { score: 4, records: [{}, {}, {}], ...SAME_DB };

  assert.equal(isBetterAttempt(fewer, more), true);
  assert.equal(isBetterAttempt(more, fewer), false);
});

test('the newer database wins, however much the stale one holds', () => {
  // The abandoned install still holds every host the account has since deleted,
  // so it decrypts more of everything. Volume is not the question being asked.
  const stale = { score: 90, records: new Array(30).fill({}), recordTime: 1000, highestId: 900, lastWritten: 1000 };
  const current = { score: 6, records: [{}, {}], recordTime: 2000, highestId: 10, lastWritten: 2000 };

  assert.equal(isBetterAttempt(stale, current), true, 'the newer install wins');
  assert.equal(isBetterAttempt(current, stale), false, 'and does not lose on volume');
});

test('a database restored after the live one does not win on its fresh file times', () => {
  // Copying a backup back onto the machine stamps every file with today's date
  // while the records inside still stop at the day the account left it.
  const restoredStale = { score: 90, records: new Array(30).fill({}), recordTime: 1000, highestId: 900, lastWritten: 9_000_000 };
  const current = { score: 6, records: [{}, {}], recordTime: 2000, highestId: 10, lastWritten: 2000 };

  assert.equal(isBetterAttempt(restoredStale, current), true, 'the records outrank the file times');
  assert.equal(isBetterAttempt(current, restoredStale), false);
});

test('a fuller copy beats a fresher file time once the records agree', () => {
  // Same account state by both record signals, so what is left is which copy
  // actually opens. A restore that only touched the file times cannot buy it.
  const restoredButThinner = {
    score: 4,
    records: [{}, {}],
    recordTime: 7000,
    highestId: 7,
    lastWritten: 9_000_000,
  };
  const fuller = { score: 9, records: [{}, {}], recordTime: 7000, highestId: 7, lastWritten: 1000 };

  assert.equal(isBetterAttempt(restoredButThinner, fuller), true);
  assert.equal(isBetterAttempt(fuller, restoredButThinner), false);
});

test('file times settle only what nothing else can', () => {
  // Same age, same reach, same amount opened: no wrong answer is available.
  const older = { score: 4, records: [{}, {}], recordTime: 7000, highestId: 7, lastWritten: 1000 };
  const newer = { score: 4, records: [{}, {}], recordTime: 7000, highestId: 7, lastWritten: 2000 };

  assert.equal(isBetterAttempt(older, newer), true);
  assert.equal(isBetterAttempt(newer, older), false);
});

test('a newer database that no key opens never displaces one that opened', () => {
  const opened = { score: 3, records: [{}, {}], recordTime: 1000, highestId: 10, lastWritten: 1000 };
  const newerButShut = {
    score: 0,
    records: new Array(50).fill({}),
    recordTime: 9000,
    highestId: 9000,
    lastWritten: 9000,
  };

  assert.equal(isBetterAttempt(opened, newerButShut), false);
  assert.equal(isBetterAttempt(newerButShut, opened), true);
});

test('dbLastWritten takes the newest leveldb file and ignores the rest', () => {
  const dir = fs.mkdtempSync(nodePath.join(os.tmpdir(), 'sshclient-termius-test-'));
  try {
    const old = nodePath.join(dir, '000001.ldb');
    const recent = nodePath.join(dir, '000002.log');
    const decoy = nodePath.join(dir, 'LOCK');
    for (const f of [old, recent, decoy]) fs.writeFileSync(f, '');

    fs.utimesSync(old, new Date(1_000_000), new Date(1_000_000));
    fs.utimesSync(recent, new Date(2_000_000), new Date(2_000_000));
    // Newer than either, but not a leveldb file, so it must not count.
    fs.utimesSync(decoy, new Date(9_000_000), new Date(9_000_000));

    assert.equal(dbLastWritten(dir), 2_000_000);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('dbLastWritten reports nothing for a directory it cannot read', () => {
  assert.equal(dbLastWritten(nodePath.join(os.tmpdir(), 'sshclient-no-such-dir-xyz')), 0);
});

function stampedRecord(id, updatedAt, status = 'SYNCHRONIZED') {
  const bytes = [0x6f];
  pushKeyInt('id', id, bytes);
  pushKeyStr('status', status, bytes);
  if (updatedAt !== undefined) pushKeyStr('updated_at', updatedAt, bytes);
  closeObj(updatedAt === undefined ? 2 : 3, bytes);
  return [idbKey(1), Buffer.from(bytes)];
}

test('recordSignals takes the latest stamp and the highest id, needing no key', () => {
  const entries = [
    stampedRecord(1, '2026-04-08T16:37:59Z'),
    stampedRecord(4242, '2026-05-25T10:07:45Z'),
    stampedRecord(300, '2026-01-02T03:04:05Z'),
  ];

  assert.deepEqual(recordSignals(entries), {
    recordTime: Date.parse('2026-05-25T10:07:45Z'),
    highestId: 4242,
  });
});

test('recordSignals still reports an id when no record carries a stamp', () => {
  // The id is what keeps a restored copy from winning on file times alone once
  // a schema change has taken updated_at away.
  assert.deepEqual(recordSignals([stampedRecord(77)]), { recordTime: 0, highestId: 77 });
  assert.deepEqual(recordSignals([]), { recordTime: 0, highestId: 0 });
});

test('recordSignals ignores a stamp it cannot read', () => {
  assert.deepEqual(recordSignals([stampedRecord(9, 'not-a-date')]), {
    recordTime: 0,
    highestId: 9,
  });
});

test('deleting a host keeps the live database ahead of a restored copy', () => {
  // The case where a stale copy would otherwise look richer than the live one:
  // the host it still holds was deleted here, so this database has fewer
  // records to open and would lose on volume alone.
  //
  // Termius does not drop a deleted record, it marks it — and recordSignals
  // reads every record in the clear, tombstones included. So the deletion is
  // itself the newest thing either database has to show, and the live database
  // wins on the first signal asked, long before the file times a restore reset.
  const live = [
    stampedRecord(1, '2026-04-08T16:37:59Z'),
    stampedRecord(2, '2026-05-25T10:07:45Z', 'deleted'),
  ];
  const restoredCopy = [
    stampedRecord(1, '2026-04-08T16:37:59Z'),
    stampedRecord(2, '2026-04-08T16:38:10Z'),
  ];

  const liveSignals = recordSignals(live);
  const staleSignals = recordSignals(restoredCopy);
  assert.ok(liveSignals.recordTime > staleSignals.recordTime, 'the deletion is the newer stamp');

  // The stale copy still opens the host that was deleted here, and was restored
  // today, so it wins on both of the signals that come after age.
  const liveAttempt = { ...liveSignals, score: 4, records: [{}], lastWritten: 1000 };
  const staleAttempt = { ...staleSignals, score: 8, records: [{}, {}], lastWritten: 9_000_000 };

  assert.equal(isBetterAttempt(staleAttempt, liveAttempt), true, 'age is asked first, and settles it');
  assert.equal(isBetterAttempt(liveAttempt, staleAttempt), false);
});

test('the database that synced furthest wins when no stamps survive', () => {
  // Both restored today, so file times say the stale one is newest; only the
  // ids still record which account data went on growing.
  const restoredStale = {
    score: 40,
    records: new Array(20).fill({}),
    recordTime: 0,
    highestId: 120,
    lastWritten: 9_000_000,
  };
  const current = {
    score: 8,
    records: [{}, {}],
    recordTime: 0,
    highestId: 8800,
    lastWritten: 1000,
  };

  assert.equal(isBetterAttempt(restoredStale, current), true);
  assert.equal(isBetterAttempt(current, restoredStale), false);
});
