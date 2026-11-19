-- A user must be able to see their own inactive membership status so the
-- client can distinguish a suspended/pending workspace account from a legacy
-- account with no membership history. Other users still see only active
-- workspaces they belong to; the constrained RPC owner retains its policy path.
BEGIN;

DROP POLICY IF EXISTS business_members_select_members ON public.business_members;

CREATE POLICY business_members_select_members
  ON public.business_members
  FOR SELECT
  TO authenticated
  USING (
    CASE
      WHEN current_user = 'audit_ledger_rpc_owner' THEN true
      ELSE user_id = auth.uid() OR public.is_business_member(business_id)
    END
  );

NOTIFY pgrst, 'reload schema';
COMMIT;
