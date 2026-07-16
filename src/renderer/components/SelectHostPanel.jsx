import { useMemo, useState } from 'react';
import { ArrowLeft, Plus, Search, Server, Terminal } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { toneForId, toneStyle } from '@/lib/tone';
import { HostIcon } from '@/lib/host-icons.jsx';
import { usePrivacySettings } from '@/lib/privacy-settings.jsx';

function hostAddress(host) {
  return `${host.username ? `${host.username}@` : ''}${host.host}${
    host.port && host.port !== 22 ? `:${host.port}` : ''
  }`;
}

export default function SelectHostPanel({
  title = 'Select host',
  subtitle,
  hosts,
  sessions = [],
  selectedId,
  onSelect,
  onBack,
  onNewHost,
}) {
  const [query, setQuery] = useState('');
  const q = query.trim().toLowerCase();
  const { blurHostIps } = usePrivacySettings();

  const filteredSessions = useMemo(
    () => sessions.filter((s) => !q || s.title.toLowerCase().includes(q)),
    [sessions, q]
  );
  const filteredHosts = useMemo(
    () =>
      hosts.filter(
        (h) => !q || [h.label, h.host, h.username].some((v) => v && v.toLowerCase().includes(q))
      ),
    [hosts, q]
  );

  return (
    <div className="flex h-full flex-col animate-slide-in-right">
      <div className="flex items-start gap-3 border-b p-4">
        <button
          type="button"
          onClick={onBack}
          title="Back"
          className="mt-0.5 shrink-0 rounded-md p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
        >
          <ArrowLeft className="size-4" />
        </button>
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold">{title}</p>
          {subtitle && <p className="mt-0.5 truncate text-xs text-muted-foreground">{subtitle}</p>}
        </div>
      </div>

      <div className="flex items-center gap-2 border-b p-3">
        {onNewHost && (
          <Button type="button" size="sm" variant="outline" onClick={onNewHost} className="shrink-0">
            <Plus className="size-3.5" /> New host
          </Button>
        )}
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search"
            className="h-8 pl-8 text-sm"
          />
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-3">
        {filteredSessions.length === 0 && filteredHosts.length === 0 ? (
          <p className="px-2 py-8 text-center text-sm text-muted-foreground">No matches</p>
        ) : (
          <>
            {filteredSessions.length > 0 && (
              <>
                <p className="px-2 pb-1.5 text-sm font-semibold">Connected</p>
                <div className="flex flex-col gap-0.5 pb-3">
                  {filteredSessions.map((tab) => (
                    <button
                      key={tab.id}
                      type="button"
                      onClick={() => onSelect({ kind: 'session', id: tab.id, label: tab.title })}
                      className={`flex items-center gap-3 rounded-lg px-2 py-2 text-left text-sm transition-colors ${
                        selectedId === `session:${tab.id}` ? 'bg-accent' : 'hover:bg-accent/50'
                      }`}
                    >
                      <span
                        className="flex size-10 shrink-0 items-center justify-center rounded-lg"
                        style={toneStyle(toneForId(tab.id))}
                      >
                        <Terminal className="size-4" />
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="truncate font-medium">{tab.title}</p>
                        <p className="truncate text-xs text-muted-foreground">connected</p>
                      </div>
                    </button>
                  ))}
                </div>
              </>
            )}

            {filteredHosts.length > 0 && (
              <>
                <p className="px-2 pb-1.5 text-sm font-semibold">Hosts</p>
                <div className="flex flex-col gap-0.5">
                  {filteredHosts.map((host) => (
                    <button
                      key={host.id}
                      type="button"
                      onClick={() =>
                        onSelect({ kind: 'host', id: host.id, label: host.label || host.host })
                      }
                      className={`flex items-center gap-3 rounded-lg px-2 py-2 text-left text-sm transition-colors ${
                        selectedId === `host:${host.id}` ? 'bg-accent' : 'hover:bg-accent/50'
                      }`}
                    >
                      <span
                        className="flex size-10 shrink-0 items-center justify-center rounded-lg"
                        style={toneStyle(host.color || toneForId(host.id))}
                      >
                        <HostIcon slug={host.icon} fallback={Server} className="size-4" />
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="truncate font-medium">{host.label || host.host}</p>
                        <p
                          className={`truncate text-xs text-muted-foreground ${blurHostIps ? 'blur-sensitive' : ''}`}
                        >
                          ssh · {hostAddress(host)}
                        </p>
                      </div>
                    </button>
                  ))}
                </div>
              </>
            )}
          </>
        )}
      </div>
    </div>
  );
}
