import { useEffect, useState } from 'react';
import { Check, KeyRound, Loader2, RotateCcw, Server, ShieldAlert, TriangleAlert } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { ProgressSteps } from '@/components/ConnectionStatus';
import SelectHostPanel from '@/components/SelectHostPanel';
import { toneForId, toneStyle } from '@/lib/tone';
import { HostIcon } from '@/lib/host-icons.jsx';

const STEPS = [
  { id: 'connecting', label: 'Reaching the server' },
  { id: 'hostkey', label: 'Verifying server identity' },
  { id: 'authenticating', label: 'Authenticating' },
  { id: 'keycopy', label: 'Installing public key' },
];

export default function CopyKeyToHostDialog({ keyItem, open, onOpenChange, onNewHost }) {
  const [hosts, setHosts] = useState([]);
  const [hostId, setHostId] = useState('');
  const [password, setPassword] = useState('');
  const [phase, setPhase] = useState('form');
  const [stage, setStage] = useState('connecting');
  const [error, setError] = useState('');
  const [hostKeyInfo, setHostKeyInfo] = useState(null);
  const [sessionId, setSessionId] = useState(null);

  useEffect(() => {
    if (!open) return;
    window.api.hostsList().then((res) => {
      if (!res.error) setHosts(res.hosts);
    });
    setPhase('form');
    setHostId('');
    setPassword('');
    setError('');
    setSessionId(null);
    setHostKeyInfo(null);
  }, [open]);

  useEffect(() => {
    if (!open || !sessionId) return;
    const offProgress = window.api.onSshProgress((payload) => {
      if (payload.sessionId !== sessionId) return;
      setStage(payload.stage);
    });
    const offReady = window.api.onSshReady((payload) => {
      if (payload.sessionId !== sessionId) return;
      setPhase('done');
    });
    const offError = window.api.onSshError((payload) => {
      if (payload.sessionId !== sessionId) return;
      setPhase('error');
      setError(payload.message);
    });
    const offHostKey = window.api.onSshHostKey((payload) => {
      if (payload.sessionId !== sessionId) return;
      setHostKeyInfo(payload);
      setPhase('hostkey');
    });
    return () => {
      offProgress();
      offReady();
      offError();
      offHostKey();
    };
  }, [open, sessionId]);

  const selectedHost = hosts.find((h) => h.id === hostId);
  const needsPassword =
    selectedHost && !selectedHost.hasPassword && !selectedHost.hasPrivateKey && !selectedHost.keyId;

  async function startCopy() {
    setPhase('connecting');
    setStage('connecting');
    setError('');
    const res = await window.api.sshConnect({
      hostId,
      password: needsPassword ? password : undefined,
      installKeyId: keyItem.id,
    });
    if (res.error) {
      setPhase('error');
      setError(res.error);
      return;
    }
    setSessionId(res.sessionId);
  }

  async function respondHostKey(trust) {
    setHostKeyInfo(null);
    setPhase('connecting');
    await window.api.sshHostKeyResponse(sessionId, trust);
  }

  function cancelConnecting() {
    if (sessionId) window.api.sshDisconnect(sessionId);
    setPhase('form');
    setSessionId(null);
  }

  const targetIndex = STEPS.findIndex((s) => s.id === stage);
  const busy = phase === 'connecting' || phase === 'hostkey';

  if (phase === 'picking') {
    return (
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="flex h-[32rem] max-w-md flex-col p-0" showClose={false}>
          <SelectHostPanel
            title="Select host"
            subtitle={`Copy ${keyItem.name} to`}
            hosts={hosts}
            selectedId={hostId ? `host:${hostId}` : null}
            onSelect={(item) => {
              setHostId(item.id);
              setPhase('form');
            }}
            onBack={() => setPhase('form')}
            onNewHost={onNewHost}
          />
        </DialogContent>
      </Dialog>
    );
  }

  return (
    <Dialog open={open} onOpenChange={(next) => !busy && onOpenChange(next)}>
      <DialogContent className="max-w-md" showClose={!busy}>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <KeyRound className="size-4" /> Copy key to host
          </DialogTitle>
          <DialogDescription>
            Installs <span className="font-medium text-foreground">{keyItem.name}</span>'s public
            half into ~/.ssh/authorized_keys on the host you pick.
          </DialogDescription>
        </DialogHeader>

        <div className="flex min-h-0 flex-col gap-4 overflow-y-auto">
        {phase === 'form' && (
          <div className="flex flex-col gap-4">
            <div className="flex flex-col gap-2">
              <Label>Target host</Label>
              <button
                type="button"
                onClick={() => setPhase('picking')}
                className="flex items-center gap-3 rounded-lg border px-3 py-2 text-left text-sm hover:bg-accent/50"
              >
                <span
                  className="flex size-9 shrink-0 items-center justify-center rounded-lg"
                  style={toneStyle(
                    selectedHost ? selectedHost.color || toneForId(selectedHost.id) : toneForId('none')
                  )}
                >
                  <HostIcon slug={selectedHost?.icon} fallback={Server} className="size-4" />
                </span>
                <span className="min-w-0 flex-1 truncate font-medium">
                  {selectedHost ? selectedHost.label || selectedHost.host : 'Select a host…'}
                </span>
                <span className="shrink-0 text-xs text-muted-foreground">Change</span>
              </button>
            </div>

            {needsPassword && (
              <div className="flex flex-col gap-2">
                <Label htmlFor="copykey-password">Password</Label>
                <Input
                  id="copykey-password"
                  type="password"
                  autoFocus
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="This host has no saved credential"
                />
              </div>
            )}
          </div>
        )}

        {phase === 'connecting' && (
          <div className="flex flex-col items-center gap-4 py-4">
            <ProgressSteps steps={STEPS} currentIndex={Math.max(targetIndex, 0)} />
          </div>
        )}

        {phase === 'hostkey' && (
          <div className="flex flex-col items-center gap-3 py-2 text-center">
            <span
              className={`flex size-12 items-center justify-center rounded-full ${
                hostKeyInfo?.changed ? 'bg-destructive/10' : 'bg-primary/10'
              }`}
            >
              <ShieldAlert className={`size-6 ${hostKeyInfo?.changed ? 'text-destructive' : 'text-primary'}`} />
            </span>
            <p className="text-sm font-medium">
              {hostKeyInfo?.changed ? 'Host key has changed!' : 'Unknown host'}
            </p>
            <p className="max-w-sm text-xs text-muted-foreground">
              {hostKeyInfo?.changed
                ? 'Verify the fingerprint out-of-band before trusting it.'
                : "First time connecting to this host. Verify the fingerprint if you can."}
            </p>
            <div className="w-full rounded-md border bg-muted/40 px-3 py-2 text-left">
              <p className="break-all font-mono text-xs">SHA256:{hostKeyInfo?.fingerprint}</p>
            </div>
          </div>
        )}

        {phase === 'done' && (
          <div className="flex flex-col items-center gap-3 py-6 text-center">
            <span className="flex size-12 items-center justify-center rounded-full bg-emerald-500/10">
              <Check className="size-6 text-emerald-500" />
            </span>
            <p className="text-sm">Public key installed on {selectedHost?.label || selectedHost?.host}.</p>
          </div>
        )}

        {phase === 'error' && (
          <div className="flex flex-col items-center gap-3 py-6 text-center">
            <span className="flex size-12 items-center justify-center rounded-full bg-destructive/10">
              <TriangleAlert className="size-6 text-destructive" />
            </span>
            <p className="max-w-sm text-sm text-destructive">{error}</p>
          </div>
        )}
        </div>

        <DialogFooter>
          {phase === 'form' && (
            <Button onClick={startCopy} disabled={!hostId || (needsPassword && !password)}>
              <KeyRound className="size-4" /> Copy key
            </Button>
          )}
          {(phase === 'connecting' || phase === 'hostkey') && (
            <Button variant="outline" onClick={cancelConnecting}>
              Cancel
            </Button>
          )}
          {phase === 'hostkey' && (
            <>
              <Button variant="outline" onClick={() => respondHostKey(false)}>
                Reject
              </Button>
              <Button
                variant={hostKeyInfo?.changed ? 'destructive' : 'default'}
                onClick={() => respondHostKey(true)}
              >
                Trust & continue
              </Button>
            </>
          )}
          {phase === 'error' && (
            <>
              <Button variant="outline" onClick={() => onOpenChange(false)}>
                Close
              </Button>
              <Button onClick={startCopy}>
                <RotateCcw className="size-3.5" /> Retry
              </Button>
            </>
          )}
          {phase === 'done' && <Button onClick={() => onOpenChange(false)}>Done</Button>}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
