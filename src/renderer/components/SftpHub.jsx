import { useEffect, useMemo, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { toneForId, toneStyle } from '@/lib/tone';
import {
  ArrowDownToLine,
  ArrowLeft,
  ArrowRightLeft,
  ArrowUpFromLine,
  Check,
  ChevronRight,
  File,
  Folder,
  FolderUp,
  HardDrive,
  Home,
  Link as LinkIcon,
  Loader2,
  RefreshCw,
  Repeat,
  Search,
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

const DRAG_TYPE = 'application/x-sftp-item';

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
  dragExtra,
  onDropEntry,
  onDropFiles,
  onChangeSource,
}) {
  const [dropReady, setDropReady] = useState(false);
  // Drag events fire enter/leave for every child row the drag passes over;
  // counting them is the standard way to know when the drag truly left.
  const dragDepth = useRef(0);

  function accepts(e) {
    return (
      Boolean(onDropEntry && e.dataTransfer.types.includes(DRAG_TYPE)) ||
      Boolean(onDropFiles && e.dataTransfer.types.includes('Files'))
    );
  }

  function handleDrop(e) {
    e.preventDefault();
    dragDepth.current = 0;
    setDropReady(false);
    const raw = e.dataTransfer.getData(DRAG_TYPE);
    if (raw) {
      onDropEntry?.(JSON.parse(raw));
    } else if (onDropFiles && e.dataTransfer.files.length > 0) {
      onDropFiles([...e.dataTransfer.files]);
    }
  }

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

        {onChangeSource && (
          <button
            onClick={onChangeSource}
            title="Change source"
            className="rounded p-1 text-muted-foreground hover:text-foreground"
          >
            <Repeat className="size-4" />
          </button>
        )}
      </div>

      {error && (
        <p className="border-b bg-destructive/10 px-3 py-1.5 text-xs text-destructive">{error}</p>
      )}

      <div
        key={path}
        onDragEnter={(e) => {
          if (!accepts(e)) return;
          e.preventDefault();
          dragDepth.current += 1;
          setDropReady(true);
        }}
        onDragOver={(e) => {
          if (!accepts(e)) return;
          e.preventDefault();
          e.dataTransfer.dropEffect = 'copy';
        }}
        onDragLeave={(e) => {
          if (!accepts(e)) return;
          dragDepth.current = Math.max(0, dragDepth.current - 1);
          if (dragDepth.current === 0) setDropReady(false);
        }}
        onDrop={handleDrop}
        className={`flex-1 overflow-y-auto py-1 ${
          dropReady ? 'bg-primary/5 ring-2 ring-inset ring-primary/40' : ''
        }`}
      >
        {entries.length === 0 && !loading && (
          <p className="px-4 py-6 text-center text-xs text-muted-foreground">This folder is empty</p>
        )}
        {entries.map((entry, i) => (
          <div
            key={entry.name}
            draggable={Boolean(dragExtra)}
            onDragStart={(e) => {
              if (!dragExtra) return;
              e.dataTransfer.effectAllowed = 'copy';
              e.dataTransfer.setData(
                DRAG_TYPE,
                JSON.stringify({ name: entry.name, path: joinPath(path, entry.name), ...dragExtra })
              );
            }}
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
            {onAction && ActionIcon && (
              <button
                onClick={() => onAction(entry)}
                title={actionTitle}
                className="invisible shrink-0 rounded p-1 text-muted-foreground hover:text-foreground group-hover:visible"
              >
                <ActionIcon className="size-3.5" />
              </button>
            )}
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
      ) : kind === 'remote-transfer' ? (
        <ArrowRightLeft className="size-4 shrink-0 text-violet-400" />
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

function LocalPane({ refreshTick, onPathChange, onChangeSource, actionTitle, ActionIcon, onAction }) {
  const [path, setPath] = useState(null);
  const [entries, setEntries] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const pathRef = useRef(null);
  pathRef.current = path;

  async function loadDir(nextPath) {
    setLoading(true);
    setError(null);
    const result = await window.api.fsList(nextPath);
    setLoading(false);
    if (result.error) {
      setError(result.error);
      return;
    }
    setPath(nextPath);
    setEntries(result.entries);
    onPathChange?.(nextPath);
  }

  useEffect(() => {
    (async () => {
      try {
        if (typeof window.api.fsHome !== 'function') {
          throw new Error(
            'The app core was updated — quit and restart it (main-process changes do not hot-reload).'
          );
        }
        const home = await window.api.fsHome();
        await loadDir(home.path);
      } catch (err) {
        setError(err.message);
      }
    })();
  }, []);

  useEffect(() => {
    if (refreshTick > 0 && pathRef.current) loadDir(pathRef.current);
  }, [refreshTick]);

  return (
    <FilePane
      title="Local"
      TitleIcon={HardDrive}
      path={path}
      entries={entries}
      loading={loading}
      error={error}
      onNavigate={loadDir}
      onRefresh={() => path && loadDir(path)}
      actionTitle={actionTitle}
      ActionIcon={ActionIcon}
      onAction={onAction ? (entry) => onAction(joinPath(path, entry.name), entry.name) : undefined}
      dragExtra={{ kind: 'local' }}
      onDropEntry={(payload) => {
        if (payload.kind !== 'remote' || !pathRef.current) return;
        window.api.sftpDownloadTo(payload.sessionId, payload.path, pathRef.current, payload.name);
      }}
      onChangeSource={onChangeSource}
    />
  );
}

function RemotePane({
  sessionId,
  title,
  refreshTick,
  onPathChange,
  onChangeSource,
  actionTitle,
  ActionIcon,
  onAction,
}) {
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
    onPathChange?.(nextPath);
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
      actionTitle={actionTitle}
      ActionIcon={ActionIcon}
      onAction={onAction ? (entry) => onAction(joinPath(path, entry.name), entry.name) : undefined}
      dragExtra={{ kind: 'remote', sessionId }}
      onDropEntry={(payload) => {
        if (!pathRef.current) return;
        if (payload.kind === 'local') {
          window.api.sftpUploadPaths(sessionId, pathRef.current, [payload.path]);
        } else if (payload.kind === 'remote' && payload.sessionId !== sessionId) {
          window.api.sftpTransferRemote(payload.sessionId, payload.path, sessionId, pathRef.current, payload.name);
        }
      }}
      onDropFiles={(files) =>
        pathRef.current &&
        window.api.sftpUploadPaths(sessionId, pathRef.current, files.map((f) => window.api.pathForFile(f)))
      }
      onChangeSource={onChangeSource}
    />
  );
}

function HostPicker({ hosts, query, onQueryChange, onPickLocal, onPickHost, onBack, canBack, connectError }) {
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return hosts;
    return hosts.filter((h) =>
      [h.label, h.host, h.username].some((v) => v && v.toLowerCase().includes(q))
    );
  }, [hosts, query]);

  return (
    <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
      <div className="flex items-center gap-3 border-b px-4 py-3">
        {canBack && (
          <button
            onClick={onBack}
            title="Back"
            className="shrink-0 rounded-md p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            <ArrowLeft className="size-4" />
          </button>
        )}
        <p className="flex-1 text-sm font-medium">Select Host</p>
        <Button size="sm" onClick={onPickLocal} className="shrink-0">
          <Home className="size-3.5" /> Local
        </Button>
      </div>

      <div className="border-b px-4 py-3">
        <div className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(e) => onQueryChange(e.target.value)}
            placeholder="Find a host or ssh user@hostname…"
            className="pl-8"
          />
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-4">
        {connectError && (
          <p className="mx-3 mb-3 rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {connectError}
          </p>
        )}
        {hosts.length === 0 ? (
          <p className="px-3 py-8 text-center text-sm text-muted-foreground">
            No saved hosts — add one under the Hosts tab first.
          </p>
        ) : filtered.length === 0 ? (
          <p className="px-3 py-8 text-center text-sm text-muted-foreground">
            No hosts match “{query}”.
          </p>
        ) : (
          <>
            <p className="px-3 pb-2 text-xs font-medium uppercase tracking-wider text-muted-foreground">
              Hosts
            </p>
            <div className="flex flex-col gap-0.5">
              {filtered.map((host) => {
                const address = `${host.username ? `${host.username}@` : ''}${host.host}${
                  host.port && host.port !== 22 ? `:${host.port}` : ''
                }`;
                return (
                  <button
                    key={host.id}
                    onClick={() => onPickHost(host)}
                    className="group flex items-center gap-3 rounded-lg px-3 py-2 text-left hover:bg-accent"
                  >
                    <span
                      className="flex size-9 shrink-0 items-center justify-center rounded-lg"
                      style={toneStyle(host.color || toneForId(host.id))}
                    >
                      <Server className="size-4" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium">
                        {host.label || host.host}
                      </span>
                      <span className="block truncate text-xs text-muted-foreground">
                        ssh · {address}
                      </span>
                    </span>
                    <ChevronRight className="size-4 shrink-0 text-muted-foreground opacity-0 group-hover:opacity-100" />
                  </button>
                );
              })}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function ConnectingPane({ conn, onTrust, onReject }) {
  return (
    <div className="flex min-w-0 flex-1 flex-col items-center justify-center gap-4 text-center">
      {conn.hostKey ? (
        <>
          <span className="flex size-12 items-center justify-center rounded-xl border bg-muted text-muted-foreground">
            <ShieldQuestion className="size-6" />
          </span>
          <div>
            <p className="text-sm font-medium">
              {conn.hostKey.changed ? 'Host key changed!' : 'Unknown host key'}
            </p>
            <p className="mx-auto max-w-md break-all px-4 text-xs text-muted-foreground">
              SHA256:{conn.hostKey.fingerprint}
            </p>
          </div>
          <div className="flex gap-2">
            <Button size="sm" onClick={onTrust}>
              Trust
            </Button>
            <Button size="sm" variant="outline" onClick={onReject}>
              Reject
            </Button>
          </div>
        </>
      ) : (
        <>
          <Loader2 className="size-6 animate-spin text-muted-foreground" />
          <p className="text-sm text-muted-foreground">Connecting to {conn.title}…</p>
        </>
      )}
    </div>
  );
}

function ErrorPane({ conn, onRetry, onClose }) {
  return (
    <div className="flex min-w-0 flex-1 flex-col items-center justify-center gap-3 text-center">
      <span className="flex size-12 items-center justify-center rounded-xl bg-destructive/10 text-destructive">
        <TriangleAlert className="size-6" />
      </span>
      <div>
        <p className="text-sm font-medium">Couldn't connect to {conn.title}</p>
        <p className="max-w-md text-sm text-muted-foreground">{conn.error}</p>
      </div>
      <div className="flex gap-2">
        <Button size="sm" onClick={onRetry}>
          Retry
        </Button>
        <Button size="sm" variant="outline" onClick={onClose}>
          Close
        </Button>
      </div>
    </div>
  );
}

function Slot({
  side,
  isLocal,
  conn,
  hosts,
  query,
  onQueryChange,
  picking,
  onPickLocal,
  onPickHost,
  onOpenPicker,
  onRetry,
  onClose,
  connectError,
  refreshTick,
  onPathChange,
  cross,
}) {
  const resolved = isLocal ? 'local' : conn ? 'remote' : null;

  if (picking || !resolved) {
    return (
      <HostPicker
        hosts={hosts}
        query={query}
        onQueryChange={onQueryChange}
        onPickLocal={onPickLocal}
        onPickHost={onPickHost}
        onBack={onOpenPicker}
        canBack={Boolean(resolved)}
        connectError={connectError}
      />
    );
  }

  if (resolved === 'local') {
    return (
      <LocalPane
        refreshTick={refreshTick}
        onPathChange={onPathChange}
        onChangeSource={onOpenPicker}
        actionTitle={cross?.title}
        ActionIcon={cross?.Icon}
        onAction={cross?.run}
      />
    );
  }

  if (conn.status === 'connecting') {
    return (
      <ConnectingPane
        conn={conn}
        onTrust={() => window.api.sshHostKeyResponse(conn.sessionId, true)}
        onReject={() => window.api.sshHostKeyResponse(conn.sessionId, false)}
      />
    );
  }

  if (conn.status === 'error') {
    return <ErrorPane conn={conn} onRetry={onRetry} onClose={onClose} />;
  }

  return (
    <RemotePane
      sessionId={conn.sessionId}
      title={conn.title}
      refreshTick={refreshTick}
      onPathChange={onPathChange}
      onChangeSource={onOpenPicker}
      actionTitle={cross?.title}
      ActionIcon={cross?.Icon}
      onAction={cross?.run}
    />
  );
}

export default function SftpHub({ hosts, visible }) {
  const [leftIsLocal, setLeftIsLocal] = useState(false);
  const [rightIsLocal, setRightIsLocal] = useState(false);
  const [leftConn, setLeftConn] = useState(null);
  const [rightConn, setRightConn] = useState(null);
  const [leftPicking, setLeftPicking] = useState(true);
  const [rightPicking, setRightPicking] = useState(true);
  const [leftQuery, setLeftQuery] = useState('');
  const [rightQuery, setRightQuery] = useState('');
  const [leftConnectError, setLeftConnectError] = useState(null);
  const [rightConnectError, setRightConnectError] = useState(null);
  const [leftPath, setLeftPath] = useState(null);
  const [rightPath, setRightPath] = useState(null);
  const [refreshTick, setRefreshTick] = useState(0);
  const [transfers, setTransfers] = useState([]);

  const leftConnRef = useRef(null);
  leftConnRef.current = leftConn;
  const rightConnRef = useRef(null);
  rightConnRef.current = rightConn;

  function patchBySession(sessionId, patch) {
    setLeftConn((prev) => (prev?.sessionId === sessionId ? { ...prev, ...patch } : prev));
    setRightConn((prev) => (prev?.sessionId === sessionId ? { ...prev, ...patch } : prev));
  }

  useEffect(() => {
    const owns = (id) => leftConnRef.current?.sessionId === id || rightConnRef.current?.sessionId === id;

    const unsubReady = window.api.onSshReady(({ sessionId }) => {
      if (owns(sessionId)) patchBySession(sessionId, { status: 'connected', hostKey: null });
    });

    const unsubError = window.api.onSshError(({ sessionId, message }) => {
      if (owns(sessionId)) patchBySession(sessionId, { status: 'error', error: message, hostKey: null });
    });

    const unsubClosed = window.api.onSshClosed(({ sessionId }) => {
      if (leftConnRef.current?.sessionId === sessionId) {
        setLeftConn(null);
        setLeftPicking(true);
      }
      if (rightConnRef.current?.sessionId === sessionId) {
        setRightConn(null);
        setRightPicking(true);
      }
    });

    const unsubHostKey = window.api.onSshHostKey(({ sessionId, ...info }) => {
      if (owns(sessionId)) patchBySession(sessionId, { hostKey: info });
    });

    const unsubTransfer = window.api.onSftpTransfer((t) => {
      if (!owns(t.sessionId) && !owns(t.destSessionId)) return;

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
        return [...prev, { id: t.transferId, kind: t.kind, name: t.name, ...patch }];
      });

      if (t.done) setRefreshTick((n) => n + 1);
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

  function pickLocal(side) {
    const conn = side === 'left' ? leftConnRef.current : rightConnRef.current;
    if (conn) window.api.sshDisconnect(conn.sessionId);
    if (side === 'left') {
      setLeftConnectError(null);
      setLeftConn(null);
      setLeftIsLocal(true);
      setLeftPicking(false);
    } else {
      setRightConnectError(null);
      setRightConn(null);
      setRightIsLocal(true);
      setRightPicking(false);
    }
  }

  async function pickHost(side, host) {
    const setConnectError = side === 'left' ? setLeftConnectError : setRightConnectError;
    const setConn = side === 'left' ? setLeftConn : setRightConn;
    const setIsLocal = side === 'left' ? setLeftIsLocal : setRightIsLocal;
    const setPicking = side === 'left' ? setLeftPicking : setRightPicking;
    const prevConn = side === 'left' ? leftConnRef.current : rightConnRef.current;

    setConnectError(null);
    const result = await window.api.sshConnect({ hostId: host.id, mode: 'sftp' });
    if (result.error) {
      setConnectError(result.error);
      return;
    }
    if (prevConn) window.api.sshDisconnect(prevConn.sessionId);

    setIsLocal(false);
    setConn({
      sessionId: result.sessionId,
      hostId: host.id,
      title: host.label || host.host,
      status: 'connecting',
      error: null,
      hostKey: null,
    });
    setPicking(false);
  }

  function retry(side) {
    const conn = side === 'left' ? leftConn : rightConn;
    const host = hosts.find((h) => h.id === conn?.hostId);
    if (side === 'left') setLeftConn(null);
    else setRightConn(null);
    if (host) pickHost(side, host);
  }

  function closeSide(side) {
    const conn = side === 'left' ? leftConn : rightConn;
    if (conn) window.api.sshDisconnect(conn.sessionId);
    if (side === 'left') {
      setLeftConn(null);
      setLeftPicking(true);
    } else {
      setRightConn(null);
      setRightPicking(true);
    }
  }

  function crossActionFor(side) {
    const mine = side === 'left' ? { isLocal: leftIsLocal, conn: leftConn } : { isLocal: rightIsLocal, conn: rightConn };
    const other = side === 'left' ? { isLocal: rightIsLocal, conn: rightConn } : { isLocal: leftIsLocal, conn: leftConn };
    const otherPath = side === 'left' ? rightPath : leftPath;

    if (mine.isLocal && other.conn?.status === 'connected' && otherPath) {
      return {
        title: 'Upload to other pane',
        Icon: ArrowUpFromLine,
        run: (path) => window.api.sftpUploadPaths(other.conn.sessionId, otherPath, [path]),
      };
    }
    if (!mine.isLocal && mine.conn?.status === 'connected' && other.isLocal && otherPath) {
      return {
        title: 'Download to other pane',
        Icon: ArrowDownToLine,
        run: (path, name) => window.api.sftpDownloadTo(mine.conn.sessionId, path, otherPath, name),
      };
    }
    if (
      !mine.isLocal &&
      mine.conn?.status === 'connected' &&
      other.conn?.status === 'connected' &&
      other.conn.sessionId !== mine.conn.sessionId &&
      otherPath
    ) {
      return {
        title: 'Transfer to other pane',
        Icon: ArrowRightLeft,
        run: (path, name) =>
          window.api.sftpTransferRemote(mine.conn.sessionId, path, other.conn.sessionId, otherPath, name),
      };
    }
    return null;
  }

  const hidden = visible ? '' : 'invisible pointer-events-none';

  return (
    <div className={`absolute inset-0 flex flex-col bg-background ${hidden}`}>
      <div className="flex min-h-0 flex-1">
        <Slot
          side="left"
          isLocal={leftIsLocal}
          conn={leftConn}
          hosts={hosts}
          query={leftQuery}
          onQueryChange={setLeftQuery}
          picking={leftPicking}
          onPickLocal={() => pickLocal('left')}
          onPickHost={(host) => pickHost('left', host)}
          onOpenPicker={() => setLeftPicking(true)}
          onRetry={() => retry('left')}
          onClose={() => closeSide('left')}
          connectError={leftConnectError}
          refreshTick={refreshTick}
          onPathChange={setLeftPath}
          cross={crossActionFor('left')}
        />

        <div className="w-px shrink-0 bg-border" />

        <Slot
          side="right"
          isLocal={rightIsLocal}
          conn={rightConn}
          hosts={hosts}
          query={rightQuery}
          onQueryChange={setRightQuery}
          picking={rightPicking}
          onPickLocal={() => pickLocal('right')}
          onPickHost={(host) => pickHost('right', host)}
          onOpenPicker={() => setRightPicking(true)}
          onRetry={() => retry('right')}
          onClose={() => closeSide('right')}
          connectError={rightConnectError}
          refreshTick={refreshTick}
          onPathChange={setRightPath}
          cross={crossActionFor('right')}
        />
      </div>

      {transfers.length > 0 && (
        <div className="max-h-40 shrink-0 overflow-y-auto border-t bg-muted/30">
          {transfers.map((transfer) => (
            <TransferRow
              key={transfer.id}
              transfer={transfer}
              onDismiss={() => setTransfers((prev) => prev.filter((x) => x.id !== transfer.id))}
            />
          ))}
        </div>
      )}
    </div>
  );
}
