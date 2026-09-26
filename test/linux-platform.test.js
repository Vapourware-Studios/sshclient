const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const { defaultShell } = require('../src/main/shell');

test('Linux desktop launches find an executable shell without SHELL', { skip: process.platform !== 'linux' }, (t) => {
  const original = process.env.SHELL;
  delete process.env.SHELL;
  t.after(() => { if (original === undefined) delete process.env.SHELL; else process.env.SHELL = original; });
  t.mock.method(os, 'userInfo', () => ({ shell: '/missing/shell' }));
  assert.equal(defaultShell(), '/bin/bash');
  process.env.SHELL = '/missing/other-shell';
  assert.equal(defaultShell(), '/bin/bash');
  process.env.SHELL = '/bin/sh';
  assert.equal(defaultShell(), '/bin/sh');
  fs.accessSync(defaultShell(), fs.constants.X_OK);
});
