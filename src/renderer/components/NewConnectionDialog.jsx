import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { SlidePanel, PanelHeader } from '@/components/SlidePanel';
import { FolderOpen, KeyRound } from 'lucide-react';
import { keyTypeLabel } from '@/lib/keys';

const EMPTY_FORM = {
  label: '',
  host: '',
  port: '22',
  username: '',
  password: '',
  privateKeyPath: '',
  passphrase: '',
  keyId: '',
  saveToVault: false,
};

// Empty strings are sent on purpose: saving a host merges into the stored
// record, so '' clears the auth methods the user switched away from.
function buildCredential(authType, form) {
  if (authType === 'key') {
    const cred = { privateKeyPath: form.privateKeyPath, keyId: '' };
    if (form.passphrase) cred.passphrase = form.passphrase;
    return cred;
  }
  if (authType === 'keychain') {
    // Password is optional here: it lets the first connection in, and the
    // public key is auto-installed on the host during that session.
    const cred = { keyId: form.keyId, privateKeyPath: '' };
    if (form.password) cred.password = form.password;
    return cred;
  }
  const cred = { privateKeyPath: '', keyId: '' };
  if (form.password) cred.password = form.password;
  return cred;
}

export default function NewConnectionDialog({ open, onOpenChange, onConnect, editingHost, onSaved }) {
  const mode = editingHost ? 'edit' : 'add';
  const [form, setForm] = useState(EMPTY_FORM);
  const [authType, setAuthType] = useState('password');
  const [keys, setKeys] = useState([]);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    setError(null);

    (async () => {
      const result = await window.api.keysList();
      if (!result.error) setKeys(result.keys);
    })();

    if (editingHost) {
      setForm({
        ...EMPTY_FORM,
        label: editingHost.label || '',
        host: editingHost.host || '',
        port: String(editingHost.port || 22),
        username: editingHost.username || '',
        privateKeyPath: editingHost.privateKeyPath || '',
        keyId: editingHost.keyId || '',
        saveToVault: true,
      });
      setAuthType(
        editingHost.keyId ? 'keychain' : editingHost.hasPrivateKey ? 'key' : 'password'
      );
    } else {
      setForm(EMPTY_FORM);
      setAuthType('password');
    }
  }, [open, editingHost]);

  function update(field, value) {
    setForm((prev) => ({ ...prev, [field]: value }));
  }

  async function handleBrowse() {
    const result = await window.api.selectPrivateKey();
    if (result.path) update('privateKeyPath', result.path);
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setError(null);

    if (!form.host || !form.username) {
      setError('Host and username are required');
      return;
    }
    if (authType === 'keychain' && !form.keyId) {
      setError('Select a key from the Keychain');
      return;
    }

    const credential = buildCredential(authType, form);

    setBusy(true);
    try {
      if (mode === 'edit') {
        const result = await window.api.hostsSave({
          id: editingHost.id,
          label: form.label || form.host,
          host: form.host,
          port: Number(form.port) || 22,
          username: form.username,
          ...credential,
        });
        if (result.error) throw new Error(result.error);
        onSaved?.(result.hosts);
        onOpenChange(false);
        return;
      }

      let connectConfig;
      if (form.saveToVault) {
        const result = await window.api.hostsSave({
          label: form.label || form.host,
          host: form.host,
          port: Number(form.port) || 22,
          username: form.username,
          ...credential,
        });
        if (result.error) throw new Error(result.error);
        const saved = result.hosts[result.hosts.length - 1];
        connectConfig = { hostId: saved.id };
        onSaved?.(result.hosts);
      } else {
        connectConfig = {
          host: form.host,
          port: Number(form.port) || 22,
          username: form.username,
          ...credential,
        };
      }

      await onConnect(connectConfig, form.label || form.host);
      onOpenChange(false);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <SlidePanel open={open} onClose={() => onOpenChange(false)}>
      <div className="flex h-full flex-col">
        <PanelHeader
          title={mode === 'edit' ? 'Edit connection' : 'New connection'}
          description={
            mode === 'edit'
              ? 'Update this saved host. Leave password/passphrase blank to keep the current value.'
              : 'Connect to a remote server over SSH.'
          }
          onClose={() => onOpenChange(false)}
        />

        <form
          onSubmit={handleSubmit}
          className="flex flex-1 flex-col gap-4 overflow-y-auto p-4"
        >
          <div className="grid grid-cols-3 gap-3">
            <div className="col-span-2 flex flex-col gap-2">
              <Label htmlFor="host">Host</Label>
              <Input
                id="host"
                placeholder="example.com"
                value={form.host}
                onChange={(e) => update('host', e.target.value)}
              />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="port">Port</Label>
              <Input id="port" value={form.port} onChange={(e) => update('port', e.target.value)} />
            </div>
          </div>

          <div className="flex flex-col gap-2">
            <Label htmlFor="username">Username</Label>
            <Input
              id="username"
              value={form.username}
              onChange={(e) => update('username', e.target.value)}
            />
          </div>

          <Tabs value={authType} onValueChange={setAuthType}>
            <TabsList className="w-full">
              <TabsTrigger value="password">Password</TabsTrigger>
              <TabsTrigger value="key">Key file</TabsTrigger>
              <TabsTrigger value="keychain">Keychain</TabsTrigger>
            </TabsList>

            <TabsContent value="password" className="flex flex-col gap-2 pt-2">
              <Label htmlFor="password">Password</Label>
              <Input
                id="password"
                type="password"
                placeholder={
                  mode === 'edit' && editingHost?.hasPassword ? 'Leave blank to keep current password' : ''
                }
                value={form.password}
                onChange={(e) => update('password', e.target.value)}
              />
            </TabsContent>

            <TabsContent value="key" className="flex flex-col gap-3 pt-2">
              <div className="flex flex-col gap-2">
                <Label htmlFor="key-path">Private key file</Label>
                <div className="flex gap-2">
                  <Input
                    id="key-path"
                    value={form.privateKeyPath}
                    onChange={(e) => update('privateKeyPath', e.target.value)}
                    placeholder="~/.ssh/id_ed25519"
                  />
                  <Button type="button" variant="outline" size="icon" onClick={handleBrowse}>
                    <FolderOpen className="size-4" />
                  </Button>
                </div>
              </div>
              <div className="flex flex-col gap-2">
                <Label htmlFor="passphrase">Passphrase (optional)</Label>
                <Input
                  id="passphrase"
                  type="password"
                  placeholder={
                    mode === 'edit' && editingHost?.hasPassphrase
                      ? 'Leave blank to keep current passphrase'
                      : ''
                  }
                  value={form.passphrase}
                  onChange={(e) => update('passphrase', e.target.value)}
                />
              </div>
            </TabsContent>

            <TabsContent value="keychain" className="flex flex-col gap-3 pt-2">
              {keys.length === 0 ? (
                <p className="rounded-md border border-dashed px-3 py-4 text-center text-sm text-muted-foreground">
                  No keys in the Keychain yet — generate one under Hosts → Keychain.
                </p>
              ) : (
                <div className="flex max-h-40 flex-col gap-1 overflow-y-auto">
                  {keys.map((keyItem) => (
                    <button
                      key={keyItem.id}
                      type="button"
                      onClick={() => update('keyId', keyItem.id)}
                      className={`flex items-center gap-2.5 rounded-md border px-2.5 py-1.5 text-left text-sm ${
                        form.keyId === keyItem.id
                          ? 'border-primary bg-accent'
                          : 'border-transparent hover:bg-accent/50'
                      }`}
                    >
                      <KeyRound className="size-3.5 shrink-0 text-muted-foreground" />
                      <span className="min-w-0 flex-1 truncate">{keyItem.name}</span>
                      <span className="shrink-0 text-xs text-muted-foreground">
                        {keyTypeLabel(keyItem)}
                      </span>
                    </button>
                  ))}
                </div>
              )}

              <div className="flex flex-col gap-2">
                <Label htmlFor="keychain-password">Password (optional)</Label>
                <Input
                  id="keychain-password"
                  type="password"
                  placeholder={
                    mode === 'edit' && editingHost?.hasPassword
                      ? 'Leave blank to keep current password'
                      : ''
                  }
                  value={form.password}
                  onChange={(e) => update('password', e.target.value)}
                />
                <p className="text-xs text-muted-foreground">
                  Used for the first connection; the public key is then installed on the host
                  automatically so future logins use the key.
                </p>
              </div>
            </TabsContent>
          </Tabs>

          {mode === 'add' && (
            <div className="flex flex-col gap-2">
              <Label htmlFor="save-toggle" className="flex items-center gap-2 font-normal">
                <Checkbox
                  id="save-toggle"
                  checked={form.saveToVault}
                  onCheckedChange={(checked) => update('saveToVault', checked === true)}
                />
                Save this host to the vault
              </Label>
              {form.saveToVault && (
                <Input
                  placeholder="Label (optional)"
                  value={form.label}
                  onChange={(e) => update('label', e.target.value)}
                />
              )}
            </div>
          )}

          {mode === 'edit' && (
            <div className="flex flex-col gap-2">
              <Label htmlFor="edit-label">Label</Label>
              <Input
                id="edit-label"
                placeholder="Label (optional)"
                value={form.label}
                onChange={(e) => update('label', e.target.value)}
              />
            </div>
          )}

          {error && <p className="text-sm text-destructive">{error}</p>}

          <div className="mt-auto pt-2">
            <Button type="submit" disabled={busy} className="w-full">
              {busy ? 'Please wait…' : mode === 'edit' ? 'Save changes' : 'Connect'}
            </Button>
          </div>
        </form>
      </div>
    </SlidePanel>
  );
}
