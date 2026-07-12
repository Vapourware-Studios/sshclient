import TerminalView from '@/components/TerminalView';
import LocalTerminalView from '@/components/LocalTerminalView';
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
  onNewConnection,
  onLockVault,
  onOpenLocalTerminal,
}) {
  const activeTab = tabs.find((t) => t.id === activeTabId) || null;

  return (
    <div className="relative min-w-0 flex-1">
      {activeTab?.id === 'vault' && (
        <VaultView
          hosts={hosts}
          onConnect={onConnect}
          onEdit={onEdit}
          onDelete={onDelete}
          onNewConnection={onNewConnection}
          onLockVault={onLockVault}
          onOpenLocalTerminal={onOpenLocalTerminal}
        />
      )}

      <SftpHub hosts={hosts} visible={activeTab?.id === 'sftp'} />

      {tabs
        .filter((t) => t.status === 'connected' && t.kind !== 'local')
        .map((tab) => (
          <TerminalView
            key={tab.id}
            sessionId={tab.id}
            kind={tab.type}
            active={tab.id === activeTabId}
          />
        ))}

      {tabs
        .filter((t) => t.status === 'connected' && t.kind === 'local')
        .map((tab) => (
          <LocalTerminalView key={tab.id} sessionId={tab.id} active={tab.id === activeTabId} />
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
