// Optional account sync. Everything that leaves this machine is encrypted
// here first with a random Data Encryption Key (DEK); the server only ever
// stores ciphertext. The DEK itself is uploaded wrapped with a key derived
// from the master password (scrypt over the vault salt), so another device
// that knows the master password can unwrap it — the server cannot.
const crypto = require('crypto');
const os = require('os');
const { shell } = require('electron');
const vault = require('./vault');

const DEFAULT_API_URL =
  process.env.SSHCLIENT_API_URL || 'https://api.sshclient.vapourware-studios.net';
const DEFAULT_CONNECT_URL = process.env.SSHCLIENT_CONNECT_URL || 'http://localhost:5173';
const SCRYPT_PARAMS = { N: 2 ** 17, r: 8, p: 1 };
const SIGNIN_TTL_MS = 10 * 60 * 1000;
const AUTO_SYNC_INTERVAL_MS = 5 * 60 * 1000;
const PUSH_BATCH_SIZE = 200;
const MAX_RECORD_BYTES = 128 * 1024;

// In-flight browser sign-in (verifier never leaves this process).
let pendingSignIn = null;
// Device-token exchange done but the DEK still needs the master password
// (second device with a different local password).
let pendingCrypto = null;

let notify = () => {};
let syncing = false;
let lastError = null;
let lastSyncAt = null;
let syncTimer = null;
let debounceTimer = null;

function setNotifier(fn) {
  notify = fn;
}

function getUrls() {
  return {
    apiUrl: vault.getMeta('sync.apiUrl') || DEFAULT_API_URL,
    connectUrl: vault.getMeta('sync.connectUrl') || DEFAULT_CONNECT_URL,
  };
}

function setUrls({ apiUrl, connectUrl }) {
  if (apiUrl) vault.setMeta('sync.apiUrl', String(apiUrl).replace(/\/+$/, ''));
  if (connectUrl) vault.setMeta('sync.connectUrl', String(connectUrl).replace(/\/+$/, ''));
}

async function api(path, { method = 'GET', token, body } = {}) {
  const { apiUrl } = getUrls();
  const res = await fetch(`${apiUrl}${path}`, {
    method,
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(15000),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    const message = json.record_id
      ? `${json.error} (record_id: ${json.record_id})`
      : json.error || `Sync server error (${res.status})`;
    const err = new Error(message);
    err.status = res.status;
    throw err;
  }
  return json;
}

function getAccount() {
  if (!vault.isUnlocked()) return null;
  return vault.metaGetSecret('sync.account');
}

function status() {
  if (!vault.isUnlocked()) return { unlocked: false, linked: false };
  const account = getAccount();
  const { apiUrl, connectUrl } = getUrls();
  return {
    unlocked: true,
    linked: Boolean(account),
    needsPassword: Boolean(pendingCrypto),
    signingIn: Boolean(pendingSignIn && pendingSignIn.expiresAt > Date.now()),
    clerkUserId: account?.clerkUserId || null,
    deviceId: account?.deviceId || null,
    lastVersion: Number(vault.getMeta('sync.lastVersion') || 0),
    lastSyncAt,
    syncing,
    lastError,
    apiUrl,
    connectUrl,
  };
}

function emitStatus() {
  notify('account:changed', status());
}

// --- sign-in (PKCE-style device link) --------------------------------------

function startSignIn() {
  if (!vault.isUnlocked()) throw new Error('Unlock the vault first');
  const verifier = crypto.randomBytes(32).toString('base64url');
  const state = crypto.randomBytes(16).toString('base64url');
  pendingSignIn = { verifier, state, expiresAt: Date.now() + SIGNIN_TTL_MS };

  const challenge = crypto.createHash('sha256').update(verifier).digest('base64url');
  const { connectUrl } = getUrls();
  const url =
    `${connectUrl}/connect?challenge=${challenge}` +
    `&state=${state}&device=${encodeURIComponent(os.hostname())}`;
  shell.openExternal(url);
  emitStatus();
}

/** Handles sshclient://signed-in?code=...&state=... from the browser. */
async function handleDeepLink(rawUrl) {
  let url;
  try {
    url = new URL(rawUrl);
  } catch {
    return;
  }
  if (url.protocol !== 'sshclient:' || url.hostname !== 'signed-in') return;

  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');
  if (!code || !state) return;

  if (!pendingSignIn || pendingSignIn.expiresAt < Date.now() || pendingSignIn.state !== state) {
    lastError = 'Sign-in link was stale or did not match — try again';
    pendingSignIn = null;
    emitStatus();
    return;
  }
  const { verifier } = pendingSignIn;
  pendingSignIn = null;

  try {
    const grant = await api('/v1/auth/device/complete', {
      method: 'POST',
      body: { code, code_verifier: verifier },
    });
    await ensureCrypto({
      token: grant.token,
      deviceId: grant.device_id,
      clerkUserId: grant.clerk_user_id,
    });
    lastError = null;
  } catch (err) {
    lastError = err.message;
  }
  emitStatus();
}

// --- DEK bootstrap ----------------------------------------------------------

/**
 * After a device token is obtained: fetch or create the account's wrapped
 * DEK. First device generates one; later devices unwrap the existing one —
 * automatically when the master password (and thus salt-derived key) matches,
 * otherwise the UI prompts for the password used when sync was enabled.
 */
async function ensureCrypto(partial) {
  let meta;
  try {
    meta = await api('/v1/crypto', { token: partial.token });
  } catch (err) {
    if (err.status !== 404) throw err;
    // First device: mint a DEK, wrap it with the vault key, upload.
    const dek = crypto.randomBytes(32).toString('base64');
    const wrapped = vault.wrapWithVaultKey({ dek });
    await api('/v1/crypto', {
      method: 'PUT',
      token: partial.token,
      body: {
        kdf: 'scrypt',
        kdf_salt: vault.getSalt().toString('base64'),
        kdf_params: SCRYPT_PARAMS,
        wrapped_dek: {
          iv: wrapped.iv,
          auth_tag: wrapped.authTag,
          ciphertext: wrapped.ciphertext,
        },
      },
    });
    finishLink({ ...partial, dek });
    return;
  }

  const envelope = {
    iv: meta.wrapped_dek.iv,
    authTag: meta.wrapped_dek.auth_tag,
    ciphertext: meta.wrapped_dek.ciphertext,
  };

  // Same master password + salt → the local vault key already unwraps it.
  if (meta.kdf_salt === vault.getSalt().toString('base64')) {
    try {
      const { dek } = vault.unwrapWithVaultKey(envelope);
      finishLink({ ...partial, dek });
      return;
    } catch {
      /* fall through to password prompt */
    }
  }

  pendingCrypto = { ...partial, crypto: meta };
  emitStatus();
}

/** Second-device path: user typed the sync (master) password. */
async function completeCryptoWithPassword(password) {
  if (!pendingCrypto) throw new Error('No pending sync setup');
  const meta = pendingCrypto.crypto;
  const salt = Buffer.from(meta.kdf_salt, 'base64');
  const kek = vault.deriveKey(password, salt);
  let dek;
  try {
    ({ dek } = vault.unwrapWithKey(kek, {
      iv: meta.wrapped_dek.iv,
      authTag: meta.wrapped_dek.auth_tag,
      ciphertext: meta.wrapped_dek.ciphertext,
    }));
  } catch {
    throw new Error('Incorrect sync password');
  } finally {
    kek.fill(0);
  }
  const partial = pendingCrypto;
  pendingCrypto = null;
  finishLink({ token: partial.token, deviceId: partial.deviceId, clerkUserId: partial.clerkUserId, dek });
  emitStatus();
}

function finishLink(account) {
  vault.metaSetSecret('sync.account', account);
  vault.setMeta('sync.lastVersion', '0');
  vault.syncStateClear();
  scheduleSync(100);
}

// --- record crypto ----------------------------------------------------------

// Deterministic JSON (sorted keys) so payload hashes are stable across
// devices. Mirrors JSON.stringify semantics for undefined values.
function canonical(value) {
  if (Array.isArray(value)) {
    return `[${value.map((v) => (v === undefined ? 'null' : canonical(v))).join(',')}]`;
  }
  if (value && typeof value === 'object') {
    const keys = Object.keys(value).filter((k) => value[k] !== undefined).sort();
    return `{${keys.map((k) => `${JSON.stringify(k)}:${canonical(value[k])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function hashPayload(payload) {
  return crypto.createHash('sha256').update(canonical(payload)).digest('hex');
}

function encryptRecord(dek, type, id, payload) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', dek, iv);
  cipher.setAAD(Buffer.from(`${type}:${id}`));
  const ciphertext = Buffer.concat([cipher.update(canonical(payload), 'utf8'), cipher.final()]);
  return {
    iv: iv.toString('base64'),
    auth_tag: cipher.getAuthTag().toString('base64'),
    ciphertext: ciphertext.toString('base64'),
  };
}

function decryptRecord(dek, record) {
  const decipher = crypto.createDecipheriv('aes-256-gcm', dek, Buffer.from(record.iv, 'base64'));
  decipher.setAAD(Buffer.from(`${record.type}:${record.id}`));
  decipher.setAuthTag(Buffer.from(record.auth_tag, 'base64'));
  const plaintext = Buffer.concat([
    decipher.update(Buffer.from(record.ciphertext, 'base64')),
    decipher.final(),
  ]);
  return JSON.parse(plaintext.toString('utf8'));
}

// --- sync engine ------------------------------------------------------------

async function syncNow() {
  if (syncing) return status();
  const account = getAccount();
  if (!account) return status();

  syncing = true;
  emitStatus();
  try {
    const dek = Buffer.from(account.dek, 'base64');
    const changedTypes = new Set();

    // Local view: payload + hash for every record, keyed type:id.
    const local = new Map();
    for (const item of vault.syncEnumerate()) {
      local.set(`${item.type}:${item.id}`, { ...item, hash: hashPayload(item.payload) });
    }
    const state = new Map(
      vault.syncStateAll().map((s) => [`${s.type}:${s.id}`, s])
    );

    // -- pull ---------------------------------------------------------------
    let since = Number(vault.getMeta('sync.lastVersion') || 0);
    let hasMore = true;
    while (hasMore) {
      const page = await api(`/v1/sync/records?since=${since}`, { token: account.token });
      for (const remote of page.records) {
        if (remote.type === 'session_history') continue;
        const key = `${remote.type}:${remote.id}`;
        const known = state.get(key);
        if (known && known.serverVersion >= remote.version) continue;

        const localItem = local.get(key);
        const localDirty = localItem
          ? !known || known.payloadHash !== localItem.hash
          : false;
        // Conflict policy: a concurrent local edit wins — it gets pushed
        // below with a higher version, and other devices converge to it.
        if (localDirty) continue;

        if (remote.deleted) {
          if (localItem) {
            vault.syncDeleteLocal(remote.type, remote.id);
            local.delete(key);
            changedTypes.add(remote.type);
          }
          vault.syncStateDelete(remote.type, remote.id);
          state.delete(key);
        } else {
          const payload = decryptRecord(dek, remote);
          vault.syncApply(remote.type, remote.id, payload);
          const hash = hashPayload(payload);
          local.set(key, { type: remote.type, id: remote.id, payload, hash });
          vault.syncStateSet(remote.type, remote.id, hash, remote.version);
          state.set(key, { type: remote.type, id: remote.id, payloadHash: hash, serverVersion: remote.version });
          changedTypes.add(remote.type);
        }
      }
      // Advance the cursor only through what this page actually covered;
      // latest_version is safe to jump to only once there are no more pages.
      if (page.records.length > 0) {
        since = Math.max(since, page.records[page.records.length - 1].version);
      }
      hasMore = page.has_more;
      if (!hasMore) since = Math.max(since, page.latest_version);
    }
    vault.setMeta('sync.lastVersion', String(since));

    // -- push ---------------------------------------------------------------
    const outgoing = [];
    let oversized = 0;
    for (const [key, item] of local) {
      const known = state.get(key);
      if (known && known.payloadHash === item.hash) continue;
      const encrypted = encryptRecord(dek, item.type, item.id, item.payload);
      if (Buffer.byteLength(encrypted.ciphertext, 'base64') > MAX_RECORD_BYTES) {
        oversized += 1;
        continue;
      }
      outgoing.push({
        type: item.type,
        id: item.id,
        ...encrypted,
        _hash: item.hash,
      });
    }
    // Records we synced before but no longer exist locally → tombstones.
    for (const [key, known] of state) {
      if (!local.has(key)) {
        outgoing.push({ type: known.type, id: known.id, deleted: true, _hash: null });
      }
    }

    for (let i = 0; i < outgoing.length; i += PUSH_BATCH_SIZE) {
      const batch = outgoing.slice(i, i + PUSH_BATCH_SIZE);
      const res = await api('/v1/sync/records', {
        method: 'POST',
        token: account.token,
        body: { records: batch.map(({ _hash, ...r }) => r) },
      });
      for (const result of res.results) {
        const sent = batch.find((b) => b.type === result.type && b.id === result.id);
        if (sent?.deleted) {
          vault.syncStateDelete(result.type, result.id);
        } else if (sent) {
          vault.syncStateSet(result.type, result.id, sent._hash, result.version);
        }
      }
      // The cursor is deliberately NOT advanced to the push's latest_version:
      // another device may have written versions between our pull and this
      // push. The next pull re-walks past our own writes (skipped via
      // sync_state) and picks up anything interleaved.
    }

    lastSyncAt = Date.now();
    lastError = oversized > 0
      ? `${oversized} record(s) too large to sync (over ${MAX_RECORD_BYTES / 1024} KiB) and were skipped`
      : null;

    if (changedTypes.has('host')) notify('hosts:changed', { hosts: vault.listHosts() });
    if (changedTypes.has('key')) notify('keys:changed', { keys: vault.listKeys() });
    if (changedTypes.size > 0) notify('sync:applied', { types: [...changedTypes] });
  } catch (err) {
    if (err.status === 401) {
      // Token revoked from another device — unlink locally.
      vault.metaSetSecret('sync.account', null);
      vault.syncStateClear();
      lastError = 'This device was signed out';
    } else {
      lastError = err.message;
    }
  } finally {
    syncing = false;
    emitStatus();
  }
  return status();
}

function scheduleSync(delayMs = 4000) {
  if (!vault.isUnlocked() || !getAccount()) return;
  clearTimeout(debounceTimer);
  debounceTimer = setTimeout(() => {
    syncNow().catch(() => {});
  }, delayMs);
}

async function signOut() {
  const account = getAccount();
  if (account) {
    try {
      await api('/v1/auth/device/signout', { method: 'POST', token: account.token });
    } catch {
      /* best effort — revoke may already have happened server-side */
    }
  }
  vault.metaSetSecret('sync.account', null);
  vault.setMeta('sync.lastVersion', '0');
  vault.syncStateClear();
  pendingCrypto = null;
  pendingSignIn = null;
  lastError = null;
  lastSyncAt = null;
  emitStatus();
}

function onVaultUnlocked() {
  scheduleSync(1500);
  clearInterval(syncTimer);
  syncTimer = setInterval(() => scheduleSync(0), AUTO_SYNC_INTERVAL_MS);
}

function onVaultLocked() {
  clearInterval(syncTimer);
  clearTimeout(debounceTimer);
  syncTimer = null;
  pendingCrypto = null;
  pendingSignIn = null;
}

module.exports = {
  setNotifier,
  status,
  getUrls,
  setUrls,
  startSignIn,
  handleDeepLink,
  completeCryptoWithPassword,
  syncNow,
  scheduleSync,
  signOut,
  onVaultUnlocked,
  onVaultLocked,
};
