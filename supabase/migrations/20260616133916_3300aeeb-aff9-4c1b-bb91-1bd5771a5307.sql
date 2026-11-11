
-- Chart of Accounts table
CREATE TYPE public.account_type AS ENUM ('asset', 'liability', 'equity', 'revenue', 'expense');
CREATE TYPE public.account_subtype AS ENUM (
  'current_asset','fixed_asset','other_asset',
  'current_liability','long_term_liability',
  'equity',
  'operating_revenue','other_revenue',
  'cost_of_sales','operating_expense','other_expense'
);

CREATE TABLE public.chart_of_accounts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  description TEXT,
  account_type public.account_type NOT NULL,
  account_subtype public.account_subtype,
  parent_id UUID REFERENCES public.chart_of_accounts(id) ON DELETE SET NULL,
  is_active BOOLEAN NOT NULL DEFAULT true,
  is_system BOOLEAN NOT NULL DEFAULT false,
  opening_balance NUMERIC(18,2) NOT NULL DEFAULT 0,
  current_balance NUMERIC(18,2) NOT NULL DEFAULT 0,
  currency TEXT NOT NULL DEFAULT 'USD',
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.chart_of_accounts TO authenticated;
GRANT ALL ON public.chart_of_accounts TO service_role;

ALTER TABLE public.chart_of_accounts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users with finance roles can view accounts"
  ON public.chart_of_accounts FOR SELECT TO authenticated
  USING (public.has_any_role(ARRAY['admin','accountant','auditor']));

CREATE POLICY "Admins and accountants can create accounts"
  ON public.chart_of_accounts FOR INSERT TO authenticated
  WITH CHECK (public.has_any_role(ARRAY['admin','accountant']));

CREATE POLICY "Admins and accountants can update accounts"
  ON public.chart_of_accounts FOR UPDATE TO authenticated
  USING (public.has_any_role(ARRAY['admin','accountant']))
  WITH CHECK (public.has_any_role(ARRAY['admin','accountant']));

CREATE POLICY "Only admins can delete non-system accounts"
  ON public.chart_of_accounts FOR DELETE TO authenticated
  USING (public.has_role(auth.uid(), 'admin') AND is_system = false);

CREATE INDEX idx_coa_type ON public.chart_of_accounts(account_type);
CREATE INDEX idx_coa_parent ON public.chart_of_accounts(parent_id);

CREATE TRIGGER update_chart_of_accounts_updated_at
  BEFORE UPDATE ON public.chart_of_accounts
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Audit log
CREATE TRIGGER audit_chart_of_accounts
  AFTER INSERT OR UPDATE OR DELETE ON public.chart_of_accounts
  FOR EACH ROW EXECUTE FUNCTION public.audit_trigger_func();

-- Security fix: validate sequence name to prevent arbitrary sequence increments
CREATE OR REPLACE FUNCTION public.get_next_sequence(seq_name text)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
    result TEXT;
    seq RECORD;
BEGIN
    IF seq_name NOT IN ('invoice','receipt','payment','customer','product','journal','account') THEN
      RAISE EXCEPTION 'Invalid sequence name: %', seq_name;
    END IF;

    UPDATE public.sequences
    SET current_value = current_value + 1, updated_at = now()
    WHERE name = seq_name
    RETURNING prefix, current_value, padding INTO seq;

    IF seq.prefix IS NULL THEN
      RAISE EXCEPTION 'Sequence not found: %', seq_name;
    END IF;

    result := seq.prefix || LPAD(seq.current_value::TEXT, seq.padding, '0');
    RETURN result;
END;
$function$;

-- Seed default chart of accounts
INSERT INTO public.chart_of_accounts (code, name, account_type, account_subtype, is_system) VALUES
  ('1000','Cash on Hand','asset','current_asset',true),
  ('1010','Bank - Operating Account','asset','current_asset',true),
  ('1100','Accounts Receivable','asset','current_asset',true),
  ('1200','Inventory','asset','current_asset',true),
  ('1500','Fixed Assets','asset','fixed_asset',true),
  ('2000','Accounts Payable','liability','current_liability',true),
  ('2100','Sales Tax Payable','liability','current_liability',true),
  ('3000','Owner''s Equity','equity','equity',true),
  ('3100','Retained Earnings','equity','equity',true),
  ('4000','Sales Revenue','revenue','operating_revenue',true),
  ('5000','Cost of Goods Sold','expense','cost_of_sales',true),
  ('6000','Operating Expenses','expense','operating_expense',true),
  ('6100','Salaries & Wages','expense','operating_expense',true),
  ('6200','Rent Expense','expense','operating_expense',true),
  ('6300','Utilities','expense','operating_expense',true);
