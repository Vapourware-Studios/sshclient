const os = require('os');
const path = require('path');
const fs = require('fs');
const fsp = require('fs/promises');
const crypto = require('crypto');
const { execFileSync } = require('child_process');
const nacl = require('tweetnacl');

const TERMIUS_DB_SUBPATH = path.join('Termius', 'IndexedDB', 'file__0.indexeddb.leveldb');

function termiusDbCandidates() {
  const out = [];

  if (process.platform === 'win32') {
    if (process.env.APPDATA) out.push(path.join(process.env.APPDATA, TERMIUS_DB_SUBPATH));
    if (process.env.LOCALAPPDATA) {
      const pkgs = path.join(process.env.LOCALAPPDATA, 'Packages');
      try {
        for (const entry of fs.readdirSync(pkgs)) {
          if (entry.startsWith('Crystalnix.Termius_')) {
            out.push(path.join(pkgs, entry, 'LocalCache', 'Roaming', TERMIUS_DB_SUBPATH));
          }
        }
      } catch {}
    }
  } else if (process.platform === 'darwin') {
    out.push(path.join(os.homedir(), 'Library', 'Application Support', TERMIUS_DB_SUBPATH));
  } else {
    const config = process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config');
    out.push(path.join(config, TERMIUS_DB_SUBPATH));
  }

  return out;
}

function findTermiusDbDir() {
  const candidates = termiusDbCandidates();
  for (const candidate of candidates) {
    if (fs.existsSync(candidate) && fs.statSync(candidate).isDirectory()) return candidate;
  }
  throw new Error(
    `Termius database not found. Looked in:\n  ${candidates.join('\n  ')}`
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

const CRED_READ_PS = `
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
$ok = [SshClientCredReader]::CredRead("Termius/localKey", 1, 0, [ref]$credPtr)
if (-not $ok) { exit 1 }
$cred = [System.Runtime.InteropServices.Marshal]::PtrToStructure($credPtr, [type][SshClientCredReader+CREDENTIAL])
$bytes = New-Object byte[] $cred.CredentialBlobSize
[System.Runtime.InteropServices.Marshal]::Copy($cred.CredentialBlob, $bytes, 0, $cred.CredentialBlobSize)
[SshClientCredReader]::CredFree($credPtr) | Out-Null
[Convert]::ToBase64String($bytes)
`;

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

function readWindowsMasterKeyBase64() {
  let out;
  try {
    out = execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', CRED_READ_PS], {
      encoding: 'utf8',
      windowsHide: true,
    });
  } catch (err) {
    throw new Error(
      'Termius key not found in Credential Manager — is Termius installed and logged in on this machine?'
    );
  }
  const blobB64 = out.trim();
  if (!blobB64) {
    throw new Error(
      'Termius key not found in Credential Manager — is Termius installed and logged in on this machine?'
    );
  }
  return decodeKeytarBlob(Buffer.from(blobB64, 'base64'));
}

function readMacMasterKeyBase64() {
  try {
    return execFileSync(
      'security',
      ['find-generic-password', '-s', 'Termius', '-a', 'localKey', '-w'],
      { encoding: 'utf8' }
    ).trim();
  } catch {
    throw new Error(
      'Termius key not found in Keychain — is Termius installed and logged in on this machine?'
    );
  }
}

function readLinuxMasterKeyBase64() {
  for (const service of ['termius-app', 'Termius']) {
    try {
      const out = execFileSync(
        'secret-tool',
        ['lookup', 'service', service, 'account', 'localKey'],
        { encoding: 'utf8' }
      ).trim();
      if (out) return out;
    } catch {}
  }
  throw new Error(
    'Termius key not found in the Secret Service — is Termius installed and logged in on this machine?'
  );
}

function fetchMasterKey() {
  let b64;
  if (process.platform === 'win32') b64 = readWindowsMasterKeyBase64();
  else if (process.platform === 'darwin') b64 = readMacMasterKeyBase64();
  else b64 = readLinuxMasterKeyBase64();

  const bytes = Buffer.from(b64.trim(), 'base64');
  if (bytes.length !== 32) throw new Error('Termius master key is not 32 bytes');
  return bytes;
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

async function extractTermiusRecords() {
  const dir = findTermiusDbDir();
  const masterKey = fetchMasterKey();

  const temp = await copyDbToTemp(dir);
  let entries;
  try {
    entries = await readAllEntries(temp);
  } finally {
    await fsp.rm(temp, { recursive: true, force: true }).catch(() => {});
  }

  const dbNames = buildDbNameMap(entries);
  const records = [];

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

    records.push({ dbName, termiusId: rec.termiusId, foreignKeys: rec.foreignKeys, decrypted: rec.body });
  }

  if (records.length === 0) {
    throw new Error(
      `Extracted 0 records from ${entries.length} leveldb entries. Termius's IndexedDB schema may have changed, or Termius is not installed / not logged in on this machine.`
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
  previewTermiusImport,
  extractTermiusRecords,
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
