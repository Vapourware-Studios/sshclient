import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import {
  Check,
  ChevronDown,
  ChevronUp,
  Loader2,
  RotateCcw,
  Server,
  ShieldAlert,
  TriangleAlert,
  X,
} from 'lucide-react';

// The stages the main process reports (in order), with friendly labels.
export const SSH_STEPS = [
  { id: 'connecting', label: 'Reaching the server' },
  { id: 'hostkey', label: 'Verifying server identity' },
  { id: 'authenticating', label: 'Authenticating' },
  { id: 'shell', label: 'Starting terminal session' },
];

// Even if the real connection flies through the stages in 100ms, the UI
// walks the steps one at a time with a minimum dwell, so you can see
// each one complete instead of everything flashing at once.
const STEP_DWELL_MS = 450;

function usePacedIndex(targetIndex) {
  const [index, setIndex] = useState(0);

  useEffect(() => {
    if (index >= targetIndex) return;
    const timeout = setTimeout(() => setIndex((i) => i + 1), STEP_DWELL_MS);
    return () => clearTimeout(timeout);
  }, [index, targetIndex]);

  return Math.min(index, Math.max(targetIndex, 0));
}

// A vertical checklist: done steps get a popped-in green check, the
// active step spins with a sonar ring, pending steps sit dimmed.
// Reused by both the SSH connecting view and the SFTP opening view.
export function ProgressSteps({ steps, currentIndex }) {
  return (
    <div className="flex flex-col text-left">
      {steps.map((step, i) => {
        const state = i < currentIndex ? 'done' : i === currentIndex ? 'active' : 'pending';
        return (
          <div key={step.id} className="flex gap-3">
            <div className="flex flex-col items-center">
              <div
                className={`relative flex size-5 shrink-0 items-center justify-center rounded-full border transition-colors duration-300 ${
                  state === 'done'
                    ? 'border-emerald-500 bg-emerald-500 text-white'
                    : state === 'active'
                      ? 'border-primary text-primary'
                      : 'border-border text-muted-foreground/40'
                }`}
              >
                {state === 'active' && (
                  <span className="absolute -inset-0.5 rounded-full border border-primary/50 animate-ring-pulse" />
                )}
                {state === 'done' ? (
                  <Check className="size-3 animate-step-pop" strokeWidth={3} />
                ) : state === 'active' ? (
                  <Loader2 className="size-3 animate-spin" />
                ) : (
                  <span className="size-1.5 rounded-full bg-current" />
                )}
              </div>
              {i < steps.length - 1 && (
                <div className="relative my-0.5 h-4 w-px bg-border">
                  {i < currentIndex && (
                    <span className="absolute inset-0 bg-emerald-500 animate-connector" />
                  )}
                </div>
              )}
            </div>
            <p
              className={`text-xs leading-5 transition-colors duration-300 ${
                state === 'done'
                  ? 'text-foreground'
                  : state === 'active'
                    ? 'shimmer-text font-medium'
                    : 'text-muted-foreground/50'
              }`}
            >
              {step.label}
            </p>
          </div>
        );
      })}
    </div>
  );
}

function formatLogTime(time) {
  const d = new Date(time);
  return `${d.toTimeString().slice(0, 8)}.${String(d.getMilliseconds()).padStart(3, '0')}`;
}

// The raw connection log: timestamps + what ssh2 is actually doing on
// the wire (debug lines dim, our milestones green, what the server
// prints to the terminal blue, errors red).
export function ConnectionLog({ logs = [] }) {
  const endRef = useRef(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: 'end' });
  }, [logs.length]);

  return (
    <div className="max-h-44 w-full max-w-xl overflow-y-auto rounded-md border border-white/10 bg-black/40 p-3 text-left font-mono text-[11px] leading-relaxed animate-rise-in">
      {logs.length === 0 && <p className="text-muted-foreground">Waiting for output…</p>}
      {logs.map((entry) => (
        <p
          key={entry.id}
          className={`animate-rise-in break-all whitespace-pre-wrap ${
            entry.level === 'error'
              ? 'text-destructive'
              : entry.level === 'debug'
                ? 'text-muted-foreground/70'
                : entry.level === 'output'
                  ? 'text-sky-300'
                  : 'text-emerald-400'
          }`}
        >
          <span className="text-muted-foreground/50">{formatLogTime(entry.time)}</span>{' '}
          {entry.line}
        </p>
      ))}
      <div ref={endRef} />
    </div>
  );
}

function ShowLogsButton({ show, onToggle }) {
  return (
    <Button variant="ghost" size="sm" onClick={onToggle} className="text-muted-foreground">
      {show ? <ChevronUp className="size-3.5" /> : <ChevronDown className="size-3.5" />}
      {show ? 'Hide logs' : 'Show logs'}
    </Button>
  );
}

export function ConnectingView({ title, stage, logs, onCancel }) {
  const [showLogs, setShowLogs] = useState(false);
  const targetIndex = SSH_STEPS.findIndex((s) => s.id === stage);
  const currentIndex = usePacedIndex(targetIndex < 0 ? 0 : targetIndex);

  return (
    <div className="flex h-full flex-col items-center justify-center gap-6 bg-background px-6 text-center animate-view-in">
      <div className="relative flex size-20 items-center justify-center">
        <span className="absolute inset-0 rounded-full border border-primary/30 animate-halo" />
        <span className="absolute inset-0 rounded-full border border-primary/30 animate-halo [animation-delay:1.2s]" />
        <span className="absolute inset-3 rounded-full bg-primary/10 animate-breathe" />
        <Server className="relative size-6 text-primary" />
      </div>

      <div className="flex flex-col gap-1 animate-rise-in [animation-delay:0.08s]">
        <p className="text-sm font-medium">{title}</p>
        <p className="text-xs text-muted-foreground">Establishing secure connection</p>
      </div>

      <div className="animate-rise-in [animation-delay:0.16s]">
        <ProgressSteps steps={SSH_STEPS} currentIndex={currentIndex} />
      </div>

      <div className="flex gap-2 animate-rise-in [animation-delay:0.24s]">
        <Button variant="outline" size="sm" onClick={onCancel}>
          <X className="size-3.5" /> Cancel
        </Button>
        <ShowLogsButton show={showLogs} onToggle={() => setShowLogs((s) => !s)} />
      </div>

      {showLogs && <ConnectionLog logs={logs} />}
    </div>
  );
}

export function HostKeyPromptView({ title, info, onTrust, onReject }) {
  const changed = info?.changed;

  return (
    <div className="flex h-full flex-col items-center justify-center gap-5 bg-background px-6 text-center animate-view-in">
      <div
        className={`relative flex size-16 items-center justify-center rounded-full animate-step-pop ${
          changed ? 'bg-destructive/10' : 'bg-primary/10'
        }`}
      >
        <span
          className={`absolute inset-0 rounded-full border animate-halo ${
            changed ? 'border-destructive/30' : 'border-primary/30'
          }`}
        />
        <ShieldAlert className={`size-7 ${changed ? 'text-destructive' : 'text-primary'}`} />
      </div>

      <div className="flex w-full max-w-sm flex-col gap-1 animate-rise-in [animation-delay:0.08s]">
        <p className="text-sm font-medium">
          {changed ? `Host key for ${title} has changed!` : `Unknown host: ${title}`}
        </p>
        <p className="text-xs text-muted-foreground">
          {changed
            ? "This could mean someone is intercepting your connection, or the server was rebuilt. Verify the fingerprint out-of-band before trusting it."
            : "This is the first time you're connecting to this host. Verify the fingerprint out-of-band if possible."}
        </p>
        <div className="mt-3 rounded-md border bg-muted/40 px-3 py-2 text-left">
          <p className="break-all font-mono text-xs text-foreground/80">
            SHA256:{info?.fingerprint}
          </p>
          {changed && (
            <p className="mt-1 break-all font-mono text-xs text-muted-foreground/70 line-through">
              SHA256:{info?.previousFingerprint}
            </p>
          )}
        </div>
      </div>

      <div className="flex gap-2 animate-rise-in [animation-delay:0.16s]">
        <Button variant="outline" size="sm" onClick={onReject}>
          Reject
        </Button>
        <Button variant={changed ? 'destructive' : 'default'} size="sm" onClick={onTrust}>
          Trust & continue
        </Button>
      </div>
    </div>
  );
}

export function ConnectErrorView({ title, message, logs, onRetry, onClose }) {
  const [showLogs, setShowLogs] = useState(false);

  return (
    <div className="flex h-full flex-col items-center justify-center gap-5 bg-background px-6 text-center animate-view-in">
      <div className="flex size-16 items-center justify-center rounded-full bg-destructive/10 animate-step-pop">
        <TriangleAlert className="size-7 text-destructive" />
      </div>

      <div className="flex flex-col gap-1 animate-rise-in [animation-delay:0.08s]">
        <p className="text-sm font-medium">Couldn't connect to {title}</p>
        <p className="max-w-sm text-xs text-muted-foreground">{message}</p>
      </div>

      <div className="flex gap-2 animate-rise-in [animation-delay:0.16s]">
        <Button variant="outline" size="sm" onClick={onClose}>
          Close
        </Button>
        <Button size="sm" onClick={onRetry}>
          <RotateCcw className="size-3.5" /> Retry
        </Button>
        <ShowLogsButton show={showLogs} onToggle={() => setShowLogs((s) => !s)} />
      </div>

      {showLogs && <ConnectionLog logs={logs} />}
    </div>
  );
}
