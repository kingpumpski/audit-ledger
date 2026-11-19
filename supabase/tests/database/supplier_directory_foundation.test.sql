CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
BEGIN;
SELECT extensions.plan(12);

INSERT INTO auth.users (
  id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data
) VALUES
  ('e6000000-0000-4000-8000-000000000001', 'authenticated', 'authenticated', 'supplier-owner@example.invalid', '', now(), '{}'::jsonb, '{}'::jsonb),
  ('e6000000-0000-4000-8000-000000000002', 'authenticated', 'authenticated', 'supplier-cashier@example.invalid', '', now(), '{}'::jsonb, '{}'::jsonb),
  ('e6000000-0000-4000-8000-000000000003', 'authenticated', 'authenticated', 'supplier-other-owner@example.invalid', '', now(), '{}'::jsonb, '{}'::jsonb);

INSERT INTO public.businesses (
  id, name, business_type, country, base_currency, timezone, status
) VALUES
  ('e6000000-0000-4000-8000-000000000010', 'Supplier Test One', 'small_business', 'Ghana', 'GHS', 'Africa/Accra', 'active'),
  ('e6000000-0000-4000-8000-000000000020', 'Supplier Test Two', 'small_business', 'Ghana', 'USD', 'Africa/Accra', 'active');

-- Business creation in production is expected to provision a default store.
-- The test fixture inserts businesses directly, so create their locations explicitly
-- before products trigger initial stock-balance creation.
INSERT INTO public.store_locations (
  business_id, code, name, location_type, timezone, is_default, is_active
) VALUES
  ('e6000000-0000-4000-8000-000000000010', 'MAIN', 'Supplier Test One Main Store', 'store', 'Africa/Accra', true, true),
  ('e6000000-0000-4000-8000-000000000020', 'MAIN', 'Supplier Test Two Main Store', 'store', 'Africa/Accra', true, true);

INSERT INTO public.business_members (business_id, user_id, role, status, joined_at)
VALUES
  ('e6000000-0000-4000-8000-000000000010', 'e6000000-0000-4000-8000-000000000001', 'owner', 'active', now()),
  ('e6000000-0000-4000-8000-000000000010', 'e6000000-0000-4000-8000-000000000002', 'cashier', 'active', now()),
  ('e6000000-0000-4000-8000-000000000020', 'e6000000-0000-4000-8000-000000000003', 'owner', 'active', now());

INSERT INTO public.products (
  id, business_id, sku, name, current_price, stock_quantity, min_stock_level, is_service, is_active
) VALUES
  ('e6000000-0000-4000-8000-000000000030', 'e6000000-0000-4000-8000-000000000010', 'SUP-ITEM-1', 'Supplier Test Item One', 10, 0, 0, false, true),
  ('e6000000-0000-4000-8000-000000000040', 'e6000000-0000-4000-8000-000000000020', 'SUP-ITEM-2', 'Supplier Test Item Two', 10, 0, 0, false, true);

SELECT extensions.ok(
  (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.suppliers'::regclass)
  AND (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.supplier_products'::regclass),
  'Supplier and supplier-product tables enforce row-level security'
);
SELECT extensions.ok(
  NOT has_table_privilege('authenticated', 'public.suppliers', 'DELETE')
  AND NOT has_table_privilege('authenticated', 'public.supplier_products', 'DELETE'),
  'Supplier history cannot be hard-deleted by client sessions'
);

SELECT set_config(
  'request.jwt.claims',
  jsonb_build_object('sub', 'e6000000-0000-4000-8000-000000000001', 'role', 'authenticated',
    'app_metadata', jsonb_build_object('active_business_id', 'e6000000-0000-4000-8000-000000000010'))::text,
  true
);
SELECT set_config('request.jwt.claim.sub', 'e6000000-0000-4000-8000-000000000001', true);
SET LOCAL ROLE authenticated;

INSERT INTO public.suppliers (business_id, supplier_code, name, currency, created_by)
VALUES ('e6000000-0000-4000-8000-000000000010', 'SUP-001', 'Accra Wholesale Ltd', 'GHS', auth.uid());

SELECT extensions.is(
  (SELECT count(*)::integer FROM public.suppliers WHERE business_id = 'e6000000-0000-4000-8000-000000000010'),
  1,
  'An active business owner can create a supplier in the current business'
);
SELECT extensions.is(
  (SELECT count(*)::integer FROM public.suppliers WHERE business_id = 'e6000000-0000-4000-8000-000000000020'),
  0,
  'A business owner cannot read another business supplier directory'
);

SELECT extensions.throws_ok(
  $$ INSERT INTO public.suppliers (business_id, supplier_code, name)
     VALUES ('e6000000-0000-4000-8000-000000000020', 'OTHER-001', 'Cross Tenant Supplier') $$,
  '42501',
  NULL,
  'An owner cannot create a supplier in a business they do not manage'
);

INSERT INTO public.supplier_products (
  business_id, supplier_id, product_id, supplier_sku, unit_cost, currency,
  minimum_order_quantity, order_multiple, lead_time_days, is_preferred
)
SELECT
  'e6000000-0000-4000-8000-000000000010', s.id,
  'e6000000-0000-4000-8000-000000000030', 'WHOLESALE-001', 5.25, 'GHS',
  6, 6, 3, true
FROM public.suppliers s
WHERE s.business_id = 'e6000000-0000-4000-8000-000000000010'
  AND s.supplier_code = 'SUP-001';

SELECT extensions.is(
  (SELECT count(*)::integer FROM public.supplier_products
   WHERE business_id = 'e6000000-0000-4000-8000-000000000010'
     AND product_id = 'e6000000-0000-4000-8000-000000000030'),
  1,
  'A supplier can be linked to a product with MOQ, pack multiple and lead-time terms'
);

SELECT extensions.throws_ok(
  $$ INSERT INTO public.supplier_products (
       business_id, supplier_id, product_id, supplier_sku, unit_cost, currency
     ) VALUES (
       'e6000000-0000-4000-8000-000000000010',
       (SELECT id FROM public.suppliers WHERE supplier_code = 'SUP-001'),
       'e6000000-0000-4000-8000-000000000040', 'CROSS-ITEM', 4, 'GHS'
     ) $$,
  '23503',
  NULL,
  'Composite foreign keys prevent linking a supplier to another business product'
);

SELECT extensions.throws_ok(
  $$ INSERT INTO public.suppliers (business_id, supplier_code, name, currency)
     VALUES ('e6000000-0000-4000-8000-000000000010', 'sup-001', 'Duplicate Supplier Code', 'GHS') $$,
  '23505',
  NULL,
  'Supplier codes are case-insensitively unique within a business'
);

SELECT set_config(
  'request.jwt.claims',
  jsonb_build_object('sub', 'e6000000-0000-4000-8000-000000000002', 'role', 'authenticated',
    'app_metadata', jsonb_build_object('active_business_id', 'e6000000-0000-4000-8000-000000000010'))::text,
  true
);
SELECT set_config('request.jwt.claim.sub', 'e6000000-0000-4000-8000-000000000002', true);

SELECT extensions.is(
  (SELECT count(*)::integer FROM public.suppliers WHERE business_id = 'e6000000-0000-4000-8000-000000000010'),
  1,
  'A cashier can read the supplier directory for their active business'
);
SELECT extensions.throws_ok(
  $$ INSERT INTO public.suppliers (business_id, supplier_code, name)
     VALUES ('e6000000-0000-4000-8000-000000000010', 'CASH-001', 'Cashier Must Not Create') $$,
  '42501',
  NULL,
  'Cashiers cannot create or edit supplier master data'
);

SELECT set_config(
  'request.jwt.claims',
  jsonb_build_object('sub', 'e6000000-0000-4000-8000-000000000003', 'role', 'authenticated',
    'app_metadata', jsonb_build_object('active_business_id', 'e6000000-0000-4000-8000-000000000020'))::text,
  true
);
SELECT set_config('request.jwt.claim.sub', 'e6000000-0000-4000-8000-000000000003', true);
SELECT extensions.is(
  (SELECT count(*)::integer FROM public.suppliers WHERE business_id = 'e6000000-0000-4000-8000-000000000010'),
  0,
  'A separate business owner cannot read the first business supplier records'
);

SELECT extensions.throws_ok(
  $$ INSERT INTO public.suppliers (business_id, supplier_code, name, currency)
     VALUES ('e6000000-0000-4000-8000-000000000020', 'BAD-CURRENCY', 'Invalid Currency', 'US') $$,
  '23514',
  NULL,
  'Supplier currencies must be valid three-letter ISO-style codes'
);

RESET ROLE;
SELECT * FROM extensions.finish();
ROLLBACK;
