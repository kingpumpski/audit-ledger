# Production location-stock migration data preflight — 2026-11-19

## Scope

Read-only aggregate query against production Supabase project `phfpbqlhxagonpofzvtn`. No stock values, rows, migrations or schema were changed.

## Current legacy stock summary

| Measure | Production result |
|---|---:|
| Physical (non-service) products | 1 |
| Physical products with negative stock | 0 |
| Physical products with positive stock | 1 |
| Total legacy physical stock quantity | 2 |
| Positive-stock products without verified cost | 0 |
| Positive-stock products without a positive cost value | 0 |

The location-stock migration's negative-stock preflight currently passes. The single stocked physical product also has a verified positive cost, which is useful for transfer valuation readiness.

## Limits

This is only an aggregate snapshot and not a complete data migration approval. Before applying `20261118210000_store_location_stock_balances.sql`:

1. Re-run the aggregate query immediately before rollout.
2. Reconcile the actual product and stock transaction rows, opening stock and latest movement.
3. Confirm every stock quantity is assigned to the correct business and default MAIN location.
4. Confirm there are no concurrent stock changes during the snapshot/backfill.
5. Verify the post-migration stock_balances totals equal the authoritative legacy product stock totals.
6. Run inventory movement, cost valuation and transfer integration tests against staging data.
7. Complete the full independent backup and isolated restore rehearsal.
8. Apply only after the tenant/RPC ownership cutover and explicit release approval.

## Release decision

**Data preflight currently looks low-volume and passes the migration's negative-stock check, but production migration remains BLOCKED.**

No production DDL/DML, stock adjustment, migration-history change or schema-cache reload was performed.
