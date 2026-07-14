import { Ban, Check } from 'lucide-react';

const TONES = ['chart-1', 'chart-2', 'chart-3', 'chart-4', 'chart-5'];
const isCustom = (value) => Boolean(value) && !TONES.includes(value);

export function ColorPicker({ value, onChange, autoLabel = 'Automatic' }) {
  const custom = isCustom(value);

  return (
    <div className="flex flex-wrap items-center gap-2">
      <button
        type="button"
        onClick={() => onChange(null)}
        title={autoLabel}
        aria-label={autoLabel}
        className={`flex size-7 items-center justify-center rounded-full border-2 bg-muted text-muted-foreground ${
          !value ? 'border-primary' : 'border-transparent'
        }`}
      >
        <Ban className="size-3.5" />
      </button>
      {TONES.map((tone) => (
        <button
          key={tone}
          type="button"
          onClick={() => onChange(tone)}
          title={tone}
          aria-label={tone}
          className={`flex size-7 items-center justify-center rounded-full border-2 ${
            value === tone ? 'border-primary' : 'border-transparent'
          }`}
          style={{ backgroundColor: `var(--${tone})` }}
        >
          {value === tone && <Check className="size-3.5 text-white" />}
        </button>
      ))}

      <label
        title="Custom color"
        aria-label="Custom color"
        className={`relative flex size-7 shrink-0 cursor-pointer items-center justify-center overflow-hidden rounded-full border-2 ${
          custom ? 'border-primary' : 'border-transparent'
        }`}
        style={{
          background: custom
            ? value
            : 'conic-gradient(from 0deg, #f43f5e, #f59e0b, #84cc16, #10b981, #06b6d4, #6366f1, #d946ef, #f43f5e)',
        }}
      >
        {custom && <Check className="size-3.5 text-white" />}
        <input
          type="color"
          value={custom ? value : '#888888'}
          onChange={(e) => onChange(e.target.value)}
          className="absolute inset-0 size-full cursor-pointer opacity-0"
        />
      </label>
    </div>
  );
}
