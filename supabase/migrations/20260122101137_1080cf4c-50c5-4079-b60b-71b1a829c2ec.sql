-- ==========================================
-- INVOICE & RECEIPT MANAGEMENT SYSTEM
-- Complete Database Schema
-- ==========================================

-- 1. ENUMS
-- ==========================================

-- User roles enum
CREATE TYPE public.app_role AS ENUM ('admin', 'accountant', 'cashier', 'auditor');

-- Invoice status enum
CREATE TYPE public.invoice_status AS ENUM ('draft', 'issued', 'paid', 'overdue', 'canceled', 'partially_paid');

-- Receipt status enum  
CREATE TYPE public.receipt_status AS ENUM ('issued', 'void');

-- Payment method enum
CREATE TYPE public.payment_method AS ENUM ('cash', 'credit_card', 'debit_card', 'bank_transfer', 'check', 'mobile_payment', 'other');

-- Discount type enum
CREATE TYPE public.discount_type AS ENUM ('fixed', 'percentage');

-- Tax type enum
CREATE TYPE public.tax_type AS ENUM ('vat', 'sales_tax', 'service_tax', 'excise_tax', 'custom');

-- Audit action enum
CREATE TYPE public.audit_action AS ENUM ('create', 'update', 'delete', 'login', 'logout', 'view', 'export', 'sign');

-- 2. PROFILES TABLE
-- ==========================================
CREATE TABLE public.profiles (
    id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    email TEXT NOT NULL,
    full_name TEXT,
    phone TEXT,
    avatar_url TEXT,
    job_title TEXT,
    department TEXT,
    signature_data TEXT, -- Base64 encoded signature image
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT now() NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT now() NOT NULL
);

-- 3. USER ROLES TABLE (Separate for security)
-- ==========================================
CREATE TABLE public.user_roles (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
    role app_role NOT NULL,
    granted_by UUID REFERENCES auth.users(id),
    granted_at TIMESTAMPTZ DEFAULT now() NOT NULL,
    UNIQUE (user_id, role)
);

-- 4. CUSTOMERS TABLE
-- ==========================================
CREATE TABLE public.customers (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    code TEXT UNIQUE NOT NULL,
    name TEXT NOT NULL,
    email TEXT,
    phone TEXT,
    address_line1 TEXT,
    address_line2 TEXT,
    city TEXT,
    state TEXT,
    postal_code TEXT,
    country TEXT DEFAULT 'US',
    tax_id TEXT,
    notes TEXT,
    credit_limit DECIMAL(15,2) DEFAULT 0,
    current_balance DECIMAL(15,2) DEFAULT 0,
    is_active BOOLEAN DEFAULT true,
    created_by UUID REFERENCES auth.users(id),
    created_at TIMESTAMPTZ DEFAULT now() NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT now() NOT NULL,
    deleted_at TIMESTAMPTZ -- Soft delete
);

-- 5. PRODUCTS TABLE
-- ==========================================
CREATE TABLE public.products (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    sku TEXT UNIQUE NOT NULL,
    name TEXT NOT NULL,
    description TEXT,
    category TEXT,
    unit TEXT DEFAULT 'unit',
    current_price DECIMAL(15,2) NOT NULL,
    cost_price DECIMAL(15,2),
    tax_category TEXT, -- Links to which taxes apply
    is_service BOOLEAN DEFAULT false,
    is_active BOOLEAN DEFAULT true,
    stock_quantity INTEGER DEFAULT 0,
    min_stock_level INTEGER DEFAULT 0,
    created_by UUID REFERENCES auth.users(id),
    created_at TIMESTAMPTZ DEFAULT now() NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT now() NOT NULL,
    deleted_at TIMESTAMPTZ -- Soft delete
);

-- 6. PRODUCT PRICE HISTORY (Immutable)
-- ==========================================
CREATE TABLE public.product_price_history (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    product_id UUID REFERENCES public.products(id) ON DELETE CASCADE NOT NULL,
    price DECIMAL(15,2) NOT NULL,
    effective_from TIMESTAMPTZ DEFAULT now() NOT NULL,
    effective_to TIMESTAMPTZ,
    changed_by UUID REFERENCES auth.users(id),
    change_reason TEXT,
    created_at TIMESTAMPTZ DEFAULT now() NOT NULL
);

-- 7. TAXES TABLE
-- ==========================================
CREATE TABLE public.taxes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    code TEXT UNIQUE NOT NULL,
    name TEXT NOT NULL,
    type tax_type NOT NULL,
    rate DECIMAL(5,2) NOT NULL, -- Percentage rate
    is_compound BOOLEAN DEFAULT false, -- Applied on top of other taxes
    applies_to_category TEXT, -- Which product categories
    is_active BOOLEAN DEFAULT true,
    effective_from DATE DEFAULT CURRENT_DATE,
    effective_to DATE,
    created_by UUID REFERENCES auth.users(id),
    created_at TIMESTAMPTZ DEFAULT now() NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT now() NOT NULL
);

-- 8. DISCOUNTS TABLE
-- ==========================================
CREATE TABLE public.discounts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    code TEXT UNIQUE NOT NULL,
    name TEXT NOT NULL,
    type discount_type NOT NULL,
    value DECIMAL(15,2) NOT NULL, -- Amount or percentage
    min_order_amount DECIMAL(15,2) DEFAULT 0,
    max_discount_amount DECIMAL(15,2), -- Cap for percentage discounts
    valid_from TIMESTAMPTZ DEFAULT now(),
    valid_to TIMESTAMPTZ,
    usage_limit INTEGER,
    times_used INTEGER DEFAULT 0,
    is_active BOOLEAN DEFAULT true,
    created_by UUID REFERENCES auth.users(id),
    created_at TIMESTAMPTZ DEFAULT now() NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT now() NOT NULL
);

-- 9. INVOICES TABLE
-- ==========================================
CREATE TABLE public.invoices (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    invoice_number TEXT UNIQUE NOT NULL,
    customer_id UUID REFERENCES public.customers(id) NOT NULL,
    status invoice_status DEFAULT 'draft' NOT NULL,
    issue_date DATE DEFAULT CURRENT_DATE,
    due_date DATE,
    subtotal DECIMAL(15,2) DEFAULT 0,
    discount_amount DECIMAL(15,2) DEFAULT 0,
    tax_amount DECIMAL(15,2) DEFAULT 0,
    total_amount DECIMAL(15,2) DEFAULT 0,
    amount_paid DECIMAL(15,2) DEFAULT 0,
    balance_due DECIMAL(15,2) DEFAULT 0,
    notes TEXT,
    terms TEXT,
    discount_id UUID REFERENCES public.discounts(id),
    issued_by UUID REFERENCES auth.users(id),
    issued_at TIMESTAMPTZ,
    checksum TEXT, -- Hash for integrity verification
    is_locked BOOLEAN DEFAULT false, -- Immutable once issued
    created_by UUID REFERENCES auth.users(id),
    created_at TIMESTAMPTZ DEFAULT now() NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT now() NOT NULL,
    deleted_at TIMESTAMPTZ -- Soft delete
);

-- 10. INVOICE LINE ITEMS TABLE
-- ==========================================
CREATE TABLE public.invoice_items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    invoice_id UUID REFERENCES public.invoices(id) ON DELETE CASCADE NOT NULL,
    product_id UUID REFERENCES public.products(id),
    description TEXT NOT NULL,
    quantity DECIMAL(15,3) NOT NULL,
    unit_price DECIMAL(15,2) NOT NULL,
    discount_type discount_type,
    discount_value DECIMAL(15,2) DEFAULT 0,
    tax_rate DECIMAL(5,2) DEFAULT 0,
    tax_amount DECIMAL(15,2) DEFAULT 0,
    line_total DECIMAL(15,2) NOT NULL,
    sort_order INTEGER DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT now() NOT NULL
);

-- 11. INVOICE TAXES TABLE (Multiple taxes per invoice)
-- ==========================================
CREATE TABLE public.invoice_taxes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    invoice_id UUID REFERENCES public.invoices(id) ON DELETE CASCADE NOT NULL,
    tax_id UUID REFERENCES public.taxes(id) NOT NULL,
    taxable_amount DECIMAL(15,2) NOT NULL,
    tax_rate DECIMAL(5,2) NOT NULL,
    tax_amount DECIMAL(15,2) NOT NULL,
    created_at TIMESTAMPTZ DEFAULT now() NOT NULL
);

-- 12. PAYMENTS TABLE
-- ==========================================
CREATE TABLE public.payments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    payment_number TEXT UNIQUE NOT NULL,
    invoice_id UUID REFERENCES public.invoices(id) NOT NULL,
    customer_id UUID REFERENCES public.customers(id) NOT NULL,
    amount DECIMAL(15,2) NOT NULL,
    payment_method payment_method NOT NULL,
    payment_date TIMESTAMPTZ DEFAULT now() NOT NULL,
    reference_number TEXT,
    notes TEXT,
    processed_by UUID REFERENCES auth.users(id),
    created_at TIMESTAMPTZ DEFAULT now() NOT NULL
);

-- 13. RECEIPTS TABLE
-- ==========================================
CREATE TABLE public.receipts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    receipt_number TEXT UNIQUE NOT NULL,
    invoice_id UUID REFERENCES public.invoices(id),
    payment_id UUID REFERENCES public.payments(id),
    customer_id UUID REFERENCES public.customers(id) NOT NULL,
    amount DECIMAL(15,2) NOT NULL,
    payment_method payment_method NOT NULL,
    status receipt_status DEFAULT 'issued' NOT NULL,
    issue_date TIMESTAMPTZ DEFAULT now() NOT NULL,
    notes TEXT,
    issued_by UUID REFERENCES auth.users(id) NOT NULL,
    issuer_name TEXT NOT NULL, -- Captured at issue time
    signature_data TEXT, -- Digital signature
    checksum TEXT, -- Hash for integrity
    is_locked BOOLEAN DEFAULT true, -- Always locked after creation
    created_at TIMESTAMPTZ DEFAULT now() NOT NULL
);

-- 14. AUDIT LOGS TABLE (Append-only)
-- ==========================================
CREATE TABLE public.audit_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES auth.users(id),
    user_email TEXT,
    action audit_action NOT NULL,
    entity_type TEXT NOT NULL, -- Table name
    entity_id UUID,
    old_data JSONB,
    new_data JSONB,
    ip_address INET,
    user_agent TEXT,
    metadata JSONB,
    created_at TIMESTAMPTZ DEFAULT now() NOT NULL
);

-- 15. NOTIFICATIONS TABLE
-- ==========================================
CREATE TABLE public.notifications (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
    title TEXT NOT NULL,
    message TEXT NOT NULL,
    type TEXT DEFAULT 'info',
    is_read BOOLEAN DEFAULT false,
    link TEXT,
    created_at TIMESTAMPTZ DEFAULT now() NOT NULL,
    read_at TIMESTAMPTZ
);

-- 16. INVOICE NUMBER SEQUENCE
-- ==========================================
CREATE TABLE public.sequences (
    name TEXT PRIMARY KEY,
    prefix TEXT NOT NULL,
    current_value INTEGER DEFAULT 0,
    padding INTEGER DEFAULT 6,
    updated_at TIMESTAMPTZ DEFAULT now() NOT NULL
);

-- Initialize sequences
INSERT INTO public.sequences (name, prefix, current_value) VALUES
    ('invoice', 'INV-', 0),
    ('receipt', 'RCP-', 0),
    ('payment', 'PAY-', 0),
    ('customer', 'CUST-', 0);

-- ==========================================
-- INDEXES FOR PERFORMANCE
-- ==========================================

CREATE INDEX idx_customers_code ON public.customers(code);
CREATE INDEX idx_customers_name ON public.customers(name);
CREATE INDEX idx_customers_active ON public.customers(is_active) WHERE deleted_at IS NULL;

CREATE INDEX idx_products_sku ON public.products(sku);
CREATE INDEX idx_products_name ON public.products(name);
CREATE INDEX idx_products_category ON public.products(category);
CREATE INDEX idx_products_active ON public.products(is_active) WHERE deleted_at IS NULL;

CREATE INDEX idx_invoices_number ON public.invoices(invoice_number);
CREATE INDEX idx_invoices_customer ON public.invoices(customer_id);
CREATE INDEX idx_invoices_status ON public.invoices(status);
CREATE INDEX idx_invoices_dates ON public.invoices(issue_date, due_date);
CREATE INDEX idx_invoices_created ON public.invoices(created_at DESC);

CREATE INDEX idx_receipts_number ON public.receipts(receipt_number);
CREATE INDEX idx_receipts_customer ON public.receipts(customer_id);
CREATE INDEX idx_receipts_date ON public.receipts(issue_date DESC);

CREATE INDEX idx_payments_invoice ON public.payments(invoice_id);
CREATE INDEX idx_payments_customer ON public.payments(customer_id);
CREATE INDEX idx_payments_date ON public.payments(payment_date DESC);

CREATE INDEX idx_audit_logs_user ON public.audit_logs(user_id);
CREATE INDEX idx_audit_logs_entity ON public.audit_logs(entity_type, entity_id);
CREATE INDEX idx_audit_logs_action ON public.audit_logs(action);
CREATE INDEX idx_audit_logs_created ON public.audit_logs(created_at DESC);

CREATE INDEX idx_notifications_user ON public.notifications(user_id);
CREATE INDEX idx_notifications_unread ON public.notifications(user_id, is_read) WHERE is_read = false;

CREATE INDEX idx_user_roles_user ON public.user_roles(user_id);

-- ==========================================
-- SECURITY FUNCTIONS
-- ==========================================

-- Check if user has a specific role
CREATE OR REPLACE FUNCTION public.has_role(_user_id UUID, _role app_role)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT EXISTS (
        SELECT 1
        FROM public.user_roles
        WHERE user_id = _user_id
        AND role = _role
    )
$$;

-- Check if user has any role (is authenticated employee)
CREATE OR REPLACE FUNCTION public.has_any_role(_user_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT EXISTS (
        SELECT 1
        FROM public.user_roles
        WHERE user_id = _user_id
    )
$$;

-- Get user's highest role
CREATE OR REPLACE FUNCTION public.get_user_role(_user_id UUID)
RETURNS app_role
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT role
    FROM public.user_roles
    WHERE user_id = _user_id
    ORDER BY 
        CASE role
            WHEN 'admin' THEN 1
            WHEN 'accountant' THEN 2
            WHEN 'auditor' THEN 3
            WHEN 'cashier' THEN 4
        END
    LIMIT 1
$$;

-- Generate next sequence number
CREATE OR REPLACE FUNCTION public.get_next_sequence(seq_name TEXT)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    result TEXT;
    seq RECORD;
BEGIN
    UPDATE public.sequences 
    SET current_value = current_value + 1, updated_at = now()
    WHERE name = seq_name
    RETURNING prefix, current_value, padding INTO seq;
    
    result := seq.prefix || LPAD(seq.current_value::TEXT, seq.padding, '0');
    RETURN result;
END;
$$;

-- Update timestamps trigger
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public;

-- ==========================================
-- TRIGGERS
-- ==========================================

CREATE TRIGGER update_profiles_updated_at
    BEFORE UPDATE ON public.profiles
    FOR EACH ROW
    EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_customers_updated_at
    BEFORE UPDATE ON public.customers
    FOR EACH ROW
    EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_products_updated_at
    BEFORE UPDATE ON public.products
    FOR EACH ROW
    EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_taxes_updated_at
    BEFORE UPDATE ON public.taxes
    FOR EACH ROW
    EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_discounts_updated_at
    BEFORE UPDATE ON public.discounts
    FOR EACH ROW
    EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_invoices_updated_at
    BEFORE UPDATE ON public.invoices
    FOR EACH ROW
    EXECUTE FUNCTION public.update_updated_at_column();

-- Auto-create profile on user signup
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
    INSERT INTO public.profiles (id, email, full_name)
    VALUES (NEW.id, NEW.email, COALESCE(NEW.raw_user_meta_data->>'full_name', ''));
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

CREATE TRIGGER on_auth_user_created
    AFTER INSERT ON auth.users
    FOR EACH ROW
    EXECUTE FUNCTION public.handle_new_user();

-- ==========================================
-- ROW LEVEL SECURITY
-- ==========================================

-- Enable RLS on all tables
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.customers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.products ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.product_price_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.taxes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.discounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.invoices ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.invoice_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.invoice_taxes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.receipts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sequences ENABLE ROW LEVEL SECURITY;

-- PROFILES POLICIES
CREATE POLICY "Users can view own profile" ON public.profiles
    FOR SELECT USING (auth.uid() = id);

CREATE POLICY "Users can update own profile" ON public.profiles
    FOR UPDATE USING (auth.uid() = id);

CREATE POLICY "Admins can view all profiles" ON public.profiles
    FOR SELECT USING (public.has_role(auth.uid(), 'admin'));

-- USER ROLES POLICIES
CREATE POLICY "Users can view own roles" ON public.user_roles
    FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Admins can manage roles" ON public.user_roles
    FOR ALL USING (public.has_role(auth.uid(), 'admin'));

-- CUSTOMERS POLICIES
CREATE POLICY "Employees can view customers" ON public.customers
    FOR SELECT USING (public.has_any_role(auth.uid()));

CREATE POLICY "Admins and accountants can manage customers" ON public.customers
    FOR ALL USING (
        public.has_role(auth.uid(), 'admin') OR 
        public.has_role(auth.uid(), 'accountant')
    );

-- PRODUCTS POLICIES
CREATE POLICY "Employees can view products" ON public.products
    FOR SELECT USING (public.has_any_role(auth.uid()));

CREATE POLICY "Admins and accountants can manage products" ON public.products
    FOR ALL USING (
        public.has_role(auth.uid(), 'admin') OR 
        public.has_role(auth.uid(), 'accountant')
    );

-- PRODUCT PRICE HISTORY POLICIES
CREATE POLICY "Employees can view price history" ON public.product_price_history
    FOR SELECT USING (public.has_any_role(auth.uid()));

CREATE POLICY "Admins can insert price history" ON public.product_price_history
    FOR INSERT WITH CHECK (
        public.has_role(auth.uid(), 'admin') OR 
        public.has_role(auth.uid(), 'accountant')
    );

-- TAXES POLICIES
CREATE POLICY "Employees can view taxes" ON public.taxes
    FOR SELECT USING (public.has_any_role(auth.uid()));

CREATE POLICY "Admins can manage taxes" ON public.taxes
    FOR ALL USING (public.has_role(auth.uid(), 'admin'));

-- DISCOUNTS POLICIES
CREATE POLICY "Employees can view discounts" ON public.discounts
    FOR SELECT USING (public.has_any_role(auth.uid()));

CREATE POLICY "Admins and accountants can manage discounts" ON public.discounts
    FOR ALL USING (
        public.has_role(auth.uid(), 'admin') OR 
        public.has_role(auth.uid(), 'accountant')
    );

-- INVOICES POLICIES
CREATE POLICY "Employees can view invoices" ON public.invoices
    FOR SELECT USING (public.has_any_role(auth.uid()));

CREATE POLICY "Admins, accountants, and cashiers can create invoices" ON public.invoices
    FOR INSERT WITH CHECK (
        public.has_role(auth.uid(), 'admin') OR 
        public.has_role(auth.uid(), 'accountant') OR
        public.has_role(auth.uid(), 'cashier')
    );

CREATE POLICY "Admins and accountants can update invoices" ON public.invoices
    FOR UPDATE USING (
        (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'accountant'))
        AND is_locked = false
    );

-- INVOICE ITEMS POLICIES
CREATE POLICY "Employees can view invoice items" ON public.invoice_items
    FOR SELECT USING (public.has_any_role(auth.uid()));

CREATE POLICY "Admins, accountants, and cashiers can manage invoice items" ON public.invoice_items
    FOR ALL USING (
        public.has_role(auth.uid(), 'admin') OR 
        public.has_role(auth.uid(), 'accountant') OR
        public.has_role(auth.uid(), 'cashier')
    );

-- INVOICE TAXES POLICIES
CREATE POLICY "Employees can view invoice taxes" ON public.invoice_taxes
    FOR SELECT USING (public.has_any_role(auth.uid()));

CREATE POLICY "Admins and accountants can manage invoice taxes" ON public.invoice_taxes
    FOR ALL USING (
        public.has_role(auth.uid(), 'admin') OR 
        public.has_role(auth.uid(), 'accountant')
    );

-- PAYMENTS POLICIES
CREATE POLICY "Employees can view payments" ON public.payments
    FOR SELECT USING (public.has_any_role(auth.uid()));

CREATE POLICY "Authorized users can create payments" ON public.payments
    FOR INSERT WITH CHECK (
        public.has_role(auth.uid(), 'admin') OR 
        public.has_role(auth.uid(), 'accountant') OR
        public.has_role(auth.uid(), 'cashier')
    );

-- RECEIPTS POLICIES
CREATE POLICY "Employees can view receipts" ON public.receipts
    FOR SELECT USING (public.has_any_role(auth.uid()));

CREATE POLICY "Authorized users can create receipts" ON public.receipts
    FOR INSERT WITH CHECK (
        public.has_role(auth.uid(), 'admin') OR 
        public.has_role(auth.uid(), 'accountant') OR
        public.has_role(auth.uid(), 'cashier')
    );

-- AUDIT LOGS POLICIES (Read-only for auditors and admins)
CREATE POLICY "Admins and auditors can view audit logs" ON public.audit_logs
    FOR SELECT USING (
        public.has_role(auth.uid(), 'admin') OR 
        public.has_role(auth.uid(), 'auditor')
    );

CREATE POLICY "System can insert audit logs" ON public.audit_logs
    FOR INSERT WITH CHECK (true);

-- NOTIFICATIONS POLICIES
CREATE POLICY "Users can view own notifications" ON public.notifications
    FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can update own notifications" ON public.notifications
    FOR UPDATE USING (auth.uid() = user_id);

CREATE POLICY "System can insert notifications" ON public.notifications
    FOR INSERT WITH CHECK (true);

-- SEQUENCES POLICIES
CREATE POLICY "Employees can use sequences" ON public.sequences
    FOR ALL USING (public.has_any_role(auth.uid()));