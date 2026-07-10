import Sidebar from '@/components/Sidebar';

export default function VaultView({ hosts, onConnect, onEdit, onDelete, onNewConnection, onLockVault }) {
  return (
    <Sidebar
      hosts={hosts}
      onConnect={onConnect}
      onEdit={onEdit}
      onDelete={onDelete}
      onNewConnection={onNewConnection}
      onLockVault={onLockVault}
    />
  );
}
