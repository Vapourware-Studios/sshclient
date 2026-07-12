import { useEffect, useMemo, useState } from 'react';
import Sidebar from '@/components/Sidebar';
import KeychainView from '@/components/KeychainView';
import SettingsPanel from '@/components/SettingsPanel';
import { HistoryPanel, PortForwardingPanel, SnippetsPanel } from '@/components/OperationsPanels';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Search, Plus, Server, Terminal, Pencil, Trash2, ChevronRight, ShieldCheck } from 'lucide-react';

function HostRow({ host, onConnect, onEdit, onDelete }) {
  const address = `${host.username ? `${host.username}@` : ''}${host.host}${
    host.port && host.port !== 22 ? `:${host.port}` : ''
  }`;

  return (
    <div
      onClick={() => onConnect(host)}
      className="group flex cursor-pointer items-center gap-3 border-b px-3 py-2.5 last:border-b-0 hover:bg-muted/50"
    >
      <span className="flex size-9 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground">
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

function HostsPanel({ hosts, onConnect, onEdit, onDelete, onNewConnection, onOpenLocalTerminal }) {
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
        <Button onClick={onOpenLocalTerminal} variant="outline" className="shrink-0">
          <Terminal className="size-4" /> Local Terminal
        </Button>
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
            <Button size="sm" onClick={onOpenLocalTerminal} variant="outline">
              <Terminal className="size-4" /> Local Terminal
            </Button>
            <Button size="sm" onClick={onNewConnection}>
              <Plus className="size-4" /> New Host
            </Button>
          </div>
        ) : (
          <>
            <p className="px-3 pb-2 text-xs font-medium uppercase tracking-wider text-muted-foreground">
              Hosts — {filtered.length}
            </p>
            <div className="overflow-hidden rounded-lg border bg-card">
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

function KnownHostsPanel() {
  const [knownHosts, setKnownHosts] = useState([]);
  const [query, setQuery] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    window.api.knownHostsList().then((result) => {
      if (!active) return;
      if (result.error) setError(result.error);
      else setKnownHosts(result.knownHosts);
    });
    return () => {
      active = false;
    };
  }, []);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return knownHosts;
    return knownHosts.filter(({ host, port, fingerprint }) =>
      [host, String(port), fingerprint].some((value) => value.toLowerCase().includes(q))
    );
  }, [knownHosts, query]);

  async function forget(entry) {
    const address = entry.port === 22 ? entry.host : `${entry.host}:${entry.port}`;
    if (!window.confirm(`Forget the trusted host key for "${address}"? You will be asked to verify it the next time you connect.`)) return;

    const result = await window.api.knownHostsDelete(entry.host, entry.port);
    if (result.error) setError(result.error);
    else {
      setError('');
      setKnownHosts(result.knownHosts);
    }
  }

  return (
    <div className="flex h-full flex-col">
      <div className="border-b px-4 py-3">
        <div className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Find a host or fingerprint…"
            className="pl-8"
          />
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-4">
        {error && <p className="mb-3 rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p>}
        {knownHosts.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-3 text-center">
            <span className="flex size-12 items-center justify-center rounded-xl border bg-muted text-muted-foreground">
              <ShieldCheck className="size-6" />
            </span>
            <div>
              <p className="text-sm font-medium">No known hosts yet</p>
              <p className="max-w-sm text-sm text-muted-foreground">
                Host fingerprints you trust while connecting will appear here.
              </p>
            </div>
          </div>
        ) : (
          <>
            <p className="px-3 pb-2 text-xs font-medium uppercase tracking-wider text-muted-foreground">
              Trusted host keys — {filtered.length}
            </p>
            <div className="overflow-hidden rounded-lg border bg-card">
              {filtered.map((entry) => (
                <div key={`${entry.host}:${entry.port}`} className="group flex items-center gap-3 border-b px-3 py-3 last:border-b-0">
                  <span className="flex size-9 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground">
                    <ShieldCheck className="size-4" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">
                      {entry.host}{entry.port !== 22 ? `:${entry.port}` : ''}
                    </p>
                    <p className="break-all font-mono text-xs text-muted-foreground">SHA256:{entry.fingerprint}</p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      First trusted {new Date(entry.firstSeen).toLocaleDateString()}
                    </p>
                  </div>
                  <button
                    onClick={() => forget(entry)}
                    title="Forget host key"
                    aria-label={`Forget host key for ${entry.host}`}
                    className="shrink-0 rounded-md p-2 text-muted-foreground hover:bg-muted hover:text-destructive"
                  >
                    <Trash2 className="size-4" />
                  </button>
                </div>
              ))}
              {filtered.length === 0 && (
                <p className="px-3 py-8 text-center text-sm text-muted-foreground">No known hosts match “{query}”.</p>
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
  onOpenLocalTerminal,
  onPlayRecording,
  tabs,
  visible,
}) {
  const [section, setSection] = useState('hosts');
  const hidden = visible ? '' : 'invisible pointer-events-none';

  return (
    <div className={`absolute inset-0 flex bg-background ${hidden}`}>
      <Sidebar section={section} onSectionChange={setSection} onLockVault={onLockVault} />

      <div className="min-w-0 flex-1">
        {section === 'hosts' ? (
          <HostsPanel
            hosts={hosts}
            onConnect={onConnect}
            onEdit={onEdit}
            onDelete={onDelete}
            onNewConnection={onNewConnection}
            onOpenLocalTerminal={onOpenLocalTerminal}
          />
        ) : section === 'keychain' ? (
          <KeychainView />
        ) : section === 'known-hosts' ? (
          <KnownHostsPanel />
        ) : section === 'port-forwarding' ? (
          <PortForwardingPanel tabs={tabs} />
        ) : section === 'snippets' ? (
          <SnippetsPanel tabs={tabs} />
        ) : section === 'history' ? (
          <HistoryPanel onPlayRecording={onPlayRecording} />
        ) : section === 'settings' ? (
          <SettingsPanel />
        ) : (
          <PlaceholderPanel section={section} />
        )}
      </div>
    </div>
  );
}
