import { Eye, Keyboard, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { memberColor, useSharing } from '@/lib/sharing.jsx';

/**
 * The strip above a terminal somebody else is driving: who else is here,
 * whether you may type, and how to ask if you may not.
 */
export default function ShareViewerBar({ shareId }) {
  const { viewing, requestControl, releaseControl, isTyping } = useSharing();
  const state = viewing[shareId];
  if (!state) return null;

  const owner = state.members.find((m) => m.role === 'owner');
  const others = state.members.filter((m) => m.id !== state.memberId);

  return (
    <div className="flex h-9 shrink-0 items-center gap-2 border-b px-3 text-xs">
      {state.status === 'watching' ? (
        <Eye className="size-3.5 shrink-0 text-muted-foreground" />
      ) : (
        <Loader2 className="size-3.5 shrink-0 animate-spin text-muted-foreground" />
      )}

      <span className="truncate text-muted-foreground">
        {state.status === 'reconnecting'
          ? 'Reconnecting…'
          : state.canType
            ? 'You have the keyboard'
            : `Watching ${owner ? owner.name : 'a shared terminal'}`}
      </span>

      <div className="ml-auto flex items-center gap-1.5">
        {others.map((member) => (
          <span
            key={member.id}
            title={`${member.name}${member.role === 'owner' ? ' (owner)' : ''}`}
            className={`size-2 rounded-full ${isTyping(shareId, member.id) ? 'animate-pulse' : ''}`}
            style={{ backgroundColor: memberColor(member.color) }}
          />
        ))}

        {state.canType ? (
          <Button size="xs" variant="secondary" onClick={() => releaseControl(shareId)}>
            <Keyboard className="size-3" /> Hand back
          </Button>
        ) : (
          <Button
            size="xs"
            variant="ghost"
            disabled={state.baton !== null}
            onClick={() => requestControl(shareId)}
          >
            <Keyboard className="size-3" />
            {state.baton !== null ? 'Someone else is typing' : 'Ask to type'}
          </Button>
        )}
      </div>
    </div>
  );
}
