import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { Tables } from '@/integrations/supabase/types';
import { calculateLineAmounts, isTaxEffectiveOnDate, type TaxRule } from '@/lib/tax-calculator';

type Invoice = Tables<'invoices'>;
type InvoiceItem = Tables<'invoice_items'>;
type Customer = Tables<'customers'>;

export interface InvoiceWithItems extends Invoice {
  customer?: Customer;
  items?: InvoiceItem[];
}

interface CreateInvoiceData {
  customer_id: string;
  due_date?: string;
  issue_date?: string;
  prices_include_tax?: boolean;
  notes?: string;
  terms?: string;
  items: {
    product_id?: string;
    description: string;
    quantity: number;
    unit_price: number;
    discount_type?: 'fixed' | 'percentage';
    discount_value?: number;
    tax_ids?: string[];
  }[];
}

export function useInvoices() {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const invoicesQuery = useQuery({
    queryKey: ['invoices'],
    queryFn: async (): Promise<InvoiceWithItems[]> => {
      const { data, error } = await supabase
        .from('invoices')
        .select(`
          *,
          customer:customers(*),
          items:invoice_items(*)
        `)
        .is('deleted_at', null)
        .order('created_at', { ascending: false });

      if (error) throw error;
      return data as InvoiceWithItems[];
    },
  });

  const createInvoiceMutation = useMutation({
    mutationFn: async (invoiceData: CreateInvoiceData) => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not authenticated');

      // Get next invoice number
      const { data: invoiceNumber, error: seqError } = await supabase
        .rpc('get_next_sequence', { seq_name: 'invoice' });

      if (seqError) throw seqError;

      // Load current tax definitions from the database; never trust tax rates sent by the browser.
      const selectedTaxIds = [...new Set(invoiceData.items.flatMap(item => item.tax_ids || []))];
      let taxRules: TaxRule[] = [];
      if (selectedTaxIds.length > 0) {
        const { data: taxRows, error: taxError } = await supabase
          .from('taxes')
          .select('id, name, code, rate, is_compound, applies_to_category, effective_from, effective_to, liability_account_id')
          .in('id', selectedTaxIds)
          .eq('is_active', true);
        if (taxError) throw taxError;
        taxRules = (taxRows || []) as TaxRule[];
      }

      const productIds = [...new Set(invoiceData.items.map(item => item.product_id).filter((id): id is string => Boolean(id)))];
      const productCategories = new Map<string, string | null>();
      if (productIds.length > 0) {
        const { data: productRows, error: productError } = await supabase
          .from('products')
          .select('id, category')
          .in('id', productIds);
        if (productError) throw productError;
        (productRows || []).forEach(product => productCategories.set(product.id, product.category));
      }

      const invoiceDate = invoiceData.issue_date || new Date().toISOString().slice(0, 10);
      let subtotal = 0;
      let taxAmount = 0;
      let discountAmount = 0;
      const taxTotals = new Map<string, { tax_id: string; tax_rate: number; taxable_amount: number; tax_amount: number; liability_account_id: string | null }>();

      const processedItems = invoiceData.items.map((item, index) => {
        const category = item.product_id ? productCategories.get(item.product_id) : null;
        const applicableTaxes = taxRules.filter(tax =>
          (item.tax_ids || []).includes(tax.id) &&
          isTaxEffectiveOnDate(tax, invoiceDate) &&
          (!tax.applies_to_category || tax.applies_to_category.toLowerCase() === (category || '').toLowerCase())
        );
        const calculation = calculateLineAmounts({
          quantity: item.quantity,
          unit_price: item.unit_price,
          discount_type: item.discount_type,
          discount_value: item.discount_value,
          taxes: applicableTaxes,
          pricesIncludeTax: Boolean(invoiceData.prices_include_tax),
        });

        subtotal += calculation.subtotal;
        discountAmount += calculation.discount_amount;
        taxAmount += calculation.tax_amount;
        calculation.taxes.forEach(tax => {
          const rule = taxRules.find(candidate => candidate.id === tax.tax_id);
          const current = taxTotals.get(tax.tax_id) || {
            tax_id: tax.tax_id,
            tax_rate: tax.rate,
            taxable_amount: 0,
            tax_amount: 0,
            liability_account_id: rule?.liability_account_id || null,
          };
          current.taxable_amount += tax.taxable_amount;
          current.tax_amount += tax.tax_amount;
          taxTotals.set(tax.tax_id, current);
        });

        return {
          ...item,
          line_total: calculation.line_total,
          tax_amount: calculation.tax_amount,
          tax_rate: calculation.nominal_tax_rate,
          sort_order: index,
        };
      });

      subtotal = Math.round((subtotal + Number.EPSILON) * 100) / 100;
      discountAmount = Math.round((discountAmount + Number.EPSILON) * 100) / 100;
      taxAmount = Math.round((taxAmount + Number.EPSILON) * 100) / 100;
      const totalAmount = invoiceData.prices_include_tax
        ? Math.round((subtotal - discountAmount + Number.EPSILON) * 100) / 100
        : Math.round((subtotal - discountAmount + taxAmount + Number.EPSILON) * 100) / 100;

      // Create invoice
      const { data: invoice, error: invoiceError } = await supabase
        .from('invoices')
        .insert({
          invoice_number: invoiceNumber,
          customer_id: invoiceData.customer_id,
          due_date: invoiceData.due_date,
          issue_date: invoiceDate,
          notes: invoiceData.notes,
          terms: invoiceData.terms,
          subtotal,
          discount_amount: discountAmount,
          tax_amount: taxAmount,
          total_amount: totalAmount,
          balance_due: totalAmount,
          created_by: user.id,
          status: 'draft',
        })
        .select()
        .single();

      if (invoiceError) throw invoiceError;

      // Create invoice items
      const itemsToInsert = processedItems.map(item => ({
        invoice_id: invoice.id,
        product_id: item.product_id || null,
        description: item.description,
        quantity: item.quantity,
        unit_price: item.unit_price,
        discount_type: item.discount_type || null,
        discount_value: item.discount_value || 0,
        tax_rate: item.tax_rate || 0,
        tax_amount: item.tax_amount,
        line_total: item.line_total,
        sort_order: item.sort_order,
      }));

      const { error: itemsError } = await supabase
        .from('invoice_items')
        .insert(itemsToInsert);

      if (itemsError) throw itemsError;

      const invoiceTaxRows = [...taxTotals.values()].map(tax => ({
        invoice_id: invoice.id,
        tax_id: tax.tax_id,
        tax_rate: tax.tax_rate,
        taxable_amount: Math.round((tax.taxable_amount + Number.EPSILON) * 100) / 100,
        tax_amount: Math.round((tax.tax_amount + Number.EPSILON) * 100) / 100,
        liability_account_id: tax.liability_account_id,
      }));
      if (invoiceTaxRows.length > 0) {
        const { error: invoiceTaxesError } = await supabase
          .from('invoice_taxes')
          .insert(invoiceTaxRows);
        if (invoiceTaxesError) throw invoiceTaxesError;
      }

      return invoice;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['invoices'] });
      toast({ title: 'Invoice created successfully' });
    },
    onError: (error) => {
      toast({ title: 'Failed to create invoice', description: error.message, variant: 'destructive' });
    },
  });

  const issueInvoiceMutation = useMutation({
    mutationFn: async (invoiceId: string): Promise<{ requiresDomainVerification?: boolean }> => {
      // Issuing the invoice and posting its balanced journal entry happen in one database transaction.
      const { error } = await supabase.rpc('issue_invoice', {
        p_invoice_id: invoiceId,
      });

      if (error) throw error;

      // Send invoice email automatically
      try {
        const { data: { session } } = await supabase.auth.getSession();
        if (session?.access_token) {
          const { data } = await supabase.functions.invoke('send-invoice-email', {
            body: { invoiceId },
          });

          // Backend function can return success=true + requiresDomainVerification=true
          // when Resend is restricted to test recipients (unverified domain).
          if (
            typeof data === 'object' &&
            data !== null &&
            'requiresDomainVerification' in data &&
            data.requiresDomainVerification === true
          ) {
            return { requiresDomainVerification: true };
          }
        }
      } catch (emailError) {
        console.error('Failed to send invoice email:', emailError);
        // Don't throw - invoice was issued successfully, email is secondary
      }

      return { requiresDomainVerification: false };
    },
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ['invoices'] });

      if (result?.requiresDomainVerification) {
        toast({
          title: 'Invoice issued (email not sent)',
          description:
            'Email delivery is limited until you verify a sending domain in Resend and use a From address on that domain.',
        });
        return;
      }

      toast({ title: 'Invoice issued successfully' });
    },
    onError: (error) => {
      toast({ title: 'Failed to issue invoice', description: error.message, variant: 'destructive' });
    },
  });

  return {
    invoices: invoicesQuery.data || [],
    isLoading: invoicesQuery.isLoading,
    error: invoicesQuery.error,
    createInvoice: createInvoiceMutation.mutateAsync,
    issueInvoice: issueInvoiceMutation.mutate,
    isCreating: createInvoiceMutation.isPending,
    isIssuing: issueInvoiceMutation.isPending,
  };
}

export function useInvoice(id: string) {
  return useQuery({
    queryKey: ['invoice', id],
    queryFn: async (): Promise<InvoiceWithItems | null> => {
      const { data, error } = await supabase
        .from('invoices')
        .select(`
          *,
          customer:customers(*),
          items:invoice_items(*)
        `)
        .eq('id', id)
        .single();

      if (error) throw error;
      return data as InvoiceWithItems;
    },
    enabled: !!id,
  });
}
