const crypto = require('crypto');
const { StringDecoder } = require('string_decoder');
const { SerialPort } = require('serialport');

const sessions = new Map();

const MAX_HISTORY_CHARS = 200000;

function listPorts() {
  return SerialPort.list();
}

function connect(config = {}, handlers = {}) {
  const { onData, onClose, onError } = handlers;

  return new Promise((resolve, reject) => {
    if (!config.path) {
      reject(new Error('A serial port is required'));
      return;
    }

    const sessionId = crypto.randomUUID();
    const port = new SerialPort({
      path: config.path,
      baudRate: Number(config.baudRate) || 9600,
      dataBits: Number(config.dataBits) || 8,
      stopBits: Number(config.stopBits) || 1,
      parity: config.parity || 'none',
      autoOpen: false,
    });

    const session = { port, history: [], historyLength: 0, seq: 0, attached: false };
    const decoder = new StringDecoder('utf8');

    port.on('data', (chunk) => {
      const text = decoder.write(chunk);
      session.seq += 1;
      session.history.push(text);
      session.historyLength += text.length;
      while (session.history.length > 1 && session.historyLength > MAX_HISTORY_CHARS) {
        session.historyLength -= session.history[0].length;
        session.history.shift();
      }
      if (session.attached) onData?.(sessionId, text, session.seq);
    });

    port.on('close', () => {
      sessions.delete(sessionId);
      onClose?.(sessionId);
    });

    port.open((err) => {
      if (err) {
        reject(err);
        return;
      }
      sessions.set(sessionId, session);
      resolve(sessionId);
    });

    port.on('error', (err) => {
      if (sessions.has(sessionId)) onError?.(sessionId, err);
    });
  });
}

function write(sessionId, data) {
  sessions.get(sessionId)?.port?.write(data);
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
    sessions.delete(sessionId);
    session.port.close(() => {});
  }
}

module.exports = { listPorts, connect, write, attach, disconnect };
