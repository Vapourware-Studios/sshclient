import { forwardRef } from 'react';
import { LayoutGrid, List } from 'lucide-react';
import { toneForId, toneStyle } from '@/lib/tone';

export function ViewToggle({ mode, onChange }) {
  return (
    <div className="flex shrink-0 items-center rounded-md border p-0.5">
      <button
        type="button"
        onClick={() => onChange('grid')}
        title="Grid view"
        aria-pressed={mode === 'grid'}
        className={`rounded-sm p-1.5 ${
          mode === 'grid' ? 'bg-accent text-foreground' : 'text-muted-foreground hover:text-foreground'
        }`}
      >
        <LayoutGrid className="size-4" />
      </button>
      <button
        type="button"
        onClick={() => onChange('list')}
        title="List view"
        aria-pressed={mode === 'list'}
        className={`rounded-sm p-1.5 ${
          mode === 'list' ? 'bg-accent text-foreground' : 'text-muted-foreground hover:text-foreground'
        }`}
      >
        <List className="size-4" />
      </button>
    </div>
  );
}

export const GridCard = forwardRef(function GridCard(
  { id, icon: Icon, title, subtitle, onClick, onDoubleClick, actions, className = '', tone, ...rest },
  ref
) {
  const resolvedTone = tone ?? toneForId(id ?? title);

  return (
    <div
      ref={ref}
      onClick={onClick}
      onDoubleClick={onDoubleClick}
      className={`group flex items-center gap-3 rounded-xl border bg-card p-3 transition-colors ${
        onClick || onDoubleClick ? 'cursor-pointer hover:bg-accent/40' : ''
      } ${className}`}
      {...rest}
    >
      <span
        className="flex size-10 shrink-0 items-center justify-center rounded-lg"
        style={toneStyle(resolvedTone)}
      >
        <Icon className="size-5" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium">{title}</p>
        {subtitle && <p className="truncate text-xs text-muted-foreground">{subtitle}</p>}
      </div>
      {actions && (
        <div className="hidden shrink-0 items-center gap-0.5 group-hover:flex">{actions}</div>
      )}
    </div>
  );
});

export const GRID_CLASS = 'grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-4';
