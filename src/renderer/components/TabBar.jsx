import { useEffect, useState } from 'react';
import { Terminal as TerminalIcon, X, Loader2, Home, Plus, Folder } from 'lucide-react';
import { Separator } from '@/components/ui/separator';
import { useGlassSettings, glassAlpha } from '@/lib/glass-settings.jsx';

const NO_DRAG = { WebkitAppRegion: 'no-drag' };

const CONSTANT_TAB_ICONS = { vault: Home, sftp: Folder };

const IS_MAC = window.api?.platform === 'darwin';

function Tab({ active, onClick, children }) {
  return (
    <div
      onClick={onClick}
      style={NO_DRAG}
      className={`flex h-8 shrink-0 cursor-pointer items-center gap-2 rounded-md px-3 text-sm ${
        active
          ? 'border bg-background text-foreground'
          : 'text-muted-foreground hover:bg-background/50 hover:text-foreground'
      }`}
    >
      {children}
    </div>
  );
}

export default function TabBar({ tabs, activeTabId, onSelectTab, onCloseTab, onNewConnection }) {
  const [fullScreen, setFullScreen] = useState(false);
  const { enabled, intensity } = useGlassSettings();
  const barAlpha = glassAlpha(enabled, intensity, 0.55, 0);

  useEffect(() => {
    if (!IS_MAC || typeof window.api.onFullScreenChange !== 'function') return;
    let alive = true;
    window.api.windowIsFullScreen().then((fs) => {
      if (alive) setFullScreen(Boolean(fs));
    });
    const unsub = window.api.onFullScreenChange((payload) => setFullScreen(payload.fullScreen));
    return () => {
      alive = false;
      unsub();
    };
  }, []);

  return (
    <div
      className={`flex h-11 shrink-0 items-center gap-1 border-b pr-3 transition-[padding] duration-200 ease-[cubic-bezier(0.22,1,0.36,1)] ${
        IS_MAC && !fullScreen ? 'pl-24' : 'pl-3'
      }`}
      style={{
        WebkitAppRegion: 'drag',
        backgroundColor: `color-mix(in oklch, var(--muted) ${barAlpha * 100}%, transparent)`,
      }}
    >
      {tabs.filter((t) => t.constant).map((tab) => {
        const Icon = CONSTANT_TAB_ICONS[tab.id] ?? Home;
        return (
          <Tab key={tab.id} active={tab.id === activeTabId} onClick={() => onSelectTab(tab.id)}>
            <Icon className="size-3.5 shrink-0" />
            <span className="max-w-32 truncate">{tab.title}</span>
          </Tab>
        );
      })}

      <Separator orientation="vertical" className="shrink-0" />

      <div className="no-scrollbar flex min-w-0 flex-1 items-center gap-1 self-stretch overflow-x-auto py-1.5">
        {tabs.filter((t) => !t.constant).map((tab) => (
          <Tab key={tab.id} active={tab.id === activeTabId} onClick={() => onSelectTab(tab.id)}>
            {tab.status === 'connecting' ? (
              <Loader2 className="size-3.5 shrink-0 animate-spin text-muted-foreground" />
            ) : tab.status === 'error' ? (
              <span className="size-1.5 shrink-0 rounded-full bg-destructive" />
            ) : (
              <span className="size-1.5 shrink-0 rounded-full bg-emerald-500" />
            )}

            <span className="max-w-32 truncate">{tab.title}</span>
            <X
              className="size-3.5 shrink-0 hover:text-destructive"
              onClick={(e) => {
                e.stopPropagation();
                onCloseTab(tab.id);
              }}
            />
          </Tab>
        ))}
      </div>

      <button
        onClick={onNewConnection}
        title="New connection"
        style={NO_DRAG}
        className="flex size-8 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-background/50 hover:text-foreground"
      >
        <Plus className="size-4" />
      </button>

      {/* <div className="ml-auto flex items-center gap-2" style={NO_DRAG}>
        <TerminalIcon className="size-4" />
        <h1 className="text-sm font-semibold tracking-widest">SSH CLIENT</h1>
        </div> */}
    </div>
  );
}
