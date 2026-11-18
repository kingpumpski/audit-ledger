-- The audit trigger is a trusted SECURITY DEFINER routine owned by
-- audit_ledger_rpc_owner. It must be able to record creation events for a
-- newly created business before the actor has an active membership in it.
-- Keep tenant-scoped reads and client writes, but allow the constrained RPC
-- owner to insert the corresponding audit event.
DROP POLICY IF EXISTS tenant_business_scope ON public.audit_logs;

CREATE POLICY tenant_business_scope
  ON public.audit_logs
  AS RESTRICTIVE
  FOR ALL
  TO public
  USING (
    business_id IS NULL
    OR (
      business_id = public.current_business_id()
      AND public.can_access_business(business_id)
    )
  )
  WITH CHECK (
    CASE
      WHEN current_user = 'audit_ledger_rpc_owner' THEN true
      ELSE business_id IS NULL
        OR (
          business_id = public.current_business_id()
          AND public.can_access_business(business_id)
        )
    END
  );

NOTIFY pgrst, 'reload schema';
