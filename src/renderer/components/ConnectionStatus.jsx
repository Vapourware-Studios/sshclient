import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Check,
  ChevronDown,
  ChevronUp,
  KeyRound,
  Loader2,
  PlugZap,
  PowerOff,
  RotateCcw,
  Server,
  ShieldAlert,
  TriangleAlert,
  X,
} from 'lucide-react';
import { usePrivacySettings } from '@/lib/privacy-settings.jsx';
import { isIpAddress } from '@/lib/ip';

export const SSH_STEPS = [
  { id: 'connecting', label: 'Reaching the server' },
  { id: 'hostkey', label: 'Verifying server identity' },
  { id: 'authenticating', label: 'Authenticating' },
  { id: 'shell', label: 'Starting terminal session' },
];

const STEP_DWELL_MS = 450;

// Connecting is the one moment the app makes you wait, so it may as well say
// something. The real progress is the step list below these — this is flavour,
// and it never claims anything about what the connection is actually doing.
const QUIPS = [
  'Waking up the server',
  'Politely knocking on port 22',
  'Asking the router for directions',
  'Its always DNS!',
  'MAN! this internet is slow!',
  'Waiting for the server to finish its coffee',
  'Bribing the firewall, ITS ASKING FOR $200!',
];

const QUIP_ROTATE_MS = 2400;

function useQuip() {
  // Starting somewhere random keeps the same host from greeting you with the
  // same line every single time.
  const [index, setIndex] = useState(() => Math.floor(Math.random() * QUIPS.length));

  useEffect(() => {
    const timer = setInterval(() => setIndex((i) => (i + 1) % QUIPS.length), QUIP_ROTATE_MS);
    return () => clearInterval(timer);
  }, []);

  return QUIPS[index];
}

function usePacedIndex(targetIndex) {
  const [index, setIndex] = useState(0);

  useEffect(() => {
    if (index >= targetIndex) return;
    const timeout = setTimeout(() => setIndex((i) => i + 1), STEP_DWELL_MS);
    return () => clearTimeout(timeout);
  }, [index, targetIndex]);

  return Math.min(index, Math.max(targetIndex, 0));
}

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

function HostTitle({ title }) {
  const { blurHostIps } = usePrivacySettings();
  return (
    <span className={blurHostIps && isIpAddress(title) ? 'blur-sensitive' : ''}>{title}</span>
  );
}

function formatLogTime(time) {
  const d = new Date(time);
  return `${d.toTimeString().slice(0, 8)}.${String(d.getMilliseconds()).padStart(3, '0')}`;
}

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
  const quip = useQuip();
  const targetIndex = SSH_STEPS.findIndex((s) => s.id === stage);
  const currentIndex = usePacedIndex(targetIndex < 0 ? 0 : targetIndex);

  return (
    <div className="flex h-full flex-col items-center justify-center gap-6 bg-background px-6 text-center animate-view-in">
      <div className="flex flex-col items-center gap-4">
        <div className="flex size-16 items-center justify-center rounded-full bg-primary/10">
          <Server className="size-7 text-primary" />
        </div>
        <div className="relative h-1.5 w-40 overflow-hidden rounded-full bg-muted">
          <span className="absolute inset-y-0 left-0 w-10 rounded-full bg-primary animate-bounce-bar" />
        </div>
      </div>

      <div className="flex flex-col gap-1 animate-rise-in [animation-delay:0.08s]">
        <p className="text-sm font-medium">
          <HostTitle title={title} />
        </p>
        <p key={quip} className="text-xs text-muted-foreground animate-rise-in">
          {quip}…
        </p>
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
          {changed ? (
            <>Host key for <HostTitle title={title} /> has changed!</>
          ) : (
            <>Unknown host: <HostTitle title={title} /></>
          )}
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

/**
 * The server refused the saved credentials but offers password login. Asking is
 * the whole point: the alternative is a dead end that says every method failed,
 * when typing a password would have worked.
 */
export function PasswordPromptView({ title, info, onSubmit, onCancel }) {
  const [password, setPassword] = useState('');

  function submit(event) {
    event.preventDefault();
    if (password) onSubmit(password);
  }

  return (
    <div className="flex h-full flex-col items-center justify-center gap-5 bg-background px-6 text-center animate-view-in">
      <div className="relative flex size-16 items-center justify-center rounded-full bg-primary/10 animate-step-pop">
        <span className="absolute inset-0 rounded-full border border-primary/30 animate-halo" />
        <KeyRound className="size-7 text-primary" />
      </div>

      <div className="flex w-full max-w-sm flex-col gap-1 animate-rise-in [animation-delay:0.08s]">
        <p className="text-sm font-medium">
          Password for <HostTitle title={title} />
        </p>
        <p className="text-xs text-muted-foreground">
          {info?.retry
            ? 'That password was rejected. Try again.'
            : `The server turned down the saved credentials but accepts a password for ${info?.username}.`}
        </p>
      </div>

      <form onSubmit={submit} className="flex w-full max-w-sm flex-col gap-2 animate-rise-in [animation-delay:0.16s]">
        <Input
          autoFocus
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="Password"
          aria-label="Password"
        />
        <div className="flex justify-center gap-2">
          <Button type="button" variant="outline" size="sm" onClick={onCancel}>
            Cancel
          </Button>
          <Button type="submit" size="sm" disabled={!password}>
            Continue
          </Button>
        </div>
      </form>
      <p className="text-xs text-muted-foreground">
        Used for this connection only — it is not saved to the vault.
      </p>
    </div>
  );
}

/**
 * Shown when a session that was already up goes away. `reason` is 'closed' for
 * a deliberate logout (the remote reported an exit status) and 'lost' when the
 * transport dropped underneath us — the wording and the affordance differ.
 */
export function DisconnectedView({ title, reason, message, exitCode, logs, onReconnect, onClose }) {
  const [showLogs, setShowLogs] = useState(false);
  const lost = reason === 'lost';
  const Icon = lost ? PlugZap : PowerOff;

  const detail =
    message ||
    (lost
      ? 'The connection dropped before the session ended. The server, the network, or a sleeping laptop are all likely culprits.'
      : exitCode
        ? `The remote shell exited with code ${exitCode}.`
        : 'The remote shell exited and the session ended normally.');

  return (
    <div className="flex h-full flex-col items-center justify-center gap-5 bg-background px-6 text-center animate-view-in">
      <div
        className={`flex size-16 items-center justify-center rounded-full animate-step-pop ${
          lost ? 'bg-destructive/10' : 'bg-muted'
        }`}
      >
        <Icon className={`size-7 ${lost ? 'text-destructive' : 'text-muted-foreground'}`} />
      </div>

      <div className="flex flex-col gap-1 animate-rise-in [animation-delay:0.08s]">
        <p className="text-sm font-medium">
          {lost ? 'Connection lost to ' : 'Connection closed to '}
          <HostTitle title={title} />
        </p>
        <p className="max-w-sm text-xs text-muted-foreground">{detail}</p>
      </div>

      <div className="flex gap-2 animate-rise-in [animation-delay:0.16s]">
        <Button variant="outline" size="sm" onClick={onClose}>
          Close tab
        </Button>
        <Button size="sm" onClick={onReconnect}>
          <RotateCcw className="size-3.5" /> {lost ? 'Try again' : 'Reconnect'}
        </Button>
        <ShowLogsButton show={showLogs} onToggle={() => setShowLogs((s) => !s)} />
      </div>

      {showLogs && <ConnectionLog logs={logs} />}
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
        <p className="text-sm font-medium">
          Couldn't connect to <HostTitle title={title} />
        </p>
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
