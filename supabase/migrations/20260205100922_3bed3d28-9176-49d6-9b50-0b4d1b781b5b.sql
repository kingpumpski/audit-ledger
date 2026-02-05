-- Drop the old broken audit_trigger function that uses wrong column names
DROP FUNCTION IF EXISTS public.audit_trigger() CASCADE;

-- The audit_trigger_func already exists and is correct, no changes needed there