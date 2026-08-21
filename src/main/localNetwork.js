'use strict';

const dgram = require('dgram');

// The mDNS group every machine on a network listens to. Sending to it is the
// ordinary way an app asks macOS whether it may speak to the network it is
// plugged into: the system puts the question to the person the first time and
// remembers what they said.
const MDNS_GROUP = '224.0.0.251';
const MDNS_PORT = 5353;
const PROBE_TIMEOUT_MS = 2000;

// What macOS reports once it has decided the answer is no. A refusal is
// indistinguishable from a genuinely unreachable network at this level, so
// treat both alike: neither can talk to a machine on the LAN.
const DENIED_CODES = new Set(['EHOSTUNREACH', 'ENETUNREACH', 'EPERM', 'EACCES']);

/**
 * A well-formed query for the service-enumeration record — the same thing any
 * Bonjour browser opens with. Sending a valid query rather than noise keeps
 * this honest to anything else listening on the group.
 */
function buildServiceQuery() {
  const labels = ['_services', '_dns-sd', '_udp', 'local'];
  const name = Buffer.concat([
    ...labels.map((label) => Buffer.concat([Buffer.from([label.length]), Buffer.from(label, 'ascii')])),
    Buffer.from([0]),
  ]);

  const header = Buffer.alloc(12);
  header.writeUInt16BE(1, 4); // one question, no id: mDNS queries go unnumbered

  const tail = Buffer.alloc(4);
  tail.writeUInt16BE(12, 0); // PTR
  tail.writeUInt16BE(1, 2); // IN
  return Buffer.concat([header, name, tail]);
}

// What the last probe concluded, so a failed connection can say whether the
// system is known to be refusing rather than only guessing at it.
let lastStatus = null;

function getStatus() {
  return lastStatus;
}

function classifyProbeError(err) {
  if (!err) return 'allowed';
  return DENIED_CODES.has(err.code) ? 'denied' : 'unknown';
}

/**
 * Puts one packet on the local network at startup so macOS makes its decision
 * then, rather than the first time somebody clicks a host on their own LAN.
 *
 * Getting it out of the way early matters because of how a refusal looks: the
 * connection fails with the same errno as a machine that is switched off, with
 * no prompt and no entry under Local Network to switch on. Asking up front
 * turns a silent, un-diagnosable failure into a dialog.
 *
 * A successful send is not proof of consent — the reply can still be dropped —
 * so 'allowed' here means only that nothing refused us outright.
 */
function probeLocalNetwork() {
  if (process.platform !== 'darwin') {
    lastStatus = 'not-applicable';
    return Promise.resolve({ status: lastStatus, code: null });
  }

  return new Promise((resolve) => {
    let socket = null;
    let settled = false;

    const finish = (status, code = null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try {
        socket?.close();
      } catch {}
      lastStatus = status;
      resolve({ status, code });
    };

    const timer = setTimeout(() => finish('unknown'), PROBE_TIMEOUT_MS);

    try {
      socket = dgram.createSocket({ type: 'udp4', reuseAddr: true });
      socket.on('error', (err) => finish(classifyProbeError(err), err?.code ?? null));
      socket.bind(0, () => {
        socket.send(buildServiceQuery(), MDNS_PORT, MDNS_GROUP, (err) =>
          finish(classifyProbeError(err), err?.code ?? null)
        );
      });
    } catch (err) {
      finish(classifyProbeError(err), err?.code ?? null);
    }
  });
}

module.exports = { probeLocalNetwork, classifyProbeError, buildServiceQuery, getStatus };
