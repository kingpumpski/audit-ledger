
-- Create petty_cash_transactions table for accounting
CREATE TABLE public.petty_cash_transactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  date date NOT NULL DEFAULT CURRENT_DATE,
  description text NOT NULL,
  amount numeric NOT NULL,
  type text NOT NULL CHECK (type IN ('income', 'expense')),
  category text,
  reference_number text,
  recorded_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.petty_cash_transactions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins accountants manage petty cash" ON public.petty_cash_transactions
  FOR ALL TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'accountant'::app_role))
  WITH CHECK (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'accountant'::app_role));

CREATE POLICY "Employees can view petty cash" ON public.petty_cash_transactions
  FOR SELECT TO authenticated
  USING (has_any_role(auth.uid()));

-- Create inventory_transactions table for stock management
CREATE TABLE public.inventory_transactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id uuid NOT NULL REFERENCES public.products(id),
  type text NOT NULL CHECK (type IN ('purchase', 'sale', 'adjustment', 'return', 'damage', 'transfer')),
  quantity integer NOT NULL,
  previous_quantity integer,
  new_quantity integer,
  unit_cost numeric,
  total_cost numeric,
  reference_id uuid,
  reference_type text,
  notes text,
  performed_by uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.inventory_transactions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins accountants cashiers manage inventory" ON public.inventory_transactions
  FOR ALL TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'accountant'::app_role) OR has_role(auth.uid(), 'cashier'::app_role))
  WITH CHECK (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'accountant'::app_role) OR has_role(auth.uid(), 'cashier'::app_role));

CREATE POLICY "Employees can view inventory transactions" ON public.inventory_transactions
  FOR SELECT TO authenticated
  USING (has_any_role(auth.uid()));

-- Add trigger for updated_at on petty_cash
CREATE TRIGGER update_petty_cash_updated_at
  BEFORE UPDATE ON public.petty_cash_transactions
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
