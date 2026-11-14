-- Phase 1 of business tenancy: create secure business and membership primitives.
-- Existing business records and role policies remain unchanged until a separately
-- rehearsed ownership backfill and cross-tenant policy migration is approved.

CREATE TABLE public.businesses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 160),
  business_type text NOT NULL DEFAULT 'small_business'
    CHECK (length(btrim(business_type)) BETWEEN 1 AND 64),
  country text NOT NULL DEFAULT 'Ghana'
    CHECK (length(btrim(country)) BETWEEN 2 AND 100),
  base_currency text NOT NULL DEFAULT 'GHS'
    CHECK (base_currency ~ '^[A-Z]{3}$'),
  timezone text NOT NULL DEFAULT 'Africa/Accra'
    CHECK (length(btrim(timezone)) BETWEEN 1 AND 100),
  status text NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'suspended', 'archived')),
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.business_members (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role text NOT NULL CHECK (role IN ('owner', 'admin', 'accountant', 'cashier', 'auditor')),
  status text NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'invited', 'suspended')),
  invited_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  joined_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (business_id, user_id)
);

CREATE INDEX idx_business_members_user_active
  ON public.business_members(user_id, business_id)
  WHERE status = 'active';
CREATE INDEX idx_business_members_business_role
  ON public.business_members(business_id, role, status);

ALTER TABLE public.businesses ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.business_members ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.is_business_member(p_business_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $is_business_member$
  SELECT EXISTS (
    SELECT 1
    FROM public.business_members bm
    WHERE bm.business_id = p_business_id
      AND bm.user_id = (SELECT auth.uid())
      AND bm.status = 'active'
  );
$is_business_member$;

CREATE OR REPLACE FUNCTION public.has_business_role(
  p_business_id uuid,
  p_roles text[]
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $has_business_role$
  SELECT EXISTS (
    SELECT 1
    FROM public.business_members bm
    WHERE bm.business_id = p_business_id
      AND bm.user_id = (SELECT auth.uid())
      AND bm.status = 'active'
      AND bm.role = ANY(COALESCE(p_roles, ARRAY[]::text[]))
  );
$has_business_role$;

CREATE OR REPLACE FUNCTION public.create_business(
  p_name text,
  p_business_type text DEFAULT 'small_business',
  p_country text DEFAULT 'Ghana',
  p_base_currency text DEFAULT 'GHS',
  p_timezone text DEFAULT 'Africa/Accra'
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $create_business$
DECLARE
  v_business_id uuid;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'An authenticated user is required to create a business';
  END IF;

  IF p_name IS NULL OR length(btrim(p_name)) NOT BETWEEN 1 AND 160 THEN
    RAISE EXCEPTION 'Enter a business name between 1 and 160 characters';
  END IF;
  IF p_business_type IS NULL OR length(btrim(p_business_type)) NOT BETWEEN 1 AND 64 THEN
    RAISE EXCEPTION 'Select a valid business type';
  END IF;
  IF p_country IS NULL OR length(btrim(p_country)) NOT BETWEEN 2 AND 100 THEN
    RAISE EXCEPTION 'Enter a valid country';
  END IF;
  IF p_base_currency IS NULL OR p_base_currency !~ '^[A-Z]{3}$' THEN
    RAISE EXCEPTION 'Use a three-letter uppercase base currency code';
  END IF;
  IF p_timezone IS NULL OR length(btrim(p_timezone)) NOT BETWEEN 1 AND 100 THEN
    RAISE EXCEPTION 'Enter a valid business timezone';
  END IF;

  INSERT INTO public.businesses (
    name, business_type, country, base_currency, timezone, created_by
  )
  VALUES (
    btrim(p_name), btrim(p_business_type), btrim(p_country),
    p_base_currency, btrim(p_timezone), auth.uid()
  )
  RETURNING id INTO v_business_id;

  INSERT INTO public.business_members (
    business_id, user_id, role, status, joined_at
  )
  VALUES (v_business_id, auth.uid(), 'owner', 'active', now());

  RETURN v_business_id;
END;
$create_business$;

CREATE POLICY businesses_select_members
  ON public.businesses
  FOR SELECT
  TO authenticated
  USING (public.is_business_member(id));

CREATE POLICY business_members_select_members
  ON public.business_members
  FOR SELECT
  TO authenticated
  USING (public.is_business_member(business_id));

-- New membership and business records are only created through the guarded RPC.
-- No direct UPDATE/DELETE policy is added; membership administration is a later
-- audited RPC, including last-owner protection and invitation acceptance.

REVOKE ALL ON TABLE public.businesses, public.business_members FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.businesses, public.business_members TO authenticated;

REVOKE ALL ON FUNCTION public.is_business_member(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.has_business_role(uuid, text[]) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.create_business(text, text, text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_business_member(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.has_business_role(uuid, text[]) TO authenticated;
GRANT EXECUTE ON FUNCTION public.create_business(text, text, text, text, text) TO authenticated;

-- Preserve the existing single-workspace installation as one legacy business.
-- The migration is additive: it does not yet add business_id to operational
-- tables or change their existing access policies.
DO $legacy_business$
DECLARE
  v_business_id uuid;
  v_admin_id uuid;
BEGIN
  SELECT ur.user_id
    INTO v_admin_id
  FROM public.user_roles ur
  WHERE ur.role::text = 'admin'
  ORDER BY ur.user_id
  LIMIT 1;

  SELECT b.id
    INTO v_business_id
  FROM public.businesses b
  WHERE b.business_type = 'legacy_workspace'
  ORDER BY b.created_at
  LIMIT 1;

  IF v_business_id IS NULL THEN
    INSERT INTO public.businesses (
      name, business_type, country, base_currency, timezone, created_by
    )
    SELECT
      COALESCE(NULLIF(btrim(cs.company_name), ''), 'Legacy workspace'),
      'legacy_workspace',
      COALESCE(NULLIF(btrim(cs.company_country), ''), 'Ghana'),
      CASE
        WHEN upper(COALESCE(NULLIF(btrim(cs.currency_code), ''), 'USD')) ~ '^[A-Z]{3}$'
          THEN upper(COALESCE(NULLIF(btrim(cs.currency_code), ''), 'USD'))
        ELSE 'USD'
      END,
      'Africa/Accra',
      v_admin_id
    FROM (
      SELECT company_name, company_country, currency_code
      FROM public.company_settings
      ORDER BY created_at
      LIMIT 1
    ) cs
    RETURNING id INTO v_business_id;

    IF v_business_id IS NULL THEN
      INSERT INTO public.businesses (
        name, business_type, country, base_currency, timezone, created_by
      )
      VALUES ('Legacy workspace', 'legacy_workspace', 'Ghana', 'GHS', 'Africa/Accra', v_admin_id)
      RETURNING id INTO v_business_id;
    END IF;
  END IF;

  INSERT INTO public.business_members (
    business_id, user_id, role, status, joined_at
  )
  SELECT
    v_business_id,
    ur.user_id,
    CASE
      WHEN ur.role::text = 'admin' AND ur.user_id = v_admin_id THEN 'owner'
      WHEN ur.role::text = 'admin' THEN 'admin'
      ELSE ur.role::text
    END,
    'active',
    now()
  FROM public.user_roles ur
  WHERE ur.role::text IN ('admin', 'accountant', 'cashier', 'auditor')
  ON CONFLICT (business_id, user_id) DO NOTHING;
END;
$legacy_business$;

NOTIFY pgrst, 'reload schema';
