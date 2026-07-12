import { useEffect, useRef, useState } from 'react';
import Unlock from '@/components/Unlock';
import NewConnectionDialog from '@/components/NewConnectionDialog';
import TabBar from '@/components/TabBar';
import ContentArea from '@/components/ContentArea';

const MIN_CONNECTING_MS = 2000;

export default function App() {
  const [vaultStatus, setVaultStatus] = useState(null);
  const [hosts, setHosts] = useState([]);
  const [tabs, setTabs] = useState([
    { id: 'vault', title: 'Hosts', constant: true },
    { id: 'sftp', title: 'SFTP', constant: true },
  ]);
  const [activeTabId, setActiveTabId] = useState('vault');
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingHost, setEditingHost] = useState(null);
  const [connectError, setConnectError] = useState(null);
  const [sessionLogs, setSessionLogs] = useState({});

  const startedAtRef = useRef(new Map());
  const pendingTimeoutsRef = useRef(new Map());

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

  // A file dropped anywhere outside a real drop zone would make Electron
  // navigate the whole window to that file — swallow stray drops globally.
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

  useEffect(() => {
    function patchTab(sessionId, patch) {
      setTabs((prev) => prev.map((t) => (t.id === sessionId ? { ...t, ...patch } : t)));
    }

    const unsubProgress = window.api.onSshProgress(({ sessionId, stage }) => {
      patchTab(sessionId, { stage });
    });

    const unsubReady = window.api.onSshReady(({ sessionId }) => {
      afterMinDelay(sessionId, () => patchTab(sessionId, { status: 'connected' }));
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
      return;
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

    const disconnect =
      tab?.type === 'local'
        ? window.api.localDisconnect
        : tab?.type === 'serial'
          ? window.api.serialDisconnect
          : tab?.type === 'playback'
            ? null
            : window.api.sshDisconnect;
    if (disconnect) await disconnect(tabId);
    setTabs((prev) => {
      const next = prev.filter((t) => t.id !== tabId);
      if (activeTabId === tabId) {
        setActiveTabId(next.length ? next[next.length - 1].id : null);
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

  function openNewConnectionDialog() {
    setEditingHost(null);
    setDialogOpen(true);
  }

  function openEditHostDialog(host) {
    setEditingHost(host);
    setDialogOpen(true);
  }

  async function deleteHost(host) {
    const confirmed = window.confirm(
      `Delete saved host "${host.label || host.host}"? This cannot be undone.`
    );
    if (!confirmed) return;

    const result = await window.api.hostsDelete(host.id);
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

  if (!vaultStatus) return null;

  if (!vaultStatus.unlocked) {
    return (
      <Unlock vaultExists={vaultStatus.exists} onUnlocked={refreshVaultStatus} />
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
            onNewConnection={openNewConnectionDialog}
            onLockVault={lockVault}
            onOpenLocalTerminal={openLocalTerminal}
            onPlayRecording={openPlayback}
          />

          <NewConnectionDialog
            open={dialogOpen}
            onOpenChange={(next) => {
              setDialogOpen(next);
              if (!next) setEditingHost(null);
            }}
            editingHost={editingHost}
            onSaved={setHosts}
            onConnect={async (config, title, type) => {
              await openSession(config, title, type);
            }}
          />
        </div>
      </main>
    </div>
  );
}
