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
  const { onProgress, onReady, onData, onClose, onError, onHostKey } = handlers;

  const connectConfig = buildConnectConfig(config);
  const conn = new Client();
  const sessionId = crypto.randomUUID();
  pending.set(sessionId, conn);

  connectConfig.hostHash = 'sha256';
  connectConfig.hostVerifier = (fingerprint, callback) => {
    verifyHostKey(sessionId, connectConfig.host, connectConfig.port, fingerprint, onHostKey)
      .then(callback)
      .catch(() => callback(false));
  };

  onProgress?.(sessionId, 'connecting');

  conn.on('handshake', () => {
    onProgress?.(sessionId, 'handshake');
  });

  conn.on('ready', () => {
    conn.shell(
      { term: 'xterm-256color', cols: config.cols || 80, rows: config.rows || 24 },
      (err, stream) => {
        pending.delete(sessionId);

        if (err) {
          conn.end();
          onError?.(sessionId, err);
          return;
        }

        sessions.set(sessionId, { conn, stream });

        stream.on('data', (chunk) => {
          onData?.(sessionId, chunk.toString('utf8'));
        });

        stream.on('close', () => {
          sessions.delete(sessionId);
          onClose?.(sessionId);
        });

        onReady?.(sessionId);
      }
    );
  });

  conn.on('error', (err) => {
    pending.delete(sessionId);
    onError?.(sessionId, err);
  });

  conn.on('close', () => {
    pending.delete(sessionId);
    sessions.delete(sessionId);
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

module.exports = { connect, write, resize, disconnect };
