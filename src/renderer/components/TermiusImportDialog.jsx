import { useEffect, useState } from 'react';
import { Loader2, Download, KeyRound, ScrollText, TriangleAlert } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';

export default function TermiusImportDialog({ open, onOpenChange, onImported }) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [connections, setConnections] = useState([]);
  const [keys, setKeys] = useState([]);
  const [snippets, setSnippets] = useState([]);
  const [selected, setSelected] = useState(() => new Set());
  const [selectedSnippets, setSelectedSnippets] = useState(() => new Set());
  const [importing, setImporting] = useState(false);
  const [result, setResult] = useState(null);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setError('');
    setResult(null);
    setConnections([]);
    setSnippets([]);
    setLoading(true);
    window.api.termiusPreviewImport().then((res) => {
      if (cancelled) return;
      setLoading(false);
      if (res.error) {
        setError(res.error);
        return;
      }
      setConnections(res.connections);
      setKeys(res.keys);
      setSnippets(res.snippets);
      setSelected(new Set(res.connections.map((c) => c.localId)));
      setSelectedSnippets(new Set(res.snippets.map((s) => s.localId)));
    });
    return () => {
      cancelled = true;
    };
  }, [open]);

  function toggle(localId) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(localId)) next.delete(localId);
      else next.add(localId);
      return next;
    });
  }

  function toggleAll() {
    const allIds = connections.map((c) => c.localId);
    setSelected((prev) => (prev.size === allIds.length ? new Set() : new Set(allIds)));
  }

  function toggleSnippet(localId) {
    setSelectedSnippets((prev) => {
      const next = new Set(prev);
      if (next.has(localId)) next.delete(localId);
      else next.add(localId);
      return next;
    });
  }

  function toggleAllSnippets() {
    const allIds = snippets.map((s) => s.localId);
    setSelectedSnippets((prev) => (prev.size === allIds.length ? new Set() : new Set(allIds)));
  }

  async function runImport() {
    setImporting(true);
    setError('');
    const keyVaultIdByLocalId = new Map();
    const hostVaultIdByTermiusHostId = new Map();
    const failures = [];
    let importedHostCount = 0;
    let importedSnippetCount = 0;
    let hosts = [];
    let priorHostIds = new Set((await window.api.hostsList()).hosts?.map((h) => h.id) ?? []);

    for (const conn of connections) {
      if (!selected.has(conn.localId)) continue;

      try {
        let keyId;
        if (conn.authType === 'key' && conn.keyLocalId) {
          if (!keyVaultIdByLocalId.has(conn.keyLocalId)) {
            const key = keys.find((k) => k.localId === conn.keyLocalId);
            if (key) {
              const res = await window.api.keysImport({
                name: key.name,
                privateKey: key.private,
                publicKey: key.public,
                passphrase: key.passphrase,
              });
              if (res.error) throw new Error(`key "${key.name}": ${res.error}`);
              const savedKey = res.keys[res.keys.length - 1];
              keyVaultIdByLocalId.set(conn.keyLocalId, savedKey.id);
            }
          }
          keyId = keyVaultIdByLocalId.get(conn.keyLocalId);
        }

        const res = await window.api.hostsSave({
          label: conn.name,
          host: conn.host,
          port: conn.port,
          username: conn.username,
          password: conn.authType === 'password' ? conn.password : undefined,
          passphrase: conn.authType === 'key' ? conn.passphrase : undefined,
          keyId,
        });
        if (res.error) throw new Error(res.error);
        const newHost = res.hosts.find((h) => !priorHostIds.has(h.id));
        if (newHost && conn.termiusHostId != null) {
          hostVaultIdByTermiusHostId.set(conn.termiusHostId, newHost.id);
        }
        priorHostIds = new Set(res.hosts.map((h) => h.id));
        hosts = res.hosts;
        importedHostCount += 1;
      } catch (err) {
        failures.push({ name: conn.name, message: conn.invalidReason || err.message });
      }
    }

    for (const snippet of snippets) {
      if (!selectedSnippets.has(snippet.localId)) continue;

      try {
        const targets = snippet.termiusHostIds
          .map((tid) => hostVaultIdByTermiusHostId.get(tid))
          .filter(Boolean);
        const res = await window.api.snippetsSave({
          name: snippet.name,
          command: snippet.command,
          targets,
        });
        if (res.error) throw new Error(res.error);
        importedSnippetCount += 1;
      } catch (err) {
        failures.push({ name: snippet.name, message: err.message });
      }
    }

    setResult({ hostCount: importedHostCount, snippetCount: importedSnippetCount, failures });
    if (importedHostCount > 0) onImported?.(hosts);
    setImporting(false);
  }

  const totalSelected = selected.size + selectedSnippets.size;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Download className="size-4" /> Import from Termius
          </DialogTitle>
          <DialogDescription>
            Reads hosts, keys, and snippets from the local Termius install on this machine.
            Nothing is saved to the vault until you choose what to import.
          </DialogDescription>
        </DialogHeader>

        <div className="flex min-h-0 flex-col gap-4 overflow-y-auto">
        {loading && (
          <div className="flex items-center justify-center gap-2 py-8 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" /> Reading Termius database…
          </div>
        )}

        {!loading && error && (
          <p className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
            <TriangleAlert className="mt-0.5 size-4 shrink-0" /> {error}
          </p>
        )}

        {!loading && !error && result && (
          <div className="flex flex-col gap-2 text-sm">
            <p className="text-muted-foreground">
              Imported {result.hostCount} connection{result.hostCount === 1 ? '' : 's'} and{' '}
              {result.snippetCount} snippet{result.snippetCount === 1 ? '' : 's'}.
            </p>
            {result.failures.length > 0 && (
              <div className="flex flex-col gap-1 rounded-md border border-destructive/40 bg-destructive/10 p-3">
                <p className="flex items-center gap-2 font-medium text-destructive">
                  <TriangleAlert className="size-4 shrink-0" /> {result.failures.length} failed
                </p>
                <ul className="max-h-40 overflow-y-auto text-xs text-destructive">
                  {result.failures.map((f, i) => (
                    <li key={i}>
                      <span className="font-medium">{f.name}</span>: {f.message}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}

        {!loading && !error && !result && (connections.length > 0 || snippets.length > 0) && (
          <Tabs defaultValue="connections">
            <TabsList>
              <TabsTrigger value="connections">Connections ({connections.length})</TabsTrigger>
              <TabsTrigger value="snippets">Snippets ({snippets.length})</TabsTrigger>
            </TabsList>

            <TabsContent value="connections" className="flex flex-col gap-2">
              {connections.length === 0 ? (
                <p className="py-8 text-center text-sm text-muted-foreground">
                  No Termius connections found.
                </p>
              ) : (
                <>
                  <label className="flex cursor-pointer items-center gap-2 text-sm">
                    <Checkbox
                      checked={selected.size === connections.length}
                      onCheckedChange={toggleAll}
                    />
                    Select all ({connections.length})
                  </label>

                  <ScrollArea className="h-64 rounded-md border">
                    <div className="flex flex-col divide-y">
                      {connections.map((conn) => (
                        <label
                          key={conn.localId}
                          className="flex cursor-pointer items-center gap-3 px-3 py-2 text-sm"
                        >
                          <Checkbox
                            checked={selected.has(conn.localId)}
                            onCheckedChange={() => toggle(conn.localId)}
                          />
                          <div className="min-w-0 flex-1">
                            <div className="truncate font-medium">{conn.name}</div>
                            <div className="truncate text-xs text-muted-foreground">
                              {conn.username || '(no username)'}@{conn.host || '(no host)'}:
                              {conn.port}
                            </div>
                            {conn.invalidReason && (
                              <div className="truncate text-xs text-amber-500">
                                {conn.invalidReason}
                              </div>
                            )}
                          </div>
                          {!conn.valid && (
                            <TriangleAlert
                              className="size-3.5 shrink-0 text-amber-500"
                              aria-label={conn.invalidReason}
                            />
                          )}
                          {conn.authType === 'key' && (
                            <KeyRound className="size-3.5 shrink-0 text-muted-foreground" />
                          )}
                        </label>
                      ))}
                    </div>
                  </ScrollArea>
                </>
              )}
            </TabsContent>

            <TabsContent value="snippets" className="flex flex-col gap-2">
              {snippets.length === 0 ? (
                <p className="py-8 text-center text-sm text-muted-foreground">
                  No Termius snippets found.
                </p>
              ) : (
                <>
                  <label className="flex cursor-pointer items-center gap-2 text-sm">
                    <Checkbox
                      checked={selectedSnippets.size === snippets.length}
                      onCheckedChange={toggleAllSnippets}
                    />
                    Select all ({snippets.length})
                  </label>

                  <ScrollArea className="h-64 rounded-md border">
                    <div className="flex flex-col divide-y">
                      {snippets.map((snippet) => (
                        <label
                          key={snippet.localId}
                          className="flex cursor-pointer items-center gap-3 px-3 py-2 text-sm"
                        >
                          <Checkbox
                            checked={selectedSnippets.has(snippet.localId)}
                            onCheckedChange={() => toggleSnippet(snippet.localId)}
                          />
                          <div className="min-w-0 flex-1">
                            <div className="truncate font-medium">{snippet.name}</div>
                            <div className="truncate font-mono text-xs text-muted-foreground">
                              {snippet.command}
                            </div>
                          </div>
                          {snippet.termiusHostIds.length > 0 && (
                            <span className="shrink-0 text-xs text-muted-foreground">
                              {snippet.termiusHostIds.length} target
                              {snippet.termiusHostIds.length === 1 ? '' : 's'}
                            </span>
                          )}
                        </label>
                      ))}
                    </div>
                  </ScrollArea>
                  <p className="text-xs text-muted-foreground">
                    Targets only carry over for connections imported in this same run.
                  </p>
                </>
              )}
            </TabsContent>
          </Tabs>
        )}

        {!loading && !error && !result && connections.length === 0 && snippets.length === 0 && (
          <p className="text-sm text-muted-foreground">Nothing found to import.</p>
        )}
        </div>

        <DialogFooter>
          {!result ? (
            <Button
              onClick={runImport}
              disabled={loading || Boolean(error) || totalSelected === 0 || importing}
            >
              {importing ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <ScrollText className="size-4" />
              )}
              Import {totalSelected > 0 ? `(${totalSelected})` : ''}
            </Button>
          ) : (
            <Button onClick={() => onOpenChange(false)}>Done</Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
