const assert = require('node:assert/strict');
const test = require('node:test');
const localNetwork = require('../src/main/localNetwork');

test('classifyProbeError treats a refusal and an unreachable network alike', () => {
  for (const code of ['EHOSTUNREACH', 'ENETUNREACH', 'EPERM', 'EACCES']) {
    assert.equal(localNetwork.classifyProbeError({ code }), 'denied', code);
  }
});

test('classifyProbeError reports success and stays honest about the rest', () => {
  assert.equal(localNetwork.classifyProbeError(null), 'allowed');
  assert.equal(localNetwork.classifyProbeError(undefined), 'allowed');
  assert.equal(localNetwork.classifyProbeError({ code: 'EMSGSIZE' }), 'unknown');
});

test('the probe sends a well-formed mDNS service-enumeration query', () => {
  const q = localNetwork.buildServiceQuery();

  assert.equal(q.readUInt16BE(0), 0, 'mDNS queries carry no transaction id');
  assert.equal(q.readUInt16BE(2), 0, 'no flags: a plain query');
  assert.equal(q.readUInt16BE(4), 1, 'exactly one question');
  assert.equal(q.readUInt16BE(6), 0, 'no answers');

  // _services._dns-sd._udp.local, length-prefixed, then PTR / IN.
  const name = q.slice(12, q.length - 4);
  const labels = [];
  for (let i = 0; i < name.length && name[i] !== 0; i += name[i] + 1) {
    labels.push(name.slice(i + 1, i + 1 + name[i]).toString('ascii'));
  }
  assert.deepEqual(labels, ['_services', '_dns-sd', '_udp', 'local']);
  assert.equal(q.readUInt16BE(q.length - 4), 12, 'PTR');
  assert.equal(q.readUInt16BE(q.length - 2), 1, 'IN');
});

test('the probe does nothing off macOS', async (t) => {
  const platform = process.platform;
  Object.defineProperty(process, 'platform', { value: 'linux', configurable: true });
  t.after(() => Object.defineProperty(process, 'platform', { value: platform, configurable: true }));

  assert.deepEqual(await localNetwork.probeLocalNetwork(), { status: 'not-applicable', code: null });
  assert.equal(localNetwork.getStatus(), 'not-applicable');
});
