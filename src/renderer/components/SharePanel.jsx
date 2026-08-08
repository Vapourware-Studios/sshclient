import { useEffect, useState } from 'react';
import { Check, Copy, Keyboard, Link2, Loader2, UserMinus, Users } from 'lucide-react';
import { PanelHeader } from '@/components/SlidePanel';
import { Button } from '@/components/ui/button';
import { memberColor, useIsTyping, useSharing } from '@/lib/sharing.jsx';

function Dot({ slot, sessionId, memberId }) {
  const typing = useIsTyping(sessionId, memberId);
  return (
    <span
      className={`size-2 shrink-0 rounded-full ${typing ? 'animate-pulse' : ''}`}
      style={{ backgroundColor: memberColor(slot) }}
    />
  );
}

/**
 * The owner's side of a shared terminal: the link to hand out, who is watching
 * right now, and who currently holds the keyboard.
 */
export default function SharePanel({ tab, onClose }) {
  const { shares, start, stop, grant, revoke, kick } = useSharing();
  const share = tab ? shares[tab.id] : null;
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 2000);
    return () => clearTimeout(timer);
  }, [copied]);

  async function beginShare() {
    setStarting(true);
    setError('');
    const result = await start(tab.id, tab.type);
    if (result?.error) setError(result.error);
    setStarting(false);
  }

  async function copyLink() {
    await navigator.clipboard.writeText(share.link);
    setCopied(true);
  }

  const viewers = (share?.members ?? []).filter((m) => m.role === 'viewer');

  return (
    <div className="flex h-full flex-col">
      <PanelHeader
        title="Share this terminal"
        description={tab?.title}
        onClose={onClose}
      />

      {!share ? (
        <div className="flex flex-col gap-3 p-4">
          <p className="text-sm text-muted-foreground">
            Hand out a link and your team can watch this terminal live. They
            watch only — nobody types until you hand them the keyboard.
          </p>
          <p className="text-xs text-muted-foreground">
            Everything they see is encrypted on this machine. The key travels in
            the link itself, so the relay never sees what your terminal says —
            but anyone with the link can watch, so send it like you'd send the
            shell.
          </p>
          {error && <p className="text-sm text-destructive">{error}</p>}
          <Button onClick={beginShare} disabled={starting || !tab}>
            {starting ? <Loader2 className="size-4 animate-spin" /> : <Link2 className="size-4" />}
            Start sharing
          </Button>
        </div>
      ) : (
        <div className="flex min-h-0 flex-1 flex-col">
          <div className="flex flex-col gap-2 border-b p-4">
            <div className="flex items-center gap-2">
              <span
                className={`size-2 shrink-0 rounded-full ${
                  share.status === 'live'
                    ? 'bg-emerald-500'
                    : share.status === 'error'
                      ? 'bg-destructive'
                      : 'animate-pulse bg-amber-500'
                }`}
              />
              <p className="text-sm font-medium">
                {share.status === 'live'
                  ? 'Live'
                  : share.status === 'error'
                    ? share.error || 'Not connected'
                    : share.status === 'reconnecting'
                      ? 'Reconnecting…'
                      : 'Connecting…'}
              </p>
              <p className="ml-auto text-xs text-muted-foreground">
                {viewers.length}/{share.maxViewers ?? 8} watching
              </p>
            </div>

            <div className="flex items-center gap-2">
              <code className="min-w-0 flex-1 truncate rounded-md border bg-muted/50 px-2 py-1.5 text-xs">
                {share.link}
              </code>
              <button
                onClick={copyLink}
                title="Copy link"
                className="shrink-0 rounded-md border p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground"
              >
                {copied ? <Check className="size-4 text-emerald-500" /> : <Copy className="size-4" />}
              </button>
            </div>
            <p className="text-xs text-muted-foreground">
              The part after the <code>#</code> is the key. A link without it
              opens nothing.
            </p>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto p-2">
            {viewers.length === 0 ? (
              <p className="flex items-center gap-2 px-2 py-4 text-sm text-muted-foreground">
                <Users className="size-4" /> Nobody watching yet.
              </p>
            ) : (
              viewers.map((member) => {
                const holdsKeyboard = share.baton === member.id;
                return (
                  <div
                    key={member.id}
                    className="flex items-center gap-2 rounded-md px-2 py-2 hover:bg-accent/50"
                  >
                    <Dot slot={member.color} sessionId={share.sessionId} memberId={member.id} />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm">{member.name}</p>
                      <p className="truncate text-xs text-muted-foreground">
                        {holdsKeyboard ? 'typing allowed' : 'watching'} · {member.user_ref}
                      </p>
                    </div>
                    <button
                      onClick={() =>
                        holdsKeyboard ? revoke(share.sessionId) : grant(share.sessionId, member.id)
                      }
                      title={holdsKeyboard ? 'Take the keyboard back' : 'Let them type'}
                      className={`shrink-0 rounded-md p-1.5 ${
                        holdsKeyboard
                          ? 'bg-accent text-foreground'
                          : 'text-muted-foreground hover:bg-accent hover:text-foreground'
                      }`}
                    >
                      <Keyboard className="size-4" />
                    </button>
                    <button
                      onClick={() => kick(share.sessionId, member.id)}
                      title="Remove"
                      className="shrink-0 rounded-md p-1.5 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                    >
                      <UserMinus className="size-4" />
                    </button>
                  </div>
                );
              })
            )}
          </div>

          <div className="border-t p-4">
            <Button variant="destructive" className="w-full" onClick={() => stop(share.sessionId)}>
              Stop sharing
            </Button>
            <p className="mt-2 text-xs text-muted-foreground">
              Everyone is disconnected and the link stops working.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
