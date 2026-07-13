import TerminalView from '@/components/TerminalView';
import VaultView from '@/components/VaultView';
import SftpHub from '@/components/SftpHub';
import { ConnectingView, ConnectErrorView, HostKeyPromptView } from '@/components/ConnectionStatus';

export default function ContentArea({
  tabs,
  activeTabId,
  sessionLogs,
  hosts,
  onCloseTab,
  onRetryTab,
  onRespondToHostKey,
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
}) {
  const activeTab = tabs.find((t) => t.id === activeTabId) || null;

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
        tabs={tabs}
        visible={activeTab?.id === 'vault'}
      />

      <SftpHub hosts={hosts} visible={activeTab?.id === 'sftp'} />

      {tabs
        .filter((t) => t.status === 'connected')
        .map((tab) => (
          <TerminalView
            key={tab.id}
            sessionId={tab.id}
            kind={tab.type}
            active={tab.id === activeTabId}
            recording={tab.recording}
          />
        ))}

      {activeTab?.status === 'connecting' && activeTab.hostKeyInfo && (
        <HostKeyPromptView
          title={activeTab.title}
          info={activeTab.hostKeyInfo}
          onTrust={() => onRespondToHostKey(activeTab.id, true)}
          onReject={() => onRespondToHostKey(activeTab.id, false)}
        />
      )}

      {activeTab?.status === 'connecting' && !activeTab.hostKeyInfo && (
        <ConnectingView
          title={activeTab.title}
          stage={activeTab.stage}
          logs={sessionLogs[activeTab.id] ?? []}
          onCancel={() => onCloseTab(activeTab.id)}
        />
      )}

      {activeTab?.status === 'error' && (
        <ConnectErrorView
          title={activeTab.title}
          message={activeTab.error}
          logs={sessionLogs[activeTab.id] ?? []}
          onRetry={() => onRetryTab(activeTab)}
          onClose={() => onCloseTab(activeTab.id)}
        />
      )}
    </div>
  );
}
