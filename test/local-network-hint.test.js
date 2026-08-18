const assert = require('node:assert/strict');
const test = require('node:test');
const ssh = require('../src/main/ssh');

test('isLocalNetworkHost recognises addresses on the attached network', () => {
  for (const host of ['192.168.1.1', '10.0.0.5', '172.16.4.2', '172.31.0.1', '169.254.1.1', 'nas.local', 'fe80::1', '[fd00::1]']) {
    assert.equal(ssh.isLocalNetworkHost(host), true, host);
  }
});

test('isLocalNetworkHost leaves routable addresses alone', () => {
  for (const host of ['152.67.97.4', '2001:470:811::1', 'example.com', '172.32.0.1', '8.8.8.8', '']) {
    assert.equal(ssh.isLocalNetworkHost(host), false, host);
  }
});

test('describeConnectError points at the macOS local network setting', (t) => {
  const platform = process.platform;
  Object.defineProperty(process, 'platform', { value: 'darwin', configurable: true });
  t.after(() => Object.defineProperty(process, 'platform', { value: platform, configurable: true }));

  const err = Object.assign(new Error('connect EHOSTUNREACH 192.168.1.1:22'), { code: 'EHOSTUNREACH' });
  assert.match(ssh.describeConnectError(err, '192.168.1.1'), /Local Network/);

  // A routable host that is genuinely unreachable keeps its own message.
  assert.equal(ssh.describeConnectError(err, '152.67.97.4'), 'connect EHOSTUNREACH 192.168.1.1:22');

  // So does a different failure to the same host.
  const refused = Object.assign(new Error('connect ECONNREFUSED 192.168.1.1:22'), { code: 'ECONNREFUSED' });
  assert.equal(ssh.describeConnectError(refused, '192.168.1.1'), 'connect ECONNREFUSED 192.168.1.1:22');
});

test('describeConnectError stays quiet off macOS', (t) => {
  const platform = process.platform;
  Object.defineProperty(process, 'platform', { value: 'linux', configurable: true });
  t.after(() => Object.defineProperty(process, 'platform', { value: platform, configurable: true }));

  const err = Object.assign(new Error('connect EHOSTUNREACH 192.168.1.1:22'), { code: 'EHOSTUNREACH' });
  assert.equal(ssh.describeConnectError(err, '192.168.1.1'), 'connect EHOSTUNREACH 192.168.1.1:22');
});
