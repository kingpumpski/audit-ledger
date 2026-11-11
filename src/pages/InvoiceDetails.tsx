import { useState } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { AppLayout } from '@/components/layout/AppLayout';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { useInvoice, useInvoices } from '@/hooks/useInvoices';
import { useSettings } from '@/hooks/useSettings';
import { RecordPaymentDialog } from '@/components/payments/RecordPaymentDialog';
import { EditInvoiceDialog } from '@/components/invoices/EditInvoiceDialog';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { useQueryClient } from '@tanstack/react-query';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { 
  ArrowLeft, FileText, Loader2, Send, CreditCard, Printer, User,
  Calendar, Building, Mail, Phone, MapPin, Edit, Trash2, XCircle
} from 'lucide-react';
import { format } from 'date-fns';
import { cn } from '@/lib/utils';
import { getErrorMessage } from '@/lib/error-message';

const statusColors: Record<string, string> = {
  paid: 'bg-success/10 text-success border-success/20',
  issued: 'bg-info/10 text-info border-info/20',
  overdue: 'bg-destructive/10 text-destructive border-destructive/20',
  draft: 'bg-muted text-muted-foreground',
  partially_paid: 'bg-warning/10 text-warning border-warning/20',
  canceled: 'bg-muted text-muted-foreground line-through',
};

export default function InvoiceDetails() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { data: invoice, isLoading, error } = useInvoice(id || '');
  const { issueInvoice, isIssuing } = useInvoices();
  const { settings } = useSettings();
  const [isPrinting, setIsPrinting] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [isCanceling, setIsCanceling] = useState(false);

  const currencySymbol = settings?.currency_symbol || '$';

  const handlePrintInvoice = async () => {
    if (!invoice) return;
    setIsPrinting(true);
    try {
      const response = await supabase.functions.invoke('generate-invoice-pdf', {
        body: { invoiceId: invoice.id, returnHtml: true },
      });
      if (response.data) {
        const htmlContent = typeof response.data === 'string' ? response.data : response.data.html || String(response.data);
        const printWindow = window.open('', '_blank');
        if (printWindow) {
          printWindow.document.write(htmlContent);
          printWindow.document.close();
          printWindow.print();
        }
      }
    } catch (error) {
      console.error('Failed to generate PDF:', error);
    } finally {
      setIsPrinting(false);
    }
  };

  const handleEditSave = async (invoiceId: string, data: { notes?: string; terms?: string; due_date?: string }) => {
    setIsSaving(true);
    try {
      const { error } = await supabase.from('invoices').update(data).eq('id', invoiceId);
      if (error) throw error;
      queryClient.invalidateQueries({ queryKey: ['invoice', invoiceId] });
      queryClient.invalidateQueries({ queryKey: ['invoices'] });
      toast({ title: 'Invoice updated successfully' });
    } catch (err: unknown) {
      toast({ title: 'Failed to update invoice', description: getErrorMessage(err, 'An unexpected error occurred.'), variant: 'destructive' });
    } finally {
      setIsSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!invoice) return;
    setIsDeleting(true);
    try {
      const { error } = await supabase.from('invoices')
        .update({ deleted_at: new Date().toISOString() })
        .eq('id', invoice.id);
      if (error) throw error;
      queryClient.invalidateQueries({ queryKey: ['invoices'] });
      toast({ title: 'Invoice deleted' });
      navigate('/invoices');
    } catch (err: unknown) {
      toast({ title: 'Failed to delete invoice', description: getErrorMessage(err, 'An unexpected error occurred.'), variant: 'destructive' });
    } finally {
      setIsDeleting(false);
    }
  };

  const handleCancel = async () => {
    if (!invoice) return;
    setIsCanceling(true);
    try {
      const { error } = await supabase.from('invoices')
        .update({ status: 'canceled' })
        .eq('id', invoice.id);
      if (error) throw error;
      queryClient.invalidateQueries({ queryKey: ['invoice', invoice.id] });
      queryClient.invalidateQueries({ queryKey: ['invoices'] });
      toast({ title: 'Invoice canceled' });
    } catch (err: unknown) {
      toast({ title: 'Failed to cancel invoice', description: getErrorMessage(err, 'An unexpected error occurred.'), variant: 'destructive' });
    } finally {
      setIsCanceling(false);
    }
  };

  if (isLoading) {
    return (
      <AppLayout title="Invoice Details">
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      </AppLayout>
    );
  }

  if (error || !invoice) {
    return (
      <AppLayout title="Invoice Details">
        <Card>
          <CardContent className="py-12 text-center">
            <FileText className="h-12 w-12 mx-auto text-muted-foreground/50" />
            <h3 className="mt-4 text-lg font-medium">Invoice not found</h3>
            <Button className="mt-4" onClick={() => navigate('/invoices')}>
              <ArrowLeft className="mr-2 h-4 w-4" /> Back to Invoices
            </Button>
          </CardContent>
        </Card>
      </AppLayout>
    );
  }

  const canEdit = invoice.status !== 'paid' && invoice.status !== 'canceled';
  const canDelete = invoice.status === 'draft' || invoice.status === 'canceled';
  const canCancel = invoice.status !== 'paid' && invoice.status !== 'canceled';

  return (
    <AppLayout
      title={invoice.invoice_number}
      subtitle="Invoice Details"
      actions={
        <div className="flex items-center gap-2 flex-wrap">
          <Button variant="outline" onClick={() => navigate('/invoices')}>
            <ArrowLeft className="mr-2 h-4 w-4" /> Back
          </Button>
          <Button variant="outline" onClick={handlePrintInvoice} disabled={isPrinting}>
            {isPrinting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Printer className="mr-2 h-4 w-4" />}
            Print
          </Button>
          {canEdit && (
            <Button variant="outline" onClick={() => setIsEditing(true)}>
              <Edit className="mr-2 h-4 w-4" /> Edit
            </Button>
          )}
          {canCancel && invoice.status !== 'draft' && (
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button variant="outline" disabled={isCanceling}>
                  <XCircle className="mr-2 h-4 w-4" /> Cancel Invoice
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Cancel this invoice?</AlertDialogTitle>
                  <AlertDialogDescription>This will mark the invoice as canceled. This action is logged.</AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>No</AlertDialogCancel>
                  <AlertDialogAction onClick={handleCancel}>Yes, Cancel</AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          )}
          {canDelete && (
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button variant="destructive" disabled={isDeleting}>
                  <Trash2 className="mr-2 h-4 w-4" /> Delete
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Delete this invoice?</AlertDialogTitle>
                  <AlertDialogDescription>This action cannot be undone.</AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>No</AlertDialogCancel>
                  <AlertDialogAction onClick={handleDelete}>Yes, Delete</AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          )}
          {invoice.status === 'draft' && (
            <Button onClick={() => issueInvoice(invoice.id)} disabled={isIssuing}>
              {isIssuing ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Send className="mr-2 h-4 w-4" />}
              Issue Invoice
            </Button>
          )}
          {(invoice.status === 'issued' || invoice.status === 'partially_paid' || invoice.status === 'overdue') && (
            <RecordPaymentDialog
              invoiceId={invoice.id}
              customerId={invoice.customer_id}
              invoiceNumber={invoice.invoice_number}
              balanceDue={invoice.balance_due || 0}
              currencySymbol={currencySymbol}
              trigger={
                <Button><CreditCard className="mr-2 h-4 w-4" /> Record Payment</Button>
              }
            />
          )}
        </div>
      }
    >
      <div className="grid gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2 space-y-6">
          <Card>
            <CardContent className="p-6">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-4">
                  <div className="p-3 rounded-lg bg-primary/10">
                    <FileText className="h-6 w-6 text-primary" />
                  </div>
                  <div>
                    <h2 className="text-xl font-bold">{invoice.invoice_number}</h2>
                    <p className="text-muted-foreground">Created {format(new Date(invoice.created_at), 'PPP')}</p>
                  </div>
                </div>
                <Badge className={cn('text-sm px-3 py-1', statusColors[invoice.status])}>
                  {invoice.status.replace('_', ' ')}
                </Badge>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle>Line Items</CardTitle></CardHeader>
            <CardContent>
              <table className="w-full">
                <thead>
                  <tr className="border-b">
                    <th className="text-left py-2 font-medium">Description</th>
                    <th className="text-right py-2 font-medium">Qty</th>
                    <th className="text-right py-2 font-medium">Unit Price</th>
                    <th className="text-right py-2 font-medium">Tax</th>
                    <th className="text-right py-2 font-medium">Total</th>
                  </tr>
                </thead>
                <tbody>
                  {invoice.items?.map((item) => (
                    <tr key={item.id} className="border-b last:border-0">
                      <td className="py-3">{item.description}</td>
                      <td className="py-3 text-right">{item.quantity}</td>
                      <td className="py-3 text-right">{currencySymbol}{item.unit_price.toLocaleString(undefined, { minimumFractionDigits: 2 })}</td>
                      <td className="py-3 text-right text-muted-foreground">{item.tax_rate ? `${item.tax_rate}%` : '—'}</td>
                      <td className="py-3 text-right font-medium">{currencySymbol}{item.line_total.toLocaleString(undefined, { minimumFractionDigits: 2 })}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <Separator className="my-4" />
              <div className="space-y-2">
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Subtotal</span>
                  <span>{currencySymbol}{(invoice.subtotal || 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}</span>
                </div>
                {(invoice.discount_amount || 0) > 0 && (
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">Discount</span>
                    <span className="text-success">-{currencySymbol}{invoice.discount_amount?.toLocaleString(undefined, { minimumFractionDigits: 2 })}</span>
                  </div>
                )}
                {(invoice.tax_amount || 0) > 0 && (
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">Tax</span>
                    <span>{currencySymbol}{invoice.tax_amount?.toLocaleString(undefined, { minimumFractionDigits: 2 })}</span>
                  </div>
                )}
                <Separator />
                <div className="flex justify-between font-bold text-lg">
                  <span>Total</span>
                  <span>{currencySymbol}{(invoice.total_amount || 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Amount Paid</span>
                  <span className="text-success">{currencySymbol}{(invoice.amount_paid || 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}</span>
                </div>
                <div className="flex justify-between font-bold">
                  <span>Balance Due</span>
                  <span className={cn((invoice.balance_due || 0) > 0 && 'text-warning')}>
                    {currencySymbol}{(invoice.balance_due || 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}
                  </span>
                </div>
              </div>
            </CardContent>
          </Card>

          {(invoice.notes || invoice.terms) && (
            <Card>
              <CardContent className="p-6 space-y-4">
                {invoice.notes && (
                  <div>
                    <h4 className="font-medium mb-1">Notes</h4>
                    <p className="text-sm text-muted-foreground whitespace-pre-wrap">{invoice.notes}</p>
                  </div>
                )}
                {invoice.terms && (
                  <div>
                    <h4 className="font-medium mb-1">Terms & Conditions</h4>
                    <p className="text-sm text-muted-foreground whitespace-pre-wrap">{invoice.terms}</p>
                  </div>
                )}
              </CardContent>
            </Card>
          )}
        </div>

        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2"><User className="h-4 w-4" /> Customer</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {invoice.customer ? (
                <>
                  <div>
                    <p className="font-medium">{invoice.customer.name}</p>
                    <p className="text-sm text-muted-foreground">{invoice.customer.code}</p>
                  </div>
                  {invoice.customer.email && (
                    <div className="flex items-center gap-2 text-sm"><Mail className="h-4 w-4 text-muted-foreground" /><span>{invoice.customer.email}</span></div>
                  )}
                  {invoice.customer.phone && (
                    <div className="flex items-center gap-2 text-sm"><Phone className="h-4 w-4 text-muted-foreground" /><span>{invoice.customer.phone}</span></div>
                  )}
                  {invoice.customer.address_line1 && (
                    <div className="flex items-start gap-2 text-sm">
                      <MapPin className="h-4 w-4 text-muted-foreground mt-0.5" />
                      <div>
                        <p>{invoice.customer.address_line1}</p>
                        {invoice.customer.address_line2 && <p>{invoice.customer.address_line2}</p>}
                        <p>{[invoice.customer.city, invoice.customer.state, invoice.customer.postal_code].filter(Boolean).join(', ')}</p>
                        {invoice.customer.country && <p>{invoice.customer.country}</p>}
                      </div>
                    </div>
                  )}
                  <Button variant="outline" size="sm" asChild className="w-full mt-2">
                    <Link to={`/customers/${invoice.customer.id}`}>View Customer Profile</Link>
                  </Button>
                </>
              ) : (
                <p className="text-muted-foreground">Customer not found</p>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2"><Calendar className="h-4 w-4" /> Dates</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Issue Date</span>
                <span>{invoice.issue_date ? format(new Date(invoice.issue_date), 'PPP') : '—'}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Due Date</span>
                <span>{invoice.due_date ? format(new Date(invoice.due_date), 'PPP') : '—'}</span>
              </div>
              {invoice.issued_at && (
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Issued At</span>
                  <span>{format(new Date(invoice.issued_at), 'PPP p')}</span>
                </div>
              )}
            </CardContent>
          </Card>

          {settings && (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2"><Building className="h-4 w-4" /> From</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2 text-sm">
                <p className="font-medium">{settings.company_name}</p>
                {settings.company_email && <p>{settings.company_email}</p>}
                {settings.company_phone && <p>{settings.company_phone}</p>}
                {settings.company_address && <p>{settings.company_address}</p>}
                {settings.company_tax_id && <p className="text-muted-foreground">Tax ID: {settings.company_tax_id}</p>}
              </CardContent>
            </Card>
          )}
        </div>
      </div>

      <EditInvoiceDialog
        invoice={invoice}
        open={isEditing}
        onOpenChange={setIsEditing}
        onSave={handleEditSave}
        isSaving={isSaving}
      />
    </AppLayout>
  );
}
