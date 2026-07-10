import { Fragment, useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { Terminal as TerminalIcon, Plus, X, Server, Pencil, Trash2, Loader2, Lock, Folder } from 'lucide-react';
import Unlock from '@/components/Unlock';
import NewConnectionDialog from '@/components/NewConnectionDialog';
import TerminalView from '@/components/TerminalView';
import SftpView from '@/components/SftpView';
import { ConnectingView, ConnectErrorView, HostKeyPromptView } from '@/components/ConnectionStatus';

const MIN_CONNECTING_MS = 2000;

export default function App() {
  const [vaultStatus, setVaultStatus] = useState(null);
  const [hosts, setHosts] = useState([]);
  const [tabs, setTabs] = useState([]);
  const [activeTabId, setActiveTabId] = useState(null);
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

    // Every log line the main process emits while connecting (including
    // ssh2's raw protocol trace) is kept per session, capped at 400 lines.
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

  async function openSession(connectConfig, title) {
    setConnectError(null);
    const result = await window.api.sshConnect(connectConfig);
    if (result.error) {
      setConnectError(result.error);
      throw new Error(result.error);
    }
    const tab = {
      id: result.sessionId,
      title,
      status: 'connecting',
      stage: 'connecting',
      connectConfig,
    };
    startedAtRef.current.set(tab.id, Date.now());
    setTabs((prev) => [...prev, tab]);
    setActiveTabId(tab.id);
  }

  async function closeTab(tabId) {
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

    await window.api.sshDisconnect(tabId);
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
      await openSession(tab.connectConfig, tab.title);
    } catch {}
  }

  async function connectToHost(host) {
    try {
      await openSession({ hostId: host.id }, host.label || host.host);
    } catch {}
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

  // Switches a connected tab between the terminal and the file browser.
  // The SFTP view mounts the first time it's opened and then stays alive
  // (just hidden), so navigation state survives switching back and forth.
  function setTabView(tabId, view) {
    setTabs((prev) =>
      prev.map((t) =>
        t.id === tabId ? { ...t, view, sftpOpened: t.sftpOpened || view === 'files' } : t
      )
    );
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

  const activeTab = tabs.find((t) => t.id === activeTabId) || null;

  return (
    <div className="flex h-screen">
      <div
        className="fixed inset-x-0 top-0 z-50 h-9"
        style={{ WebkitAppRegion: 'drag' }}
      />

      <aside className="flex w-60 flex-col border-r bg-sidebar text-sidebar-foreground">
        <div className="h-9 shrink-0" />

        <div className="flex items-center justify-between px-4 py-2">
          <div className="flex items-center gap-2">
            <TerminalIcon className="size-4" />
            <h1 className="text-sm font-semibold tracking-widest">SSH CLIENT</h1>
          </div>
          <button
            onClick={lockVault}
            title="Lock vault"
            className="rounded p-1 text-muted-foreground hover:text-foreground"
          >
            <Lock className="size-3.5" />
          </button>
        </div>

        <Separator />

        <div className="flex items-center justify-between px-4 pt-4 pb-2">
          <h2 className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
            Hosts
          </h2>
          <Badge variant="secondary">{hosts.length}</Badge>
        </div>

        <div className="flex flex-1 flex-col gap-1 overflow-y-auto px-2">
          {hosts.length === 0 && (
            <p className="px-2 text-sm text-muted-foreground">No saved hosts yet</p>
          )}
          {hosts.map((host) => (
            <div
              key={host.id}
              className="group flex items-center gap-1 rounded-md pr-1 hover:bg-sidebar-accent"
            >
              <button
                onClick={() => connectToHost(host)}
                className="flex min-w-0 flex-1 items-center gap-2 px-2 py-1.5 text-left text-sm"
              >
                <Server className="size-3.5 shrink-0" />
                <span className="truncate">{host.label || host.host}</span>
              </button>
              <button
                onClick={() => openEditHostDialog(host)}
                title="Edit host"
                className="hidden shrink-0 rounded p-1 text-muted-foreground hover:text-foreground group-hover:block"
              >
                <Pencil className="size-3.5" />
              </button>
              <button
                onClick={() => deleteHost(host)}
                title="Delete host"
                className="hidden shrink-0 rounded p-1 text-muted-foreground hover:text-destructive group-hover:block"
              >
                <Trash2 className="size-3.5" />
              </button>
            </div>
          ))}
        </div>

        <div className="p-2">
          <Button className="w-full" size="sm" onClick={openNewConnectionDialog}>
            <Plus className="size-4" /> New connection
          </Button>
        </div>
      </aside>

      <main className="flex flex-1 flex-col">
        <div className="h-9 shrink-0" style={{ WebkitAppRegion: 'drag' }} />

        {tabs.length > 0 && (
          <div className="flex items-center gap-1 border-b bg-muted/40 px-2">
            {tabs.map((tab) => (
              <div
                key={tab.id}
                onClick={() => setActiveTabId(tab.id)}
                className={`flex cursor-pointer items-center gap-2 rounded-t-md border-x border-t px-3 py-1.5 text-sm ${
                  tab.id === activeTabId
                    ? 'border-border bg-background'
                    : 'border-transparent text-muted-foreground hover:text-foreground'
                }`}
              >
                {tab.status === 'connecting' ? (
                  <Loader2 className="size-3.5 shrink-0 animate-spin text-muted-foreground" />
                ) : tab.status === 'error' ? (
                  <span className="size-1.5 shrink-0 rounded-full bg-destructive" />
                ) : (
                  <span className="size-1.5 shrink-0 rounded-full bg-emerald-500" />
                )}
                <span className="max-w-32 truncate">{tab.title}</span>
                <X
                  className="size-3.5 hover:text-destructive"
                  onClick={(e) => {
                    e.stopPropagation();
                    closeTab(tab.id);
                  }}
                />
              </div>
            ))}

            {activeTab?.status === 'connected' && (
              <div className="ml-auto flex items-center gap-0.5 py-1">
                {[
                  { id: 'terminal', label: 'Terminal', Icon: TerminalIcon },
                  { id: 'files', label: 'Files', Icon: Folder },
                ].map(({ id, label, Icon }) => (
                  <button
                    key={id}
                    onClick={() => setTabView(activeTab.id, id)}
                    className={`flex items-center gap-1.5 rounded-md px-2 py-1 text-xs ${
                      (activeTab.view ?? 'terminal') === id
                        ? 'border bg-background text-foreground'
                        : 'text-muted-foreground hover:text-foreground'
                    }`}
                  >
                    <Icon className="size-3.5" /> {label}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        {connectError && (
          <p className="border-b bg-destructive/10 px-4 py-2 text-sm text-destructive">
            {connectError}
          </p>
        )}

        <div className="relative flex-1 bg-[#0d1117]">
          {tabs.length === 0 && (
            <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
              No active sessions — connect to a host to get started.
            </div>
          )}

          {tabs
            .filter((t) => t.status === 'connected')
            .map((tab) => (
              <Fragment key={tab.id}>
                <TerminalView
                  sessionId={tab.id}
                  active={tab.id === activeTabId && (tab.view ?? 'terminal') === 'terminal'}
                />
                {tab.sftpOpened && (
                  <SftpView
                    sessionId={tab.id}
                    visible={tab.id === activeTabId && tab.view === 'files'}
                  />
                )}
              </Fragment>
            ))}

          {activeTab?.status === 'connecting' && activeTab.hostKeyInfo && (
            <HostKeyPromptView
              title={activeTab.title}
              info={activeTab.hostKeyInfo}
              onTrust={() => respondToHostKey(activeTab.id, true)}
              onReject={() => respondToHostKey(activeTab.id, false)}
            />
          )}

          {activeTab?.status === 'connecting' && !activeTab.hostKeyInfo && (
            <ConnectingView
              title={activeTab.title}
              stage={activeTab.stage}
              logs={sessionLogs[activeTab.id] ?? []}
              onCancel={() => closeTab(activeTab.id)}
            />
          )}

          {activeTab?.status === 'error' && (
            <ConnectErrorView
              title={activeTab.title}
              message={activeTab.error}
              logs={sessionLogs[activeTab.id] ?? []}
              onRetry={() => retryTab(activeTab)}
              onClose={() => closeTab(activeTab.id)}
            />
          )}
        </div>
      </main>

      <NewConnectionDialog
        open={dialogOpen}
        onOpenChange={(next) => {
          setDialogOpen(next);
          if (!next) setEditingHost(null);
        }}
        editingHost={editingHost}
        onSaved={setHosts}
        onConnect={async (config, title) => {
          await openSession(config, title);
        }}
      />
    </div>
  );
}
