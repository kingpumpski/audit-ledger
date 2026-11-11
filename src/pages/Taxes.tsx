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
import { useTaxes, type Tax } from '@/hooks/useTaxes';
import { Plus, Loader2, Calculator, Pencil } from 'lucide-react';

const TAX_TYPES = [
  { value: 'vat', label: 'VAT' },
  { value: 'sales_tax', label: 'Sales Tax' },
  { value: 'service_tax', label: 'Service Tax' },
  { value: 'excise_tax', label: 'Excise Tax' },
  { value: 'custom', label: 'Custom' },
] as const;
type TaxType = (typeof TAX_TYPES)[number]['value'];

type TaxFormData = {
  name: string;
  code: string;
  rate: string;
  type: TaxType;
  is_compound: boolean;
  applies_to_category: string;
};

function isTaxType(value: string): value is TaxType {
  return TAX_TYPES.some(type => type.value === value);
}

export default function Taxes() {
  const { taxes, isLoading, createTax, updateTax, toggleTaxStatus, isCreating, isUpdating } = useTaxes();
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [editingTax, setEditingTax] = useState<Tax | null>(null);
  const [formData, setFormData] = useState<TaxFormData>({
    name: '',
    code: '',
    rate: '',
    type: 'vat' as TaxType,
    is_compound: false,
    applies_to_category: '',
  });

  const resetForm = () => {
    setFormData({
      name: '',
      code: '',
      rate: '',
      type: 'vat',
      is_compound: false,
      applies_to_category: '',
    });
    setEditingTax(null);
  };

  const handleOpenDialog = (tax?: Tax) => {
    if (tax) {
      setEditingTax(tax);
      setFormData({
        name: tax.name,
        code: tax.code,
        rate: tax.rate.toString(),
        type: tax.type,
        is_compound: tax.is_compound || false,
        applies_to_category: tax.applies_to_category || '',
      });
    } else {
      resetForm();
    }
    setIsDialogOpen(true);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    const taxData = {
      name: formData.name,
      code: formData.code.toUpperCase(),
      rate: parseFloat(formData.rate),
      type: formData.type,
      is_compound: formData.is_compound,
      applies_to_category: formData.applies_to_category || null,
    };

    if (editingTax) {
      await updateTax({ id: editingTax.id, ...taxData });
    } else {
      await createTax(taxData);
    }
    
    setIsDialogOpen(false);
    resetForm();
  };

  const getTypeBadgeColor = (type: string) => {
    switch (type) {
      case 'vat': return 'bg-primary/10 text-primary';
      case 'sales_tax': return 'bg-accent/10 text-accent';
      case 'service_tax': return 'bg-success/10 text-success';
      case 'excise_tax': return 'bg-warning/10 text-warning';
      default: return 'bg-muted text-muted-foreground';
    }
  };

  return (
    <AppLayout
      title="Tax Management"
      subtitle="Configure tax rates and rules"
      actions={
        <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
          <DialogTrigger asChild>
            <Button onClick={() => handleOpenDialog()}>
              <Plus className="mr-2 h-4 w-4" />
              Add Tax
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>{editingTax ? 'Edit Tax' : 'Add New Tax'}</DialogTitle>
              <DialogDescription>
                {editingTax ? 'Update the tax configuration.' : 'Create a new tax rate for your invoices.'}
              </DialogDescription>
            </DialogHeader>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="name">Tax Name</Label>
                  <Input
                    id="name"
                    value={formData.name}
                    onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                    placeholder="e.g. Standard VAT"
                    required
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="code">Tax Code</Label>
                  <Input
                    id="code"
                    value={formData.code}
                    onChange={(e) => setFormData({ ...formData, code: e.target.value })}
                    placeholder="e.g. VAT20"
                    required
                  />
                </div>
              </div>
              
              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="rate">Rate (%)</Label>
                  <Input
                    id="rate"
                    type="number"
                    step="0.01"
                    min="0"
                    max="100"
                    value={formData.rate}
                    onChange={(e) => setFormData({ ...formData, rate: e.target.value })}
                    placeholder="20"
                    required
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="type">Tax Type</Label>
                  <Select
                    value={formData.type}
                    onValueChange={(value) => {
                      if (isTaxType(value)) setFormData({ ...formData, type: value });
                    }}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Select type" />
                    </SelectTrigger>
                    <SelectContent>
                      {TAX_TYPES.map((type) => (
                        <SelectItem key={type.value} value={type.value}>
                          {type.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="category">Applies to Category (Optional)</Label>
                <Input
                  id="category"
                  value={formData.applies_to_category}
                  onChange={(e) => setFormData({ ...formData, applies_to_category: e.target.value })}
                  placeholder="e.g. Electronics, Services"
                />
              </div>

              <div className="flex items-center space-x-2">
                <Switch
                  id="compound"
                  checked={formData.is_compound}
                  onCheckedChange={(checked) => setFormData({ ...formData, is_compound: checked })}
                />
                <Label htmlFor="compound">Compound Tax (applied on top of other taxes)</Label>
              </div>

              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setIsDialogOpen(false)}>
                  Cancel
                </Button>
                <Button type="submit" disabled={isCreating || isUpdating}>
                  {(isCreating || isUpdating) && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                  {editingTax ? 'Update Tax' : 'Create Tax'}
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
          ) : taxes.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-64 text-center">
              <Calculator className="h-12 w-12 text-muted-foreground mb-4" />
              <h3 className="text-lg font-medium">No taxes configured</h3>
              <p className="text-muted-foreground mb-4">Add tax rates to apply them to your invoices.</p>
              <Button onClick={() => handleOpenDialog()}>
                <Plus className="mr-2 h-4 w-4" />
                Add First Tax
              </Button>
            </div>
          ) : (
            <table className="data-table">
              <thead>
                <tr>
                  <th>Tax Name</th>
                  <th>Code</th>
                  <th>Rate</th>
                  <th>Type</th>
                  <th>Category</th>
                  <th>Status</th>
                  <th className="w-20">Actions</th>
                </tr>
              </thead>
              <tbody>
                {taxes.map((tax) => (
                  <tr key={tax.id}>
                    <td className="font-medium">{tax.name}</td>
                    <td>
                      <code className="bg-muted px-1.5 py-0.5 rounded text-sm">{tax.code}</code>
                    </td>
                    <td className="font-semibold">{tax.rate}%</td>
                    <td>
                      <Badge className={getTypeBadgeColor(tax.type)}>
                        {tax.type.replace('_', ' ')}
                      </Badge>
                      {tax.is_compound && (
                        <Badge variant="outline" className="ml-1">Compound</Badge>
                      )}
                    </td>
                    <td className="text-muted-foreground">
                      {tax.applies_to_category || 'All'}
                    </td>
                    <td>
                      <Switch
                        checked={tax.is_active || false}
                        onCheckedChange={(checked) => toggleTaxStatus({ id: tax.id, isActive: checked })}
                      />
                    </td>
                    <td>
                      <Button variant="ghost" size="icon" onClick={() => handleOpenDialog(tax)}>
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
