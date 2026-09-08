import TerminalView from '@/components/TerminalView';
import VaultView from '@/components/VaultView';
import SftpHub from '@/components/SftpHub';
import SessionGroupView from '@/components/SessionGroupView';
import ShareViewerBar from '@/components/ShareViewerBar';
import {
  ConnectingView,
  ConnectErrorView,
  DisconnectedView,
  HostKeyPromptView,
  PasswordPromptView,
} from '@/components/ConnectionStatus';

export default function ContentArea({
  tabs,
  activeTabId,
  sessionLogs,
  hosts,
  onCloseTab,
  onRetryTab,
  onRespondToHostKey,
  onRespondToPassword,
  onConnect,
  onEdit,
  onDelete,
  onDuplicate,
  onNewConnection,
  onLockVault,
  onOpenLocalTerminal,
  onPlayRecording,
  onRunOnHost,
  onConnectAndStartForward,
  onHostsChange,
  onRunSnippetOnHosts,
  onSelectGroupMember,
}) {
  const activeTab = tabs.find((t) => t.id === activeTabId) || null;
  const statusTab = activeTab?.type === 'group' ? null : activeTab;

  return (
    <div className="relative min-w-0 flex-1">
      <VaultView
        hosts={hosts}
        onConnect={onConnect}
        onEdit={onEdit}
        onDelete={onDelete}
        onDuplicate={onDuplicate}
        onNewConnection={onNewConnection}
        onLockVault={onLockVault}
        onOpenLocalTerminal={onOpenLocalTerminal}
        onPlayRecording={onPlayRecording}
        onRunOnHost={onRunOnHost}
        onConnectAndStartForward={onConnectAndStartForward}
        onHostsChange={onHostsChange}
        onRunSnippetOnHosts={onRunSnippetOnHosts}
        tabs={tabs}
        visible={activeTab?.id === 'vault'}
      />

      <SftpHub hosts={hosts} visible={activeTab?.id === 'sftp'} />

      {tabs
        .filter((t) => t.type === 'group')
        .map((group) => (
          <SessionGroupView
            key={group.id}
            group={group}
            members={tabs.filter((t) => t.groupId === group.id)}
            hosts={hosts}
            sessionLogs={sessionLogs}
            visible={group.id === activeTabId}
            onSelectMember={onSelectGroupMember}
            onCloseMember={onCloseTab}
            onRetryTab={onRetryTab}
            onRespondToHostKey={onRespondToHostKey}
            onRespondToPassword={onRespondToPassword}
          />
        ))}

      {/* Sessions that belong to a group are drawn inside it, not out here. */}
      {tabs
        .filter((t) => t.status === 'connected' && t.type !== 'group' && !t.groupId)
        .map((tab) =>
          tab.type === 'shared' ? (
            <div
              key={tab.id}
              className={`absolute inset-0 flex flex-col bg-background ${
                tab.id === activeTabId ? '' : 'invisible pointer-events-none'
              }`}
            >
              <ShareViewerBar shareId={tab.id} />
              <div className="relative min-h-0 flex-1">
                <TerminalView sessionId={tab.id} kind="shared" active={tab.id === activeTabId} />
              </div>
            </div>
          ) : (
            <TerminalView
              key={tab.id}
              sessionId={tab.id}
              kind={tab.type}
              active={tab.id === activeTabId}
              recording={tab.recording}
            />
          )
        )}

      {statusTab?.status === 'connecting' && statusTab.hostKeyInfo && (
        <HostKeyPromptView
          title={statusTab.title}
          info={statusTab.hostKeyInfo}
          onTrust={() => onRespondToHostKey(statusTab.id, true)}
          onReject={() => onRespondToHostKey(statusTab.id, false)}
        />
      )}

      {statusTab?.status === 'connecting' && !statusTab.hostKeyInfo && statusTab.passwordPrompt && (
        <PasswordPromptView
          title={statusTab.title}
          info={statusTab.passwordPrompt}
          onSubmit={(password) => onRespondToPassword(statusTab.id, password)}
          onCancel={() => onRespondToPassword(statusTab.id, null)}
        />
      )}

      {statusTab?.status === 'connecting' && !statusTab.hostKeyInfo && !statusTab.passwordPrompt && (
        <ConnectingView
          title={statusTab.title}
          stage={statusTab.stage}
          logs={sessionLogs[statusTab.id] ?? []}
          onCancel={() => onCloseTab(statusTab.id)}
        />
      )}

      {statusTab?.status === 'disconnected' && (
        <DisconnectedView
          title={statusTab.title}
          reason={statusTab.closeReason}
          message={statusTab.closeMessage}
          exitCode={statusTab.closeExitCode}
          logs={sessionLogs[statusTab.id] ?? []}
          onReconnect={() => onRetryTab(statusTab)}
          onClose={() => onCloseTab(statusTab.id)}
        />
      )}

      {statusTab?.status === 'error' && (
        <ConnectErrorView
          title={statusTab.title}
          message={statusTab.error}
          logs={sessionLogs[statusTab.id] ?? []}
          onRetry={() => onRetryTab(statusTab)}
          onClose={() => onCloseTab(statusTab.id)}
        />
      )}
    </div>
  );
}
