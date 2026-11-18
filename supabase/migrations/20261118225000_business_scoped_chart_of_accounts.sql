-- Chart-of-accounts codes are unique within a business, not globally.
-- New workspaces receive their own copy of the system chart before creation
-- returns, so finance and inventory postings remain tenant-complete.
BEGIN;

ALTER TABLE public.chart_of_accounts
  DROP CONSTRAINT IF EXISTS chart_of_accounts_code_key;
DROP INDEX IF EXISTS public.chart_of_accounts_code_key;

CREATE UNIQUE INDEX IF NOT EXISTS uq_business_chart_accounts_code
  ON public.chart_of_accounts (business_id, code);

CREATE OR REPLACE FUNCTION app_private.seed_business_chart_of_accounts(
  p_business_id uuid,
  p_created_by uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $seed_business_chart_of_accounts$
DECLARE
  v_source_business_id uuid;
  v_currency text;
  v_inserted integer;
  v_previous_claim_sub text;
  v_previous_claims text;
BEGIN
  IF p_business_id IS NULL THEN
    RAISE EXCEPTION 'A business is required to seed its chart of accounts';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.chart_of_accounts
    WHERE business_id = p_business_id
  ) THEN
    RETURN;
  END IF;

  v_source_business_id := public.legacy_business_id();
  IF p_business_id = v_source_business_id THEN
    RETURN;
  END IF;

  SELECT base_currency INTO v_currency
  FROM public.businesses
  WHERE id = p_business_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Business was not found while seeding its chart of accounts';
  END IF;

  -- Attribute migration backfill audit entries to the workspace creator when
  -- no authenticated request identity is present.
  IF auth.uid() IS NULL AND p_created_by IS NOT NULL THEN
    v_previous_claim_sub := current_setting('request.jwt.claim.sub', true);
    v_previous_claims := current_setting('request.jwt.claims', true);
    PERFORM set_config('request.jwt.claim.sub', p_created_by::text, true);
    PERFORM set_config(
      'request.jwt.claims',
      jsonb_build_object('sub', p_created_by, 'role', 'authenticated')::text,
      true
    );
  END IF;

  PERFORM set_config('app.seed_business_chart_accounts', 'on', true);

  WITH source_accounts AS MATERIALIZED (
    SELECT
      source.id AS source_id,
      pg_catalog.gen_random_uuid() AS new_id,
      source.code,
      source.name,
      source.description,
      source.account_type,
      source.account_subtype,
      source.parent_id,
      source.is_active
    FROM public.chart_of_accounts source
    WHERE source.business_id = v_source_business_id
      AND source.is_system = true
  ),
  inserted AS (
    INSERT INTO public.chart_of_accounts (
      id, business_id, code, name, description, account_type, account_subtype,
      parent_id, is_active, is_system, opening_balance, current_balance,
      currency, created_by
    )
    SELECT
      child.new_id,
      p_business_id,
      child.code,
      child.name,
      child.description,
      child.account_type,
      child.account_subtype,
      parent.new_id,
      child.is_active,
      true,
      0,
      0,
      COALESCE(v_currency, 'GHS'),
      p_created_by
    FROM source_accounts child
    LEFT JOIN source_accounts parent ON parent.source_id = child.parent_id
    ORDER BY child.code
    RETURNING id
  )
  SELECT count(*)::integer INTO v_inserted FROM inserted;

  -- Ensure the stock-count gain and shrinkage accounts exist even if an older
  -- workspace was missing those system accounts when the template was copied.
  INSERT INTO public.chart_of_accounts (
    business_id, code, name, account_type, is_active, is_system, currency, created_by
  ) VALUES
    (p_business_id, '1200', 'Inventory', 'asset', true, true, COALESCE(v_currency, 'GHS'), p_created_by),
    (p_business_id, '4900', 'Inventory Count Variance Gain', 'revenue', true, true, COALESCE(v_currency, 'GHS'), p_created_by),
    (p_business_id, '6500', 'Inventory Shrinkage', 'expense', true, true, COALESCE(v_currency, 'GHS'), p_created_by)
  ON CONFLICT (business_id, code) DO NOTHING;

  IF v_inserted = 0 AND NOT EXISTS (
    SELECT 1 FROM public.chart_of_accounts WHERE business_id = p_business_id
  ) THEN
    RAISE EXCEPTION 'No system chart-of-accounts template is available to seed this business';
  END IF;

  PERFORM set_config('app.seed_business_chart_accounts', 'off', true);

  IF v_previous_claim_sub IS NOT NULL OR v_previous_claims IS NOT NULL THEN
    PERFORM set_config('request.jwt.claim.sub', COALESCE(v_previous_claim_sub, ''), true);
    PERFORM set_config('request.jwt.claims', COALESCE(v_previous_claims, '{}'), true);
  END IF;
END;
$seed_business_chart_of_accounts$;

REVOKE ALL ON FUNCTION app_private.seed_business_chart_of_accounts(uuid, uuid)
  FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION app_private.seed_business_chart_accounts_after_owner_membership()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $seed_business_chart_accounts_after_owner_membership$
BEGIN
  IF NEW.role = 'owner' AND NEW.status = 'active' THEN
    PERFORM app_private.seed_business_chart_of_accounts(NEW.business_id, NEW.user_id);
  END IF;
  RETURN NEW;
END;
$seed_business_chart_accounts_after_owner_membership$;

REVOKE ALL ON FUNCTION app_private.seed_business_chart_accounts_after_owner_membership()
  FROM PUBLIC, anon, authenticated, service_role;

DROP TRIGGER IF EXISTS seed_business_chart_accounts_after_owner_membership
  ON public.business_members;
CREATE TRIGGER seed_business_chart_accounts_after_owner_membership
  AFTER INSERT ON public.business_members
  FOR EACH ROW
  WHEN (NEW.role = 'owner' AND NEW.status = 'active')
  EXECUTE FUNCTION app_private.seed_business_chart_accounts_after_owner_membership();

-- Avoid flooding the new workspace with one notification per seeded account;
-- the account-level audit log entries are still retained.
DROP TRIGGER IF EXISTS notify_members_after_audit_log_insert ON public.audit_logs;
CREATE TRIGGER notify_members_after_audit_log_insert
  AFTER INSERT ON public.audit_logs
  FOR EACH ROW
  WHEN (current_setting('app.seed_business_chart_accounts', true) IS DISTINCT FROM 'on')
  EXECUTE FUNCTION public.notify_members_of_audit_activity();

-- Backfill businesses created before this migration that have no chart yet.
DO $seed_existing_businesses$
DECLARE
  v_business record;
BEGIN
  FOR v_business IN
    SELECT b.id, b.created_by
    FROM public.businesses b
    WHERE b.business_type <> 'legacy_workspace'
      AND NOT EXISTS (
        SELECT 1 FROM public.chart_of_accounts coa WHERE coa.business_id = b.id
      )
    ORDER BY b.created_at, b.id
  LOOP
    PERFORM app_private.seed_business_chart_of_accounts(v_business.id, v_business.created_by);
  END LOOP;
END;
$seed_existing_businesses$;

NOTIFY pgrst, 'reload schema';
COMMIT;
