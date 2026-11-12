-- Remove permissive RLS policies that are exact duplicates or materially
-- broader than the intended owner-scoped policy. No table data is changed.

-- This policy only checks auth.uid() IS NOT NULL and lets any signed-in user
-- insert notifications for another user. Keep the owner-scoped INSERT policy.
DROP POLICY IF EXISTS "Authenticated users can insert notifications" ON public.notifications;

-- The admin-only ALL policy already includes INSERT with the same check.
DROP POLICY IF EXISTS "Admins can insert company settings" ON public.company_settings;

-- The admin ALL policy covers INSERT. Preserve the separate first-user bootstrap.
DROP POLICY IF EXISTS "Admins can insert roles" ON public.user_roles;

-- Keep one authenticated policy for each equivalent admin/auditor read.
DROP POLICY IF EXISTS "Admins/auditors view reset attempts" ON public.password_reset_attempts;
DROP POLICY IF EXISTS "Admins/auditors view reset tokens" ON public.password_reset_tokens;

-- Keep the explicit authenticated receipt INSERT policy; remove duplicates.
DROP POLICY IF EXISTS "Authorized users can create receipts" ON public.receipts;
DROP POLICY IF EXISTS "Cashiers can create receipts" ON public.receipts;
