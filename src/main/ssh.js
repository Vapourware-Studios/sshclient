const { Client } = require('ssh2');
const crypto = require('crypto');
const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const net = require('net');
const { StringDecoder } = require('string_decoder');
const vault = require('./vault');

const sessions = new Map();
const pending = new Map();

const MAX_HISTORY_CHARS = 200000;
const MAX_RECORDING_CHARS = 2000000;

function stripControlSequences(text) {
  return text
    .replace(/\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g, '')
    .replace(/\x1b\[[0-9;?]*[ -/]*[@-~]/g, '')
    .replace(/\x1b[@-_]/g, '')
    .replace(/[\x00-\x08\x0b-\x1f\x7f]/g, '');
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

  if (config.password) connectConfig.password = config.password;

  return connectConfig;
}

function installPublicKeyAsync(conn, publicKey) {
  const line = publicKey.trim();
  if (!line || line.includes('\n')) {
    return Promise.reject(new Error('Public key has an unexpected format'));
  }

  const cmd =
    'umask 077; KEY_LINE=$(cat); mkdir -p ~/.ssh && chmod 700 ~/.ssh && ' +
    'touch ~/.ssh/authorized_keys && chmod 600 ~/.ssh/authorized_keys && ' +
    'grep -qxF "$KEY_LINE" ~/.ssh/authorized_keys || echo "$KEY_LINE" >> ~/.ssh/authorized_keys';

  return new Promise((resolve, reject) => {
    conn.exec(cmd, (err, stream) => {
      if (err) return reject(err);
      let stderr = '';
      stream.on('data', () => {});
      stream.stderr.on('data', (chunk) => {
        stderr += chunk.toString('utf8');
      });
      stream.on('close', (code) => {
        if (code === 0) resolve();
        else reject(new Error(stderr.trim() || `authorized_keys install exited with code ${code}`));
      });
      stream.end(line + '\n');
    });
  });
}

const OS_ID_TO_ICON = [
  ['ubuntu', 'ubuntu'],
  ['debian', 'debian'],
  ['raspbian', 'raspberrypi'],
  ['fedora', 'fedora'],
  ['centos', 'centos'],
  ['rhel', 'redhat'],
  ['rocky', 'rockylinux'],
  ['almalinux', 'almalinux'],
  ['arch', 'archlinux'],
  ['opensuse', 'opensuse'],
  ['sles', 'opensuse'],
  ['alpine', 'alpinelinux'],
  ['freebsd', 'freebsd'],
];

function detectOsIcon(probeOutput) {
  if (/RASPBERRY_PI_MODEL/.test(probeOutput)) return 'raspberrypi';

  const idMatch = probeOutput.match(/^ID=["']?([\w.-]+)/im);
  const idLikeMatch = probeOutput.match(/^ID_LIKE=["']?([\w.\- ]+)/im);
  const ids = [idMatch?.[1], ...(idLikeMatch?.[1]?.split(/\s+/) ?? [])].filter(Boolean);
  for (const id of ids) {
    const hit = OS_ID_TO_ICON.find(([osId]) => osId === id.toLowerCase());
    if (hit) return hit[1];
  }

  if (/^Darwin/im.test(probeOutput)) return 'apple';
  if (/^FreeBSD/im.test(probeOutput)) return 'freebsd';
  if (/^Linux/im.test(probeOutput)) return 'linux';
  return null;
}

function detectAndSaveOsIcon(hostId, conn, onDetected) {
  const cmd =
    'cat /etc/os-release 2>/dev/null; ' +
    'grep -qi raspberry /proc/device-tree/model 2>/dev/null && echo RASPBERRY_PI_MODEL; ' +
    'uname -s 2>/dev/null';

  conn.exec(cmd, (err, stream) => {
    if (err) return;
    let output = '';
    stream.on('data', (chunk) => {
      output += chunk.toString('utf8');
    });
    stream.stderr.on('data', () => {});
    stream.on('close', () => {
      const icon = detectOsIcon(output);
      if (!icon) return;
      try {
        const hosts = vault.saveHost({ id: hostId, icon });
        onDetected?.(hosts);
      } catch {}
    });
  });
}

function installPublicKey(conn, publicKey, log) {
  installPublicKeyAsync(conn, publicKey)
    .then(() => log('Public key is set up in ~/.ssh/authorized_keys'))
    .catch((err) => log(`Could not update authorized_keys: ${err.message}`, 'error'));
}

function connect(config, handlers = {}) {
  const { onProgress, onReady, onData, onClose, onError, onHostKey, onLog, onRecording, onHostsUpdated } =
    handlers;

  if (config.mode === 'keycopy' && !config.publicKey) {
    throw new Error('A public key is required to copy a key to a host');
  }

  const connectConfig = buildConnectConfig(config);
  const conn = new Client();
  const sessionId = crypto.randomUUID();
  pending.set(sessionId, conn);

  const log = (line, level = 'info') => onLog?.(sessionId, line, level);

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
    if (config.id) {
      try {
        onHostsUpdated?.(vault.saveHost({ id: config.id, lastConnectedAt: Date.now() }));
      } catch {}
      if (!config.icon) detectAndSaveOsIcon(config.id, conn, onHostsUpdated);
    }

    if (config.mode === 'keycopy') {
      onProgress?.(sessionId, 'keycopy');
      log('Authenticated. Installing public key…');
      installPublicKeyAsync(conn, config.publicKey)
        .then(() => {
          pending.delete(sessionId);
          log('Public key is set up in ~/.ssh/authorized_keys');
          conn.end();
          onReady?.(sessionId);
        })
        .catch((err) => {
          pending.delete(sessionId);
          log(`Could not update authorized_keys: ${err.message}`, 'error');
          conn.end();
          onError?.(sessionId, err);
        });
      return;
    }

    if (config.publicKey) installPublicKey(conn, config.publicKey, log);

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

        const session = {
          conn,
          stream,
          sftp: null,
          history: [],
          historyLength: 0,
          seq: 0,
          attached: false,
          recording: [],
          recordingLength: 0,
          recordingStartedAt: Date.now(),
          forwards: new Map(),
        };
        sessions.set(sessionId, session);

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

        const decoder = new StringDecoder('utf8');
        let outBuffer = '';
        let flushScheduled = false;

        const flush = () => {
          flushScheduled = false;
          if (!outBuffer) return;
          const text = outBuffer;
          outBuffer = '';

          session.recording.push({ at: Date.now() - session.recordingStartedAt, data: text });
          session.recordingLength += text.length;
          while (session.recording.length > 1 && session.recordingLength > MAX_RECORDING_CHARS) {
            session.recordingLength -= session.recording[0].data.length;
            session.recording.shift();
          }
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
        };

        stream.on('data', (chunk) => {
          outBuffer += decoder.write(chunk);
          if (!flushScheduled) {
            flushScheduled = true;
            setImmediate(flush);
          }
        });

        stream.on('close', () => {
          flush();
          for (const server of session.forwards.values()) server.close();
          onRecording?.(sessionId, {
            host: connectConfig.host,
            username: connectConfig.username,
            startedAt: session.recordingStartedAt,
            duration: Date.now() - session.recordingStartedAt,
            frames: session.recording,
          });
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
  conn.setNoDelay(true);

  return sessionId;
}

function startForward(sessionId, spec) {
  const session = sessions.get(sessionId);
  if (!session) return Promise.reject(new Error('SSH session not found'));
  const bindHost = String(spec.bindHost || '127.0.0.1');
  const bindPort = Number(spec.bindPort);
  const targetHost = String(spec.targetHost || '').trim();
  const targetPort = Number(spec.targetPort);
  if (!targetHost || !Number.isInteger(bindPort) || bindPort < 0 || bindPort > 65535 ||
      !Number.isInteger(targetPort) || targetPort < 1 || targetPort > 65535) {
    return Promise.reject(new Error('Valid local and destination ports are required'));
  }
  return new Promise((resolve, reject) => {
    const server = net.createServer((socket) => {
      session.conn.forwardOut(socket.remoteAddress || bindHost, socket.remotePort || 0, targetHost, targetPort, (err, stream) => {
        if (err) return socket.destroy(err);
        socket.pipe(stream).pipe(socket);
      });
    });
    server.once('error', reject);
    server.listen(bindPort, bindHost, () => {
      server.removeListener('error', reject);
      const address = server.address();
      const id = crypto.randomUUID();
      session.forwards.set(id, server);
      resolve({ id, bindHost, bindPort: address.port, targetHost, targetPort });
    });
  });
}

function stopForward(sessionId, forwardId) {
  const server = sessions.get(sessionId)?.forwards?.get(forwardId);
  if (!server) return false;
  server.close();
  sessions.get(sessionId).forwards.delete(forwardId);
  return true;
}

function write(sessionId, data) {
  sessions.get(sessionId)?.stream?.write(data);
}

function resize(sessionId, cols, rows) {
  sessions.get(sessionId)?.stream?.setWindow(rows, cols, rows, cols);
}

function attach(sessionId) {
  const session = sessions.get(sessionId);
  if (!session) return { backlog: '', lastSeq: 0 };
  session.attached = true;
  return { backlog: (session.history ?? []).join(''), lastSeq: session.seq ?? 0 };
}

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

function assertSafeSftpName(name) {
  if (
    typeof name !== 'string' ||
    name === '' ||
    name === '.' ||
    name === '..' ||
    name.includes('/') ||
    name.includes('\\')
  ) {
    throw new Error('Unsafe filename returned by SFTP server');
  }
  return name;
}

function assertSafeRelativePath(relPath) {
  if (typeof relPath !== 'string' || relPath === '') {
    throw new Error('Unsafe relative SFTP path');
  }
  for (const segment of relPath.split('/')) assertSafeSftpName(segment);
  return relPath;
}

function resolveLocalChild(rootDir, relPath) {
  assertSafeRelativePath(relPath);
  const root = path.resolve(rootDir);
  const destination = path.resolve(root, ...relPath.split('/'));
  const relative = path.relative(root, destination);
  if (
    relative === '' ||
    relative === '..' ||
    relative.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relative)
  ) {
    throw new Error('Local SFTP destination escapes the selected directory');
  }
  return destination;
}

async function sftpList(sessionId, dirPath) {
  const sftp = await getSftp(sessionId);
  return new Promise((resolve, reject) => {
    sftp.readdir(dirPath, (err, items) => {
      if (err) return reject(err);

      const entries = items.map(({ filename, attrs }) => ({
        name: assertSafeSftpName(filename),
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

async function sftpTransferRemote(sourceSessionId, sourcePath, destSessionId, destPath, onStep) {
  const sourceSftp = await getSftp(sourceSessionId);
  const destSftp = await getSftp(destSessionId);

  const total = await new Promise((resolve, reject) => {
    sourceSftp.stat(sourcePath, (err, stat) => (err ? reject(err) : resolve(stat.size)));
  });

  return new Promise((resolve, reject) => {
    const readStream = sourceSftp.createReadStream(sourcePath);
    const writeStream = destSftp.createWriteStream(destPath);
    let transferred = 0;

    readStream.on('data', (chunk) => {
      transferred += chunk.length;
      onStep?.(transferred, total);
    });
    readStream.on('error', reject);
    writeStream.on('error', reject);
    writeStream.on('close', resolve);
    readStream.pipe(writeStream);
  });
}

async function sftpIsDir(sessionId, remotePath) {
  const sftp = await getSftp(sessionId);
  return new Promise((resolve, reject) => {
    sftp.stat(remotePath, (err, stat) => (err ? reject(err) : resolve(stat.isDirectory())));
  });
}

function joinRemotePath(base, relPath) {
  assertSafeRelativePath(relPath);
  return (base === '/' ? '' : base) + '/' + relPath;
}

function mkdirRemote(sftp, remoteDir) {
  return new Promise((resolve) => {
    sftp.mkdir(remoteDir, () => resolve());
  });
}

async function walkLocalDir(rootDir) {
  const dirs = [];
  const files = [];

  async function walk(dir, rel) {
    const entries = await fsp.readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const abs = path.join(dir, entry.name);
      const relPath = rel ? `${rel}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        dirs.push(relPath);
        await walk(abs, relPath);
      } else if (entry.isFile()) {
        const stat = await fsp.stat(abs);
        files.push({ relPath, abs, size: stat.size });
      }
    }
  }

  await walk(rootDir, '');
  return { dirs, files };
}

async function walkRemoteDir(sftp, rootDir) {
  const dirs = [];
  const files = [];

  async function walk(dir, rel) {
    const items = await new Promise((resolve, reject) => {
      sftp.readdir(dir, (err, list) => (err ? reject(err) : resolve(list)));
    });
    for (const item of items) {
      const filename = assertSafeSftpName(item.filename);
      const relPath = rel ? `${rel}/${filename}` : filename;
      const abs = joinRemotePath(dir, filename);
      if (item.attrs.isDirectory()) {
        dirs.push(relPath);
        await walk(abs, relPath);
      } else if (!item.attrs.isSymbolicLink()) {
        files.push({ relPath, abs, size: item.attrs.size });
      }
    }
  }

  await walk(rootDir, '');
  return { dirs, files };
}

async function sftpUploadDir(sessionId, localDir, remoteDir, onStep) {
  const sftp = await getSftp(sessionId);
  const { dirs, files } = await walkLocalDir(localDir);
  const grandTotal = files.reduce((sum, f) => sum + f.size, 0);

  await mkdirRemote(sftp, remoteDir);
  for (const relDir of dirs) {
    await mkdirRemote(sftp, joinRemotePath(remoteDir, relDir));
  }

  let doneBytes = 0;
  for (const file of files) {
    const remotePath = joinRemotePath(remoteDir, file.relPath);
    await new Promise((resolve, reject) => {
      sftp.fastPut(
        file.abs,
        remotePath,
        { step: (transferred) => onStep?.(doneBytes + transferred, grandTotal) },
        (err) => (err ? reject(err) : resolve())
      );
    });
    doneBytes += file.size;
    onStep?.(doneBytes, grandTotal);
  }
}

async function sftpDownloadDir(sessionId, remoteDir, localDir, onStep) {
  const sftp = await getSftp(sessionId);
  const { dirs, files } = await walkRemoteDir(sftp, remoteDir);
  const grandTotal = files.reduce((sum, f) => sum + f.size, 0);

  await fsp.mkdir(localDir, { recursive: true });
  for (const relDir of dirs) {
    await fsp.mkdir(resolveLocalChild(localDir, relDir), { recursive: true });
  }

  let doneBytes = 0;
  for (const file of files) {
    const localPath = resolveLocalChild(localDir, file.relPath);
    await new Promise((resolve, reject) => {
      sftp.fastGet(
        file.abs,
        localPath,
        { step: (transferred) => onStep?.(doneBytes + transferred, grandTotal) },
        (err) => (err ? reject(err) : resolve())
      );
    });
    doneBytes += file.size;
    onStep?.(doneBytes, grandTotal);
  }
}

async function sftpTransferRemoteDir(sourceSessionId, sourceDir, destSessionId, destDir, onStep) {
  const sourceSftp = await getSftp(sourceSessionId);
  const destSftp = await getSftp(destSessionId);
  const { dirs, files } = await walkRemoteDir(sourceSftp, sourceDir);
  const grandTotal = files.reduce((sum, f) => sum + f.size, 0);

  await mkdirRemote(destSftp, destDir);
  for (const relDir of dirs) {
    await mkdirRemote(destSftp, joinRemotePath(destDir, relDir));
  }

  let doneBytes = 0;
  for (const file of files) {
    const destPath = joinRemotePath(destDir, file.relPath);
    await new Promise((resolve, reject) => {
      const readStream = sourceSftp.createReadStream(file.abs);
      const writeStream = destSftp.createWriteStream(destPath);
      let transferred = 0;

      readStream.on('data', (chunk) => {
        transferred += chunk.length;
        onStep?.(doneBytes + transferred, grandTotal);
      });
      readStream.on('error', reject);
      writeStream.on('error', reject);
      writeStream.on('close', resolve);
      readStream.pipe(writeStream);
    });
    doneBytes += file.size;
  }
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
  startForward,
  stopForward,
  installPublicKeyAsync,
  detectOsIcon,
  sftpHome,
  sftpList,
  sftpDownload,
  sftpUpload,
  sftpTransferRemote,
  sftpIsDir,
  sftpUploadDir,
  sftpDownloadDir,
  sftpTransferRemoteDir,
  assertSafeSftpName,
  joinRemotePath,
  resolveLocalChild,
};
