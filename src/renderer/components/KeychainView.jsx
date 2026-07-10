import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { KEY_TYPE_OPTIONS, keyTypeLabel } from '@/lib/keys';
import { KeyRound, Plus, Trash2, Copy, Check, Loader2, ClipboardPaste } from 'lucide-react';

const TEXTAREA_CLASS =
  'w-full resize-none rounded-md border border-input bg-transparent px-3 py-2 font-mono text-xs shadow-xs outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50';

function GenerateKeySheet({ open, onOpenChange, onGenerated }) {
  const [name, setName] = useState('');
  const [type, setType] = useState('ed25519');
  const [bits, setBits] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    setName('');
    setType('ed25519');
    setBits(null);
    setError(null);
  }, [open]);

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
    onOpenChange(false);
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-96 gap-0 sm:max-w-md">
        <SheetHeader className="border-b">
          <SheetTitle>Generate key</SheetTitle>
          <SheetDescription>
            The key pair is created locally and stored encrypted in the vault.
          </SheetDescription>
        </SheetHeader>

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
      </SheetContent>
    </Sheet>
  );
}

function ImportKeySheet({ open, onOpenChange, onImported }) {
  const [name, setName] = useState('');
  const [privateKey, setPrivateKey] = useState('');
  const [publicKey, setPublicKey] = useState('');
  const [passphrase, setPassphrase] = useState('');
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    setName('');
    setPrivateKey('');
    setPublicKey('');
    setPassphrase('');
    setError(null);
  }, [open]);

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
    onOpenChange(false);
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-96 gap-0 sm:max-w-md">
        <SheetHeader className="border-b">
          <SheetTitle>Import key</SheetTitle>
          <SheetDescription>
            Paste an existing key pair. Both halves are stored encrypted in the vault.
          </SheetDescription>
        </SheetHeader>

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
      </SheetContent>
    </Sheet>
  );
}

function KeyRow({ keyItem, onDelete }) {
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 1500);
    return () => clearTimeout(timer);
  }, [copied]);

  async function copyPublicKey() {
    await navigator.clipboard.writeText(keyItem.public);
    setCopied(true);
  }

  return (
    <div className="group flex items-center gap-3 rounded-lg px-3 py-2 hover:bg-accent">
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
          onClick={() => onDelete(keyItem)}
          title="Delete key"
          className="rounded-md p-1.5 text-muted-foreground hover:bg-background hover:text-destructive"
        >
          <Trash2 className="size-3.5" />
        </button>
      </div>
    </div>
  );
}

export default function KeychainView() {
  const [keys, setKeys] = useState([]);
  const [generateOpen, setGenerateOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);

  useEffect(() => {
    (async () => {
      const result = await window.api.keysList();
      if (!result.error) setKeys(result.keys);
    })();
  }, []);

  async function deleteKey(keyItem) {
    const confirmed = window.confirm(
      `Delete key "${keyItem.name}"? Hosts using it will no longer authenticate with it. This cannot be undone.`
    );
    if (!confirmed) return;

    const result = await window.api.keysDelete(keyItem.id);
    if (!result.error) setKeys(result.keys);
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between gap-3 border-b px-4 py-3">
        <p className="text-sm font-medium">Keychain</p>
        <div className="flex shrink-0 items-center gap-2">
          <Button variant="outline" onClick={() => setImportOpen(true)}>
            <ClipboardPaste className="size-4" /> Import Key
          </Button>
          <Button onClick={() => setGenerateOpen(true)}>
            <Plus className="size-4" /> Generate Key
          </Button>
        </div>
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
              <Button size="sm" variant="outline" onClick={() => setImportOpen(true)}>
                <ClipboardPaste className="size-4" /> Import Key
              </Button>
              <Button size="sm" onClick={() => setGenerateOpen(true)}>
                <Plus className="size-4" /> Generate Key
              </Button>
            </div>
          </div>
        ) : (
          <>
            <p className="px-3 pb-2 text-xs font-medium uppercase tracking-wider text-muted-foreground">
              Keys — {keys.length}
            </p>
            <div className="flex flex-col gap-0.5">
              {keys.map((keyItem) => (
                <KeyRow key={keyItem.id} keyItem={keyItem} onDelete={deleteKey} />
              ))}
            </div>
          </>
        )}
      </div>

      <GenerateKeySheet open={generateOpen} onOpenChange={setGenerateOpen} onGenerated={setKeys} />
      <ImportKeySheet open={importOpen} onOpenChange={setImportOpen} onImported={setKeys} />
    </div>
  );
}
