-- Remove permissive RLS policies that are either exact duplicates or
-- materially broader than the intended owner-scoped policy.
-- No table data is changed.

-- This policy only checks auth.uid() IS NOT NULL and therefore lets any
-- signed-in user insert a notification for another user. Keep the owner check.
DROP POLICY IF EXISTS "Authenticated users can insert notifications" ON public.notifications;

-- The admin-only ALL policy already includes INSERT with the same check.
DROP POLICY IF EXISTS "Admins can insert company settings" ON public.company_settings;

-- These admin INSERT policies duplicate the INSERT capability of the existing
-- admin ALL policy. Keep the separate first-user bootstrap policy.
DROP POLICY IF EXISTS "Admins can insert roles" ON public.user_roles;

-- Keep one authenticated policy for each of these equivalent admin/auditor reads.
DROP POLICY IF EXISTS "Admins/auditors view reset attempts" ON public.password_reset_attempts;
DROP POLICY IF EXISTS "Admins/auditors view reset tokens" ON public.password_reset_tokens;

-- These receipt INSERT policies have the same role predicate. Keep the explicit
-- authenticated policy; remove the duplicate public-scoped copies.
DROP POLICY IF EXISTS "Authorized users can create receipts" ON public.receipts;
DROP POLICY IF EXISTS "Cashiers can create receipts" ON public.receipts;
