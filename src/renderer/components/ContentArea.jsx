import { Fragment } from 'react';
import TerminalView from '@/components/TerminalView';
import SftpView from '@/components/SftpView';
import { ConnectingView, ConnectErrorView, HostKeyPromptView } from '@/components/ConnectionStatus';

export default function ContentArea({
  tabs,
  activeTabId,
  sessionLogs,
  onCloseTab,
  onRetryTab,
  onRespondToHostKey,
}) {
  const activeTab = tabs.find((t) => t.id === activeTabId) || null;

  return (
    <div className="relative flex-1 bg-[#0d1117]">
      {tabs.length === 0 && (
        <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
          No active sessions — connect to a host to get started.
        </div>
      )}

      {tabs
        .filter((t) => t.status === 'connected')
        .map((tab) => (
          <Fragment key={tab.id}>
            <TerminalView
              sessionId={tab.id}
              active={tab.id === activeTabId && (tab.view ?? 'terminal') === 'terminal'}
            />
            {tab.sftpOpened && (
              <SftpView
                sessionId={tab.id}
                visible={tab.id === activeTabId && tab.view === 'files'}
              />
            )}
          </Fragment>
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
