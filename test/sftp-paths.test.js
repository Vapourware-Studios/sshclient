const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const ssh = require('../src/main/ssh');

test('rejects unsafe server-supplied SFTP names', () => {
  for (const name of ['', '.', '..', '../escape', 'nested/file', 'nested\\file']) {
    assert.throws(() => ssh.assertSafeSftpName(name), /Unsafe filename/);
  }

  assert.equal(ssh.assertSafeSftpName('report.txt'), 'report.txt');
});

test('joins only traversal-free remote relative paths', () => {
  assert.equal(ssh.joinRemotePath('/destination', 'nested/file.txt'), '/destination/nested/file.txt');
  assert.throws(() => ssh.joinRemotePath('/destination', 'nested/../../escape'), /Unsafe filename/);
  assert.throws(() => ssh.joinRemotePath('/destination', '/absolute'), /Unsafe filename/);
});

test('resolves local downloads beneath the selected directory', () => {
  const root = path.resolve('selected-download-directory');

  assert.equal(
    ssh.resolveLocalChild(root, 'nested/file.txt'),
    path.join(root, 'nested', 'file.txt')
  );
  assert.throws(() => ssh.resolveLocalChild(root, '../escape'), /Unsafe filename/);
  assert.throws(() => ssh.resolveLocalChild(root, 'nested\\..\\escape'), /Unsafe filename/);
});
