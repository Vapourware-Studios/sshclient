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
//
// The relay routes; it never decides. Who holds the keyboard is this app's own
// `granted`, not whatever the relay last claimed, and a share link opens a
// terminal only once the person in front of the app has said yes to it.
const crypto = require('crypto');
const WebSocket = require('ws');
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

// A join link waits this long to be answered before it is dropped.
const PENDING_JOIN_TTL_MS = 5 * 60 * 1000;

// The far end only re-arms a 1.5s "still typing" marker, so saying so more
// often than this is work nobody can see.
const TYPING_PING_MS = 1200;

const owned = new Map(); // terminal sessionId -> owner share
const joined = new Map(); // shareId -> viewer share
const sizes = new Map(); // terminal sessionId -> last known { cols, rows }
const starting = new Map(); // terminal sessionId -> in-flight startShare
let pendingJoin = null;
let notify = () => {};

function setNotifier(fn) {
  notify = fn;
}

// --- framing ----------------------------------------------------------------

/** Seals one frame for a share and advances its sequence number. */
function seal(share, type, plaintext) {
  const frame = frames.seal(
    { key: share.key, shareId: share.aad, memberId: share.memberId, seq: share.seq, type },
    plaintext,
  );
  share.seq += 1n;
  return frame;
}

function unseal(share, frame) {
  if (!share.key) return null;
  return frames.open({ key: share.key, shareId: share.aad, seen: share.seen }, frame);
}

// --- transport --------------------------------------------------------------

function requireAccount() {
  const account = sync.getAccount();
  if (!account) throw new Error('Sign in to share a terminal');
  return account;
}

function socketUrl(shareId, { owner }) {
  const { apiUrl } = sync.getUrls();
  const url = new URL(`${apiUrl}/v1/share/${shareId}/ws`);
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
  if (owner) url.searchParams.set('role', 'owner');
  return url.toString();
}

function joinLink(shareId, key) {
  const { apiUrl } = sync.getUrls();
  return `${apiUrl}/join#s=${shareId}&k=${key.toString('base64url')}`;
}

function sendControl(share, message) {
  if (share.socket?.readyState === WebSocket.OPEN) {
    share.socket.send(JSON.stringify(message));
  }
}

/**
 * Takes a share out of service: unhooks the socket first, then drops the key.
 *
 * The order is the point. Wiping a key while its socket is still delivering
 * frames is worse than doing neither, because an all-zero buffer is a valid
 * AES key — frames forged under it would authenticate, and on the owner's side
 * that means bytes reaching a shell the relay was never supposed to touch.
 * Nulling the key rather than zeroing it means anything that still slips
 * through fails to open instead of opening into attacker-chosen input.
 */
function retire(share, reason) {
  clearTimeout(share.retryTimer);
  share.retryTimer = null;
  share.dead = true;

  const socket = share.socket;
  share.socket = null;
  if (socket) {
    socket.removeAllListeners();
    socket.on('error', () => {}); // closing mid-handshake still emits one
    try {
      socket.close(1000, reason);
    } catch {
      /* already gone */
    }
  }

  share.key = null;
}

/**
 * Backs off and tries again, or gives up. Owner and viewer differ only in what
 * they reconnect with and what they say when they stop trying.
 */
function scheduleReconnect(share, { connect, emit, giveUp }) {
  const delay = RECONNECT_DELAYS_MS[share.attempt];
  if (delay === undefined) {
    giveUp();
    return;
  }
  share.attempt += 1;
  share.status = 'reconnecting';
  emit(share);
  share.retryTimer = setTimeout(() => connect(share), delay);
}

function connectedAccount(share, emit) {
  const account = sync.getAccount();
  if (!account) {
    share.status = 'error';
    share.error = 'Signed out';
    emit(share);
    return null;
  }
  return account;
}

function upsertMember(members, member) {
  return [...members.filter((m) => m.id !== member.id), member];
}

function removeMember(members, id) {
  return members.filter((m) => m.id !== id);
}

function isMember(member) {
  return Boolean(member) && typeof member === 'object' && Number.isInteger(member.id);
}

function asMembers(members) {
  return Array.isArray(members) && members.every(isMember) ? members : null;
}

function isMemberId(value) {
  return value === null || Number.isInteger(value);
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
    baton: share.granted,
    maxViewers: share.maxViewers,
    expiresAt: share.expiresAt,
  };
}

function emitOwner(share) {
  notify('share:owner', ownerState(share));
}

/** Opens a share for a terminal that is already running. */
function startShare(sessionId, kind) {
  const existing = owned.get(sessionId);
  if (existing) return Promise.resolve(ownerState(existing));
  // The relay is asked for a share id before anything lands in `owned`, so
  // without this a second call would open a second share and orphan the first:
  // still live, still streaming, and with a link nothing left here can revoke.
  const inFlight = starting.get(sessionId);
  if (inFlight) return inFlight;

  const attempt = (async () => {
    const account = requireAccount();
    const created = await sync.api('/v1/share', { method: 'POST', token: account.token });
    const key = crypto.randomBytes(32);

    const share = {
      sessionId,
      kind,
      shareId: created.share_id,
      aad: Buffer.from(created.share_id, 'utf8'),
      key,
      memberId: 0,
      seq: 0n,
      seen: new Map(),
      link: joinLink(created.share_id, key),
      maxViewers: created.max_viewers,
      expiresAt: created.expires_at,
      status: 'connecting',
      error: null,
      members: [],
      // Who this app has handed the keyboard to. Not a copy of anything the
      // relay says — the relay's version is reconciled against this one.
      granted: null,
      socket: null,
      attempt: 0,
      retryTimer: null,
      dead: false,
    };
    owned.set(sessionId, share);
    connectOwner(share);
    return ownerState(share);
  })().finally(() => starting.delete(sessionId));

  starting.set(sessionId, attempt);
  return attempt;
}

function connectOwner(share) {
  const account = connectedAccount(share, emitOwner);
  if (!account) return;

  const socket = new WebSocket(socketUrl(share.shareId, { owner: true }), {
    headers: { Authorization: `Bearer ${account.token}` },
  });
  share.socket = socket;

  socket.on('open', () => {
    share.attempt = 0;
    share.status = 'live';
    share.error = null;
    emitOwner(share);
    resendSize(share);
  });

  socket.on('message', (data, isBinary) => {
    if (share.dead) return;
    if (isBinary) onOwnerFrame(share, toBuffer(data));
    else onOwnerControl(share, toBuffer(data));
  });

  socket.on('close', (code, reason) => {
    share.socket = null;
    if (share.dead) return;
    // 4000-4005 are the relay's own verdicts: the share is gone, so there is
    // nothing to reconnect to.
    if (code >= 4000 && code <= 4005) {
      finishShare(share, reason.toString() || 'closed');
      return;
    }
    scheduleReconnect(share, {
      connect: connectOwner,
      emit: emitOwner,
      giveUp: () => finishShare(share, 'unreachable'),
    });
  });

  socket.on('error', () => {
    // 'close' always follows; reconnection is handled there.
  });
}

function onOwnerFrame(share, frame) {
  const opened = unseal(share, frame);
  if (!opened || opened.type !== FRAME_TYPE.input) return;
  // Whose keystrokes may reach the shell is this app's decision, kept in
  // `granted`. The relay's view of it is a claim, never an authorisation.
  if (share.granted === null || share.granted !== opened.memberId) return;
  writeToTerminal(share, opened.plaintext.toString('utf8'));
}

/**
 * Squares the relay's account of who is typing with this app's own.
 *
 * The asymmetry is deliberate. A relay taking the keyboard away is believed —
 * it can drop keystrokes whatever this app thinks, and it does exactly that
 * when a holder disconnects. A relay *handing out* the keyboard is corrected,
 * because believing it would let a compromised one seat a guest at the shell
 * and have the owner's own check wave them through on the strength of the
 * same message that invented them. Either way `granted` decides what reaches
 * the terminal, so a relay that ignores the correction gains nothing.
 *
 * Returns whether this app's own view moved.
 */
function reconcileBaton(share, claimed) {
  if (claimed === share.granted) return false;
  if (claimed === null) {
    share.granted = null;
    return true;
  }
  if (share.granted === null) sendControl(share, { type: 'revoke_control' });
  else sendControl(share, { type: 'grant_control', member_id: share.granted });
  return false;
}

function onOwnerControl(share, data) {
  const message = parseControl(data);
  if (!message) return;

  switch (message.type) {
    case 'welcome':
      if (
        !Number.isInteger(message.max_viewers) ||
        !isMemberId(message.baton) ||
        (message.expires_at !== undefined &&
          message.expires_at !== null &&
          typeof message.expires_at !== 'string')
      ) {
        return;
      }
      {
        const members = asMembers(message.members);
        if (!members) return;
        share.members = members;
      }
      share.maxViewers = message.max_viewers;
      share.expiresAt = message.expires_at;
      // A reconnect lands here; the relay may have forgotten who was typing.
      reconcileBaton(share, message.baton);
      emitOwner(share);
      return;
    case 'joined':
      if (!isMember(message.member)) return;
      share.members = upsertMember(share.members, message.member);
      emitOwner(share);
      notify('share:event', { kind: 'joined', sessionId: share.sessionId, member: message.member });
      resendSize(share);
      return;
    case 'left': {
      if (!Number.isInteger(message.member_id)) return;
      const gone = share.members.find((m) => m.id === message.member_id);
      share.members = removeMember(share.members, message.member_id);
      if (share.granted === message.member_id) share.granted = null;
      emitOwner(share);
      if (gone) notify('share:event', { kind: 'left', sessionId: share.sessionId, member: gone });
      return;
    }
    case 'baton':
      if (!isMemberId(message.holder)) return;
      if (reconcileBaton(share, message.holder)) emitOwner(share);
      return;
    case 'control_requested':
      if (!Number.isInteger(message.member_id)) return;
      notify('share:event', {
        kind: 'control_requested',
        sessionId: share.sessionId,
        member: share.members.find((m) => m.id === message.member_id) ?? null,
      });
      return;
    case 'typing':
      if (!Number.isInteger(message.member_id)) return;
      notify('share:event', {
        kind: 'typing',
        sessionId: share.sessionId,
        memberId: message.member_id,
      });
      return;
    case 'closed':
      if (message.reason !== undefined && typeof message.reason !== 'string') return;
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
  if (!share || share.socket?.readyState !== WebSocket.OPEN) return;
  const payload = Buffer.from(JSON.stringify({ cols, rows }), 'utf8');
  share.socket.send(seal(share, FRAME_TYPE.size, payload), { binary: true });
}

/**
 * Viewers get no backlog, so the owner's grid is the one thing they need
 * before the next byte of output arrives. This terminal is the authority on
 * it; their views scale to fit rather than the other way round.
 */
function resendSize(share) {
  const size = sizes.get(share.sessionId);
  if (size) publishSize(share.sessionId, size.cols, size.rows);
}

function grantControl(sessionId, memberId) {
  const share = owned.get(sessionId);
  if (!share) return;
  share.granted = memberId;
  sendControl(share, { type: 'grant_control', member_id: memberId });
  emitOwner(share);
}

function revokeControl(sessionId) {
  const share = owned.get(sessionId);
  if (!share) return;
  share.granted = null;
  sendControl(share, { type: 'revoke_control' });
  emitOwner(share);
}

function kick(sessionId, memberId) {
  const share = owned.get(sessionId);
  if (!share) return;
  if (share.granted === memberId) share.granted = null;
  sendControl(share, { type: 'kick', member_id: memberId });
  emitOwner(share);
}

/**
 * Says, over every channel there is, that this share is over.
 *
 * `stop` on its own is what ends a share, but it only ends it as fast as the
 * relay chooses to act on it, and the relay's own instinct on losing an owner
 * is to hold the share open for 30s in case they come back. That grace is
 * right for a dropped connection and wrong for a shell that has exited: the
 * terminal behind it is already gone, so every extra second is somebody
 * watching a session that no longer exists. Naming each member as well means
 * the sockets are dropped by the same path the owner's own kick button uses,
 * which needs no grace to expire first.
 */
function evictAll(share) {
  for (const member of share.members) {
    if (member.id !== 0) sendControl(share, { type: 'kick', member_id: member.id });
  }
  sendControl(share, { type: 'stop' });
}

/**
 * The one path that does not go through the socket. If the socket had already
 * dropped, nothing above was heard and the relay still has the share; this is
 * what ends it then.
 */
function deleteShare(shareId) {
  const account = sync.getAccount();
  if (!account) return Promise.resolve();
  return sync
    .api(`/v1/share/${shareId}`, { method: 'DELETE', token: account.token })
    .catch(() => {});
}

/** Ends a share from this side and tells the relay to drop everyone. */
async function stopShare(sessionId) {
  const share = owned.get(sessionId);
  if (!share) return { ok: true };
  const { shareId } = share;
  evictAll(share);
  finishShare(share, 'stopped');
  await deleteShare(shareId);
  return { ok: true };
}

function finishShare(share, reason) {
  retire(share, reason);
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

/**
 * Terminal closed underneath us — end its share too, and now rather than
 * whenever the relay next thinks about it. There is nothing left to watch:
 * the shell these people were looking at has exited.
 */
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

/**
 * Handles sshclient://join?s=...&k=... from the browser.
 *
 * A protocol handler fires for any page the user happens to visit, so landing
 * here is not consent. The link is parked and the app asks; only `acceptInvite`
 * opens a terminal. Auto-joining instead would let a page attach this app to a
 * relay it controls, foreground the tab, and — by claiming the keyboard is
 * ours — collect whatever the user typed next.
 */
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

  pendingJoin = { shareId, key, expiresAt: Date.now() + PENDING_JOIN_TTL_MS };
  offerPendingJoin();
}

/**
 * Puts the parked invite to the user in whatever terms the app can act on
 * right now — a link can land before the vault is open or an account linked.
 */
function offerPendingJoin() {
  if (!pendingJoin) return;
  if (pendingJoin.expiresAt < Date.now()) {
    pendingJoin = null;
    return;
  }

  const { shareId } = pendingJoin;
  if (!vault.isUnlocked()) {
    notify('share:invite', { status: 'needs-unlock', shareId });
    return;
  }
  if (!sync.getAccount()) {
    notify('share:invite', { status: 'needs-sign-in', shareId });
    return;
  }
  if (joined.has(shareId)) {
    pendingJoin = null;
    notify('share:invite', { status: 'joined', shareId });
    return;
  }
  notify('share:invite', { status: 'confirm', shareId });
}

/** The user said yes. The only route into `joinShare`. */
function acceptInvite(shareId) {
  if (!pendingJoin || pendingJoin.shareId !== shareId) return { ok: false };
  if (pendingJoin.expiresAt < Date.now()) {
    pendingJoin = null;
    return { ok: false };
  }
  if (!vault.isUnlocked() || !sync.getAccount()) return { ok: false };

  const { key } = pendingJoin;
  pendingJoin = null;
  joinShare(shareId, key);
  return { ok: true };
}

/** The user said no, or closed the invite. */
function declineInvite() {
  pendingJoin = null;
  return { ok: true };
}

function joinShare(shareId, key) {
  if (joined.has(shareId)) {
    notify('share:invite', { status: 'joined', shareId });
    return;
  }

  const share = {
    shareId,
    aad: Buffer.from(shareId, 'utf8'),
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
    dead: false,
    outSeq: 0,
    lastTypingPing: 0,
  };
  joined.set(shareId, share);
  notify('share:invite', { status: 'joined', shareId });
  connectViewer(share);
}

function connectViewer(share) {
  const account = connectedAccount(share, emitViewer);
  if (!account) return;

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

  // The handshake was refused outright, so there is no session to keep — say
  // why and take the tab away rather than leave it watching nothing.
  socket.on('unexpected-response', (_req, res) => {
    endViewer(
      share,
      res.statusCode === 409
        ? closeReason(4002, '')
        : res.statusCode === 404
          ? 'That share has ended'
          : `Could not join (${res.statusCode})`,
    );
  });

  socket.on('message', (data, isBinary) => {
    if (share.dead) return;
    if (isBinary) onViewerFrame(share, toBuffer(data));
    else onViewerControl(share, toBuffer(data));
  });

  socket.on('close', (code, reason) => {
    share.socket = null;
    if (share.dead) return;
    if (code >= 4000 && code <= 4005) {
      endViewer(share, closeReason(code, reason.toString()));
      return;
    }
    scheduleReconnect(share, {
      connect: connectViewer,
      emit: emitViewer,
      giveUp: () => endViewer(share, 'Lost contact with the share'),
    });
  });

  socket.on('error', () => {
    // 'close' or 'unexpected-response' always follows.
  });
}

function closeReason(code, reason) {
  if (code === 4001) return 'You have been removed from this terminal by the owner.';
  if (code === 4002) return 'This terminal has reached its maximum number of viewers.';
  if (code === 4003) return 'The network connection was lost.';
  if (code === 4005) return 'The owner has disconnected.';
  if (reason === 'expired') return 'The share expired.';
  return 'The owner has ended the sharing session.';
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
      if (!Number.isInteger(message.member_id) || !isMemberId(message.baton)) return;
      {
        const members = asMembers(message.members);
        if (!members) return;
        share.memberId = message.member_id;
        share.members = members;
      }
      share.baton = message.baton;
      emitViewer(share);
      return;
    case 'joined':
      if (!isMember(message.member)) return;
      share.members = upsertMember(share.members, message.member);
      emitViewer(share);
      return;
    case 'left':
      if (!Number.isInteger(message.member_id)) return;
      share.members = removeMember(share.members, message.member_id);
      emitViewer(share);
      return;
    case 'baton':
      if (!isMemberId(message.holder)) return;
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
      if (!Number.isInteger(message.member_id)) return;
      notify('share:event', {
        kind: 'typing',
        sessionId: share.shareId,
        memberId: message.member_id,
      });
      return;
    case 'closed':
      if (message.reason !== undefined && typeof message.reason !== 'string') return;
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
  if (typeof data !== 'string' || data === '') return;
  if (share.baton === null || share.baton !== share.memberId) return;

  for (const part of frames.chunk(Buffer.from(data, 'utf8'))) {
    share.socket.send(seal(share, FRAME_TYPE.input, part), { binary: true });
  }

  const now = Date.now();
  if (now - share.lastTypingPing >= TYPING_PING_MS) {
    share.lastTypingPing = now;
    sendControl(share, { type: 'typing' });
  }
}

/** Leaves a share this app is watching, because the user closed its tab. */
function leaveShare(shareId) {
  const share = joined.get(shareId);
  if (!share) return { ok: true };
  retire(share, 'left');
  joined.delete(shareId);
  // The renderer keys viewer tabs off this; without it the entry outlives the
  // tab and the next event from any other share brings the tab back.
  notify('share:closed', { sessionId: shareId, reason: null });
  return { ok: true };
}

/** The share went away on its own — say why. */
function endViewer(share, reason) {
  retire(share, 'ended');
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

/** Called when the account changes, which is when a held invite can be put. */
function onAccountChanged() {
  offerPendingJoin();
}

function onVaultLocked() {
  shutdown('locked');
}

/** Ends every share this app is part of. */
function shutdown(reason = 'shutdown') {
  for (const share of [...owned.values()]) {
    const { shareId } = share;
    evictAll(share);
    finishShare(share, reason);
    // Not awaited: locking the vault must not wait on the network, and the
    // sockets have already been told.
    deleteShare(shareId);
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
  acceptInvite,
  declineInvite,
  leaveShare,
  requestControl,
  releaseControl,
  sendInput,
  viewerAttach,
  listViewers,
  onAccountChanged,
  onVaultLocked,
  shutdown,
};
