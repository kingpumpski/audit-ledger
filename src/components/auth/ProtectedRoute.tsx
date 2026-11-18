import { ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { useBusiness } from '@/contexts/BusinessContext';
import { useEffectiveRoles } from '@/hooks/useEffectiveRoles';
import { BusinessSwitcher } from '@/components/layout/BusinessSwitcher';
import { Loader2 } from 'lucide-react';

type AppRole = 'admin' | 'accountant' | 'cashier' | 'auditor';

interface ProtectedRouteProps {
  children: ReactNode;
  requiredRoles?: AppRole[];
  requireAnyRole?: boolean;
}

export function ProtectedRoute({ 
  children, 
  requiredRoles, 
  requireAnyRole = true 
}: ProtectedRouteProps) {
  const { user, isLoading } = useAuth();
  const { memberships, activeMembership, isLoading: businessLoading } = useBusiness();
  const roles = useEffectiveRoles();
  const location = useLocation();

  if (isLoading || businessLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="flex flex-col items-center gap-4">
          <Loader2 className="h-10 w-10 animate-spin text-primary" />
          <p className="text-sm text-muted-foreground">Loading...</p>
        </div>
      </div>
    );
  }

  if (!user) {
    return <Navigate to="/login" state={{ from: location }} replace />;
  }

  if (memberships.length > 1 && !activeMembership) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-background p-4">
        <section className="w-full max-w-lg space-y-4 rounded-xl border bg-card p-6 shadow-sm">
          <h1 className="text-xl font-semibold">Choose a business workspace</h1>
          <p className="text-sm text-muted-foreground">
            Your account belongs to more than one business. Select which business you want to work in before continuing.
          </p>
          <BusinessSwitcher />
        </section>
      </main>
    );
  }

  // Check if user has any role (is an employee)
  if (requireAnyRole && roles.length === 0) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="text-center max-w-md mx-auto p-8">
          <div className="w-16 h-16 rounded-full bg-warning/10 flex items-center justify-center mx-auto mb-4">
            <span className="text-3xl">🔒</span>
          </div>
          <h1 className="text-2xl font-bold text-foreground mb-2">Access Pending</h1>
          <p className="text-muted-foreground mb-6">
            Your account has been created, but you don't have any assigned roles yet. 
            Please contact your administrator to get access.
          </p>
          <div className="text-sm text-muted-foreground">
            Logged in as: <span className="font-medium text-foreground">{user.email}</span>
          </div>
        </div>
      </div>
    );
  }

  // Check if user has required specific roles
  if (requiredRoles && requiredRoles.length > 0) {
    const hasRequiredRole = requiredRoles.some(role => roles.includes(role));
    if (!hasRequiredRole) {
      return (
        <div className="min-h-screen flex items-center justify-center bg-background">
          <div className="text-center max-w-md mx-auto p-8">
            <div className="w-16 h-16 rounded-full bg-destructive/10 flex items-center justify-center mx-auto mb-4">
              <span className="text-3xl">⛔</span>
            </div>
            <h1 className="text-2xl font-bold text-foreground mb-2">Access Denied</h1>
            <p className="text-muted-foreground mb-6">
              You don't have permission to access this page. 
              Required roles: {requiredRoles.join(', ')}
            </p>
          </div>
        </div>
      );
    }
  }

  return <>{children}</>;
}
