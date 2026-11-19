-- Business-scoped supplier directory and supplier/product purchasing terms.
-- Purchase orders and goods receipts will build on this stable master-data layer.
BEGIN;

CREATE TABLE public.suppliers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES public.businesses(id) ON DELETE RESTRICT,
  supplier_code text,
  name text NOT NULL,
  legal_name text,
  contact_name text,
  email text,
  phone text,
  tax_identifier text,
  address text,
  payment_terms_days integer NOT NULL DEFAULT 0,
  currency text,
  notes text,
  is_active boolean NOT NULL DEFAULT true,
  created_by uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT suppliers_business_id_key UNIQUE (business_id, id),
  CONSTRAINT suppliers_name_nonblank CHECK (length(btrim(name)) > 0),
  CONSTRAINT suppliers_code_nonblank CHECK (supplier_code IS NULL OR length(btrim(supplier_code)) > 0),
  CONSTRAINT suppliers_payment_terms_nonnegative CHECK (payment_terms_days >= 0),
  CONSTRAINT suppliers_currency_format CHECK (currency IS NULL OR currency ~ '^[A-Z]{3}$')
);

CREATE UNIQUE INDEX uq_suppliers_business_code
  ON public.suppliers (business_id, lower(supplier_code))
  WHERE supplier_code IS NOT NULL;
CREATE INDEX idx_suppliers_business_name
  ON public.suppliers (business_id, lower(name));
CREATE INDEX idx_suppliers_business_active
  ON public.suppliers (business_id, is_active);
CREATE INDEX idx_suppliers_created_by
  ON public.suppliers (created_by);

CREATE TABLE public.supplier_products (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES public.businesses(id) ON DELETE RESTRICT,
  supplier_id uuid NOT NULL,
  product_id uuid NOT NULL,
  supplier_sku text,
  unit_cost numeric(15,4),
  currency text,
  minimum_order_quantity numeric(15,3) NOT NULL DEFAULT 1,
  order_multiple numeric(15,3) NOT NULL DEFAULT 1,
  lead_time_days integer NOT NULL DEFAULT 0,
  is_preferred boolean NOT NULL DEFAULT false,
  is_active boolean NOT NULL DEFAULT true,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT supplier_products_business_id_key UNIQUE (business_id, id),
  CONSTRAINT supplier_products_supplier_fk
    FOREIGN KEY (business_id, supplier_id)
    REFERENCES public.suppliers (business_id, id) ON DELETE RESTRICT,
  CONSTRAINT supplier_products_product_fk
    FOREIGN KEY (business_id, product_id)
    REFERENCES public.products (business_id, id) ON DELETE RESTRICT,
  CONSTRAINT supplier_products_cost_nonnegative CHECK (unit_cost IS NULL OR unit_cost >= 0),
  CONSTRAINT supplier_products_currency_format CHECK (currency IS NULL OR currency ~ '^[A-Z]{3}$'),
  CONSTRAINT supplier_products_cost_currency_pair CHECK (unit_cost IS NULL OR currency IS NOT NULL),
  CONSTRAINT supplier_products_minimum_positive CHECK (minimum_order_quantity > 0),
  CONSTRAINT supplier_products_multiple_positive CHECK (order_multiple > 0),
  CONSTRAINT supplier_products_lead_time_nonnegative CHECK (lead_time_days >= 0),
  CONSTRAINT supplier_products_sku_nonblank CHECK (supplier_sku IS NULL OR length(btrim(supplier_sku)) > 0)
);

-- Preserve deactivated supplier-product terms as history while allowing a new
-- active relationship for the same supplier/product pair.
CREATE UNIQUE INDEX uq_supplier_products_active_supplier_product
  ON public.supplier_products (business_id, supplier_id, product_id)
  WHERE is_active;
CREATE UNIQUE INDEX uq_supplier_products_sku
  ON public.supplier_products (business_id, supplier_id, lower(supplier_sku))
  WHERE supplier_sku IS NOT NULL;
CREATE UNIQUE INDEX uq_supplier_products_preferred
  ON public.supplier_products (business_id, product_id)
  WHERE is_preferred AND is_active;
CREATE INDEX idx_supplier_products_business_product
  ON public.supplier_products (business_id, product_id, is_active);
CREATE INDEX idx_supplier_products_business_supplier
  ON public.supplier_products (business_id, supplier_id, is_active);

ALTER TABLE public.suppliers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.supplier_products ENABLE ROW LEVEL SECURITY;

CREATE POLICY suppliers_select_members
  ON public.suppliers FOR SELECT TO authenticated
  USING (public.is_business_member(business_id));
CREATE POLICY suppliers_insert_managers
  ON public.suppliers FOR INSERT TO authenticated
  WITH CHECK (public.has_business_role(business_id, ARRAY['owner', 'admin', 'accountant']));
CREATE POLICY suppliers_update_managers
  ON public.suppliers FOR UPDATE TO authenticated
  USING (public.has_business_role(business_id, ARRAY['owner', 'admin', 'accountant']))
  WITH CHECK (public.has_business_role(business_id, ARRAY['owner', 'admin', 'accountant']));

CREATE POLICY supplier_products_select_members
  ON public.supplier_products FOR SELECT TO authenticated
  USING (public.is_business_member(business_id));
CREATE POLICY supplier_products_insert_managers
  ON public.supplier_products FOR INSERT TO authenticated
  WITH CHECK (public.has_business_role(business_id, ARRAY['owner', 'admin', 'accountant']));
CREATE POLICY supplier_products_update_managers
  ON public.supplier_products FOR UPDATE TO authenticated
  USING (public.has_business_role(business_id, ARRAY['owner', 'admin', 'accountant']))
  WITH CHECK (public.has_business_role(business_id, ARRAY['owner', 'admin', 'accountant']));

-- Explicitly revoke inherited/default table privileges before granting the
-- supported operations. In particular, client sessions must never hard-delete
-- supplier master data or purchasing history.
REVOKE ALL ON public.suppliers, public.supplier_products
  FROM PUBLIC, anon, authenticated, service_role, audit_ledger_rpc_owner;
GRANT SELECT, INSERT, UPDATE ON public.suppliers, public.supplier_products TO authenticated;
GRANT SELECT, INSERT, UPDATE ON public.suppliers, public.supplier_products TO audit_ledger_rpc_owner;

CREATE OR REPLACE FUNCTION app_private.guard_supplier_directory_identity()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $guard_supplier_directory_identity$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'An authenticated business user is required to maintain supplier records'
      USING ERRCODE = '42501';
  END IF;

  IF TG_OP = 'INSERT' THEN
    IF TG_TABLE_NAME = 'suppliers' THEN
      NEW.created_by := auth.uid();
    END IF;
  ELSE
    IF NEW.business_id IS DISTINCT FROM OLD.business_id THEN
      RAISE EXCEPTION 'Supplier records cannot be moved between businesses';
    END IF;
    IF TG_TABLE_NAME = 'suppliers' THEN
      NEW.created_by := OLD.created_by;
    ELSIF NEW.supplier_id IS DISTINCT FROM OLD.supplier_id
       OR NEW.product_id IS DISTINCT FROM OLD.product_id THEN
      RAISE EXCEPTION 'Supplier-product identity cannot be reassigned; deactivate the old link and create a new one';
    END IF;
  END IF;
  RETURN NEW;
END;
$guard_supplier_directory_identity$;

REVOKE ALL ON FUNCTION app_private.guard_supplier_directory_identity()
  FROM PUBLIC, anon, authenticated, service_role;

CREATE TRIGGER suppliers_guard_identity
  BEFORE INSERT OR UPDATE ON public.suppliers
  FOR EACH ROW EXECUTE FUNCTION app_private.guard_supplier_directory_identity();
CREATE TRIGGER supplier_products_guard_identity
  BEFORE INSERT OR UPDATE ON public.supplier_products
  FOR EACH ROW EXECUTE FUNCTION app_private.guard_supplier_directory_identity();

CREATE OR REPLACE FUNCTION app_private.touch_supplier_directory_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $touch_supplier_directory_updated_at$
BEGIN
  NEW.updated_at := pg_catalog.now();
  RETURN NEW;
END;
$touch_supplier_directory_updated_at$;

REVOKE ALL ON FUNCTION app_private.touch_supplier_directory_updated_at()
  FROM PUBLIC, anon, authenticated, service_role;

CREATE TRIGGER suppliers_touch_updated_at
  BEFORE UPDATE ON public.suppliers
  FOR EACH ROW EXECUTE FUNCTION app_private.touch_supplier_directory_updated_at();
CREATE TRIGGER supplier_products_touch_updated_at
  BEFORE UPDATE ON public.supplier_products
  FOR EACH ROW EXECUTE FUNCTION app_private.touch_supplier_directory_updated_at();

CREATE TRIGGER audit_activity_suppliers
  AFTER INSERT OR UPDATE ON public.suppliers
  FOR EACH ROW EXECUTE FUNCTION public.audit_trigger_func();
CREATE TRIGGER audit_activity_supplier_products
  AFTER INSERT OR UPDATE ON public.supplier_products
  FOR EACH ROW EXECUTE FUNCTION public.audit_trigger_func();

NOTIFY pgrst, 'reload schema';
COMMIT;
