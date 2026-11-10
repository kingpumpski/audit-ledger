import { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { Eye, Download, Search, RefreshCw, FileText, Receipt, ArrowLeft } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import type { Database } from '@/integrations/supabase/types';
import { AppLayout } from '@/components/layout/AppLayout';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { BusinessDocument } from './BusinessDocument';
import { type BusinessDocument as DocumentData, type Company, type Customer, money, documentDate } from '@/lib/business-document';
import { createDocumentPdf } from '@/lib/document-pdf';
import { toast } from 'sonner';
type Invoice = Database['public']['Tables']['invoices']['Row'] & { customers: Customer | null };
type ReceiptRow = Database['public']['Tables']['receipts']['Row'] & { customers: Customer | null };
export function DocumentsPage({ kind }: { kind: 'invoice' | 'receipt' }) {
  const [rows, setRows] = useState<(Invoice | ReceiptRow)[]>([]);
  const [company, setCompany] = useState<Company | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('all');
  const [selected, setSelected] = useState<DocumentData | null>(null);
  const [busy, setBusy] = useState(false);
  const params = useParams();
  const load = async () => {
    setLoading(true); setError('');
    const [records, settings] = await Promise.all([
      kind === 'invoice' ? supabase.from('invoices').select('*, customers(*)').is('deleted_at', null).order('created_at', { ascending: false }) : supabase.from('receipts').select('*, customers(*)').is('deleted_at', null).order('created_at', { ascending: false }),
      supabase.from('company_settings').select('*').limit(1).maybeSingle(),
    ]);
    if (records.error || settings.error) setError(records.error?.message || settings.error?.message || 'Unable to load documents');
    else { setRows(records.data || []); setCompany(settings.data); }
    setLoading(false);
  };
  useEffect(() => { void load(); }, [kind]);
  const open = async (row: Invoice | ReceiptRow) => {
    setBusy(true);
    try {
      const invoiceId = 'invoice_number' in row ? row.id : row.invoice_id;
      const [items, invoice] = await Promise.all([
        invoiceId ? supabase.from('invoice_items').select('*').eq('invoice_id', invoiceId).order('sort_order') : Promise.resolve({ data: [], error: null }),
        invoiceId && kind === 'receipt' ? supabase.from('invoices').select('invoice_number').eq('id', invoiceId).maybeSingle() : Promise.resolve({ data: null, error: null }),
      ]);
      if (items.error || invoice.error) throw items.error || invoice.error;
      const isInvoice = 'invoice_number' in row;
      const d: DocumentData = {
        kind, company, customer: row.customers, number: isInvoice ? row.invoice_number : row.receipt_number,
        date: row.issue_date || row.created_at, status: row.status,
        dueDate: isInvoice ? row.due_date : null,
        items: isInvoice ? items.data || [] : [{ description: `Payment${invoice.data ? ` for invoice ${invoice.data.invoice_number}` : ''}`, quantity: 1, unit_price: row.amount, line_total: row.amount }],
        subtotal: isInvoice ? Number(row.subtotal || 0) : row.amount, discount: isInvoice ? Number(row.discount_amount || 0) : 0,
        tax: isInvoice ? Number(row.tax_amount || 0) : 0, total: isInvoice ? Number(row.total_amount || 0) : row.amount,
        paid: isInvoice ? Number(row.amount_paid || 0) : row.amount, balance: isInvoice ? Number(row.balance_due || 0) : 0,
        notes: row.notes, terms: isInvoice ? row.terms : null, invoiceNumber: invoice.data?.invoice_number,
        paymentMethod: isInvoice ? undefined : row.payment_method, issuer: isInvoice ? undefined : row.issuer_name,
        signature: isInvoice ? null : row.signature_data, checksum: row.checksum,
      };
      setSelected(d);
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Unable to open document'); }
    finally { setBusy(false); }
  };
  const download = async () => {
    if (!selected) return;
    setBusy(true);
    try { (await createDocumentPdf(selected)).save(`${selected.number.replace(/[^\w.-]/g, '_')}.pdf`); }
    catch (e) { toast.error(e instanceof Error ? e.message : 'Unable to export PDF'); }
    finally { setBusy(false); }
  };
  const visible = rows.filter(r => (status === 'all' || r.status === status) && `${'invoice_number' in r ? r.invoice_number : r.receipt_number} ${r.customers?.name || ''}`.toLowerCase().includes(search.toLowerCase()));
  const Icon = kind === 'invoice' ? FileText : Receipt;
  return <AppLayout title={kind === 'invoice' ? 'Invoices' : 'Receipts'} subtitle={kind === 'invoice' ? 'Billing & outstanding balances' : 'Payment records & signed receipts'}>
    {params['*'] && <Button asChild variant="ghost" className="mb-4"><Link to={kind === 'invoice' ? '/invoices' : '/receipts'}><ArrowLeft className="mr-2 h-4 w-4" />All documents</Link></Button>}
    <div className="flex flex-wrap items-center gap-3 mb-6"><div className="relative flex-1 min-w-0"><Search className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" /><Input aria-label="Search documents" placeholder="Search number or customer" value={search} onChange={e => setSearch(e.target.value)} className="pl-9" /></div>
      <Select value={status} onValueChange={setStatus}><SelectTrigger className="w-40" aria-label="Document status"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">All statuses</SelectItem>{(kind === 'invoice' ? ['draft', 'issued', 'paid', 'overdue', 'partially_paid', 'canceled'] : ['issued', 'void']).map(s => <SelectItem key={s} value={s}>{s.replace('_', ' ')}</SelectItem>)}</SelectContent></Select>
      <Button variant="outline" size="icon" title="Refresh documents" aria-label="Refresh documents" onClick={load} disabled={loading}><RefreshCw className="h-4 w-4" /></Button></div>
    {error ? <div className="border border-destructive/40 p-5 text-destructive" role="alert">{error}<Button className="ml-4" variant="outline" onClick={load}>Retry</Button></div> : loading ? <p className="text-muted-foreground py-12">Loading documents…</p> : visible.length === 0 ? <div className="py-16 text-center border-y"><Icon className="h-9 w-9 mx-auto mb-3 text-muted-foreground" /><h2 className="text-lg">No {kind}s found</h2><p className="text-muted-foreground text-sm mt-2">{search || status !== 'all' ? 'No records match the selected filters.' : 'There are no saved records yet.'}</p></div> : <div className="overflow-x-auto border-y"><table className="data-table"><thead><tr><th>Document</th><th>Customer</th><th>Amount</th><th>Status</th><th>Issued</th><th></th></tr></thead><tbody>{visible.map(row => <tr key={row.id}><td className="font-medium whitespace-nowrap">{'invoice_number' in row ? row.invoice_number : row.receipt_number}</td><td>{row.customers?.name || '—'}</td><td className="whitespace-nowrap">{money('total_amount' in row ? Number(row.total_amount || 0) : row.amount, company)}</td><td><Badge variant="outline" className="capitalize">{row.status.replace('_', ' ')}</Badge></td><td className="whitespace-nowrap">{documentDate(row.issue_date)}</td><td><Button variant="ghost" size="icon" title="View document" aria-label={`View ${'invoice_number' in row ? row.invoice_number : row.receipt_number}`} onClick={() => open(row)} disabled={busy}><Eye className="h-4 w-4" /></Button></td></tr>)}</tbody></table></div>}
    <Dialog open={!!selected} onOpenChange={v => { if (!v) setSelected(null); }}><DialogContent className="max-w-5xl w-[95vw] max-h-[92vh] overflow-y-auto p-0"><DialogHeader className="px-6 pt-5 pb-4 pr-14 border-b"><DialogTitle>{selected?.kind === 'invoice' ? 'Invoice' : 'Payment receipt'} · {selected?.number}</DialogTitle><DialogDescription>Issued document</DialogDescription><div className="pt-2"><Button onClick={download} disabled={busy}><Download className="h-4 w-4 mr-2" />{busy ? 'Preparing…' : 'Download PDF'}</Button></div></DialogHeader>{selected && <BusinessDocument data={selected} />}</DialogContent></Dialog>
  </AppLayout>;
}