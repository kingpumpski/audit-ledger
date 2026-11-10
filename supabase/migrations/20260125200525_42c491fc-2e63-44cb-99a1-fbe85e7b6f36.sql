-- Create company_settings table for storing company configuration
CREATE TABLE public.company_settings (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  company_name TEXT NOT NULL DEFAULT '',
  company_email TEXT,
  company_phone TEXT,
  company_address TEXT,
  company_city TEXT,
  company_state TEXT,
  company_postal_code TEXT,
  company_country TEXT,
  company_tax_id TEXT,
  company_logo_url TEXT,
  invoice_prefix TEXT DEFAULT 'INV-',
  receipt_prefix TEXT DEFAULT 'RCP-',
  payment_prefix TEXT DEFAULT 'PAY-',
  default_payment_terms TEXT DEFAULT 'Net 30',
  default_invoice_notes TEXT,
  default_invoice_terms TEXT,
  currency_code TEXT DEFAULT 'USD',
  currency_symbol TEXT DEFAULT '$',
  notify_on_invoice_issued BOOLEAN DEFAULT true,
  notify_on_payment_received BOOLEAN DEFAULT true,
  notify_on_overdue BOOLEAN DEFAULT true,
  overdue_reminder_days INTEGER[] DEFAULT ARRAY[7, 14, 30],
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.company_settings ENABLE ROW LEVEL SECURITY;

-- Only admins can view/update company settings
CREATE POLICY "Admins can view company settings"
  ON public.company_settings FOR SELECT
  USING (public.has_role('admin'));

CREATE POLICY "Admins can insert company settings"
  ON public.company_settings FOR INSERT
  WITH CHECK (public.has_role('admin'));

CREATE POLICY "Admins can update company settings"
  ON public.company_settings FOR UPDATE
  USING (public.has_role('admin'));

-- Insert default settings row
INSERT INTO public.company_settings (company_name) VALUES ('My Company');

-- Add updated_at trigger
CREATE TRIGGER update_company_settings_updated_at
  BEFORE UPDATE ON public.company_settings
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();