import { useMemo, useState } from 'react';
import Sidebar from '@/components/Sidebar';
import KeychainView from '@/components/KeychainView';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Search, Plus, Server, Pencil, Trash2, ChevronRight } from 'lucide-react';

function HostRow({ host, onConnect, onEdit, onDelete }) {
  const address = `${host.username ? `${host.username}@` : ''}${host.host}${
    host.port && host.port !== 22 ? `:${host.port}` : ''
  }`;

  return (
    <div
      onClick={() => onConnect(host)}
      className="group flex cursor-pointer items-center gap-3 rounded-lg px-3 py-2 hover:bg-accent"
    >
      <span className="flex size-9 shrink-0 items-center justify-center rounded-lg border bg-muted text-muted-foreground">
        <Server className="size-4" />
      </span>

      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium">{host.label || host.host}</p>
        <p className="truncate text-xs text-muted-foreground">{address}</p>
      </div>

      <div className="hidden shrink-0 items-center gap-1 group-hover:flex">
        <button
          onClick={(e) => {
            e.stopPropagation();
            onEdit(host);
          }}
          title="Edit host"
          className="rounded-md p-1.5 text-muted-foreground hover:bg-background hover:text-foreground"
        >
          <Pencil className="size-3.5" />
        </button>
        <button
          onClick={(e) => {
            e.stopPropagation();
            onDelete(host);
          }}
          title="Delete host"
          className="rounded-md p-1.5 text-muted-foreground hover:bg-background hover:text-destructive"
        >
          <Trash2 className="size-3.5" />
        </button>
      </div>

      <ChevronRight className="size-4 shrink-0 text-muted-foreground opacity-0 group-hover:opacity-100" />
    </div>
  );
}

function HostsPanel({ hosts, onConnect, onEdit, onDelete, onNewConnection }) {
  const [query, setQuery] = useState('');

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return hosts;
    return hosts.filter((h) =>
      [h.label, h.host, h.username].some((v) => v && v.toLowerCase().includes(q))
    );
  }, [hosts, query]);

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-3 border-b px-4 py-3">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Find a host or ssh user@hostname…"
            className="pl-8"
          />
        </div>
        <Button onClick={onNewConnection} className="shrink-0">
          <Plus className="size-4" /> New Host
        </Button>
      </div>

      <div className="flex-1 overflow-y-auto p-4">
        {hosts.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-3 text-center">
            <span className="flex size-12 items-center justify-center rounded-xl border bg-muted text-muted-foreground">
              <Server className="size-6" />
            </span>
            <div>
              <p className="text-sm font-medium">No hosts yet</p>
              <p className="text-sm text-muted-foreground">
                Add your first host to connect over SSH.
              </p>
            </div>
            <Button size="sm" onClick={onNewConnection}>
              <Plus className="size-4" /> New Host
            </Button>
          </div>
        ) : (
          <>
            <p className="px-3 pb-2 text-xs font-medium uppercase tracking-wider text-muted-foreground">
              Hosts — {filtered.length}
            </p>
            <div className="flex flex-col gap-0.5">
              {filtered.map((host) => (
                <HostRow
                  key={host.id}
                  host={host}
                  onConnect={onConnect}
                  onEdit={onEdit}
                  onDelete={onDelete}
                />
              ))}
              {filtered.length === 0 && (
                <p className="px-3 py-8 text-center text-sm text-muted-foreground">
                  No hosts match “{query}”.
                </p>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

const SECTION_LABELS = {
  'port-forwarding': 'Port Forwarding',
  'known-hosts': 'Known Hosts',
  snippets: 'Snippets',
  history: 'History',
  settings: 'Settings',
};

function PlaceholderPanel({ section }) {
  return (
    <div className="flex h-full items-center justify-center">
      <div className="text-center">
        <p className="text-sm font-medium">{SECTION_LABELS[section]}</p>
        <p className="text-sm text-muted-foreground">Coming soon.</p>
      </div>
    </div>
  );
}

export default function VaultView({
  hosts,
  onConnect,
  onEdit,
  onDelete,
  onNewConnection,
  onLockVault,
}) {
  const [section, setSection] = useState('hosts');

  return (
    <div className="flex h-full bg-background">
      <Sidebar section={section} onSectionChange={setSection} onLockVault={onLockVault} />

      <div className="min-w-0 flex-1">
        {section === 'hosts' ? (
          <HostsPanel
            hosts={hosts}
            onConnect={onConnect}
            onEdit={onEdit}
            onDelete={onDelete}
            onNewConnection={onNewConnection}
          />
        ) : section === 'keychain' ? (
          <KeychainView />
        ) : (
          <PlaceholderPanel section={section} />
        )}
      </div>
    </div>
  );
}
