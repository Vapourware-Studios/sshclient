import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ArrowUpCircle,
  CheckCircle2,
  ExternalLink,
  Loader2,
  RefreshCw,
  TriangleAlert,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';

function formatDate(iso) {
  if (!iso) return null;
  return new Date(iso).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

/**
 * Release bodies are Markdown, and pulling in a Markdown renderer for a
 * changelog is not worth it — bullets and headings are the only markup that
 * shows up in practice, so they get stripped down to plain lines.
 */
function ReleaseNotes({ notes }) {
  const lines = notes
    .split('\n')
    .map((line) => line.replace(/^#{1,6}\s*/, '').replace(/^[-*]\s+/, '• ').trimEnd())
    .filter((line, i, all) => line || all[i - 1]);

  if (lines.length === 0) return null;

  return (
    <div className="max-h-56 overflow-y-auto rounded-md border bg-muted/40 p-3">
      {lines.map((line, i) => (
        <p key={i} className="text-xs leading-relaxed text-muted-foreground">
          {line || ' '}
        </p>
      ))}
    </div>
  );
}

// Tailwind only ships the utilities it can see spelled out, and a bar this
// short reads the same at 5% resolution as it does at 1% — so the fill widths
// are a fixed ladder of classes rather than a computed style.
const FILL_WIDTHS = [
  'w-[2%]', 'w-[5%]', 'w-[10%]', 'w-[15%]', 'w-[20%]', 'w-[25%]', 'w-[30%]',
  'w-[35%]', 'w-[40%]', 'w-[45%]', 'w-[50%]', 'w-[55%]', 'w-[60%]', 'w-[65%]',
  'w-[70%]', 'w-[75%]', 'w-[80%]', 'w-[85%]', 'w-[90%]', 'w-[95%]', 'w-full',
];

function ProgressBar({ percent, pulse }) {
  const step = Math.round(Math.max(0, Math.min(100, percent || 0)) / 5);
  return (
    <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
      <span
        className={`block h-full rounded-full bg-primary transition-[width] duration-300 ${FILL_WIDTHS[step]} ${pulse ? 'animate-pulse' : ''}`}
      />
    </div>
  );
}

/**
 * The manual half of the updater. The app checks on its own at unlock; this is
 * for the times you want to ask, and for seeing which mechanism this particular
 * install actually updates through — Homebrew, a distro package, or in place.
 */
export default function UpdatePanel() {
  const [info, setInfo] = useState(null);
  const [checking, setChecking] = useState(true);
  const [installing, setInstalling] = useState(false);
  const [message, setMessage] = useState('');
  const [progress, setProgress] = useState(null);
  // The snapshot in a check result is taken before the GitHub request, so a
  // status event that lands while it is in flight is the newer truth.
  const statusSeq = useRef(0);

  const check = useCallback(async () => {
    setChecking(true);
    setMessage('');
    const seenAtStart = statusSeq.current;
    try {
      const result = await window.api.updateCheck();
      setInfo(result || { error: 'Update check failed.' });
      // A download that finished before this panel was ever opened only exists
      // in the main process's state — without adopting it, Settings would offer
      // to start an update that is already sitting there waiting for a restart.
      if (result?.progress && statusSeq.current === seenAtStart) setProgress(result.progress);
    } finally {
      setChecking(false);
    }
  }, []);

  useEffect(() => {
    check();
  }, [check]);

  useEffect(
    () =>
      window.api.onUpdateStatus?.((status) => {
        statusSeq.current += 1;
        setProgress(status);
      }),
    []
  );

  async function install() {
    setInstalling(true);
    setMessage('');
    if (progress?.state === 'error') setProgress(null);
    try {
      const result = await window.api.updateInstall();
      if (result?.error) {
        setMessage(result.error);
        return;
      }
      if (result?.mode === 'installed') {
        setMessage(`Installed ${result.version}. Restart to finish.`);
      } else if (result?.mode === 'terminal') {
        setMessage(
          result.warning
            ? `Homebrew could not finish on its own, so the command is waiting in a new terminal tab — press Enter to run it. (${result.warning})`
            : 'The upgrade command is waiting in a new terminal tab — press Enter to run it.'
        );
      } else if (result?.mode === 'in-app') {
        setMessage('Downloading the update. You will be asked to restart when it is ready.');
      } else if (result?.mode === 'page') {
        setMessage('Opened the release page in your browser.');
      }
    } finally {
      setInstalling(false);
    }
  }

  const downloading = progress?.state === 'downloading';
  // A package manager doing the work reports no byte count, so its progress bar
  // is the indeterminate kind — but it still has to block a second click.
  const busy = progress?.state === 'installing';
  const ready = progress?.state === 'downloaded';
  // An update that died halfway takes its progress bar with it, so the failure
  // has to be said out loud — otherwise the panel just goes quiet, still
  // showing the message from when the download started.
  const failed = progress?.state === 'error' ? progress.error : null;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <ArrowUpCircle className="size-4" /> Updates
        </CardTitle>
        <CardDescription>
          SSH Client checks for a new release when you unlock the vault, and every few
          hours after that. You can also ask right now.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border bg-muted/40 px-3 py-2.5">
          <div className="flex flex-col gap-0.5">
            <span className="text-sm font-medium">Version {info?.currentVersion || '—'}</span>
            {info?.channelLabel && (
              <span className="text-xs text-muted-foreground">Updates via {info.channelLabel}</span>
            )}
          </div>
          <Button variant="outline" size="sm" onClick={check} disabled={checking || installing}>
            {checking ? <Loader2 className="size-3.5 animate-spin" /> : <RefreshCw className="size-3.5" />}
            {checking ? 'Checking…' : 'Check for updates'}
          </Button>
        </div>

        {info?.packaged === false && (
          <p className="text-xs text-muted-foreground">
            This is a development build, so updates are only reported, never installed.
          </p>
        )}

        {info?.error && (
          <p className="flex items-center gap-2 text-xs text-destructive">
            <TriangleAlert className="size-3.5 shrink-0" /> {info.error}
          </p>
        )}

        {!checking && info && !info.error && !info.hasUpdate && (
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <CheckCircle2 className="size-4 shrink-0 text-emerald-500" />
            You're on the latest release.
          </p>
        )}

        {!checking && info?.hasUpdate && (
          <div className="flex flex-col gap-3">
            <div className="flex flex-wrap items-center gap-2">
              <Badge>{info.latestVersion}</Badge>
              <span className="text-sm font-medium">{info.releaseName || 'New release'}</span>
              {formatDate(info.publishedAt) && (
                <span className="text-xs text-muted-foreground">{formatDate(info.publishedAt)}</span>
              )}
            </div>

            {info.notes && <ReleaseNotes notes={info.notes} />}

            {info.needsRoot && (
              <p className="text-xs text-muted-foreground">
                Replacing a system package needs root, so the install command will ask for
                your password in the terminal tab it opens.
              </p>
            )}

            {failed && (
              <p className="flex items-start gap-2 text-xs text-destructive">
                <TriangleAlert className="size-3.5 shrink-0 translate-y-px" />
                <span>The update stopped: {failed}</span>
              </p>
            )}

            {!failed && (downloading || busy || ready) && (
              <div className="flex flex-col gap-1.5">
                <ProgressBar percent={ready || busy ? 100 : progress.percent || 0} pulse={busy} />
                <span className="text-xs text-muted-foreground">
                  {ready
                    ? 'Ready — restart to finish.'
                    : busy
                      ? 'Installing… this can take a minute.'
                      : `Downloading… ${Math.round(progress.percent || 0)}%`}
                </span>
              </div>
            )}

            <div className="flex flex-wrap gap-2">
              <Button size="sm" onClick={install} disabled={installing || downloading || busy}>
                {installing && <Loader2 className="size-3.5 animate-spin" />}
                {info.action === 'page'
                  ? 'Open download page'
                  : ready
                    ? 'Restart and install'
                    : failed
                      ? 'Try again'
                      : 'Update now'}
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => window.api.updateOpenReleasePage()}
              >
                <ExternalLink className="size-3.5" /> Release notes
              </Button>
            </div>
          </div>
        )}

        {message && <p className="text-xs text-muted-foreground">{message}</p>}
      </CardContent>
    </Card>
  );
}
