import { Check } from 'lucide-react';
import { useTheme } from '@/lib/theme-settings.jsx';
import { DEFAULT_THEMES, THEMES } from '@/lib/terminal-themes';

function Swatch({ theme }) {
  const chips = [theme.bg, theme.primary, theme.ansi[9], theme.ansi[10], theme.ansi[12], theme.fg];
  return (
    <span className="flex shrink-0 overflow-hidden rounded-sm border">
      {chips.map((color, i) => (
        <span key={i} className="size-3.5" style={{ backgroundColor: color }} />
      ))}
    </span>
  );
}

export default function ThemePicker({ className = '' }) {
  const { themeId, setThemeId } = useTheme();

  return (
    <div className={`flex flex-col gap-1 ${className}`}>
      {[...DEFAULT_THEMES, ...THEMES].map((theme) => (
        <button
          key={theme.id}
          onClick={() => setThemeId(theme.id)}
          className={`flex items-center justify-between gap-2 rounded-md border px-3 py-2 text-left text-sm hover:bg-accent ${
            themeId === theme.id ? 'border-primary/50 bg-accent/50' : 'border-transparent'
          }`}
        >
          <span className="flex min-w-0 items-center gap-2.5">
            <Swatch theme={theme} />
            <span className="truncate font-medium">{theme.name}</span>
          </span>
          {themeId === theme.id && <Check className="size-4 shrink-0 text-primary" />}
        </button>
      ))}
    </div>
  );
}
