import { Navigate, NavLink, Outlet } from 'react-router-dom';
import { AppLayout } from '@/components/layout/AppLayout';
import { useBusiness } from '@/contexts/BusinessContext';
import { cn } from '@/lib/utils';
import { ClipboardCheck, Loader2, LayoutDashboard, MapPin, PackageSearch, ShieldAlert, TrendingUp } from 'lucide-react';

const STORE_READ_ROLES = new Set(['owner', 'admin', 'accountant', 'cashier', 'auditor']);

const navigation = [
  { to: '/store', label: 'Overview', icon: LayoutDashboard, end: true },
  { to: '/store/stock', label: 'Stock levels', icon: PackageSearch, end: false },
  { to: '/store/replenishment', label: 'Replenishment', icon: TrendingUp, end: false },
  { to: '/store/cycle-counts', label: 'Cycle counts', icon: ClipboardCheck, end: false },
  { to: '/store/locations', label: 'Locations', icon: MapPin, end: false },
];

export default function StoreLayout() {
  const { activeBusiness, activeMembership, isLoading, error } = useBusiness();

  if (isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center" role="status">
        <Loader2 className="mr-2 h-5 w-5 animate-spin" />
        Loading store workspace...
      </div>
    );
  }

  if (error) {
    return (
      <AppLayout title="Store & Inventory">
        <div className="mx-auto max-w-3xl rounded-lg border border-destructive/30 bg-destructive/5 p-6 text-sm">
          Unable to verify the active business workspace. Refresh the page or contact an administrator.
        </div>
      </AppLayout>
    );
  }

  if (!activeBusiness || !activeMembership) {
    return <Navigate to="/dashboard" replace />;
  }

  if (!STORE_READ_ROLES.has(activeMembership.role)) {
    return (
      <AppLayout title="Store & Inventory">
        <div className="mx-auto flex max-w-xl items-start gap-3 rounded-lg border p-6">
          <ShieldAlert className="mt-0.5 h-5 w-5 text-destructive" />
          <div>
            <h2 className="font-semibold">Store access is restricted</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Your current business role does not include store and inventory access.
            </p>
          </div>
        </div>
      </AppLayout>
    );
  }

  return (
    <AppLayout title="Store & Inventory">
      <div className="space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-sm text-muted-foreground">
              Stock control and store operations for {activeBusiness.name}
            </p>
          </div>
          <nav aria-label="Store navigation" className="flex flex-wrap gap-2">
            {navigation.map(({ to, label, icon: Icon, end }) => (
              <NavLink
                key={to}
                to={to}
                end={end}
                className={({ isActive }) => cn(
                  'inline-flex items-center gap-2 rounded-md border px-3 py-2 text-sm font-medium transition-colors',
                  isActive
                    ? 'border-primary bg-primary text-primary-foreground'
                    : 'border-border bg-card text-muted-foreground hover:bg-accent hover:text-accent-foreground',
                )}
              >
                <Icon className="h-4 w-4" />
                {label}
              </NavLink>
            ))}
          </nav>
        </div>
        <Outlet />
      </div>
    </AppLayout>
  );
}
