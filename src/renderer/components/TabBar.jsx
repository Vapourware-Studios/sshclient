import { useEffect, useState } from 'react';
import { X, Loader2, Home, Plus, Folder, Minus, Square, Copy } from 'lucide-react';
import { Separator } from '@/components/ui/separator';
import { useGlassSettings, glassAlpha } from '@/lib/glass-settings.jsx';
import { usePrivacySettings } from '@/lib/privacy-settings.jsx';
import { isIpAddress } from '@/lib/ip';

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

function WindowControls() {
  const [maximized, setMaximized] = useState(false);

  useEffect(() => {
    if (typeof window.api?.onMaximizedChange !== 'function') return;
    let alive = true;
    window.api.windowIsMaximized().then((m) => {
      if (alive) setMaximized(Boolean(m));
    });
    const unsub = window.api.onMaximizedChange((payload) => setMaximized(payload.maximized));
    return () => {
      alive = false;
      unsub();
    };
  }, []);

  return (
    <div className="flex h-full shrink-0 items-stretch self-stretch" style={NO_DRAG}>
      <button
        onClick={() => window.api.windowMinimize()}
        title="Minimize"
        className="flex w-11 items-center justify-center text-muted-foreground hover:bg-background/60 hover:text-foreground"
      >
        <Minus className="size-3.5" />
      </button>
      <button
        onClick={() => window.api.windowMaximizeToggle()}
        title={maximized ? 'Restore' : 'Maximize'}
        className="flex w-11 items-center justify-center text-muted-foreground hover:bg-background/60 hover:text-foreground"
      >
        {maximized ? (
          <Copy className="size-3 -scale-x-100" />
        ) : (
          <Square className="size-3" />
        )}
      </button>
      <button
        onClick={() => window.api.windowClose()}
        title="Close"
        className="flex w-11 items-center justify-center text-muted-foreground hover:bg-red-500/90 hover:text-white"
      >
        <X className="size-4" />
      </button>
    </div>
  );
}

export default function TabBar({ tabs, activeTabId, onSelectTab, onCloseTab, onNewConnection }) {
  const [fullScreen, setFullScreen] = useState(false);
  const { enabled, intensity } = useGlassSettings();
  const barAlpha = glassAlpha(enabled, intensity, 1, 0);
  const { blurHostIps } = usePrivacySettings();

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
      className={`flex h-11 shrink-0 items-center gap-1 border-b transition-[padding] duration-200 ease-[cubic-bezier(0.22,1,0.36,1)] ${
        IS_MAC && !fullScreen ? 'pl-24' : 'pl-3'
      } ${IS_MAC ? 'pr-3' : 'pr-0'}`}
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

            <span
              className={`max-w-32 truncate ${blurHostIps && isIpAddress(tab.title) ? 'blur-sensitive' : ''}`}
            >
              {tab.title}
            </span>
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

      {!IS_MAC && <WindowControls />}
    </div>
  );
}
