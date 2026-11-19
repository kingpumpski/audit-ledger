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
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
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
  CONSTRAINT supplier_products_business_supplier_product_key UNIQUE (business_id, supplier_id, product_id),
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

REVOKE ALL ON public.suppliers, public.supplier_products FROM PUBLIC, anon, service_role;
GRANT SELECT, INSERT, UPDATE ON public.suppliers, public.supplier_products TO authenticated;
GRANT SELECT, INSERT, UPDATE ON public.suppliers, public.supplier_products TO audit_ledger_rpc_owner;

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
