import { useEffect, useState } from 'react';
import { Cloud, LogOut, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

function formatTime(ts) {
  if (!ts) return 'never';
  return new Date(ts).toLocaleTimeString();
}

/**
 * Optional account sync. Sign-in happens in the browser (Clerk); the vault
 * data itself is end-to-end encrypted — the server only stores ciphertext.
 */
export default function AccountCard() {
  const [status, setStatus] = useState(null);
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [showUrls, setShowUrls] = useState(false);
  const [apiUrl, setApiUrl] = useState('');
  const [connectUrl, setConnectUrl] = useState('');

  useEffect(() => {
    let mounted = true;
    window.api.accountStatus().then((s) => {
      if (!mounted || s?.error) return;
      setStatus(s);
      setApiUrl(s.apiUrl || '');
      setConnectUrl(s.connectUrl || '');
    });
    const unsubscribe = window.api.onAccountChanged((s) => {
      setStatus(s);
      if (s.lastError) setError(s.lastError);
      else setError('');
    });
    return () => {
      mounted = false;
      unsubscribe();
    };
  }, []);

  async function run(action) {
    setBusy(true);
    setError('');
    try {
      const result = await action();
      if (result?.error) setError(result.error);
    } finally {
      setBusy(false);
    }
  }

  const signIn = () =>
    run(async () => {
      if (showUrls) await window.api.accountSetUrls({ apiUrl, connectUrl });
      return window.api.accountSignIn();
    });
  const syncNow = () => run(() => window.api.accountSyncNow());
  const signOut = () => run(() => window.api.accountSignOut());
  const submitPassword = () =>
    run(async () => {
      const result = await window.api.accountCompleteCrypto(password);
      if (!result?.error) setPassword('');
      return result;
    });

  if (!status) return null;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Cloud className="size-4" /> Account &amp; Sync
        </CardTitle>
        <CardDescription>
          Optional. Syncs hosts, keys, snippets, and history between your devices.
          Everything is encrypted on this device with your master password before
          upload — the server never sees your keys or passwords.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {!status.linked && !status.needsPassword && (
          <>
            <div className="flex flex-wrap items-center gap-2">
              <Button size="sm" onClick={signIn} disabled={busy || status.signingIn}>
                {status.signingIn ? 'Waiting for browser…' : 'Sign in via browser'}
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setShowUrls((v) => !v)}
              >
                {showUrls ? 'Hide server settings' : 'Server settings'}
              </Button>
            </div>
            {showUrls && (
              <div className="flex flex-col gap-2">
                <div className="flex flex-col gap-1">
                  <Label className="text-xs">Sync server URL</Label>
                  <Input value={apiUrl} onChange={(e) => setApiUrl(e.target.value)} placeholder="http://localhost:8080" />
                </div>
                <div className="flex flex-col gap-1">
                  <Label className="text-xs">Sign-in page URL</Label>
                  <Input value={connectUrl} onChange={(e) => setConnectUrl(e.target.value)} placeholder="http://localhost:5173" />
                </div>
              </div>
            )}
          </>
        )}

        {status.needsPassword && (
          <div className="flex flex-col gap-2">
            <p className="text-sm">
              This account already has synced data. Enter the master password of the
              device that first enabled sync to unlock it.
            </p>
            <div className="flex gap-2">
              <Input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && password && submitPassword()}
                placeholder="Sync password"
              />
              <Button size="sm" onClick={submitPassword} disabled={busy || !password}>
                Unlock sync
              </Button>
            </div>
          </div>
        )}

        {status.linked && (
          <>
            <p className="text-sm text-muted-foreground">
              Signed in · last sync: {status.syncing ? 'syncing…' : formatTime(status.lastSyncAt)}
            </p>
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" size="sm" onClick={syncNow} disabled={busy || status.syncing}>
                <RefreshCw className="size-3.5" /> Sync now
              </Button>
              <Button variant="ghost" size="sm" onClick={signOut} disabled={busy}>
                <LogOut className="size-3.5" /> Sign out
              </Button>
            </div>
          </>
        )}

        {error && <p className="text-xs text-destructive">{error}</p>}
      </CardContent>
    </Card>
  );
}
