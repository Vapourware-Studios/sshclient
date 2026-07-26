import { useState } from 'react';
import { Download, EyeOff, FileCode2, KeyRound, MessageSquare, Moon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Slider } from '@/components/ui/slider';
import AccountCard from '@/components/AccountCard';
import ThemePicker from '@/components/ThemePicker';
import TermiusImportDialog from '@/components/TermiusImportDialog';
import FeedbackDialog from '@/components/FeedbackDialog';
import { useGlassSettings, GLASS_SUPPORTED } from '@/lib/glass-settings.jsx';
import { useTheme } from '@/lib/theme-settings.jsx';
import { usePrivacySettings } from '@/lib/privacy-settings.jsx';
import { CUSTOM_CSS_TEMPLATE } from '@/lib/terminal-themes';

export default function SettingsPanel({ onHostsChange }) {
  const { enabled, intensity, setEnabled, setIntensity } = useGlassSettings();
  const { customCss, customCssName, setCustomCss } = useTheme();
  const { blurHostIps, setBlurHostIps } = usePrivacySettings();
  const [cssError, setCssError] = useState('');
  const [termiusOpen, setTermiusOpen] = useState(false);
  const [feedbackOpen, setFeedbackOpen] = useState(false);
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [passwordError, setPasswordError] = useState('');
  const [passwordSuccess, setPasswordSuccess] = useState('');
  const [passwordBusy, setPasswordBusy] = useState(false);

  async function changePassword() {
    setPasswordError('');
    setPasswordSuccess('');
    if (newPassword !== confirmPassword) {
      setPasswordError('New passwords do not match');
      return;
    }
    setPasswordBusy(true);
    try {
      const result = await window.api.vaultChangePassword(currentPassword, newPassword);
      if (result?.error) {
        setPasswordError(result.error);
        return;
      }
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
      setPasswordSuccess('Master password changed.');
    } finally {
      setPasswordBusy(false);
    }
  }

  async function loadCssFile() {
    setCssError('');
    const result = await window.api.themeOpenCssFile();
    if (result.canceled) return;
    if (result.error) {
      setCssError(result.error);
      return;
    }
    setCustomCss(result.css, result.name);
  }

  async function saveTemplate() {
    setCssError('');
    const result = await window.api.themeSaveCssTemplate(CUSTOM_CSS_TEMPLATE);
    if (result?.error) setCssError(result.error);
  }

  return (
    <div className="h-full overflow-y-auto p-4">
      <div className="mx-auto flex max-w-lg flex-col gap-4">
        <div className="flex items-start justify-between gap-2">
          <div>
            <h2 className="text-lg font-semibold">Settings</h2>
            <p className="text-sm text-muted-foreground">App preferences.</p>
          </div>
          <Button
            variant="ghost"
            size="sm"
            className="text-xs text-muted-foreground"
            onClick={() => setFeedbackOpen(true)}
          >
            <MessageSquare className="size-3.5" /> Feedback
          </Button>
        </div>

        <AccountCard />

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <KeyRound className="size-4" /> Master Password
            </CardTitle>
            <CardDescription>
              Changes the password used to encrypt hosts, keys, and snippets on this
              device. If sync is enabled, other devices will need the new password
              next time they link.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            <div className="flex flex-col gap-2">
              <Label htmlFor="current-master-password">Current password</Label>
              <Input
                id="current-master-password"
                type="password"
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
                disabled={passwordBusy}
              />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="new-master-password">New password</Label>
              <Input
                id="new-master-password"
                type="password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                disabled={passwordBusy}
              />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="confirm-master-password">Confirm new password</Label>
              <Input
                id="confirm-master-password"
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                disabled={passwordBusy}
              />
            </div>
            {passwordError && <p className="text-xs text-destructive">{passwordError}</p>}
            {passwordSuccess && <p className="text-xs text-muted-foreground">{passwordSuccess}</p>}
            <Button
              size="sm"
              onClick={changePassword}
              disabled={passwordBusy || !currentPassword || !newPassword || !confirmPassword}
              className="self-start"
            >
              {passwordBusy ? 'Changing…' : 'Change password'}
            </Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Moon className="size-4" /> Style
            </CardTitle>
            <CardDescription>
              Controls the look of the whole app, including the terminal colours.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-2">
            <div className="max-h-72 overflow-y-auto rounded-md border p-1.5">
              <ThemePicker />
            </div>
            <p className="text-xs text-muted-foreground">
              Also available from the palette button in any terminal tab.
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <FileCode2 className="size-4" /> Custom CSS
            </CardTitle>
            <CardDescription>
              Restyle the whole app with your own CSS file. It is applied on top of the selected
              theme template and kept across restarts. Save the template to see every variable
              you can override, edit it, then load it back.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" size="sm" onClick={loadCssFile}>
                Load CSS file…
              </Button>
              <Button variant="outline" size="sm" onClick={saveTemplate}>
                Save template…
              </Button>
              {customCss && (
                <Button variant="ghost" size="sm" onClick={() => setCustomCss('', '')}>
                  Clear
                </Button>
              )}
            </div>
            {cssError && <p className="text-xs text-destructive">{cssError}</p>}
            <p className="text-xs text-muted-foreground">
              {customCss
                ? `Active: ${customCssName || 'custom CSS'} (${customCss.length.toLocaleString()} characters). Re-load the file after editing it.`
                : 'No custom CSS loaded.'}
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Download className="size-4" /> Import
            </CardTitle>
            <CardDescription>
              Bring in hosts and keys from another SSH client already installed on this machine.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button variant="outline" size="sm" onClick={() => setTermiusOpen(true)}>
              Import from Termius…
            </Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <EyeOff className="size-4" /> Privacy
            </CardTitle>
            <CardDescription>
              Blur host addresses across the app until you hover over them. This is handy if you're
              screen sharing or sharign screenshots, but it can make it harder to identify hosts at a glance.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <label className="flex cursor-pointer items-center gap-2.5 text-sm">
              <Checkbox
                checked={blurHostIps}
                onCheckedChange={(v) => setBlurHostIps(Boolean(v))}
              />
              Blur host IPs
            </label>
          </CardContent>
        </Card>

        {GLASS_SUPPORTED && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              Liquid Glass
            </CardTitle>
            <CardDescription>
              Lets the native macOS Tahoe glass material show through the tab bar and
              terminal background. Requires macOS 26+; has no visible effect on older
              versions or other platforms.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-5">
            <label className="flex cursor-pointer items-center gap-2.5 text-sm">
              <Checkbox checked={enabled} onCheckedChange={(v) => setEnabled(Boolean(v))} />
              Enable Liquid Glass
            </label>

            <div className="flex flex-col gap-2">
              <div className="flex items-center justify-between">
                <Label className={!enabled ? 'text-muted-foreground' : undefined}>Intensity</Label>
                <span className="text-xs text-muted-foreground">{Math.round(intensity)}%</span>
              </div>
              <Slider
                value={[intensity]}
                onValueChange={([v]) => setIntensity(v)}
                min={0}
                max={100}
                step={1}
                disabled={!enabled}
              />
            </div>
          </CardContent>
        </Card>
        )}
      </div>

      <TermiusImportDialog
        open={termiusOpen}
        onOpenChange={setTermiusOpen}
        onImported={onHostsChange}
      />
      <FeedbackDialog open={feedbackOpen} onOpenChange={setFeedbackOpen} />
    </div>
  );
}
