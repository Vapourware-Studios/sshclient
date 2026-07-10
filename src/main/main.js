const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const crypto = require('crypto');
const ssh = require('./ssh');
const vault = require('./vault');

function createWindow() {
  const win = new BrowserWindow({
    width: 1100,
    height: 700,
    minWidth: 800,
    minHeight: 500,
    titleBarStyle: 'hiddenInset',
    backgroundColor: '#0d1117',
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload', 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

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
      fullConfig = { ...saved, cols: config.cols, rows: config.rows };
    }
    const sessionId = ssh.connect(fullConfig, {
      onProgress: (sessionId, stage) => win?.webContents.send('ssh:progress', { sessionId, stage }),
      onReady: (sessionId) => win?.webContents.send('ssh:ready', { sessionId }),
      onData: (sessionId, data) => win?.webContents.send('ssh:data', { sessionId, data }),
      onClose: (sessionId) => win?.webContents.send('ssh:closed', { sessionId }),
      onError: (sessionId, err) =>
        win?.webContents.send('ssh:error', { sessionId, message: err.message }),
      onLog: (sessionId, line, level) =>
        win?.webContents.send('ssh:log', { sessionId, line, level }),
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

// Runs one SFTP transfer in the background and streams progress to the
// renderer as 'sftp:transfer' events. Progress is throttled so a fast
// transfer doesn't flood IPC with thousands of tiny updates.
function runTransfer(win, { sessionId, kind, name }, startFn) {
  const transferId = crypto.randomUUID();
  const send = (payload) =>
    win?.webContents.send('sftp:transfer', { sessionId, transferId, kind, name, ...payload });

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
  return (dir === '/' ? '' : dir) + '/' + name;
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

// Same as sftp:upload but for drag-and-drop, where the renderer already
// knows the local paths (via webUtils.getPathForFile in the preload).
ipcMain.handle('sftp:uploadPaths', (event, { sessionId, remoteDir, localPaths }) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  for (const localPath of localPaths) {
    const name = path.basename(localPath);
    runTransfer(win, { sessionId, kind: 'upload', name }, (onStep) =>
      ssh.sftpUpload(sessionId, localPath, joinRemote(remoteDir, name), onStep)
    );
  }
  return { started: localPaths.length };
});

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

ipcMain.handle('dialog:selectPrivateKey', async (event) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  const result = await dialog.showOpenDialog(win, { properties: ['openFile'] });
  if (result.canceled || result.filePaths.length === 0) return { canceled: true };
  return { path: result.filePaths[0] };
});

app.whenReady().then(() => {
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
