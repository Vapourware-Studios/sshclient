import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { SlidePanel, PanelHeader } from '@/components/SlidePanel';
import { ArrowRightLeft, Code2, Play, Plus, Square, Trash2 } from 'lucide-react';

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
    open: () => setPanel({ nonce: Date.now() }),
    close: () => setPanel(null),
  };
}

function ItemRow({ Icon, title, subtitle, actions }) {
  return (
    <div className="group flex items-center gap-3 rounded-lg px-3 py-2 hover:bg-accent/60">
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
}

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

function NewForwardPanel({ sessions, onCreated, onClose }) {
  const [sessionId, setSessionId] = useState(sessions[0]?.id ?? '');
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
    setBusy(true);
    const result = await window.api.sshForwardStart(sessionId, spec);
    setBusy(false);
    if (result.error) {
      setError(result.error);
      return;
    }
    onCreated({ ...result.forward, sessionId, title: sessions.find((s) => s.id === sessionId)?.title });
  }

  return (
    <div className="flex h-full flex-col">
      <PanelHeader
        title="New forward"
        description="Route a local TCP port through a connected SSH session."
        onClose={onClose}
      />

      <form onSubmit={handleSubmit} className="flex flex-1 flex-col gap-4 overflow-y-auto p-4">
        <div className="flex flex-col gap-2">
          <Label htmlFor="forward-session">SSH session</Label>
          <select
            id="forward-session"
            className={selectClass}
            value={sessionId}
            onChange={(e) => setSessionId(e.target.value)}
          >
            {sessions.map((tab) => (
              <option key={tab.id} value={tab.id}>
                {tab.title}
              </option>
            ))}
          </select>
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

export function PortForwardingPanel({ tabs }) {
  const sessions = sshTabs(tabs);
  const [forwards, setForwards] = useState([]);
  const { isOpen, renderedPanel, open, close } = useSlideOutPanel();

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
        <div className="flex items-center justify-between gap-3 border-b px-4 py-3">
          <p className="text-sm font-medium">Port Forwarding</p>
          <Button disabled={sessions.length === 0} onClick={open}>
            <Plus className="size-4" /> New Forward
          </Button>
        </div>

        <div className="flex-1 overflow-y-auto p-4">
          {forwards.length === 0 ? (
            <EmptyState
              Icon={ArrowRightLeft}
              title="No active forwards"
              description={
                sessions.length === 0
                  ? 'Connect to an SSH host before starting a forward.'
                  : 'Route a local TCP port through a connected SSH session.'
              }
              action={
                sessions.length > 0 && (
                  <Button size="sm" onClick={open}>
                    <Plus className="size-4" /> New Forward
                  </Button>
                )
              }
            />
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
        {renderedPanel && <NewForwardPanel key={renderedPanel.nonce} sessions={sessions} onCreated={handleCreated} onClose={close} />}
      </SlidePanel>
    </div>
  );
}

function NewSnippetPanel({ onSaved, onClose }) {
  const [name, setName] = useState('');
  const [command, setCommand] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

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
    const result = await window.api.snippetsSave({ name: name.trim(), command });
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
        title="New snippet"
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

        {error && <p className="text-sm text-destructive">{error}</p>}

        <div className="mt-auto pt-2">
          <Button type="submit" disabled={busy} className="w-full">
            {busy ? 'Saving…' : 'Save Snippet'}
          </Button>
        </div>
      </form>
    </div>
  );
}

export function SnippetsPanel({ tabs }) {
  const sessions = sshTabs(tabs);
  const [items, setItems] = useState([]);
  const [sessionId, setSessionId] = useState('');
  const [error, setError] = useState('');
  const { isOpen, renderedPanel, open, close } = useSlideOutPanel();

  useEffect(() => {
    window.api.snippetsList().then((r) => (r.error ? setError(r.error) : setItems(r.snippets)));
  }, []);

  async function remove(id) {
    const r = await window.api.snippetsDelete(id);
    if (!r.error) setItems(r.snippets);
  }

  function run(item) {
    const id = sessionId || sessions[0]?.id;
    if (!id) {
      setError('Connect to an SSH host before running a snippet');
      return;
    }
    window.api.sshWrite(id, item.command.endsWith('\n') ? item.command : `${item.command}\n`);
  }

  function handleSaved(nextItems) {
    setItems(nextItems);
    close();
  }

  return (
    <div className="flex h-full overflow-hidden">
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex items-center justify-between gap-3 border-b px-4 py-3">
          <p className="text-sm font-medium">Snippets</p>
          <div className="flex shrink-0 items-center gap-2">
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
            <Button onClick={open}>
              <Plus className="size-4" /> New Snippet
            </Button>
          </div>
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
          ) : (
            <div className="flex flex-col gap-0.5">
              {items.map((item) => (
                <ItemRow
                  key={item.id}
                  Icon={Code2}
                  title={item.name}
                  subtitle={item.command}
                  actions={
                    <>
                      <button onClick={() => run(item)} title="Run snippet" className={iconButtonClass}>
                        <Play className="size-3.5" />
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
              ))}
            </div>
          )}
        </div>
      </div>

      <SlidePanel open={isOpen} onClose={close}>
        {renderedPanel && <NewSnippetPanel key={renderedPanel.nonce} onSaved={handleSaved} onClose={close} />}
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
        <p className="text-sm font-medium">History Playback</p>
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
