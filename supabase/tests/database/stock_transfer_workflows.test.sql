CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
BEGIN;
SELECT extensions.plan(17);

INSERT INTO auth.users (
  id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data
) VALUES (
  'e3000000-0000-4000-8000-000000000001',
  'authenticated', 'authenticated',
  'store-transfer-owner@example.invalid', '', now(), '{}'::jsonb, '{}'::jsonb
);

INSERT INTO public.businesses (
  id, name, business_type, country, base_currency, timezone, status
) VALUES (
  'e3000000-0000-4000-8000-000000000010',
  'Store Transfer Test Business', 'small_business', 'Ghana', 'GHS', 'Africa/Accra', 'active'
);

INSERT INTO public.business_members (business_id, user_id, role, status, joined_at)
VALUES (
  'e3000000-0000-4000-8000-000000000010',
  'e3000000-0000-4000-8000-000000000001',
  'owner', 'active', now()
);

SELECT set_config(
  'request.jwt.claims',
  jsonb_build_object(
    'sub', 'e3000000-0000-4000-8000-000000000001',
    'role', 'authenticated',
    'app_metadata', jsonb_build_object(
      'active_business_id', 'e3000000-0000-4000-8000-000000000010'
    )
  )::text,
  true
);
SELECT set_config('request.jwt.claim.sub', 'e3000000-0000-4000-8000-000000000001', true);

INSERT INTO public.store_locations (
  id, business_id, code, name, location_type, is_default
) VALUES (
  'e3000000-0000-4000-8000-000000000011',
  'e3000000-0000-4000-8000-000000000010',
  'BRANCH-1', 'Branch One', 'store', false
);

INSERT INTO public.products (
  id, business_id, sku, name, current_price, stock_quantity,
  min_stock_level, is_service, is_active
) VALUES (
  'e3000000-0000-4000-8000-000000000020',
  'e3000000-0000-4000-8000-000000000010',
  'TRANSFER-TEST-001', 'Transfer Test Item', 10.00, 10,
  2, false, true
);

SELECT extensions.is(
  (SELECT count(*)::integer FROM public.store_locations
   WHERE business_id = 'e3000000-0000-4000-8000-000000000010'
     AND code IN ('MAIN', 'IN-TRANSIT')),
  2,
  'Every business has a main location and a dedicated in-transit location'
);

SELECT extensions.is(
  (SELECT location_type FROM public.store_locations
   WHERE business_id = 'e3000000-0000-4000-8000-000000000010'
     AND code = 'IN-TRANSIT'),
  'virtual',
  'The in-transit location is virtual and cannot be selected as a physical source or destination'
);

CREATE TEMP TABLE store_transfer_test_state (
  transfer_id uuid,
  receipt_one_id uuid,
  transfer_line_id uuid,
  source_location_id uuid,
  destination_location_id uuid,
  transit_location_id uuid,
  product_id uuid
) ON COMMIT DROP;

INSERT INTO store_transfer_test_state (
  source_location_id, destination_location_id, transit_location_id, product_id
)
SELECT
  source.id,
  destination.id,
  transit.id,
  'e3000000-0000-4000-8000-000000000020'::uuid
FROM public.store_locations source
JOIN public.store_locations destination
  ON destination.business_id = source.business_id
 AND destination.id = 'e3000000-0000-4000-8000-000000000011'
JOIN public.store_locations transit
  ON transit.business_id = source.business_id
 AND transit.code = 'IN-TRANSIT'
WHERE source.business_id = 'e3000000-0000-4000-8000-000000000010'
  AND source.is_default;

UPDATE store_transfer_test_state state
SET transfer_id = public.create_stock_transfer(
  state.source_location_id,
  state.destination_location_id,
  'TR-TEST-001',
  'Transfer test with two-stage custody',
  jsonb_build_array(jsonb_build_object(
    'product_id', state.product_id,
    'quantity', 4
  )),
  'e3000000-0000-4000-8000-000000000101'::uuid
);

SELECT extensions.is(
  (SELECT public.create_stock_transfer(
    source_location_id,
    destination_location_id,
    'TR-TEST-001',
    'Transfer test with two-stage custody',
    jsonb_build_array(jsonb_build_object('product_id', product_id, 'quantity', 4)),
    'e3000000-0000-4000-8000-000000000101'::uuid
  ) FROM store_transfer_test_state LIMIT 1),
  (SELECT transfer_id FROM store_transfer_test_state LIMIT 1),
  'Creating a transfer twice with the same payload and idempotency key returns the original transfer'
);

SELECT extensions.is(
  (SELECT status FROM public.stock_transfers
   WHERE id = (SELECT transfer_id FROM store_transfer_test_state LIMIT 1)),
  'draft',
  'A new transfer begins in draft status'
);

SELECT public.approve_stock_transfer(
  (SELECT transfer_id FROM store_transfer_test_state LIMIT 1)
);

SELECT public.dispatch_stock_transfer(
  (SELECT transfer_id FROM store_transfer_test_state LIMIT 1),
  'e3000000-0000-4000-8000-000000000102'::uuid
);

SELECT extensions.is(
  (SELECT public.dispatch_stock_transfer(
    transfer_id,
    'e3000000-0000-4000-8000-000000000102'::uuid
  ) FROM store_transfer_test_state LIMIT 1),
  (SELECT transfer_id FROM store_transfer_test_state LIMIT 1),
  'Repeating dispatch with the same idempotency key does not dispatch stock twice'
);

SELECT extensions.is(
  (SELECT sb.on_hand FROM public.stock_balances sb
   WHERE sb.business_id = 'e3000000-0000-4000-8000-000000000010'
     AND sb.location_id = (SELECT source_location_id FROM store_transfer_test_state)
     AND sb.product_id = (SELECT product_id FROM store_transfer_test_state)),
  6::numeric,
  'Dispatch decreases the source location stock'
);

SELECT extensions.is(
  (SELECT sb.on_hand FROM public.stock_balances sb
   WHERE sb.business_id = 'e3000000-0000-4000-8000-000000000010'
     AND sb.location_id = (SELECT transit_location_id FROM store_transfer_test_state)
     AND sb.product_id = (SELECT product_id FROM store_transfer_test_state)),
  4::numeric,
  'Dispatch moves the dispatched quantity into the virtual transit location'
);

UPDATE store_transfer_test_state
SET transfer_line_id = (
  SELECT id FROM public.stock_transfer_lines
  WHERE transfer_id = store_transfer_test_state.transfer_id
);

UPDATE store_transfer_test_state state
SET receipt_one_id = public.receive_stock_transfer(
  state.transfer_id,
  'TR-RECEIPT-001',
  jsonb_build_array(jsonb_build_object('transfer_line_id', state.transfer_line_id, 'quantity', 2)),
  'e3000000-0000-4000-8000-000000000103'::uuid,
  'First partial receipt'
);

SELECT extensions.is(
  (SELECT public.receive_stock_transfer(
    transfer_id,
    'TR-RECEIPT-001',
    jsonb_build_array(jsonb_build_object('transfer_line_id', transfer_line_id, 'quantity', 2)),
    'e3000000-0000-4000-8000-000000000103'::uuid,
    'First partial receipt'
  ) FROM store_transfer_test_state LIMIT 1),
  (SELECT receipt_one_id FROM store_transfer_test_state LIMIT 1),
  'Repeating a receipt with the same idempotency key does not receive stock twice'
);

SELECT extensions.is(
  (SELECT sb.on_hand FROM public.stock_balances sb
   WHERE sb.business_id = 'e3000000-0000-4000-8000-000000000010'
     AND sb.location_id = (SELECT transit_location_id FROM store_transfer_test_state)
     AND sb.product_id = (SELECT product_id FROM store_transfer_test_state)),
  2::numeric,
  'Partial receipt leaves the unreceived quantity in transit'
);

SELECT extensions.is(
  (SELECT sb.on_hand FROM public.stock_balances sb
   WHERE sb.business_id = 'e3000000-0000-4000-8000-000000000010'
     AND sb.location_id = (SELECT destination_location_id FROM store_transfer_test_state)
     AND sb.product_id = (SELECT product_id FROM store_transfer_test_state)),
  2::numeric,
  'Partial receipt adds only the physically received quantity to destination stock'
);

SELECT extensions.is(
  (SELECT status FROM public.stock_transfers
   WHERE id = (SELECT transfer_id FROM store_transfer_test_state LIMIT 1)),
  'partially_received',
  'A transfer remains partially received while stock is still in transit'
);

SELECT public.receive_stock_transfer(
  (SELECT transfer_id FROM store_transfer_test_state LIMIT 1),
  'TR-RECEIPT-002',
  jsonb_build_array(jsonb_build_object(
    'transfer_line_id', (SELECT transfer_line_id FROM store_transfer_test_state LIMIT 1),
    'quantity', 2
  )),
  'e3000000-0000-4000-8000-000000000104'::uuid,
  'Final receipt'
);

SELECT extensions.is(
  (SELECT sb.on_hand FROM public.stock_balances sb
   WHERE sb.business_id = 'e3000000-0000-4000-8000-000000000010'
     AND sb.location_id = (SELECT transit_location_id FROM store_transfer_test_state)
     AND sb.product_id = (SELECT product_id FROM store_transfer_test_state)),
  0::numeric,
  'Final receipt clears the outstanding transit balance'
);

SELECT extensions.is(
  (SELECT sb.on_hand FROM public.stock_balances sb
   WHERE sb.business_id = 'e3000000-0000-4000-8000-000000000010'
     AND sb.location_id = (SELECT destination_location_id FROM store_transfer_test_state)
     AND sb.product_id = (SELECT product_id FROM store_transfer_test_state)),
  4::numeric,
  'Final receipt completes the destination stock movement'
);

SELECT extensions.is(
  (SELECT status FROM public.stock_transfers
   WHERE id = (SELECT transfer_id FROM store_transfer_test_state LIMIT 1)),
  'received',
  'A transfer is marked received only after all dispatched quantity is accounted for'
);

SELECT extensions.is(
  (SELECT stock_quantity FROM public.products
   WHERE id = (SELECT product_id FROM store_transfer_test_state)),
  10,
  'Inter-location transfers do not change the business-wide product stock total'
);

UPDATE store_transfer_test_state state
SET transfer_id = public.create_stock_transfer(
  state.source_location_id,
  state.destination_location_id,
  'TR-TEST-002',
  'Insufficient stock test',
  jsonb_build_array(jsonb_build_object('product_id', state.product_id, 'quantity', 7)),
  'e3000000-0000-4000-8000-000000000105'::uuid
);

SELECT public.approve_stock_transfer(
  (SELECT transfer_id FROM store_transfer_test_state LIMIT 1)
);

SELECT extensions.throws_ok(
  format(
    'SELECT public.dispatch_stock_transfer(%L::uuid, %L::uuid)',
    (SELECT transfer_id FROM store_transfer_test_state ORDER BY transfer_id DESC LIMIT 1),
    'e3000000-0000-4000-8000-000000000106'
  ),
  'P0001',
  format(
    'Insufficient available stock for transfer line %s',
    (SELECT id FROM public.stock_transfer_lines
     WHERE transfer_id = (SELECT transfer_id FROM store_transfer_test_state LIMIT 1))
  ),
  'Dispatch rejects a transfer that exceeds source available stock'
);

SELECT extensions.is(
  (SELECT sb.on_hand FROM public.stock_balances sb
   WHERE sb.business_id = 'e3000000-0000-4000-8000-000000000010'
     AND sb.location_id = (SELECT source_location_id FROM store_transfer_test_state)
     AND sb.product_id = (SELECT product_id FROM store_transfer_test_state)),
  6::numeric,
  'A failed over-capacity dispatch leaves source stock unchanged'
);

SELECT * FROM extensions.finish();
ROLLBACK;
