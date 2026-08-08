// The wire format for a shared terminal, and the only place its ciphertext is
// made or opened.
//
// A frame is a 24-byte cleartext header followed by AES-256-GCM ciphertext:
//
//   0        protocol version
//   1        frame type
//   2..3     sender member id (uint16 BE)
//   4..11    sender sequence number (uint64 BE)
//   12..23   iv (12 bytes)
//   24..     ciphertext || auth tag
//
// The header is what the relay routes on; everything it would need to make
// sense of the session is in the part it cannot read. Bytes 0..11 plus the
// share id go into the GCM AAD, which pins each frame to one session, sender,
// type and position — lift a frame into another share, relabel it as another
// type, or replay it later, and it stops opening.
const crypto = require('crypto');

const PROTOCOL_VERSION = 1;
const HEADER_BYTES = 24;
const IV_BYTES = 12;
const TAG_BYTES = 16;

const FRAME_TYPE = {
  /** Terminal output, owner -> every viewer. */
  output: 1,
  /** The owner's cols x rows, owner -> every viewer. */
  size: 2,
  /** Keystrokes, the viewer holding the keyboard -> owner. */
  input: 3,
};

const FRAME_TYPES = new Set(Object.values(FRAME_TYPE));

// Comfortably under the relay's 64 KiB ceiling once header, tag and any
// multi-byte characters are counted.
const MAX_CHUNK_BYTES = 32 * 1024;

function aad(header, shareId) {
  return Buffer.concat([header.subarray(0, 12), Buffer.from(shareId, 'utf8')]);
}

/** Seals one frame. `seq` must never repeat for a given sender. */
function seal({ key, shareId, memberId, seq, type }, plaintext) {
  const header = Buffer.alloc(HEADER_BYTES);
  header.writeUInt8(PROTOCOL_VERSION, 0);
  header.writeUInt8(type, 1);
  header.writeUInt16BE(memberId, 2);
  header.writeBigUInt64BE(BigInt(seq), 4);

  const iv = crypto.randomBytes(IV_BYTES);
  iv.copy(header, 12);

  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  cipher.setAAD(aad(header, shareId));
  const body = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  return Buffer.concat([header, body, cipher.getAuthTag()]);
}

/**
 * Opens a frame, returning null for anything that fails to authenticate —
 * wrong key, wrong share, tampered header, unknown type, or a sequence number
 * that has already been used. Frames arrive over an ordered connection, so a
 * number that doesn't advance is a replay rather than a reordering.
 */
function open({ key, shareId, seen }, frame) {
  if (!Buffer.isBuffer(frame) || frame.length <= HEADER_BYTES + TAG_BYTES) return null;

  const header = frame.subarray(0, HEADER_BYTES);
  if (header.readUInt8(0) !== PROTOCOL_VERSION) return null;

  const type = header.readUInt8(1);
  if (!FRAME_TYPES.has(type)) return null;

  const memberId = header.readUInt16BE(2);
  const seq = header.readBigUInt64BE(4);
  const last = seen?.get(memberId);
  if (last !== undefined && seq <= last) return null;

  try {
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, header.subarray(12, 24));
    decipher.setAAD(aad(header, shareId));
    decipher.setAuthTag(frame.subarray(frame.length - TAG_BYTES));
    const plaintext = Buffer.concat([
      decipher.update(frame.subarray(HEADER_BYTES, frame.length - TAG_BYTES)),
      decipher.final(),
    ]);
    seen?.set(memberId, seq);
    return { type, memberId, seq, plaintext };
  } catch {
    return null;
  }
}

/** Splits a payload so no single frame exceeds the relay's ceiling. */
function chunk(buffer) {
  if (buffer.length <= MAX_CHUNK_BYTES) return [buffer];
  const parts = [];
  for (let at = 0; at < buffer.length; at += MAX_CHUNK_BYTES) {
    parts.push(buffer.subarray(at, at + MAX_CHUNK_BYTES));
  }
  return parts;
}

module.exports = {
  PROTOCOL_VERSION,
  HEADER_BYTES,
  MAX_CHUNK_BYTES,
  FRAME_TYPE,
  seal,
  open,
  chunk,
};
