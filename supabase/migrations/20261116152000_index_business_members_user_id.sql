-- Support user-to-business membership lookups and the auth.users FK checks.
-- The unique (business_id, user_id) constraint only covers business_id as its
-- leading column, not user_id.

CREATE INDEX IF NOT EXISTS idx_business_members_user_id
  ON public.business_members (user_id);
