import type { ReactNode } from "react";
import { Navigate } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { useBusiness } from "@/contexts/BusinessContext";

export function BusinessManagerRoute({ children }: { children: ReactNode }) {
  const { user, isLoading: authLoading } = useAuth();
  const { activeMembership, isLoading: businessLoading } = useBusiness();

  if (authLoading || businessLoading) {
    return <div className="flex min-h-screen items-center justify-center text-sm text-muted-foreground">Loading access...</div>;
  }

  if (!user) return <Navigate to="/login" replace />;
  if (!activeMembership || !["owner", "admin"].includes(activeMembership.role)) {
    return <Navigate to="/dashboard" replace />;
  }

  return <>{children}</>;
}
