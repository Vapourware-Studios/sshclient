const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const test = require('node:test');
const ssh = require('../src/main/ssh');

function makeStream() {
  const stream = new EventEmitter();
  stream.stderr = new EventEmitter();
  stream.written = '';
  stream.end = (data) => {
    if (data) stream.written += data;
  };
  return stream;
}

function fakeConn({ exitCode = 0, stderrText = '' } = {}) {
  let capturedCmd;
  let stream;
  return {
    exec(cmd, cb) {
      capturedCmd = cmd;
      stream = makeStream();
      cb(null, stream);
      queueMicrotask(() => {
        if (stderrText) stream.stderr.emit('data', Buffer.from(stderrText));
        stream.emit('close', exitCode);
      });
    },
    get capturedCmd() {
      return capturedCmd;
    },
    get stream() {
      return stream;
    },
  };
}

test('installPublicKeyAsync writes the key line to stdin and resolves on success', async () => {
  const conn = fakeConn({ exitCode: 0 });
  await ssh.installPublicKeyAsync(conn, 'ssh-ed25519 AAAAtest comment\n');

  assert.equal(conn.stream.written, 'ssh-ed25519 AAAAtest comment\n');
  assert.match(conn.capturedCmd, /mkdir -p ~\/\.ssh/);
  assert.match(conn.capturedCmd, /authorized_keys/);
  assert.match(conn.capturedCmd, /KEY_LINE=\$\(cat\)/);
});

test('installPublicKeyAsync rejects with stderr text on nonzero exit', async () => {
  const conn = fakeConn({ exitCode: 1, stderrText: 'permission denied' });
  await assert.rejects(
    ssh.installPublicKeyAsync(conn, 'ssh-ed25519 AAAAtest comment'),
    /permission denied/
  );
});

test('installPublicKeyAsync rejects a key containing a newline without touching the connection', async () => {
  const conn = fakeConn();
  await assert.rejects(
    ssh.installPublicKeyAsync(conn, 'ssh-ed25519 AAAAtest\nssh-ed25519 AAAAother'),
    /unexpected format/
  );
  assert.equal(conn.capturedCmd, undefined);
});

test('installPublicKeyAsync rejects an empty key', async () => {
  const conn = fakeConn();
  await assert.rejects(ssh.installPublicKeyAsync(conn, '   '), /unexpected format/);
});
