import { useState, useEffect } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { AppLayout } from '@/components/layout/AppLayout';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Switch } from '@/components/ui/switch';
import { useCustomers } from '@/hooks/useCustomers';
import { useCustomerAccountBalances } from '@/hooks/useCustomerBalances';
import { useAuth } from '@/contexts/AuthContext';
import { useSettings } from '@/hooks/useSettings';
import { CustomerCreditManagement } from '@/components/customers/CustomerCreditManagement';
import { supabase } from '@/integrations/supabase/client';
import { useQuery } from '@tanstack/react-query';
import { 
  ArrowLeft, 
  Loader2, 
  Save, 
  Building2, 
  Mail, 
  Phone, 
  MapPin, 
  FileText, 
  Receipt,
  DollarSign,
  Calendar
} from 'lucide-react';
import { format } from 'date-fns';

export default function CustomerDetails() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { customers, updateCustomer, isUpdating } = useCustomers();
  const { roles } = useAuth();
  const canViewCustomerCredits = roles.some((role) => ['admin', 'accountant', 'auditor'].includes(role));
  const { settings } = useSettings();
  const currencySymbol = settings?.currency_symbol || String.fromCharCode(36);
  const customer = customers.find(c => c.id === id);
  const { balances: customerBalances, isLoading: isCustomerBalanceLoading, error: customerBalanceError } = useCustomerAccountBalances(format(new Date(), 'yyyy-MM-dd'), id || undefined);
  const currentOutstandingBalance = customerBalances[0]?.outstanding_balance ?? 0;

  const [formData, setFormData] = useState({
    name: '',
    email: '',
    phone: '',
    tax_id: '',
    address_line1: '',
    address_line2: '',
    city: '',
    state: '',
    postal_code: '',
    country: '',
    notes: '',
    credit_limit: '',
    is_active: true,
  });

  useEffect(() => {
    if (customer) {
      setFormData({
        name: customer.name,
        email: customer.email || '',
        phone: customer.phone || '',
        tax_id: customer.tax_id || '',
        address_line1: customer.address_line1 || '',
        address_line2: customer.address_line2 || '',
        city: customer.city || '',
        state: customer.state || '',
        postal_code: customer.postal_code || '',
        country: customer.country || '',
        notes: customer.notes || '',
        credit_limit: customer.credit_limit?.toString() || '',
        is_active: customer.is_active ?? true,
      });
    }
  }, [customer]);

  // Fetch customer invoices
  const invoicesQuery = useQuery({
    queryKey: ['customer-invoices', id],
    queryFn: async () => {
      if (!id) return [];
      const { data, error } = await supabase
        .from('invoices')
        .select('*')
        .eq('customer_id', id)
        .is('deleted_at', null)
        .order('created_at', { ascending: false })
        .limit(10);
      if (error) throw error;
      return data;
    },
    enabled: !!id,
  });

  // Fetch customer receipts
  const receiptsQuery = useQuery({
    queryKey: ['customer-receipts', id],
    queryFn: async () => {
      if (!id) return [];
      const { data, error } = await supabase
        .from('receipts')
        .select('*')
        .eq('customer_id', id)
        .is('deleted_at', null)
        .order('created_at', { ascending: false })
        .limit(10);
      if (error) throw error;
      return data;
    },
    enabled: !!id,
  });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!id) return;

    updateCustomer({
      id,
      name: formData.name,
      email: formData.email || null,
      phone: formData.phone || null,
      tax_id: formData.tax_id || null,
      address_line1: formData.address_line1 || null,
      address_line2: formData.address_line2 || null,
      city: formData.city || null,
      state: formData.state || null,
      postal_code: formData.postal_code || null,
      country: formData.country || null,
      notes: formData.notes || null,
      credit_limit: formData.credit_limit ? parseFloat(formData.credit_limit) : null,
      is_active: formData.is_active,
    });
  };

  const getInitials = (name: string) => {
    return name.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2);
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'paid': return 'bg-success/10 text-success';
      case 'issued': return 'bg-primary/10 text-primary';
      case 'overdue': return 'bg-destructive/10 text-destructive';
      case 'draft': return 'bg-muted text-muted-foreground';
      default: return 'bg-muted text-muted-foreground';
    }
  };

  if (!customer) {
    return (
      <AppLayout title="Customer Details" subtitle="">
        <div className="flex items-center justify-center h-64">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
        </div>
      </AppLayout>
    );
  }

  return (
    <AppLayout
      title=""
      subtitle=""
      actions={
        <Button variant="outline" onClick={() => navigate('/customers')}>
          <ArrowLeft className="mr-2 h-4 w-4" />
          Back to Customers
        </Button>
      }
    >
      <div className="space-y-6">
        {/* Customer Header */}
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-start gap-4">
              <Avatar className="h-16 w-16 border-2 border-primary/20">
                <AvatarFallback className="bg-primary/10 text-primary text-xl">
                  {getInitials(customer.name)}
                </AvatarFallback>
              </Avatar>
              <div className="flex-1">
                <div className="flex items-center gap-3">
                  <h1 className="text-2xl font-bold">{customer.name}</h1>
                  <Badge variant={customer.is_active ? 'default' : 'secondary'}>
                    {customer.is_active ? 'Active' : 'Inactive'}
                  </Badge>
                </div>
                <p className="text-muted-foreground">{customer.code}</p>
                <div className="flex gap-6 mt-3 text-sm">
                  {customer.email && (
                    <div className="flex items-center gap-1.5 text-muted-foreground">
                      <Mail className="h-4 w-4" />
                      {customer.email}
                    </div>
                  )}
                  {customer.phone && (
                    <div className="flex items-center gap-1.5 text-muted-foreground">
                      <Phone className="h-4 w-4" />
                      {customer.phone}
                    </div>
                  )}
                </div>
              </div>
              <div className="text-right">
                <p className="text-sm text-muted-foreground">Current Balance</p>
                <p className="text-2xl font-bold tabular-nums">
                  {isCustomerBalanceLoading ? 'Calculating…' : customerBalanceError ? 'Unavailable' : `${currencySymbol}${currentOutstandingBalance.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`}
                </p>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Tabs */}
        <Tabs defaultValue="details" className="space-y-4">
          <TabsList>
            <TabsTrigger value="details">Details</TabsTrigger>
            <TabsTrigger value="invoices">Invoices</TabsTrigger>
            <TabsTrigger value="receipts">Receipts</TabsTrigger>
            {canViewCustomerCredits && <TabsTrigger value="credits">Credits</TabsTrigger>}
          </TabsList>

          <TabsContent value="details">
            <Card>
              <CardHeader>
                <CardTitle>Customer Information</CardTitle>
                <CardDescription>Update customer details and settings</CardDescription>
              </CardHeader>
              <CardContent>
                <form onSubmit={handleSubmit} className="space-y-6">
                  {/* Basic Info */}
                  <div>
                    <h3 className="text-sm font-medium mb-3 flex items-center gap-2">
                      <Building2 className="h-4 w-4" />
                      Basic Information
                    </h3>
                    <div className="grid gap-4 md:grid-cols-2">
                      <div className="space-y-2">
                        <Label htmlFor="name">Company/Customer Name</Label>
                        <Input
                          id="name"
                          value={formData.name}
                          onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                          required
                        />
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="tax_id">Tax ID</Label>
                        <Input
                          id="tax_id"
                          value={formData.tax_id}
                          onChange={(e) => setFormData({ ...formData, tax_id: e.target.value })}
                          placeholder="e.g. XX-XXXXXXX"
                        />
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="email">Email</Label>
                        <Input
                          id="email"
                          type="email"
                          value={formData.email}
                          onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                        />
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="phone">Phone</Label>
                        <Input
                          id="phone"
                          value={formData.phone}
                          onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
                        />
                      </div>
                    </div>
                  </div>

                  <Separator />

                  {/* Address */}
                  <div>
                    <h3 className="text-sm font-medium mb-3 flex items-center gap-2">
                      <MapPin className="h-4 w-4" />
                      Address
                    </h3>
                    <div className="grid gap-4 md:grid-cols-2">
                      <div className="space-y-2 md:col-span-2">
                        <Label htmlFor="address_line1">Address Line 1</Label>
                        <Input
                          id="address_line1"
                          value={formData.address_line1}
                          onChange={(e) => setFormData({ ...formData, address_line1: e.target.value })}
                        />
                      </div>
                      <div className="space-y-2 md:col-span-2">
                        <Label htmlFor="address_line2">Address Line 2</Label>
                        <Input
                          id="address_line2"
                          value={formData.address_line2}
                          onChange={(e) => setFormData({ ...formData, address_line2: e.target.value })}
                        />
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="city">City</Label>
                        <Input
                          id="city"
                          value={formData.city}
                          onChange={(e) => setFormData({ ...formData, city: e.target.value })}
                        />
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="state">State/Province</Label>
                        <Input
                          id="state"
                          value={formData.state}
                          onChange={(e) => setFormData({ ...formData, state: e.target.value })}
                        />
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="postal_code">Postal Code</Label>
                        <Input
                          id="postal_code"
                          value={formData.postal_code}
                          onChange={(e) => setFormData({ ...formData, postal_code: e.target.value })}
                        />
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="country">Country</Label>
                        <Input
                          id="country"
                          value={formData.country}
                          onChange={(e) => setFormData({ ...formData, country: e.target.value })}
                        />
                      </div>
                    </div>
                  </div>

                  <Separator />

                  {/* Financial */}
                  <div>
                    <h3 className="text-sm font-medium mb-3 flex items-center gap-2">
                      <DollarSign className="h-4 w-4" />
                      Financial Settings
                    </h3>
                    <div className="grid gap-4 md:grid-cols-2">
                      <div className="space-y-2">
                        <Label htmlFor="credit_limit">Credit Limit ($)</Label>
                        <Input
                          id="credit_limit"
                          type="number"
                          step="0.01"
                          min="0"
                          value={formData.credit_limit}
                          onChange={(e) => setFormData({ ...formData, credit_limit: e.target.value })}
                        />
                      </div>
                      <div className="flex items-center space-x-2 pt-6">
                        <Switch
                          id="is_active"
                          checked={formData.is_active}
                          onCheckedChange={(checked) => setFormData({ ...formData, is_active: checked })}
                        />
                        <Label htmlFor="is_active">Customer is active</Label>
                      </div>
                    </div>
                  </div>

                  <Separator />

                  {/* Notes */}
                  <div className="space-y-2">
                    <Label htmlFor="notes">Notes</Label>
                    <Textarea
                      id="notes"
                      value={formData.notes}
                      onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
                      rows={3}
                      placeholder="Internal notes about this customer..."
                    />
                  </div>

                  <Button type="submit" disabled={isUpdating}>
                    {isUpdating ? (
                      <>
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        Saving...
                      </>
                    ) : (
                      <>
                        <Save className="mr-2 h-4 w-4" />
                        Save Changes
                      </>
                    )}
                  </Button>
                </form>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="invoices">
            <Card>
              <CardHeader className="flex flex-row items-center justify-between">
                <div>
                  <CardTitle className="flex items-center gap-2">
                    <FileText className="h-5 w-5" />
                    Recent Invoices
                  </CardTitle>
                  <CardDescription>Last 10 invoices for this customer</CardDescription>
                </div>
                <Button asChild>
                  <Link to={`/invoices/new?customer=${id}`}>
                    Create Invoice
                  </Link>
                </Button>
              </CardHeader>
              <CardContent>
                {invoicesQuery.isLoading ? (
                  <div className="flex justify-center py-8">
                    <Loader2 className="h-6 w-6 animate-spin" />
                  </div>
                ) : invoicesQuery.data?.length === 0 ? (
                  <p className="text-center text-muted-foreground py-8">No invoices yet</p>
                ) : (
                  <table className="data-table">
                    <thead>
                      <tr>
                        <th>Invoice #</th>
                        <th>Date</th>
                        <th>Amount</th>
                        <th>Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {invoicesQuery.data?.map((invoice) => (
                        <tr key={invoice.id}>
                          <td className="font-medium">{invoice.invoice_number}</td>
                          <td className="text-muted-foreground">
                            {invoice.issue_date ? format(new Date(invoice.issue_date), 'MMM d, yyyy') : '-'}
                          </td>
                          <td>${(invoice.total_amount || 0).toLocaleString()}</td>
                          <td>
                            <Badge className={getStatusBadge(invoice.status)}>
                              {invoice.status}
                            </Badge>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="receipts">
            <Card>
              <CardHeader className="flex flex-row items-center justify-between">
                <div>
                  <CardTitle className="flex items-center gap-2">
                    <Receipt className="h-5 w-5" />
                    Recent Receipts
                  </CardTitle>
                  <CardDescription>Last 10 receipts for this customer</CardDescription>
                </div>
                <Button asChild>
                  <Link to={`/receipts/new?customer=${id}`}>
                    Issue Receipt
                  </Link>
                </Button>
              </CardHeader>
              <CardContent>
                {receiptsQuery.isLoading ? (
                  <div className="flex justify-center py-8">
                    <Loader2 className="h-6 w-6 animate-spin" />
                  </div>
                ) : receiptsQuery.data?.length === 0 ? (
                  <p className="text-center text-muted-foreground py-8">No receipts yet</p>
                ) : (
                  <table className="data-table">
                    <thead>
                      <tr>
                        <th>Receipt #</th>
                        <th>Date</th>
                        <th>Amount</th>
                        <th>Method</th>
                        <th>Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {receiptsQuery.data?.map((receipt) => (
                        <tr key={receipt.id}>
                          <td className="font-medium">{receipt.receipt_number}</td>
                          <td className="text-muted-foreground">
                            {format(new Date(receipt.issue_date), 'MMM d, yyyy')}
                          </td>
                          <td>${receipt.amount.toLocaleString()}</td>
                          <td className="capitalize">{receipt.payment_method.replace('_', ' ')}</td>
                          <td>
                            <Badge className={receipt.status === 'issued' ? 'bg-success/10 text-success' : 'bg-destructive/10 text-destructive'}>
                              {receipt.status}
                            </Badge>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {canViewCustomerCredits && <TabsContent value="credits">
            <CustomerCreditManagement customerId={customer.id} customerName={customer.name} currencySymbol={currencySymbol} />
          </TabsContent>}
        </Tabs>
      </div>
    </AppLayout>
  );
}
