const assert = require('node:assert/strict');
const test = require('node:test');
const { parseFlags, SUPPORTED_FLAGS } = require('../src/main/sshFlags');

test('empty input is not an error', () => {
  for (const input of [undefined, null, '', '   ']) {
    assert.deepEqual(parseFlags(input), { config: {}, errors: [] });
  }
});

test('OpenSSH names map onto the options ssh2 actually reads', () => {
  const { config, errors } = parseFlags('ServerAliveInterval=30 ServerAliveCountMax=4 ConnectTimeout=15');
  assert.deepEqual(errors, []);
  assert.deepEqual(config, {
    keepaliveInterval: 30000,
    keepaliveCountMax: 4,
    readyTimeout: 15000,
  });
});

test('Compression sets ssh2 compress, not compression', () => {
  const { config, errors } = parseFlags('Compression=yes');
  assert.deepEqual(errors, []);
  assert.equal(config.compress, true);
  assert.equal('compression' in config, false);
});

test('flag names are case-insensitive and ms aliases stay in ms', () => {
  assert.equal(parseFlags('compression=YES').config.compress, true);
  assert.equal(parseFlags('keepaliveInterval=30000').config.keepaliveInterval, 30000);
  assert.equal(parseFlags('readytimeout=20000').config.readyTimeout, 20000);
});

test('every boolean spelling is accepted, and nothing else is', () => {
  for (const yes of ['yes', 'true', '1', 'on', 'YES']) {
    assert.equal(parseFlags(`Compression=${yes}`).config.compress, true, yes);
  }
  for (const no of ['no', 'false', '0', 'off']) {
    assert.equal(parseFlags(`Compression=${no}`).config.compress, false, no);
  }
  const { config, errors } = parseFlags('Compression=maybe');
  assert.deepEqual(config, {});
  assert.match(errors[0], /must be yes or no/);
});

test('unsupported flags are reported, never passed through', () => {
  const { config, errors } = parseFlags('StrictHostKeyChecking=no');
  assert.deepEqual(config, {});
  assert.equal(errors.length, 1);
  assert.match(errors[0], /Unsupported flag: "StrictHostKeyChecking"/);
  for (const name of SUPPORTED_FLAGS) assert.match(errors[0], new RegExp(name));
});

test('connection identity and credentials cannot be set through flags', () => {
  for (const token of [
    'host=other.example',
    'hostname=other.example',
    'port=2222',
    'username=root',
    'password=hunter2',
    'privateKey=whatever',
    'identityFile=/tmp/id',
  ]) {
    const { config, errors } = parseFlags(token);
    assert.deepEqual(config, {}, token);
    assert.match(errors[0], /comes from the saved host/, token);
  }
});

test('numeric flags reject anything that is not a number in range', () => {
  for (const token of ['ServerAliveInterval=abc', 'ServerAliveInterval=1.5', 'ServerAliveInterval=-5']) {
    const { config, errors } = parseFlags(token);
    assert.deepEqual(config, {}, token);
    assert.match(errors[0], /whole number/, token);
  }

  const zero = parseFlags('ServerAliveInterval=0');
  assert.deepEqual(zero.config, {});
  assert.match(zero.errors[0], /between 1 and 86400/);

  const huge = parseFlags('ServerAliveInterval=99999999');
  assert.deepEqual(huge.config, {});
  assert.match(huge.errors[0], /between 1 and 86400/);
});

test('malformed tokens are reported without stopping the rest', () => {
  const { config, errors } = parseFlags('nonsense Compression=yes =30 ServerAliveInterval=');
  assert.equal(config.compress, true);
  assert.equal(errors.length, 3);
  assert.match(errors[0], /Invalid flag format: "nonsense"/);
  assert.match(errors[1], /Invalid flag format: "=30"/);
  assert.match(errors[2], /ServerAliveInterval needs a value/);
});

test('agent forwarding is refused when there is no agent to forward', () => {
  const original = process.env.SSH_AUTH_SOCK;
  try {
    process.env.SSH_AUTH_SOCK = '/tmp/agent.sock';
    assert.equal(parseFlags('ForwardAgent=yes').config.agentForward, true);

    delete process.env.SSH_AUTH_SOCK;
    const { errors } = parseFlags('ForwardAgent=yes');
    assert.match(errors[0], /needs a running SSH agent/);

    // Turning it off never needs an agent.
    assert.deepEqual(parseFlags('ForwardAgent=no').errors, []);
  } finally {
    if (original === undefined) delete process.env.SSH_AUTH_SOCK;
    else process.env.SSH_AUTH_SOCK = original;
  }
});
