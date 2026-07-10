import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { Terminal as TerminalIcon, Plus, Server, Pencil, Trash2, Lock } from 'lucide-react';

export default function Sidebar({
  hosts,
  onConnect,
  onEdit,
  onDelete,
  onNewConnection,
  onLockVault,
}) {
  return (
    <aside className="flex w-60 flex-col border-r bg-sidebar text-sidebar-foreground">
      <div className="h-9 shrink-0" />

      <div className="flex items-center justify-between px-4 py-2">
        <div className="flex items-center gap-2">
          <TerminalIcon className="size-4" />
          <h1 className="text-sm font-semibold tracking-widest">SSH CLIENT</h1>
        </div>
        <button
          onClick={onLockVault}
          title="Lock vault"
          className="rounded p-1 text-muted-foreground hover:text-foreground"
        >
          <Lock className="size-3.5" />
        </button>
      </div>

      <Separator />

      <div className="flex items-center justify-between px-4 pt-4 pb-2">
        <h2 className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
          Hosts
        </h2>
        <Badge variant="secondary">{hosts.length}</Badge>
      </div>

      <div className="flex flex-1 flex-col gap-1 overflow-y-auto px-2">
        {hosts.length === 0 && (
          <p className="px-2 text-sm text-muted-foreground">No saved hosts yet</p>
        )}
        {hosts.map((host) => (
          <div
            key={host.id}
            className="group flex items-center gap-1 rounded-md pr-1 hover:bg-sidebar-accent"
          >
            <button
              onClick={() => onConnect(host)}
              className="flex min-w-0 flex-1 items-center gap-2 px-2 py-1.5 text-left text-sm"
            >
              <Server className="size-3.5 shrink-0" />
              <span className="truncate">{host.label || host.host}</span>
            </button>
            <button
              onClick={() => onEdit(host)}
              title="Edit host"
              className="hidden shrink-0 rounded p-1 text-muted-foreground hover:text-foreground group-hover:block"
            >
              <Pencil className="size-3.5" />
            </button>
            <button
              onClick={() => onDelete(host)}
              title="Delete host"
              className="hidden shrink-0 rounded p-1 text-muted-foreground hover:text-destructive group-hover:block"
            >
              <Trash2 className="size-3.5" />
            </button>
          </div>
        ))}
      </div>

      <div className="p-2">
        <Button className="w-full" size="sm" onClick={onNewConnection}>
          <Plus className="size-4" /> New connection
        </Button>
      </div>
    </aside>
  );
}
