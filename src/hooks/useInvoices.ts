import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { Tables, TablesInsert } from '@/integrations/supabase/types';

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
  notes?: string;
  terms?: string;
  items: {
    product_id?: string;
    description: string;
    quantity: number;
    unit_price: number;
    discount_type?: 'fixed' | 'percentage';
    discount_value?: number;
    tax_rate?: number;
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

      // Calculate totals
      let subtotal = 0;
      let taxAmount = 0;
      let discountAmount = 0;

      const processedItems = invoiceData.items.map((item, index) => {
        const lineSubtotal = item.quantity * item.unit_price;
        
        // Calculate line discount
        let lineDiscount = 0;
        if (item.discount_value) {
          lineDiscount = item.discount_type === 'percentage'
            ? lineSubtotal * (item.discount_value / 100)
            : item.discount_value;
        }
        
        // Calculate line tax
        const taxableAmount = lineSubtotal - lineDiscount;
        const lineTax = item.tax_rate ? taxableAmount * (item.tax_rate / 100) : 0;
        
        const lineTotal = taxableAmount + lineTax;

        subtotal += lineSubtotal;
        discountAmount += lineDiscount;
        taxAmount += lineTax;

        return {
          ...item,
          line_total: lineTotal,
          tax_amount: lineTax,
          sort_order: index,
        };
      });

      const totalAmount = subtotal - discountAmount + taxAmount;

      // Create invoice
      const { data: invoice, error: invoiceError } = await supabase
        .from('invoices')
        .insert({
          invoice_number: invoiceNumber,
          customer_id: invoiceData.customer_id,
          due_date: invoiceData.due_date,
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
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not authenticated');

      const { error } = await supabase
        .from('invoices')
        .update({
          status: 'issued',
          issued_at: new Date().toISOString(),
          issued_by: user.id,
          is_locked: true,
        })
        .eq('id', invoiceId)
        .eq('status', 'draft');

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
