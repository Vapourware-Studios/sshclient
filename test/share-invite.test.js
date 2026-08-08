const test = require('node:test');
const assert = require('node:assert/strict');
const share = require('../src/main/share');

// The vault is locked and no account is linked in here, which is the state a
// freshly launched app is in — and the state a drive-by link would find.
const SHARE_ID = 'shr_AAAAAAAAAAAAAAAAAAAAAA';
const KEY = 'A'.repeat(43);
const LINK = `sshclient://join?s=${SHARE_ID}&k=${KEY}`;

function collect(run) {
  const seen = [];
  share.setNotifier((channel, payload) => seen.push({ channel, payload }));
  try {
    run();
  } finally {
    share.setNotifier(() => {});
  }
  return seen;
}

function invites(seen) {
  return seen.filter((e) => e.channel === 'share:invite').map((e) => e.payload);
}

test.afterEach(() => {
  share.declineInvite();
});

test('a share link never joins on its own', () => {
  const seen = collect(() => share.handleJoinLink(LINK));

  // Whatever it says, it must not have opened a terminal: a protocol handler
  // fires for any page the user visits, so arriving is not consent.
  assert.deepEqual(share.listViewers(), []);
  assert.equal(invites(seen).length, 1);
});

test('a malformed link is refused outright', () => {
  for (const bad of [
    'sshclient://join?s=nope&k=' + KEY,
    `sshclient://join?s=${SHARE_ID}&k=short`,
    `sshclient://join?s=${SHARE_ID}`,
  ]) {
    const seen = collect(() => share.handleJoinLink(bad));
    assert.deepEqual(invites(seen), [{ status: 'invalid' }]);
    assert.deepEqual(share.listViewers(), []);
  }
});

test('a link for another scheme or host is not ours to answer', () => {
  const seen = collect(() => {
    share.handleJoinLink(`https://example.com/join?s=${SHARE_ID}&k=${KEY}`);
    share.handleJoinLink(`sshclient://signed-in?s=${SHARE_ID}&k=${KEY}`);
  });
  assert.deepEqual(invites(seen), []);
});

test('accepting an invite that was never offered does nothing', () => {
  assert.deepEqual(share.acceptInvite(SHARE_ID), { ok: false });
  assert.deepEqual(share.listViewers(), []);
});

test('accepting a different share than the one offered does nothing', () => {
  share.handleJoinLink(LINK);
  assert.deepEqual(share.acceptInvite('shr_BBBBBBBBBBBBBBBBBBBBBB'), { ok: false });
  assert.deepEqual(share.listViewers(), []);
});

test('an invite cannot be accepted while the vault is locked', () => {
  const seen = collect(() => share.handleJoinLink(LINK));

  // The app says what it is waiting for rather than joining behind the lock.
  assert.deepEqual(invites(seen), [{ status: 'needs-unlock', shareId: SHARE_ID }]);
  assert.deepEqual(share.acceptInvite(SHARE_ID), { ok: false });
  assert.deepEqual(share.listViewers(), []);
});

test('declining drops the held link for good', () => {
  share.handleJoinLink(LINK);
  share.declineInvite();
  assert.deepEqual(share.acceptInvite(SHARE_ID), { ok: false });
  assert.deepEqual(share.listViewers(), []);
});
