const { Client } = require('ssh2');
const crypto = require('crypto');
const fs = require('fs');
const vault = require('./vault');

const sessions = new Map();
const pending = new Map();

async function verifyHostKey(sessionId, host, port, fingerprint, onHostKey) {
  const known = vault.getKnownHostKey(host, port);

  if (known) {
    if (known === fingerprint) return true;
    if (!onHostKey) return false;
    const trust = await onHostKey(sessionId, {
      host,
      port,
      fingerprint,
      changed: true,
      previousFingerprint: known,
    });
    if (trust) vault.trustHostKey(host, port, fingerprint);
    return trust;
  }

  if (!onHostKey) return false;
  const trust = await onHostKey(sessionId, { host, port, fingerprint, changed: false });
  if (trust) vault.trustHostKey(host, port, fingerprint);
  return trust;
}

function buildConnectConfig(config) {
  if (!config.host || !config.username) {
    throw new Error('host and username are required');
  }

  const connectConfig = {
    host: config.host,
    port: config.port || 22,
    username: config.username,
    readyTimeout: 20000,
  };

  if (config.privateKeyPath) {
    connectConfig.privateKey = fs.readFileSync(config.privateKeyPath);
    if (config.passphrase) connectConfig.passphrase = config.passphrase;
  } else if (config.privateKey) {
    connectConfig.privateKey = config.privateKey;
    if (config.passphrase) connectConfig.passphrase = config.passphrase;
  } else {
    connectConfig.password = config.password;
  }

  return connectConfig;
}

function connect(config, handlers = {}) {
  const { onProgress, onReady, onData, onClose, onError, onHostKey, onLog } = handlers;

  const connectConfig = buildConnectConfig(config);
  const conn = new Client();
  const sessionId = crypto.randomUUID();
  pending.set(sessionId, conn);

  const log = (line, level = 'info') => onLog?.(sessionId, line, level);

  // ssh2's debug callback fires for every protocol message. We forward it
  // only until the session is ready, so the log shows the connection story
  // without spamming a line per keystroke afterwards.
  let forwardDebug = true;
  connectConfig.debug = (message) => {
    if (forwardDebug) log(message, 'debug');
  };

  connectConfig.hostHash = 'sha256';
  connectConfig.hostVerifier = (fingerprint, callback) => {
    onProgress?.(sessionId, 'hostkey');
    log(`Server host key: SHA256:${fingerprint}`);
    verifyHostKey(sessionId, connectConfig.host, connectConfig.port, fingerprint, onHostKey)
      .then((trusted) => {
        log(trusted ? 'Host key trusted' : 'Host key rejected', trusted ? 'info' : 'error');
        callback(trusted);
      })
      .catch(() => callback(false));
  };

  onProgress?.(sessionId, 'connecting');
  log(`Connecting to ${connectConfig.host}:${connectConfig.port} as ${connectConfig.username}`);

  conn.on('handshake', () => {
    onProgress?.(sessionId, 'authenticating');
    log('Encryption negotiated, authenticating…');
  });

  conn.on('ready', () => {
    onProgress?.(sessionId, 'shell');
    log('Authenticated. Opening terminal channel…');
    conn.shell(
      { term: 'xterm-256color', cols: config.cols || 80, rows: config.rows || 24 },
      (err, stream) => {
        pending.delete(sessionId);

        if (err) {
          conn.end();
          log(`Failed to open terminal channel: ${err.message}`, 'error');
          onError?.(sessionId, err);
          return;
        }

        sessions.set(sessionId, { conn, stream, sftp: null });

        stream.on('data', (chunk) => {
          onData?.(sessionId, chunk.toString('utf8'));
        });

        stream.on('close', () => {
          sessions.delete(sessionId);
          onClose?.(sessionId);
        });

        log('Terminal channel open — session ready');
        forwardDebug = false;
        onReady?.(sessionId);
      }
    );
  });

  conn.on('error', (err) => {
    pending.delete(sessionId);
    log(`Connection error: ${err.message}`, 'error');
    onError?.(sessionId, err);
  });

  conn.on('close', () => {
    pending.delete(sessionId);
    sessions.delete(sessionId);
    log('Connection closed');
  });

  conn.connect(connectConfig);

  return sessionId;
}

function write(sessionId, data) {
  sessions.get(sessionId)?.stream.write(data);
}

function resize(sessionId, cols, rows) {
  sessions.get(sessionId)?.stream.setWindow(rows, cols, rows, cols);
}

// SFTP is not a separate connection — it's another channel type on the
// existing ssh2 connection. We open it lazily the first time a session
// needs it and cache it on the session object.
function getSftp(sessionId) {
  return new Promise((resolve, reject) => {
    const session = sessions.get(sessionId);
    if (!session) return reject(new Error('Session not found'));
    if (session.sftp) return resolve(session.sftp);

    session.conn.sftp((err, sftp) => {
      if (err) return reject(err);
      session.sftp = sftp;
      sftp.on('close', () => {
        const current = sessions.get(sessionId);
        if (current) current.sftp = null;
      });
      resolve(sftp);
    });
  });
}

async function sftpHome(sessionId) {
  const sftp = await getSftp(sessionId);
  return new Promise((resolve, reject) => {
    sftp.realpath('.', (err, home) => (err ? reject(err) : resolve(home)));
  });
}

async function sftpList(sessionId, dirPath) {
  const sftp = await getSftp(sessionId);
  return new Promise((resolve, reject) => {
    sftp.readdir(dirPath, (err, items) => {
      if (err) return reject(err);

      const entries = items.map(({ filename, attrs }) => ({
        name: filename,
        type: attrs.isDirectory() ? 'dir' : attrs.isSymbolicLink() ? 'link' : 'file',
        size: attrs.size,
        mtime: attrs.mtime * 1000,
      }));

      entries.sort((a, b) => {
        if ((a.type === 'dir') !== (b.type === 'dir')) return a.type === 'dir' ? -1 : 1;
        return a.name.localeCompare(b.name);
      });

      resolve(entries);
    });
  });
}

async function sftpDownload(sessionId, remotePath, localPath, onStep) {
  const sftp = await getSftp(sessionId);
  return new Promise((resolve, reject) => {
    sftp.fastGet(
      remotePath,
      localPath,
      { step: (transferred, _chunk, total) => onStep?.(transferred, total) },
      (err) => (err ? reject(err) : resolve())
    );
  });
}

async function sftpUpload(sessionId, localPath, remotePath, onStep) {
  const sftp = await getSftp(sessionId);
  return new Promise((resolve, reject) => {
    sftp.fastPut(
      localPath,
      remotePath,
      { step: (transferred, _chunk, total) => onStep?.(transferred, total) },
      (err) => (err ? reject(err) : resolve())
    );
  });
}

function disconnect(sessionId) {
  const session = sessions.get(sessionId);
  if (session) {
    session.conn.end();
    sessions.delete(sessionId);
    return;
  }

  const conn = pending.get(sessionId);
  if (conn) {
    conn.end();
    pending.delete(sessionId);
  }
}

module.exports = {
  connect,
  write,
  resize,
  disconnect,
  sftpHome,
  sftpList,
  sftpDownload,
  sftpUpload,
};
