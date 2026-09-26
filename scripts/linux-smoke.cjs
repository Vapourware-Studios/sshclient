// Run with Electron, optionally against a built resources/app.asar.
// Everything written by this check lives in a temporary profile.
const { app, BrowserWindow } = require('electron');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const net = require('node:net');
const { once } = require('node:events');
const { spawn } = require('node:child_process');
const { createRequire } = require('node:module');

const root = path.resolve(process.argv[2] || path.join(__dirname, '..'));
const appRequire = createRequire(path.join(root, 'package.json'));
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'sshclient-smoke-'));
app.setPath('userData', temporary);
process.env.XDG_CONFIG_HOME = path.join(temporary, 'config');
process.env.XDG_DATA_HOME = path.join(temporary, 'data');
const cleanup = [];
let complete = false;
function finish(error) {
  if (complete) return;
  complete = true;
  clearTimeout(deadline);
  for (const close of cleanup.reverse()) { try { close(); } catch {} }
  try { appRequire('./src/main/vault').shutdown(); } catch {}
  fs.rmSync(temporary, { recursive: true, force: true });
  if (error) console.error(error);
  else console.log('Linux smoke passed: renderer, vault, key generation, local PTY, serial PTY, SSH, SFTP, forwarding.');
  app.exit(error ? 1 : 0);
}
const deadline = setTimeout(() => finish(new Error('Linux smoke timed out')), 60000);
process.on('uncaughtException', finish);
process.on('unhandledRejection', finish);

// Capture loading failures before the application creates its first window.
const loaded = new Promise((resolve, reject) => {
  app.once('browser-window-created', (_event, win) => {
    win.webContents.on('preload-error', (_event, _file, error) => reject(error));
    win.webContents.on('did-fail-load', (_event, code, description) => reject(new Error(`${code}: ${description}`)));
    win.webContents.once('did-finish-load', () => resolve(win));
  });
});

function sftpFixture(stream) {
  let contents = Buffer.alloc(0);
  let listed = false;
  const attrs = () => ({ mode: 0o100600, size: contents.length, uid: 0, gid: 0, atime: 0, mtime: 0 });
  stream.on('REALPATH', (id) => stream.name(id, [{ filename: '/demo', longname: '/demo', attrs: {} }]));
  stream.on('OPEN', (id) => stream.handle(id, Buffer.from('file')));
  stream.on('CLOSE', (id) => stream.status(id, 0));
  stream.on('FSTAT', (id) => stream.attrs(id, attrs()));
  stream.on('STAT', (id) => stream.attrs(id, attrs()));
  stream.on('LSTAT', (id) => stream.attrs(id, attrs()));
  stream.on('WRITE', (id, _handle, offset, data) => {
    if (offset + data.length > contents.length) {
      const expanded = Buffer.alloc(offset + data.length);
      contents.copy(expanded);
      contents = expanded;
    }
    data.copy(contents, offset);
    stream.status(id, 0);
  });
  stream.on('READ', (id, _handle, offset, length) => {
    if (offset >= contents.length) stream.status(id, 1);
    else stream.data(id, contents.subarray(offset, offset + length));
  });
  stream.on('OPENDIR', (id) => { listed = false; stream.handle(id, Buffer.from('dir')); });
  stream.on('READDIR', (id) => {
    if (listed) stream.status(id, 1);
    else { listed = true; stream.name(id, [{ filename: 'demo.txt', longname: 'demo.txt', attrs: attrs() }]); }
  });
}

async function testSsh() {
  const { Server, utils } = appRequire('ssh2');
  const ssh = appRequire('./src/main/ssh');
  const hostKeys = [utils.generateKeyPairSync('ed25519').private];
  const server = new Server({ hostKeys }, (client) => {
    cleanup.push(() => client.destroy());
    client.on('error', () => {});
    client.on('authentication', (ctx) => {
      if (ctx.method === 'password' && ctx.username === 'demo' && ctx.password === 'demo-password') ctx.accept();
      else ctx.reject(['password']);
    });
    client.on('ready', () => {
      client.on('session', (accept) => {
        const session = accept();
        session.on('pty', (accept) => accept());
        session.on('window-change', (accept) => accept?.());
        session.on('shell', (accept) => {
          const channel = accept();
          channel.on('data', (data) => channel.write(data));
        });
        session.on('sftp', (accept) => sftpFixture(accept()));
      });
      client.on('tcpip', (accept) => {
        const channel = accept();
        channel.on('data', (data) => channel.write(data));
      });
    });
  });
  cleanup.push(() => server.close());
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  let received = '';
  let receive;
  const output = new Promise((resolve) => { receive = resolve; });
  const sessionId = await new Promise((resolve, reject) => {
    const id = ssh.connect({ host: '127.0.0.1', port: server.address().port, username: 'demo', password: 'demo-password' }, {
      onHostKey: () => true,
      onReady: () => resolve(id),
      onError: (_id, error) => reject(error),
      onData: (_id, data) => { received += data; if (received.includes('ssh-smoke')) receive(); },
    });
    cleanup.push(() => ssh.disconnect(id));
  });
  ssh.attach(sessionId);
  ssh.resize(sessionId, 100, 30);
  ssh.write(sessionId, 'ssh-smoke\n');
  await output;
  assert.equal(await ssh.sftpHome(sessionId), '/demo');
  const source = path.join(temporary, 'upload.txt');
  const target = path.join(temporary, 'download.txt');
  const content = Buffer.alloc(70000, 'demo');
  fs.writeFileSync(source, content);
  await ssh.sftpUpload(sessionId, source, '/demo/demo.txt');
  assert.equal((await ssh.sftpList(sessionId, '/demo'))[0].size, content.length);
  await ssh.sftpDownload(sessionId, '/demo/demo.txt', target);
  assert.deepEqual(fs.readFileSync(target), content);
  const forward = await ssh.startForward(sessionId, { bindPort: 0, targetHost: 'example.com', targetPort: 22 });
  const socket = net.connect(forward.bindPort, '127.0.0.1');
  cleanup.push(() => socket.destroy());
  await once(socket, 'connect');
  socket.write('forward-smoke');
  assert.equal((await once(socket, 'data'))[0].toString(), 'forward-smoke');
  socket.destroy();
  ssh.stopForward(sessionId, forward.id);
}

async function testSerial() {
  const serial = appRequire('./src/main/serial');
  assert.ok(Array.isArray(await serial.listPorts()));
  const bridge = spawn('python3', ['-u', '-c', [
    'import os, tty',
    'master, slave = os.openpty()',
    'tty.setraw(slave)',
    'print(os.ttyname(slave), flush=True)',
    'while True:',
    '    data = os.read(master, 4096)',
    '    os.write(master, b"serial-reply:" + data)',
  ].join('\n')], { stdio: ['ignore', 'pipe', 'pipe'] });
  cleanup.push(() => bridge.kill());
  const device = (await once(bridge.stdout, 'data'))[0].toString().trim();
  let receive;
  let received = '';
  const output = new Promise((resolve) => { receive = resolve; });
  const id = await serial.connect({ path: device }, {
    onData: (_id, data) => { received += data; if (received.includes('serial-reply:demo')) receive(); },
    onError: (_id, error) => finish(error),
  });
  cleanup.push(() => serial.disconnect(id));
  serial.attach(id);
  serial.write(id, 'demo');
  await output;
}

async function main() {
  appRequire('./src/main/main');
  const win = await loaded;
  assert.ok(BrowserWindow.getAllWindows().includes(win));
  const result = await win.webContents.executeJavaScript(`(async () => {
    const check = (result) => { if (result?.error) throw new Error(result.error); return result; };
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    if (!document.querySelector('#root')?.textContent.trim()) throw new Error('Renderer did not mount');
    if (window.api.platform !== 'linux') throw new Error('Linux preload API is unavailable');
    check(await window.api.vaultSetup('demo-password'));
    check(await window.api.hostsSave({ label: 'demo', host: 'example.com', port: 22, username: 'demo', password: 'demo-password' }));
    check(await window.api.snippetsSave({ name: 'demo', command: 'pwd' }));
    for (const spec of [{ type: 'ed25519' }, { type: 'ecdsa', bits: 256 }, { type: 'rsa', bits: 2048 }]) {
      check(await window.api.keysGenerate({ name: 'demo-' + spec.type, ...spec }));
    }
    check(await window.api.vaultLock());
    check(await window.api.vaultUnlock('demo-password'));
    const hosts = check(await window.api.hostsList());
    if (hosts.hosts.length !== 1) throw new Error('Vault did not preserve the saved host');
    const { sessionId } = check(await window.api.localConnect({ shell: '/bin/sh' }));
    await window.api.localAttach(sessionId);
    await new Promise((resolve, reject) => {
      let received = '';
      const off = window.api.onLocalData(({ sessionId: id, data }) => {
        if (id !== sessionId) return;
        received += data;
        if (received.includes('local-smoke-ok')) { off(); resolve(); }
      });
      window.api.localWrite(sessionId, "printf 'local-smoke-%s\\\\n' ok\\n").catch(reject);
    });
    await window.api.localResize(sessionId, 100, 30);
    await window.api.localDisconnect(sessionId);
    return true;
  })()`);
  assert.equal(result, true);
  await testSerial();
  await testSsh();
}

main().then(() => finish(), finish);
