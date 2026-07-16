import { useEffect, useMemo, useState } from 'react';
import Sidebar from '@/components/Sidebar';
import KeychainView from '@/components/KeychainView';
import SettingsPanel from '@/components/SettingsPanel';
import { HistoryPanel, PortForwardingPanel, SnippetsPanel } from '@/components/OperationsPanels';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from '@/components/ui/dropdown-menu';
import {
  ContextMenu,
  ContextMenuTrigger,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuShortcut,
} from '@/components/ui/context-menu';
import { GridCard, ViewToggle, GRID_CLASS } from '@/components/GridCard';
import { useViewMode } from '@/lib/view-mode';
import { useConfirm } from '@/lib/confirm';
import { toneForId, toneStyle } from '@/lib/tone';
import { HostIcon } from '@/lib/host-icons.jsx';
import {
  Search,
  Plus,
  Server,
  Terminal,
  TerminalSquare,
  Cable,
  ChevronDown,
  Pencil,
  Copy,
  Send,
  Link as LinkIcon,
  Trash2,
  ChevronRight,
  ShieldCheck,
  Download,
} from 'lucide-react';

function hostAddress(host) {
  return `${host.username ? `${host.username}@` : ''}${host.host}${
    host.port && host.port !== 22 ? `:${host.port}` : ''
  }`;
}

function HostContextMenu({ host, onConnect, onEdit, onDuplicate, onDelete, children }) {
  async function copySshCommand() {
    const port = host.port && host.port !== 22 ? ` -p ${host.port}` : '';
    await navigator.clipboard.writeText(`ssh ${host.username}@${host.host}${port}`);
  }

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>{children}</ContextMenuTrigger>
      <ContextMenuContent>
        <ContextMenuItem onClick={() => onConnect(host)}>
          <Send className="size-4" /> Connect
        </ContextMenuItem>
        <ContextMenuItem onClick={() => onEdit(host)}>
          <Pencil className="size-4" /> Edit host details
          <ContextMenuShortcut>E</ContextMenuShortcut>
        </ContextMenuItem>
        <ContextMenuItem onClick={() => onDuplicate(host)}>
          <Copy className="size-4" /> Duplicate
        </ContextMenuItem>
        <ContextMenuItem onClick={copySshCommand}>
          <LinkIcon className="size-4" /> Copy SSH command
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem variant="destructive" onClick={() => onDelete(host)}>
          <Trash2 className="size-4" /> Remove
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
}

function HostRow({ host, onConnect, onEdit, onDuplicate, onDelete }) {
  const address = hostAddress(host);

  return (
    <HostContextMenu host={host} onConnect={onConnect} onEdit={onEdit} onDuplicate={onDuplicate} onDelete={onDelete}>
      <div
        onDoubleClick={() => onConnect(host)}
        title="Double-click to connect"
        className="group flex cursor-pointer items-center gap-3 border-b px-3 py-2.5 last:border-b-0 hover:bg-muted/50"
      >
        <span
          className="flex size-9 shrink-0 items-center justify-center rounded-md"
          style={toneStyle(host.color || toneForId(host.id))}
        >
          <HostIcon slug={host.icon} fallback={Server} className="size-4" />
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
    </HostContextMenu>
  );
}

function HostGridCard({ host, onConnect, onEdit, onDuplicate, onDelete }) {
  const address = hostAddress(host);
  const badgeIcon = ({ className }) => (
    <HostIcon slug={host.icon} fallback={Server} className={className} />
  );

  return (
    <HostContextMenu host={host} onConnect={onConnect} onEdit={onEdit} onDuplicate={onDuplicate} onDelete={onDelete}>
      <GridCard
        id={host.id}
        tone={host.color || undefined}
        icon={badgeIcon}
        title={host.label || host.host}
        subtitle={`ssh · ${address}`}
        onDoubleClick={() => onConnect(host)}
        actions={
          <>
            <button
              onClick={(e) => {
                e.stopPropagation();
                onEdit(host);
              }}
              title="Edit host"
              className="rounded-md p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground"
            >
              <Pencil className="size-3.5" />
            </button>
            <button
              onClick={(e) => {
                e.stopPropagation();
                onDelete(host);
              }}
              title="Delete host"
              className="rounded-md p-1.5 text-muted-foreground hover:bg-muted hover:text-destructive"
            >
              <Trash2 className="size-3.5" />
            </button>
          </>
        }
      />
    </HostContextMenu>
  );
}

function HostsPanel({ hosts, onConnect, onEdit, onDelete, onDuplicate, onNewConnection, onOpenLocalTerminal }) {
  const [query, setQuery] = useState('');
  const [viewMode, setViewMode] = useViewMode('hosts');

  const sortedHosts = useMemo(
    () => [...hosts].sort((a, b) => (b.lastConnectedAt || 0) - (a.lastConnectedAt || 0)),
    [hosts]
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return sortedHosts;
    return sortedHosts.filter((h) =>
      [h.label, h.host, h.username].some((v) => v && v.toLowerCase().includes(q))
    );
  }, [sortedHosts, query]);

  const topMatch = query.trim() ? filtered[0] : null;

  function connectTopMatch() {
    if (topMatch) onConnect(topMatch);
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex flex-col gap-2 border-b px-4 py-3">
        <div className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') connectTopMatch();
            }}
            placeholder="Find a host or ssh user@hostname…"
            className="pl-8 pr-20"
          />
          <Button
            size="sm"
            disabled={!topMatch}
            onClick={connectTopMatch}
            className="absolute right-1 top-1/2 h-7 -translate-y-1/2"
          >
            Connect
          </Button>
        </div>

        <div className="flex items-center gap-2">
          <div className="flex shrink-0 items-stretch">
            <Button onClick={() => onNewConnection('ssh')} className="rounded-r-none">
              <Plus className="size-4" /> New host
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  className="rounded-l-none border-l border-primary-foreground/15 px-2"
                  aria-label="More new connection options"
                >
                  <ChevronDown className="size-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent>
                <DropdownMenuItem onClick={() => onNewConnection('ssh')}>
                  <Server className="size-4" /> SSH host
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => onNewConnection('serial')}>
                  <Cable className="size-4" /> Serial device
                </DropdownMenuItem>
                <DropdownMenuItem onClick={onOpenLocalTerminal}>
                  <TerminalSquare className="size-4" /> Local terminal
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>

          <Button onClick={onOpenLocalTerminal} variant="outline" className="shrink-0">
            <Terminal className="size-4" /> Terminal
          </Button>
          <Button onClick={() => onNewConnection('serial')} variant="outline" className="shrink-0">
            <Cable className="size-4" /> Serial
          </Button>

          <div className="flex-1" />

          <ViewToggle mode={viewMode} onChange={setViewMode} />
        </div>
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
            <Button size="sm" onClick={() => onNewConnection('ssh')}>
              <Plus className="size-4" /> New Host
            </Button>
          </div>
        ) : (
          <>
            <p className="px-3 pb-2 text-xs font-medium uppercase tracking-wider text-muted-foreground">
              Hosts — {filtered.length}
            </p>
            {filtered.length === 0 ? (
              <p className="px-3 py-8 text-center text-sm text-muted-foreground">
                No hosts match “{query}”.
              </p>
            ) : viewMode === 'grid' ? (
              <div className={GRID_CLASS}>
                {filtered.map((host) => (
                  <HostGridCard
                    key={host.id}
                    host={host}
                    onConnect={onConnect}
                    onEdit={onEdit}
                    onDuplicate={onDuplicate}
                    onDelete={onDelete}
                  />
                ))}
              </div>
            ) : (
              <div className="overflow-hidden rounded-lg border bg-card">
                {filtered.map((host) => (
                  <HostRow
                    key={host.id}
                    host={host}
                    onConnect={onConnect}
                    onEdit={onEdit}
                    onDuplicate={onDuplicate}
                    onDelete={onDelete}
                  />
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

function KnownHostGridCard({ entry, onForget }) {
  const address = entry.port === 22 ? entry.host : `${entry.host}:${entry.port}`;

  return (
    <GridCard
      id={`${entry.host}:${entry.port}`}
      tone="chart-2"
      icon={ShieldCheck}
      title={address}
      subtitle={`SHA256:${entry.fingerprint}`}
      actions={
        <button
          onClick={(e) => {
            e.stopPropagation();
            onForget(entry);
          }}
          title="Forget host key"
          aria-label={`Forget host key for ${entry.host}`}
          className="rounded-md p-1.5 text-muted-foreground hover:bg-muted hover:text-destructive"
        >
          <Trash2 className="size-3.5" />
        </button>
      }
    />
  );
}

function KnownHostsPanel() {
  const confirm = useConfirm();
  const [knownHosts, setKnownHosts] = useState([]);
  const [query, setQuery] = useState('');
  const [error, setError] = useState('');
  const [viewMode, setViewMode] = useViewMode('known-hosts');

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
    const confirmed = await confirm({
      title: 'Forget host key',
      description: `Forget the trusted host key for "${address}"? You will be asked to verify it the next time you connect.`,
      confirmText: 'Forget',
      destructive: true,
    });
    if (!confirmed) return;

    const result = await window.api.knownHostsDelete(entry.host, entry.port);
    if (result.error) setError(result.error);
    else {
      setError('');
      setKnownHosts(result.knownHosts);
    }
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2 border-b px-4 py-3">
        <Button variant="outline" disabled title="Importing from ~/.ssh/known_hosts is coming soon">
          <Download className="size-4" /> Import
        </Button>

        <div className="flex-1" />

        <div className="relative w-64 shrink-0">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Find a host or fingerprint…"
            className="pl-8"
          />
        </div>
        <ViewToggle mode={viewMode} onChange={setViewMode} />
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
            {filtered.length === 0 ? (
              <p className="px-3 py-8 text-center text-sm text-muted-foreground">No known hosts match “{query}”.</p>
            ) : viewMode === 'grid' ? (
              <div className={GRID_CLASS}>
                {filtered.map((entry) => (
                  <KnownHostGridCard key={`${entry.host}:${entry.port}`} entry={entry} onForget={forget} />
                ))}
              </div>
            ) : (
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
              </div>
            )}
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
  history: 'Logs',
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
  onDuplicate,
  onNewConnection,
  onLockVault,
  onOpenLocalTerminal,
  onPlayRecording,
  onRunOnHost,
  onConnectAndStartForward,
  onHostsChange,
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
            onDuplicate={onDuplicate}
            onNewConnection={onNewConnection}
            onOpenLocalTerminal={onOpenLocalTerminal}
          />
        ) : section === 'keychain' ? (
          <KeychainView onNewHost={() => onNewConnection('ssh')} />
        ) : section === 'known-hosts' ? (
          <KnownHostsPanel />
        ) : section === 'port-forwarding' ? (
          <PortForwardingPanel
            tabs={tabs}
            hosts={hosts}
            onConnectAndStartForward={onConnectAndStartForward}
            onNewHost={() => onNewConnection('ssh')}
          />
        ) : section === 'snippets' ? (
          <SnippetsPanel
            tabs={tabs}
            hosts={hosts}
            onRunOnHost={onRunOnHost}
            onNewHost={() => onNewConnection('ssh')}
          />
        ) : section === 'history' ? (
          <HistoryPanel onPlayRecording={onPlayRecording} />
        ) : section === 'settings' ? (
          <SettingsPanel onHostsChange={onHostsChange} />
        ) : (
          <PlaceholderPanel section={section} />
        )}
      </div>
    </div>
  );
}
