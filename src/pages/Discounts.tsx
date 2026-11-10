import { useState } from 'react';
import { AppLayout } from '@/components/layout/AppLayout';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useDiscounts } from '@/hooks/useDiscounts';
import { useCurrency } from '@/contexts/CurrencyContext';
import { Plus, Loader2, Percent, Pencil, DollarSign } from 'lucide-react';
import { format } from 'date-fns';

export default function Discounts() {
  const { discounts, isLoading, createDiscount, updateDiscount, toggleDiscountStatus, isCreating, isUpdating } = useDiscounts();
  const { currencySymbol, formatCurrency } = useCurrency();
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [editingDiscount, setEditingDiscount] = useState<any>(null);
  const [formData, setFormData] = useState({
    name: '',
    code: '',
    value: '',
    type: 'percentage' as 'fixed' | 'percentage',
    min_order_amount: '',
    max_discount_amount: '',
    usage_limit: '',
    valid_from: '',
    valid_to: '',
  });

  const resetForm = () => {
    setFormData({
      name: '',
      code: '',
      value: '',
      type: 'percentage',
      min_order_amount: '',
      max_discount_amount: '',
      usage_limit: '',
      valid_from: '',
      valid_to: '',
    });
    setEditingDiscount(null);
  };

  const handleOpenDialog = (discount?: any) => {
    if (discount) {
      setEditingDiscount(discount);
      setFormData({
        name: discount.name,
        code: discount.code,
        value: discount.value.toString(),
        type: discount.type,
        min_order_amount: discount.min_order_amount?.toString() || '',
        max_discount_amount: discount.max_discount_amount?.toString() || '',
        usage_limit: discount.usage_limit?.toString() || '',
        valid_from: discount.valid_from ? format(new Date(discount.valid_from), 'yyyy-MM-dd') : '',
        valid_to: discount.valid_to ? format(new Date(discount.valid_to), 'yyyy-MM-dd') : '',
      });
    } else {
      resetForm();
    }
    setIsDialogOpen(true);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    const discountData = {
      name: formData.name,
      code: formData.code.toUpperCase(),
      value: parseFloat(formData.value),
      type: formData.type,
      min_order_amount: formData.min_order_amount ? parseFloat(formData.min_order_amount) : null,
      max_discount_amount: formData.max_discount_amount ? parseFloat(formData.max_discount_amount) : null,
      usage_limit: formData.usage_limit ? parseInt(formData.usage_limit) : null,
      valid_from: formData.valid_from || null,
      valid_to: formData.valid_to || null,
    };

    if (editingDiscount) {
      await updateDiscount({ id: editingDiscount.id, ...discountData });
    } else {
      await createDiscount(discountData);
    }
    
    setIsDialogOpen(false);
    resetForm();
  };

  const formatDiscountValue = (discount: any) => {
    if (discount.type === 'percentage') {
      return `${discount.value}%`;
    }
    return `${currencySymbol}${discount.value.toFixed(2)}`;
  };

  const isExpired = (discount: any) => {
    if (!discount.valid_to) return false;
    return new Date(discount.valid_to) < new Date();
  };

  const isUpcoming = (discount: any) => {
    if (!discount.valid_from) return false;
    return new Date(discount.valid_from) > new Date();
  };

  return (
    <AppLayout
      title="Discount Management"
      subtitle="Configure discounts and promotions"
      actions={
        <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
          <DialogTrigger asChild>
            <Button onClick={() => handleOpenDialog()}>
              <Plus className="mr-2 h-4 w-4" />
              Add Discount
            </Button>
          </DialogTrigger>
          <DialogContent className="max-w-lg">
            <DialogHeader>
              <DialogTitle>{editingDiscount ? 'Edit Discount' : 'Add New Discount'}</DialogTitle>
              <DialogDescription>
                {editingDiscount ? 'Update the discount configuration.' : 'Create a new discount code.'}
              </DialogDescription>
            </DialogHeader>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="name">Discount Name</Label>
                  <Input
                    id="name"
                    value={formData.name}
                    onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                    placeholder="e.g. Summer Sale"
                    required
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="code">Discount Code</Label>
                  <Input
                    id="code"
                    value={formData.code}
                    onChange={(e) => setFormData({ ...formData, code: e.target.value })}
                    placeholder="e.g. SUMMER20"
                    required
                  />
                </div>
              </div>
              
              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="type">Discount Type</Label>
                  <Select
                    value={formData.type}
                    onValueChange={(value: 'fixed' | 'percentage') => setFormData({ ...formData, type: value })}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Select type" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="percentage">
                        <div className="flex items-center gap-2">
                          <Percent className="h-4 w-4" />
                          Percentage
                        </div>
                      </SelectItem>
                      <SelectItem value="fixed">
                        <div className="flex items-center gap-2">
                          <DollarSign className="h-4 w-4" />
                          Fixed Amount
                        </div>
                      </SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="value">
                    Value {formData.type === 'percentage' ? '(%)' : `(${currencySymbol})`}
                  </Label>
                  <Input
                    id="value"
                    type="number"
                    step="0.01"
                    min="0"
                    max={formData.type === 'percentage' ? '100' : undefined}
                    value={formData.value}
                    onChange={(e) => setFormData({ ...formData, value: e.target.value })}
                    placeholder={formData.type === 'percentage' ? '20' : '50.00'}
                    required
                  />
                </div>
              </div>

              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="min_order">Min Order Amount ({currencySymbol})</Label>
                  <Input
                    id="min_order"
                    type="number"
                    step="0.01"
                    min="0"
                    value={formData.min_order_amount}
                    onChange={(e) => setFormData({ ...formData, min_order_amount: e.target.value })}
                    placeholder="100.00"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="max_discount">Max Discount Amount ({currencySymbol})</Label>
                  <Input
                    id="max_discount"
                    type="number"
                    step="0.01"
                    min="0"
                    value={formData.max_discount_amount}
                    onChange={(e) => setFormData({ ...formData, max_discount_amount: e.target.value })}
                    placeholder="50.00"
                  />
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="usage_limit">Usage Limit</Label>
                <Input
                  id="usage_limit"
                  type="number"
                  min="0"
                  value={formData.usage_limit}
                  onChange={(e) => setFormData({ ...formData, usage_limit: e.target.value })}
                  placeholder="Leave empty for unlimited"
                />
              </div>

              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="valid_from">Valid From</Label>
                  <Input
                    id="valid_from"
                    type="date"
                    value={formData.valid_from}
                    onChange={(e) => setFormData({ ...formData, valid_from: e.target.value })}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="valid_to">Valid Until</Label>
                  <Input
                    id="valid_to"
                    type="date"
                    value={formData.valid_to}
                    onChange={(e) => setFormData({ ...formData, valid_to: e.target.value })}
                  />
                </div>
              </div>

              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setIsDialogOpen(false)}>
                  Cancel
                </Button>
                <Button type="submit" disabled={isCreating || isUpdating}>
                  {(isCreating || isUpdating) && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                  {editingDiscount ? 'Update Discount' : 'Create Discount'}
                </Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      }
    >
      <Card>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="flex items-center justify-center h-64">
              <Loader2 className="h-8 w-8 animate-spin text-primary" />
            </div>
          ) : discounts.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-64 text-center">
              <Percent className="h-12 w-12 text-muted-foreground mb-4" />
              <h3 className="text-lg font-medium">No discounts configured</h3>
              <p className="text-muted-foreground mb-4">Add discount codes to apply them to invoices.</p>
              <Button onClick={() => handleOpenDialog()}>
                <Plus className="mr-2 h-4 w-4" />
                Add First Discount
              </Button>
            </div>
          ) : (
            <table className="data-table">
              <thead>
                <tr>
                  <th>Discount</th>
                  <th>Code</th>
                  <th>Value</th>
                  <th>Usage</th>
                  <th>Validity</th>
                  <th>Status</th>
                  <th className="w-20">Actions</th>
                </tr>
              </thead>
              <tbody>
                {discounts.map((discount) => (
                  <tr key={discount.id}>
                    <td className="font-medium">{discount.name}</td>
                    <td>
                      <code className="bg-muted px-1.5 py-0.5 rounded text-sm">{discount.code}</code>
                    </td>
                    <td>
                      <Badge className={discount.type === 'percentage' ? 'bg-primary/10 text-primary' : 'bg-accent/10 text-accent'}>
                        {formatDiscountValue(discount)}
                      </Badge>
                    </td>
                    <td className="text-muted-foreground">
                      {discount.times_used || 0}
                      {discount.usage_limit ? ` / ${discount.usage_limit}` : ' (unlimited)'}
                    </td>
                    <td className="text-sm">
                      {isExpired(discount) ? (
                        <Badge variant="destructive">Expired</Badge>
                      ) : isUpcoming(discount) ? (
                        <Badge variant="secondary">Upcoming</Badge>
                      ) : discount.valid_from || discount.valid_to ? (
                        <span className="text-muted-foreground">
                          {discount.valid_from && format(new Date(discount.valid_from), 'MMM d')}
                          {discount.valid_from && discount.valid_to && ' - '}
                          {discount.valid_to && format(new Date(discount.valid_to), 'MMM d, yyyy')}
                        </span>
                      ) : (
                        <span className="text-muted-foreground">Always valid</span>
                      )}
                    </td>
                    <td>
                      <Switch
                        checked={discount.is_active || false}
                        onCheckedChange={(checked) => toggleDiscountStatus({ id: discount.id, isActive: checked })}
                      />
                    </td>
                    <td>
                      <Button variant="ghost" size="icon" onClick={() => handleOpenDialog(discount)}>
                        <Pencil className="h-4 w-4" />
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>
    </AppLayout>
  );
}
