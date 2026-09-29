/**
 * Where a saved snippet should run.
 *
 * Host ids that no longer match a saved host are reported and left out of
 * `hosts`. A snippet that names nothing is `untargeted`: the caller sends it
 * to an SSH session that is already open. `runLocal` opens a local terminal
 * in the home directory.
 */
export function planSnippetLaunch(snippet, hosts) {
  const hostList = Array.isArray(hosts) ? hosts : [];
  const targetIds = Array.isArray(snippet?.targets)
    ? snippet.targets.filter((id) => typeof id === 'string')
    : [];

  const resolvedHosts = [];
  const missingHostIds = [];
  for (const id of targetIds) {
    const host = hostList.find((candidate) => candidate && candidate.id === id);
    if (host) resolvedHosts.push(host);
    else missingHostIds.push(id);
  }

  const runLocal = snippet?.runLocal === true;
  const local = runLocal ? {} : null;

  return {
    local,
    hosts: resolvedHosts,
    missingHostIds,
    untargeted: !runLocal && targetIds.length === 0,
  };
}

/**
 * A missing host blocks the whole run. The notice is shown on the Snippets
 * panel, and opening a terminal covers that panel, so running whatever is
 * left would hide that a requested target was skipped.
 *
 * Returns the notice to show, or null when every named target still exists.
 */
export function snippetRunRefusal(plan) {
  if (!plan?.missingHostIds?.length) return null;
  if (plan.local || plan.hosts?.length) {
    return 'Some of this snippet\u2019s targets no longer exist under Hosts';
  }
  return 'None of this snippet\u2019s targets still exist under Hosts';
}

export function commandText(command) {
  const text = typeof command === 'string' ? command : '';
  return text.endsWith('\n') ? text : `${text}\n`;
}

/**
 * One entry per place the snippet will open. A local shell uses the home
 * directory. An SSH place carries the saved host id.
 */
export function placesFor(plan) {
  const launches = [];
  if (plan?.local) {
    launches.push({ title: 'Local terminal', type: 'local', connectConfig: {} });
  }
  for (const host of plan?.hosts ?? []) {
    launches.push({
      title: host.label || host.host,
      type: 'ssh',
      connectConfig: { hostId: host.id },
    });
  }
  return launches;
}

async function settlePlace(launch, command, io) {
  const connect = launch.type === 'local' ? io.localConnect : io.sshConnect;
  let result;
  try {
    result = await connect(launch.connectConfig);
  } catch (err) {
    result = { error: err.message };
  }

  // The tab can have been closed while the shell was starting. Drop the
  // session before any command is typed into it.
  if (io.isAbandoned?.(launch)) {
    if (result?.sessionId) {
      const disconnect = launch.type === 'local' ? io.localDisconnect : io.sshDisconnect;
      await disconnect(result.sessionId);
    }
    return { launch, abandoned: true };
  }

  if (!result?.sessionId || result.error) {
    return { launch, error: result?.error || 'Could not start the connection' };
  }

  // The tab has to carry this id before any input. A command that exits the
  // local shell, or an SSH host-key prompt from a faster member of the group,
  // is reported under this id and otherwise matches nothing.
  io.claimSession?.(launch, result.sessionId);

  // A local pty accepts input the moment it exists. SSH does not: the
  // command has to wait until the session is ready, or it is typed into
  // the password prompt.
  if (launch.type === 'local') {
    io.localWrite(result.sessionId, command);
    return { launch, sessionId: result.sessionId, delivery: 'immediate' };
  }

  const onReady = () => io.sshWrite(result.sessionId, command);
  io.onSshReady(result.sessionId, onReady);
  return { launch, sessionId: result.sessionId, delivery: 'on-ready' };
}

/**
 * Connect every place and send the snippet command. Each place is claimed
 * as its own connection returns, without waiting for the others. Local
 * shells are written after that claim. SSH shells are handed to
 * `io.onSshReady` and are not written here.
 */
export async function deliverSnippetPlaces(snippet, launches, io) {
  const command = commandText(snippet?.command);
  return Promise.all(launches.map((launch) => settlePlace(launch, command, io)));
}
