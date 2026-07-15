import { useState } from 'react';
import { Download, FileCode2, Moon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { Slider } from '@/components/ui/slider';
import ThemePicker from '@/components/ThemePicker';
import TermiusImportDialog from '@/components/TermiusImportDialog';
import { useGlassSettings, GLASS_SUPPORTED } from '@/lib/glass-settings.jsx';
import { useTheme } from '@/lib/theme-settings.jsx';
import { CUSTOM_CSS_TEMPLATE } from '@/lib/terminal-themes';

export default function SettingsPanel({ onHostsChange }) {
  const { enabled, intensity, setEnabled, setIntensity } = useGlassSettings();
  const { customCss, customCssName, setCustomCss } = useTheme();
  const [cssError, setCssError] = useState('');
  const [termiusOpen, setTermiusOpen] = useState(false);

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
        <div>
          <h2 className="text-lg font-semibold">Settings</h2>
          <p className="text-sm text-muted-foreground">App preferences.</p>
        </div>

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
    </div>
  );
}
