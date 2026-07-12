const { Client } = require('ssh2');
const crypto = require('crypto');
const fs = require('fs');
const vault = require('./vault');

const sessions = new Map();
const pending = new Map();

// How much shell output (in characters) we keep per session for replay.
const MAX_HISTORY_CHARS = 200000;

// Terminal output is full of invisible control sequences (colors, cursor
// moves, window-title updates). Strip them so a line reads as plain text
// in the connection log.
function stripControlSequences(text) {
  return text
    .replace(/\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g, '') // OSC (e.g. set window title)
    .replace(/\x1b\[[0-9;?]*[ -/]*[@-~]/g, '') // CSI (colors, cursor movement)
    .replace(/\x1b[@-_]/g, '') // other two-byte escapes
    .replace(/[\x00-\x08\x0b-\x1f\x7f]/g, ''); // stray control bytes
}

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
  }

  // Key and password can coexist: ssh2 tries every method the server
  // allows, so a saved password still works while the public key is not
  // yet installed on the host.
  if (config.password) connectConfig.password = config.password;

  return connectConfig;
}

// Appends the public key to the remote ~/.ssh/authorized_keys unless it
// is already there, so key auth works on the next connection.
function installPublicKey(conn, publicKey, log) {
  const line = publicKey.trim();
  if (line.includes("'") || line.includes('\n')) {
    log('Public key has unexpected characters — skipped authorized_keys install', 'error');
    return;
  }

  const cmd =
    `mkdir -p ~/.ssh && chmod 700 ~/.ssh && ` +
    `touch ~/.ssh/authorized_keys && chmod 600 ~/.ssh/authorized_keys && ` +
    `{ grep -qF '${line}' ~/.ssh/authorized_keys || echo '${line}' >> ~/.ssh/authorized_keys; }`;

  conn.exec(cmd, (err, stream) => {
    if (err) {
      log(`Could not update authorized_keys: ${err.message}`, 'error');
      return;
    }
    stream.on('data', () => {});
    stream.stderr.on('data', () => {});
    stream.on('close', (code) => {
      if (code === 0) {
        log('Public key is set up in ~/.ssh/authorized_keys');
      } else {
        log(`authorized_keys install exited with code ${code}`, 'error');
      }
    });
  });
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
    if (config.publicKey) installPublicKey(conn, config.publicKey, log);

    // SFTP-only sessions skip the shell entirely: they are their own
    // connection to the host, independent of any terminal session.
    if (config.mode === 'sftp') {
      onProgress?.(sessionId, 'sftp');
      log('Authenticated. Opening SFTP channel…');
      conn.sftp((err, sftp) => {
        pending.delete(sessionId);

        if (err) {
          conn.end();
          log(`Failed to open SFTP channel: ${err.message}`, 'error');
          onError?.(sessionId, err);
          return;
        }

        sessions.set(sessionId, {
          conn,
          stream: null,
          sftp,
          history: [],
          historyLength: 0,
          seq: 0,
          attached: true,
        });
        sftp.on('close', () => {
          sessions.delete(sessionId);
          conn.end();
          onClose?.(sessionId);
        });

        log('SFTP channel open — session ready');
        forwardDebug = false;
        onReady?.(sessionId);
      });
      return;
    }

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

        // Everything the shell prints is kept (capped) so a terminal can
        // attach — or re-attach after a React remount — at any moment and
        // replay the full story from the start. `seq` numbers each chunk so
        // the renderer can tell which live chunks are already covered by a
        // replayed history and must not be written twice.
        const session = {
          conn,
          stream,
          sftp: null,
          history: [],
          historyLength: 0,
          seq: 0,
          attached: false,
        };
        sessions.set(sessionId, session);

        // Until a terminal is attached and showing output, forward whole
        // printed lines (login banner, MOTD) to the connection log so they
        // are visible behind the "Show logs" button while connecting.
        let lineBuffer = '';
        const logShellOutput = (text) => {
          lineBuffer += text;
          const lines = lineBuffer.split(/\r?\n/);
          lineBuffer = lines.pop();
          for (const line of lines) {
            const clean = stripControlSequences(line).trim();
            if (clean) log(clean, 'output');
          }
        };

        stream.on('data', (chunk) => {
          const text = chunk.toString('utf8');
          session.seq += 1;

          session.history.push(text);
          session.historyLength += text.length;
          while (session.history.length > 1 && session.historyLength > MAX_HISTORY_CHARS) {
            session.historyLength -= session.history[0].length;
            session.history.shift();
          }

          if (session.attached) {
            onData?.(sessionId, text, session.seq);
          } else {
            logShellOutput(text);
          }
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
  sessions.get(sessionId)?.stream?.write(data);
}

function resize(sessionId, cols, rows) {
  sessions.get(sessionId)?.stream?.setWindow(rows, cols, rows, cols);
}

// Called by the renderer once its terminal is mounted and listening.
// Returns everything the shell has printed so far and switches to live
// streaming. Attaching is repeatable on purpose: React (StrictMode, or any
// future remount) may tear a terminal down and mount a fresh one, and the
// fresh one gets the same full history to replay onto its blank screen.
// `lastSeq` marks where that history ends so the renderer can skip live
// chunks that are already inside it.
function attach(sessionId) {
  const session = sessions.get(sessionId);
  if (!session) return { backlog: '', lastSeq: 0 };
  session.attached = true;
  return { backlog: (session.history ?? []).join(''), lastSeq: session.seq ?? 0 };
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
  attach,
  disconnect,
  sftpHome,
  sftpList,
  sftpDownload,
  sftpUpload,
};
