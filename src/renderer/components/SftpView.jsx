import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { ProgressSteps } from '@/components/ConnectionStatus';
import {
  ArrowDownToLine,
  ArrowUpFromLine,
  Check,
  ChevronRight,
  File,
  Folder,
  FolderOpen,
  FolderUp,
  Link as LinkIcon,
  Loader2,
  RefreshCw,
  TriangleAlert,
  Upload,
  X,
} from 'lucide-react';

const SFTP_STEPS = [
  { id: 'channel', label: 'Opening SFTP channel' },
  { id: 'list', label: 'Reading remote folder' },
];

// How long each opening step stays on screen at minimum, so the
// animation is visible even when the server answers instantly.
const OPEN_DWELL_MS = 500;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function formatSize(bytes) {
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

function joinRemote(dir, name) {
  return (dir === '/' ? '' : dir) + '/' + name;
}

// '/home/demo' -> [{label: '/', path: '/'}, {label: 'home', ...}, ...]
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

export default function SftpView({ sessionId, visible }) {
  const [phase, setPhase] = useState('opening'); // opening | ready | error
  const [openStep, setOpenStep] = useState(0);
  const [openError, setOpenError] = useState(null);
  const [attempt, setAttempt] = useState(0);

  const [path, setPath] = useState(null);
  const [entries, setEntries] = useState([]);
  const [listing, setListing] = useState(false);
  const [listError, setListError] = useState(null);
  const [transfers, setTransfers] = useState([]);
  const [dragOver, setDragOver] = useState(false);

  // Refs mirror state that IPC event handlers need, so the listeners
  // (registered once) always see the current values.
  const pathRef = useRef(null);
  pathRef.current = path;

  async function loadDir(nextPath) {
    setListing(true);
    setListError(null);
    const result = await window.api.sftpList(sessionId, nextPath);
    setListing(false);
    if (result.error) {
      setListError(result.error);
      return false;
    }
    setPath(nextPath);
    setEntries(result.entries);
    return true;
  }

  // Open the SFTP channel once (or again after Retry), pacing the two
  // opening steps so the animation reads clearly.
  useEffect(() => {
    let cancelled = false;

    (async () => {
      setPhase('opening');
      setOpenStep(0);
      setOpenError(null);

      const [home] = await Promise.all([window.api.sftpHome(sessionId), sleep(OPEN_DWELL_MS)]);
      if (cancelled) return;
      if (home.error) {
        setOpenError(home.error);
        setPhase('error');
        return;
      }

      setOpenStep(1);
      const [ok] = await Promise.all([loadDir(home.path), sleep(OPEN_DWELL_MS)]);
      if (cancelled) return;
      if (!ok) {
        setOpenError('Could not read the starting folder');
        setPhase('error');
        return;
      }

      setOpenStep(2);
      await sleep(300);
      if (!cancelled) setPhase('ready');
    })();

    return () => {
      cancelled = true;
    };
  }, [sessionId, attempt]);

  // Track transfer progress events for this session.
  useEffect(() => {
    const unsub = window.api.onSftpTransfer((t) => {
      if (t.sessionId !== sessionId) return;

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

      if (t.done || t.error) {
        // A finished upload means the folder has a new file — refresh.
        if (t.done && t.kind === 'upload' && pathRef.current) {
          loadDir(pathRef.current);
        }
        // Tidy up finished rows after a moment.
        setTimeout(() => {
          setTransfers((prev) => prev.filter((x) => x.id !== t.transferId));
        }, 4000);
      }
    });
    return unsub;
  }, [sessionId]);

  function openEntry(entry) {
    if (entry.type === 'file') return;
    // Links might point at folders; try to list them and show the error if not.
    loadDir(joinRemote(path, entry.name));
  }

  function downloadEntry(entry) {
    window.api.sftpDownload(sessionId, joinRemote(path, entry.name), entry.name);
  }

  function uploadViaDialog() {
    window.api.sftpUpload(sessionId, path);
  }

  function onDrop(event) {
    event.preventDefault();
    setDragOver(false);
    const localPaths = [...event.dataTransfer.files]
      .map((file) => window.api.pathForFile(file))
      .filter(Boolean);
    if (localPaths.length > 0) {
      window.api.sftpUploadPaths(sessionId, path, localPaths);
    }
  }

  const hidden = visible ? '' : 'invisible pointer-events-none';

  if (phase !== 'ready') {
    return (
      <div className={`absolute inset-0 flex flex-col items-center justify-center gap-5 text-center ${hidden}`}>
        {phase === 'opening' ? (
          <>
            <div className="relative flex size-16 items-center justify-center">
              <span className="absolute inset-0 rounded-full border border-sky-400/40 animate-sonar" />
              <span className="absolute inset-0 rounded-full border border-sky-400/40 animate-sonar [animation-delay:0.9s]" />
              <span className="absolute inset-2 rounded-full bg-sky-400/10" />
              <FolderOpen className="size-6 text-sky-400" />
            </div>
            <ProgressSteps steps={SFTP_STEPS} currentIndex={openStep} />
          </>
        ) : (
          <>
            <div className="flex size-16 items-center justify-center rounded-full bg-destructive/10 animate-step-pop">
              <TriangleAlert className="size-7 text-destructive" />
            </div>
            <div className="flex flex-col gap-1">
              <p className="text-sm font-medium">Couldn't open SFTP</p>
              <p className="max-w-sm text-xs text-muted-foreground">{openError}</p>
            </div>
            <Button size="sm" onClick={() => setAttempt((a) => a + 1)}>
              <RefreshCw className="size-3.5" /> Retry
            </Button>
          </>
        )}
      </div>
    );
  }

  return (
    <div
      className={`absolute inset-0 flex flex-col text-sm ${hidden}`}
      onDragOver={(e) => {
        e.preventDefault();
        setDragOver(true);
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={onDrop}
    >
      <div className="flex items-center gap-1 border-b border-white/10 px-3 py-2">
        <button
          onClick={() => loadDir(parentOf(path))}
          title="Up one folder"
          disabled={path === '/'}
          className="rounded p-1.5 text-muted-foreground hover:text-foreground disabled:opacity-40"
        >
          <FolderUp className="size-4" />
        </button>

        <div className="flex min-w-0 flex-1 items-center overflow-x-auto text-xs">
          {crumbsOf(path).map((crumb, i) => (
            <span key={crumb.path} className="flex shrink-0 items-center">
              {i > 1 && <ChevronRight className="size-3 text-muted-foreground/50" />}
              <button
                onClick={() => loadDir(crumb.path)}
                className={`rounded px-1 py-0.5 hover:bg-white/10 ${
                  crumb.path === path ? 'font-medium text-foreground' : 'text-muted-foreground'
                }`}
              >
                {crumb.label}
              </button>
            </span>
          ))}
          {listing && <Loader2 className="ml-2 size-3.5 shrink-0 animate-spin text-muted-foreground" />}
        </div>

        <button
          onClick={() => loadDir(path)}
          title="Refresh"
          className="rounded p-1.5 text-muted-foreground hover:text-foreground"
        >
          <RefreshCw className="size-4" />
        </button>
        <Button variant="outline" size="sm" onClick={uploadViaDialog}>
          <Upload className="size-3.5" /> Upload
        </Button>
      </div>

      {listError && (
        <p className="border-b border-white/10 bg-destructive/10 px-4 py-2 text-xs text-destructive animate-rise-in">
          {listError}
        </p>
      )}

      <div key={path} className="flex-1 overflow-y-auto py-1">
        {entries.length === 0 && (
          <p className="px-4 py-6 text-center text-xs text-muted-foreground animate-rise-in">
            This folder is empty
          </p>
        )}
        {entries.map((entry, i) => (
          <div
            key={entry.name}
            onDoubleClick={() => openEntry(entry)}
            className="group flex cursor-default items-center gap-3 px-4 py-1.5 animate-rise-in hover:bg-white/5"
            style={{ animationDelay: `${Math.min(i, 20) * 20}ms` }}
          >
            <EntryIcon type={entry.type} />
            {entry.type === 'dir' ? (
              <button
                onClick={() => openEntry(entry)}
                className="min-w-0 flex-1 truncate text-left hover:underline"
              >
                {entry.name}
              </button>
            ) : (
              <span className="min-w-0 flex-1 truncate">{entry.name}</span>
            )}
            <span className="w-20 shrink-0 text-right text-xs text-muted-foreground">
              {entry.type === 'dir' ? '' : formatSize(entry.size)}
            </span>
            <span className="w-28 shrink-0 text-right text-xs text-muted-foreground">
              {formatDate(entry.mtime)}
            </span>
            <button
              onClick={() => downloadEntry(entry)}
              title="Download"
              className={`shrink-0 rounded p-1 text-muted-foreground hover:text-foreground ${
                entry.type === 'dir' ? 'invisible' : 'invisible group-hover:visible'
              }`}
            >
              <ArrowDownToLine className="size-3.5" />
            </button>
          </div>
        ))}
      </div>

      {transfers.length > 0 && (
        <div className="max-h-48 shrink-0 overflow-y-auto border-t border-white/10 bg-black/30">
          {transfers.map((transfer) => (
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

      {dragOver && (
        <div className="pointer-events-none absolute inset-2 z-10 flex items-center justify-center rounded-lg border-2 border-dashed border-primary bg-primary/10">
          <p className="flex items-center gap-2 text-sm font-medium text-primary">
            <Upload className="size-4" /> Drop files to upload to {path}
          </p>
        </div>
      )}
    </div>
  );
}
