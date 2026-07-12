const { app, BrowserWindow, ipcMain, dialog, Menu } = require('electron');
const path = require('path');
const os = require('os');
const fsp = require('fs/promises');
const crypto = require('crypto');
const { utils: sshUtils } = require('ssh2');
const ssh = require('./ssh');
const localTerm = require('./localTerm');
const serial = require('./serial');
const vault = require('./vault');
const isMac = process.platform === 'darwin';
let liquidGlass = null;
if (isMac) {
  try {
    liquidGlass = require('electron-liquid-glass');
  } catch {}
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1100,
    height: 700,
    minWidth: 800,
    minHeight: 500,
    ...(isMac
      ? {
          titleBarStyle: 'hiddenInset',
          trafficLightPosition: { x: 20, y: 16 },
          transparent: true,
        }
      : {
          titleBarStyle: 'hidden',
          titleBarOverlay: { color: '#09090b', symbolColor: '#a1a1aa', height: 44 },
          backgroundColor: '#09090b',
        }),
    icon: path.join(__dirname, '..', '..', 'src', 'renderer', 'assets', 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload', 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  win.on('enter-full-screen', () =>
    win.webContents.send('window:fullscreen', { fullScreen: true })
  );
  win.on('leave-full-screen', () =>
    win.webContents.send('window:fullscreen', { fullScreen: false })
  );

  if (isMac) {
    win.setWindowButtonVisibility(true);
  }

  if (liquidGlass) {
    win.webContents.once('did-finish-load', () => {
      const glassId = liquidGlass.addView(win.getNativeWindowHandle(), {
        cornerRadius: 20,
        tintColor: '#ffffff0d',
        opaque: false,
      });
      liquidGlass.unstable_setVariant?.(glassId, 0);
    });
  }

  if (process.argv.includes('--dev')) {
    win.loadURL('http://localhost:5173');
  } else {
    win.loadFile(path.join(__dirname, '..', '..', 'dist', 'renderer', 'index.html'));
  }
}

const pendingHostKeyDecisions = new Map();

ipcMain.handle('ping', async (event, message) => {
  console.log('[main] got a ping from the UI, message:', message);
  return {
    reply: `pong! main process received: "${message}"`,
    electronVersion: process.versions.electron,
    nodeVersion: process.versions.node,
    chromeVersion: process.versions.chrome,
  };
});

ipcMain.handle('ssh:connect', (event, config) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  try {
    let fullConfig = config;
    if (config?.hostId) {
      const saved = vault.getHostSecret(config.hostId);
      if (!saved) return { error: 'Saved host not found' };
      fullConfig = { ...saved, cols: config.cols, rows: config.rows, mode: config.mode };
    }
    // A host can reference a Keychain key; swap the reference for the
    // actual key material before connecting.
    if (fullConfig.keyId) {
      const key = vault.getKeySecret(fullConfig.keyId);
      if (!key) return { error: 'Key not found in Keychain' };
      fullConfig = { ...fullConfig, privateKey: key.private, publicKey: key.public };
      if (key.passphrase) fullConfig.passphrase = key.passphrase;
    }
    const sessionId = ssh.connect(fullConfig, {
      onProgress: (sessionId, stage) => win?.webContents.send('ssh:progress', { sessionId, stage }),
      onReady: (sessionId) => win?.webContents.send('ssh:ready', { sessionId }),
      onData: (sessionId, data, seq) => win?.webContents.send('ssh:data', { sessionId, data, seq }),
      onClose: (sessionId) => win?.webContents.send('ssh:closed', { sessionId }),
      onError: (sessionId, err) =>
        win?.webContents.send('ssh:error', { sessionId, message: err.message }),
      onLog: (sessionId, line, level) =>
        win?.webContents.send('ssh:log', { sessionId, line, level }),
      onRecording: (sessionId, recording) => {
        try { vault.saveSessionHistory(recording); } catch {}
      },
      onHostKey: (sessionId, info) =>
        new Promise((resolve) => {
          pendingHostKeyDecisions.set(sessionId, resolve);
          win?.webContents.send('ssh:hostkey', { sessionId, ...info });
        }),
    });
    return { sessionId };
  } catch (err) {
    return { error: err.message };
  }
});

ipcMain.handle('ssh:hostKeyResponse', (event, { sessionId, trust }) => {
  const resolve = pendingHostKeyDecisions.get(sessionId);
  if (resolve) {
    pendingHostKeyDecisions.delete(sessionId);
    resolve(Boolean(trust));
  }
});

ipcMain.handle('ssh:write', (event, { sessionId, data }) => {
  ssh.write(sessionId, data);
});

ipcMain.handle('ssh:resize', (event, { sessionId, cols, rows }) => {
  ssh.resize(sessionId, cols, rows);
});

ipcMain.handle('ssh:disconnect', (event, sessionId) => {
  ssh.disconnect(sessionId);
});

ipcMain.handle('ssh:attach', (event, sessionId) => ssh.attach(sessionId));
ipcMain.handle('ssh:forwardStart', async (event, { sessionId, spec }) => {
  try { return { forward: await ssh.startForward(sessionId, spec) }; }
  catch (err) { return { error: err.message }; }
});
ipcMain.handle('ssh:forwardStop', (event, { sessionId, forwardId }) => ({
  ok: ssh.stopForward(sessionId, forwardId),
}));

ipcMain.handle('local:connect', (event, config) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  try {
    const sessionId = localTerm.connect(config, {
      onData: (sessionId, data, seq) => win?.webContents.send('local:data', { sessionId, data, seq }),
      onClose: (sessionId) => win?.webContents.send('local:closed', { sessionId }),
      onError: (sessionId, err) =>
        win?.webContents.send('local:error', { sessionId, message: err.message }),
    });
    return { sessionId };
  } catch (err) {
    return { error: err.message };
  }
});

ipcMain.handle('local:write', (event, { sessionId, data }) => {
  localTerm.write(sessionId, data);
});

ipcMain.handle('local:resize', (event, { sessionId, cols, rows }) => {
  localTerm.resize(sessionId, cols, rows);
});

ipcMain.handle('local:disconnect', (event, sessionId) => {
  localTerm.disconnect(sessionId);
});

ipcMain.handle('local:attach', (event, sessionId) => localTerm.attach(sessionId));

ipcMain.handle('serial:list', async () => {
  try {
    return { ports: await serial.listPorts() };
  } catch (err) {
    return { error: err.message };
  }
});

ipcMain.handle('serial:connect', async (event, config) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  try {
    const sessionId = await serial.connect(config, {
      onData: (sessionId, data, seq) => win?.webContents.send('serial:data', { sessionId, data, seq }),
      onClose: (sessionId) => win?.webContents.send('serial:closed', { sessionId }),
      onError: (sessionId, err) =>
        win?.webContents.send('serial:error', { sessionId, message: err.message }),
    });
    return { sessionId };
  } catch (err) {
    return { error: err.message };
  }
});

ipcMain.handle('serial:write', (event, { sessionId, data }) => {
  serial.write(sessionId, data);
});

ipcMain.handle('serial:disconnect', (event, sessionId) => {
  serial.disconnect(sessionId);
});

ipcMain.handle('serial:attach', (event, sessionId) => serial.attach(sessionId));
// Lets the renderer know the starting state (the events above only cover
// transitions that happen after the page has loaded).
ipcMain.handle('window:isFullScreen', (event) =>
  BrowserWindow.fromWebContents(event.sender)?.isFullScreen() ?? false
);

// Local filesystem browsing for the SFTP dual-pane view.
ipcMain.handle('fs:home', () => ({ path: os.homedir() }));

ipcMain.handle('fs:list', async (event, dirPath) => {
  try {
    const dirents = await fsp.readdir(dirPath, { withFileTypes: true });
    const entries = await Promise.all(
      dirents.map(async (d) => {
        let type = d.isDirectory() ? 'dir' : d.isSymbolicLink() ? 'link' : 'file';
        let size = 0;
        let mtime = 0;
        try {
          const st = await fsp.stat(path.join(dirPath, d.name));
          if (st.isDirectory()) type = 'dir';
          size = st.size;
          mtime = st.mtimeMs;
        } catch {
          // Unreadable entry (permissions, broken link) — list it anyway.
        }
        return { name: d.name, type, size, mtime };
      })
    );

    entries.sort((a, b) => {
      if ((a.type === 'dir') !== (b.type === 'dir')) return a.type === 'dir' ? -1 : 1;
      return a.name.localeCompare(b.name);
    });

    return { entries };
  } catch (err) {
    return { error: err.message };
  }
});

// Runs one SFTP transfer in the background and streams progress to the
// renderer as 'sftp:transfer' events. Progress is throttled so a fast
// transfer doesn't flood IPC with thousands of tiny updates.
function runTransfer(win, { sessionId, kind, name, destSessionId }, startFn) {
  const transferId = crypto.randomUUID();
  const send = (payload) =>
    win?.webContents.send('sftp:transfer', {
      sessionId,
      transferId,
      kind,
      name,
      destSessionId,
      ...payload,
    });

  let lastSent = 0;
  const onStep = (transferred, total) => {
    const now = Date.now();
    if (now - lastSent < 100 && transferred < total) return;
    lastSent = now;
    send({ transferred, total });
  };

  send({ transferred: 0, total: 0 });
  startFn(onStep)
    .then(() => send({ done: true }))
    .catch((err) => send({ error: err.message }));

  return transferId;
}

function joinRemote(dir, name) {
  return ssh.joinRemotePath(dir, name);
}

ipcMain.handle('sftp:home', async (event, sessionId) => {
  try {
    return { path: await ssh.sftpHome(sessionId) };
  } catch (err) {
    return { error: err.message };
  }
});

ipcMain.handle('sftp:list', async (event, { sessionId, path: dirPath }) => {
  try {
    return { entries: await ssh.sftpList(sessionId, dirPath) };
  } catch (err) {
    return { error: err.message };
  }
});

ipcMain.handle('sftp:download', async (event, { sessionId, remotePath, name }) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  const result = await dialog.showSaveDialog(win, { defaultPath: name });
  if (result.canceled || !result.filePath) return { canceled: true };

  const transferId = runTransfer(win, { sessionId, kind: 'download', name }, (onStep) =>
    ssh.sftpDownload(sessionId, remotePath, result.filePath, onStep)
  );
  return { transferId };
});

ipcMain.handle('sftp:upload', async (event, { sessionId, remoteDir }) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  const result = await dialog.showOpenDialog(win, {
    properties: ['openFile', 'multiSelections'],
  });
  if (result.canceled || result.filePaths.length === 0) return { canceled: true };

  for (const localPath of result.filePaths) {
    const name = path.basename(localPath);
    runTransfer(win, { sessionId, kind: 'upload', name }, (onStep) =>
      ssh.sftpUpload(sessionId, localPath, joinRemote(remoteDir, name), onStep)
    );
  }
  return { started: result.filePaths.length };
});

// Download straight into a known local folder (dual-pane transfers) —
// no save dialog involved.
ipcMain.handle('sftp:downloadTo', async (event, { sessionId, remotePath, localDir, name }) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  ssh.assertSafeSftpName(name);
  const localPath = ssh.resolveLocalChild(localDir, name);
  const isDir = await ssh.sftpIsDir(sessionId, remotePath).catch(() => false);
  const transferId = runTransfer(win, { sessionId, kind: 'download', name }, (onStep) =>
    isDir
      ? ssh.sftpDownloadDir(sessionId, remotePath, localPath, onStep)
      : ssh.sftpDownload(sessionId, remotePath, localPath, onStep)
  );
  return { transferId };
});

// Same as sftp:upload but for drag-and-drop, where the renderer already
// knows the local paths (via webUtils.getPathForFile in the preload).
ipcMain.handle('sftp:uploadPaths', async (event, { sessionId, remoteDir, localPaths }) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  for (const localPath of localPaths) {
    const name = path.basename(localPath);
    const isDir = await fsp
      .stat(localPath)
      .then((stat) => stat.isDirectory())
      .catch(() => false);
    runTransfer(win, { sessionId, kind: 'upload', name }, (onStep) =>
      isDir
        ? ssh.sftpUploadDir(sessionId, localPath, joinRemote(remoteDir, name), onStep)
        : ssh.sftpUpload(sessionId, localPath, joinRemote(remoteDir, name), onStep)
    );
  }
  return { started: localPaths.length };
});

ipcMain.handle(
  'sftp:transferRemote',
  async (event, { sourceSessionId, sourcePath, destSessionId, destDir, name }) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    ssh.assertSafeSftpName(name);
    const destPath = joinRemote(destDir, name);
    const isDir = await ssh.sftpIsDir(sourceSessionId, sourcePath).catch(() => false);
    const transferId = runTransfer(
      win,
      { sessionId: sourceSessionId, kind: 'remote-transfer', name, destSessionId },
      (onStep) =>
        isDir
          ? ssh.sftpTransferRemoteDir(
              sourceSessionId,
              sourcePath,
              destSessionId,
              destPath,
              onStep
            )
          : ssh.sftpTransferRemote(sourceSessionId, sourcePath, destSessionId, destPath, onStep)
    );
    return { transferId };
  }
);

ipcMain.handle('vault:status', () => ({
  exists: vault.exists(),
  unlocked: vault.isUnlocked(),
}));

ipcMain.handle('vault:setup', (event, password) => {
  try {
    vault.setup(password);
    return { ok: true };
  } catch (err) {
    return { error: err.message };
  }
});

ipcMain.handle('vault:unlock', (event, password) => {
  try {
    vault.unlock(password);
    return { ok: true };
  } catch (err) {
    return { error: err.message };
  }
});

ipcMain.handle('vault:lock', () => {
  vault.lock();
  return { ok: true };
});

ipcMain.handle('hosts:list', () => {
  try {
    return { hosts: vault.listHosts() };
  } catch (err) {
    return { error: err.message };
  }
});

ipcMain.handle('hosts:save', (event, host) => {
  try {
    return { hosts: vault.saveHost(host) };
  } catch (err) {
    return { error: err.message };
  }
});

ipcMain.handle('hosts:delete', (event, id) => {
  try {
    return { hosts: vault.deleteHost(id) };
  } catch (err) {
    return { error: err.message };
  }
});

ipcMain.handle('knownHosts:list', () => {
  try {
    return { knownHosts: vault.listKnownHosts() };
  } catch (err) {
    return { error: err.message };
  }
});

ipcMain.handle('knownHosts:delete', (event, { host, port }) => {
  try {
    return { knownHosts: vault.deleteKnownHost(host, port) };
  } catch (err) {
    return { error: err.message };
  }
});

for (const [channel, action] of [
  ['snippets:list', () => ({ snippets: vault.listSnippets() })],
  ['snippets:save', (value) => ({ snippets: vault.saveSnippet(value) })],
  ['snippets:delete', (id) => ({ snippets: vault.deleteSnippet(id) })],
  ['history:list', () => ({ history: vault.listSessionHistory() })],
  ['history:delete', (id) => ({ history: vault.deleteSessionHistory(id) })],
]) {
  ipcMain.handle(channel, (event, value) => {
    try { return action(value); } catch (err) { return { error: err.message }; }
  });
}

// Key generation runs in the main process so private keys are created and
// vaulted without ever touching the renderer.
const KEY_TYPES = {
  ed25519: [],
  ecdsa: [256, 384, 521],
  rsa: [2048, 3072, 4096],
};

ipcMain.handle('keys:generate', async (event, { name, type, bits }) => {
  try {
    const trimmed = String(name || '').trim();
    if (!trimmed) throw new Error('Key name is required');
    if (!(type in KEY_TYPES)) throw new Error(`Unsupported key type: ${type}`);

    const opts = { comment: trimmed.replace(/[^\w.@-]/g, '_') };
    if (KEY_TYPES[type].length > 0) {
      const size = Number(bits);
      if (!KEY_TYPES[type].includes(size)) {
        throw new Error(`Unsupported ${type} key size: ${bits}`);
      }
      opts.bits = size;
    }

    const pair = await new Promise((resolve, reject) => {
      sshUtils.generateKeyPair(type, opts, (err, keys) => (err ? reject(err) : resolve(keys)));
    });

    const parsed = sshUtils.parseKey(pair.private);

    return {
      keys: vault.saveKey({
        name: trimmed,
        type,
        bits: opts.bits,
        private: pair.private,
        public: pair.public.trim(),
        fingerprint: keyFingerprint(parsed),
      }),
    };
  } catch (err) {
    return { error: err.message };
  }
});

function keyFingerprint(parsed) {
  return (
    'SHA256:' +
    crypto.createHash('sha256').update(parsed.getPublicSSH()).digest('base64').replace(/=+$/, '')
  );
}

// Import a key the user pasted in. The public half is derived from the
// private key, so pasting just the private key is enough.
ipcMain.handle('keys:import', (event, { name, privateKey, publicKey, passphrase }) => {
  try {
    const trimmedName = String(name || '').trim();
    if (!trimmedName) throw new Error('Key name is required');

    const material = String(privateKey || '').trim();
    if (!material) throw new Error('Paste the private key');

    let parsed = sshUtils.parseKey(material, passphrase || undefined);
    if (Array.isArray(parsed)) parsed = parsed[0];
    if (parsed instanceof Error) {
      throw new Error(`Could not read key: ${parsed.message}`);
    }
    if (!parsed.isPrivateKey()) {
      throw new Error('This looks like a public key — paste the private key');
    }

    // If the user pasted the public key too, check it actually belongs to
    // this private key and keep their line (comment included).
    let pastedPublicLine;
    if (String(publicKey || '').trim()) {
      const normalized = String(publicKey).trim().split(/\s+/).join(' ');
      let pastedParsed = sshUtils.parseKey(normalized);
      if (Array.isArray(pastedParsed)) pastedParsed = pastedParsed[0];
      if (pastedParsed instanceof Error) {
        throw new Error(`Could not read public key: ${pastedParsed.message}`);
      }
      if (!pastedParsed.getPublicSSH().equals(parsed.getPublicSSH())) {
        throw new Error('The public key does not match the private key');
      }
      pastedPublicLine = normalized;
    }

    // 'ecdsa-sha2-nistp256' -> type 'ecdsa', bits 256, etc.
    let type = parsed.type;
    let bits;
    if (type === 'ssh-ed25519') type = 'ed25519';
    else if (type === 'ssh-rsa') type = 'rsa';
    else if (type.startsWith('ecdsa-sha2-nistp')) {
      bits = Number(type.slice('ecdsa-sha2-nistp'.length)) || undefined;
      type = 'ecdsa';
    }

    const comment = trimmedName.replace(/[^\w.@-]/g, '_');
    const publicLine =
      pastedPublicLine ?? `${parsed.type} ${parsed.getPublicSSH().toString('base64')} ${comment}`;

    return {
      keys: vault.saveKey({
        name: trimmedName,
        type,
        bits,
        private: material,
        public: publicLine,
        passphrase: passphrase || undefined,
        fingerprint: keyFingerprint(parsed),
      }),
    };
  } catch (err) {
    return { error: err.message };
  }
});

ipcMain.handle('keys:list', () => {
  try {
    return { keys: vault.listKeys() };
  } catch (err) {
    return { error: err.message };
  }
});

ipcMain.handle('keys:delete', (event, id) => {
  try {
    return { keys: vault.deleteKey(id) };
  } catch (err) {
    return { error: err.message };
  }
});

// Hand the private half to the UI on explicit request (the Keychain's
// "reveal" button), so the user can copy or back up their own key.
ipcMain.handle('keys:reveal', (event, id) => {
  try {
    const key = vault.getKeySecret(id);
    if (!key) return { error: 'Key not found' };
    return { private: key.private, hasPassphrase: Boolean(key.passphrase) };
  } catch (err) {
    return { error: err.message };
  }
});

ipcMain.handle('dialog:selectPrivateKey', async (event) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  const result = await dialog.showOpenDialog(win, { properties: ['openFile'] });
  if (result.canceled || result.filePaths.length === 0) return { canceled: true };
  return { path: result.filePaths[0] };
});

ipcMain.handle('dialog:selectFolder', async (event) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  const result = await dialog.showOpenDialog(win, { properties: ['openDirectory'] });
  if (result.canceled || result.filePaths.length === 0) return { canceled: true };
  return { path: result.filePaths[0] };
});

function buildMenu() {
  if (process.platform === 'darwin') {
    Menu.setApplicationMenu(
      Menu.buildFromTemplate([{ role: 'appMenu' }, { role: 'editMenu' }])
    );
  } else {
    Menu.setApplicationMenu(null);
  }
}

app.whenReady().then(() => {
  buildMenu();
  if (process.platform === 'darwin') {
    app.dock.setIcon(path.join(__dirname, '..', '..', 'src', 'renderer', 'assets', 'icon.png'));
  }
  vault.init(app.getPath('userData'));
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('before-quit', () => {
  vault.shutdown();
});
