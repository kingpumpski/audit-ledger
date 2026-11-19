# Tenant/RPC cutover — legacy fallback qualification and release blocker

Date: 2026-11-19
Scope: read-only review of repository migration `20261117155000_enforce_business_tenant_rls_and_rpc_ownership.sql`, prior migration `20261117150000_use_active_business_for_new_records.sql`, and live production definitions/population inspected on the same date.

## Correction to earlier rollout notes

The tenant/RPC cutover migration does **not** completely remove the global-role fallback, despite a comment in the migration suggesting that the coordinated cutover removes it.

The repository migration `20261117155000_enforce_business_tenant_rls_and_rpc_ownership.sql` replaces `public.current_business_id()` with this behavior for authenticated non-service users:

1. A valid signed active-business claim is accepted only when the user is an active member.
2. Without a claim, exactly one active membership resolves to that business.
3. Multiple active memberships fail closed and require an explicit active-business claim.
4. If any membership row exists but none is active, the function returns NULL.
5. **If no membership row exists, the function still returns the legacy business ID when the user has any `public.user_roles` row.**

The earlier migration `20261117150000_use_active_business_for_new_records.sql` also retains a legacy fallback for users with any global role row when no active-business claim is usable.

This is more restrictive than the live production implementation inspected on 2026-11-19, because the new migration blocks fallback for users with suspended/inactive membership records and fails closed for ambiguous multiple memberships. But it is not a full removal of global-role fallback.

## Production population check

Aggregate read-only queries of `auth.users`, `public.user_roles` and `public.business_members` returned:

- 1 Auth user.
- 1 user with a global role.
- 1 user with a business membership.
- 1 total membership, active.
- 1 business with membership; 1 active business.
- 0 global-role users without a membership.
- 0 Auth users with neither a global role nor a membership.

No user IDs, names or email addresses were exported into this report.

This means the fallback is not currently needed by the observed production account population. It does **not** prove that the fallback can safely be removed without checking invitation, signup, account recovery, bootstrap and service-role flows, nor does it guarantee that future accounts will be provisioned correctly.

## Why this matters

The restrictive `tenant_business_scope` RLS policy uses `current_business_id()` and `can_access_business()`. For legacy role-managed users without any `business_members` record, the fallback can continue to select the legacy workspace.

Whether this is an acceptable temporary compatibility mode depends on the real production population and intended cutover policy. It must not be described as strict membership-only isolation.

## Required resolution before production rollout

1. Confirm the production membership count again immediately before rollout.
2. Verify signup, initial-admin bootstrap, business creation, invitations, membership suspension/revocation, active-business claim issuance/refresh and service-role automation all create/use explicit membership correctly.
3. Decide whether the legacy fallback is removed in the same cutover or retained temporarily with an explicit deprecation date and monitoring.
4. If legacy accounts must remain supported, perform an audited, idempotent membership backfill to the correct business before removing the fallback.
5. Update `current_business_id()`, `can_access_business()`, `has_any_role()`, `has_role()`, `has_permission()` and all related RLS policies as one coordinated security change. Do not change only one helper.
6. Add regression tests for:
   - user with one active membership;
   - user with multiple active memberships and valid/invalid/missing signed claim;
   - user with suspended membership;
   - user with no membership and a global role;
   - user with no membership and no global role;
   - service-role automation;
   - cross-business access attempts;
   - owner/admin role behavior within the selected business.
7. Test all cases using representative staging data with at least two businesses.

## Release decision

**BLOCKED for strict tenant-isolation sign-off.**

The fallback is not currently used by the observed production population, which reduces migration backfill risk. It still remains in the proposed migration and must be explicitly removed or accepted as temporary compatibility behavior before strict tenant-isolation sign-off.

No production function, policy, membership row, migration history or schema was changed during this review.
