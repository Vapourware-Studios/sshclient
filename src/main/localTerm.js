const os = require('os');
const crypto = require('crypto');
const pty = require('node-pty');

const sessions = new Map();

const MAX_HISTORY_CHARS = 200000;

function defaultShell() {
  if (process.platform === 'win32') return process.env.COMSPEC || 'powershell.exe';
  return process.env.SHELL || '/bin/zsh';
}

function connect(config = {}, handlers = {}) {
  const { onData, onClose, onError } = handlers;
  const sessionId = crypto.randomUUID();
  const shell = config.shell || defaultShell();
  const cwd = config.cwd || os.homedir();

  const term = pty.spawn(shell, [], {
    name: 'xterm-256color',
    cols: config.cols || 80,
    rows: config.rows || 24,
    cwd,
    env: process.env,
  });

  const session = { term, history: [], historyLength: 0, seq: 0, attached: false };
  sessions.set(sessionId, session);

  term.onData((text) => {
    session.seq += 1;
    session.history.push(text);
    session.historyLength += text.length;
    while (session.history.length > 1 && session.historyLength > MAX_HISTORY_CHARS) {
      session.historyLength -= session.history[0].length;
      session.history.shift();
    }
    if (session.attached) onData?.(sessionId, text, session.seq);
  });

  term.onExit(({ exitCode }) => {
    sessions.delete(sessionId);
    if (exitCode !== 0) onError?.(sessionId, new Error(`Shell exited with code ${exitCode}`));
    onClose?.(sessionId);
  });

  return sessionId;
}

function write(sessionId, data) {
  sessions.get(sessionId)?.term?.write(data);
}

function resize(sessionId, cols, rows) {
  if (cols > 0 && rows > 0) sessions.get(sessionId)?.term?.resize(cols, rows);
}

function attach(sessionId) {
  const session = sessions.get(sessionId);
  if (!session) return { backlog: '', lastSeq: 0 };
  session.attached = true;
  return { backlog: session.history.join(''), lastSeq: session.seq };
}

function disconnect(sessionId) {
  const session = sessions.get(sessionId);
  if (session) {
    session.term.kill();
    sessions.delete(sessionId);
  }
}

module.exports = { connect, write, resize, attach, disconnect };
