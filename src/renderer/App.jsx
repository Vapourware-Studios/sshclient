import { useEffect, useRef, useState } from 'react';
import { Palette, Share2 } from 'lucide-react';
import Unlock from '@/components/Unlock';
import NewConnectionDialog from '@/components/NewConnectionDialog';
import TabBar from '@/components/TabBar';
import ContentArea from '@/components/ContentArea';
import TerminalStylePanel from '@/components/TerminalStylePanel';
import SharePanel from '@/components/SharePanel';
import ShareToasts from '@/components/ShareToasts';
import { SlidePanel } from '@/components/SlidePanel';
import FeedbackPromptToast from '@/components/FeedbackPromptToast';
import { useConfirm } from '@/lib/confirm';
import { useSharing } from '@/lib/sharing.jsx';

const MIN_CONNECTING_MS = 2000;
// Lines kept per session before the oldest are dropped.
const SESSION_LOG_LIMIT = 400;

/** Names a tab after whoever is sharing, once the relay has said who that is. */
function sharedTabTitle(state) {
  const owner = state.members?.find((m) => m.role === 'owner');
  return owner ? `${owner.name} (shared)` : 'Shared terminal';
}

export default function App() {
  const confirm = useConfirm();
  const { shares, viewing } = useSharing();
  const [vaultStatus, setVaultStatus] = useState(null);
  const [hosts, setHosts] = useState([]);
  const [tabs, setTabs] = useState([
    { id: 'vault', title: 'Hosts', constant: true },
    { id: 'sftp', title: 'SFTP', constant: true },
  ]);
  const [activeTabId, setActiveTabId] = useState('vault');
  const [dialogOpen, setDialogOpen] = useState(false);
  const [stylePanelOpen, setStylePanelOpen] = useState(false);
  const [sharePanelOpen, setSharePanelOpen] = useState(false);
  const [editingHost, setEditingHost] = useState(null);
  const [dialogInitialType, setDialogInitialType] = useState('ssh');
  const [connectError, setConnectError] = useState(null);
  const [sessionLogs, setSessionLogs] = useState({});

  const startedAtRef = useRef(new Map());
  // Placeholder ids whose tab was closed while their connect was still in
  // flight. Whoever is awaiting that connect hangs up on it when it lands.
  const abandonedPendingRef = useRef(new Set());
  const pendingTimeoutsRef = useRef(new Map());
  const pendingReadyActionRef = useRef(new Map());

  function afterMinDelay(sessionId, apply) {
    const startedAt = startedAtRef.current.get(sessionId) ?? Date.now();
    const remaining = Math.max(0, MIN_CONNECTING_MS - (Date.now() - startedAt));

    const timeoutId = setTimeout(() => {
      pendingTimeoutsRef.current.delete(sessionId);
      startedAtRef.current.delete(sessionId);
      apply();
    }, remaining);

    pendingTimeoutsRef.current.set(sessionId, timeoutId);
  }

  useEffect(() => {
    refreshVaultStatus();
  }, []);

  useEffect(() => {
    const prevent = (e) => e.preventDefault();
    document.addEventListener('dragover', prevent);
    document.addEventListener('drop', prevent);
    return () => {
      document.removeEventListener('dragover', prevent);
      document.removeEventListener('drop', prevent);
    };
  }, []);

  useEffect(() => {
    if (vaultStatus?.unlocked) refreshHosts();
  }, [vaultStatus?.unlocked]);

  // A share the user accepted opens a tab of its own. The main process has
  // already joined by the time its state shows up here, so this only mirrors
  // it into the UI. The tab is never focused for them: a share link can be
  // fired by any page they happen to visit, and a terminal that appears under
  // the cursor mid-keystroke is the last thing that should have their input.
  useEffect(() => {
    setTabs((prev) => {
      const known = new Set(prev.map((t) => t.id));
      const added = Object.values(viewing)
        .filter((state) => !known.has(state.shareId))
        .map((state) => ({
          id: state.shareId,
          title: sharedTabTitle(state),
          type: 'shared',
          status: 'connected',
        }));
      // A share that ended takes its tab with it, the moment it drops out of
      // `viewing`. The session behind it is already gone by then — whether the
      // owner stopped sharing, their shell exited, or this app was removed from
      // it — so leaving the tab up would leave a terminal on screen with
      // nothing behind it and no way to tell that from a live one.
      const kept = prev.filter((t) => t.type !== 'shared' || viewing[t.id]);

      let changed = added.length > 0 || kept.length !== prev.length;
      // Titles firm up once the welcome message names the owner's device.
      const next = [...kept, ...added].map((t) => {
        const state = t.type === 'shared' ? viewing[t.id] : null;
        const title = state ? sharedTabTitle(state) : null;
        if (!title || title === t.title) return t;
        changed = true;
        return { ...t, title };
      });
      // Presence churns on every join, leave and handover; don't re-render the
      // whole tab strip for an event that renamed nothing.
      return changed ? next : prev;
    });
  }, [viewing]);

  // A tab can go away without anybody here closing it — a share ending takes
  // its own tab — so selection has to be able to land somewhere else.
  useEffect(() => {
    if (tabs.some((t) => t.id === activeTabId)) return;
    const lastRealTab = [...tabs].reverse().find((t) => !t.constant && !t.groupId);
    setActiveTabId(lastRealTab ? lastRealTab.id : 'vault');
  }, [tabs, activeTabId]);

  useEffect(() => {
    return window.api.onHostsChanged(({ hosts }) => setHosts(hosts));
  }, []);

  useEffect(() => {
    function patchTab(sessionId, patch) {
      setTabs((prev) => prev.map((t) => (t.id === sessionId ? { ...t, ...patch } : t)));
    }

    const unsubProgress = window.api.onSshProgress(({ sessionId, stage }) => {
      patchTab(sessionId, { stage });
    });

    const unsubReady = window.api.onSshReady(({ sessionId }) => {
      afterMinDelay(sessionId, () => {
        patchTab(sessionId, { status: 'connected' });
        const pending = pendingReadyActionRef.current.get(sessionId);
        if (pending) {
          pendingReadyActionRef.current.delete(sessionId);
          pending.onReady(sessionId);
        }
      });
    });

    const unsubError = window.api.onSshError(({ sessionId, message }) => {
      afterMinDelay(sessionId, () => {
        setTabs((prev) =>
          prev.map((t) =>
            t.id === sessionId && t.status === 'connecting'
              ? { ...t, status: 'error', error: message, hostKeyInfo: null }
              : t
          )
        );
        const pending = pendingReadyActionRef.current.get(sessionId);
        if (pending) {
          pendingReadyActionRef.current.delete(sessionId);
          pending.onFailure?.(message);
        }
      });
    });

    const unsubHostKey = window.api.onSshHostKey(({ sessionId, ...info }) => {
      patchTab(sessionId, { hostKeyInfo: info });
    });

    // A session that was up and then went away keeps its tab, parked on the
    // disconnected view so the reason is visible and reconnecting is one click.
    // Tabs the user closed are already gone from state by the time this fires;
    // a session that never got that far reports through onSshError instead.
    function markDisconnected(sessionId, { reason, message, exitCode }) {
      // The session was ready (only ready sessions ever close), but the tab may
      // still be showing the connecting view because of MIN_CONNECTING_MS —
      // drop that pending flip so it doesn't overwrite the disconnected state.
      const pendingTimeout = pendingTimeoutsRef.current.get(sessionId);
      if (pendingTimeout) {
        clearTimeout(pendingTimeout);
        pendingTimeoutsRef.current.delete(sessionId);
        startedAtRef.current.delete(sessionId);
      }
      const pendingAction = pendingReadyActionRef.current.get(sessionId);
      if (pendingAction) {
        pendingReadyActionRef.current.delete(sessionId);
        pendingAction.onFailure?.(message || 'The connection closed before it could be used');
      }

      setTabs((prev) =>
        prev.map((t) =>
          t.id === sessionId && (t.status === 'connected' || t.status === 'connecting')
            ? {
                ...t,
                status: 'disconnected',
                closeReason: reason === 'closed' ? 'closed' : 'lost',
                closeMessage: message ?? null,
                closeExitCode: exitCode ?? null,
              }
            : t
        )
      );
    }

    const unsubClosed = window.api.onSshClosed(({ sessionId, ...detail }) =>
      markDisconnected(sessionId, detail)
    );
    const unsubLocalClosed = window.api.onLocalClosed(({ sessionId, ...detail }) =>
      markDisconnected(sessionId, detail)
    );
    const unsubSerialClosed = window.api.onSerialClosed(({ sessionId, ...detail }) =>
      markDisconnected(sessionId, detail)
    );

    const unsubLog = window.api.onSshLog(({ sessionId, line, level }) => {
      setSessionLogs((prev) => {
        const entry = { id: crypto.randomUUID(), time: Date.now(), line, level };
        const list = [...(prev[sessionId] ?? []), entry];
        if (list.length > SESSION_LOG_LIMIT) list.splice(0, list.length - SESSION_LOG_LIMIT);
        return { ...prev, [sessionId]: list };
      });
    });

    return () => {
      unsubProgress();
      unsubReady();
      unsubError();
      unsubHostKey();
      unsubClosed();
      unsubLocalClosed();
      unsubSerialClosed();
      unsubLog();
    };
  }, []);

  useEffect(() => {
    const unsub = window.api.onUpdateStart(async ({ targetVersion }) => {
      try {
        setConnectError(null);
        const result = await window.api.localConnect({});
        if (result.error) {
          setConnectError(result.error);
          return;
        }
        const tab = {
          id: result.sessionId,
          title: `Update to ${targetVersion}`,
          type: 'local',
          status: 'connected',
          connectConfig: {},
        };
        setTabs((prev) => [...prev, tab]);
        setActiveTabId(tab.id);
        window.api.localWrite(result.sessionId, 'brew upgrade --cask sshclient');
      } catch {}
    });
    return unsub;
  }, []);

  async function refreshVaultStatus() {
    setVaultStatus(await window.api.vaultStatus());
  }

  async function refreshHosts() {
    const result = await window.api.hostsList();
    if (!result.error) setHosts(result.hosts);
  }

  // A session that belongs to a group never becomes the selected tab — the
  // group is the tab — so it takes the group's member slot instead.
  function focusNewSession(tab, groupId) {
    if (!groupId) {
      setActiveTabId(tab.id);
      return;
    }
    setTabs((prev) =>
      prev.map((t) => (t.id === groupId ? { ...t, activeMemberId: tab.id } : t))
    );
  }

  /**
   * Swaps the placeholder a tab was opened under for the session id the main
   * process handed back, carrying over when the attempt started so the
   * connecting view still measures from the click and not from this moment.
   *
   * Nothing can have patched the tab by its real id before now: the main
   * process only starts reporting progress once the socket is up, which is
   * whole network round trips after the connect call returns.
   */
  function adoptSession(placeholderId, sessionId, groupId, type) {
    const startedAt = startedAtRef.current.get(placeholderId) ?? Date.now();
    startedAtRef.current.delete(placeholderId);
    startedAtRef.current.set(sessionId, startedAt);

    setTabs((prev) =>
      prev.map((t) => {
        if (t.id === placeholderId) {
          const { pending: _pending, ...rest } = t;
          return { ...rest, id: sessionId, status: type === 'ssh' ? t.status : 'connected' };
        }
        if (t.id === groupId && t.activeMemberId === placeholderId) {
          return { ...t, activeMemberId: sessionId };
        }
        return t;
      })
    );
    setActiveTabId((current) => (current === placeholderId ? sessionId : current));
  }

  function dropPending(placeholderId, groupId) {
    startedAtRef.current.delete(placeholderId);
    setTabs((prev) => {
      const next = prev.filter((t) => t.id !== placeholderId);
      // A group that was opened for this one session has nothing left to show.
      const orphanedGroup =
        groupId && !next.some((t) => t.groupId === groupId) ? groupId : null;
      return orphanedGroup ? next.filter((t) => t.id !== orphanedGroup) : next;
    });
  }

  /**
   * The tab goes up the moment it is asked for, before the main process has
   * opened a socket. Connecting is not instant — reading the host out of the
   * vault and parsing an encrypted key are real work — and a window that sits
   * still through it reads as a click that missed.
   */
  async function openSession(connectConfig, title, type = 'ssh', { groupId } = {}) {
    setConnectError(null);

    const placeholderId = `pending:${crypto.randomUUID()}`;
    const tab = {
      id: placeholderId,
      title,
      type,
      status: 'connecting',
      stage: 'connecting',
      connectConfig,
      groupId,
      pending: true,
    };
    startedAtRef.current.set(placeholderId, Date.now());
    setTabs((prev) => [...prev, tab]);
    focusNewSession(tab, groupId);

    const connect =
      type === 'local'
        ? window.api.localConnect
        : type === 'serial'
          ? window.api.serialConnect
          : window.api.sshConnect;

    let result;
    try {
      result = await connect(connectConfig);
    } catch (err) {
      dropPending(placeholderId, groupId);
      throw err;
    }

    // The tab was closed while this was in flight, so the session the main
    // process just opened has nobody to belong to.
    if (abandonedPendingRef.current.delete(placeholderId)) {
      if (result?.sessionId) await disconnectSessionId(result.sessionId, type);
      return null;
    }

    if (result.error) {
      setConnectError(result.error);
      dropPending(placeholderId, groupId);
      throw new Error(result.error);
    }

    adoptSession(placeholderId, result.sessionId, groupId, type);
    return result.sessionId;
  }

  /**
   * Launching a snippet that carries several targets opens one tab, not one
   * per host: the machines it names belong together, so they get a single
   * window with a strip down the left to move between them.
   *
   * The group and a slot for every host are on screen in the first render,
   * before any socket is opened, and the connections then race each other
   * instead of queueing behind one another. The command is sent to each host
   * as it comes up.
   */
  async function openSnippetGroup(snippet, targetHosts) {
    setConnectError(null);
    if (!targetHosts.length) return;

    const groupId = `group:${crypto.randomUUID()}`;
    const command = snippet.command.endsWith('\n') ? snippet.command : `${snippet.command}\n`;

    const placeholders = targetHosts.map((host) => ({
      id: `pending:${crypto.randomUUID()}`,
      title: host.label || host.host,
      type: 'ssh',
      status: 'connecting',
      stage: 'connecting',
      connectConfig: { hostId: host.id },
      groupId,
      pending: true,
    }));

    for (const placeholder of placeholders) {
      startedAtRef.current.set(placeholder.id, Date.now());
    }

    setTabs((prev) => [
      ...prev,
      {
        id: groupId,
        title: snippet.name,
        type: 'group',
        status: 'connected',
        activeMemberId: placeholders[0].id,
      },
      ...placeholders,
    ]);
    setActiveTabId(groupId);

    const outcomes = await Promise.all(
      placeholders.map(async (placeholder) => {
        let result;
        try {
          result = await window.api.sshConnect(placeholder.connectConfig);
        } catch (err) {
          result = { error: err.message };
        }

        if (abandonedPendingRef.current.delete(placeholder.id)) {
          if (result?.sessionId) await window.api.sshDisconnect(result.sessionId);
          return null;
        }

        if (result.error) {
          // The slot stays, holding the error: the host is still named, and
          // reconnecting it is one click rather than a rerun of the snippet.
          setTabs((prev) =>
            prev.map((t) =>
              t.id === placeholder.id
                ? { ...t, status: 'error', error: result.error, pending: false }
                : t
            )
          );
          return `${placeholder.title}: ${result.error}`;
        }

        pendingReadyActionRef.current.set(result.sessionId, {
          onReady: () => window.api.sshWrite(result.sessionId, command),
        });
        adoptSession(placeholder.id, result.sessionId, groupId, 'ssh');
        return null;
      })
    );

    const problems = outcomes.filter(Boolean);
    if (problems.length) setConnectError(problems.join(' · '));
  }

  function selectGroupMember(groupId, memberId) {
    setTabs((prev) =>
      prev.map((t) => (t.id === groupId ? { ...t, activeMemberId: memberId } : t))
    );
  }

  async function openLocalTerminal() {
    try {
      await openSession({}, 'Local', 'local');
    } catch {}
  }

  function forgetSession(tabId) {
    const pendingTimeout = pendingTimeoutsRef.current.get(tabId);
    if (pendingTimeout) {
      clearTimeout(pendingTimeout);
      pendingTimeoutsRef.current.delete(tabId);
    }
    startedAtRef.current.delete(tabId);
    pendingReadyActionRef.current.delete(tabId);

    setSessionLogs((prev) => {
      const { [tabId]: _removed, ...rest } = prev;
      return rest;
    });
  }

  // `playback` and `group` close nothing of their own, so a missing entry and
  // an entry that is deliberately null have to stay tellable apart.
  const CLOSERS = {
    local: 'localDisconnect',
    serial: 'serialDisconnect',
    playback: null,
    group: null,
    shared: 'shareLeave',
  };

  async function disconnectSessionId(sessionId, type) {
    const method = Object.hasOwn(CLOSERS, type ?? '') ? CLOSERS[type] : 'sshDisconnect';
    if (method) await window.api[method](sessionId);
  }

  async function disconnectSession(tab) {
    // A session still being opened has no id in the main process yet. Flag the
    // placeholder instead; whoever is awaiting the connect hangs up on it.
    if (tab?.pending) {
      abandonedPendingRef.current.add(tab.id);
      return;
    }
    await disconnectSessionId(tab.id, tab?.type);
  }

  async function closeTab(tabId) {
    const tab = tabs.find((t) => t.id === tabId);
    if (!tab || tab.constant) return;

    // Closing a group closes every session it holds; nothing else can reach
    // them once the tab is gone, so leaving one connected would strand it.
    if (tab.type === 'group') {
      for (const member of tabs.filter((t) => t.groupId === tabId)) {
        forgetSession(member.id);
        await disconnectSession(member);
      }
      forgetSession(tabId);
      setTabs((prev) => {
        const next = prev.filter((t) => t.id !== tabId && t.groupId !== tabId);
        if (activeTabId === tabId) {
          const lastRealTab = [...next].reverse().find((t) => !t.constant && !t.groupId);
          setActiveTabId(lastRealTab ? lastRealTab.id : 'vault');
        }
        return next;
      });
      return;
    }

    forgetSession(tabId);
    await disconnectSession(tab);

    setTabs((prev) => {
      let next = prev.filter((t) => t.id !== tabId);

      if (tab.groupId) {
        const siblings = next.filter((t) => t.groupId === tab.groupId);
        // The last connection out takes the group tab with it: a group with
        // nothing in it is an empty sidebar and a blank pane.
        if (siblings.length === 0) {
          next = next.filter((t) => t.id !== tab.groupId);
          if (activeTabId === tab.groupId) {
            const lastRealTab = [...next].reverse().find((t) => !t.constant && !t.groupId);
            setActiveTabId(lastRealTab ? lastRealTab.id : 'vault');
          }
        } else {
          next = next.map((t) =>
            t.id === tab.groupId && t.activeMemberId === tabId
              ? { ...t, activeMemberId: siblings[0].id }
              : t
          );
        }
      }

      if (activeTabId === tabId) {
        const lastRealTab = [...next].reverse().find((t) => !t.constant && !t.groupId);
        setActiveTabId(lastRealTab ? lastRealTab.id : 'vault');
      }
      return next;
    });
  }

  /**
   * Retrying opens a new session under a new id, and the log is kept per
   * session — so the account of why the last attempt failed was thrown away by
   * the very click made to look into it. Carry it over, marked, so a host that
   * fails the same way twice says so instead of showing one lonely attempt.
   *
   * And when the retry cannot even be started, put the tab back rather than
   * letting it disappear into a banner: the failure it was already showing is
   * still the thing the user is trying to read, and taking the tab away takes
   * the log with it.
   */
  async function retryTab(tab) {
    const previous = sessionLogs[tab.id] ?? [];

    setTabs((prev) => prev.filter((t) => t.id !== tab.id));

    // The old lines are held, not dropped, until their fate is known.
    let sessionId = null;
    let failure = null;
    try {
      sessionId = await openSession(tab.connectConfig, tab.title, tab.type, {
        groupId: tab.groupId,
      });
    } catch (err) {
      failure = err.message || 'Could not start the connection';
    }

    // The attempt never got off the ground. openSession has already cleared
    // the tab it opened — and, if this was a group's last member, the group
    // with it — so restore what was there, and let the log stand.
    if (failure !== null) {
      setTabs((prev) => {
        const inGroup = Boolean(tab.groupId) && prev.some((t) => t.id === tab.groupId);
        const restored = {
          ...tab,
          groupId: inGroup ? tab.groupId : undefined,
          status: 'error',
          error: failure,
          hostKeyInfo: null,
        };
        const next = [...prev, restored];
        return inGroup
          ? next.map((t) => (t.id === tab.groupId ? { ...t, activeMemberId: tab.id } : t))
          : next;
      });
      if (!tab.groupId) setActiveTabId(tab.id);
      return;
    }

    setSessionLogs((prev) => {
      const { [tab.id]: _removed, ...rest } = prev;
      // Nothing came back and nothing failed: the tab was closed while the
      // connection was still opening, so these lines were deliberately let go.
      if (!sessionId || previous.length === 0) return rest;

      // Lines for the new session can already have arrived; they belong last.
      const carried = [
        ...previous,
        { id: crypto.randomUUID(), time: Date.now(), line: '— retrying —', level: 'info' },
        ...(rest[sessionId] ?? []),
      ];
      if (carried.length > SESSION_LOG_LIMIT) {
        carried.splice(0, carried.length - SESSION_LOG_LIMIT);
      }
      return { ...rest, [sessionId]: carried };
    });
  }

  async function connectToHost(host) {
    try {
      await openSession({ hostId: host.id }, host.label || host.host);
    } catch {}
  }

  async function runOnHost(host, command) {
    const text = command.endsWith('\n') ? command : `${command}\n`;
    const existing = tabs.find(
      (t) => t.type === 'ssh' && t.status === 'connected' && t.connectConfig?.hostId === host.id
    );
    if (existing) {
      window.api.sshWrite(existing.id, text);
      return;
    }
    try {
      const sessionId = await openSession({ hostId: host.id }, host.label || host.host);
      if (sessionId) {
        pendingReadyActionRef.current.set(sessionId, {
          onReady: () => window.api.sshWrite(sessionId, text),
        });
      }
    } catch {}
  }

  function runSnippetInActiveTab(snippet) {
    const selected = tabs.find((t) => t.id === activeTabId);
    const tab =
      selected?.type === 'group'
        ? tabs.find((t) => t.id === selected.activeMemberId)
        : selected;
    if (!tab || tab.status !== 'connected') return;
    const write =
      tab.type === 'local'
        ? window.api.localWrite
        : tab.type === 'serial'
          ? window.api.serialWrite
          : window.api.sshWrite;
    const command = snippet.command;
    write(tab.id, command.endsWith('\n') ? command : `${command}\n`);
  }

  async function connectAndStartForward(host, spec) {
    const existing = tabs.find(
      (t) => t.type === 'ssh' && t.status === 'connected' && t.connectConfig?.hostId === host.id
    );
    if (existing) {
      const result = await window.api.sshForwardStart(existing.id, spec);
      return result.error ? result : { forward: result.forward, sessionId: existing.id };
    }

    let sessionId;
    try {
      sessionId = await openSession({ hostId: host.id }, host.label || host.host);
    } catch (err) {
      return { error: err.message };
    }
    // The tab was closed before the session finished opening.
    if (!sessionId) return { error: 'The connection was cancelled' };

    return new Promise((resolve) => {
      pendingReadyActionRef.current.set(sessionId, {
        onReady: async () => {
          const result = await window.api.sshForwardStart(sessionId, spec);
          resolve(result.error ? result : { forward: result.forward, sessionId });
        },
        onFailure: (message) => resolve({ error: message || 'Failed to connect' }),
      });
    });
  }

  function openPlayback(recording) {
    const existing = tabs.find((t) => t.type === 'playback' && t.recording?.id === recording.id);
    if (existing) {
      setActiveTabId(existing.id);
      return;
    }
    const tab = {
      id: crypto.randomUUID(),
      title: `${recording.username}@${recording.host} (replay)`,
      type: 'playback',
      status: 'connected',
      recording,
    };
    setTabs((prev) => [...prev, tab]);
    setActiveTabId(tab.id);
  }

  function openNewConnectionDialog(type = 'ssh') {
    setEditingHost(null);
    setDialogInitialType(type);
    setDialogOpen(true);
  }

  function openEditHostDialog(host) {
    setEditingHost(host);
    setDialogOpen(true);
  }

  async function deleteHost(host) {
    const confirmed = await confirm({
      title: 'Delete host',
      description: `Delete saved host "${host.label || host.host}"? This cannot be undone.`,
      confirmText: 'Delete',
      destructive: true,
    });
    if (!confirmed) return;

    const result = await window.api.hostsDelete(host.id);
    if (!result.error) setHosts(result.hosts);
  }

  async function duplicateHost(host) {
    const result = await window.api.hostsDuplicate(host.id);
    if (!result.error) setHosts(result.hosts);
  }

  async function respondToHostKey(tabId, trust) {
    setTabs((prev) => prev.map((t) => (t.id === tabId ? { ...t, hostKeyInfo: null } : t)));
    await window.api.sshHostKeyResponse(tabId, trust);
  }

  async function lockVault() {
    await window.api.vaultLock();
    await refreshVaultStatus();
  }

  const activeTab = tabs.find((t) => t.id === activeTabId) || null;
  // A group tab is a container, not a session. Anything that acts on "the
  // terminal on screen" — sharing it, styling it, running a snippet in it —
  // has to go through the member it is currently showing.
  const activeSessionTab =
    activeTab?.type === 'group'
      ? tabs.find((t) => t.id === activeTab.activeMemberId) || null
      : activeTab;
  const terminalTabActive =
    activeSessionTab?.status === 'connected' &&
    ['ssh', 'local', 'serial'].includes(activeSessionTab.type);
  const activeShare = activeSessionTab ? shares[activeSessionTab.id] : null;

  if (!vaultStatus) return null;

  if (!vaultStatus.unlocked) {
    return (
      <>
        <Unlock vaultExists={vaultStatus.exists} onUnlocked={refreshVaultStatus} />
        <FeedbackPromptToast />
        {/* A share link can land while the vault is locked; the invite says so. */}
        <ShareToasts />
      </>
    );
  }

  return (
    <div className="flex h-screen">
      <main className="flex min-w-0 flex-1 flex-col">
        <TabBar
          tabs={tabs}
          activeTabId={activeTabId}
          onSelectTab={setActiveTabId}
          onCloseTab={closeTab}
          onNewConnection={openNewConnectionDialog}
        />


        {connectError && (
          <p className="border-b bg-destructive/10 px-4 py-2 text-sm text-destructive">
            {connectError}
          </p>
        )}

        <div className="flex min-w-0 flex-1 overflow-hidden">
          <div className="relative flex min-w-0 flex-1">
            <ContentArea
              tabs={tabs}
              activeTabId={activeTabId}
              sessionLogs={sessionLogs}
              hosts={hosts}
              onCloseTab={closeTab}
              onRetryTab={retryTab}
              onRespondToHostKey={respondToHostKey}
              onConnect={connectToHost}
              onEdit={openEditHostDialog}
              onDelete={deleteHost}
              onDuplicate={duplicateHost}
              onNewConnection={openNewConnectionDialog}
              onLockVault={lockVault}
              onOpenLocalTerminal={openLocalTerminal}
              onPlayRecording={openPlayback}
              onRunOnHost={runOnHost}
              onConnectAndStartForward={connectAndStartForward}
              onHostsChange={setHosts}
              onRunSnippetOnHosts={openSnippetGroup}
              onSelectGroupMember={selectGroupMember}
            />

            {terminalTabActive && (
              <div className="absolute right-2 top-2 z-20 flex gap-1.5">
                <button
                  onClick={() => {
                    setStylePanelOpen(false);
                    setSharePanelOpen((open) => !open);
                  }}
                  title={activeShare ? 'Sharing — manage viewers' : 'Share this terminal'}
                  className={`flex size-8 items-center justify-center rounded-md border bg-background/80 backdrop-blur hover:bg-accent hover:text-foreground ${
                    activeShare ? 'text-emerald-500' : 'text-muted-foreground'
                  }`}
                >
                  <Share2 className="size-4" />
                </button>
                <button
                  onClick={() => {
                    setSharePanelOpen(false);
                    setStylePanelOpen((open) => !open);
                  }}
                  title="Terminal style & snippets"
                  className="flex size-8 items-center justify-center rounded-md border bg-background/80 text-muted-foreground backdrop-blur hover:bg-accent hover:text-foreground"
                >
                  <Palette className="size-4" />
                </button>
              </div>
            )}
          </div>

          <SlidePanel
            open={stylePanelOpen && terminalTabActive}
            onClose={() => setStylePanelOpen(false)}
          >
            <TerminalStylePanel
              onClose={() => setStylePanelOpen(false)}
              onRunSnippet={runSnippetInActiveTab}
            />
          </SlidePanel>

          <SlidePanel
            open={sharePanelOpen && terminalTabActive}
            onClose={() => setSharePanelOpen(false)}
          >
            <SharePanel tab={activeSessionTab} onClose={() => setSharePanelOpen(false)} />
          </SlidePanel>

          <NewConnectionDialog
            open={dialogOpen}
            onOpenChange={(next) => {
              setDialogOpen(next);
              if (!next) setEditingHost(null);
            }}
            editingHost={editingHost}
            initialType={dialogInitialType}
            onSaved={setHosts}
            onConnect={async (config, title, type) => {
              await openSession(config, title, type);
            }}
          />
        </div>
      </main>
      <FeedbackPromptToast />
      <ShareToasts />
    </div>
  );
}
