CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;

BEGIN;

SELECT extensions.plan(10);

-- Isolated fixture users. The JWT subject setting exercises the same auth.uid()
-- and user_roles checks used by authenticated RPC calls.
INSERT INTO auth.users (
  id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data
)
VALUES
  ('d0000000-0000-4000-8000-000000000001', 'authenticated', 'authenticated',
   'inventory-accountant-test@example.invalid', '', now(), '{}'::jsonb, '{}'::jsonb),
  ('d0000000-0000-4000-8000-000000000002', 'authenticated', 'authenticated',
   'inventory-cashier-test@example.invalid', '', now(), '{}'::jsonb, '{}'::jsonb);

INSERT INTO public.user_roles (user_id, role)
VALUES
  ('d0000000-0000-4000-8000-000000000001', 'accountant'),
  ('d0000000-0000-4000-8000-000000000002', 'cashier');

INSERT INTO public.products (
  sku, name, current_price, cost_price, cost_price_verified,
  stock_quantity, is_service, is_active
)
VALUES
  ('TEST-DAMAGE-001', 'Damage workflow test product', 20, 8.25, true, 10, false, true),
  ('TEST-DAMAGE-002', 'Unverified damage test product', 20, 8.25, false, 10, false, true);

SELECT set_config('request.jwt.claim.sub', 'd0000000-0000-4000-8000-000000000001', true);

SELECT extensions.lives_ok(
  $$ SELECT public.record_inventory_damage(
    (SELECT id FROM public.products WHERE sku = 'TEST-DAMAGE-001'),
    3,
    'DAMAGE-TEST-001',
    'd0000000-0000-4000-8000-000000000101',
    'pgTAP inventory damage test'
  ) $$,
  'Accountant can record evidenced damage'
);

SELECT extensions.is(
  (SELECT stock_quantity FROM public.products WHERE sku = 'TEST-DAMAGE-001'),
  7,
  'Damage reduces physical stock by the recorded quantity'
);

SELECT extensions.is(
  (SELECT count(*)::integer FROM public.inventory_transactions
   WHERE reference_number = 'DAMAGE-TEST-001' AND type = 'damage'),
  1,
  'Damage creates one immutable inventory transaction'
);

SELECT extensions.is(
  (SELECT count(*)::integer FROM public.journal_entries
   WHERE source_type = 'inventory_damage'
     AND source_id = (SELECT id FROM public.inventory_transactions WHERE reference_number = 'DAMAGE-TEST-001')),
  1,
  'Damage creates one linked journal entry'
);

SELECT extensions.is(
  (SELECT round(sum(jl.debit - jl.credit), 2)
   FROM public.journal_lines jl
   JOIN public.journal_entries je ON je.id = jl.journal_entry_id
   WHERE je.source_type = 'inventory_damage'
     AND je.source_id = (SELECT id FROM public.inventory_transactions WHERE reference_number = 'DAMAGE-TEST-001')),
  0::numeric,
  'Damage journal entry is balanced'
);

SELECT extensions.lives_ok(
  $$ SELECT public.record_inventory_damage(
    (SELECT id FROM public.products WHERE sku = 'TEST-DAMAGE-001'),
    3,
    'DAMAGE-TEST-001',
    'd0000000-0000-4000-8000-000000000101',
    'pgTAP retry'
  ) $$,
  'Retry with the same idempotency key is accepted'
);

SELECT extensions.is(
  (SELECT count(*)::integer FROM public.inventory_transactions
   WHERE reference_number = 'DAMAGE-TEST-001' AND type = 'damage'),
  1,
  'Idempotent retry does not create a duplicate transaction'
);

SELECT extensions.is(
  (SELECT stock_quantity FROM public.products WHERE sku = 'TEST-DAMAGE-001'),
  7,
  'Idempotent retry does not decrement stock twice'
);

SELECT set_config('request.jwt.claim.sub', 'd0000000-0000-4000-8000-000000000002', true);

SELECT extensions.throws_ok(
  $$ SELECT public.record_inventory_damage(
    (SELECT id FROM public.products WHERE sku = 'TEST-DAMAGE-001'),
    1,
    'DAMAGE-CASHIER-001',
    'd0000000-0000-4000-8000-000000000102',
    NULL
  ) $$,
  'P0001',
  'Only an admin or accountant can record stock damage',
  'Cashier cannot post stock damage'
);

SELECT set_config('request.jwt.claim.sub', 'd0000000-0000-4000-8000-000000000001', true);

SELECT extensions.throws_ok(
  $$ SELECT public.record_inventory_damage(
    (SELECT id FROM public.products WHERE sku = 'TEST-DAMAGE-002'),
    1,
    'DAMAGE-UNVERIFIED-001',
    'd0000000-0000-4000-8000-000000000103',
    NULL
  ) $$,
  'P0001',
  'Verify the actual purchase cost before recording inventory damage',
  'Unverified purchase cost cannot be written off'
);

SELECT * FROM extensions.finish();

ROLLBACK;
