import { useEffect } from 'react';
import { X } from 'lucide-react';

// Termius-style push panel: rendered as a flex sibling of the content it
// docks against. The animated width shifts that content to the left, and
// the right-anchored inner pane slides in with the edge — no backdrop,
// so the rest of the UI stays usable. Children stay mounted while the
// panel closes, so content doesn't blank mid-animation.
export function SlidePanel({ open, onClose, children }) {
  useEffect(() => {
    if (!open || !onClose) return;
    function onKeyDown(e) {
      if (e.key === 'Escape') onClose();
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open, onClose]);

  return (
    <div
      className={`relative shrink-0 overflow-hidden transition-[width] duration-300 ease-[cubic-bezier(0.32,0.72,0,1)] ${
        open ? 'w-80' : 'w-0'
      }`}
    >
      <div className="absolute inset-y-0 right-0 w-80 border-l bg-background">{children}</div>
    </div>
  );
}

export function PanelHeader({ title, description, onClose }) {
  return (
    <div className="flex items-start justify-between gap-3 border-b p-4">
      <div className="min-w-0">
        <p className="truncate text-sm font-semibold">{title}</p>
        {description && <p className="mt-0.5 text-xs text-muted-foreground">{description}</p>}
      </div>
      <button
        onClick={onClose}
        title="Close"
        className="shrink-0 rounded-md p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground"
      >
        <X className="size-4" />
      </button>
    </div>
  );
}
