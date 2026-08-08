// Sharing a live terminal with other people.
//
// The relay in the middle is deliberately blind: everything a terminal
// actually says — output, its size, a guest's keystrokes — is sealed here with
// AES-256-GCM under a key generated on this machine. That key travels only in
// the fragment of the share link, which browsers never put on the wire, so it
// reaches the people the link was sent to and nobody else. The server sees
// ciphertext, member ids and device names.
//
// One side of a share is the owner: it holds the terminal, encrypts every
// frame and is the only thing that ever writes to the real session. The other
// side is a viewer: read-only until the owner hands it the keyboard, and even
// then its keystrokes take the long way round — relay, owner, terminal — so
// the owner stays in control of its own shell.
const crypto = require('crypto');
const WebSocket = require('ws');
const { shell } = require('electron');
const ssh = require('./ssh');
const localTerm = require('./localTerm');
const serial = require('./serial');
const sync = require('./sync');
const vault = require('./vault');
const frames = require('./shareFrame');

const { FRAME_TYPE } = frames;

// The relay gives a dropped owner 30s to come back, so give up a little before
// that rather than reconnect into a session that has already ended.
const RECONNECT_DELAYS_MS = [500, 1000, 2000, 4000, 8000, 12000];

// A join link that arrives while the vault is locked waits this long for the
// user to unlock and sign in before it is dropped.
const PENDING_JOIN_TTL_MS = 5 * 60 * 1000;

const owned = new Map(); // terminal sessionId -> owner share
const joined = new Map(); // shareId -> viewer share
const sizes = new Map(); // terminal sessionId -> last known { cols, rows }
let pendingJoin = null;
let notify = () => {};

function setNotifier(fn) {
  notify = fn;
}

// --- framing ----------------------------------------------------------------

/** Seals one frame for a share and advances its sequence number. */
function seal(share, type, plaintext) {
  const frame = frames.seal(
    { key: share.key, shareId: share.shareId, memberId: share.memberId, seq: share.seq, type },
    plaintext,
  );
  share.seq += 1n;
  return frame;
}

function unseal(share, frame) {
  return frames.open({ key: share.key, shareId: share.shareId, seen: share.seen }, frame);
}

// --- transport --------------------------------------------------------------

function requireAccount() {
  const account = sync.getAccount();
  if (!account) throw new Error('Sign in to share a terminal');
  return account;
}

async function apiRequest(path, { method = 'GET', token, body } = {}) {
  const { apiUrl } = sync.getUrls();
  const res = await fetch(`${apiUrl.replace(/\/+$/, '')}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(15000),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(json.error || `Share server error (${res.status})`);
    err.status = res.status;
    throw err;
  }
  return json;
}

function socketUrl(shareId, { owner }) {
  const { apiUrl } = sync.getUrls();
  const url = new URL(`${apiUrl.replace(/\/+$/, '')}/v1/share/${shareId}/ws`);
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
  if (owner) url.searchParams.set('role', 'owner');
  return url.toString();
}

function joinLink(shareId, key) {
  const { connectUrl } = sync.getUrls();
  return `${connectUrl.replace(/\/+$/, '')}/join#s=${shareId}&k=${key.toString('base64url')}`;
}

function sendControl(share, message) {
  if (share.socket?.readyState === WebSocket.OPEN) {
    share.socket.send(JSON.stringify(message));
  }
}

// --- owner ------------------------------------------------------------------

function ownerState(share) {
  return {
    sessionId: share.sessionId,
    shareId: share.shareId,
    link: share.link,
    status: share.status,
    error: share.error,
    members: share.members,
    baton: share.baton,
    maxViewers: share.maxViewers,
    expiresAt: share.expiresAt,
  };
}

function emitOwner(share) {
  notify('share:owner', ownerState(share));
}

/** Opens a share for a terminal that is already running. */
async function startShare(sessionId, kind) {
  if (owned.has(sessionId)) return ownerState(owned.get(sessionId));

  const account = requireAccount();
  const created = await apiRequest('/v1/share', { method: 'POST', token: account.token });
  const key = crypto.randomBytes(32);

  const share = {
    sessionId,
    kind,
    shareId: created.share_id,
    key,
    memberId: 0,
    seq: 0n,
    seen: new Map(),
    link: joinLink(created.share_id, key),
    size: sizes.get(sessionId) ?? null,
    maxViewers: created.max_viewers,
    expiresAt: created.expires_at,
    status: 'connecting',
    error: null,
    members: [],
    baton: null,
    socket: null,
    attempt: 0,
    retryTimer: null,
    stopped: false,
  };
  owned.set(sessionId, share);
  connectOwner(share);
  return ownerState(share);
}

function connectOwner(share) {
  const account = sync.getAccount();
  if (!account) {
    share.status = 'error';
    share.error = 'Signed out';
    emitOwner(share);
    return;
  }

  const socket = new WebSocket(socketUrl(share.shareId, { owner: true }), {
    headers: { Authorization: `Bearer ${account.token}` },
  });
  share.socket = socket;

  socket.on('open', () => {
    share.attempt = 0;
    share.status = 'live';
    share.error = null;
    emitOwner(share);
    // Viewers get no backlog, so the size is the one thing they need before
    // the next byte of output arrives. This terminal is the authority on it;
    // their views scale to fit rather than the other way round.
    const size = share.size ?? sizes.get(share.sessionId);
    if (size) publishSize(share.sessionId, size.cols, size.rows);
  });

  socket.on('message', (data, isBinary) => {
    if (isBinary) onOwnerFrame(share, toBuffer(data));
    else onOwnerControl(share, toBuffer(data));
  });

  socket.on('close', (code, reason) => {
    share.socket = null;
    if (share.stopped) return;
    // 4000-4005 are the relay's own verdicts: the share is gone, so there is
    // nothing to reconnect to.
    if (code >= 4000 && code <= 4005) {
      finishShare(share, reason.toString() || 'closed');
      return;
    }
    scheduleOwnerReconnect(share);
  });

  socket.on('error', () => {
    // 'close' always follows; reconnection is handled there.
  });
}

function scheduleOwnerReconnect(share) {
  const delay = RECONNECT_DELAYS_MS[share.attempt];
  if (delay === undefined) {
    finishShare(share, 'unreachable');
    return;
  }
  share.attempt += 1;
  share.status = 'reconnecting';
  emitOwner(share);
  share.retryTimer = setTimeout(() => connectOwner(share), delay);
}

function onOwnerFrame(share, frame) {
  const opened = unseal(share, frame);
  if (!opened || opened.type !== FRAME_TYPE.input) return;
  // The relay only forwards keystrokes from the baton holder, but the owner
  // is the one that actually writes to the terminal, so it checks too.
  if (share.baton !== opened.memberId) return;
  writeToTerminal(share, opened.plaintext.toString('utf8'));
}

function onOwnerControl(share, data) {
  const message = parseControl(data);
  if (!message) return;

  switch (message.type) {
    case 'welcome':
      share.members = message.members;
      share.baton = message.baton;
      share.maxViewers = message.max_viewers;
      share.expiresAt = message.expires_at;
      emitOwner(share);
      return;
    case 'joined':
      share.members = [...share.members.filter((m) => m.id !== message.member.id), message.member];
      emitOwner(share);
      notify('share:event', { kind: 'joined', sessionId: share.sessionId, member: message.member });
      // Viewers get no backlog, so the size is the one thing they need before
      // the next byte of output arrives.
      if (share.size) publishSize(share.sessionId, share.size.cols, share.size.rows);
      return;
    case 'left': {
      const gone = share.members.find((m) => m.id === message.member_id);
      share.members = share.members.filter((m) => m.id !== message.member_id);
      emitOwner(share);
      if (gone) notify('share:event', { kind: 'left', sessionId: share.sessionId, member: gone });
      return;
    }
    case 'baton':
      share.baton = message.holder;
      emitOwner(share);
      return;
    case 'control_requested':
      notify('share:event', {
        kind: 'control_requested',
        sessionId: share.sessionId,
        member: share.members.find((m) => m.id === message.member_id) ?? null,
      });
      return;
    case 'typing':
      notify('share:event', {
        kind: 'typing',
        sessionId: share.sessionId,
        memberId: message.member_id,
      });
      return;
    case 'closed':
      finishShare(share, message.reason);
      return;
    default:
  }
}

function writeToTerminal(share, data) {
  if (share.kind === 'local') localTerm.write(share.sessionId, data);
  else if (share.kind === 'serial') serial.write(share.sessionId, data);
  else ssh.write(share.sessionId, data);
}

/** Terminal output on its way to the viewers. Called for every session; only
 *  the shared ones cost anything. */
function publishOutput(sessionId, data) {
  const share = owned.get(sessionId);
  if (!share || share.socket?.readyState !== WebSocket.OPEN || !data) return;
  for (const part of frames.chunk(Buffer.from(data, 'utf8'))) {
    share.socket.send(seal(share, FRAME_TYPE.output, part), { binary: true });
  }
}

/**
 * Every terminal's size is remembered, shared or not: a session sizes itself
 * once when it opens and then rarely again, so a share that starts later would
 * otherwise have nothing to tell its first viewer until the window happens to
 * be resized.
 */
function publishSize(sessionId, cols, rows) {
  sizes.set(sessionId, { cols, rows });
  const share = owned.get(sessionId);
  if (!share) return;
  share.size = { cols, rows };
  if (share.socket?.readyState !== WebSocket.OPEN) return;
  const payload = Buffer.from(JSON.stringify({ cols, rows }), 'utf8');
  share.socket.send(seal(share, FRAME_TYPE.size, payload), { binary: true });
}

function grantControl(sessionId, memberId) {
  const share = owned.get(sessionId);
  if (share) sendControl(share, { type: 'grant_control', member_id: memberId });
}

function revokeControl(sessionId) {
  const share = owned.get(sessionId);
  if (share) sendControl(share, { type: 'revoke_control' });
}

function kick(sessionId, memberId) {
  const share = owned.get(sessionId);
  if (share) sendControl(share, { type: 'kick', member_id: memberId });
}

/** Ends a share from this side and tells the relay to drop everyone. */
async function stopShare(sessionId) {
  const share = owned.get(sessionId);
  if (!share) return { ok: true };
  share.stopped = true;
  sendControl(share, { type: 'stop' });
  share.socket?.close(1000, 'stopped');

  const account = sync.getAccount();
  if (account) {
    // Belt and braces: if the socket had already dropped, the relay still has
    // the share until its grace period lapses.
    await apiRequest(`/v1/share/${share.shareId}`, {
      method: 'DELETE',
      token: account.token,
    }).catch(() => {});
  }
  finishShare(share, 'stopped');
  return { ok: true };
}

function finishShare(share, reason) {
  clearTimeout(share.retryTimer);
  share.key.fill(0);
  owned.delete(share.sessionId);
  notify('share:owner', {
    sessionId: share.sessionId,
    shareId: share.shareId,
    status: 'ended',
    reason,
    members: [],
    baton: null,
  });
}

/** Terminal closed underneath us — end its share too. */
function onSessionClosed(sessionId) {
  sizes.delete(sessionId);
  if (owned.has(sessionId)) stopShare(sessionId).catch(() => {});
}

// --- viewer -----------------------------------------------------------------

function viewerState(share) {
  return {
    shareId: share.shareId,
    status: share.status,
    error: share.error,
    members: share.members,
    baton: share.baton,
    memberId: share.memberId,
    size: share.size,
    canType: share.baton !== null && share.baton === share.memberId,
  };
}

function emitViewer(share) {
  notify('share:viewer', viewerState(share));
}

/** Handles sshclient://join?s=...&k=... from the browser. */
function handleJoinLink(rawUrl) {
  let url;
  try {
    url = new URL(rawUrl);
  } catch {
    return;
  }
  if (url.protocol !== 'sshclient:' || url.hostname !== 'join') return;

  const shareId = url.searchParams.get('s') || '';
  const rawKey = url.searchParams.get('k') || '';
  if (!/^shr_[A-Za-z0-9_-]{22}$/.test(shareId) || !/^[A-Za-z0-9_-]{43}$/.test(rawKey)) {
    notify('share:invite', { status: 'invalid' });
    return;
  }
  const key = Buffer.from(rawKey, 'base64url');
  if (key.length !== 32) {
    notify('share:invite', { status: 'invalid' });
    return;
  }

  // A link can land before the app is ready to use it. Hold it — briefly —
  // so unlocking or signing in picks up where the link left off.
  if (!vault.isUnlocked() || !sync.getAccount()) {
    pendingJoin = { shareId, key, expiresAt: Date.now() + PENDING_JOIN_TTL_MS };
    notify('share:invite', {
      status: vault.isUnlocked() ? 'needs-sign-in' : 'needs-unlock',
      shareId,
    });
    return;
  }

  joinShare(shareId, key);
}

/** Retries a held invite once the vault is open and an account is linked. */
function resumePendingJoin() {
  if (!pendingJoin) return;
  if (pendingJoin.expiresAt < Date.now()) {
    pendingJoin = null;
    return;
  }
  if (!vault.isUnlocked() || !sync.getAccount()) return;
  const { shareId, key } = pendingJoin;
  pendingJoin = null;
  joinShare(shareId, key);
}

function joinShare(shareId, key) {
  const existing = joined.get(shareId);
  if (existing) {
    notify('share:invite', { status: 'joined', shareId });
    return;
  }

  const share = {
    shareId,
    key,
    memberId: null,
    seq: 0n,
    seen: new Map(),
    status: 'connecting',
    error: null,
    members: [],
    baton: null,
    size: null,
    socket: null,
    attempt: 0,
    retryTimer: null,
    left: false,
    outSeq: 0,
  };
  joined.set(shareId, share);
  notify('share:invite', { status: 'joined', shareId });
  connectViewer(share);
}

function connectViewer(share) {
  const account = sync.getAccount();
  if (!account) {
    share.status = 'error';
    share.error = 'Signed out';
    emitViewer(share);
    return;
  }

  const socket = new WebSocket(socketUrl(share.shareId, { owner: false }), {
    headers: { Authorization: `Bearer ${account.token}` },
  });
  share.socket = socket;

  socket.on('open', () => {
    share.attempt = 0;
    share.status = 'watching';
    share.error = null;
    emitViewer(share);
  });

  socket.on('unexpected-response', (_req, res) => {
    share.error =
      res.statusCode === 409
        ? 'That terminal already has as many viewers as it allows'
        : res.statusCode === 404
          ? 'That share has ended'
          : `Could not join (${res.statusCode})`;
    share.status = 'error';
    emitViewer(share);
    leaveShare(share.shareId);
  });

  socket.on('message', (data, isBinary) => {
    if (isBinary) onViewerFrame(share, toBuffer(data));
    else onViewerControl(share, toBuffer(data));
  });

  socket.on('close', (code, reason) => {
    share.socket = null;
    if (share.left) return;
    if (code >= 4000 && code <= 4005) {
      endViewer(share, closeReason(code, reason.toString()));
      return;
    }
    const delay = RECONNECT_DELAYS_MS[share.attempt];
    if (delay === undefined) {
      endViewer(share, 'Lost contact with the share');
      return;
    }
    share.attempt += 1;
    share.status = 'reconnecting';
    emitViewer(share);
    share.retryTimer = setTimeout(() => connectViewer(share), delay);
  });

  socket.on('error', () => {
    // 'close' or 'unexpected-response' always follows.
  });
}

function closeReason(code, reason) {
  if (code === 4001) return 'The owner removed you from this terminal';
  if (code === 4002) return 'That terminal already has as many viewers as it allows';
  if (code === 4003) return 'Your connection could not keep up';
  if (code === 4005) return 'The owner disconnected';
  if (reason === 'expired') return 'The share expired';
  return 'The owner ended the share';
}

function onViewerFrame(share, frame) {
  const opened = unseal(share, frame);
  // Only the owner is allowed to describe the terminal.
  if (!opened || opened.memberId !== 0) return;

  if (opened.type === FRAME_TYPE.output) {
    share.outSeq += 1;
    notify('share:data', {
      sessionId: share.shareId,
      data: opened.plaintext.toString('utf8'),
      seq: share.outSeq,
    });
    return;
  }
  if (opened.type === FRAME_TYPE.size) {
    try {
      const { cols, rows } = JSON.parse(opened.plaintext.toString('utf8'));
      if (Number.isInteger(cols) && Number.isInteger(rows)) {
        share.size = { cols, rows };
        notify('share:size', { sessionId: share.shareId, cols, rows });
        emitViewer(share);
      }
    } catch {
      /* a malformed size frame is not worth ending a session over */
    }
  }
}

function onViewerControl(share, data) {
  const message = parseControl(data);
  if (!message) return;

  switch (message.type) {
    case 'welcome':
      share.memberId = message.member_id;
      share.members = message.members;
      share.baton = message.baton;
      emitViewer(share);
      return;
    case 'joined':
      share.members = [...share.members.filter((m) => m.id !== message.member.id), message.member];
      emitViewer(share);
      return;
    case 'left':
      share.members = share.members.filter((m) => m.id !== message.member_id);
      emitViewer(share);
      return;
    case 'baton':
      share.baton = message.holder;
      emitViewer(share);
      notify('share:event', {
        kind: 'baton',
        sessionId: share.shareId,
        memberId: message.holder,
        mine: message.holder === share.memberId,
      });
      return;
    case 'typing':
      notify('share:event', {
        kind: 'typing',
        sessionId: share.shareId,
        memberId: message.member_id,
      });
      return;
    case 'closed':
      endViewer(share, closeReason(4000, message.reason));
      return;
    default:
  }
}

function requestControl(shareId) {
  const share = joined.get(shareId);
  if (share) sendControl(share, { type: 'request_control' });
}

/** Hands the keyboard back without waiting to be asked. */
function releaseControl(shareId) {
  const share = joined.get(shareId);
  if (share) sendControl(share, { type: 'revoke_control' });
}

function sendInput(shareId, data) {
  const share = joined.get(shareId);
  if (!share || share.socket?.readyState !== WebSocket.OPEN) return;
  if (share.baton === null || share.baton !== share.memberId) return;
  for (const part of frames.chunk(Buffer.from(data, 'utf8'))) {
    share.socket.send(seal(share, FRAME_TYPE.input, part), { binary: true });
  }
  sendControl(share, { type: 'typing' });
}

function leaveShare(shareId) {
  const share = joined.get(shareId);
  if (!share) return { ok: true };
  share.left = true;
  clearTimeout(share.retryTimer);
  share.socket?.close(1000, 'left');
  share.key.fill(0);
  joined.delete(shareId);
  return { ok: true };
}

function endViewer(share, reason) {
  clearTimeout(share.retryTimer);
  share.left = true;
  share.key.fill(0);
  joined.delete(share.shareId);
  notify('share:closed', { sessionId: share.shareId, reason });
}

/** The state a freshly mounted viewer tab needs to draw itself. */
function viewerAttach(shareId) {
  const share = joined.get(shareId);
  if (!share) return { missing: true };
  return { ...viewerState(share), backlog: '', lastSeq: share.outSeq };
}

function listViewers() {
  return [...joined.values()].map(viewerState);
}

function listShares() {
  return [...owned.values()].map(ownerState);
}

// --- lifecycle --------------------------------------------------------------

function parseControl(data) {
  try {
    const message = JSON.parse(data.toString('utf8'));
    return message && typeof message.type === 'string' ? message : null;
  } catch {
    return null;
  }
}

function toBuffer(data) {
  if (Buffer.isBuffer(data)) return data;
  if (Array.isArray(data)) return Buffer.concat(data);
  return Buffer.from(data);
}

/** Called when the account changes, which is when a held invite can proceed. */
function onAccountChanged() {
  resumePendingJoin();
}

function onVaultLocked() {
  shutdown('locked');
}

function openLink(url) {
  shell.openExternal(url);
}

/** Ends every share this app is part of. */
function shutdown(reason = 'shutdown') {
  for (const share of [...owned.values()]) {
    share.stopped = true;
    sendControl(share, { type: 'stop' });
    share.socket?.close(1000, reason);
    finishShare(share, reason);
  }
  for (const shareId of [...joined.keys()]) leaveShare(shareId);
  pendingJoin = null;
}

module.exports = {
  setNotifier,
  startShare,
  stopShare,
  grantControl,
  revokeControl,
  kick,
  publishOutput,
  publishSize,
  onSessionClosed,
  listShares,
  handleJoinLink,
  joinShare,
  leaveShare,
  requestControl,
  releaseControl,
  sendInput,
  viewerAttach,
  listViewers,
  onAccountChanged,
  onVaultLocked,
  openLink,
  shutdown,
};
