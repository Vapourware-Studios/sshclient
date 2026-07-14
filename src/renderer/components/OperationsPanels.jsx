import { forwardRef, useEffect, useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { SlidePanel, PanelHeader } from '@/components/SlidePanel';
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
import { ArrowRightLeft, Code2, Copy, Pencil, Play, Plus, Search, Server, Square, Trash2, X } from 'lucide-react';

const selectClass =
  'h-9 rounded-md border border-input bg-transparent px-3 text-sm shadow-xs outline-none transition-[color,box-shadow] focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 dark:bg-input/30';

const iconButtonClass =
  'shrink-0 rounded-md p-2 text-muted-foreground hover:bg-muted hover:text-foreground';

const destructiveIconButtonClass =
  'shrink-0 rounded-md p-2 text-muted-foreground hover:bg-muted hover:text-destructive';

const sshTabs = (tabs) => tabs.filter((tab) => tab.type === 'ssh' && tab.status === 'connected');

function useSlideOutPanel() {
  const [panel, setPanel] = useState(null);
  const [renderedPanel, setRenderedPanel] = useState(null);

  useEffect(() => {
    if (panel) {
      setRenderedPanel(panel);
      return;
    }
    const timer = setTimeout(() => setRenderedPanel(null), 300);
    return () => clearTimeout(timer);
  }, [panel]);

  return {
    isOpen: Boolean(panel),
    renderedPanel,
    open: (extra) => setPanel({ nonce: Date.now(), ...extra }),
    close: () => setPanel(null),
  };
}

const ItemRow = forwardRef(function ItemRow({ Icon, title, subtitle, actions, ...rest }, ref) {
  return (
    <div ref={ref} className="group flex items-center gap-3 rounded-lg px-3 py-2 hover:bg-accent/60" {...rest}>
      <span className="flex size-9 shrink-0 items-center justify-center rounded-lg border bg-muted text-muted-foreground">
        <Icon className="size-4" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium">{title}</p>
        <p className="truncate text-xs text-muted-foreground">{subtitle}</p>
      </div>
      <div className="hidden shrink-0 items-center gap-1 group-hover:flex">{actions}</div>
    </div>
  );
});

function EmptyState({ Icon, title, description, action }) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 text-center">
      <span className="flex size-12 items-center justify-center rounded-xl border bg-muted text-muted-foreground">
        <Icon className="size-6" />
      </span>
      <div>
        <p className="text-sm font-medium">{title}</p>
        <p className="text-sm text-muted-foreground">{description}</p>
      </div>
      {action}
    </div>
  );
}

function NewForwardPanel({ sessions, hosts, onConnectAndStartForward, onCreated, onClose }) {
  const connectedHostIds = new Set(sessions.map((s) => s.connectConfig?.hostId).filter(Boolean));
  const availableHosts = hosts.filter((h) => !connectedHostIds.has(h.id));

  const [target, setTarget] = useState(() =>
    sessions[0]
      ? { type: 'session', id: sessions[0].id, label: sessions[0].title }
      : availableHosts[0]
        ? { type: 'host', id: availableHosts[0].id, label: availableHosts[0].label || availableHosts[0].host }
        : null
  );
  const [spec, setSpec] = useState({
    bindHost: '127.0.0.1',
    bindPort: '8080',
    targetHost: '127.0.0.1',
    targetPort: '80',
  });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    if (!target) {
      setError('Select a host to forward through');
      return;
    }

    setBusy(true);
    let result;
    if (target.type === 'session') {
      const forwardResult = await window.api.sshForwardStart(target.id, spec);
      result = forwardResult.error ? forwardResult : { forward: forwardResult.forward, sessionId: target.id };
    } else {
      const host = hosts.find((h) => h.id === target.id);
      result = await onConnectAndStartForward(host, spec);
    }
    setBusy(false);

    if (result.error) {
      setError(result.error);
      return;
    }
    onCreated({ ...result.forward, sessionId: result.sessionId, title: target.label });
  }

  return (
    <div className="flex h-full flex-col">
      <PanelHeader
        title="New forward"
        description="Route a local TCP port through an SSH session — connects for you if the host isn't open yet."
        onClose={onClose}
      />

      <form onSubmit={handleSubmit} className="flex flex-1 flex-col gap-4 overflow-y-auto p-4">
        <div className="flex flex-col gap-2">
          <Label>Forward through</Label>
          {sessions.length === 0 && availableHosts.length === 0 ? (
            <p className="rounded-md border border-dashed px-3 py-4 text-center text-sm text-muted-foreground">
              No saved hosts — add one under Hosts first.
            </p>
          ) : (
            <div className="flex max-h-52 flex-col gap-1 overflow-y-auto">
              {sessions.map((tab) => (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setTarget({ type: 'session', id: tab.id, label: tab.title })}
                  className={`flex items-center gap-2.5 rounded-md border px-2.5 py-1.5 text-left text-sm ${
                    target?.type === 'session' && target.id === tab.id
                      ? 'border-primary bg-accent'
                      : 'border-transparent hover:bg-accent/50'
                  }`}
                >
                  <span className="size-1.5 shrink-0 rounded-full bg-emerald-500" />
                  <span className="min-w-0 flex-1 truncate">{tab.title}</span>
                  <span className="shrink-0 text-xs text-muted-foreground">connected</span>
                </button>
              ))}
              {availableHosts.map((host) => (
                <button
                  key={host.id}
                  type="button"
                  onClick={() =>
                    setTarget({ type: 'host', id: host.id, label: host.label || host.host })
                  }
                  className={`flex items-center gap-2.5 rounded-md border px-2.5 py-1.5 text-left text-sm ${
                    target?.type === 'host' && target.id === host.id
                      ? 'border-primary bg-accent'
                      : 'border-transparent hover:bg-accent/50'
                  }`}
                >
                  <Server className="size-3.5 shrink-0 text-muted-foreground" />
                  <span className="min-w-0 flex-1 truncate">{host.label || host.host}</span>
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="flex flex-col gap-2">
          <Label>Local address</Label>
          <div className="flex gap-2">
            <Input value={spec.bindHost} onChange={(e) => setSpec({ ...spec, bindHost: e.target.value })} />
            <Input
              className="w-24"
              type="number"
              value={spec.bindPort}
              onChange={(e) => setSpec({ ...spec, bindPort: e.target.value })}
            />
          </div>
        </div>

        <div className="flex flex-col gap-2">
          <Label>Destination address</Label>
          <div className="flex gap-2">
            <Input value={spec.targetHost} onChange={(e) => setSpec({ ...spec, targetHost: e.target.value })} />
            <Input
              className="w-24"
              type="number"
              value={spec.targetPort}
              onChange={(e) => setSpec({ ...spec, targetPort: e.target.value })}
            />
          </div>
        </div>

        {error && <p className="text-sm text-destructive">{error}</p>}

        <div className="mt-auto pt-2">
          <Button type="submit" disabled={busy} className="w-full">
            {busy ? 'Starting…' : 'Start Forward'}
          </Button>
        </div>
      </form>
    </div>
  );
}

function ForwardGridCard({ item, onStop }) {
  return (
    <GridCard
      id={item.id}
      tone="chart-4"
      icon={ArrowRightLeft}
      title={`${item.bindHost}:${item.bindPort} → ${item.targetHost}:${item.targetPort}`}
      subtitle={`Via ${item.title}`}
      actions={
        <button
          onClick={(e) => {
            e.stopPropagation();
            onStop(item);
          }}
          title="Stop forward"
          className="rounded-md p-1.5 text-muted-foreground hover:bg-muted hover:text-destructive"
        >
          <Square className="size-3.5" />
        </button>
      }
    />
  );
}

export function PortForwardingPanel({ tabs, hosts = [], onConnectAndStartForward }) {
  const sessions = sshTabs(tabs);
  const [forwards, setForwards] = useState([]);
  const [viewMode, setViewMode] = useViewMode('port-forwarding');
  const { isOpen, renderedPanel, open, close } = useSlideOutPanel();
  const canOpen = sessions.length > 0 || hosts.length > 0;

  async function stop(item) {
    await window.api.sshForwardStop(item.sessionId, item.id);
    setForwards((items) => items.filter((value) => value.id !== item.id));
  }

  function handleCreated(forward) {
    setForwards((items) => [...items, forward]);
    close();
  }

  return (
    <div className="flex h-full overflow-hidden">
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex items-center gap-2 border-b px-4 py-3">
          <Button disabled={!canOpen} onClick={open}>
            <Plus className="size-4" /> New Forward
          </Button>

          <div className="flex-1" />

          <ViewToggle mode={viewMode} onChange={setViewMode} />
        </div>

        <div className="flex-1 overflow-y-auto p-4">
          {forwards.length === 0 ? (
            <EmptyState
              Icon={ArrowRightLeft}
              title="No active forwards"
              description={
                canOpen
                  ? 'Route a local TCP port through an SSH session — connects for you if needed.'
                  : 'Add a saved host under Hosts before starting a forward.'
              }
              action={
                canOpen && (
                  <Button size="sm" onClick={open}>
                    <Plus className="size-4" /> New Forward
                  </Button>
                )
              }
            />
          ) : viewMode === 'grid' ? (
            <div className={GRID_CLASS}>
              {forwards.map((item) => (
                <ForwardGridCard key={item.id} item={item} onStop={stop} />
              ))}
            </div>
          ) : (
            <div className="flex flex-col gap-0.5">
              {forwards.map((item) => (
                <ItemRow
                  key={item.id}
                  Icon={ArrowRightLeft}
                  title={`${item.bindHost}:${item.bindPort} → ${item.targetHost}:${item.targetPort}`}
                  subtitle={`Via ${item.title}`}
                  actions={
                    <button onClick={() => stop(item)} title="Stop forward" className={iconButtonClass}>
                      <Square className="size-3.5" />
                    </button>
                  }
                />
              ))}
            </div>
          )}
        </div>
      </div>

      <SlidePanel open={isOpen} onClose={close}>
        {renderedPanel && (
          <NewForwardPanel
            key={renderedPanel.nonce}
            sessions={sessions}
            hosts={hosts}
            onConnectAndStartForward={onConnectAndStartForward}
            onCreated={handleCreated}
            onClose={close}
          />
        )}
      </SlidePanel>
    </div>
  );
}

function NewSnippetPanel({ hosts, editingSnippet, onSaved, onClose }) {
  const [name, setName] = useState(editingSnippet?.name ?? '');
  const [command, setCommand] = useState(editingSnippet?.command ?? '');
  const [targets, setTargets] = useState(editingSnippet?.targets ?? []);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const availableHosts = hosts.filter((h) => !targets.includes(h.id));

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    if (!name.trim()) {
      setError('Snippet name is required');
      return;
    }
    if (!command.trim()) {
      setError('Command is required');
      return;
    }

    setBusy(true);
    const result = await window.api.snippetsSave({
      id: editingSnippet?.id,
      name: name.trim(),
      command,
      targets,
    });
    setBusy(false);
    if (result.error) {
      setError(result.error);
      return;
    }
    onSaved(result.snippets);
  }

  return (
    <div className="flex h-full flex-col">
      <PanelHeader
        title={editingSnippet ? 'Edit snippet' : 'New snippet'}
        description="Saved in the encrypted vault, ready to send to any connected terminal."
        onClose={onClose}
      />

      <form onSubmit={handleSubmit} className="flex flex-1 flex-col gap-4 overflow-y-auto p-4">
        <div className="flex flex-col gap-2">
          <Label htmlFor="snippet-name">Name</Label>
          <Input id="snippet-name" placeholder="Restart service" value={name} onChange={(e) => setName(e.target.value)} />
        </div>

        <div className="flex flex-col gap-2">
          <Label htmlFor="snippet-command">Command</Label>
          <Textarea
            id="snippet-command"
            className="min-h-32 font-mono"
            placeholder="sudo systemctl restart nginx"
            value={command}
            onChange={(e) => setCommand(e.target.value)}
          />
        </div>

        <div className="flex flex-col gap-2">
          <Label>Targets for execution</Label>
          <p className="text-xs text-muted-foreground">
            Attach saved hosts to connect and run this snippet on them in one click.
          </p>

          {targets.length > 0 && (
            <div className="flex flex-col gap-1">
              {targets.map((hostId) => {
                const host = hosts.find((h) => h.id === hostId);
                if (!host) return null;
                return (
                  <div
                    key={hostId}
                    className="flex items-center gap-2 rounded-md border bg-muted/40 px-2.5 py-1.5"
                  >
                    <Server className="size-3.5 shrink-0 text-muted-foreground" />
                    <span className="min-w-0 flex-1 truncate text-sm">{host.label || host.host}</span>
                    <span className="shrink-0 text-xs text-muted-foreground">SSH</span>
                    <button
                      type="button"
                      onClick={() => setTargets((t) => t.filter((id) => id !== hostId))}
                      title="Remove target"
                      aria-label={`Remove target ${host.label || host.host}`}
                      className="shrink-0 text-muted-foreground hover:text-destructive"
                    >
                      <X className="size-3.5" />
                    </button>
                  </div>
                );
              })}
            </div>
          )}

          {availableHosts.length > 0 ? (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button type="button" variant="outline" size="sm" className="self-start">
                  <Plus className="size-3.5" /> Add target
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start">
                {availableHosts.map((host) => (
                  <DropdownMenuItem
                    key={host.id}
                    onClick={() => setTargets((t) => [...t, host.id])}
                  >
                    <Server className="size-4" /> {host.label || host.host}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          ) : hosts.length === 0 ? (
            <p className="text-xs text-muted-foreground">No saved hosts yet — add one under Hosts first.</p>
          ) : (
            <p className="text-xs text-muted-foreground">All saved hosts are already targets.</p>
          )}
        </div>

        {error && <p className="text-sm text-destructive">{error}</p>}

        <div className="mt-auto pt-2">
          <Button type="submit" disabled={busy} className="w-full">
            {busy ? 'Saving…' : editingSnippet ? 'Save Changes' : 'Save Snippet'}
          </Button>
        </div>
      </form>
    </div>
  );
}

function snippetSubtitle(item) {
  return item.targets?.length
    ? `${item.command} · ${item.targets.length} target${item.targets.length === 1 ? '' : 's'}`
    : item.command;
}

function SnippetContextMenu({ item, onRun, onEdit, onDuplicate, onDelete, children }) {
  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>{children}</ContextMenuTrigger>
      <ContextMenuContent>
        <ContextMenuItem onClick={() => onRun(item)}>
          <Play className="size-4" /> Run
          <ContextMenuShortcut>↵</ContextMenuShortcut>
        </ContextMenuItem>
        <ContextMenuItem onClick={() => onEdit(item)}>
          <Pencil className="size-4" /> Edit
          <ContextMenuShortcut>E</ContextMenuShortcut>
        </ContextMenuItem>
        <ContextMenuItem onClick={() => onDuplicate(item)}>
          <Copy className="size-4" /> Duplicate
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem variant="destructive" onClick={() => onDelete(item.id)}>
          <Trash2 className="size-4" /> Remove
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
}

function SnippetGridCard({ item, onRun, onEdit, onDuplicate, onDelete }) {
  return (
    <SnippetContextMenu item={item} onRun={onRun} onEdit={onEdit} onDuplicate={onDuplicate} onDelete={onDelete}>
      <GridCard
        id={item.id}
        tone="chart-5"
        icon={Code2}
        title={item.name}
        subtitle={snippetSubtitle(item)}
        onClick={() => onRun(item)}
        actions={
          <>
            <button
              onClick={(e) => {
                e.stopPropagation();
                onRun(item);
              }}
              title={item.targets?.length ? 'Run on targets' : 'Run snippet'}
              className="rounded-md p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground"
            >
              <Play className="size-3.5" />
            </button>
            <button
              onClick={(e) => {
                e.stopPropagation();
                onEdit(item);
              }}
              title="Edit snippet"
              aria-label={`Edit snippet ${item.name}`}
              className="rounded-md p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground"
            >
              <Pencil className="size-3.5" />
            </button>
            <button
              onClick={(e) => {
                e.stopPropagation();
                onDelete(item.id);
              }}
              title="Delete snippet"
              aria-label={`Delete snippet ${item.name}`}
              className="rounded-md p-1.5 text-muted-foreground hover:bg-muted hover:text-destructive"
            >
              <Trash2 className="size-3.5" />
            </button>
          </>
        }
      />
    </SnippetContextMenu>
  );
}

export function SnippetsPanel({ tabs, hosts = [], onRunOnHost }) {
  const sessions = sshTabs(tabs);
  const [items, setItems] = useState([]);
  const [sessionId, setSessionId] = useState('');
  const [query, setQuery] = useState('');
  const [error, setError] = useState('');
  const [viewMode, setViewMode] = useViewMode('snippets');
  const { isOpen, renderedPanel, open, close } = useSlideOutPanel();

  useEffect(() => {
    window.api.snippetsList().then((r) => (r.error ? setError(r.error) : setItems(r.snippets)));
  }, []);

  async function remove(id) {
    const r = await window.api.snippetsDelete(id);
    if (!r.error) setItems(r.snippets);
  }

  async function duplicate(item) {
    const result = await window.api.snippetsSave({
      name: `${item.name} copy`,
      command: item.command,
      targets: item.targets ?? [],
    });
    if (!result.error) setItems(result.snippets);
  }

  function run(item) {
    if (item.targets?.length) {
      setError('');
      for (const hostId of item.targets) {
        const host = hosts.find((h) => h.id === hostId);
        if (host) onRunOnHost?.(host, item.command);
      }
      return;
    }

    const id = sessionId || sessions[0]?.id;
    if (!id) {
      setError('Connect to an SSH host before running a snippet, or attach targets to it');
      return;
    }
    window.api.sshWrite(id, item.command.endsWith('\n') ? item.command : `${item.command}\n`);
  }

  function handleSaved(nextItems) {
    setItems(nextItems);
    close();
  }

  function openEdit(item) {
    open({ editingSnippet: item });
  }

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return items;
    return items.filter((item) => [item.name, item.command].some((v) => v && v.toLowerCase().includes(q)));
  }, [items, query]);

  return (
    <div className="flex h-full overflow-hidden">
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex items-center gap-2 border-b px-4 py-3">
          <Button onClick={open}>
            <Plus className="size-4" /> New Snippet
          </Button>

          {sessions.length > 0 && (
            <select
              className={selectClass}
              value={sessionId || sessions[0].id}
              onChange={(e) => setSessionId(e.target.value)}
            >
              {sessions.map((tab) => (
                <option key={tab.id} value={tab.id}>
                  Run on {tab.title}
                </option>
              ))}
            </select>
          )}

          <div className="flex-1" />

          <div className="relative w-64 shrink-0">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Find a snippet…"
              className="pl-8"
            />
          </div>
          <ViewToggle mode={viewMode} onChange={setViewMode} />
        </div>

        <div className="flex-1 overflow-y-auto p-4">
          {error && <ErrorText>{error}</ErrorText>}

          {items.length === 0 ? (
            <EmptyState
              Icon={Code2}
              title="No snippets yet"
              description="Save a command to send it to any connected terminal in one click."
              action={
                <Button size="sm" onClick={open}>
                  <Plus className="size-4" /> New Snippet
                </Button>
              }
            />
          ) : filtered.length === 0 ? (
            <p className="px-3 py-8 text-center text-sm text-muted-foreground">
              No snippets match “{query}”.
            </p>
          ) : viewMode === 'grid' ? (
            <div className={GRID_CLASS}>
              {filtered.map((item) => (
                <SnippetGridCard
                  key={item.id}
                  item={item}
                  onRun={run}
                  onEdit={openEdit}
                  onDuplicate={duplicate}
                  onDelete={remove}
                />
              ))}
            </div>
          ) : (
            <div className="flex flex-col gap-0.5">
              {filtered.map((item) => (
                <SnippetContextMenu
                  key={item.id}
                  item={item}
                  onRun={run}
                  onEdit={openEdit}
                  onDuplicate={duplicate}
                  onDelete={remove}
                >
                  <ItemRow
                    Icon={Code2}
                    title={item.name}
                    subtitle={snippetSubtitle(item)}
                    actions={
                      <>
                        <button
                          onClick={() => run(item)}
                          title={item.targets?.length ? 'Run on targets' : 'Run snippet'}
                          className={iconButtonClass}>
                          <Play className="size-3.5" />
                        </button>
                        <button
                          onClick={() => openEdit(item)}
                          title="Edit snippet"
                          aria-label={`Edit snippet ${item.name}`}
                          className={iconButtonClass}
                        >
                          <Pencil className="size-3.5" />
                        </button>
                        <button
                          onClick={() => remove(item.id)}
                          title="Delete snippet"
                          aria-label={`Delete snippet ${item.name}`}
                          className={destructiveIconButtonClass}
                        >
                          <Trash2 className="size-3.5" />
                        </button>
                      </>
                    }
                  />
                </SnippetContextMenu>
              ))}
            </div>
          )}
        </div>
      </div>

      <SlidePanel open={isOpen} onClose={close}>
        {renderedPanel && (
          <NewSnippetPanel
            key={renderedPanel.nonce}
            hosts={hosts}
            editingSnippet={renderedPanel.editingSnippet}
            onSaved={handleSaved}
            onClose={close}
          />
        )}
      </SlidePanel>
    </div>
  );
}

export function HistoryPanel({ onPlayRecording }) {
  const [items, setItems] = useState([]);
  const [error, setError] = useState('');

  useEffect(() => {
    window.api.historyList().then((r) => (r.error ? setError(r.error) : setItems(r.history)));
  }, []);

  async function remove(id) {
    const r = await window.api.historyDelete(id);
    if (!r.error) setItems(r.history);
  }

  return (
    <div className="flex h-full flex-col">
      <div className="border-b p-4">
        <p className="text-sm font-medium">Logs</p>
        <p className="mt-0.5 text-xs text-muted-foreground">
          Replay output from completed SSH terminal sessions in a terminal tab. Keyboard input is never recorded.
        </p>
      </div>

      <div className="flex-1 overflow-y-auto p-4">
        {error && <ErrorText>{error}</ErrorText>}

        {items.length === 0 ? (
          <EmptyState
            Icon={Play}
            title="No recordings yet"
            description="Completed SSH terminal sessions will appear here."
          />
        ) : (
          <div className="flex flex-col gap-0.5">
            {items.map((item) => (
              <ItemRow
                key={item.id}
                Icon={Play}
                title={`${item.username}@${item.host}`}
                subtitle={`${new Date(item.startedAt).toLocaleString()} · ${Math.ceil(item.duration / 1000)}s`}
                actions={
                  <>
                    <button
                      onClick={() => onPlayRecording?.(item)}
                      title="Play recording"
                      className={iconButtonClass}
                    >
                      <Play className="size-3.5" />
                    </button>
                    <button
                      onClick={() => remove(item.id)}
                      title="Delete recording"
                      aria-label={`Delete recording of ${item.username}@${item.host}`}
                      className={destructiveIconButtonClass}
                    >
                      <Trash2 className="size-3.5" />
                    </button>
                  </>
                }
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function ErrorText({ children }) {
  return <p className="mb-3 rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">{children}</p>;
}
