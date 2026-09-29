const assert = require('node:assert/strict');
const test = require('node:test');

test('plans where a snippet runs', async () => {
  const { planSnippetLaunch } = await import('../src/renderer/lib/snippet-launch.mjs');
  const alpha = { id: 'alpha', label: 'Alpha' };
  const beta = { id: 'beta', label: 'Beta' };
  const hosts = [alpha, beta];

  const localOnly = planSnippetLaunch({ command: 'pwd', runLocal: true }, hosts);
  assert.deepEqual(localOnly, {
    local: {},
    hosts: [],
    missingHostIds: [],
    untargeted: false,
  });

  const localDir = planSnippetLaunch(
    { command: 'pwd', runLocal: true, cwd: '  demo-workdir  ' },
    hosts
  );
  assert.deepEqual(localDir.local, {});
  assert.equal(localDir.untargeted, false);

  const mixed = planSnippetLaunch(
    { command: 'pwd', runLocal: true, cwd: 'demo-workdir', targets: ['alpha', 'gone', 'beta'] },
    hosts
  );
  assert.deepEqual(mixed.local, {});
  assert.deepEqual(mixed.hosts, [alpha, beta]);
  assert.deepEqual(mixed.missingHostIds, ['gone']);
  assert.equal(mixed.untargeted, false);

  const oneHost = planSnippetLaunch({ command: 'uptime', targets: ['alpha'] }, hosts);
  assert.equal(oneHost.local, null);
  assert.deepEqual(oneHost.hosts, [alpha]);
  assert.deepEqual(oneHost.missingHostIds, []);
  assert.equal(oneHost.untargeted, false);

  const manyHosts = planSnippetLaunch({ command: 'uptime', targets: ['beta', 'alpha'] }, hosts);
  assert.equal(manyHosts.local, null);
  assert.deepEqual(manyHosts.hosts, [beta, alpha]);
  assert.equal(manyHosts.untargeted, false);

  const neither = planSnippetLaunch({ command: 'ls' }, hosts);
  assert.equal(neither.local, null);
  assert.deepEqual(neither.hosts, []);
  assert.deepEqual(neither.missingHostIds, []);
  assert.equal(neither.untargeted, true);

  const staleCwd = planSnippetLaunch(
    { command: 'pwd', runLocal: false, cwd: 'demo-workdir' },
    hosts
  );
  assert.equal(staleCwd.local, null);
  assert.equal(staleCwd.untargeted, true);

  const missingOnly = planSnippetLaunch({ command: 'uptime', targets: ['gone'] }, hosts);
  assert.equal(missingOnly.local, null);
  assert.deepEqual(missingOnly.hosts, []);
  assert.deepEqual(missingOnly.missingHostIds, ['gone']);
  assert.equal(missingOnly.untargeted, false);
});

test('a missing host refuses the run, including when other places remain', async () => {
  const { planSnippetLaunch, snippetRunRefusal } = await import('../src/renderer/lib/snippet-launch.mjs');
  const hosts = [{ id: 'alpha', label: 'Alpha' }];
  const gone = 'Some of this snippet\u2019s targets no longer exist under Hosts';
  const none = 'None of this snippet\u2019s targets still exist under Hosts';

  assert.equal(
    snippetRunRefusal(planSnippetLaunch({ runLocal: true, targets: ['gone'] }, hosts)),
    gone
  );
  assert.equal(
    snippetRunRefusal(planSnippetLaunch({ targets: ['alpha', 'gone'] }, hosts)),
    gone
  );
  assert.equal(
    snippetRunRefusal(planSnippetLaunch({ targets: ['gone'] }, hosts)),
    none
  );
  assert.equal(snippetRunRefusal(planSnippetLaunch({ runLocal: true }, hosts)), null);
  assert.equal(snippetRunRefusal(planSnippetLaunch({ targets: ['alpha'] }, hosts)), null);
  assert.equal(snippetRunRefusal(planSnippetLaunch({ command: 'ls' }, hosts)), null);
});

function fakeShells() {
  let next = 0;
  const io = {
    localConnects: [],
    sshConnects: [],
    localWrites: [],
    sshWrites: [],
    disconnects: [],
    ready: [],
    async localConnect(config) {
      io.localConnects.push(config);
      if (config && config.fail) return { error: 'local shell failed' };
      next += 1;
      return { sessionId: `local-${next}` };
    },
    async sshConnect(config) {
      io.sshConnects.push(config);
      if (config && config.fail) return { error: 'ssh failed' };
      next += 1;
      return { sessionId: `ssh-${next}` };
    },
    localWrite(sessionId, data) {
      io.localWrites.push({ sessionId, data });
    },
    sshWrite(sessionId, data) {
      io.sshWrites.push({ sessionId, data });
    },
    async localDisconnect(sessionId) {
      io.disconnects.push({ type: 'local', sessionId });
    },
    async sshDisconnect(sessionId) {
      io.disconnects.push({ type: 'ssh', sessionId });
    },
    onSshReady(sessionId, onReady) {
      io.ready.push({ sessionId, onReady });
    },
  };
  return io;
}

test('a local-only snippet connects a shell and writes the command', async () => {
  const { deliverSnippetPlaces, placesFor, planSnippetLaunch } = await import(
    '../src/renderer/lib/snippet-launch.mjs'
  );
  const snippet = { name: 'Where', command: 'pwd', runLocal: true };
  const plan = planSnippetLaunch(snippet, []);
  const io = fakeShells();

  const claims = [];
  io.claimSession = (launch, sessionId) => {
    claims.push({ type: launch.type, sessionId, writesSoFar: io.localWrites.length });
  };

  const [outcome] = await deliverSnippetPlaces(snippet, placesFor(plan), io);

  assert.deepEqual(io.localConnects, [{}]);
  assert.equal(io.sshConnects.length, 0);
  assert.equal(outcome.delivery, 'immediate');
  assert.deepEqual(claims, [{ type: 'local', sessionId: outcome.sessionId, writesSoFar: 0 }]);
  assert.deepEqual(io.localWrites, [{ sessionId: outcome.sessionId, data: 'pwd\n' }]);
  assert.equal(io.ready.length, 0);
  assert.equal(io.sshWrites.length, 0);

  const alreadyNewline = { command: 'pwd\n', runLocal: true };
  const second = fakeShells();
  await deliverSnippetPlaces(alreadyNewline, placesFor(planSnippetLaunch(alreadyNewline, [])), second);
  assert.deepEqual(second.localWrites, [{ sessionId: 'local-1', data: 'pwd\n' }]);

  const abandoned = fakeShells();
  abandoned.isAbandoned = () => true;
  const [left] = await deliverSnippetPlaces(snippet, placesFor(plan), abandoned);
  assert.equal(left.abandoned, true);
  assert.equal(abandoned.localWrites.length, 0);
  assert.deepEqual(abandoned.disconnects, [{ type: 'local', sessionId: 'local-1' }]);
});

test('a mixed group writes the local shell now and the SSH shell when it is ready', async () => {
  const { deliverSnippetPlaces, placesFor, planSnippetLaunch } = await import(
    '../src/renderer/lib/snippet-launch.mjs'
  );
  const snippet = { name: 'Both', command: 'uptime', runLocal: true, targets: ['alpha'] };
  const hosts = [{ id: 'alpha', label: 'Alpha', host: 'example.com' }];
  const plan = planSnippetLaunch(snippet, hosts);
  const io = fakeShells();

  const outcomes = await deliverSnippetPlaces(snippet, placesFor(plan), io);

  assert.deepEqual(
    outcomes.map((outcome) => outcome.launch.type),
    ['local', 'ssh']
  );
  assert.deepEqual(io.localConnects, [{}]);
  assert.deepEqual(io.sshConnects, [{ hostId: 'alpha' }]);
  assert.equal(outcomes[0].delivery, 'immediate');
  assert.deepEqual(io.localWrites, [{ sessionId: outcomes[0].sessionId, data: 'uptime\n' }]);
  assert.equal(io.sshWrites.length, 0);
  assert.equal(outcomes[1].delivery, 'on-ready');
  assert.equal(io.ready.length, 1);
  assert.equal(io.ready[0].sessionId, outcomes[1].sessionId);

  io.ready[0].onReady();
  assert.deepEqual(io.sshWrites, [{ sessionId: outcomes[1].sessionId, data: 'uptime\n' }]);
});

test('a faster place is claimed before a slower one connects, and before its command is sent', async () => {
  const { deliverSnippetPlaces } = await import('../src/renderer/lib/snippet-launch.mjs');
  let releaseLocal;
  let releaseSsh;
  const localGate = new Promise((resolve) => {
    releaseLocal = resolve;
  });
  const sshGate = new Promise((resolve) => {
    releaseSsh = resolve;
  });
  const events = [];
  const io = fakeShells();
  io.claimSession = (launch) => {
    events.push(`claim:${launch.type}`);
  };
  io.localConnect = async () => {
    events.push('local-wait');
    await localGate;
    events.push('local-connected');
    return { sessionId: 'local-1' };
  };
  io.sshConnect = async () => {
    events.push('ssh-wait');
    await sshGate;
    events.push('ssh-connected');
    return { sessionId: 'ssh-slow' };
  };
  const recordWrite = io.localWrite;
  io.localWrite = (sessionId, data) => {
    events.push('local-write');
    recordWrite(sessionId, data);
  };

  const launches = [
    { title: 'This machine', type: 'local', connectConfig: {}, placeholderId: 'pending-local' },
    { title: 'Alpha', type: 'ssh', connectConfig: { hostId: 'alpha' }, placeholderId: 'pending-ssh' },
  ];
  const pending = deliverSnippetPlaces({ command: 'true' }, launches, io);

  assert.deepEqual(events, ['local-wait', 'ssh-wait']);

  releaseLocal();
  for (let i = 0; i < 5; i += 1) await Promise.resolve();

  assert.deepEqual(events, [
    'local-wait',
    'ssh-wait',
    'local-connected',
    'claim:local',
    'local-write',
  ]);
  assert.equal(io.sshWrites.length, 0);
  assert.equal(io.ready.length, 0);

  releaseSsh();
  const outcomes = await pending;

  assert.deepEqual(events.slice(5), ['ssh-connected', 'claim:ssh']);
  assert.equal(outcomes[0].delivery, 'immediate');
  assert.equal(outcomes[1].sessionId, 'ssh-slow');
  assert.equal(outcomes[1].delivery, 'on-ready');
  assert.equal(io.sshWrites.length, 0);
  assert.equal(io.ready[0].sessionId, 'ssh-slow');
});
