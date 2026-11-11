
-- =========================================================
-- PASSWORD RESET MODULE — schema
-- =========================================================

-- 1) Reset tokens (email link + SMS OTP)
CREATE TABLE public.password_reset_tokens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  otp_hash TEXT,
  channel TEXT NOT NULL DEFAULT 'email' CHECK (channel IN ('email','sms','both')),
  expires_at TIMESTAMPTZ NOT NULL,
  used_at TIMESTAMPTZ,
  ip_address TEXT,
  user_agent TEXT,
  otp_attempts INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_prt_user ON public.password_reset_tokens(user_id);
CREATE INDEX idx_prt_expires ON public.password_reset_tokens(expires_at);

GRANT SELECT ON public.password_reset_tokens TO authenticated;
GRANT ALL ON public.password_reset_tokens TO service_role;
ALTER TABLE public.password_reset_tokens ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins/auditors view reset tokens"
  ON public.password_reset_tokens FOR SELECT
  TO authenticated
  USING (public.has_any_role(ARRAY['admin','auditor']));

-- 2) Rate-limit attempts
CREATE TABLE public.password_reset_attempts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT,
  ip_address TEXT,
  user_agent TEXT,
  result TEXT NOT NULL CHECK (result IN ('requested','sent','verified','failed','blocked','otp_failed')),
  reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_pra_email_time ON public.password_reset_attempts(email, created_at DESC);
CREATE INDEX idx_pra_ip_time ON public.password_reset_attempts(ip_address, created_at DESC);

GRANT SELECT ON public.password_reset_attempts TO authenticated;
GRANT ALL ON public.password_reset_attempts TO service_role;
ALTER TABLE public.password_reset_attempts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins/auditors view reset attempts"
  ON public.password_reset_attempts FOR SELECT
  TO authenticated
  USING (public.has_any_role(ARRAY['admin','auditor']));

-- 3) Password history (last 10)
CREATE TABLE public.password_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  password_hash TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_ph_user_time ON public.password_history(user_id, created_at DESC);

GRANT SELECT ON public.password_history TO authenticated;
GRANT ALL ON public.password_history TO service_role;
ALTER TABLE public.password_history ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins view password history"
  ON public.password_history FOR SELECT
  TO authenticated
  USING (public.has_role('admin'));

-- 4) Password policy (single row)
CREATE TABLE public.password_policy (
  id INT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  min_length INT NOT NULL DEFAULT 12,
  require_uppercase BOOLEAN NOT NULL DEFAULT true,
  require_lowercase BOOLEAN NOT NULL DEFAULT true,
  require_number BOOLEAN NOT NULL DEFAULT true,
  require_special BOOLEAN NOT NULL DEFAULT true,
  disallow_spaces BOOLEAN NOT NULL DEFAULT true,
  history_count INT NOT NULL DEFAULT 10,
  token_ttl_minutes INT NOT NULL DEFAULT 30,
  otp_ttl_minutes INT NOT NULL DEFAULT 10,
  max_requests_per_hour INT NOT NULL DEFAULT 5,
  require_mfa BOOLEAN NOT NULL DEFAULT false,
  security_questions_enabled BOOLEAN NOT NULL DEFAULT false,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by UUID REFERENCES auth.users(id)
);

INSERT INTO public.password_policy (id) VALUES (1) ON CONFLICT DO NOTHING;

GRANT SELECT ON public.password_policy TO authenticated;
GRANT ALL ON public.password_policy TO service_role;
ALTER TABLE public.password_policy ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone signed in can read policy"
  ON public.password_policy FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Admins update policy"
  ON public.password_policy FOR UPDATE
  TO authenticated
  USING (public.has_role('admin'))
  WITH CHECK (public.has_role('admin'));

CREATE TRIGGER trg_password_policy_updated
  BEFORE UPDATE ON public.password_policy
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 5) Helpers
CREATE OR REPLACE FUNCTION public.count_recent_reset_requests(_email TEXT, _ip TEXT, _minutes INT DEFAULT 60)
RETURNS INT
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COUNT(*)::int
  FROM public.password_reset_attempts
  WHERE created_at > now() - make_interval(mins => _minutes)
    AND result IN ('requested','sent')
    AND (email = _email OR ip_address = _ip);
$$;

REVOKE EXECUTE ON FUNCTION public.count_recent_reset_requests(TEXT, TEXT, INT) FROM anon;
GRANT EXECUTE ON FUNCTION public.count_recent_reset_requests(TEXT, TEXT, INT) TO authenticated, service_role;

-- Audit trigger on new tables
CREATE TRIGGER audit_prt AFTER INSERT OR UPDATE OR DELETE ON public.password_reset_tokens
  FOR EACH ROW EXECUTE FUNCTION public.audit_trigger_func();
CREATE TRIGGER audit_ph AFTER INSERT OR UPDATE OR DELETE ON public.password_history
  FOR EACH ROW EXECUTE FUNCTION public.audit_trigger_func();
CREATE TRIGGER audit_policy AFTER UPDATE ON public.password_policy
  FOR EACH ROW EXECUTE FUNCTION public.audit_trigger_func();
