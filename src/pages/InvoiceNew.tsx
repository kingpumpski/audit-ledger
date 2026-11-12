import { useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { AppLayout } from '@/components/layout/AppLayout';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { 
  Select, 
  SelectContent, 
  SelectItem, 
  SelectTrigger, 
  SelectValue 
} from '@/components/ui/select';
import { Calendar } from '@/components/ui/calendar';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { useInvoices } from '@/hooks/useInvoices';
import { useCustomers } from '@/hooks/useCustomers';
import { useProducts } from '@/hooks/useProducts';
import { useTaxes } from '@/hooks/useTaxes';
import { useSettings } from '@/hooks/useSettings';
import { 
  Plus, 
  Trash2, 
  CalendarIcon,
  Loader2,
  Save,
  Eye,
  ArrowLeft,
  Send,
  FileText,
  Search
} from 'lucide-react';
import { format, addDays } from 'date-fns';
import { cn } from '@/lib/utils';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';

interface LineItem {
  id: string;
  product_id?: string;
  description: string;
  quantity: number;
  unit_price: number;
  discount_type?: 'fixed' | 'percentage';
  discount_value?: number;
  tax_rate?: number;
}

export default function InvoiceNew() {
  const navigate = useNavigate();
  const { toast } = useToast();
  const { createInvoice, issueInvoice, isCreating, isIssuing } = useInvoices();
  const { customers, isLoading: customersLoading, createCustomer, isCreating: isCreatingCustomer } = useCustomers();
  const { products, isLoading: productsLoading } = useProducts();
  const { taxes } = useTaxes();
  const { settings } = useSettings();

  const [customerId, setCustomerId] = useState<string>('');
  const [isCustomerDialogOpen, setIsCustomerDialogOpen] = useState(false);
  const [newCustomer, setNewCustomer] = useState({ name: '', email: '', phone: '' });
  const [issueDate, setIssueDate] = useState<Date>(new Date());
  const [dueDate, setDueDate] = useState<Date>(addDays(new Date(), 30));
  const [notes, setNotes] = useState('');
  const [terms, setTerms] = useState('Payment due within 30 days.');
  const [items, setItems] = useState<LineItem[]>([
    { id: crypto.randomUUID(), description: '', quantity: 1, unit_price: 0, tax_rate: 0 }
  ]);
  const [showPreview, setShowPreview] = useState(false);
  const [productSearchQuery, setProductSearchQuery] = useState('');
  const [isSendingEmail, setIsSendingEmail] = useState(false);

  const currencySymbol = settings?.currency_symbol || '$';

  // Filter products based on search
  const filteredProducts = useMemo(() => {
    if (!productSearchQuery) return products.slice(0, 20);
    return products.filter(p => 
      p.name.toLowerCase().includes(productSearchQuery.toLowerCase()) ||
      p.sku.toLowerCase().includes(productSearchQuery.toLowerCase())
    ).slice(0, 20);
  }, [products, productSearchQuery]);

  // Active taxes for dropdown
  const activeTaxes = taxes.filter(t => t.is_active);

  const addItem = () => {
    setItems([
      ...items,
      { id: crypto.randomUUID(), description: '', quantity: 1, unit_price: 0, tax_rate: 0 }
    ]);
  };

  const removeItem = (id: string) => {
    if (items.length === 1) return;
    setItems(items.filter(item => item.id !== id));
  };

  const updateItem = (id: string, updates: Partial<LineItem>) => {
    setItems(items.map(item => 
      item.id === id ? { ...item, ...updates } : item
    ));
  };

  const selectProduct = (itemId: string, productId: string) => {
    const product = products.find(p => p.id === productId);
    if (product) {
      updateItem(itemId, {
        product_id: productId,
        description: product.name,
        unit_price: product.current_price,
      });
    }
  };

  const calculateLineTotal = (item: LineItem) => {
    const subtotal = item.quantity * item.unit_price;
    let discount = 0;
    if (item.discount_value) {
      discount = item.discount_type === 'percentage' 
        ? subtotal * (item.discount_value / 100) 
        : item.discount_value;
    }
    const taxable = subtotal - discount;
    const tax = item.tax_rate ? taxable * (item.tax_rate / 100) : 0;
    return taxable + tax;
  };

  const subtotal = items.reduce((sum, item) => sum + (item.quantity * item.unit_price), 0);
  const totalDiscount = items.reduce((sum, item) => {
    if (!item.discount_value) return sum;
    const lineSubtotal = item.quantity * item.unit_price;
    return sum + (item.discount_type === 'percentage' 
      ? lineSubtotal * (item.discount_value / 100) 
      : item.discount_value);
  }, 0);
  const totalTax = items.reduce((sum, item) => {
    const lineSubtotal = item.quantity * item.unit_price;
    const lineDiscount = item.discount_value 
      ? (item.discount_type === 'percentage' ? lineSubtotal * (item.discount_value / 100) : item.discount_value)
      : 0;
    const taxable = lineSubtotal - lineDiscount;
    return sum + (item.tax_rate ? taxable * (item.tax_rate / 100) : 0);
  }, 0);
  const total = subtotal - totalDiscount + totalTax;

  const selectedCustomer = customers.find(c => c.id === customerId);

  const handleCreateCustomer = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!newCustomer.name.trim()) return;
    try {
      const customer = await createCustomer({
        name: newCustomer.name.trim(),
        email: newCustomer.email.trim() || null,
        phone: newCustomer.phone.trim() || null,
      });
      setCustomerId(customer.id);
      setNewCustomer({ name: '', email: '', phone: '' });
      setIsCustomerDialogOpen(false);
      toast({ title: 'Customer added', description: 'The new customer has been selected for this invoice.' });
    } catch (error) {
      console.error('Failed to create customer from invoice:', error);
    }
  };

  const handleSubmit = async (asDraft: boolean = true) => {
    if (!customerId || items.length === 0) {
      toast({
        title: 'Validation Error',
        description: 'Please select a customer and add at least one item.',
        variant: 'destructive',
      });
      return;
    }

    // Validate items
    const invalidItems = items.filter(item => !item.description || item.quantity <= 0 || item.unit_price < 0);
    if (invalidItems.length > 0) {
      toast({
        title: 'Validation Error',
        description: 'Please fill in all item details correctly.',
        variant: 'destructive',
      });
      return;
    }

    try {
      const invoice = await createInvoice({
        customer_id: customerId,
        issue_date: format(issueDate, 'yyyy-MM-dd'),
        due_date: format(dueDate, 'yyyy-MM-dd'),
        notes,
        terms,
        items: items.map(item => ({
          product_id: item.product_id,
          description: item.description,
          quantity: item.quantity,
          unit_price: item.unit_price,
          discount_type: item.discount_type,
          discount_value: item.discount_value,
          tax_rate: item.tax_rate,
        })),
      });

      if (!asDraft && invoice?.id) {
        // Issue the invoice immediately
        issueInvoice(invoice.id);
      }

      navigate('/invoices');
    } catch (error) {
      console.error('Failed to create invoice:', error);
    }
  };

  const handleSaveAndSend = async () => {
    if (!customerId || items.length === 0) {
      toast({
        title: 'Validation Error',
        description: 'Please select a customer and add at least one item.',
        variant: 'destructive',
      });
      return;
    }

    try {
      const invoice = await createInvoice({
        customer_id: customerId,
        issue_date: format(issueDate, 'yyyy-MM-dd'),
        due_date: format(dueDate, 'yyyy-MM-dd'),
        notes,
        terms,
        items: items.map(item => ({
          product_id: item.product_id,
          description: item.description,
          quantity: item.quantity,
          unit_price: item.unit_price,
          discount_type: item.discount_type,
          discount_value: item.discount_value,
          tax_rate: item.tax_rate,
        })),
      });

      if (invoice?.id) {
        // Issue and send email
        issueInvoice(invoice.id);
        toast({
          title: 'Invoice Created & Sent',
          description: 'The invoice has been created and will be emailed to the customer.',
        });
      }

      navigate('/invoices');
    } catch (error) {
      console.error('Failed to create and send invoice:', error);
    }
  };

  return (
    <AppLayout
      title="New Invoice"
      subtitle="Create a new invoice with line items"
      actions={
        <div className="flex items-center gap-2">
          <Button variant="outline" onClick={() => navigate('/invoices')}>
            <ArrowLeft className="mr-2 h-4 w-4" />
            Cancel
          </Button>
          <Button variant="outline" onClick={() => setShowPreview(!showPreview)}>
            <Eye className="mr-2 h-4 w-4" />
            {showPreview ? 'Hide Preview' : 'Preview'}
          </Button>
        </div>
      }
    >
      <Dialog open={isCustomerDialogOpen} onOpenChange={setIsCustomerDialogOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Add a customer</DialogTitle><DialogDescription>Create the missing customer and return to this invoice automatically.</DialogDescription></DialogHeader>
          <form onSubmit={handleCreateCustomer} className="space-y-4">
            <div className="space-y-2"><Label>Customer name *</Label><Input autoFocus value={newCustomer.name} onChange={e => setNewCustomer(v => ({ ...v, name: e.target.value }))} required /></div>
            <div className="space-y-2"><Label>Email</Label><Input type="email" value={newCustomer.email} onChange={e => setNewCustomer(v => ({ ...v, email: e.target.value }))} /></div>
            <div className="space-y-2"><Label>Phone</Label><Input value={newCustomer.phone} onChange={e => setNewCustomer(v => ({ ...v, phone: e.target.value }))} /></div>
            <DialogFooter><Button type="button" variant="outline" onClick={() => setIsCustomerDialogOpen(false)}>Cancel</Button><Button type="submit" disabled={isCreatingCustomer || !newCustomer.name.trim()}>{isCreatingCustomer && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Create and select</Button></DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
      <div className={cn('mx-auto grid w-full max-w-6xl gap-6', showPreview && 'xl:grid-cols-2')}>
        {/* Form */}
        <div className="space-y-6">
          {/* Customer & Details */}
          <Card>
            <CardHeader>
              <CardTitle>Invoice Details</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-4 md:grid-cols-3">
                <div className="space-y-2">
                  <Label>Invoice Date *</Label>
                  <Input type="date" value={format(issueDate, 'yyyy-MM-dd')} onChange={e => { const value = e.target.value; if (value) setIssueDate(new Date(`${value}T12:00:00`)); }} />
                  <p className="text-xs text-muted-foreground">You can record invoices for previous accounting periods.</p>
                </div>
                <div className="space-y-2">
                  <Label>Customer *</Label>
                  <Select value={customerId} onValueChange={(value) => value === '__add_customer__' ? setIsCustomerDialogOpen(true) : setCustomerId(value)}>
                    <SelectTrigger>
                      <SelectValue placeholder="Select customer" />
                    </SelectTrigger>
                    <SelectContent>
                      {customers.map(customer => (
                        <SelectItem key={customer.id} value={customer.id}>
                          {customer.name} ({customer.code})
                        </SelectItem>
                      ))}
                      <SelectItem value="__add_customer__">+ Add new customer…</SelectItem>
                    </SelectContent>
                  </Select>
                  <Button type="button" variant="link" className="h-auto p-0" onClick={() => setIsCustomerDialogOpen(true)}>
                    <Plus className="mr-1 h-3.5 w-3.5" />Add customer if not listed
                  </Button>
                </div>

                <div className="space-y-2">
                  <Label>Due Date *</Label>
                  <Popover>
                    <PopoverTrigger asChild>
                      <Button variant="outline" className="w-full justify-start">
                        <CalendarIcon className="mr-2 h-4 w-4" />
                        {format(dueDate, 'PPP')}
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent className="w-auto p-0">
                      <Calendar
                        mode="single"
                        selected={dueDate}
                        onSelect={(date) => date && setDueDate(date)}
                         />
                    </PopoverContent>
                  </Popover>
                </div>
              </div>

              <div className="space-y-2">
                <Label>Terms</Label>
                <Input 
                  value={terms} 
                  onChange={(e) => setTerms(e.target.value)} 
                  placeholder="Payment terms..."
                />
              </div>

              <div className="space-y-2">
                <Label>Notes</Label>
                <Textarea 
                  value={notes} 
                  onChange={(e) => setNotes(e.target.value)} 
                  placeholder="Additional notes for the customer..."
                  rows={3}
                />
              </div>
            </CardContent>
          </Card>

          {/* Line Items */}
          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle>Line Items</CardTitle>
              <Button size="sm" onClick={addItem}>
                <Plus className="mr-2 h-4 w-4" />
                Add Item
              </Button>
            </CardHeader>
            <CardContent className="space-y-4">
              {items.map((item, index) => (
                <div key={item.id} className="p-4 border rounded-lg space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-medium text-muted-foreground">
                      Item {index + 1}
                    </span>
                    <Button 
                      variant="ghost" 
                      size="sm" 
                      onClick={() => removeItem(item.id)}
                      disabled={items.length === 1}
                    >
                      <Trash2 className="h-4 w-4 text-destructive" />
                    </Button>
                  </div>

                  <div className="grid gap-3 md:grid-cols-2">
                    <div className="space-y-2 md:col-span-2">
                      <Label>Product (Optional)</Label>
                      <Select 
                        value={item.product_id || 'none'} 
                        onValueChange={(v) => v !== 'none' && selectProduct(item.id, v)}
                      >
                        <SelectTrigger>
                          <SelectValue placeholder="Select product or enter manually" />
                        </SelectTrigger>
                        <SelectContent>
                          <div className="p-2">
                            <div className="relative">
                              <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
                              <Input
                                placeholder="Search products..."
                                value={productSearchQuery}
                                onChange={(e) => setProductSearchQuery(e.target.value)}
                                className="pl-8"
                              />
                            </div>
                          </div>
                          <SelectItem value="none">-- Enter manually --</SelectItem>
                          {filteredProducts.map(product => (
                            <SelectItem key={product.id} value={product.id}>
                              <div className="flex justify-between items-center gap-4">
                                <span>{product.name}</span>
                                <span className="text-muted-foreground">{currencySymbol}{product.current_price}</span>
                              </div>
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>

                    <div className="space-y-2 md:col-span-2">
                      <Label>Description *</Label>
                      <Input 
                        value={item.description}
                        onChange={(e) => updateItem(item.id, { description: e.target.value })}
                        placeholder="Item description"
                      />
                    </div>

                    <div className="space-y-2">
                      <Label>Quantity *</Label>
                      <Input 
                        type="number"
                        min="1"
                        value={item.quantity}
                        onChange={(e) => updateItem(item.id, { quantity: Number(e.target.value) })}
                      />
                    </div>

                    <div className="space-y-2">
                      <Label>Unit Price ({currencySymbol}) *</Label>
                      <Input 
                        type="number"
                        min="0"
                        step="0.01"
                        value={item.unit_price}
                        onChange={(e) => updateItem(item.id, { unit_price: Number(e.target.value) })}
                      />
                    </div>

                    <div className="space-y-2">
                      <Label>Discount</Label>
                      <div className="flex gap-2">
                        <Input 
                          type="number"
                          min="0"
                          value={item.discount_value || ''}
                          onChange={(e) => updateItem(item.id, { discount_value: Number(e.target.value) || undefined })}
                          placeholder="0"
                          className="flex-1"
                        />
                        <Select 
                          value={item.discount_type || 'fixed'} 
                          onValueChange={(v: 'fixed' | 'percentage') => updateItem(item.id, { discount_type: v })}
                        >
                          <SelectTrigger className="w-[80px]">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="fixed">{currencySymbol}</SelectItem>
                            <SelectItem value="percentage">%</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                    </div>

                    <div className="space-y-2">
                      <Label>Tax Rate</Label>
                      <Select 
                        value={item.tax_rate?.toString() || '0'} 
                        onValueChange={(v) => updateItem(item.id, { tax_rate: Number(v) })}
                      >
                        <SelectTrigger>
                          <SelectValue placeholder="Select tax" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="0">No Tax (0%)</SelectItem>
                          {activeTaxes.map(tax => (
                            <SelectItem key={tax.id} value={tax.rate.toString()}>
                              {tax.name} ({tax.rate}%)
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>

                  <div className="flex justify-end pt-2 border-t">
                    <span className="text-sm font-medium">
                      Line Total: {currencySymbol}{calculateLineTotal(item).toFixed(2)}
                    </span>
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>

          {/* Summary & Actions */}
          <Card>
            <CardContent className="pt-6">
              <div className="space-y-2 mb-6">
                <div className="flex justify-between text-sm">
                  <span>Subtotal</span>
                  <span>{currencySymbol}{subtotal.toFixed(2)}</span>
                </div>
                {totalDiscount > 0 && (
                  <div className="flex justify-between text-sm text-success">
                    <span>Discount</span>
                    <span>-{currencySymbol}{totalDiscount.toFixed(2)}</span>
                  </div>
                )}
                {totalTax > 0 && (
                  <div className="flex justify-between text-sm">
                    <span>Tax</span>
                    <span>{currencySymbol}{totalTax.toFixed(2)}</span>
                  </div>
                )}
                <div className="flex justify-between font-bold text-lg pt-2 border-t">
                  <span>Total</span>
                  <span>{currencySymbol}{total.toFixed(2)}</span>
                </div>
              </div>

              <div className="flex gap-3">
                <Button 
                  variant="outline" 
                  className="flex-1"
                  onClick={() => handleSubmit(true)} 
                  disabled={isCreating || !customerId}
                >
                  {isCreating ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : (
                    <Save className="mr-2 h-4 w-4" />
                  )}
                  Save as Draft
                </Button>
                <Button 
                  className="flex-1"
                  onClick={handleSaveAndSend} 
                  disabled={isCreating || isIssuing || !customerId}
                >
                  {(isCreating || isIssuing) ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : (
                    <Send className="mr-2 h-4 w-4" />
                  )}
                  Save & Send
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Preview */}
        {showPreview && (
          <Card className="sticky top-20 h-fit">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <FileText className="h-5 w-5" />
                Invoice Preview
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="p-4 bg-muted/50 rounded-lg space-y-4">
                <div className="flex justify-between">
                  <div>
                    <h3 className="font-bold text-lg">INVOICE</h3>
                    <p className="text-sm text-muted-foreground">Draft</p>
                  </div>
                  <div className="text-right">
                    <p className="text-sm text-muted-foreground">Issue Date</p>
                    <p className="font-medium">{format(new Date(), 'MMM d, yyyy')}</p>
                    <p className="text-sm text-muted-foreground mt-2">Due Date</p>
                    <p className="font-medium">{format(dueDate, 'MMM d, yyyy')}</p>
                  </div>
                </div>

                {selectedCustomer && (
                  <div className="pt-4 border-t">
                    <p className="text-sm text-muted-foreground">Bill To</p>
                    <p className="font-medium">{selectedCustomer.name}</p>
                    <p className="text-sm text-muted-foreground">{selectedCustomer.email}</p>
                    {selectedCustomer.address_line1 && (
                      <p className="text-sm text-muted-foreground">{selectedCustomer.address_line1}</p>
                    )}
                  </div>
                )}

                <div className="pt-4 border-t">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b">
                        <th className="text-left py-2">Item</th>
                        <th className="text-right py-2">Qty</th>
                        <th className="text-right py-2">Price</th>
                        <th className="text-right py-2">Total</th>
                      </tr>
                    </thead>
                    <tbody>
                      {items.map(item => (
                        <tr key={item.id} className="border-b">
                          <td className="py-2">{item.description || '-'}</td>
                          <td className="text-right py-2">{item.quantity}</td>
                          <td className="text-right py-2">{currencySymbol}{item.unit_price.toFixed(2)}</td>
                          <td className="text-right py-2">{currencySymbol}{calculateLineTotal(item).toFixed(2)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                <div className="pt-4 border-t space-y-2">
                  <div className="flex justify-between text-sm">
                    <span>Subtotal</span>
                    <span>{currencySymbol}{subtotal.toFixed(2)}</span>
                  </div>
                  {totalDiscount > 0 && (
                    <div className="flex justify-between text-sm text-success">
                      <span>Discount</span>
                      <span>-{currencySymbol}{totalDiscount.toFixed(2)}</span>
                    </div>
                  )}
                  {totalTax > 0 && (
                    <div className="flex justify-between text-sm">
                      <span>Tax</span>
                      <span>{currencySymbol}{totalTax.toFixed(2)}</span>
                    </div>
                  )}
                  <div className="flex justify-between font-bold text-lg pt-2 border-t">
                    <span>Total</span>
                    <span>{currencySymbol}{total.toFixed(2)}</span>
                  </div>
                </div>

                {terms && (
                  <div className="pt-4 border-t">
                    <p className="text-sm text-muted-foreground">Terms</p>
                    <p className="text-sm">{terms}</p>
                  </div>
                )}

                {notes && (
                  <div className="pt-2">
                    <p className="text-sm text-muted-foreground">Notes</p>
                    <p className="text-sm">{notes}</p>
                  </div>
                )}
              </div>
            </CardContent>
          </Card>
        )}
      </div>
    </AppLayout>
  );
}
