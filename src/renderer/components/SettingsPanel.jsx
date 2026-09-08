import { useEffect, useState } from 'react';
import {
  ArrowUpCircle,
  Download,
  EyeOff,
  FileCode2,
  Info,
  KeyRound,
  MessageSquare,
  Moon,
  Palette,
  ShieldCheck,
  Sparkles,
  UserRound,
} from 'lucide-react';
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
import UpdatePanel from '@/components/UpdatePanel';
import { useGlassSettings, GLASS_SUPPORTED } from '@/lib/glass-settings.jsx';
import { useTheme } from '@/lib/theme-settings.jsx';
import { usePrivacySettings } from '@/lib/privacy-settings.jsx';
import { CUSTOM_CSS_TEMPLATE } from '@/lib/terminal-themes';

const SECTIONS = [
  { id: 'account', label: 'Account', Icon: UserRound, blurb: 'Sign in and sync your vault across devices.' },
  { id: 'appearance', label: 'Appearance', Icon: Palette, blurb: 'Themes, custom CSS and window materials.' },
  { id: 'security', label: 'Security & Privacy', Icon: ShieldCheck, blurb: 'Master password and what other people can see.' },
  { id: 'import', label: 'Import', Icon: Download, blurb: 'Bring hosts and keys in from another client.' },
  { id: 'updates', label: 'Updates', Icon: ArrowUpCircle, blurb: 'Check for and install new releases.' },
  { id: 'about', label: 'About', Icon: Info, blurb: 'Version, licence and where to shout at us.' },
];

function SectionNav({ section, onChange }) {
  return (
    <nav className="flex shrink-0 gap-1 overflow-x-auto border-b p-2 lg:w-56 lg:flex-col lg:overflow-visible lg:border-b-0 lg:border-r lg:p-3">
      {SECTIONS.map(({ id, label, Icon }) => (
        <button
          key={id}
          onClick={() => onChange(id)}
          className={`flex shrink-0 items-center gap-2.5 rounded-md px-2.5 py-1.5 text-left text-sm ${
            section === id
              ? 'bg-accent font-medium text-accent-foreground'
              : 'text-muted-foreground hover:bg-accent/50 hover:text-foreground'
          }`}
        >
          <Icon className="size-4 shrink-0" />
          <span className="truncate">{label}</span>
        </button>
      ))}
    </nav>
  );
}

function MasterPasswordCard() {
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [busy, setBusy] = useState(false);

  async function changePassword() {
    setError('');
    setSuccess('');
    if (newPassword !== confirmPassword) {
      setError('New passwords do not match');
      return;
    }
    setBusy(true);
    try {
      const result = await window.api.vaultChangePassword(currentPassword, newPassword);
      if (result?.error) {
        setError(result.error);
        return;
      }
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
      setSuccess('Master password changed.');
    } finally {
      setBusy(false);
    }
  }

  return (
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
            disabled={busy}
          />
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor="new-master-password">New password</Label>
          <Input
            id="new-master-password"
            type="password"
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
            disabled={busy}
          />
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor="confirm-master-password">Confirm new password</Label>
          <Input
            id="confirm-master-password"
            type="password"
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            disabled={busy}
          />
        </div>
        {error && <p className="text-xs text-destructive">{error}</p>}
        {success && <p className="text-xs text-muted-foreground">{success}</p>}
        <Button
          size="sm"
          onClick={changePassword}
          disabled={busy || !currentPassword || !newPassword || !confirmPassword}
          className="self-start"
        >
          {busy ? 'Changing…' : 'Change password'}
        </Button>
      </CardContent>
    </Card>
  );
}

function CustomCssCard() {
  const { customCss, customCssName, setCustomCss } = useTheme();
  const [cssError, setCssError] = useState('');

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
  );
}

function GlassCard() {
  const { enabled, intensity, setEnabled, setIntensity } = useGlassSettings();

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">Liquid Glass</CardTitle>
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
  );
}

function PrivacyCard() {
  const { blurHostIps, setBlurHostIps } = usePrivacySettings();

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <EyeOff className="size-4" /> Privacy
        </CardTitle>
        <CardDescription>
          Blur host addresses across the app until you hover over them. This is handy if you're
          screen sharing or sharing screenshots, but it can make it harder to identify hosts at
          a glance.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <label className="flex cursor-pointer items-center gap-2.5 text-sm">
          <Checkbox checked={blurHostIps} onCheckedChange={(v) => setBlurHostIps(Boolean(v))} />
          Blur host IPs
        </label>
      </CardContent>
    </Card>
  );
}

// One of these is picked per app launch. Nobody asked for it; everybody deserves it.
const TAGLINES = [
  'Yes, it is another SSH client. No, we could not stop ourselves.',
  'Powered by caffeine, spite, and one very patient TCP socket.',
  'It works on my machine, and now on yours too.',
  'Zero telemetry. We genuinely do not want to know.',
  'If it breaks, you get to keep both halves. And a PR button.',
  'Certified free of blockchain since day one.',
  'Ninety percent of an SSH client is remembering which port it was on.',
];

const SECRET = String.raw`
        _   _
       ( \_/ )    ssh: connection to the
        ) . (     couch established
       (  v  )
    ~~~~~m~m~~~~~
`;

function AboutCard({ onFeedback }) {
  const [info, setInfo] = useState(null);
  const [taps, setTaps] = useState(0);
  const [tagline] = useState(() => TAGLINES[Math.floor(Math.random() * TAGLINES.length)]);
  const unlocked = taps >= 7;

  useEffect(() => {
    window.api.appInfo?.().then(setInfo);
  }, []);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Info className="size-4" /> About
        </CardTitle>
        <CardDescription>{tagline}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-1.5 text-sm">
          <dt className="text-muted-foreground">Version</dt>
          <dd>
            {/* Seven taps. It is a phone tradition and we are honouring it. */}
            <button
              onClick={() => setTaps((n) => n + 1)}
              className="cursor-default font-mono text-sm hover:text-foreground"
              title={unlocked ? 'You found it.' : undefined}
            >
              {info?.version || '—'}
            </button>
          </dd>
          <dt className="text-muted-foreground">Platform</dt>
          <dd className="font-mono text-xs">
            {info ? `${info.platform} ${info.arch}` : '—'}
          </dd>
          <dt className="text-muted-foreground">Electron</dt>
          <dd className="font-mono text-xs">{info?.electron || '—'}</dd>
          <dt className="text-muted-foreground">Licence</dt>
          <dd>GPL-3.0</dd>
        </dl>

        {unlocked && (
          <pre className="overflow-x-auto rounded-md border bg-muted/40 p-3 text-[11px] leading-tight text-muted-foreground">
            {SECRET}
          </pre>
        )}

        <div className="flex flex-wrap gap-2">
          <Button variant="outline" size="sm" onClick={onFeedback}>
            <MessageSquare className="size-3.5" /> Send feedback
          </Button>
          <Button variant="outline" size="sm" onClick={() => window.api.updateOpenReleasePage()}>
            <Sparkles className="size-3.5" /> What's new
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

export default function SettingsPanel({ onHostsChange }) {
  const [section, setSection] = useState('account');
  const [termiusOpen, setTermiusOpen] = useState(false);
  const [feedbackOpen, setFeedbackOpen] = useState(false);
  const active = SECTIONS.find((s) => s.id === section) || SECTIONS[0];

  return (
    <div className="flex h-full flex-col lg:flex-row">
      <SectionNav section={section} onChange={setSection} />

      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        <div className="mx-auto flex max-w-2xl flex-col gap-4">
          <div>
            <h2 className="text-lg font-semibold">{active.label}</h2>
            <p className="text-sm text-muted-foreground">{active.blurb}</p>
          </div>

          {section === 'account' && <AccountCard />}

          {section === 'appearance' && (
            <>
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
              <CustomCssCard />
              {GLASS_SUPPORTED && <GlassCard />}
            </>
          )}

          {section === 'security' && (
            <>
              <MasterPasswordCard />
              <PrivacyCard />
            </>
          )}

          {section === 'import' && (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Download className="size-4" /> Import
                </CardTitle>
                <CardDescription>
                  Bring in hosts and keys from another SSH client already installed on this
                  machine.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <Button variant="outline" size="sm" onClick={() => setTermiusOpen(true)}>
                  Import from Termius…
                </Button>
              </CardContent>
            </Card>
          )}

          {section === 'updates' && <UpdatePanel />}

          {section === 'about' && <AboutCard onFeedback={() => setFeedbackOpen(true)} />}
        </div>
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
