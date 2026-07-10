import { Button } from '@/components/ui/button';
import { Loader2, Server, ShieldAlert, TriangleAlert, X } from 'lucide-react';

const STAGE_LABEL = {
  connecting: 'Connecting…',
  handshake: 'Negotiating encryption…',
};

export function ConnectingView({ title, stage, onCancel }) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-5 text-center">
      <div className="relative flex size-16 items-center justify-center">
        <span className="absolute inset-0 animate-spin rounded-full border-2 border-primary/25 border-t-primary" />
        <Server className="size-6 animate-pulse text-primary" />
      </div>

      <div className="flex flex-col gap-1">
        <p className="text-sm font-medium">{title}</p>
        <p className="flex items-center justify-center gap-1 text-xs text-muted-foreground">
          {STAGE_LABEL[stage] || STAGE_LABEL.connecting}
          <span className="inline-flex">
            <span className="animate-bounce [animation-delay:0ms]">.</span>
            <span className="animate-bounce [animation-delay:150ms]">.</span>
            <span className="animate-bounce [animation-delay:300ms]">.</span>
          </span>
        </p>
      </div>

      <Button variant="outline" size="sm" onClick={onCancel}>
        <X className="size-3.5" /> Cancel
      </Button>
    </div>
  );
}

export function HostKeyPromptView({ title, info, onTrust, onReject }) {
  const changed = info?.changed;

  return (
    <div className="flex h-full flex-col items-center justify-center gap-4 px-6 text-center">
      <div
        className={`flex size-16 items-center justify-center rounded-full ${
          changed ? 'bg-destructive/10' : 'bg-primary/10'
        }`}
      >
        <ShieldAlert className={`size-7 ${changed ? 'text-destructive' : 'text-primary'}`} />
      </div>

      <div className="flex w-full max-w-sm flex-col gap-1">
        <p className="text-sm font-medium">
          {changed ? `Host key for ${title} has changed!` : `Unknown host: ${title}`}
        </p>
        <p className="text-xs text-muted-foreground">
          {changed
            ? "This could mean someone is intercepting your connection, or the server was rebuilt. Verify the fingerprint out-of-band before trusting it."
            : "This is the first time you're connecting to this host. Verify the fingerprint out-of-band if possible."}
        </p>
        <p className="mt-2 break-all font-mono text-xs text-muted-foreground">
          SHA256:{info?.fingerprint}
        </p>
        {changed && (
          <p className="break-all font-mono text-xs text-muted-foreground/70">
            was SHA256:{info?.previousFingerprint}
          </p>
        )}
      </div>

      <div className="flex gap-2">
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

export function ConnectErrorView({ title, message, onRetry, onClose }) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-4 px-6 text-center">
      <div className="flex size-16 items-center justify-center rounded-full bg-destructive/10">
        <TriangleAlert className="size-7 text-destructive" />
      </div>

      <div className="flex flex-col gap-1">
        <p className="text-sm font-medium">Couldn't connect to {title}</p>
        <p className="max-w-sm text-xs text-muted-foreground">{message}</p>
      </div>

      <div className="flex gap-2">
        <Button variant="outline" size="sm" onClick={onClose}>
          Close
        </Button>
        <Button size="sm" onClick={onRetry}>
          <Loader2 className="size-3.5" /> Retry
        </Button>
      </div>
    </div>
  );
}
