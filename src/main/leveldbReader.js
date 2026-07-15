const snappyjs = require('snappyjs');

const TABLE_MAGIC = Buffer.from([0x57, 0xfb, 0x80, 0x8b, 0x24, 0x75, 0x47, 0xdb]);
const BLOCK_TRAILER_SIZE = 5;
const FOOTER_SIZE = 48;

const VALUE_TYPE_DELETION = 0;
const VALUE_TYPE_VALUE = 1;

function readVarint(buf, pos) {
  let result = 0n;
  let shift = 0n;
  let p = pos;
  for (let i = 0; i < 10; i++) {
    if (p >= buf.length) return null;
    const b = buf[p];
    p += 1;
    result |= BigInt(b & 0x7f) << shift;
    if ((b & 0x80) === 0) return { value: result, pos: p };
    shift += 7n;
  }
  return null;
}

function readBlockHandle(buf, pos) {
  const off = readVarint(buf, pos);
  if (!off) return null;
  const size = readVarint(buf, off.pos);
  if (!size) return null;
  return { offset: Number(off.value), size: Number(size.value), pos: size.pos };
}

function readBlockContent(fileBuf, handle) {
  const raw = fileBuf.subarray(handle.offset, handle.offset + handle.size);
  const compressionType = fileBuf[handle.offset + handle.size];
  if (compressionType === 0) return raw;
  if (compressionType === 1) return Buffer.from(snappyjs.uncompress(raw));
  throw new Error(`Unsupported SSTable block compression type: ${compressionType}`);
}

function decodeBlockEntries(block) {
  const entries = [];
  let pos = 0;
  let lastKey = Buffer.alloc(0);

  while (pos < block.length) {
    const shared = readVarint(block, pos);
    if (!shared) break;
    const unshared = readVarint(block, shared.pos);
    if (!unshared) break;
    const valLen = readVarint(block, unshared.pos);
    if (!valLen) break;

    const sharedN = Number(shared.value);
    const unsharedN = Number(unshared.value);
    const valLenN = Number(valLen.value);
    let cursor = valLen.pos;

    if (sharedN > lastKey.length || cursor + unsharedN + valLenN > block.length) break;

    const key = Buffer.concat([lastKey.subarray(0, sharedN), block.subarray(cursor, cursor + unsharedN)]);
    cursor += unsharedN;
    const value = block.subarray(cursor, cursor + valLenN);
    cursor += valLenN;

    entries.push({ key, value });
    lastKey = key;
    pos = cursor;
  }

  return entries;
}

function splitInternalKey(internalKey) {
  if (internalKey.length < 8) return null;
  const userKey = internalKey.subarray(0, internalKey.length - 8);
  const tagLow = internalKey.readUInt32LE(internalKey.length - 8);
  const tagHigh = internalKey.readUInt32LE(internalKey.length - 4);
  const tag = (BigInt(tagHigh) << 32n) | BigInt(tagLow);
  const valueType = Number(tag & 0xffn);
  const sequence = tag >> 8n;
  return { userKey, sequence, valueType };
}

function parseSSTable(fileBuf) {
  if (fileBuf.length < FOOTER_SIZE) return [];
  const footer = fileBuf.subarray(fileBuf.length - FOOTER_SIZE);
  if (!footer.subarray(40).equals(TABLE_MAGIC)) {
    throw new Error('Not a valid SSTable (bad magic number)');
  }

  const metaHandle = readBlockHandle(footer, 0);
  if (!metaHandle) throw new Error('Failed to read metaindex handle');
  const indexHandle = readBlockHandle(footer, metaHandle.pos);
  if (!indexHandle) throw new Error('Failed to read index handle');

  const indexBlock = readBlockContent(fileBuf, indexHandle);
  const indexEntries = decodeBlockEntries(indexBlock);

  const out = [];
  for (const { value } of indexEntries) {
    const dataHandle = readBlockHandle(value, 0);
    if (!dataHandle) continue;
    let dataBlock;
    try {
      dataBlock = readBlockContent(fileBuf, dataHandle);
    } catch {
      continue;
    }
    for (const entry of decodeBlockEntries(dataBlock)) {
      const split = splitInternalKey(entry.key);
      if (split) out.push({ ...split, value: entry.value });
    }
  }
  return out;
}

const LOG_BLOCK_SIZE = 32768;
const LOG_HEADER_SIZE = 7;

function readLogRecords(fileBuf) {
  const records = [];
  let blockStart = 0;
  let pending = null;

  while (blockStart < fileBuf.length) {
    const blockEnd = Math.min(blockStart + LOG_BLOCK_SIZE, fileBuf.length);
    let pos = blockStart;

    while (pos + LOG_HEADER_SIZE <= blockEnd) {
      const length = fileBuf.readUInt16LE(pos + 4);
      const type = fileBuf[pos + 6];
      const dataStart = pos + LOG_HEADER_SIZE;
      const dataEnd = dataStart + length;
      if (dataEnd > blockEnd) break;

      const chunk = fileBuf.subarray(dataStart, dataEnd);
      if (type === 1) {
        records.push(chunk);
        pending = null;
      } else if (type === 2) {
        pending = [chunk];
      } else if (type === 3) {
        if (pending) pending.push(chunk);
      } else if (type === 4) {
        if (pending) {
          pending.push(chunk);
          records.push(Buffer.concat(pending));
          pending = null;
        }
      }
      if (type === 0) break;

      pos = dataEnd;
    }

    blockStart += LOG_BLOCK_SIZE;
  }

  return records;
}

function parseWriteBatch(payload) {
  if (payload.length < 12) return [];
  const baseSeq = payload.readBigUInt64LE(0);
  const count = payload.readUInt32LE(8);
  const out = [];
  let pos = 12;
  let seqOffset = 0n;

  for (let i = 0; i < count && pos < payload.length; i++) {
    const tag = payload[pos];
    pos += 1;
    const keyLen = readVarint(payload, pos);
    if (!keyLen) break;
    const keyLenN = Number(keyLen.value);
    pos = keyLen.pos;
    if (pos + keyLenN > payload.length) break;
    const userKey = payload.subarray(pos, pos + keyLenN);
    pos += keyLenN;

    let value = Buffer.alloc(0);
    if (tag === VALUE_TYPE_VALUE) {
      const valLen = readVarint(payload, pos);
      if (!valLen) break;
      const valLenN = Number(valLen.value);
      pos = valLen.pos;
      if (pos + valLenN > payload.length) break;
      value = payload.subarray(pos, pos + valLenN);
      pos += valLenN;
    } else if (tag !== VALUE_TYPE_DELETION) {
      break;
    }

    out.push({ userKey, value, sequence: baseSeq + seqOffset, valueType: tag });
    seqOffset += 1n;
  }

  return out;
}

function parseLogFile(fileBuf) {
  const out = [];
  for (const record of readLogRecords(fileBuf)) {
    out.push(...parseWriteBatch(record));
  }
  return out;
}

function readAllEntries(files) {
  const latest = new Map();

  for (const { name, buf } of files) {
    let records;
    try {
      if (name.endsWith('.ldb')) records = parseSSTable(buf);
      else if (name.endsWith('.log')) records = parseLogFile(buf);
      else continue;
    } catch {
      continue;
    }

    for (const rec of records) {
      const key = rec.userKey.toString('hex');
      const existing = latest.get(key);
      if (!existing || rec.sequence > existing.sequence) latest.set(key, rec);
    }
  }

  const out = [];
  for (const rec of latest.values()) {
    if (rec.valueType === VALUE_TYPE_DELETION) continue;
    out.push([rec.userKey, rec.value]);
  }
  return out;
}

module.exports = { readAllEntries, parseSSTable, parseLogFile };
