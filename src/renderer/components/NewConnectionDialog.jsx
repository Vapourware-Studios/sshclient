import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { SlidePanel, PanelHeader } from '@/components/SlidePanel';
import { ColorPicker } from '@/components/ColorPicker';
import { HostIconPicker } from '@/components/HostIconPicker';
import { FolderOpen, KeyRound, Server, TerminalSquare, Cable, RefreshCw } from 'lucide-react';
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
  color: null,
  icon: null,
};

const EMPTY_LOCAL_FORM = { label: '', shell: '', cwd: '' };
const EMPTY_SERIAL_FORM = { label: '', path: '', baudRate: '9600' };
const BAUD_PRESETS = [9600, 19200, 38400, 57600, 115200];

function buildCredential(authType, form) {
  if (authType === 'key') {
    const cred = { privateKeyPath: form.privateKeyPath, keyId: '' };
    if (form.passphrase) cred.passphrase = form.passphrase;
    return cred;
  }
  if (authType === 'keychain') {
    const cred = { keyId: form.keyId, privateKeyPath: '' };
    if (form.password) cred.password = form.password;
    return cred;
  }
  const cred = { privateKeyPath: '', keyId: '' };
  if (form.password) cred.password = form.password;
  return cred;
}

export default function NewConnectionDialog({
  open,
  onOpenChange,
  onConnect,
  editingHost,
  onSaved,
  initialType = 'ssh',
}) {
  const mode = editingHost ? 'edit' : 'add';
  const [connType, setConnType] = useState('ssh');
  const [form, setForm] = useState(EMPTY_FORM);
  const [authType, setAuthType] = useState('password');
  const [keys, setKeys] = useState([]);
  const [localForm, setLocalForm] = useState(EMPTY_LOCAL_FORM);
  const [serialForm, setSerialForm] = useState(EMPTY_SERIAL_FORM);
  const [serialPorts, setSerialPorts] = useState([]);
  const [serialPortsLoading, setSerialPortsLoading] = useState(false);
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
      setConnType('ssh');
      setForm({
        ...EMPTY_FORM,
        label: editingHost.label || '',
        host: editingHost.host || '',
        port: String(editingHost.port || 22),
        username: editingHost.username || '',
        privateKeyPath: editingHost.privateKeyPath || '',
        keyId: editingHost.keyId || '',
        saveToVault: true,
        color: editingHost.color || null,
        icon: editingHost.icon || null,
      });
      setAuthType(
        editingHost.keyId ? 'keychain' : editingHost.hasPrivateKey ? 'key' : 'password'
      );
    } else {
      setConnType(initialType);
      setForm(EMPTY_FORM);
      setAuthType('password');
      setLocalForm(EMPTY_LOCAL_FORM);
      setSerialForm(EMPTY_SERIAL_FORM);
      refreshSerialPorts();
    }
  }, [open, editingHost, initialType]);

  async function refreshSerialPorts() {
    setSerialPortsLoading(true);
    try {
      const result = await window.api.serialList();
      if (!result.error) setSerialPorts(result.ports);
    } finally {
      setSerialPortsLoading(false);
    }
  }

  function update(field, value) {
    setForm((prev) => ({ ...prev, [field]: value }));
  }

  function updateLocal(field, value) {
    setLocalForm((prev) => ({ ...prev, [field]: value }));
  }

  function updateSerial(field, value) {
    setSerialForm((prev) => ({ ...prev, [field]: value }));
  }

  async function handleBrowse() {
    const result = await window.api.selectPrivateKey();
    if (result.path) update('privateKeyPath', result.path);
  }

  async function handleBrowseCwd() {
    const result = await window.api.selectFolder();
    if (result.path) updateLocal('cwd', result.path);
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setError(null);

    if (mode === 'add' && connType !== 'ssh') {
      setBusy(true);
      try {
        if (connType === 'local') {
          const config = {};
          if (localForm.shell.trim()) config.shell = localForm.shell.trim();
          if (localForm.cwd.trim()) config.cwd = localForm.cwd.trim();
          await onConnect(config, localForm.label.trim() || 'Local Terminal', 'local');
        } else {
          if (!serialForm.path.trim()) throw new Error('Select or enter a serial port');
          const config = {
            path: serialForm.path.trim(),
            baudRate: Number(serialForm.baudRate) || 9600,
          };
          await onConnect(config, serialForm.label.trim() || serialForm.path.trim(), 'serial');
        }
        onOpenChange(false);
      } catch (err) {
        setError(err.message);
      } finally {
        setBusy(false);
      }
      return;
    }

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
          color: form.color,
          icon: form.icon,
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
          color: form.color,
          icon: form.icon,
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

      await onConnect(connectConfig, form.label || form.host, 'ssh');
      onOpenChange(false);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  const description =
    mode === 'edit'
      ? 'Update this saved host. Leave password/passphrase blank to keep the current value.'
      : connType === 'local'
        ? 'Open a terminal running a local shell.'
        : connType === 'serial'
          ? 'Connect to a device over a serial port.'
          : 'Connect to a remote server over SSH.';

  return (
    <SlidePanel open={open} onClose={() => onOpenChange(false)}>
      <div className="flex h-full flex-col">
        <PanelHeader
          title={mode === 'edit' ? 'Edit connection' : 'New connection'}
          description={description}
          onClose={() => onOpenChange(false)}
        />

        <form
          onSubmit={handleSubmit}
          className="flex flex-1 flex-col gap-4 overflow-y-auto p-4"
        >
          {mode === 'add' && (
            <Tabs value={connType} onValueChange={setConnType}>
              <TabsList className="w-full">
                <TabsTrigger value="ssh">
                  <Server className="size-3.5" /> SSH
                </TabsTrigger>
                <TabsTrigger value="local">
                  <TerminalSquare className="size-3.5" /> Local
                </TabsTrigger>
                <TabsTrigger value="serial">
                  <Cable className="size-3.5" /> Serial
                </TabsTrigger>
              </TabsList>
            </Tabs>
          )}

          {mode === 'add' && connType === 'local' && (
            <>
              <div className="flex flex-col gap-2">
                <Label htmlFor="local-label">Label (optional)</Label>
                <Input
                  id="local-label"
                  placeholder="Local Terminal"
                  value={localForm.label}
                  onChange={(e) => updateLocal('label', e.target.value)}
                />
              </div>
              <div className="flex flex-col gap-2">
                <Label htmlFor="local-shell">Shell (optional)</Label>
                <Input
                  id="local-shell"
                  placeholder={window.api.platform === 'win32' ? 'powershell.exe' : '/bin/zsh'}
                  value={localForm.shell}
                  onChange={(e) => updateLocal('shell', e.target.value)}
                />
              </div>
              <div className="flex flex-col gap-2">
                <Label htmlFor="local-cwd">Working directory (optional)</Label>
                <div className="flex gap-2">
                  <Input
                    id="local-cwd"
                    placeholder="~"
                    value={localForm.cwd}
                    onChange={(e) => updateLocal('cwd', e.target.value)}
                  />
                  <Button type="button" variant="outline" size="icon" onClick={handleBrowseCwd}>
                    <FolderOpen className="size-4" />
                  </Button>
                </div>
              </div>
            </>
          )}

          {mode === 'add' && connType === 'serial' && (
            <>
              <div className="flex flex-col gap-2">
                <Label htmlFor="serial-label">Label (optional)</Label>
                <Input
                  id="serial-label"
                  placeholder={serialForm.path || 'Serial device'}
                  value={serialForm.label}
                  onChange={(e) => updateSerial('label', e.target.value)}
                />
              </div>

              <div className="flex flex-col gap-2">
                <div className="flex items-center justify-between">
                  <Label>Port</Label>
                  <button
                    type="button"
                    onClick={refreshSerialPorts}
                    className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
                  >
                    <RefreshCw className={`size-3 ${serialPortsLoading ? 'animate-spin' : ''}`} />
                    Refresh
                  </button>
                </div>
                {serialPorts.length === 0 ? (
                  <p className="rounded-md border border-dashed px-3 py-4 text-center text-sm text-muted-foreground">
                    No serial ports found. Plug in a device and hit refresh.
                  </p>
                ) : (
                  <div className="flex max-h-40 flex-col gap-1 overflow-y-auto">
                    {serialPorts.map((p) => (
                      <button
                        key={p.path}
                        type="button"
                        onClick={() => updateSerial('path', p.path)}
                        className={`flex items-center gap-2.5 rounded-md border px-2.5 py-1.5 text-left text-sm ${
                          serialForm.path === p.path
                            ? 'border-primary bg-accent'
                            : 'border-transparent hover:bg-accent/50'
                        }`}
                      >
                        <Cable className="size-3.5 shrink-0 text-muted-foreground" />
                        <span className="min-w-0 flex-1 truncate">{p.path}</span>
                        {p.manufacturer && (
                          <span className="max-w-32 shrink-0 truncate text-xs text-muted-foreground">
                            {p.manufacturer}
                          </span>
                        )}
                      </button>
                    ))}
                  </div>
                )}
                <Input
                  placeholder="Or type a device path manually"
                  value={serialForm.path}
                  onChange={(e) => updateSerial('path', e.target.value)}
                />
              </div>

              <div className="flex flex-col gap-2">
                <Label htmlFor="serial-baud">Baud rate</Label>
                <Input
                  id="serial-baud"
                  value={serialForm.baudRate}
                  onChange={(e) => updateSerial('baudRate', e.target.value)}
                />
                <div className="flex flex-wrap gap-1.5">
                  {BAUD_PRESETS.map((b) => (
                    <button
                      key={b}
                      type="button"
                      onClick={() => updateSerial('baudRate', String(b))}
                      className={`rounded-md border px-2 py-1 text-xs ${
                        serialForm.baudRate === String(b)
                          ? 'border-primary bg-accent'
                          : 'border-transparent text-muted-foreground hover:bg-accent/50'
                      }`}
                    >
                      {b}
                    </button>
                  ))}
                </div>
              </div>
            </>
          )}

          {connType === 'ssh' && (
            <>
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
                    <>
                      <Input
                        placeholder="Label (optional)"
                        value={form.label}
                        onChange={(e) => update('label', e.target.value)}
                      />
                      <div className="flex flex-col gap-2 pt-1">
                        <Label>Icon color</Label>
                        <ColorPicker value={form.color} onChange={(color) => update('color', color)} />
                      </div>
                      <div className="flex flex-col gap-2 pt-1">
                        <Label>Icon</Label>
                        <HostIconPicker value={form.icon} onChange={(icon) => update('icon', icon)} />
                      </div>
                    </>
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
                  <div className="flex flex-col gap-2 pt-1">
                    <Label>Icon color</Label>
                    <ColorPicker value={form.color} onChange={(color) => update('color', color)} />
                  </div>
                  <div className="flex flex-col gap-2 pt-1">
                    <Label>Icon</Label>
                    <HostIconPicker value={form.icon} onChange={(icon) => update('icon', icon)} />
                  </div>
                </div>
              )}
            </>
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
