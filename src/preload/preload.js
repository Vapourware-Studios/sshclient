const { contextBridge, ipcRenderer, webUtils } = require('electron');

contextBridge.exposeInMainWorld('api', {
  platform: process.platform,

  ping: (message) => ipcRenderer.invoke('ping', message),

  sshConnect: (config) => ipcRenderer.invoke('ssh:connect', config),
  sshWrite: (sessionId, data) => ipcRenderer.invoke('ssh:write', { sessionId, data }),
  sshResize: (sessionId, cols, rows) => ipcRenderer.invoke('ssh:resize', { sessionId, cols, rows }),
  sshDisconnect: (sessionId) => ipcRenderer.invoke('ssh:disconnect', sessionId),
  sshAttach: (sessionId) => ipcRenderer.invoke('ssh:attach', sessionId),

  onSshProgress: (callback) => subscribe('ssh:progress', callback),
  onSshReady: (callback) => subscribe('ssh:ready', callback),
  onSshData: (callback) => subscribe('ssh:data', callback),
  onSshClosed: (callback) => subscribe('ssh:closed', callback),
  onSshError: (callback) => subscribe('ssh:error', callback),
  onSshLog: (callback) => subscribe('ssh:log', callback),
  onSshHostKey: (callback) => subscribe('ssh:hostkey', callback),
  sshHostKeyResponse: (sessionId, trust) =>
    ipcRenderer.invoke('ssh:hostKeyResponse', { sessionId, trust }),

  sftpHome: (sessionId) => ipcRenderer.invoke('sftp:home', sessionId),
  sftpList: (sessionId, path) => ipcRenderer.invoke('sftp:list', { sessionId, path }),
  sftpDownload: (sessionId, remotePath, name) =>
    ipcRenderer.invoke('sftp:download', { sessionId, remotePath, name }),
  sftpUpload: (sessionId, remoteDir) =>
    ipcRenderer.invoke('sftp:upload', { sessionId, remoteDir }),
  sftpUploadPaths: (sessionId, remoteDir, localPaths) =>
    ipcRenderer.invoke('sftp:uploadPaths', { sessionId, remoteDir, localPaths }),
  sftpDownloadTo: (sessionId, remotePath, localDir, name) =>
    ipcRenderer.invoke('sftp:downloadTo', { sessionId, remotePath, localDir, name }),
  onSftpTransfer: (callback) => subscribe('sftp:transfer', callback),

  fsHome: () => ipcRenderer.invoke('fs:home'),
  fsList: (path) => ipcRenderer.invoke('fs:list', path),

  // Turns a File object from a drag-and-drop event into its local path.
  // Only the preload can do this (webUtils is not available to the page).
  pathForFile: (file) => webUtils.getPathForFile(file),

  vaultStatus: () => ipcRenderer.invoke('vault:status'),
  vaultSetup: (masterPassword) => ipcRenderer.invoke('vault:setup', masterPassword),
  vaultUnlock: (masterPassword) => ipcRenderer.invoke('vault:unlock', masterPassword),
  vaultLock: () => ipcRenderer.invoke('vault:lock'),

  hostsList: () => ipcRenderer.invoke('hosts:list'),
  hostsSave: (host) => ipcRenderer.invoke('hosts:save', host),
  hostsDelete: (id) => ipcRenderer.invoke('hosts:delete', id),

  keysList: () => ipcRenderer.invoke('keys:list'),
  keysGenerate: (spec) => ipcRenderer.invoke('keys:generate', spec),
  keysImport: (spec) => ipcRenderer.invoke('keys:import', spec),
  keysDelete: (id) => ipcRenderer.invoke('keys:delete', id),
  keysReveal: (id) => ipcRenderer.invoke('keys:reveal', id),

  selectPrivateKey: () => ipcRenderer.invoke('dialog:selectPrivateKey'),
});

function subscribe(channel, callback) {
  const listener = (event, payload) => callback(payload);
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
}
