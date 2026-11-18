CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
BEGIN;
SELECT extensions.plan(6);

-- Product fixtures use the legacy/default business scope used by the existing
-- inventory integration tests. The product insert trigger creates its default
-- location projection; the stock movement trigger then maintains it.
INSERT INTO public.products (
  sku, name, current_price, stock_quantity, min_stock_level, is_service, is_active
) VALUES (
  'TEST-STORE-LOCATION-001', 'Store location projection test item',
  25.00, 10, 3, false, true
);

SELECT extensions.is(
  (SELECT count(*)::integer
   FROM public.store_locations
   WHERE business_id = public.legacy_business_id()
     AND is_default AND is_active),
  1,
  'Every existing business has one active default store location'
);

SELECT extensions.is(
  (SELECT sb.on_hand
   FROM public.stock_balances sb
   JOIN public.products p ON p.id = sb.product_id
   WHERE p.sku = 'TEST-STORE-LOCATION-001'),
  10::numeric,
  'New physical products initialize their location balance from the protected opening quantity'
);

-- Simulate the already-existing stock purchase RPC movement contract.
INSERT INTO public.inventory_transactions (
  product_id, type, quantity, previous_quantity, new_quantity,
  unit_cost, total_cost, reference_type, reference_number
)
SELECT id, 'purchase', 4, 10, 14, 5.00, 20.00,
       'store_location_test', 'STORE-LOCATION-PURCHASE-001'
FROM public.products
WHERE sku = 'TEST-STORE-LOCATION-001';

SELECT extensions.is(
  (SELECT sb.on_hand
   FROM public.stock_balances sb
   JOIN public.products p ON p.id = sb.product_id
   WHERE p.sku = 'TEST-STORE-LOCATION-001'),
  14::numeric,
  'Purchase movements increase the default location projection exactly once'
);

-- Simulate invoice stock relief using the existing previous/new quantity fields.
INSERT INTO public.inventory_transactions (
  product_id, type, quantity, previous_quantity, new_quantity,
  unit_cost, total_cost, reference_type, reference_number
)
SELECT id, 'sale', 3, 14, 11, 5.00, 15.00,
       'store_location_test', 'STORE-LOCATION-SALE-001'
FROM public.products
WHERE sku = 'TEST-STORE-LOCATION-001';

SELECT extensions.is(
  (SELECT sb.on_hand
   FROM public.stock_balances sb
   JOIN public.products p ON p.id = sb.product_id
   WHERE p.sku = 'TEST-STORE-LOCATION-001'),
  11::numeric,
  'Sale movements reduce the default location projection'
);

INSERT INTO public.store_locations (
  business_id, code, name, location_type, is_default
)
SELECT business_id, 'TEST-SECONDARY', 'Secondary store test location', 'store', false
FROM public.products
WHERE sku = 'TEST-STORE-LOCATION-001';

INSERT INTO public.inventory_transactions (
  product_id, type, quantity, previous_quantity, new_quantity,
  reference_type, reference_number, location_id, destination_location_id
)
SELECT
  p.id, 'transfer', 2, 11, 11,
  'store_location_test', 'STORE-LOCATION-TRANSFER-001',
  source_location.id, destination_location.id
FROM public.products p
JOIN public.store_locations source_location
  ON source_location.business_id = p.business_id AND source_location.is_default
JOIN public.store_locations destination_location
  ON destination_location.business_id = p.business_id AND destination_location.code = 'TEST-SECONDARY'
WHERE p.sku = 'TEST-STORE-LOCATION-001';

SELECT extensions.is(
  (SELECT sb.on_hand
   FROM public.stock_balances sb
   JOIN public.products p ON p.id = sb.product_id
   JOIN public.store_locations sl ON sl.id = sb.location_id
   WHERE p.sku = 'TEST-STORE-LOCATION-001' AND sl.is_default),
  9::numeric,
  'A transfer removes quantity from the source location'
);

SELECT extensions.is(
  (SELECT sb.on_hand
   FROM public.stock_balances sb
   JOIN public.products p ON p.id = sb.product_id
   JOIN public.store_locations sl ON sl.id = sb.location_id
   WHERE p.sku = 'TEST-STORE-LOCATION-001' AND sl.code = 'TEST-SECONDARY'),
  2::numeric,
  'A transfer adds the same quantity to the destination location'
);

SELECT * FROM extensions.finish();
ROLLBACK;
