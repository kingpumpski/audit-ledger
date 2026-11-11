import { ReactNode } from 'react';
import { AppSidebar } from './AppSidebar';
import { SidebarProvider, useSidebarState } from '@/contexts/SidebarContext';
import { Button } from '@/components/ui/button';
import { Bell, Search, Menu } from 'lucide-react';
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

function AppLayoutInner({ children, title, subtitle, actions }: AppLayoutProps) {
  const { collapsed, mobileOpen, setMobileOpen } = useSidebarState();

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
            <div className="relative hidden md:block">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                placeholder="Search..."
                className="w-48 bg-secondary/50 pl-9 border-transparent focus:border-primary lg:w-64"
              />
            </div>

            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon" className="relative shrink-0" aria-label="Notifications">
                  <Bell className="h-5 w-5" />
                  <span className="absolute -right-0.5 -top-0.5 flex h-4 w-4 items-center justify-center rounded-full bg-destructive text-[10px] font-medium text-destructive-foreground">3</span>
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-80 max-w-[calc(100vw-1rem)]">
                <DropdownMenuLabel>Notifications</DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuItem className="flex flex-col items-start gap-1 py-3">
                  <p className="text-sm font-medium">Invoice #INV-000042 is overdue</p>
                  <p className="text-xs text-muted-foreground">Payment was due 3 days ago</p>
                </DropdownMenuItem>
                <DropdownMenuItem className="flex flex-col items-start gap-1 py-3">
                  <p className="text-sm font-medium">New payment received</p>
                  <p className="text-xs text-muted-foreground">$1,250.00 from Acme Corp</p>
                </DropdownMenuItem>
                <DropdownMenuItem className="flex flex-col items-start gap-1 py-3">
                  <p className="text-sm font-medium">Low stock alert</p>
                  <p className="text-xs text-muted-foreground">Widget Pro is below minimum level</p>
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem className="justify-center text-center text-primary">View all notifications</DropdownMenuItem>
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
