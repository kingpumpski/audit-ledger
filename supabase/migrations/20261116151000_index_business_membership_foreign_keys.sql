-- Index the two user-reference foreign keys introduced with the business tenancy
-- foundation. This migration follows the foundation so both tables exist.

CREATE INDEX IF NOT EXISTS idx_businesses_created_by
  ON public.businesses (created_by);

CREATE INDEX IF NOT EXISTS idx_business_members_invited_by
  ON public.business_members (invited_by);
