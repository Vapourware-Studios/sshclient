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
  const pendingTimeoutsRef = useRef(new Map());
  const pendingReadyActionRef = useRef(new Map());
  const knownSharesRef = useRef(new Set());

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

  // A share link opens a tab of its own. The main process has already joined
  // by the time its state shows up here, so this only mirrors it into the UI.
  useEffect(() => {
    const open = Object.values(viewing);
    const fresh = open.filter((state) => !knownSharesRef.current.has(state.shareId));

    setTabs((prev) => {
      const withNew = [
        ...prev,
        ...fresh.map((state) => ({
          id: state.shareId,
          title: sharedTabTitle(state),
          type: 'shared',
          status: 'connected',
        })),
      ];
      // Titles firm up once the welcome message names the owner's device.
      return withNew.map((t) => {
        const state = t.type === 'shared' ? viewing[t.id] : null;
        const title = state ? sharedTabTitle(state) : null;
        return title && title !== t.title ? { ...t, title } : t;
      });
    });

    for (const state of fresh) knownSharesRef.current.add(state.shareId);
    // Only a brand-new share steals focus; presence updates must not.
    const newest = fresh[fresh.length - 1];
    if (newest) setActiveTabId(newest.shareId);
  }, [viewing]);

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

    const unsubLog = window.api.onSshLog(({ sessionId, line, level }) => {
      setSessionLogs((prev) => {
        const entry = { id: crypto.randomUUID(), time: Date.now(), line, level };
        const list = [...(prev[sessionId] ?? []), entry];
        if (list.length > 400) list.splice(0, list.length - 400);
        return { ...prev, [sessionId]: list };
      });
    });

    return () => {
      unsubProgress();
      unsubReady();
      unsubError();
      unsubHostKey();
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

  async function openSession(connectConfig, title, type = 'ssh') {
    setConnectError(null);

    if (type !== 'ssh') {
      const connect = type === 'local' ? window.api.localConnect : window.api.serialConnect;
      const result = await connect(connectConfig);
      if (result.error) {
        setConnectError(result.error);
        throw new Error(result.error);
      }
      const tab = { id: result.sessionId, title, type, status: 'connected', connectConfig };
      setTabs((prev) => [...prev, tab]);
      setActiveTabId(tab.id);
      return tab.id;
    }

    const result = await window.api.sshConnect(connectConfig);
    if (result.error) {
      setConnectError(result.error);
      throw new Error(result.error);
    }
    const tab = {
      id: result.sessionId,
      title,
      type,
      status: 'connecting',
      stage: 'connecting',
      connectConfig,
    };
    startedAtRef.current.set(tab.id, Date.now());
    setTabs((prev) => [...prev, tab]);
    setActiveTabId(tab.id);
    return tab.id;
  }

  async function openLocalTerminal() {
    try {
      await openSession({}, 'Local', 'local');
    } catch {}
  }

  async function closeTab(tabId) {
    const tab = tabs.find((t) => t.id === tabId);
    if (tab?.constant) return;

    const pendingTimeout = pendingTimeoutsRef.current.get(tabId);
    if (pendingTimeout) {
      clearTimeout(pendingTimeout);
      pendingTimeoutsRef.current.delete(tabId);
    }
    startedAtRef.current.delete(tabId);

    setSessionLogs((prev) => {
      const { [tabId]: _removed, ...rest } = prev;
      return rest;
    });

    if (tab?.type === 'shared') knownSharesRef.current.delete(tabId);

    const disconnect =
      tab?.type === 'local'
        ? window.api.localDisconnect
        : tab?.type === 'serial'
          ? window.api.serialDisconnect
          : tab?.type === 'playback'
            ? null
            : tab?.type === 'shared'
              ? window.api.shareLeave
              : window.api.sshDisconnect;
    if (disconnect) await disconnect(tabId);
    setTabs((prev) => {
      const next = prev.filter((t) => t.id !== tabId);
      if (activeTabId === tabId) {
        const lastRealTab = [...next].reverse().find((t) => !t.constant);
        setActiveTabId(lastRealTab ? lastRealTab.id : 'vault');
      }
      return next;
    });
  }

  async function retryTab(tab) {
    setTabs((prev) => prev.filter((t) => t.id !== tab.id));
    setSessionLogs((prev) => {
      const { [tab.id]: _removed, ...rest } = prev;
      return rest;
    });
    try {
      await openSession(tab.connectConfig, tab.title, tab.type);
    } catch {}
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
    const tab = tabs.find((t) => t.id === activeTabId);
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
  const terminalTabActive =
    activeTab?.status === 'connected' && ['ssh', 'local', 'serial'].includes(activeTab.type);
  const activeShare = activeTab ? shares[activeTab.id] : null;

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
            <SharePanel tab={activeTab} onClose={() => setSharePanelOpen(false)} />
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
