import { useEffect, useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
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
import { SlidePanel, PanelHeader } from '@/components/SlidePanel';
import { ColorPicker } from '@/components/ColorPicker';
import { GridCard, ViewToggle, GRID_CLASS } from '@/components/GridCard';
import CopyKeyToHostDialog from '@/components/CopyKeyToHostDialog';
import { useViewMode } from '@/lib/view-mode';
import { KEY_TYPE_OPTIONS, keyTypeLabel } from '@/lib/keys';
import { useConfirm } from '@/lib/confirm';
import {
  KeyRound,
  Plus,
  Trash2,
  Copy,
  Check,
  Loader2,
  ClipboardPaste,
  ChevronDown,
  Eye,
  EyeOff,
  Pencil,
  Search,
  Server,
} from 'lucide-react';

const TEXTAREA_CLASS =
  'w-full resize-none rounded-md border border-input bg-transparent px-3 py-2 font-mono text-xs shadow-xs outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50';

function CopyButton({ value, label = 'Copy' }) {
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 1500);
    return () => clearTimeout(timer);
  }, [copied]);

  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      onClick={async () => {
        await navigator.clipboard.writeText(value);
        setCopied(true);
      }}
    >
      {copied ? <Check className="size-3.5 text-emerald-500" /> : <Copy className="size-3.5" />}
      {copied ? 'Copied' : label}
    </Button>
  );
}

function KeyDetailPanel({ keyItem, onDelete, onClose, onColorChange, onCopyToHost }) {
  const [privateKey, setPrivateKey] = useState(null);
  const [revealBusy, setRevealBusy] = useState(false);
  const [revealError, setRevealError] = useState(null);

  useEffect(() => {
    setPrivateKey(null);
    setRevealBusy(false);
    setRevealError(null);
  }, [keyItem.id]);

  async function revealPrivateKey() {
    setRevealError(null);
    setRevealBusy(true);
    const result = await window.api.keysReveal(keyItem.id);
    setRevealBusy(false);
    if (result.error) {
      setRevealError(result.error);
      return;
    }
    setPrivateKey(result.private);
  }

  return (
    <div className="flex h-full flex-col">
      <PanelHeader title={keyItem.name} description={keyTypeLabel(keyItem)} onClose={onClose} />

      <div className="flex flex-1 flex-col gap-5 overflow-y-auto p-4">
        <div className="flex flex-col gap-2">
          <Label>Icon color</Label>
          <ColorPicker value={keyItem.color} onChange={(color) => onColorChange(keyItem, color)} />
        </div>

        <div className="flex flex-col gap-2">
          <Label htmlFor="detail-public">Public key</Label>
          <textarea
            id="detail-public"
            rows={6}
            readOnly
            value={keyItem.public}
            spellCheck={false}
            onFocus={(e) => e.target.select()}
            className={TEXTAREA_CLASS}
          />
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" size="sm" onClick={() => onCopyToHost(keyItem)}>
              <Server className="size-3.5" /> Copy to host…
            </Button>
            <CopyButton key={keyItem.id} value={keyItem.public} label="Copy public key" />
          </div>
        </div>

        <div className="flex flex-col gap-2">
          <Label htmlFor="detail-private">Private key</Label>
          {privateKey ? (
            <>
              <textarea
                id="detail-private"
                rows={8}
                readOnly
                value={privateKey}
                spellCheck={false}
                onFocus={(e) => e.target.select()}
                className={TEXTAREA_CLASS}
              />
              <div className="flex justify-between">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setPrivateKey(null)}
                >
                  <EyeOff className="size-3.5" /> Hide
                </Button>
                <CopyButton value={privateKey} label="Copy private key" />
              </div>
            </>
          ) : (
            <>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="self-start"
                disabled={revealBusy}
                onClick={revealPrivateKey}
              >
                {revealBusy ? (
                  <Loader2 className="size-3.5 animate-spin" />
                ) : (
                  <Eye className="size-3.5" />
                )}
                Reveal private key
              </Button>
              <p className="text-xs text-muted-foreground">
                Stored encrypted in the vault. Anyone with this key can log in to your servers.
              </p>
            </>
          )}
          {revealError && <p className="text-sm text-destructive">{revealError}</p>}
        </div>

        <div className="mt-auto border-t pt-4">
          <Button
            type="button"
            variant="outline"
            className="w-full text-destructive hover:text-destructive"
            onClick={() => onDelete(keyItem)}
          >
            <Trash2 className="size-4" /> Delete key
          </Button>
          <p className="mt-2 text-xs text-muted-foreground">
            Hosts using this key will no longer authenticate with it.
          </p>
        </div>
      </div>
    </div>
  );
}

function GenerateKeyPanel({ onGenerated, onClose }) {
  const [name, setName] = useState('');
  const [type, setType] = useState('ed25519');
  const [bits, setBits] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  const typeOption = KEY_TYPE_OPTIONS.find((o) => o.type === type);

  function pickType(option) {
    setType(option.type);
    setBits(option.defaultBits);
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setError(null);
    if (!name.trim()) {
      setError('Key name is required');
      return;
    }

    setBusy(true);
    const result = await window.api.keysGenerate({ name: name.trim(), type, bits });
    setBusy(false);

    if (result.error) {
      setError(result.error);
      return;
    }
    onGenerated(result.keys);
  }

  return (
    <div className="flex h-full flex-col">
      <PanelHeader
        title="Generate key"
        description="The key pair is created locally and stored encrypted in the vault."
        onClose={onClose}
      />

      <form onSubmit={handleSubmit} className="flex flex-1 flex-col gap-4 overflow-y-auto p-4">
        <div className="flex flex-col gap-2">
          <Label htmlFor="key-name">Name</Label>
          <Input
            id="key-name"
            placeholder="my-server-key"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </div>

        <div className="flex flex-col gap-2">
          <Label>Type</Label>
          <div className="flex gap-2">
            {KEY_TYPE_OPTIONS.map((option) => (
              <Button
                key={option.type}
                type="button"
                size="sm"
                variant={type === option.type ? 'default' : 'outline'}
                onClick={() => pickType(option)}
              >
                {option.label}
              </Button>
            ))}
          </div>
          {type === 'ed25519' && (
            <p className="text-xs text-muted-foreground">
              Recommended: small, fast, and modern.
            </p>
          )}
        </div>

        {typeOption.bits.length > 0 && (
          <div className="flex flex-col gap-2">
            <Label>{type === 'ecdsa' ? 'Curve size' : 'Key size'}</Label>
            <div className="flex gap-2">
              {typeOption.bits.map((size) => (
                <Button
                  key={size}
                  type="button"
                  size="sm"
                  variant={bits === size ? 'default' : 'outline'}
                  onClick={() => setBits(size)}
                >
                  {size}
                </Button>
              ))}
            </div>
          </div>
        )}

        {error && <p className="text-sm text-destructive">{error}</p>}

        <div className="mt-auto pt-2">
          <Button type="submit" disabled={busy} className="w-full">
            {busy ? (
              <>
                <Loader2 className="size-4 animate-spin" /> Generating…
              </>
            ) : (
              'Generate'
            )}
          </Button>
        </div>
      </form>
    </div>
  );
}

function ImportKeyPanel({ onImported, onClose }) {
  const [name, setName] = useState('');
  const [privateKey, setPrivateKey] = useState('');
  const [publicKey, setPublicKey] = useState('');
  const [passphrase, setPassphrase] = useState('');
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    setError(null);
    if (!name.trim()) {
      setError('Key name is required');
      return;
    }
    if (!privateKey.trim()) {
      setError('Paste the private key');
      return;
    }

    setBusy(true);
    const result = await window.api.keysImport({
      name: name.trim(),
      privateKey,
      publicKey: publicKey.trim() || undefined,
      passphrase: passphrase || undefined,
    });
    setBusy(false);

    if (result.error) {
      setError(result.error);
      return;
    }
    onImported(result.keys);
  }

  return (
    <div className="flex h-full flex-col">
      <PanelHeader
        title="Import key"
        description="Paste an existing key pair. Both halves are stored encrypted in the vault."
        onClose={onClose}
      />

      <form onSubmit={handleSubmit} className="flex flex-1 flex-col gap-4 overflow-y-auto p-4">
        <div className="flex flex-col gap-2">
          <Label htmlFor="import-name">Name</Label>
          <Input
            id="import-name"
            placeholder="my-laptop-key"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </div>

        <div className="flex flex-col gap-2">
          <Label htmlFor="import-key">Private key</Label>
          <textarea
            id="import-key"
            rows={7}
            placeholder={
              '-----BEGIN OPENSSH PRIVATE KEY-----\n…\n-----END OPENSSH PRIVATE KEY-----'
            }
            value={privateKey}
            onChange={(e) => setPrivateKey(e.target.value)}
            spellCheck={false}
            className={TEXTAREA_CLASS}
          />
        </div>

        <div className="flex flex-col gap-2">
          <Label htmlFor="import-public">Public key (optional)</Label>
          <textarea
            id="import-public"
            rows={3}
            placeholder="ssh-ed25519 AAAA… comment"
            value={publicKey}
            onChange={(e) => setPublicKey(e.target.value)}
            spellCheck={false}
            className={TEXTAREA_CLASS}
          />
          <p className="text-xs text-muted-foreground">
            Left empty, it is derived from the private key. If pasted, it must match.
          </p>
        </div>

        <div className="flex flex-col gap-2">
          <Label htmlFor="import-passphrase">Passphrase (only if the key has one)</Label>
          <Input
            id="import-passphrase"
            type="password"
            value={passphrase}
            onChange={(e) => setPassphrase(e.target.value)}
          />
        </div>

        {error && <p className="text-sm text-destructive">{error}</p>}

        <div className="mt-auto pt-2">
          <Button type="submit" disabled={busy} className="w-full">
            {busy ? 'Importing…' : 'Import'}
          </Button>
        </div>
      </form>
    </div>
  );
}

function KeyContextMenu({ keyItem, onEdit, onDelete, onCopyToHost, children }) {
  async function copyPublicKey() {
    await navigator.clipboard.writeText(keyItem.public);
  }

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>{children}</ContextMenuTrigger>
      <ContextMenuContent>
        <ContextMenuItem onClick={() => onEdit(keyItem)}>
          <Pencil className="size-4" /> Edit
          <ContextMenuShortcut>E</ContextMenuShortcut>
        </ContextMenuItem>
        <ContextMenuItem onClick={copyPublicKey}>
          <Copy className="size-4" /> Copy public key
        </ContextMenuItem>
        <ContextMenuItem onClick={() => onCopyToHost(keyItem)}>
          <Server className="size-4" /> Copy to host…
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem variant="destructive" onClick={() => onDelete(keyItem)}>
          <Trash2 className="size-4" /> Remove
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
}

function KeyRow({ keyItem, selected, onSelect, onDelete, onCopyToHost }) {
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 1500);
    return () => clearTimeout(timer);
  }, [copied]);

  async function copyPublicKey(e) {
    e.stopPropagation();
    await navigator.clipboard.writeText(keyItem.public);
    setCopied(true);
  }

  return (
    <KeyContextMenu keyItem={keyItem} onEdit={onSelect} onDelete={onDelete} onCopyToHost={onCopyToHost}>
      <div
        onClick={() => onSelect(keyItem)}
        className={`group flex cursor-pointer items-center gap-3 rounded-lg px-3 py-2 transition-colors ${
          selected ? 'bg-accent' : 'hover:bg-accent/60'
        }`}
      >
        <span className="flex size-9 shrink-0 items-center justify-center rounded-lg border bg-muted text-muted-foreground">
          <KeyRound className="size-4" />
        </span>

        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium">{keyItem.name}</p>
          <p className="truncate text-xs text-muted-foreground">
            {keyTypeLabel(keyItem)} · {keyItem.fingerprint}
          </p>
        </div>

        <div className="hidden shrink-0 items-center gap-1 group-hover:flex">
          <button
            onClick={copyPublicKey}
            title="Copy public key"
            className="rounded-md p-1.5 text-muted-foreground hover:bg-background hover:text-foreground"
          >
            {copied ? <Check className="size-3.5 text-emerald-500" /> : <Copy className="size-3.5" />}
          </button>
          <button
            onClick={(e) => {
              e.stopPropagation();
              onDelete(keyItem);
            }}
            title="Delete key"
            className="rounded-md p-1.5 text-muted-foreground hover:bg-background hover:text-destructive"
          >
            <Trash2 className="size-3.5" />
          </button>
        </div>
      </div>
    </KeyContextMenu>
  );
}

function KeyGridCard({ keyItem, selected, onSelect, onDelete, onCopyToHost }) {
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 1500);
    return () => clearTimeout(timer);
  }, [copied]);

  async function copyPublicKey(e) {
    e.stopPropagation();
    await navigator.clipboard.writeText(keyItem.public);
    setCopied(true);
  }

  return (
    <KeyContextMenu keyItem={keyItem} onEdit={onSelect} onDelete={onDelete} onCopyToHost={onCopyToHost}>
      <GridCard
        id={keyItem.id}
        tone={keyItem.color || 'chart-2'}
        icon={KeyRound}
        title={keyItem.name}
        subtitle={`${keyTypeLabel(keyItem)} · ${keyItem.fingerprint}`}
        onClick={() => onSelect(keyItem)}
        actions={
          <>
            <button
              onClick={copyPublicKey}
              title="Copy public key"
              className="rounded-md p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground"
            >
              {copied ? <Check className="size-3.5 text-emerald-500" /> : <Copy className="size-3.5" />}
            </button>
            <button
              onClick={(e) => {
                e.stopPropagation();
                onDelete(keyItem);
              }}
              title="Delete key"
              className="rounded-md p-1.5 text-muted-foreground hover:bg-muted hover:text-destructive"
            >
              <Trash2 className="size-3.5" />
            </button>
          </>
        }
        className={selected ? 'ring-1 ring-primary' : ''}
      />
    </KeyContextMenu>
  );
}

export default function KeychainView({ onNewHost }) {
  const confirm = useConfirm();
  const [keys, setKeys] = useState([]);
  const [query, setQuery] = useState('');
  const [viewMode, setViewMode] = useViewMode('keychain');
  const [panel, setPanel] = useState(null);
  const [renderedPanel, setRenderedPanel] = useState(null);
  const [copyToHostKey, setCopyToHostKey] = useState(null);

  useEffect(() => {
    (async () => {
      const result = await window.api.keysList();
      if (!result.error) setKeys(result.keys);
    })();
  }, []);

  useEffect(() => {
    if (panel) {
      setRenderedPanel(panel);
      return;
    }
    const timer = setTimeout(() => setRenderedPanel(null), 300);
    return () => clearTimeout(timer);
  }, [panel]);

  function closePanel() {
    setPanel(null);
  }

  function selectKey(keyItem) {
    setPanel((prev) =>
      prev?.mode === 'detail' && prev.keyId === keyItem.id
        ? null
        : { mode: 'detail', keyId: keyItem.id }
    );
  }

  function showNewKey(nextKeys) {
    const fresh = nextKeys.find((k) => !keys.some((o) => o.id === k.id));
    setKeys(nextKeys);
    setPanel(fresh ? { mode: 'detail', keyId: fresh.id } : null);
  }

  async function deleteKey(keyItem) {
    const confirmed = await confirm({
      title: 'Delete key',
      description: `Delete key "${keyItem.name}"? Hosts using it will no longer authenticate with it. This cannot be undone.`,
      confirmText: 'Delete',
      destructive: true,
    });
    if (!confirmed) return;

    const result = await window.api.keysDelete(keyItem.id);
    if (result.error) return;
    setKeys(result.keys);
    setPanel((prev) => (prev?.mode === 'detail' && prev.keyId === keyItem.id ? null : prev));
  }

  async function changeKeyColor(keyItem, color) {
    const result = await window.api.keysSetColor(keyItem.id, color);
    if (!result.error) setKeys(result.keys);
  }

  const detailKey =
    renderedPanel?.mode === 'detail' ? keys.find((k) => k.id === renderedPanel.keyId) : null;

  const filteredKeys = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return keys;
    return keys.filter((k) =>
      [k.name, k.fingerprint, keyTypeLabel(k)].some((v) => v && v.toLowerCase().includes(q))
    );
  }, [keys, query]);

  return (
    <div className="flex h-full overflow-hidden">
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex items-center gap-2 border-b px-4 py-3">
          <div className="flex shrink-0 items-stretch">
            <Button
              onClick={() => setPanel({ mode: 'generate', nonce: Date.now() })}
              className="rounded-r-none"
            >
              <Plus className="size-4" /> New key
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  className="rounded-l-none border-l border-primary-foreground/15 px-2"
                  aria-label="More new key options"
                >
                  <ChevronDown className="size-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent>
                <DropdownMenuItem onClick={() => setPanel({ mode: 'generate', nonce: Date.now() })}>
                  <Plus className="size-4" /> Generate key
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => setPanel({ mode: 'import', nonce: Date.now() })}>
                  <ClipboardPaste className="size-4" /> Import key
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>

          <div className="flex-1" />

          <div className="relative w-64 shrink-0">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Find a key…"
              className="pl-8"
            />
          </div>
          <ViewToggle mode={viewMode} onChange={setViewMode} />
        </div>

        <div className="flex-1 overflow-y-auto p-4">
          {keys.length === 0 ? (
            <div className="flex h-full flex-col items-center justify-center gap-3 text-center">
              <span className="flex size-12 items-center justify-center rounded-xl border bg-muted text-muted-foreground">
                <KeyRound className="size-6" />
              </span>
              <div>
                <p className="text-sm font-medium">No keys yet</p>
                <p className="text-sm text-muted-foreground">
                  Generate an SSH key pair, or import one you already have.
                </p>
              </div>
              <div className="flex gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => setPanel({ mode: 'import', nonce: Date.now() })}
                >
                  <ClipboardPaste className="size-4" /> Import Key
                </Button>
                <Button size="sm" onClick={() => setPanel({ mode: 'generate', nonce: Date.now() })}>
                  <Plus className="size-4" /> Generate Key
                </Button>
              </div>
            </div>
          ) : (
            <>
              <p className="px-3 pb-2 text-xs font-medium uppercase tracking-wider text-muted-foreground">
                Keys — {filteredKeys.length}
              </p>
              {filteredKeys.length === 0 ? (
                <p className="px-3 py-8 text-center text-sm text-muted-foreground">
                  No keys match “{query}”.
                </p>
              ) : viewMode === 'grid' ? (
                <div className={GRID_CLASS}>
                  {filteredKeys.map((keyItem) => (
                    <KeyGridCard
                      key={keyItem.id}
                      keyItem={keyItem}
                      selected={panel?.mode === 'detail' && panel.keyId === keyItem.id}
                      onSelect={selectKey}
                      onDelete={deleteKey}
                      onCopyToHost={setCopyToHostKey}
                    />
                  ))}
                </div>
              ) : (
                <div className="flex flex-col gap-0.5">
                  {filteredKeys.map((keyItem) => (
                    <KeyRow
                      key={keyItem.id}
                      keyItem={keyItem}
                      selected={panel?.mode === 'detail' && panel.keyId === keyItem.id}
                      onSelect={selectKey}
                      onDelete={deleteKey}
                      onCopyToHost={setCopyToHostKey}
                    />
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      </div>

      <SlidePanel open={Boolean(panel)} onClose={closePanel}>
        {renderedPanel?.mode === 'detail' && detailKey && (
          <KeyDetailPanel
            keyItem={detailKey}
            onDelete={deleteKey}
            onClose={closePanel}
            onColorChange={changeKeyColor}
            onCopyToHost={setCopyToHostKey}
          />
        )}
        {renderedPanel?.mode === 'generate' && (
          <GenerateKeyPanel
            key={`generate-${renderedPanel.nonce}`}
            onGenerated={showNewKey}
            onClose={closePanel}
          />
        )}
        {renderedPanel?.mode === 'import' && (
          <ImportKeyPanel
            key={`import-${renderedPanel.nonce}`}
            onImported={showNewKey}
            onClose={closePanel}
          />
        )}
      </SlidePanel>

      {copyToHostKey && (
        <CopyKeyToHostDialog
          keyItem={copyToHostKey}
          open={Boolean(copyToHostKey)}
          onOpenChange={(next) => !next && setCopyToHostKey(null)}
          onNewHost={onNewHost}
        />
      )}
    </div>
  );
}
