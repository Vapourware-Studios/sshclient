const os = require('os');
const path = require('path');
const fs = require('fs');
const fsp = require('fs/promises');
const crypto = require('crypto');
const { execFileSync } = require('child_process');
const nacl = require('tweetnacl');

// Termius keeps its whole dataset in Chromium's IndexedDB, under the Electron
// user-data directory. Where that directory lives — and what the per-origin
// leveldb folder inside it is called — depends on the platform and on how
// Termius was installed, so both are discovered rather than hardcoded.
const TERMIUS_APP_DIR = 'Termius';

function uniq(list) {
  return [...new Set(list)];
}

function isDir(p) {
  try {
    return fs.statSync(p).isDirectory();
  } catch {
    return false;
  }
}

/** Every place a Termius user-data directory could plausibly be on this OS. */
function termiusDataDirs() {
  const home = os.homedir();
  const out = [];

  if (process.platform === 'win32') {
    if (process.env.APPDATA) out.push(path.join(process.env.APPDATA, TERMIUS_APP_DIR));
    if (process.env.LOCALAPPDATA) {
      out.push(path.join(process.env.LOCALAPPDATA, TERMIUS_APP_DIR));
      // The Microsoft Store build is sandboxed: its %APPDATA% is redirected
      // into the package's own LocalCache tree.
      const pkgs = path.join(process.env.LOCALAPPDATA, 'Packages');
      try {
        for (const entry of fs.readdirSync(pkgs)) {
          if (entry.startsWith('Crystalnix.Termius_')) {
            out.push(path.join(pkgs, entry, 'LocalCache', 'Roaming', TERMIUS_APP_DIR));
            out.push(path.join(pkgs, entry, 'LocalCache', 'Local', TERMIUS_APP_DIR));
          }
        }
      } catch {}
    }
    out.push(path.join(home, 'AppData', 'Roaming', TERMIUS_APP_DIR));
  } else if (process.platform === 'darwin') {
    out.push(path.join(home, 'Library', 'Application Support', TERMIUS_APP_DIR));
  } else {
    // Plain install, plus the two sandboxes that relocate $HOME/.config.
    const config = process.env.XDG_CONFIG_HOME || path.join(home, '.config');
    out.push(path.join(config, TERMIUS_APP_DIR));
    out.push(path.join(home, '.config', TERMIUS_APP_DIR));
    out.push(path.join(home, 'snap', 'termius-app', 'current', '.config', TERMIUS_APP_DIR));
    out.push(path.join(home, 'snap', 'termius-app', 'common', '.config', TERMIUS_APP_DIR));
    out.push(path.join(home, '.var', 'app', 'com.termius.Termius', 'config', TERMIUS_APP_DIR));
  }

  return uniq(out);
}

/**
 * Ranks the per-origin leveldb folders inside one IndexedDB directory. Termius
 * loads its UI from a file:// URL, so `file__0` is the real store, but the name
 * is Chromium's to choose and has changed across versions — hence a ranking
 * rather than an equality check.
 */
function rankLeveldbName(name) {
  if (name.startsWith('file__0')) return 0;
  if (name.startsWith('file__')) return 1;
  if (name.includes('termius')) return 2;
  return 3;
}

/** The candidate leveldb directories inside one Termius user-data directory. */
function leveldbDirsIn(dataDir) {
  const idb = path.join(dataDir, 'IndexedDB');
  let names;
  try {
    names = fs.readdirSync(idb);
  } catch {
    return [];
  }
  return names
    .filter((name) => name.endsWith('.leveldb'))
    .sort((a, b) => rankLeveldbName(a) - rankLeveldbName(b) || a.localeCompare(b))
    .map((name) => path.join(idb, name))
    .filter((dir) => isDir(dir) && hasLeveldbFiles(dir));
}

function hasLeveldbFiles(dir) {
  try {
    return fs.readdirSync(dir).some((name) => name.endsWith('.ldb') || name.endsWith('.log'));
  } catch {
    return false;
  }
}

function termiusDbCandidates() {
  const out = [];
  for (const dataDir of termiusDataDirs()) out.push(...leveldbDirsIn(dataDir));
  return out;
}

/**
 * Every database this machine might hold, best-guess first. An install that was
 * replaced rather than removed — a plain install beside a Snap, say — leaves its
 * own database behind, and the order the candidates come in says nothing about
 * which one is current, so the caller opens them all rather than trusting the
 * first.
 */
function findTermiusDbDirs() {
  const candidates = termiusDbCandidates();
  if (candidates.length > 0) return candidates;
  throw new Error(
    `Termius database not found. Looked for an IndexedDB store in:\n  ${termiusDataDirs().join('\n  ')}`
  );
}

async function copyDbToTemp(srcDir) {
  const temp = path.join(os.tmpdir(), `sshclient-termius-ldb-${process.pid}-${crypto.randomUUID()}`);
  await fsp.rm(temp, { recursive: true, force: true });
  await fsp.mkdir(temp, { recursive: true });

  const names = await fsp.readdir(srcDir);
  let copied = 0;
  for (const name of names) {
    if (name === 'LOCK') continue;
    try {
      await fsp.copyFile(path.join(srcDir, name), path.join(temp, name));
      copied += 1;
    } catch {}
  }
  if (copied === 0) throw new Error('No files copied from Termius db dir');
  return temp;
}

// Termius stores its master key with keytar, which maps onto a different
// secret store on each OS: Credential Manager, the login Keychain, and the
// freedesktop Secret Service. The service/account pair has also changed
// between Termius versions, so every reader tries the known spellings.
//
// Every key found is tried against every database, and the order is itself a
// signal: the name current Termius writes is listed ahead of the one only
// older versions wrote. Each key belongs to one account, so when two keys
// open two different databases and the records cannot say which account is
// current, the key under the current name is taken to be the account this
// machine is signed into — see isBetterAttempt.
const KEY_ACCOUNT = 'localKey';
const KEY_SERVICES = ['termius-app', 'Termius'];
const MASTER_KEY_BYTES = 32;

/**
 * A key left behind by an older Termius sits under a different service name
 * beside the live one, and it is a real key — the same 32 bytes, just for an
 * account nobody uses any more. Neither the order of the names nor the size of
 * the value can tell the two apart, so this only rules out what plainly is not
 * a key; which of the survivors is the right one is settled later, against the
 * database itself.
 */
function looksLikeMasterKey(b64) {
  try {
    return Buffer.from(String(b64 ?? '').trim(), 'base64').length === MASTER_KEY_BYTES;
  } catch {
    return false;
  }
}

function credReadPs(target) {
  return `
Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
public class SshClientCredReader {
  [DllImport("advapi32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
  public static extern bool CredRead(string target, int type, int reservedFlag, out IntPtr credentialPtr);
  [DllImport("advapi32.dll", SetLastError = true)]
  public static extern bool CredFree(IntPtr cred);
  [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
  public struct CREDENTIAL {
    public int Flags;
    public int Type;
    public IntPtr TargetName;
    public IntPtr Comment;
    public long LastWritten;
    public int CredentialBlobSize;
    public IntPtr CredentialBlob;
    public int Persist;
    public int AttributeCount;
    public IntPtr Attributes;
    public IntPtr TargetAlias;
    public IntPtr UserName;
  }
}
"@
$credPtr = [IntPtr]::Zero
$ok = [SshClientCredReader]::CredRead("${target}", 1, 0, [ref]$credPtr)
if (-not $ok) { exit 1 }
$cred = [System.Runtime.InteropServices.Marshal]::PtrToStructure($credPtr, [type][SshClientCredReader+CREDENTIAL])
$bytes = New-Object byte[] $cred.CredentialBlobSize
[System.Runtime.InteropServices.Marshal]::Copy($cred.CredentialBlob, $bytes, 0, $cred.CredentialBlobSize)
[SshClientCredReader]::CredFree($credPtr) | Out-Null
[Convert]::ToBase64String($bytes)
`;
}

/** keytar writes Windows credentials under the target name `service/account`. */
function windowsCredTargets() {
  const targets = KEY_SERVICES.map((service) => `${service}/${KEY_ACCOUNT}`);
  return uniq([...targets, ...KEY_SERVICES]);
}

function powershellBinaries() {
  const root = process.env.SystemRoot || 'C:\\Windows';
  return uniq([
    path.join(root, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe'),
    'powershell.exe',
    'pwsh.exe',
  ]);
}

function decodeKeytarBlob(buf) {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(buf);
  } catch {}
  if (buf.length % 2 === 0) {
    try {
      return new TextDecoder('utf-16le', { fatal: true }).decode(buf);
    } catch {}
  }
  throw new Error('Credential blob is neither valid UTF-8 nor UTF-16LE');
}

function readWindowsMasterKeysBase64() {
  const found = [];
  for (const bin of powershellBinaries()) {
    for (const target of windowsCredTargets()) {
      let out;
      try {
        out = execFileSync(bin, ['-NoProfile', '-NonInteractive', '-Command', credReadPs(target)], {
          encoding: 'utf8',
          windowsHide: true,
        });
      } catch {
        continue;
      }
      const blobB64 = out.trim();
      if (!blobB64) continue;
      let decoded;
      try {
        decoded = decodeKeytarBlob(Buffer.from(blobB64, 'base64'));
      } catch {
        continue;
      }
      if (looksLikeMasterKey(decoded)) found.push(decoded);
    }
  }
  if (found.length) return found;
  throw new Error(
    'Termius key not found in Credential Manager — is Termius installed and logged in on this Windows account?'
  );
}

function readMacMasterKeysBase64() {
  const found = [];
  for (const service of KEY_SERVICES) {
    try {
      const out = execFileSync(
        'security',
        ['find-generic-password', '-s', service, '-a', KEY_ACCOUNT, '-w'],
        { encoding: 'utf8' }
      ).trim();
      if (looksLikeMasterKey(out)) found.push(out);
    } catch {}
  }
  if (found.length) return found;
  throw new Error(
    'Termius key not found in Keychain — is Termius installed and logged in on this machine?'
  );
}

function readLinuxMasterKeysBase64() {
  const found = [];
  let sawSecretTool = false;
  for (const service of KEY_SERVICES) {
    try {
      const out = execFileSync(
        'secret-tool',
        ['lookup', 'service', service, 'account', KEY_ACCOUNT],
        { encoding: 'utf8' }
      ).trim();
      sawSecretTool = true;
      if (looksLikeMasterKey(out)) found.push(out);
    } catch (err) {
      // ENOENT means secret-tool itself is missing; a non-zero exit only means
      // this particular service name holds nothing.
      if (err?.code !== 'ENOENT') sawSecretTool = true;
    }
  }
  if (found.length) return found;
  if (!sawSecretTool) {
    throw new Error(
      'secret-tool is not installed, so the Termius key cannot be read from the keyring. Install it (libsecret-tools on Debian/Ubuntu, libsecret on Arch, libsecret-tools on Fedora) and try again.'
    );
  }
  throw new Error(
    'Termius key not found in the Secret Service — is Termius installed and logged in on this machine, and is your keyring unlocked?'
  );
}

function fetchMasterKeys() {
  let candidates;
  if (process.platform === 'win32') candidates = readWindowsMasterKeysBase64();
  else if (process.platform === 'darwin') candidates = readMacMasterKeysBase64();
  else candidates = readLinuxMasterKeysBase64();

  const keys = [];
  const seen = new Set();
  for (const b64 of candidates) {
    const bytes = Buffer.from(String(b64).trim(), 'base64');
    if (bytes.length !== MASTER_KEY_BYTES) continue;
    const id = bytes.toString('base64');
    if (seen.has(id)) continue;
    seen.add(id);
    keys.push(bytes);
  }
  if (!keys.length) throw new Error('Termius master key is not 32 bytes');
  return keys;
}

async function readAllEntries(dir) {
  const leveldbReader = require('./leveldbReader');
  const names = await fsp.readdir(dir);
  const files = [];
  for (const name of names) {
    if (!name.endsWith('.ldb') && !name.endsWith('.log')) continue;
    files.push({ name, buf: await fsp.readFile(path.join(dir, name)) });
  }
  return leveldbReader.readAllEntries(files);
}

function decodeIdbKey(key) {
  if (key.length < 4 || key[0] !== 0x00) return null;
  return { dbId: key[1], objectStoreId: key[2], indexId: key[3] };
}

function buildDbNameMap(entries) {
  const map = new Map();
  for (const [k, v] of entries) {
    if (
      k.length < 7 ||
      k[0] !== 0x00 ||
      k[2] !== 0x00 ||
      k[3] !== 0x00 ||
      k[4] !== 0x32 ||
      k[5] !== 0x01 ||
      k[6] !== 0x00
    ) {
      continue;
    }
    if (v.length === 0 || v.length % 2 !== 0) continue;
    let name = '';
    for (let i = 0; i < v.length; i += 2) name += String.fromCharCode((v[i] << 8) | v[i + 1]);
    map.set(k[1], name);
  }
  return map;
}

class V8Parser {
  constructor(bytes) {
    this.bytes = bytes;
    this.pos = 0;
  }

  peek() {
    return this.pos < this.bytes.length ? this.bytes[this.pos] : undefined;
  }

  advance() {
    const b = this.peek();
    if (b !== undefined) this.pos += 1;
    return b;
  }

  varint() {
    let v = 0n;
    let s = 0n;
    while (s < 64n) {
      const b = this.advance();
      if (b === undefined) return null;
      v |= BigInt(b & 0x7f) << s;
      if ((b & 0x80) === 0) return v;
      s += 7n;
    }
    return null;
  }

  skipPadding() {
    while (this.peek() === 0x00 || this.peek() === 0xff) this.pos += 1;
  }

  readString(tag) {
    const lenBig = this.varint();
    if (lenBig === null) return null;
    const len = Number(lenBig);
    if (this.pos + len > this.bytes.length) return null;
    const bytes = this.bytes.subarray(this.pos, this.pos + len);
    this.pos += len;
    if (tag === 0x22) {
      let s = '';
      for (const b of bytes) s += String.fromCharCode(b);
      return s;
    }
    if (tag === 0x63) {
      if (len % 2 !== 0) return null;
      let s = '';
      for (let i = 0; i < len; i += 2) s += String.fromCharCode(bytes[i] | (bytes[i + 1] << 8));
      return s;
    }
    if (tag === 0x53) return Buffer.from(bytes).toString('utf8');
    return null;
  }

  readValue() {
    this.skipPadding();
    const tag = this.advance();
    if (tag === undefined) return undefined;
    switch (tag) {
      case 0x22:
      case 0x63:
      case 0x53:
        return this.readString(tag);
      case 0x49: {
        const v = this.varint();
        if (v === null) return undefined;
        const zz = (v >> 1n) ^ -(v & 1n);
        return Number(zz);
      }
      case 0x55: {
        const v = this.varint();
        if (v === null) return undefined;
        return Number(v);
      }
      case 0x4e: {
        if (this.pos + 8 > this.bytes.length) return undefined;
        const d = Buffer.from(this.bytes.buffer, this.bytes.byteOffset + this.pos, 8).readDoubleLE(0);
        this.pos += 8;
        return Number.isFinite(d) ? d : null;
      }
      case 0x30:
      case 0x5f:
        return null;
      case 0x54:
        return true;
      case 0x46:
        return false;
      case 0x6f:
        return this.readObject();
      case 0x41:
        return this.readArray(0x24);
      case 0x61:
        return this.readArray(0x40);
      default:
        return undefined;
    }
  }

  readObject() {
    const map = {};
    for (;;) {
      this.skipPadding();
      if (this.peek() === 0x7b) {
        this.pos += 1;
        this.varint();
        return map;
      }
      const keyTag = this.advance();
      if (keyTag === undefined) return map;
      let key;
      if (keyTag === 0x22 || keyTag === 0x63 || keyTag === 0x53) key = this.readString(keyTag);
      else return map;
      if (key === null || key === undefined) return map;
      map[key] = this.readValue();
    }
  }

  readArray(terminator) {
    this.varint();
    const arr = [];
    for (;;) {
      this.skipPadding();
      if (this.peek() === terminator) {
        this.pos += 1;
        this.varint();
        this.varint();
        return arr;
      }
      arr.push(this.readValue());
    }
  }
}

function decodeEnvelope(bytes) {
  let pos = 0;
  while (pos < bytes.length && bytes[pos] !== 0x6f) pos += 1;
  if (pos >= bytes.length) return null;
  const parser = new V8Parser(bytes);
  parser.pos = pos + 1;
  return parser.readObject();
}

const VERSION_TAG = 0x04;
const NONCE_LEN = 24;
const HEADER_LEN = 2 + NONCE_LEN;
const MIN_BLOB_LEN = HEADER_LEN + 16;

function idFromObject(v) {
  if (v && typeof v === 'object' && !Array.isArray(v) && typeof v.id === 'number') return v.id;
  return undefined;
}

function looksEncrypted(s) {
  return typeof s === 'string' && s.length >= 32 && s.startsWith('BA') && /^[A-Za-z0-9+/=]+$/.test(s);
}

function decryptBlob(masterKey, blobB64) {
  let data;
  try {
    data = Buffer.from(blobB64, 'base64');
  } catch {
    return null;
  }
  if (data.length < MIN_BLOB_LEN || data[0] !== VERSION_TAG) return null;
  const nonce = data.subarray(2, HEADER_LEN);
  const ciphertext = data.subarray(HEADER_LEN);
  const plain = nacl.secretbox.open(
    new Uint8Array(ciphertext),
    new Uint8Array(nonce),
    new Uint8Array(masterKey)
  );
  if (!plain) return null;
  return Buffer.from(plain).toString('utf8').replace(/\0+$/, '');
}

function extractRecord(envelope, masterKey) {
  if (!envelope || typeof envelope !== 'object') return null;
  const termiusId = envelope.id;
  if (typeof termiusId !== 'number') return null;

  const foreignKeys = {};
  const body = {};

  for (const [key, value] of Object.entries(envelope)) {
    if (key === 'id' || key === 'local_id' || key === 'updated_at' || key === 'status') continue;

    const fk = idFromObject(value);
    if (fk !== undefined) {
      foreignKeys[key] = fk;
      continue;
    }

    if (typeof value === 'string' && looksEncrypted(value)) {
      const plain = decryptBlob(masterKey, value);
      if (plain !== null) {
        if (key === 'content') {
          try {
            const parsed = JSON.parse(plain);
            if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
              for (const [k, v] of Object.entries(parsed)) {
                if (!(k in body)) body[k] = v;
              }
              continue;
            }
          } catch {}
        }
        body[key] = plain;
      }
      continue;
    }

    body[key] = value;
  }

  return {
    termiusId,
    status: typeof envelope.status === 'string' ? envelope.status : undefined,
    foreignKeys,
    body,
  };
}

function isInactiveStatus(status) {
  if (!status) return false;
  const s = status.toLowerCase();
  return s === 'deleted' || s === 'removed' || s === 'delete' || s.endsWith('_failed');
}

/**
 * How much the key actually opened. A record survives the wrong key — its id
 * and status are in the clear — so counting records says nothing about whether
 * the key was right. Only the fields that had to be decrypted do.
 */
function decryptedFieldCount(records) {
  let count = 0;
  for (const rec of records) count += Object.keys(rec.decrypted ?? {}).length;
  return count;
}

function collectRecords(entries, dbNames, masterKey) {
  const found = [];
  for (const [k, v] of entries) {
    const idb = decodeIdbKey(k);
    if (!idb) continue;
    if (idb.indexId !== 0x01 || idb.objectStoreId !== 0x01) continue;

    const dbName = dbNames.get(idb.dbId);
    if (!dbName) continue;

    const envelope = decodeEnvelope(v);
    if (!envelope) continue;

    const rec = extractRecord(envelope, masterKey);
    if (!rec) continue;
    if (isInactiveStatus(rec.status)) continue;

    found.push({ dbName, termiusId: rec.termiusId, foreignKeys: rec.foreignKeys, decrypted: rec.body });
  }
  return found;
}

function parseRecordTime(value) {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const t = Date.parse(value);
    if (Number.isFinite(t)) return t;
  }
  return 0;
}

/**
 * What the records themselves say about how current a database is, read in the
 * clear and without a key. Two signals, because a schema change can take either
 * one away:
 *
 *   - the newest `updated_at` any record carries;
 *   - the highest id, which Termius assigns server-side and only ever climbs as
 *     an account syncs new records, so the database that went on syncing
 *     longest holds the highest one.
 *
 * Both live inside the data, so copying, restoring, or migrating a database
 * cannot advance either. That is exactly what the file's own timestamps cannot
 * promise, and why these are asked first.
 */
function recordSignals(entries) {
  let recordTime = 0;
  let highestId = 0;
  for (const [k, v] of entries) {
    const idb = decodeIdbKey(k);
    if (!idb) continue;
    if (idb.indexId !== 0x01 || idb.objectStoreId !== 0x01) continue;
    const envelope = decodeEnvelope(v);
    if (!envelope || typeof envelope !== 'object') continue;
    const t = parseRecordTime(envelope.updated_at);
    if (t > recordTime) recordTime = t;
    if (typeof envelope.id === 'number' && envelope.id > highestId) highestId = envelope.id;
  }
  return { recordTime, highestId };
}

/**
 * Ranks one database-and-key pairing against the best seen so far.
 *
 * Ahead of everything: a pairing that opened nothing never displaces one that
 * opened something, so a stale database no key fits cannot win on age.
 *
 * Two pairings that read the same database share every age signal, so between
 * them the only question is which key fits it, and the key that decrypts more
 * of it does. A stale key can still open a legacy field or two, which is why
 * the measure is how much opened, not whether anything did.
 *
 * Between different databases, age is asked first, of the records rather than
 * the files: a copied or restored database carries file times from the day it
 * was moved, but nothing can advance the `updated_at` stamps inside it. The
 * stamps are wall-clock dates, so they compare across accounts too.
 *
 * When the stamps cannot separate two pairings that used different keys, no
 * in-data signal can: each key opens its own account's data, and different
 * accounts number their records in different id spaces and hold different
 * amounts to decrypt, so neither ids nor decrypted-field counts compare
 * across them. What still points at the current account is the keychain —
 * the key stored under the name current Termius writes is read first, so the
 * pairing whose key came earlier is the account this machine is signed into.
 *
 * That leaves the id check to pairings sharing one key, meaning one account,
 * where ids are one climbing sequence: Termius assigns them server-side, so
 * of two copies of the same account's data, the higher id marks the copy that
 * kept syncing longest. An abandoned copy can still decrypt more than the
 * live one — it holds every host deleted since — which is why the
 * decrypted-field count is asked after the ids, and record volume last.
 *
 * File times decide nothing at any step: a restore resets them, so any order
 * they could impose is exactly the wrong one in the case that matters.
 */
function isBetterAttempt(best, attempt) {
  if (!best) return true;
  if ((attempt.score > 0) !== (best.score > 0)) return attempt.score > 0;
  if (attempt.dir === best.dir) {
    if (attempt.score !== best.score) return attempt.score > best.score;
    return attempt.records.length > best.records.length;
  }
  if (attempt.recordTime !== best.recordTime) return attempt.recordTime > best.recordTime;
  if (attempt.keyIndex !== best.keyIndex) return attempt.keyIndex < best.keyIndex;
  if (attempt.highestId !== best.highestId) return attempt.highestId > best.highestId;
  if (attempt.score !== best.score) return attempt.score > best.score;
  return attempt.records.length > best.records.length;
}

async function readEntriesFrom(dir) {
  const temp = await copyDbToTemp(dir);
  try {
    return await readAllEntries(temp);
  } finally {
    await fsp.rm(temp, { recursive: true, force: true }).catch(() => {});
  }
}

async function extractTermiusRecords() {
  const dirs = findTermiusDbDirs();
  const masterKeys = fetchMasterKeys();

  // An install that was replaced leaves its database behind, and an account
  // signed out long ago leaves its key in the keychain next to the live one —
  // the same length and equally well-formed. Nothing about either value says
  // which is current, and picking the wrong one does not fail loudly: the
  // records still come back, just with every encrypted field quietly missing.
  // A stale pairing can even open a field or two, so first-that-works is not
  // good enough. Every database is read with every key, and the pairing that
  // wins comes from the newest database any key opens — see isBetterAttempt for
  // what counts as newest, and why volume does not settle it.
  let best = null;
  let totalEntries = 0;
  let opened = 0;
  let lastError = null;

  for (const dir of dirs) {
    let entries;
    try {
      entries = await readEntriesFrom(dir);
    } catch (err) {
      lastError = err;
      continue;
    }
    opened += 1;
    totalEntries += entries.length;

    const dbNames = buildDbNameMap(entries);
    const { recordTime, highestId } = recordSignals(entries);
    for (const [keyIndex, masterKey] of masterKeys.entries()) {
      const records = collectRecords(entries, dbNames, masterKey);
      const attempt = {
        score: decryptedFieldCount(records),
        records,
        recordTime,
        highestId,
        keyIndex,
        dir,
      };
      if (isBetterAttempt(best, attempt)) best = attempt;
    }
  }

  if (opened === 0) {
    throw new Error(
      `Termius database could not be read. Tried:\n  ${dirs.join('\n  ')}${
        lastError ? `\nLast error: ${lastError.message}` : ''
      }`
    );
  }

  const records = best ? best.records : [];
  if (records.length === 0) {
    throw new Error(
      `Extracted 0 records from ${totalEntries} leveldb entries. Termius's IndexedDB schema may have changed, or Termius is not installed / not logged in on this machine.`
    );
  }

  return records;
}

function str(v) {
  return typeof v === 'string' && v.length > 0 ? v : undefined;
}

function num(v) {
  return typeof v === 'number' && Number.isFinite(v) ? v : undefined;
}

function indexRecords(records) {
  const idx = {
    hosts: new Map(),
    sshConfigs: new Map(),
    sshConfigSettings: new Map(),
    sshIdentities: new Map(),
    sshKeys: new Map(),
    sshConfigIdentities: [],
    snippets: new Map(),
    hostSnippets: [],
  };
  for (const r of records) {
    switch (r.dbName) {
      case 'hosts':
        idx.hosts.set(r.termiusId, r);
        break;
      case 'ssh_configs':
        idx.sshConfigs.set(r.termiusId, r);
        break;
      case 'settings':
        idx.sshConfigSettings.set(r.termiusId, r);
        break;
      case 'ssh_identities':
        idx.sshIdentities.set(r.termiusId, r);
        break;
      case 'ssh_config_identities':
        idx.sshConfigIdentities.push(r);
        break;
      case 'keys':
        idx.sshKeys.set(r.termiusId, r);
        break;
      case 'snippets':
        idx.snippets.set(r.termiusId, r);
        break;
      case 'host_snippets':
        idx.hostSnippets.push(r);
        break;
      default:
        break;
    }
  }
  return idx;
}

function buildKeys(idx) {
  const keys = [];
  const keyLocalIdByTermiusId = new Map();
  for (const k of idx.sshKeys.values()) {
    const privateKey = str(k.decrypted.private_key);
    if (!privateKey) continue;
    const localId = `tk${keys.length}`;
    keyLocalIdByTermiusId.set(k.termiusId, localId);
    keys.push({
      localId,
      name: str(k.decrypted.label) || `Termius key ${k.termiusId}`,
      private: privateKey,
      public: str(k.decrypted.public_key),
      passphrase: str(k.decrypted.passphrase),
    });
  }
  return { keys, keyLocalIdByTermiusId };
}

function buildSnippets(idx) {
  const snippets = [];
  for (const s of idx.snippets.values()) {
    const command = str(s.decrypted.script);
    if (!command) continue;
    const localId = `ts${snippets.length}`;
    const termiusHostIds = idx.hostSnippets
      .filter((hs) => hs.foreignKeys.snippet === s.termiusId)
      .map((hs) => hs.foreignKeys.host)
      .filter((id) => id != null);
    snippets.push({
      localId,
      name: str(s.decrypted.label) || `Termius snippet ${s.termiusId}`,
      command,
      termiusHostIds,
    });
  }
  return snippets;
}

function buildIdentityBySshConfigId(idx) {
  const map = new Map();
  for (const rel of idx.sshConfigIdentities) {
    const sshConfigId = rel.foreignKeys.ssh_config;
    const identityId = rel.foreignKeys.identity;
    if (sshConfigId == null || identityId == null) continue;
    const identity = idx.sshIdentities.get(identityId);
    if (identity) map.set(sshConfigId, identity);
  }
  return map;
}

function buildConnections(idx, keyLocalIdByTermiusId, identityBySshConfigId) {
  const connections = [];
  for (const host of idx.hosts.values()) {
    const sshConfigId = host.foreignKeys.ssh_config;
    const sshConfig = sshConfigId != null ? idx.sshConfigs.get(sshConfigId) : undefined;
    const settings = sshConfigId != null ? idx.sshConfigSettings.get(sshConfigId) : undefined;
    const settingsBody = settings?.decrypted ?? sshConfig?.decrypted ?? {};

    const address = str(host.decrypted.address) || '';
    const label = str(host.decrypted.label) || address;
    const port = num(settingsBody.port) ?? 22;

    let authType = 'password';
    let username = '';
    let password;
    let privateKey;
    let passphrase;
    let keyLocalId;

    if (sshConfigId != null) {
      const identity = identityBySshConfigId.get(sshConfigId);
      if (identity) {
        const idBody = identity.decrypted;
        const keyTermiusId = identity.foreignKeys.ssh_key;
        const linkedKey = keyTermiusId != null ? idx.sshKeys.get(keyTermiusId) : undefined;

        username = str(idBody.username) || str(linkedKey?.decrypted.username) || '';
        const idPassword = str(idBody.password) || str(linkedKey?.decrypted.password);

        if (linkedKey && str(linkedKey.decrypted.private_key)) {
          authType = 'key';
          privateKey = str(linkedKey.decrypted.private_key);
          passphrase = str(linkedKey.decrypted.passphrase);
          keyLocalId = keyLocalIdByTermiusId.get(linkedKey.termiusId);
        } else if (idPassword) {
          authType = 'password';
          password = idPassword;
        }
      }
    }

    const valid = Boolean(address && username && (password || privateKey || keyLocalId));
    let invalidReason;
    if (!valid) {
      if (host.decrypted.is_shared) {
        invalidReason = "Shared via a Termius Team — its credentials live on Termius's servers, not on this device";
      } else if (!username) {
        invalidReason = 'No username saved for this host in Termius';
      } else {
        invalidReason = 'No password or key saved for this host in Termius (prompt-at-connect)';
      }
    }

    connections.push({
      localId: `tc${connections.length}`,
      termiusHostId: host.termiusId,
      name: label,
      host: address,
      port,
      username,
      authType,
      password,
      privateKey,
      passphrase,
      keyLocalId,
      valid,
      invalidReason,
    });
  }
  return connections;
}

async function previewTermiusImport() {
  const records = await extractTermiusRecords();
  const idx = indexRecords(records);
  const { keys, keyLocalIdByTermiusId } = buildKeys(idx);
  const identityBySshConfigId = buildIdentityBySshConfigId(idx);
  const connections = buildConnections(idx, keyLocalIdByTermiusId, identityBySshConfigId);
  const snippets = buildSnippets(idx);
  return { keys, connections, snippets };
}

module.exports = {
  collectRecords,
  decryptedFieldCount,
  fetchMasterKeys,
  looksLikeMasterKey,
  previewTermiusImport,
  extractTermiusRecords,
  termiusDataDirs,
  termiusDbCandidates,
  findTermiusDbDirs,
  isBetterAttempt,
  recordSignals,
  rankLeveldbName,
  windowsCredTargets,
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
};
