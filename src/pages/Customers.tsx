import { useState } from 'react';
import { AppLayout } from '@/components/layout/AppLayout';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { useCustomers } from '@/hooks/useCustomers';
import { useCustomerAccountBalances } from '@/hooks/useCustomerBalances';
import { format } from 'date-fns';
import { useCurrency } from '@/contexts/CurrencyContext';
import { Plus, Search, Loader2, Mail, Phone, Eye, Trash2, Edit, Download } from 'lucide-react';
import { Link } from 'react-router-dom';

export default function Customers() {
  const { customers, isLoading, createCustomer, updateCustomerAsync, deleteCustomer, isCreating } = useCustomers();
  const { formatCurrency } = useCurrency();
  const [searchQuery, setSearchQuery] = useState('');
  const [asOfDate, setAsOfDate] = useState(() => format(new Date(), 'yyyy-MM-dd'));
  const { balances, isLoading: isBalanceLoading, error: balancesError } = useCustomerAccountBalances(asOfDate);
  const balancesByCustomer = new Map(balances.map(balance => [balance.customer_id, balance.outstanding_balance]));
  const totalOutstanding = balances.reduce((total, balance) => total + balance.outstanding_balance, 0);
  const handleExportBalances = () => {
    if (balancesError || isBalanceLoading) return;
    const cell = (value: string | number) => `"${String(value).replace(/"/g, '""')}"`;
    const rows = [
      ['Customer Code', 'Customer Name', 'Invoiced', 'Payments Received', 'Credit Notes Applied', 'Customer Credits Applied', 'Outstanding Balance', 'As At'],
      ...balances.map(balance => [
        balance.customer_code,
        balance.customer_name,
        balance.invoiced_amount.toFixed(2),
        balance.payments_received.toFixed(2),
        balance.credit_notes_applied.toFixed(2),
        balance.customer_credits_applied.toFixed(2),
        balance.outstanding_balance.toFixed(2),
        balance.as_of_date,
      ]),
    ];
    const csv = rows.map(row => row.map(cell).join(',')).join('\\r\\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `customer-balances-as-at-${asOfDate}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [editingCustomer, setEditingCustomer] = useState<(typeof customers)[number] | null>(null);
  const [isSavingEdit, setIsSavingEdit] = useState(false);
  const [editFormData, setEditFormData] = useState({ name: '', email: '', phone: '' });
  const [formData, setFormData] = useState({
    name: '',
    email: '',
    phone: '',
  });

  const filteredCustomers = customers.filter(customer =>
    customer.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
    customer.code.toLowerCase().includes(searchQuery.toLowerCase()) ||
    (customer.email && customer.email.toLowerCase().includes(searchQuery.toLowerCase()))
  );

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    await createCustomer({
      name: formData.name,
      email: formData.email || null,
      phone: formData.phone || null,
    });
    setIsDialogOpen(false);
    setFormData({ name: '', email: '', phone: '' });
  };

  const openEditDialog = (customer: (typeof customers)[number]) => {
    setEditingCustomer(customer);
    setEditFormData({
      name: customer.name || '',
      email: customer.email || '',
      phone: customer.phone || '',
    });
  };

  const handleUpdateCustomer = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!editingCustomer || !editFormData.name.trim()) return;
    setIsSavingEdit(true);
    try {
      await updateCustomerAsync({
        id: editingCustomer.id,
        name: editFormData.name.trim(),
        email: editFormData.email.trim() || null,
        phone: editFormData.phone.trim() || null,
      });
      setEditingCustomer(null);
    } finally {
      setIsSavingEdit(false);
    }
  };

  const getInitials = (name: string) => {
    return name.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2);
  };

  return (
    <AppLayout
      title="Customers"
      subtitle="Manage your customer database"
      actions={
        <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
          <DialogTrigger asChild>
            <Button>
              <Plus className="mr-2 h-4 w-4" />
              Add Customer
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Add New Customer</DialogTitle>
              <DialogDescription>
                Create a new customer record. You can add more details later.
              </DialogDescription>
            </DialogHeader>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="name">Company/Customer Name *</Label>
                <Input
                  id="name"
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  placeholder="e.g. Acme Corporation"
                  required
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="email">Email</Label>
                <Input
                  id="email"
                  type="email"
                  value={formData.email}
                  onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                  placeholder="billing@example.com"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="phone">Phone</Label>
                <Input
                  id="phone"
                  value={formData.phone}
                  onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
                  placeholder="+1 555-0000"
                />
              </div>
              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setIsDialogOpen(false)}>
                  Cancel
                </Button>
                <Button type="submit" disabled={isCreating}>
                  {isCreating && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                  Create Customer
                </Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      }
    >
      <Card>
        <CardContent className="p-0">
          <div className="flex items-center gap-3 p-4 border-b">
            <div className="relative flex-1 max-w-sm">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input 
                placeholder="Search customers..." 
                className="pl-9" 
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
            </div>
            <div className="flex flex-col gap-1">
              <Label htmlFor="customer-balance-as-of" className="text-xs text-muted-foreground">Balances as at</Label>
              <Input
                id="customer-balance-as-of"
                type="date"
                className="w-[170px]"
                value={asOfDate}
                max={format(new Date(), 'yyyy-MM-dd')}
                onChange={(event) => setAsOfDate(event.target.value)}
              />
            </div>
            <div className="ml-auto text-right text-sm">
              <p className="text-muted-foreground">Total outstanding receivables</p>
              <p className="font-semibold tabular-nums">
                {isBalanceLoading ? 'Calculating…' : balancesError ? 'Unavailable' : formatCurrency(totalOutstanding)}
              </p>
              <p className="text-xs text-muted-foreground">{balancesError ? 'Balance report could not be loaded' : `${balances.filter(balance => balance.outstanding_balance > 0).length} customers owing`}</p>
            </div>
            <Button type="button" variant="outline" size="sm" onClick={handleExportBalances} disabled={isBalanceLoading || Boolean(balancesError)}>
              <Download className="mr-2 h-4 w-4" /> Export
            </Button>
          </div>

          {isLoading ? (
            <div className="flex items-center justify-center h-64">
              <Loader2 className="h-8 w-8 animate-spin text-primary" />
            </div>
          ) : filteredCustomers.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-64 text-center">
              <h3 className="text-lg font-medium">
                {searchQuery ? 'No customers found' : 'No customers yet'}
              </h3>
              <p className="text-muted-foreground mb-4">
                {searchQuery ? 'Try adjusting your search.' : 'Add your first customer to get started.'}
              </p>
              {!searchQuery && (
                <Button onClick={() => setIsDialogOpen(true)}>
                  <Plus className="mr-2 h-4 w-4" />
                  Add First Customer
                </Button>
              )}
            </div>
          ) : (
            <table className="data-table">
              <thead>
                <tr>
                  <th>Customer</th>
                  <th>Contact</th>
                  <th>Balance (as at date)</th>
                  <th>Status</th>
                  <th className="w-24">Actions</th>
                </tr>
              </thead>
              <tbody>
                {filteredCustomers.map((customer) => (
                  <tr key={customer.id}>
                    <td>
                      <div className="flex items-center gap-3">
                        <Avatar className="h-9 w-9">
                          <AvatarFallback className="bg-primary/10 text-primary text-xs">
                            {getInitials(customer.name)}
                          </AvatarFallback>
                        </Avatar>
                        <div>
                          <p className="font-medium">{customer.name}</p>
                          <p className="text-xs text-muted-foreground">{customer.code}</p>
                        </div>
                      </div>
                    </td>
                    <td>
                      <div className="space-y-1">
                        {customer.email && (
                          <div className="flex items-center gap-1.5 text-sm">
                            <Mail className="h-3.5 w-3.5 text-muted-foreground" />
                            {customer.email}
                          </div>
                        )}
                        {customer.phone && (
                          <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
                            <Phone className="h-3.5 w-3.5" />
                            {customer.phone}
                          </div>
                        )}
                        {!customer.email && !customer.phone && (
                          <span className="text-sm text-muted-foreground">No contact info</span>
                        )}
                      </div>
                    </td>
                    <td className="font-medium tabular-nums">{isBalanceLoading ? <span className="text-muted-foreground">Loading…</span> : balancesError ? <span className="text-destructive">Unavailable</span> : formatCurrency(balancesByCustomer.get(customer.id) ?? 0)}</td>
                    <td>
                      <Badge variant={customer.is_active ? 'default' : 'secondary'}>
                        {customer.is_active ? 'Active' : 'Inactive'}
                      </Badge>
                    </td>
                    <td>
                      <div className="flex gap-1">
                        <Button variant="ghost" size="icon" className="h-8 w-8" asChild>
                          <Link to={`/customers/${customer.id}`}>
                            <Eye className="h-4 w-4" />
                          </Link>
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8"
                          aria-label={`Edit ${customer.name}`}
                          title="Edit customer"
                          onClick={() => openEditDialog(customer)}
                        >
                          <Edit className="h-4 w-4" />
                        </Button>
                        <Button 
                          variant="ghost" 
                          size="icon" 
                          className="h-8 w-8 text-destructive hover:text-destructive"
                          onClick={() => {
                            if (confirm('Are you sure you want to delete this customer?')) {
                              deleteCustomer(customer.id);
                            }
                          }}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>

      <Dialog open={!!editingCustomer} onOpenChange={(open) => !open && setEditingCustomer(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit Customer</DialogTitle>
            <DialogDescription>Correct the customer details without creating a duplicate record.</DialogDescription>
          </DialogHeader>
          <form onSubmit={handleUpdateCustomer} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="edit-customer-name">Company/Customer Name *</Label>
              <Input id="edit-customer-name" value={editFormData.name} onChange={e => setEditFormData(v => ({ ...v, name: e.target.value }))} required />
            </div>
            <div className="space-y-2">
              <Label htmlFor="edit-customer-email">Email</Label>
              <Input id="edit-customer-email" type="email" value={editFormData.email} onChange={e => setEditFormData(v => ({ ...v, email: e.target.value }))} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="edit-customer-phone">Phone</Label>
              <Input id="edit-customer-phone" value={editFormData.phone} onChange={e => setEditFormData(v => ({ ...v, phone: e.target.value }))} />
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setEditingCustomer(null)}>Cancel</Button>
              <Button type="submit" disabled={isSavingEdit || !editFormData.name.trim()}>
                {isSavingEdit && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Save Changes
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </AppLayout>
  );
}
