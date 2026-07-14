import { useEffect, useState } from 'react';
import { Play } from 'lucide-react';
import { PanelHeader } from '@/components/SlidePanel';
import ThemePicker from '@/components/ThemePicker';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Input } from '@/components/ui/input';

function SnippetList({ onRunSnippet }) {
  const [snippets, setSnippets] = useState([]);
  const [query, setQuery] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    window.api
      .snippetsList()
      .then((r) => (r.error ? setError(r.error) : setSnippets(r.snippets)));
  }, []);

  const filtered = snippets.filter(
    (s) =>
      s.name.toLowerCase().includes(query.toLowerCase()) ||
      s.command.toLowerCase().includes(query.toLowerCase())
  );

  return (
    <div className="flex h-full flex-col gap-2 p-3">
      <Input
        placeholder="Find a snippet…"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />

      {error && <p className="text-sm text-destructive">{error}</p>}

      {!error && snippets.length === 0 && (
        <p className="px-1 py-4 text-sm text-muted-foreground">
          No snippets yet. Create them from the Snippets section in the Hosts tab.
        </p>
      )}

      {!error && snippets.length > 0 && filtered.length === 0 && (
        <p className="px-1 py-4 text-sm text-muted-foreground">
          No snippets match “{query}”.
        </p>
      )}

      <div className="min-h-0 flex-1 space-y-1 overflow-y-auto">
        {filtered.map((snippet) => (
          <button
            key={snippet.id}
            onClick={() => onRunSnippet(snippet)}
            title="Run in this terminal"
            className="group flex w-full items-center justify-between gap-2 rounded-md border border-transparent px-3 py-2 text-left text-sm hover:bg-accent"
          >
            <span className="min-w-0">
              <span className="block truncate font-medium">{snippet.name}</span>
              <span className="block truncate font-mono text-xs text-muted-foreground">
                {snippet.command}
              </span>
            </span>
            <Play className="size-4 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" />
          </button>
        ))}
      </div>
    </div>
  );
}

export default function TerminalStylePanel({ onClose, onRunSnippet }) {
  return (
    <div className="flex h-full flex-col">
      <PanelHeader
        title="Terminal style"
        description="Theme templates and quick snippets"
        onClose={onClose}
      />

      <Tabs defaultValue="themes" className="min-h-0 flex-1 gap-0">
        <div className="border-b p-3">
          <TabsList className="w-full">
            <TabsTrigger value="themes" className="flex-1">Themes</TabsTrigger>
            <TabsTrigger value="snippets" className="flex-1">Snippets</TabsTrigger>
          </TabsList>
        </div>

        <TabsContent value="themes" className="min-h-0 flex-1 overflow-y-auto">
          <ThemePicker className="p-3" />
        </TabsContent>

        <TabsContent value="snippets" className="min-h-0 flex-1 overflow-hidden">
          <SnippetList onRunSnippet={onRunSnippet} />
        </TabsContent>
      </Tabs>
    </div>
  );
}
