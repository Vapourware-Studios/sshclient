import { Loader2, Server, Unplug, X } from 'lucide-react';
import TerminalView from '@/components/TerminalView';
import {
  ConnectingView,
  ConnectErrorView,
  DisconnectedView,
  HostKeyPromptView,
} from '@/components/ConnectionStatus';
import { HostIcon } from '@/lib/host-icons.jsx';
import { toneForId, toneStyle } from '@/lib/tone';
import { usePrivacySettings } from '@/lib/privacy-settings.jsx';
import { isIpAddress } from '@/lib/ip';

/**
 * The dot on a member button says what its session is doing without the user
 * having to select it: a group opens several connections at once and some of
 * them will still be negotiating — or already dead — while another is usable.
 */
function MemberStatus({ status }) {
  if (status === 'connecting') {
    return <Loader2 className="size-3.5 shrink-0 animate-spin text-muted-foreground" />;
  }
  if (status === 'error') return <span className="size-1.5 shrink-0 rounded-full bg-destructive" />;
  if (status === 'disconnected') {
    return <Unplug className="size-3.5 shrink-0 text-muted-foreground" />;
  }
  return null;
}

function MemberButton({ tab, host, active, onSelect, onClose }) {
  const { blurHostIps } = usePrivacySettings();
  const address = host
    ? `${host.username ? `${host.username}@` : ''}${host.host}`
    : tab.connectConfig?.hostId
      ? ''
      : tab.title;

  return (
    <div
      onClick={onSelect}
      title={tab.title}
      className={`group flex w-full cursor-pointer items-center gap-2.5 rounded-md px-2.5 py-1.5 text-left text-sm ${
        active
          ? 'bg-sidebar-accent font-medium text-sidebar-accent-foreground'
          : 'text-muted-foreground hover:bg-sidebar-accent/50 hover:text-sidebar-foreground'
      }`}
    >
      <span
        className="flex size-7 shrink-0 items-center justify-center rounded-md"
        style={toneStyle(host?.color || toneForId(host?.id ?? tab.id))}
      >
        <HostIcon slug={host?.icon} fallback={Server} className="size-3.5" />
      </span>

      <span className="min-w-0 flex-1">
        <span
          className={`block truncate ${
            blurHostIps && isIpAddress(tab.title) ? 'blur-sensitive' : ''
          }`}
        >
          {tab.title}
        </span>
        {address && (
          <span
            className={`block truncate text-xs text-muted-foreground ${
              blurHostIps ? 'blur-sensitive' : ''
            }`}
          >
            {address}
          </span>
        )}
      </span>

      <MemberStatus status={tab.status} />

      <button
        onClick={(e) => {
          e.stopPropagation();
          onClose();
        }}
        title="Close this connection"
        aria-label={`Close ${tab.title}`}
        className="shrink-0 opacity-0 hover:text-destructive group-hover:opacity-100"
      >
        <X className="size-3.5" />
      </button>
    </div>
  );
}

/**
 * One tab holding every host a snippet was launched against. The strip on the
 * left switches between them; each one is a full session of its own, so the
 * terminals all stay mounted and keep receiving output while hidden.
 */
export default function SessionGroupView({
  group,
  members,
  hosts,
  sessionLogs,
  visible,
  onSelectMember,
  onCloseMember,
  onRetryTab,
  onRespondToHostKey,
}) {
  const activeMember = members.find((m) => m.id === group.activeMemberId) ?? members[0] ?? null;
  const hidden = visible ? '' : 'invisible pointer-events-none';

  return (
    <div className={`absolute inset-0 flex bg-background ${hidden}`}>
      <aside className="flex h-full w-56 shrink-0 flex-col border-r bg-sidebar text-sidebar-foreground">
        <div className="px-4 pt-4 pb-3">
          <p className="truncate text-sm font-medium leading-tight">{group.title}</p>
          <p className="text-xs text-muted-foreground">
            {members.length} connection{members.length === 1 ? '' : 's'}
          </p>
        </div>

        <nav className="flex flex-1 flex-col gap-0.5 overflow-y-auto border-t p-2">
          {members.map((tab) => (
            <MemberButton
              key={tab.id}
              tab={tab}
              host={hosts.find((h) => h.id === tab.connectConfig?.hostId) ?? null}
              active={activeMember?.id === tab.id}
              onSelect={() => onSelectMember(group.id, tab.id)}
              onClose={() => onCloseMember(tab.id)}
            />
          ))}
        </nav>
      </aside>

      <div className="relative min-w-0 flex-1">
        {members
          .filter((t) => t.status === 'connected')
          .map((tab) => (
            <TerminalView
              key={tab.id}
              sessionId={tab.id}
              kind={tab.type}
              active={visible && activeMember?.id === tab.id}
            />
          ))}

        {activeMember?.status === 'connecting' && activeMember.hostKeyInfo && (
          <HostKeyPromptView
            title={activeMember.title}
            info={activeMember.hostKeyInfo}
            onTrust={() => onRespondToHostKey(activeMember.id, true)}
            onReject={() => onRespondToHostKey(activeMember.id, false)}
          />
        )}

        {activeMember?.status === 'connecting' && !activeMember.hostKeyInfo && (
          <ConnectingView
            title={activeMember.title}
            stage={activeMember.stage}
            logs={sessionLogs[activeMember.id] ?? []}
            onCancel={() => onCloseMember(activeMember.id)}
          />
        )}

        {activeMember?.status === 'disconnected' && (
          <DisconnectedView
            title={activeMember.title}
            reason={activeMember.closeReason}
            message={activeMember.closeMessage}
            exitCode={activeMember.closeExitCode}
            logs={sessionLogs[activeMember.id] ?? []}
            onReconnect={() => onRetryTab(activeMember)}
            onClose={() => onCloseMember(activeMember.id)}
          />
        )}

        {activeMember?.status === 'error' && (
          <ConnectErrorView
            title={activeMember.title}
            message={activeMember.error}
            logs={sessionLogs[activeMember.id] ?? []}
            onRetry={() => onRetryTab(activeMember)}
            onClose={() => onCloseMember(activeMember.id)}
          />
        )}
      </div>
    </div>
  );
}
