'use strict';

/**
 * The "SSH Flags" field on a connection, parsed.
 *
 * The field takes OpenSSH-style `Key=value` pairs, but the transport underneath
 * is ssh2, not OpenSSH — it understands a small, fixed set of settings and
 * nothing else. So every flag has to be named here to do anything at all:
 * anything outside this table is reported back as unsupported rather than
 * handed to ssh2, where an unknown key would either be ignored in silence or
 * crash the connect.
 *
 * The same table is used to validate a host before it is saved and to build the
 * connect config, so a flag can never pass one and be dropped by the other.
 */

// Seconds and milliseconds both get an upper bound simply to keep a typo out of
// ssh2's timers — a keepalive of 0 spins, and a day is longer than any session
// this is useful for.
const MAX_SECONDS = 86400;
const MAX_MS = MAX_SECONDS * 1000;

const FLAGS = {
  serveraliveinterval: { key: 'keepaliveInterval', type: 'seconds', min: 1, max: MAX_SECONDS },
  keepaliveinterval: { key: 'keepaliveInterval', type: 'ms', min: 1000, max: MAX_MS },
  serveralivecountmax: { key: 'keepaliveCountMax', type: 'int', min: 1, max: 1000 },
  keepalivecountmax: { key: 'keepaliveCountMax', type: 'int', min: 1, max: 1000 },
  // ssh2 spells it `compress`; `compression` is silently ignored.
  compression: { key: 'compress', type: 'bool' },
  compress: { key: 'compress', type: 'bool' },
  connecttimeout: { key: 'readyTimeout', type: 'seconds', min: 1, max: MAX_SECONDS },
  readytimeout: { key: 'readyTimeout', type: 'ms', min: 1000, max: MAX_MS },
  forwardagent: { key: 'agentForward', type: 'bool' },
  agentforwarding: { key: 'agentForward', type: 'bool' },
};

// The connection's own identity and credentials. They come from the saved host
// and the vault; a flag that could rewrite them would point the session at a
// different machine, or hand its password to one, while still displaying as the
// host you picked.
const RESERVED = new Set([
  'host',
  'hostname',
  'port',
  'user',
  'username',
  'password',
  'passphrase',
  'privatekey',
  'privatekeypath',
  'identityfile',
  'agent',
]);

const TRUE_VALUES = new Set(['yes', 'true', '1', 'on']);
const FALSE_VALUES = new Set(['no', 'false', '0', 'off']);

/** The flag names to offer in the UI, in their conventional spelling. */
const SUPPORTED_FLAGS = [
  'ServerAliveInterval',
  'ServerAliveCountMax',
  'ConnectTimeout',
  'Compression',
  'ForwardAgent',
];

function coerce(spec, name, raw) {
  if (spec.type === 'bool') {
    const val = raw.toLowerCase();
    if (TRUE_VALUES.has(val)) return { value: true };
    if (FALSE_VALUES.has(val)) return { value: false };
    return { error: `${name} must be yes or no (got "${raw}")` };
  }

  // `Number('')` is 0 and `Number('12abc')` is NaN — both would reach ssh2 as a
  // timer value, so the string has to look like a plain integer first.
  if (!/^\d+$/.test(raw)) {
    return { error: `${name} must be a whole number (got "${raw}")` };
  }
  const num = Number(raw);
  if (!Number.isFinite(num) || num < spec.min || num > spec.max) {
    return { error: `${name} must be between ${spec.min} and ${spec.max} (got "${raw}")` };
  }
  return { value: spec.type === 'seconds' ? num * 1000 : num };
}

/**
 * Turns the flags field into the ssh2 options it stands for.
 *
 * Returns every problem it found rather than the first, so a user fixing a
 * typo is not sent back for the next one immediately after.
 */
function parseFlags(input) {
  const config = {};
  const errors = [];

  const text = String(input || '').trim();
  if (!text) return { config, errors };

  for (const token of text.split(/\s+/)) {
    if (!token) continue;

    const eq = token.indexOf('=');
    if (eq <= 0) {
      errors.push(`Invalid flag format: "${token}" (expected Key=value)`);
      continue;
    }

    const name = token.slice(0, eq).trim();
    const raw = token.slice(eq + 1).trim();
    const lower = name.toLowerCase();

    if (!raw) {
      errors.push(`${name} needs a value`);
      continue;
    }
    if (RESERVED.has(lower)) {
      errors.push(`${name} cannot be set here — it comes from the saved host`);
      continue;
    }

    const spec = FLAGS[lower];
    if (!spec) {
      errors.push(`Unsupported flag: "${name}". Supported: ${SUPPORTED_FLAGS.join(', ')}`);
      continue;
    }

    const result = coerce(spec, name, raw);
    if (result.error) {
      errors.push(result.error);
      continue;
    }
    config[spec.key] = result.value;
  }

  // ssh2 refuses to connect with agent forwarding on and no agent to forward,
  // and its own error for it says nothing about the flag that caused it.
  if (config.agentForward && !process.env.SSH_AUTH_SOCK) {
    errors.push('ForwardAgent needs a running SSH agent (SSH_AUTH_SOCK is not set)');
  }

  return { config, errors };
}

module.exports = { parseFlags, SUPPORTED_FLAGS };
