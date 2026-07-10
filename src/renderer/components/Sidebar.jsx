import { Separator } from '@/components/ui/separator';
import {
  Server,
  KeyRound,
  ArrowRightLeft,
  ShieldCheck,
  Code2,
  History,
  Settings,
  Lock,
  Vault,
} from 'lucide-react';

const NAV_ITEMS = [
  { id: 'hosts', label: 'Hosts', Icon: Server },
  { id: 'keychain', label: 'Keychain', Icon: KeyRound },
  { id: 'port-forwarding', label: 'Port Forwarding', Icon: ArrowRightLeft },
  { id: 'known-hosts', label: 'Known Hosts', Icon: ShieldCheck },
  { id: 'snippets', label: 'Snippets', Icon: Code2 },
  { id: 'history', label: 'History', Icon: History },
];

function NavButton({ active, onClick, Icon, label }) {
  return (
    <button
      onClick={onClick}
      className={`flex w-full items-center gap-2.5 rounded-md px-2.5 py-1.5 text-left text-sm ${
        active
          ? 'bg-sidebar-accent font-medium text-sidebar-accent-foreground'
          : 'text-muted-foreground hover:bg-sidebar-accent/50 hover:text-sidebar-foreground'
      }`}
    >
      <Icon className="size-4 shrink-0" />
      <span className="truncate">{label}</span>
    </button>
  );
}

export default function Sidebar({ section, onSectionChange, onLockVault }) {
  return (
    <aside className="flex h-full w-56 shrink-0 flex-col border-r bg-sidebar text-sidebar-foreground">
      <div className="flex items-center gap-2.5 px-4 pt-4 pb-3">
        <span className="flex size-7 items-center justify-center rounded-md bg-sidebar-primary text-sidebar-primary-foreground">
          <Vault className="size-4" />
        </span>
        <div className="min-w-0">
          <p className="truncate text-sm font-medium leading-tight">Personal Vault</p>
          <p className="text-xs text-muted-foreground">Local</p>
        </div>
      </div>

      <Separator />

      <nav className="flex flex-1 flex-col gap-0.5 overflow-y-auto p-2">
        {NAV_ITEMS.map(({ id, label, Icon }) => (
          <NavButton
            key={id}
            active={section === id}
            onClick={() => onSectionChange(id)}
            Icon={Icon}
            label={label}
          />
        ))}
      </nav>

      <Separator />

      <div className="flex flex-col gap-0.5 p-2">
        <NavButton
          active={section === 'settings'}
          onClick={() => onSectionChange('settings')}
          Icon={Settings}
          label="Settings"
        />
        <NavButton active={false} onClick={onLockVault} Icon={Lock} label="Lock Vault" />
      </div>
    </aside>
  );
}
