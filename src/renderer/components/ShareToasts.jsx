import { X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { memberColor, useSharing } from '@/lib/sharing.jsx';

/**
 * What is happening on a shared terminal, said out loud: who joined, who left,
 * and who is asking for the keyboard. Joining a share needs no approval, so
 * the owner finding out immediately is the point of this.
 */
export default function ShareToasts() {
  const { toasts, dismissToast, grant } = useSharing();
  if (toasts.length === 0) return null;

  return (
    <div className="pointer-events-none fixed bottom-4 right-4 z-50 flex w-80 flex-col gap-2">
      {toasts.map((toast) => (
        <div
          key={toast.id}
          className="pointer-events-auto flex items-start gap-2 rounded-lg border bg-popover p-3 shadow-lg"
        >
          <span
            className="mt-1.5 size-2 shrink-0 rounded-full"
            style={{
              backgroundColor:
                toast.colorSlot === undefined
                  ? toast.tone === 'warn'
                    ? 'var(--destructive)'
                    : 'var(--muted-foreground)'
                  : memberColor(toast.colorSlot),
            }}
          />
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium">{toast.title}</p>
            {toast.body && <p className="mt-0.5 text-xs text-muted-foreground">{toast.body}</p>}
            {toast.action && (
              <div className="mt-2 flex gap-2">
                <Button
                  size="xs"
                  onClick={() => {
                    grant(toast.action.sessionId, toast.action.memberId);
                    dismissToast(toast.id);
                  }}
                >
                  {toast.action.label}
                </Button>
                <Button size="xs" variant="ghost" onClick={() => dismissToast(toast.id)}>
                  Not now
                </Button>
              </div>
            )}
          </div>
          <button
            onClick={() => dismissToast(toast.id)}
            title="Dismiss"
            className="shrink-0 rounded-md p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
          >
            <X className="size-3.5" />
          </button>
        </div>
      ))}
    </div>
  );
}
