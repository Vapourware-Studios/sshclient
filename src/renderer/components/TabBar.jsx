import { Terminal as TerminalIcon, X, Loader2, Folder } from 'lucide-react';

export default function TabBar({ tabs, activeTabId, onSelectTab, onCloseTab, onViewChange }) {
  const activeTab = tabs.find((t) => t.id === activeTabId) || null;

  return (
    <div className="flex items-center gap-1 border-b bg-muted/40 px-2">
      {tabs.map((tab) => (
        <div
          key={tab.id}
          onClick={() => onSelectTab(tab.id)}
          className={`flex cursor-pointer items-center gap-2 rounded-t-md border-x border-t px-3 py-1.5 text-sm ${
            tab.id === activeTabId
              ? 'border-border bg-background'
              : 'border-transparent text-muted-foreground hover:text-foreground'
          }`}
        >
          {!tab.constant && (
              tab.status === 'connecting' ? (
                <Loader2 className="size-3.5 shrink-0 animate-spin text-muted-foreground" />
              ) : tab.status === 'error' ? (
                <span className="size-1.5 shrink-0 rounded-full bg-destructive" />
              ) : (
                <span className="size-1.5 shrink-0 rounded-full bg-emerald-500" />
              )
          )}

          <span className="max-w-32 truncate">{tab.title}</span>
          {!tab.constant && (
            <X
              className="size-3.5 hover:text-destructive"
              onClick={(e) => { e.stopPropagation(); onCloseTab(tab.id); }}
            />
          )}
        </div>
      ))}

      {activeTab?.status === 'connected' && (
        <div className="ml-auto flex items-center gap-0.5 py-1">
          {[
            { id: 'terminal', label: 'Terminal', Icon: TerminalIcon },
            { id: 'files', label: 'Files', Icon: Folder },
          ].map(({ id, label, Icon }) => (
            <button
              key={id}
              onClick={() => onViewChange(activeTab.id, id)}
              className={`flex items-center gap-1.5 rounded-md px-2 py-1 text-xs ${
                (activeTab.view ?? 'terminal') === id
                  ? 'border bg-background text-foreground'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              <Icon className="size-3.5" /> {label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
