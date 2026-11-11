import { useEffect, useState } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import { useSidebarState } from '@/contexts/SidebarContext';
import { cn } from '@/lib/utils';
import { useAuth } from '@/contexts/AuthContext';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  LayoutDashboard,
  FileText,
  KeyRound,
  Receipt,
  Users,
  Package,
  Percent,
  Calculator,
  Shield,
  ClipboardList,
  BookOpen,
  ChevronLeft,
  ChevronRight,
} from 'lucide-react';

interface NavItem {
  label: string;
  href: string;
  icon: React.ElementType;
  badge?: number;
  roles?: string[];
}

const navItems: NavItem[] = [
  { label: 'Dashboard', href: '/dashboard', icon: LayoutDashboard },
  { label: 'Invoices', href: '/invoices', icon: FileText },
  { label: 'Receipts', href: '/receipts', icon: Receipt },
  { label: 'Customers', href: '/customers', icon: Users },
  { label: 'Products', href: '/products', icon: Package },
  { label: 'Accounting', href: '/accounting', icon: BookOpen, roles: ['admin', 'accountant', 'auditor'] },
  { label: 'Inventory', href: '/inventory', icon: Package, roles: ['admin', 'accountant', 'cashier'] },
  { label: 'Taxes', href: '/taxes', icon: Calculator, roles: ['admin', 'accountant'] },
  { label: 'Discounts', href: '/discounts', icon: Percent, roles: ['admin', 'accountant'] },
  { label: 'Reports', href: '/reports', icon: ClipboardList, roles: ['admin', 'accountant', 'auditor'] },
  { label: 'Audit Logs', href: '/audit-logs', icon: Shield, roles: ['admin', 'auditor'] },
  { label: 'Password Resets', href: '/admin/password-resets', icon: KeyRound, roles: ['admin', 'auditor'] },
  { label: 'User Management', href: '/admin/users', icon: Users, roles: ['admin'] },
];

export function AppSidebar() {
  const { collapsed: isCollapsed, setCollapsed: setIsCollapsed, mobileOpen, setMobileOpen } = useSidebarState();
  const [userInteracted, setUserInteracted] = useState(false);
  const { roles } = useAuth();
  const location = useLocation();

  useEffect(() => {
    if (isCollapsed || userInteracted || mobileOpen) return;
    const timer = setTimeout(() => setIsCollapsed(true), 5000);
    return () => clearTimeout(timer);
  }, [isCollapsed, userInteracted, mobileOpen, location.pathname, setIsCollapsed]);

  const handleToggle = () => {
    setUserInteracted(true);
    setIsCollapsed(!isCollapsed);
    setTimeout(() => setUserInteracted(false), 30000);
  };

  const filteredNavItems = navItems.filter((item) =>
    !item.roles || roles.some((role) => item.roles?.includes(role))
  );

  return (
    <aside
      className={cn(
        'fixed left-0 top-0 z-50 h-[100dvh] w-64 bg-sidebar border-r border-sidebar-border transition-all duration-300 md:z-40 md:translate-x-0',
        mobileOpen ? 'translate-x-0' : '-translate-x-full md:translate-x-0',
        isCollapsed ? 'md:w-16' : 'md:w-64'
      )}
    >
      <div className="flex h-full flex-col">
        <div className="flex h-16 items-center justify-between border-b border-sidebar-border px-4">
          {!isCollapsed && (
            <div className="flex items-center gap-2">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-sidebar-primary">
                <FileText className="h-4 w-4 text-sidebar-primary-foreground" />
              </div>
              <span className="font-display text-lg font-bold text-sidebar-foreground">Audit Ledger</span>
            </div>
          )}
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label={isCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            className="hidden h-8 w-8 text-sidebar-foreground hover:bg-sidebar-accent md:inline-flex"
            onClick={handleToggle}
          >
            {isCollapsed ? <ChevronRight className="h-4 w-4" /> : <ChevronLeft className="h-4 w-4" />}
          </Button>
        </div>

        <nav aria-label="Main navigation" className="flex-1 space-y-1 overflow-y-auto p-2 custom-scrollbar">
          {filteredNavItems.map((item) => (
            <NavLink
              key={item.href}
              to={item.href}
              title={isCollapsed ? item.label : undefined}
              onClick={() => setMobileOpen(false)}
              className={({ isActive }) => cn(
                'relative flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-all duration-200',
                'text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-foreground',
                isActive && 'nav-link-active'
              )}
            >
              <item.icon className="h-5 w-5 flex-shrink-0" />
              {!isCollapsed && (
                <>
                  <span className="flex-1">{item.label}</span>
                  {item.badge !== undefined && item.badge > 0 && (
                    <Badge variant="secondary" className="h-5 min-w-5 px-1.5 text-xs">{item.badge}</Badge>
                  )}
                </>
              )}
            </NavLink>
          ))}
        </nav>
      </div>
    </aside>
  );
}
