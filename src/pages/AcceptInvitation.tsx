import { useMemo, useState, type FormEvent } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import { CheckCircle2, Loader2, ShieldCheck } from "lucide-react";

export default function AcceptInvitation() {
  const { user, isLoading } = useAuth();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  const invitationId = useMemo(() => (
    searchParams.get("invitation_id") ||
    user?.app_metadata?.pending_business_invitation_id ||
    user?.user_metadata?.business_invitation_id ||
    ""
  ), [searchParams, user]);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!user || !invitationId) return;

    if (password.length < 10) {
      toast.error("Choose a password with at least 10 characters");
      return;
    }
    if (password !== confirmPassword) {
      toast.error("The passwords do not match");
      return;
    }

    setIsSubmitting(true);
    try {
      const { error: passwordError } = await supabase.auth.updateUser({ password });
      if (passwordError) throw passwordError;

      const { data: acceptance, error: acceptError } = await supabase.functions.invoke("accept-business-invitation", {
        body: { invitationId },
      });
      if (acceptError) throw acceptError;

      const acceptedBusinessId = typeof acceptance?.business_id === "string"
        ? acceptance.business_id
        : "";
      if (!acceptedBusinessId) {
        throw new Error("The invitation was accepted without a valid workspace response. Contact the business owner before continuing.");
      }

      // The Edge Function normally sets app_metadata itself. Retry through the
      // dedicated workspace function if that metadata update was unavailable,
      // so multi-business invitees never land in an ambiguous workspace.
      if (acceptance?.active_business_set !== true) {
        const { error: workspaceError } = await supabase.functions.invoke("set-active-business", {
          body: { businessId: acceptedBusinessId },
        });
        if (workspaceError) {
          throw new Error("Your invitation was accepted, but your active workspace could not be selected. Please sign in again or contact the business owner.");
        }
      }

      await queryClient.cancelQueries();
      queryClient.clear();
      const { error: refreshError } = await supabase.auth.refreshSession();
      if (refreshError) throw refreshError;

      toast.success("Your business access is ready");
      navigate("/dashboard", { replace: true });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Unable to accept this invitation");
    } finally {
      setIsSubmitting(false);
    }
  };

  if (isLoading) {
    return <main className="flex min-h-screen items-center justify-center text-sm text-muted-foreground">Checking your invitation...</main>;
  }

  if (!user) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-muted/30 p-4">
        <section className="w-full max-w-md rounded-2xl border bg-card p-7 shadow-sm">
          <ShieldCheck className="mb-4 h-8 w-8 text-primary" />
          <h1 className="text-xl font-semibold">Accept your business invitation</h1>
          <p className="mt-2 text-sm text-muted-foreground">Open the invitation link in this browser and sign in with the email address that received it.</p>
          <Button asChild className="mt-6 w-full"><Link to="/login">Go to sign in</Link></Button>
        </section>
      </main>
    );
  }

  if (!invitationId) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-muted/30 p-4">
        <section className="w-full max-w-md rounded-2xl border bg-card p-7 shadow-sm">
          <h1 className="text-xl font-semibold">Invitation not found</h1>
          <p className="mt-2 text-sm text-muted-foreground">This session does not contain a pending business invitation. Ask the business owner to send a new invitation.</p>
          <Button asChild className="mt-6 w-full"><Link to="/dashboard">Continue to Audit Ledger</Link></Button>
        </section>
      </main>
    );
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-muted/30 p-4">
      <section className="w-full max-w-md rounded-2xl border bg-card p-7 shadow-sm">
        <CheckCircle2 className="mb-4 h-8 w-8 text-primary" />
        <h1 className="text-xl font-semibold">Complete your business invitation</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Signed in as <span className="font-medium text-foreground">{user.email}</span>. Create a password to secure your account and activate your business membership.
        </p>
        <form onSubmit={submit} className="mt-6 space-y-4">
          <div className="space-y-2">
            <label htmlFor="invite-password" className="text-sm font-medium">New password</label>
            <Input
              id="invite-password"
              type="password"
              autoComplete="new-password"
              minLength={10}
              required
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              placeholder="At least 10 characters"
            />
          </div>
          <div className="space-y-2">
            <label htmlFor="invite-password-confirm" className="text-sm font-medium">Confirm password</label>
            <Input
              id="invite-password-confirm"
              type="password"
              autoComplete="new-password"
              minLength={10}
              required
              value={confirmPassword}
              onChange={(event) => setConfirmPassword(event.target.value)}
              placeholder="Re-enter your password"
            />
          </div>
          <Button type="submit" className="w-full" disabled={isSubmitting}>
            {isSubmitting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <ShieldCheck className="mr-2 h-4 w-4" />}
            {isSubmitting ? "Activating access..." : "Set password and accept"}
          </Button>
        </form>
        <p className="mt-4 text-xs text-muted-foreground">Invitation links expire after one hour. If yours has expired, ask the business owner to send another invitation.</p>
      </section>
    </main>
  );
}
