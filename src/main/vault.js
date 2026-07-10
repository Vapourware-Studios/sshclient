const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { DatabaseSync } = require('node:sqlite');

const SCRYPT_KEYLEN = 32;
const SCRYPT_PARAMS = { N: 2 ** 17, r: 8, p: 1, maxmem: 256 * 1024 * 1024 };
const GCM_IV_LEN = 12;
const SECRET_FIELDS = ['password', 'passphrase'];

let db = null;
let derivedKey = null;

function init(userDataDir) {
  db = new DatabaseSync(path.join(userDataDir, 'vault.sqlite'));
  db.exec('PRAGMA journal_mode = WAL');
  db.exec(`
    CREATE TABLE IF NOT EXISTS vault_meta (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS known_hosts (
      host TEXT NOT NULL,
      port INTEGER NOT NULL,
      fingerprint TEXT NOT NULL,
      first_seen INTEGER NOT NULL,
      PRIMARY KEY (host, port)
    );
  `);

  const columns = db.prepare("PRAGMA table_info('hosts')").all().map((c) => c.name);
  if (columns.length > 0 && !columns.includes('data_ciphertext')) {
    db.exec('ALTER TABLE hosts RENAME TO hosts_legacy');
  }

  db.exec(`
    CREATE TABLE IF NOT EXISTS hosts (
      id TEXT PRIMARY KEY,
      data_iv TEXT NOT NULL,
      data_auth_tag TEXT NOT NULL,
      data_ciphertext TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS keys (
      id TEXT PRIMARY KEY,
      data_iv TEXT NOT NULL,
      data_auth_tag TEXT NOT NULL,
      data_ciphertext TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );
  `);
}

function migrateLegacyHosts() {
  const legacyTable = db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'hosts_legacy'")
    .get();
  if (!legacyTable) return;

  const rows = db.prepare('SELECT * FROM hosts_legacy').all();
  for (const row of rows) {
    let secret = {};
    if (row.secret_ciphertext) {
      try {
        secret = decryptJSON(derivedKey, {
          iv: row.secret_iv,
          authTag: row.secret_auth_tag,
          ciphertext: row.secret_ciphertext,
        });
      } catch {
        secret = {};
      }
    }

    const payload = {
      label: row.label || '',
      host: row.host,
      port: row.port,
      username: row.username,
      privateKeyPath: row.private_key_path || undefined,
    };
    if (secret.password) payload.password = secret.password;
    if (secret.passphrase) payload.passphrase = secret.passphrase;

    const enc = encryptJSON(derivedKey, payload);
    db.prepare(
      `INSERT INTO hosts (id, data_iv, data_auth_tag, data_ciphertext, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO NOTHING`
    ).run(row.id, enc.iv, enc.authTag, enc.ciphertext, row.created_at, row.updated_at);
  }

  db.exec('DROP TABLE hosts_legacy');
}

function shutdown() {
  lock();
  db?.close();
  db = null;
}

function getMeta(key) {
  const row = db.prepare('SELECT value FROM vault_meta WHERE key = ?').get(key);
  return row ? row.value : null;
}

function setMeta(key, value) {
  db.prepare(
    `INSERT INTO vault_meta (key, value) VALUES (?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`
  ).run(key, value);
}

function exists() {
  return db !== null && getMeta('salt') !== null;
}

function isUnlocked() {
  return derivedKey !== null;
}

function lock() {
  if (derivedKey) derivedKey.fill(0);
  derivedKey = null;
}

function requireUnlocked() {
  if (!derivedKey) throw new Error('Vault is locked');
}

function deriveKey(password, salt) {
  return crypto.scryptSync(password, salt, SCRYPT_KEYLEN, SCRYPT_PARAMS);
}

function encryptJSON(key, obj) {
  const iv = crypto.randomBytes(GCM_IV_LEN);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const plaintext = Buffer.from(JSON.stringify(obj), 'utf8');
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return {
    iv: iv.toString('base64'),
    authTag: authTag.toString('base64'),
    ciphertext: ciphertext.toString('base64'),
  };
}

function decryptJSON(key, record) {
  const iv = Buffer.from(record.iv, 'base64');
  const authTag = Buffer.from(record.authTag, 'base64');
  const ciphertext = Buffer.from(record.ciphertext, 'base64');
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(authTag);
  const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  return JSON.parse(plaintext.toString('utf8'));
}

function setup(masterPassword) {
  if (!masterPassword || masterPassword.length < 8) {
    throw new Error('Master password must be at least 8 characters');
  }
  if (exists()) throw new Error('Vault already exists');

  const salt = crypto.randomBytes(16);
  const key = deriveKey(masterPassword, salt);
  const verifier = encryptJSON(key, { check: 'vault-ok' });

  setMeta('salt', salt.toString('base64'));
  setMeta('verifier', JSON.stringify(verifier));
  derivedKey = key;
}

function unlock(masterPassword) {
  if (!exists()) throw new Error('Vault not set up');

  const salt = Buffer.from(getMeta('salt'), 'base64');
  const key = deriveKey(masterPassword, salt);
  const verifier = JSON.parse(getMeta('verifier'));

  try {
    decryptJSON(key, verifier);
  } catch {
    throw new Error('Incorrect password');
  }

  derivedKey = key;
  migrateLegacyHosts();
}

function decryptHostData(row) {
  return decryptJSON(derivedKey, {
    iv: row.data_iv,
    authTag: row.data_auth_tag,
    ciphertext: row.data_ciphertext,
  });
}

function listHosts() {
  requireUnlocked();
  const rows = db.prepare('SELECT * FROM hosts ORDER BY created_at ASC').all();
  return rows.map((row) => {
    const data = decryptHostData(row);
    return {
      id: row.id,
      label: data.label || '',
      host: data.host,
      port: data.port,
      username: data.username,
      privateKeyPath: data.privateKeyPath || undefined,
      keyId: data.keyId || undefined,
      hasPassword: Boolean(data.password),
      hasPassphrase: Boolean(data.passphrase),
      hasPrivateKey: Boolean(data.privateKeyPath),
    };
  });
}

function getHostSecret(id) {
  requireUnlocked();
  const row = db.prepare('SELECT * FROM hosts WHERE id = ?').get(id);
  if (!row) return null;
  return { id: row.id, ...decryptHostData(row) };
}

function withPreservedSecrets(host) {
  const copy = { ...host };
  for (const field of SECRET_FIELDS) {
    if (!copy[field]) delete copy[field];
  }
  return copy;
}

function validateHost(host) {
  const errors = [];

  if (!String(host.host || '').trim()) errors.push('Host is required');
  if (!String(host.username || '').trim()) errors.push('Username is required');

  const port = Number(host.port);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    errors.push('Port must be an integer between 1 and 65535');
  }

  if (host.privateKeyPath && !fs.existsSync(host.privateKeyPath)) {
    errors.push('Private key file does not exist');
  }

  if (!host.password && !host.privateKeyPath && !host.keyId) {
    errors.push('A password, a private key, or a Keychain key is required');
  }

  return errors;
}

function saveHost(host) {
  requireUnlocked();
  if (!host) throw new Error('Host data is required');

  const existingRow = host.id
    ? db.prepare('SELECT * FROM hosts WHERE id = ?').get(host.id)
    : null;
  const existing = existingRow ? decryptHostData(existingRow) : {};

  const incoming = withPreservedSecrets(host);
  const merged = { ...existing, ...incoming };

  const errors = validateHost(merged);
  if (errors.length > 0) throw new Error(errors.join('; '));

  const id = existingRow ? existingRow.id : crypto.randomUUID();
  const now = Date.now();

  const payload = {
    label: merged.label || '',
    host: merged.host,
    port: Number(merged.port) || 22,
    username: merged.username,
    privateKeyPath: merged.privateKeyPath || undefined,
    keyId: merged.keyId || undefined,
  };
  if (merged.password) payload.password = merged.password;
  if (merged.passphrase) payload.passphrase = merged.passphrase;

  const enc = encryptJSON(derivedKey, payload);

  db.prepare(
    `INSERT INTO hosts (id, data_iv, data_auth_tag, data_ciphertext, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       data_iv = excluded.data_iv,
       data_auth_tag = excluded.data_auth_tag,
       data_ciphertext = excluded.data_ciphertext,
       updated_at = excluded.updated_at`
  ).run(id, enc.iv, enc.authTag, enc.ciphertext, existingRow ? existingRow.created_at : now, now);

  return listHosts();
}

function deleteHost(id) {
  requireUnlocked();
  db.prepare('DELETE FROM hosts WHERE id = ?').run(id);
  return listHosts();
}

function decryptKeyData(row) {
  return decryptJSON(derivedKey, {
    iv: row.data_iv,
    authTag: row.data_auth_tag,
    ciphertext: row.data_ciphertext,
  });
}

// SSH keys generated in-app. The private key never leaves the vault
// unencrypted except when handed to ssh2 for a connection.
function listKeys() {
  requireUnlocked();
  const rows = db.prepare('SELECT * FROM keys ORDER BY created_at ASC').all();
  return rows.map((row) => {
    const data = decryptKeyData(row);
    return {
      id: row.id,
      name: data.name,
      type: data.type,
      bits: data.bits,
      public: data.public,
      fingerprint: data.fingerprint,
      createdAt: row.created_at,
    };
  });
}

function saveKey(key) {
  requireUnlocked();
  if (!key?.name || !key?.private || !key?.public) {
    throw new Error('Key name and material are required');
  }

  const enc = encryptJSON(derivedKey, {
    name: key.name,
    type: key.type,
    bits: key.bits,
    private: key.private,
    public: key.public,
    passphrase: key.passphrase || undefined,
    fingerprint: key.fingerprint,
  });

  db.prepare(
    `INSERT INTO keys (id, data_iv, data_auth_tag, data_ciphertext, created_at)
     VALUES (?, ?, ?, ?, ?)`
  ).run(crypto.randomUUID(), enc.iv, enc.authTag, enc.ciphertext, Date.now());

  return listKeys();
}

function getKeySecret(id) {
  requireUnlocked();
  const row = db.prepare('SELECT * FROM keys WHERE id = ?').get(id);
  if (!row) return null;
  return { id: row.id, ...decryptKeyData(row) };
}

function deleteKey(id) {
  requireUnlocked();
  db.prepare('DELETE FROM keys WHERE id = ?').run(id);
  return listKeys();
}

function getKnownHostKey(host, port) {
  const row = db
    .prepare('SELECT fingerprint FROM known_hosts WHERE host = ? AND port = ?')
    .get(host, port);
  return row ? row.fingerprint : null;
}

function trustHostKey(host, port, fingerprint) {
  db.prepare(
    `INSERT INTO known_hosts (host, port, fingerprint, first_seen) VALUES (?, ?, ?, ?)
     ON CONFLICT(host, port) DO UPDATE SET fingerprint = excluded.fingerprint`
  ).run(host, port, fingerprint, Date.now());
}

module.exports = {
  init,
  shutdown,
  exists,
  isUnlocked,
  setup,
  unlock,
  lock,
  listHosts,
  saveHost,
  deleteHost,
  getHostSecret,
  listKeys,
  saveKey,
  getKeySecret,
  deleteKey,
  getKnownHostKey,
  trustHostKey,
};
