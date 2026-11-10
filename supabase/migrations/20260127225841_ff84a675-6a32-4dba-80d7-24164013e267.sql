-- Fix notification insert policy to be more restrictive
DROP POLICY IF EXISTS "System can create notifications" ON public.notifications;

CREATE POLICY "Employees can create notifications" ON public.notifications
  FOR INSERT TO authenticated
  WITH CHECK (public.has_any_role(auth.uid()));