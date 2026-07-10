import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { FolderOpen } from 'lucide-react';

const EMPTY_FORM = {
  label: '',
  host: '',
  port: '22',
  username: '',
  password: '',
  privateKeyPath: '',
  passphrase: '',
  saveToVault: false,
};

function buildCredential(authType, form) {
  if (authType === 'key') {
    const cred = { privateKeyPath: form.privateKeyPath };
    if (form.passphrase) cred.passphrase = form.passphrase;
    return cred;
  }
  const cred = {};
  if (form.password) cred.password = form.password;
  return cred;
}

export default function NewConnectionDialog({ open, onOpenChange, onConnect, editingHost, onSaved }) {
  const mode = editingHost ? 'edit' : 'add';
  const [form, setForm] = useState(EMPTY_FORM);
  const [authType, setAuthType] = useState('password');
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    setError(null);

    if (editingHost) {
      setForm({
        ...EMPTY_FORM,
        label: editingHost.label || '',
        host: editingHost.host || '',
        port: String(editingHost.port || 22),
        username: editingHost.username || '',
        privateKeyPath: editingHost.privateKeyPath || '',
        saveToVault: true,
      });
      setAuthType(editingHost.hasPrivateKey ? 'key' : 'password');
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
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{mode === 'edit' ? 'Edit connection' : 'New connection'}</DialogTitle>
          <DialogDescription>
            {mode === 'edit'
              ? 'Update this saved host. Leave password/passphrase blank to keep the current value.'
              : 'Connect to a remote server over SSH.'}
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
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
              <TabsTrigger value="key">Private key</TabsTrigger>
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
          </Tabs>

          {mode === 'add' && (
            <div className="flex flex-col gap-2">
              <Label htmlFor="save-toggle" className="flex items-center gap-2 font-normal">
                <input
                  id="save-toggle"
                  type="checkbox"
                  checked={form.saveToVault}
                  onChange={(e) => update('saveToVault', e.target.checked)}
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

          <DialogFooter>
            <Button type="submit" disabled={busy}>
              {busy ? 'Please wait…' : mode === 'edit' ? 'Save changes' : 'Connect'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
