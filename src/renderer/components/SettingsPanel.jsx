import { Sparkles } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { Slider } from '@/components/ui/slider';
import { useGlassSettings } from '@/lib/glass-settings.jsx';

export default function SettingsPanel() {
  const { enabled, intensity, setEnabled, setIntensity } = useGlassSettings();

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
              <Sparkles className="size-4" /> Liquid Glass
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
              <p className="text-xs text-muted-foreground">
                Higher values make the tab bar and terminal more transparent, showing more
                of the glass material underneath.
              </p>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
