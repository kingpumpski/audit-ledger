-- 1. MFA settings per user
CREATE TABLE IF NOT EXISTS public.user_mfa (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  method text NOT NULL DEFAULT 'email' CHECK (method IN ('email','sms','totp')),
  phone text,
  totp_secret text,
  totp_confirmed boolean NOT NULL DEFAULT false,
  enabled boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE ON public.user_mfa TO authenticated;
GRANT ALL ON public.user_mfa TO service_role;

ALTER TABLE public.user_mfa ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage own mfa settings"
ON public.user_mfa FOR SELECT TO authenticated
USING (user_id = auth.uid() OR public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Users insert own mfa settings"
ON public.user_mfa FOR INSERT TO authenticated
WITH CHECK (user_id = auth.uid());

CREATE POLICY "Users update own mfa settings"
ON public.user_mfa FOR UPDATE TO authenticated
USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

CREATE TRIGGER update_user_mfa_updated_at
BEFORE UPDATE ON public.user_mfa
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 2. Step-up tracking on reset tokens
ALTER TABLE public.password_reset_tokens
  ADD COLUMN IF NOT EXISTS mfa_required boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS mfa_method text,
  ADD COLUMN IF NOT EXISTS mfa_verified_at timestamptz,
  ADD COLUMN IF NOT EXISTS mfa_attempts integer NOT NULL DEFAULT 0;

-- 3. Lockouts
CREATE TABLE IF NOT EXISTS public.password_reset_lockouts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text,
  ip_address text,
  failure_count integer NOT NULL DEFAULT 0,
  locked_until timestamptz,
  last_failure_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS password_reset_lockouts_key
  ON public.password_reset_lockouts (COALESCE(email,''), COALESCE(ip_address,''));

GRANT SELECT ON public.password_reset_lockouts TO authenticated;
GRANT ALL ON public.password_reset_lockouts TO service_role;

ALTER TABLE public.password_reset_lockouts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins and auditors view lockouts"
ON public.password_reset_lockouts FOR SELECT TO authenticated
USING (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'auditor'));

CREATE TRIGGER update_password_reset_lockouts_updated_at
BEFORE UPDATE ON public.password_reset_lockouts
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 4. Lockout helpers
CREATE OR REPLACE FUNCTION public.is_reset_locked(_email text, _ip text)
RETURNS boolean LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.password_reset_lockouts
    WHERE locked_until IS NOT NULL
      AND locked_until > now()
      AND (( _email IS NOT NULL AND email = _email) OR (_ip IS NOT NULL AND ip_address = _ip))
  );
$$;

CREATE OR REPLACE FUNCTION public.register_reset_failure(_email text, _ip text, _threshold integer DEFAULT 5, _lock_minutes integer DEFAULT 30)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  rec public.password_reset_lockouts;
BEGIN
  SELECT * INTO rec FROM public.password_reset_lockouts
  WHERE COALESCE(email,'') = COALESCE(_email,'') AND COALESCE(ip_address,'') = COALESCE(_ip,'');

  IF rec.id IS NULL THEN
    INSERT INTO public.password_reset_lockouts (email, ip_address, failure_count, last_failure_at)
    VALUES (_email, _ip, 1, now())
    RETURNING * INTO rec;
  ELSE
    UPDATE public.password_reset_lockouts
    SET failure_count = CASE WHEN rec.last_failure_at < now() - interval '1 hour' THEN 1 ELSE rec.failure_count + 1 END,
        last_failure_at = now(),
        updated_at = now()
    WHERE id = rec.id
    RETURNING * INTO rec;
  END IF;

  IF rec.failure_count >= _threshold THEN
    UPDATE public.password_reset_lockouts
    SET locked_until = now() + make_interval(mins => _lock_minutes), updated_at = now()
    WHERE id = rec.id
    RETURNING * INTO rec;
  END IF;

  RETURN jsonb_build_object(
    'failure_count', rec.failure_count,
    'locked_until', rec.locked_until,
    'locked', rec.locked_until IS NOT NULL AND rec.locked_until > now()
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.clear_reset_lockout(_email text, _ip text)
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  DELETE FROM public.password_reset_lockouts
  WHERE COALESCE(email,'') = COALESCE(_email,'') OR (_ip IS NOT NULL AND ip_address = _ip);
$$;

REVOKE EXECUTE ON FUNCTION public.is_reset_locked(text, text) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.register_reset_failure(text, text, integer, integer) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.clear_reset_lockout(text, text) FROM anon, authenticated;

-- 5. Admin dashboard read access
DROP POLICY IF EXISTS "Admins and auditors view reset attempts" ON public.password_reset_attempts;
CREATE POLICY "Admins and auditors view reset attempts"
ON public.password_reset_attempts FOR SELECT TO authenticated
USING (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'auditor'));

DROP POLICY IF EXISTS "Admins and auditors view reset tokens" ON public.password_reset_tokens;
CREATE POLICY "Admins and auditors view reset tokens"
ON public.password_reset_tokens FOR SELECT TO authenticated
USING (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'auditor'));

GRANT SELECT ON public.password_reset_attempts TO authenticated;
GRANT SELECT ON public.password_reset_tokens TO authenticated;