import { ReactNode, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { AppSidebar } from './AppSidebar';
import { SidebarProvider, useSidebarState } from '@/contexts/SidebarContext';
import { useAuth } from '@/contexts/AuthContext';
import { Button } from '@/components/ui/button';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Bell, Search, Menu, User, Settings, Users, KeyRound, LogOut, ChevronRight } from 'lucide-react';
import { Input } from '@/components/ui/input';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';

interface AppLayoutProps {
  children: ReactNode;
  title?: string;
  subtitle?: string;
  actions?: ReactNode;
}

const featureLinks = [
  { label: 'Dashboard', description: 'Overview and business metrics', href: '/dashboard', terms: 'home overview' },
  { label: 'Invoices', description: 'Create and manage invoices', href: '/invoices', terms: 'billing sales' },
  { label: 'Receipts', description: 'Issue and manage receipts', href: '/receipts', terms: 'payments collections' },
  { label: 'Customers', description: 'Manage customer records', href: '/customers', terms: 'clients contacts' },
  { label: 'Products', description: 'Manage products and services', href: '/products', terms: 'catalog services' },
  { label: 'Inventory', description: 'Stock and inventory control', href: '/inventory', terms: 'stock warehouse' },
  { label: 'Accounting', description: 'Accounting workspace', href: '/accounting', terms: 'ledger chart accounts' },
  { label: 'Taxes', description: 'Tax configuration and records', href: '/taxes', terms: 'vat tax' },
  { label: 'Discounts', description: 'Manage discounts', href: '/discounts', terms: 'offers promotions' },
  { label: 'Reports', description: 'Financial and business reports', href: '/reports', terms: 'analytics statements' },
  { label: 'Audit Logs', description: 'Review system activity', href: '/audit-logs', terms: 'activity history' },
];

function AppLayoutInner({ children, title, subtitle, actions }: AppLayoutProps) {
  const { collapsed, mobileOpen, setMobileOpen } = useSidebarState();
  const { profile, roles, signOut } = useAuth();
  const navigate = useNavigate();
  const [featureQuery, setFeatureQuery] = useState('');
  const [searchOpen, setSearchOpen] = useState(false);
  const isAdmin = roles.includes('admin');
  const canAudit = roles.includes('admin') || roles.includes('auditor');
  const initials = (profile?.full_name || profile?.email || 'U')
    .split(/[\\s@]+/)
    .filter(Boolean)
    .map((part) => part[0])
    .join('')
    .toUpperCase()
    .slice(0, 2);

  const matchingFeatures = useMemo(() => {
    const query = featureQuery.trim().toLowerCase();
    if (!query) return [];
    return featureLinks.filter((item) =>
      `${item.label} ${item.description} ${item.terms}`.toLowerCase().includes(query)
    );
  }, [featureQuery]);

  const openFeature = (href: string) => {
    navigate(href);
    setFeatureQuery('');
    setSearchOpen(false);
  };

  return (
    <div className="min-h-screen w-full overflow-x-hidden bg-background">
      <AppSidebar />
      {mobileOpen && (
        <button
          type="button"
          aria-label="Close navigation menu"
          className="fixed inset-0 z-40 bg-black/40 md:hidden"
          onClick={() => setMobileOpen(false)}
        />
      )}

      <div className={cn(
        'min-h-screen min-w-0 transition-[margin] duration-300',
        'ml-0',
        collapsed ? 'md:ml-16' : 'md:ml-64'
      )}>
        <header className="sticky top-0 z-30 flex min-h-16 flex-wrap items-center justify-between gap-3 border-b border-border bg-background/95 px-3 py-3 backdrop-blur-sm sm:px-6">
          <div className="flex min-w-0 flex-1 items-center gap-3">
            <Button
              type="button"
              variant="outline"
              size="icon"
              aria-label="Open navigation menu"
              className="shrink-0 md:hidden"
              onClick={() => setMobileOpen(true)}
            >
              <Menu className="h-5 w-5" />
            </Button>
            {title && (
              <div className="min-w-0">
                <h1 className="truncate text-lg font-display font-bold text-foreground sm:text-xl">{title}</h1>
                {subtitle && <p className="hidden text-sm text-muted-foreground sm:block">{subtitle}</p>}
              </div>
            )}
          </div>

          <div className="flex min-w-0 flex-wrap items-center justify-end gap-2">
            <div className="relative order-last w-full md:order-none md:w-48 lg:w-64">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                aria-label="Search application features"
                aria-expanded={searchOpen && matchingFeatures.length > 0}
                placeholder="Find a feature..."
                className="w-full bg-secondary/50 pl-9 border-transparent focus:border-primary"
                value={featureQuery}
                onFocus={() => setSearchOpen(true)}
                onChange={(event) => {
                  setFeatureQuery(event.target.value);
                  setSearchOpen(true);
                }}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' && matchingFeatures[0]) {
                    event.preventDefault();
                    openFeature(matchingFeatures[0].href);
                  }
                  if (event.key === 'Escape') setSearchOpen(false);
                }}
                onBlur={() => window.setTimeout(() => setSearchOpen(false), 150)}
              />
              {searchOpen && featureQuery.trim() && (
                <div className="absolute right-0 top-full z-50 mt-2 max-h-80 w-[min(22rem,calc(100vw-2rem))] overflow-y-auto rounded-lg border bg-popover p-1 shadow-lg">
                  {matchingFeatures.length ? matchingFeatures.map((item) => (
                    <button
                      key={item.href}
                      type="button"
                      className="flex w-full items-center justify-between gap-3 rounded-md px-3 py-2 text-left hover:bg-accent"
                      onMouseDown={(event) => event.preventDefault()}
                      onClick={() => openFeature(item.href)}
                    >
                      <span className="min-w-0">
                        <span className="block text-sm font-medium">{item.label}</span>
                        <span className="block truncate text-xs text-muted-foreground">{item.description}</span>
                      </span>
                      <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
                    </button>
                  )) : (
                    <p className="px-3 py-4 text-sm text-muted-foreground">No matching feature. Use the page-specific search to find records.</p>
                  )}
                </div>
              )}
            </div>

            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon" className="relative shrink-0" aria-label="Notifications">
                  <Bell className="h-5 w-5" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-64 max-w-[calc(100vw-1rem)]">
                <DropdownMenuLabel>Notifications</DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuItem asChild>
                  <Link to="/notifications" className="flex items-center justify-between">
                    View notifications <ChevronRight className="h-4 w-4" />
                  </Link>
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>

            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon" className="shrink-0 rounded-full" aria-label="User profile and settings">
                  <Avatar className="h-8 w-8 border">
                    <AvatarImage src={profile?.avatar_url || undefined} alt="" />
                    <AvatarFallback className="text-xs">{initials}</AvatarFallback>
                  </Avatar>
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-60 max-w-[calc(100vw-1rem)]">
                <DropdownMenuLabel className="font-normal">
                  <span className="block truncate text-sm font-medium">{profile?.full_name || 'Account'}</span>
                  <span className="block truncate text-xs text-muted-foreground">{profile?.email || ''}</span>
                  <span className="mt-1 block text-xs capitalize text-muted-foreground">{roles.join(', ') || 'User'}</span>
                </DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuItem asChild><Link to="/profile"><User className="mr-2 h-4 w-4" />My profile</Link></DropdownMenuItem>
                <DropdownMenuItem asChild><Link to="/notifications"><Bell className="mr-2 h-4 w-4" />Notifications</Link></DropdownMenuItem>
                {isAdmin && <DropdownMenuItem asChild><Link to="/settings"><Settings className="mr-2 h-4 w-4" />Settings</Link></DropdownMenuItem>}
                {isAdmin && <DropdownMenuItem asChild><Link to="/admin/users"><Users className="mr-2 h-4 w-4" />User management</Link></DropdownMenuItem>}
                {canAudit && <DropdownMenuItem asChild><Link to="/admin/password-resets"><KeyRound className="mr-2 h-4 w-4" />Password resets</Link></DropdownMenuItem>}
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={() => void signOut()} className="text-destructive focus:text-destructive">
                  <LogOut className="mr-2 h-4 w-4" />Sign out
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>

            {actions && <div className="flex min-w-0 flex-wrap items-center justify-end gap-2">{actions}</div>}
          </div>
        </header>

        <main className="min-w-0 w-full p-3 sm:p-6">
          {children}
        </main>
      </div>
    </div>
  );
}

export function AppLayout(props: AppLayoutProps) {
  return (
    <SidebarProvider>
      <AppLayoutInner {...props} />
    </SidebarProvider>
  );
}
