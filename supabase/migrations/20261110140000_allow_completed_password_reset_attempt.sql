-- Record successful password resets using an explicit terminal audit result.
-- Keep the historical migration immutable; this forward migration widens the allowed result set.
ALTER TABLE public.password_reset_attempts
  DROP CONSTRAINT IF EXISTS password_reset_attempts_result_check;

ALTER TABLE public.password_reset_attempts
  ADD CONSTRAINT password_reset_attempts_result_check
  CHECK (result IN ('requested', 'sent', 'verified', 'failed', 'blocked', 'otp_failed', 'completed'));
