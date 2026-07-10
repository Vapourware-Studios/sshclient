import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import {
  ArrowDownToLine,
  ArrowUpFromLine,
  Check,
  ChevronRight,
  File,
  Folder,
  FolderUp,
  HardDrive,
  Link as LinkIcon,
  Loader2,
  Plus,
  RefreshCw,
  Server,
  ShieldQuestion,
  TriangleAlert,
  X,
} from 'lucide-react';

function formatSize(bytes) {
  if (bytes == null) return '';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${unit === 0 ? value : value.toFixed(1)} ${units[unit]}`;
}

function formatDate(mtime) {
  if (!mtime) return '';
  return new Date(mtime).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

function parentOf(path) {
  if (path === '/') return '/';
  const cut = path.slice(0, path.lastIndexOf('/'));
  return cut === '' ? '/' : cut;
}

function joinPath(dir, name) {
  return (dir === '/' ? '' : dir) + '/' + name;
}

function crumbsOf(path) {
  const crumbs = [{ label: '/', path: '/' }];
  if (path === '/' || !path) return crumbs;
  let acc = '';
  for (const part of path.split('/').filter(Boolean)) {
    acc += '/' + part;
    crumbs.push({ label: part, path: acc });
  }
  return crumbs;
}

function EntryIcon({ type }) {
  if (type === 'dir') return <Folder className="size-4 shrink-0 text-sky-400" />;
  if (type === 'link') return <LinkIcon className="size-4 shrink-0 text-muted-foreground" />;
  return <File className="size-4 shrink-0 text-muted-foreground" />;
}

// One side of the dual-pane browser. Purely presentational: the parent owns
// the path/entries state and tells it what happens on navigate/transfer.
function FilePane({
  title,
  TitleIcon,
  path,
  entries,
  loading,
  error,
  onNavigate,
  onRefresh,
  actionTitle,
  ActionIcon,
  onAction,
}) {
  return (
    <div className="flex min-w-0 flex-1 flex-col">
      <div className="flex items-center gap-2 border-b px-3 py-2">
        <TitleIcon className="size-4 shrink-0 text-muted-foreground" />
        <span className="shrink-0 text-xs font-medium uppercase tracking-wider text-muted-foreground">
          {title}
        </span>

        <button
          onClick={() => onNavigate(parentOf(path))}
          title="Up one folder"
          disabled={!path || path === '/'}
          className="rounded p-1 text-muted-foreground hover:text-foreground disabled:opacity-40"
        >
          <FolderUp className="size-4" />
        </button>

        <div className="flex min-w-0 flex-1 items-center overflow-x-auto text-xs">
          {path &&
            crumbsOf(path).map((crumb, i) => (
              <span key={crumb.path} className="flex shrink-0 items-center">
                {i > 0 && <ChevronRight className="size-3 text-muted-foreground/50" />}
                <button
                  onClick={() => onNavigate(crumb.path)}
                  className={`rounded px-1 py-0.5 hover:bg-accent ${
                    crumb.path === path ? 'font-medium text-foreground' : 'text-muted-foreground'
                  }`}
                >
                  {crumb.label}
                </button>
              </span>
            ))}
          {loading && <Loader2 className="ml-2 size-3.5 shrink-0 animate-spin text-muted-foreground" />}
        </div>

        <button
          onClick={onRefresh}
          title="Refresh"
          className="rounded p-1 text-muted-foreground hover:text-foreground"
        >
          <RefreshCw className="size-4" />
        </button>
      </div>

      {error && (
        <p className="border-b bg-destructive/10 px-3 py-1.5 text-xs text-destructive">{error}</p>
      )}

      <div key={path} className="flex-1 overflow-y-auto py-1">
        {entries.length === 0 && !loading && (
          <p className="px-4 py-6 text-center text-xs text-muted-foreground">This folder is empty</p>
        )}
        {entries.map((entry, i) => (
          <div
            key={entry.name}
            onDoubleClick={() => entry.type !== 'file' && onNavigate(joinPath(path, entry.name))}
            className="group flex cursor-default items-center gap-2.5 px-3 py-1.5 text-sm animate-rise-in hover:bg-accent"
            style={{ animationDelay: `${Math.min(i, 20) * 15}ms` }}
          >
            <EntryIcon type={entry.type} />
            {entry.type === 'dir' ? (
              <button
                onClick={() => onNavigate(joinPath(path, entry.name))}
                className="min-w-0 flex-1 truncate text-left hover:underline"
              >
                {entry.name}
              </button>
            ) : (
              <span className="min-w-0 flex-1 truncate">{entry.name}</span>
            )}
            <span className="w-16 shrink-0 text-right text-xs text-muted-foreground">
              {entry.type === 'dir' ? '' : formatSize(entry.size)}
            </span>
            <span className="hidden w-24 shrink-0 text-right text-xs text-muted-foreground xl:block">
              {formatDate(entry.mtime)}
            </span>
            <button
              onClick={() => onAction(entry)}
              title={actionTitle}
              className={`shrink-0 rounded p-1 text-muted-foreground hover:text-foreground ${
                entry.type === 'dir' ? 'invisible' : 'invisible group-hover:visible'
              }`}
            >
              <ActionIcon className="size-3.5" />
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}

function TransferRow({ transfer, onDismiss }) {
  const { kind, name, transferred, total, done, error } = transfer;
  const pct = total > 0 ? Math.min(100, Math.round((transferred / total) * 100)) : 0;

  return (
    <div className="flex items-center gap-3 px-4 py-2 animate-rise-in">
      {kind === 'download' ? (
        <ArrowDownToLine className="size-4 shrink-0 text-sky-400" />
      ) : (
        <ArrowUpFromLine className="size-4 shrink-0 text-emerald-400" />
      )}

      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <div className="flex items-center justify-between gap-2 text-xs">
          <span className="truncate">{name}</span>
          <span className="shrink-0 text-muted-foreground">
            {error
              ? 'failed'
              : done
                ? 'done'
                : total > 0
                  ? `${formatSize(transferred)} / ${formatSize(total)} · ${pct}%`
                  : 'starting…'}
          </span>
        </div>
        <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted/40">
          <div
            className={`h-full rounded-full transition-[width] duration-200 ${
              error
                ? 'w-full bg-destructive'
                : done
                  ? 'w-full bg-emerald-500'
                  : 'bg-primary progress-stripes'
            }`}
            style={error || done ? undefined : { width: `${pct}%` }}
          />
        </div>
        {error && <p className="text-[11px] text-destructive">{error}</p>}
      </div>

      {done && !error && (
        <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-emerald-500 text-white animate-step-pop">
          <Check className="size-3" strokeWidth={3} />
        </span>
      )}
      {error && <TriangleAlert className="size-4 shrink-0 text-destructive" />}
      {(done || error) && (
        <button
          onClick={onDismiss}
          className="shrink-0 rounded p-1 text-muted-foreground hover:text-foreground"
        >
          <X className="size-3.5" />
        </button>
      )}
    </div>
  );
}

// The remote half of the pane pair. Each SFTP connection gets its own
// instance that stays mounted, so browsing state survives switching.
function RemotePane({ sessionId, title, refreshTick, onPathChange, onDownload }) {
  const [path, setPath] = useState(null);
  const [entries, setEntries] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const pathRef = useRef(null);
  pathRef.current = path;

  async function loadDir(nextPath) {
    setLoading(true);
    setError(null);
    const result = await window.api.sftpList(sessionId, nextPath);
    setLoading(false);
    if (result.error) {
      setError(result.error);
      return;
    }
    setPath(nextPath);
    setEntries(result.entries);
    onPathChange(nextPath);
  }

  useEffect(() => {
    (async () => {
      const home = await window.api.sftpHome(sessionId);
      if (home.error) {
        setError(home.error);
        return;
      }
      loadDir(home.path);
    })();
  }, [sessionId]);

  useEffect(() => {
    if (refreshTick > 0 && pathRef.current) loadDir(pathRef.current);
  }, [refreshTick]);

  return (
    <FilePane
      title={title}
      TitleIcon={Server}
      path={path}
      entries={entries}
      loading={loading}
      error={error}
      onNavigate={loadDir}
      onRefresh={() => path && loadDir(path)}
      actionTitle="Download to local folder"
      ActionIcon={ArrowDownToLine}
      onAction={(entry) => path && onDownload(joinPath(path, entry.name), entry.name)}
    />
  );
}

function ConnectionChip({ connection, active, onSelect, onClose }) {
  return (
    <div
      onClick={onSelect}
      className={`flex cursor-pointer items-center gap-2 rounded-md px-2.5 py-1 text-sm ${
        active ? 'border bg-muted text-foreground' : 'text-muted-foreground hover:text-foreground'
      }`}
    >
      {connection.status === 'connecting' ? (
        <Loader2 className="size-3.5 shrink-0 animate-spin text-muted-foreground" />
      ) : connection.status === 'error' ? (
        <span className="size-1.5 shrink-0 rounded-full bg-destructive" />
      ) : (
        <span className="size-1.5 shrink-0 rounded-full bg-emerald-500" />
      )}
      <span className="max-w-40 truncate">{connection.title}</span>
      <X
        className="size-3.5 hover:text-destructive"
        onClick={(e) => {
          e.stopPropagation();
          onClose();
        }}
      />
    </div>
  );
}

// The constant SFTP tab. Connections made here are their own SSH sessions,
// fully independent of any terminal tab — connect to each server separately.
export default function SftpHub({ hosts, visible }) {
  const [connections, setConnections] = useState([]);
  const [selectedId, setSelectedId] = useState(null);
  const [picking, setPicking] = useState(false);
  const [connectError, setConnectError] = useState(null);

  const [localPath, setLocalPath] = useState(null);
  const [localEntries, setLocalEntries] = useState([]);
  const [localLoading, setLocalLoading] = useState(false);
  const [localError, setLocalError] = useState(null);

  const [transfers, setTransfers] = useState([]);
  const [remoteRefresh, setRemoteRefresh] = useState({});
  const [remotePaths, setRemotePaths] = useState({});

  const connectionsRef = useRef([]);
  connectionsRef.current = connections;
  const localPathRef = useRef(null);
  localPathRef.current = localPath;

  const selected = connections.find((c) => c.sessionId === selectedId) ?? connections[0] ?? null;
  const showPicker = picking || connections.length === 0;

  function patchConnection(sessionId, patch) {
    setConnections((prev) =>
      prev.map((c) => (c.sessionId === sessionId ? { ...c, ...patch } : c))
    );
  }

  async function loadLocal(nextPath) {
    setLocalLoading(true);
    setLocalError(null);
    const result = await window.api.fsList(nextPath);
    setLocalLoading(false);
    if (result.error) {
      setLocalError(result.error);
      return;
    }
    setLocalPath(nextPath);
    setLocalEntries(result.entries);
  }

  useEffect(() => {
    if (!visible || localPath !== null) return;
    (async () => {
      try {
        if (typeof window.api.fsHome !== 'function') {
          throw new Error(
            'The app core was updated — quit and restart it (main-process changes do not hot-reload).'
          );
        }
        const home = await window.api.fsHome();
        await loadLocal(home.path);
      } catch (err) {
        setLocalError(err.message);
      }
    })();
  }, [visible]);

  // These sessions never appear in the tab bar, so the hub tracks their
  // lifecycle itself (App only patches tabs it knows about).
  useEffect(() => {
    const owns = (id) => connectionsRef.current.some((c) => c.sessionId === id);

    const unsubReady = window.api.onSshReady(({ sessionId }) => {
      if (owns(sessionId)) patchConnection(sessionId, { status: 'connected', hostKey: null });
    });

    const unsubError = window.api.onSshError(({ sessionId, message }) => {
      if (owns(sessionId)) {
        patchConnection(sessionId, { status: 'error', error: message, hostKey: null });
      }
    });

    const unsubClosed = window.api.onSshClosed(({ sessionId }) => {
      if (owns(sessionId)) {
        setConnections((prev) => prev.filter((c) => c.sessionId !== sessionId));
      }
    });

    const unsubHostKey = window.api.onSshHostKey(({ sessionId, ...info }) => {
      if (owns(sessionId)) patchConnection(sessionId, { hostKey: info });
    });

    const unsubTransfer = window.api.onSftpTransfer((t) => {
      if (!owns(t.sessionId)) return;

      setTransfers((prev) => {
        const patch = {
          transferred: t.transferred,
          total: t.total,
          done: t.done ?? false,
          error: t.error ?? null,
        };
        if (prev.some((x) => x.id === t.transferId)) {
          return prev.map((x) => (x.id === t.transferId ? { ...x, ...patch } : x));
        }
        return [
          ...prev,
          { id: t.transferId, sessionId: t.sessionId, kind: t.kind, name: t.name, ...patch },
        ];
      });

      if (t.done) {
        // A finished transfer means one side has a new file — refresh it.
        if (t.kind === 'upload') {
          setRemoteRefresh((prev) => ({ ...prev, [t.sessionId]: (prev[t.sessionId] ?? 0) + 1 }));
        } else if (localPathRef.current) {
          loadLocal(localPathRef.current);
        }
      }
      if (t.done || t.error) {
        setTimeout(() => {
          setTransfers((prev) => prev.filter((x) => x.id !== t.transferId));
        }, 4000);
      }
    });

    return () => {
      unsubReady();
      unsubError();
      unsubClosed();
      unsubHostKey();
      unsubTransfer();
    };
  }, []);

  async function connectHost(host) {
    setConnectError(null);
    const result = await window.api.sshConnect({ hostId: host.id, mode: 'sftp' });
    if (result.error) {
      setConnectError(result.error);
      return;
    }
    setConnections((prev) => [
      ...prev,
      {
        sessionId: result.sessionId,
        hostId: host.id,
        title: host.label || host.host,
        status: 'connecting',
        error: null,
        hostKey: null,
      },
    ]);
    setSelectedId(result.sessionId);
    setPicking(false);
  }

  async function closeConnection(sessionId) {
    await window.api.sshDisconnect(sessionId);
    setConnections((prev) => prev.filter((c) => c.sessionId !== sessionId));
    setTransfers((prev) => prev.filter((t) => t.sessionId !== sessionId));
  }

  function retryConnection(connection) {
    const host = hosts.find((h) => h.id === connection.hostId);
    setConnections((prev) => prev.filter((c) => c.sessionId !== connection.sessionId));
    if (host) connectHost(host);
  }

  function uploadEntry(entry) {
    if (!selected || selected.status !== 'connected') return;
    const remoteDir = remotePaths[selected.sessionId];
    if (!remoteDir || !localPath) return;
    window.api.sftpUploadPaths(selected.sessionId, remoteDir, [joinPath(localPath, entry.name)]);
  }

  function downloadFrom(sessionId) {
    return (remotePath, name) => {
      if (localPathRef.current) {
        window.api.sftpDownloadTo(sessionId, remotePath, localPathRef.current, name);
      }
    };
  }

  const hidden = visible ? '' : 'invisible pointer-events-none';
  const visibleTransfers = transfers.filter((t) => t.sessionId === selected?.sessionId);

  return (
    <div className={`absolute inset-0 flex flex-col bg-background ${hidden}`}>
      <div className="flex items-center gap-1 border-b px-3 py-2">
        {connections.map((connection) => (
          <ConnectionChip
            key={connection.sessionId}
            connection={connection}
            active={!showPicker && connection.sessionId === selected?.sessionId}
            onSelect={() => {
              setSelectedId(connection.sessionId);
              setPicking(false);
            }}
            onClose={() => closeConnection(connection.sessionId)}
          />
        ))}
        <button
          onClick={() => setPicking(true)}
          title="New SFTP connection"
          className={`flex size-7 items-center justify-center rounded-md ${
            showPicker
              ? 'border bg-muted text-foreground'
              : 'text-muted-foreground hover:text-foreground'
          }`}
        >
          <Plus className="size-4" />
        </button>
      </div>

      {showPicker ? (
        <div className="flex-1 overflow-y-auto p-4">
          <p className="px-3 pb-2 text-xs font-medium uppercase tracking-wider text-muted-foreground">
            Connect for file transfer
          </p>
          <p className="px-3 pb-3 text-sm text-muted-foreground">
            SFTP uses its own connection to the server, separate from your terminal sessions.
          </p>
          {connectError && (
            <p className="mx-3 mb-3 rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {connectError}
            </p>
          )}
          {hosts.length === 0 ? (
            <p className="px-3 py-8 text-center text-sm text-muted-foreground">
              No saved hosts — add one under the Hosts tab first.
            </p>
          ) : (
            <div className="flex flex-col gap-0.5">
              {hosts.map((host) => (
                <button
                  key={host.id}
                  onClick={() => connectHost(host)}
                  className="group flex items-center gap-3 rounded-lg px-3 py-2 text-left hover:bg-accent"
                >
                  <span className="flex size-9 shrink-0 items-center justify-center rounded-lg border bg-muted text-muted-foreground">
                    <Folder className="size-4" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium">
                      {host.label || host.host}
                    </span>
                    <span className="block truncate text-xs text-muted-foreground">
                      {host.username ? `${host.username}@` : ''}
                      {host.host}
                    </span>
                  </span>
                  <ChevronRight className="size-4 shrink-0 text-muted-foreground opacity-0 group-hover:opacity-100" />
                </button>
              ))}
            </div>
          )}
        </div>
      ) : selected?.status === 'connecting' ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-4 text-center">
          {selected.hostKey ? (
            <>
              <span className="flex size-12 items-center justify-center rounded-xl border bg-muted text-muted-foreground">
                <ShieldQuestion className="size-6" />
              </span>
              <div>
                <p className="text-sm font-medium">
                  {selected.hostKey.changed ? 'Host key changed!' : 'Unknown host key'}
                </p>
                <p className="mx-auto max-w-md break-all px-4 text-xs text-muted-foreground">
                  SHA256:{selected.hostKey.fingerprint}
                </p>
              </div>
              <div className="flex gap-2">
                <Button
                  size="sm"
                  onClick={() => window.api.sshHostKeyResponse(selected.sessionId, true)}
                >
                  Trust
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => window.api.sshHostKeyResponse(selected.sessionId, false)}
                >
                  Reject
                </Button>
              </div>
            </>
          ) : (
            <>
              <Loader2 className="size-6 animate-spin text-muted-foreground" />
              <p className="text-sm text-muted-foreground">Connecting to {selected.title}…</p>
            </>
          )}
        </div>
      ) : selected?.status === 'error' ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-3 text-center">
          <span className="flex size-12 items-center justify-center rounded-xl bg-destructive/10 text-destructive">
            <TriangleAlert className="size-6" />
          </span>
          <div>
            <p className="text-sm font-medium">Couldn't connect to {selected.title}</p>
            <p className="max-w-md text-sm text-muted-foreground">{selected.error}</p>
          </div>
          <div className="flex gap-2">
            <Button size="sm" onClick={() => retryConnection(selected)}>
              Retry
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => closeConnection(selected.sessionId)}
            >
              Close
            </Button>
          </div>
        </div>
      ) : (
        <>
          <div className="flex min-h-0 flex-1">
            <FilePane
              title="Local"
              TitleIcon={HardDrive}
              path={localPath}
              entries={localEntries}
              loading={localLoading}
              error={localError}
              onNavigate={loadLocal}
              onRefresh={() => localPath && loadLocal(localPath)}
              actionTitle="Upload to remote folder"
              ActionIcon={ArrowUpFromLine}
              onAction={uploadEntry}
            />

            <div className="w-px shrink-0 bg-border" />

            {connections
              .filter((c) => c.status === 'connected')
              .map((connection) => (
                <div
                  key={connection.sessionId}
                  className={`min-w-0 flex-1 ${
                    connection.sessionId === selected?.sessionId ? 'flex' : 'hidden'
                  }`}
                >
                  <RemotePane
                    sessionId={connection.sessionId}
                    title={connection.title}
                    refreshTick={remoteRefresh[connection.sessionId] ?? 0}
                    onPathChange={(p) =>
                      setRemotePaths((prev) => ({ ...prev, [connection.sessionId]: p }))
                    }
                    onDownload={downloadFrom(connection.sessionId)}
                  />
                </div>
              ))}
          </div>

          {visibleTransfers.length > 0 && (
            <div className="max-h-40 shrink-0 overflow-y-auto border-t bg-muted/30">
              {visibleTransfers.map((transfer) => (
                <TransferRow
                  key={transfer.id}
                  transfer={transfer}
                  onDismiss={() =>
                    setTransfers((prev) => prev.filter((x) => x.id !== transfer.id))
                  }
                />
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
