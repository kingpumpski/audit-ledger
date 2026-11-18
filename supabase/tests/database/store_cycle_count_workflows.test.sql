CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
BEGIN;
SELECT extensions.plan(26);

INSERT INTO auth.users (
  id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data
) VALUES (
  'e4000000-0000-4000-8000-000000000001',
  'authenticated', 'authenticated',
  'cycle-count-owner@example.invalid', '', now(), '{}'::jsonb, '{}'::jsonb
), (
  'e4000000-0000-4000-8000-000000000002',
  'authenticated', 'authenticated',
  'cycle-count-cashier@example.invalid', '', now(), '{}'::jsonb, '{}'::jsonb
);

INSERT INTO public.businesses (
  id, name, business_type, country, base_currency, timezone, status
) VALUES (
  'e4000000-0000-4000-8000-000000000010',
  'Store Cycle Count Test Business', 'small_business', 'Ghana', 'GHS', 'Africa/Accra', 'active'
);

INSERT INTO public.business_members (business_id, user_id, role, status, joined_at)
VALUES
  ('e4000000-0000-4000-8000-000000000010',
   'e4000000-0000-4000-8000-000000000001', 'owner', 'active', now()),
  ('e4000000-0000-4000-8000-000000000010',
   'e4000000-0000-4000-8000-000000000002', 'cashier', 'active', now());

INSERT INTO public.chart_of_accounts (
  business_id, code, name, account_type, currency, is_system, is_active
) VALUES
  ('e4000000-0000-4000-8000-000000000010', '1200', 'Inventory', 'asset', 'GHS', true, true),
  ('e4000000-0000-4000-8000-000000000010', '4900', 'Inventory Count Variance Gain', 'revenue', 'GHS', true, true),
  ('e4000000-0000-4000-8000-000000000010', '6500', 'Inventory Shrinkage', 'expense', 'GHS', true, true)
ON CONFLICT (business_id, code) DO UPDATE
SET is_active = true;

SELECT set_config(
  'request.jwt.claims',
  jsonb_build_object(
    'sub', 'e4000000-0000-4000-8000-000000000001',
    'role', 'authenticated',
    'app_metadata', jsonb_build_object(
      'active_business_id', 'e4000000-0000-4000-8000-000000000010'
    )
  )::text,
  true
);
SELECT set_config('request.jwt.claim.sub', 'e4000000-0000-4000-8000-000000000001', true);

INSERT INTO public.products (
  id, business_id, sku, name, current_price, stock_quantity,
  min_stock_level, is_service, is_active
) VALUES (
  'e4000000-0000-4000-8000-000000000020',
  'e4000000-0000-4000-8000-000000000010',
  'COUNT-TEST-001', 'Cycle Count Test Item', 10.00, 0,
  2, false, true
);

-- Seed starting stock through an evidenced inventory movement.
SELECT set_config('app.stock_purchase_rpc', 'on', true);
UPDATE public.products
SET stock_quantity = 10, cost_price = 5.00, cost_price_verified = true
WHERE id = 'e4000000-0000-4000-8000-000000000020';
SELECT set_config('app.stock_purchase_rpc', 'off', true);

INSERT INTO public.inventory_transactions (
  product_id, type, quantity, previous_quantity, new_quantity,
  unit_cost, total_cost, reference_type, reference_number,
  performed_by, idempotency_key
) VALUES (
  'e4000000-0000-4000-8000-000000000020',
  'purchase', 10, 0, 10, 5.00, 50.00,
  'store_cycle_count_test', 'COUNT-OPENING-001',
  'e4000000-0000-4000-8000-000000000001',
  'e4000000-0000-4000-8000-000000000101'
);

CREATE TEMP TABLE store_cycle_count_test_state (
  count_id uuid,
  count_line_id uuid,
  second_count_id uuid,
  location_id uuid,
  product_id uuid
) ON COMMIT DROP;

INSERT INTO store_cycle_count_test_state (location_id, product_id)
SELECT sl.id, 'e4000000-0000-4000-8000-000000000020'::uuid
FROM public.store_locations sl
WHERE sl.business_id = 'e4000000-0000-4000-8000-000000000010'
  AND sl.is_default;

UPDATE store_cycle_count_test_state state
SET count_id = public.create_store_stock_count(
  state.location_id,
  'COUNT-TEST-001',
  'Blind cycle count test',
  'e4000000-0000-4000-8000-000000000102'::uuid
);

SELECT extensions.is(
  (SELECT public.create_store_stock_count(
    location_id,
    'COUNT-TEST-001',
    'Blind cycle count test',
    'e4000000-0000-4000-8000-000000000102'::uuid
  ) FROM store_cycle_count_test_state LIMIT 1),
  (SELECT count_id FROM store_cycle_count_test_state LIMIT 1),
  'Creating a count twice with the same idempotency key returns the original session'
);

SELECT extensions.is(
  (SELECT status FROM public.store_stock_counts
   WHERE id = (SELECT count_id FROM store_cycle_count_test_state LIMIT 1)),
  'counting',
  'A new stock-count session begins in counting status'
);

SELECT extensions.is(
  (SELECT system_quantity_snapshot FROM public.store_stock_count_lines
   WHERE count_id = (SELECT count_id FROM store_cycle_count_test_state LIMIT 1)
     AND product_id = (SELECT product_id FROM store_cycle_count_test_state LIMIT 1)),
  10,
  'The session snapshots the location balance when the count begins'
);

SELECT extensions.throws_ok(
  format(
    'SELECT public.create_store_stock_count(%L::uuid, %L, %L, %L::uuid)',
    (SELECT location_id FROM store_cycle_count_test_state LIMIT 1),
    'COUNT-TEST-002',
    'Duplicate active count',
    'e4000000-0000-4000-8000-000000000103'
  ),
  'P0001',
  'A stock count is already active for this location',
  'Only one active count session can freeze a location at a time'
);

SELECT extensions.throws_ok(
  $sql$
    INSERT INTO public.inventory_transactions (
      product_id, type, quantity, previous_quantity, new_quantity,
      unit_cost, total_cost, reference_type, reference_number,
      location_id, performed_by, idempotency_key
    ) VALUES (
      'e4000000-0000-4000-8000-000000000020',
      'sale', 1, 10, 9, 5.00, 5.00,
      'cycle_count_lock_test', 'COUNT-LOCK-SALE',
      (SELECT location_id FROM store_cycle_count_test_state LIMIT 1),
      'e4000000-0000-4000-8000-000000000001',
      'e4000000-0000-4000-8000-000000000104'
    )
  $sql$,
  'P0001',
  'Inventory movement is paused for a location while a stock count is active',
  'Inventory movements are frozen while a blind count is open'
);

SELECT set_config(
  'request.jwt.claims',
  jsonb_build_object(
    'sub', 'e4000000-0000-4000-8000-000000000002',
    'role', 'authenticated',
    'app_metadata', jsonb_build_object(
      'active_business_id', 'e4000000-0000-4000-8000-000000000010'
    )
  )::text,
  true
);
SELECT set_config('request.jwt.claim.sub', 'e4000000-0000-4000-8000-000000000002', true);

UPDATE store_cycle_count_test_state state
SET count_line_id = public.record_store_stock_count_line(
  state.count_id,
  state.product_id,
  8,
  'Two units missing during physical count'
);

SELECT extensions.ok(
  (SELECT count_line_id IS NOT NULL FROM store_cycle_count_test_state LIMIT 1),
  'The blind-count entry is recorded against the snapshotted product'
);

SELECT extensions.is(
  (SELECT counted_by FROM public.store_stock_count_lines
   WHERE id = (SELECT count_line_id FROM store_cycle_count_test_state LIMIT 1)),
  'e4000000-0000-4000-8000-000000000002'::uuid,
  'The system records the user who physically counted each line'
);

SELECT extensions.is(
  (SELECT public.submit_store_stock_count(count_id)
   FROM store_cycle_count_test_state LIMIT 1),
  (SELECT count_id FROM store_cycle_count_test_state LIMIT 1),
  'A complete blind count can be submitted for independent approval'
);

SELECT extensions.throws_ok(
  format(
    'SELECT public.approve_store_stock_count(%L::uuid)',
    (SELECT count_id FROM store_cycle_count_test_state LIMIT 1)
  ),
  '42501',
  'Only a business owner, administrator or accountant can approve stock counts',
  'A cashier cannot approve their own stock count'
);

SELECT set_config(
  'request.jwt.claims',
  jsonb_build_object(
    'sub', 'e4000000-0000-4000-8000-000000000001',
    'role', 'authenticated',
    'app_metadata', jsonb_build_object(
      'active_business_id', 'e4000000-0000-4000-8000-000000000010'
    )
  )::text,
  true
);
SELECT set_config('request.jwt.claim.sub', 'e4000000-0000-4000-8000-000000000001', true);

SELECT extensions.is(
  public.approve_store_stock_count(
    (SELECT count_id FROM store_cycle_count_test_state LIMIT 1)
  ),
  (SELECT count_id FROM store_cycle_count_test_state LIMIT 1),
  'An authorized owner can approve the submitted count'
);

SELECT extensions.is(
  public.post_store_stock_count(
    (SELECT count_id FROM store_cycle_count_test_state LIMIT 1),
    'e4000000-0000-4000-8000-000000000105'::uuid
  ),
  (SELECT count_id FROM store_cycle_count_test_state LIMIT 1),
  'Posting creates the approved location-specific stock correction'
);

SELECT extensions.is(
  public.post_store_stock_count(
    (SELECT count_id FROM store_cycle_count_test_state LIMIT 1),
    'e4000000-0000-4000-8000-000000000105'::uuid
  ),
  (SELECT count_id FROM store_cycle_count_test_state LIMIT 1),
  'Repeating count posting with the same idempotency key does not duplicate the adjustment'
);

SELECT extensions.is(
  (SELECT status FROM public.store_stock_counts
   WHERE id = (SELECT count_id FROM store_cycle_count_test_state LIMIT 1)),
  'posted',
  'The count is marked posted after its movements and journal are committed'
);

SELECT extensions.is(
  (SELECT stock_quantity FROM public.products
   WHERE id = (SELECT product_id FROM store_cycle_count_test_state LIMIT 1)),
  8,
  'The business-wide product quantity is reduced by the count variance'
);

SELECT extensions.is(
  (SELECT on_hand FROM public.stock_balances
   WHERE business_id = 'e4000000-0000-4000-8000-000000000010'
     AND location_id = (SELECT location_id FROM store_cycle_count_test_state LIMIT 1)
     AND product_id = (SELECT product_id FROM store_cycle_count_test_state LIMIT 1)),
  8::numeric,
  'The selected location balance is reconciled to the physical count'
);

SELECT extensions.is(
  (SELECT variance_quantity FROM public.store_stock_count_lines
   WHERE id = (SELECT count_line_id FROM store_cycle_count_test_state LIMIT 1)),
  -2,
  'The immutable count detail records the negative variance'
);

SELECT extensions.is(
  (SELECT adjustment_value FROM public.store_stock_count_lines
   WHERE id = (SELECT count_line_id FROM store_cycle_count_test_state LIMIT 1)),
  10::numeric,
  'The count variance is valued using the verified unit cost snapshot'
);

SELECT extensions.is(
  (SELECT count(*)::integer FROM public.journal_entries
   WHERE source_type = 'inventory_count_adjustment'
     AND source_id = (SELECT count_id FROM store_cycle_count_test_state LIMIT 1)),
  1,
  'A count variance creates one linked accounting journal'
);

SELECT extensions.is(
  (SELECT ROUND(SUM(debit), 2) FROM public.journal_lines
   WHERE journal_entry_id = (
     SELECT journal_entry_id FROM public.store_stock_counts
     WHERE id = (SELECT count_id FROM store_cycle_count_test_state LIMIT 1)
   )),
  10::numeric,
  'The shrinkage journal debits inventory shrinkage expense'
);

SELECT extensions.is(
  (SELECT ROUND(SUM(credit), 2) FROM public.journal_lines
   WHERE journal_entry_id = (
     SELECT journal_entry_id FROM public.store_stock_counts
     WHERE id = (SELECT count_id FROM store_cycle_count_test_state LIMIT 1)
   )),
  10::numeric,
  'The shrinkage journal credits the inventory asset by the same amount'
);

SELECT extensions.is(
  (SELECT count(*)::integer
   FROM public.journal_lines jl
   JOIN public.chart_of_accounts coa ON coa.id = jl.account_id
   WHERE jl.journal_entry_id = (
     SELECT journal_entry_id FROM public.store_stock_counts
     WHERE id = (SELECT count_id FROM store_cycle_count_test_state LIMIT 1)
   )
   AND coa.code = '6500' AND jl.debit = 10),
  1,
  'The shortage posts to the inventory shrinkage expense account'
);

SELECT extensions.is(
  (SELECT count(*)::integer
   FROM public.inventory_transactions
   WHERE reference_type = 'store_stock_count'
     AND reference_id = (SELECT count_id FROM store_cycle_count_test_state LIMIT 1)
     AND type = 'adjustment'
     AND location_id = (SELECT location_id FROM store_cycle_count_test_state LIMIT 1)
     AND previous_quantity = 10 AND new_quantity = 8),
  1,
  'The count adjustment creates an immutable location-scoped inventory movement'
);

-- The privileged posting GUC is reset before the RPC returns; ordinary
-- inventory movements are allowed again after the count is posted.
SELECT set_config('app.stock_purchase_rpc', 'on', true);
UPDATE public.products SET stock_quantity = 9
WHERE id = (SELECT product_id FROM store_cycle_count_test_state LIMIT 1);
SELECT set_config('app.stock_purchase_rpc', 'off', true);
INSERT INTO public.inventory_transactions (
  product_id, type, quantity, previous_quantity, new_quantity,
  unit_cost, total_cost, reference_type, reference_number,
  location_id, performed_by, idempotency_key
) VALUES (
  'e4000000-0000-4000-8000-000000000020',
  'purchase', 1, 8, 9, 5.00, 5.00,
  'cycle_count_after_post', 'COUNT-AFTER-POST',
  (SELECT location_id FROM store_cycle_count_test_state LIMIT 1),
  'e4000000-0000-4000-8000-000000000001',
  'e4000000-0000-4000-8000-000000000106'
);

SELECT extensions.is(
  (SELECT on_hand FROM public.stock_balances
   WHERE business_id = 'e4000000-0000-4000-8000-000000000010'
     AND location_id = (SELECT location_id FROM store_cycle_count_test_state LIMIT 1)
     AND product_id = (SELECT product_id FROM store_cycle_count_test_state LIMIT 1)),
  9::numeric,
  'Stock movements resume after the count is posted'
);

UPDATE store_cycle_count_test_state state
SET second_count_id = public.create_store_stock_count(
  state.location_id,
  'COUNT-TEST-002',
  'Cancellation unlock test',
  'e4000000-0000-4000-8000-000000000107'::uuid
);

SELECT extensions.is(
  public.cancel_store_stock_count(
    (SELECT second_count_id FROM store_cycle_count_test_state LIMIT 1),
    'Count abandoned for rescheduling'
  ),
  (SELECT second_count_id FROM store_cycle_count_test_state LIMIT 1),
  'An authorized manager can cancel an unposted count with a reason'
);

SELECT extensions.is(
  (SELECT status FROM public.store_stock_counts
   WHERE id = (SELECT second_count_id FROM store_cycle_count_test_state LIMIT 1)),
  'canceled',
  'Canceled counts release the location movement freeze'
);

SELECT set_config('app.stock_purchase_rpc', 'on', true);
UPDATE public.products SET stock_quantity = 10
WHERE id = (SELECT product_id FROM store_cycle_count_test_state LIMIT 1);
SELECT set_config('app.stock_purchase_rpc', 'off', true);
INSERT INTO public.inventory_transactions (
  product_id, type, quantity, previous_quantity, new_quantity,
  unit_cost, total_cost, reference_type, reference_number,
  location_id, performed_by, idempotency_key
) VALUES (
  'e4000000-0000-4000-8000-000000000020',
  'purchase', 1, 9, 10, 5.00, 5.00,
  'cycle_count_after_cancel', 'COUNT-AFTER-CANCEL',
  (SELECT location_id FROM store_cycle_count_test_state LIMIT 1),
  'e4000000-0000-4000-8000-000000000001',
  'e4000000-0000-4000-8000-000000000108'
);

SELECT extensions.is(
  (SELECT on_hand FROM public.stock_balances
   WHERE business_id = 'e4000000-0000-4000-8000-000000000010'
     AND location_id = (SELECT location_id FROM store_cycle_count_test_state LIMIT 1)
     AND product_id = (SELECT product_id FROM store_cycle_count_test_state LIMIT 1)),
  10::numeric,
  'Stock movements resume after a count is canceled'
);

SELECT * FROM extensions.finish();
ROLLBACK;
