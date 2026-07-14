import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Lock } from 'lucide-react';

export default function Unlock({ vaultExists, onUnlocked }) {
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    setError(null);

    if (!vaultExists && password !== confirmPassword) {
      setError('Passwords do not match');
      return;
    }

    setBusy(true);
    const result = vaultExists
      ? await window.api.vaultUnlock(password)
      : await window.api.vaultSetup(password);
    setBusy(false);

    if (result.error) {
      setError(result.error);
      return;
    }

    setPassword('');
    setConfirmPassword('');
    onUnlocked();
  }

  return (
    <div className="flex h-screen items-center justify-center bg-background">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Lock className="size-4" />
            {vaultExists ? 'Unlock vault' : 'Set a master password'}
          </CardTitle>
          <CardDescription>
            {vaultExists
              ? 'Enter your master password to unlock saved hosts.'
              : 'Saved hosts and credentials are encrypted with this password. It is never stored — if you forget it, saved hosts cannot be recovered.'}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="flex flex-col gap-4">
            <div className="flex flex-col gap-2">
              <Label htmlFor="master-password">Master password</Label>
              <Input
                id="master-password"
                type="password"
                autoFocus
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                disabled={busy}
              />
            </div>

            {!vaultExists && (
              <div className="flex flex-col gap-2">
                <Label htmlFor="confirm-password">Confirm password</Label>
                <Input
                  id="confirm-password"
                  type="password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  disabled={busy}
                />
              </div>
            )}

            {error && <p className="text-sm text-destructive">{error}</p>}

            <Button type="submit" disabled={busy || !password}>
              {busy ? 'Please wait…' : vaultExists ? 'Unlock' : 'Create vault'}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
