import { useState } from 'react';
import { Server, Search } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { HOST_ICONS, HostIcon } from '@/lib/host-icons.jsx';

export function HostIconPicker({ value, onChange }) {
  const [query, setQuery] = useState('');
  const q = query.trim().toLowerCase();
  const filtered = q ? HOST_ICONS.filter((icon) => icon.label.toLowerCase().includes(q)) : HOST_ICONS;

  return (
    <div className="flex flex-col gap-2">
      <div className="relative">
        <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Find an icon…"
          className="h-8 pl-8 text-sm"
        />
      </div>
      <div className="grid max-h-40 grid-cols-8 gap-1.5 overflow-y-auto">
        <button
          type="button"
          onClick={() => onChange(null)}
          title="Generic server"
          aria-label="Generic server"
          className={`flex aspect-square items-center justify-center rounded-md border-2 bg-muted text-muted-foreground ${
            !value ? 'border-primary' : 'border-transparent'
          }`}
        >
          <Server className="size-4" />
        </button>
        {filtered.map((icon) => (
          <button
            key={icon.slug}
            type="button"
            onClick={() => onChange(icon.slug)}
            title={icon.label}
            aria-label={icon.label}
            className={`flex aspect-square items-center justify-center rounded-md border-2 bg-muted ${
              value === icon.slug ? 'border-primary' : 'border-transparent'
            }`}
          >
            <HostIcon slug={icon.slug} className="size-4" />
          </button>
        ))}
      </div>
    </div>
  );
}
