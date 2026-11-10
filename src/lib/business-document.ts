import type { Database } from '@/integrations/supabase/types';
export type Company = Database['public']['Tables']['company_settings']['Row'];
export type Customer = Database['public']['Tables']['customers']['Row'];
export type DocumentItem = Pick<Database['public']['Tables']['invoice_items']['Row'], 'description' | 'quantity' | 'unit_price' | 'line_total'>;
export type BusinessDocument = {
  kind: 'invoice' | 'receipt'; number: string; date: string; dueDate?: string | null; status: string;
  company: Company | null; customer: Customer | null; items: DocumentItem[];
  subtotal: number; discount: number; tax: number; total: number; paid: number; balance: number;
  notes?: string | null; terms?: string | null; invoiceNumber?: string | null; paymentMethod?: string;
  issuer?: string; signature?: string | null; checksum?: string | null;
};
export function money(value: number, company: Company | null) {
  return `${company?.currency_symbol || company?.currency_code || 'USD'} ${Number(value).toLocaleString('en', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
export function documentDate(value?: string | null) {
  return value ? new Date(value.length === 10 ? `${value}T12:00:00` : value).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : '—';
}