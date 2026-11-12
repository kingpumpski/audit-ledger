-- The policy name already promises owner-only audit inserts, but its previous
-- predicate accepted every authenticated user and allowed user_id spoofing.
-- Keep client-side document audit logging while binding rows to the caller.
ALTER POLICY "Authenticated users can insert own audit logs"
ON public.audit_logs
WITH CHECK (user_id = (select auth.uid()));
