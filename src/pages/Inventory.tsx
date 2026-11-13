import { useState, useMemo } from 'react';
import { AppLayout } from '@/components/layout/AppLayout';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from '@/components/ui/dialog';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { useProducts } from '@/hooks/useProducts';
import { useSettings } from '@/hooks/useSettings';
import { supabase } from '@/integrations/supabase/client';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useToast } from '@/hooks/use-toast';
import {
  Package, Search, Plus, ArrowUpDown, Loader2, TrendingUp, TrendingDown, AlertTriangle, Boxes
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { format } from 'date-fns';
import { type Product } from '@/hooks/useProducts';

export default function Inventory() {
  const { products, updateProduct, isUpdating } = useProducts();
  const { settings } = useSettings();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [searchQuery, setSearchQuery] = useState('');
  const [isAdjustOpen, setIsAdjustOpen] = useState(false);
  const [selectedProduct, setSelectedProduct] = useState<Product | null>(null);
  const [adjustForm, setAdjustForm] = useState({
    type: 'adjustment' as string,
    quantity: 0,
    notes: '',
    unitCost: 0,
    openingUnitCost: 0,
    supplierName: '',
    referenceNumber: '',
    amountPaid: 0,
    paymentMethod: 'cash' as 'cash' | 'credit_card' | 'debit_card' | 'bank_transfer' | 'check' | 'mobile_payment' | 'other',
  });

  const currencySymbol = settings?.currency_symbol || '$';

  // Fetch recent inventory transactions
  const { data: transactions = [] } = useQuery({
    queryKey: ['inventory-transactions'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('inventory_transactions')
        .select('*, product:products(name, sku)')
        .order('created_at', { ascending: false })
        .limit(50);
      if (error) throw error;
      return data;
    },
  });

  const physicalProducts = useMemo(() =>
    products.filter(p => !p.is_service && p.deleted_at === null),
    [products]
  );

  const filteredProducts = useMemo(() =>
    physicalProducts.filter(p =>
      p.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      p.sku.toLowerCase().includes(searchQuery.toLowerCase())
    ),
    [physicalProducts, searchQuery]
  );

  const lowStockCount = physicalProducts.filter(p =>
    p.stock_quantity !== null && p.min_stock_level !== null && p.stock_quantity <= p.min_stock_level
  ).length;

  const totalStockValue = physicalProducts.reduce((sum, p) =>
    sum + (p.cost_price_verified ? (p.stock_quantity || 0) * Number(p.cost_price || 0) : 0), 0
  );
  const uncostedStockCount = physicalProducts.filter(p =>
    (p.stock_quantity || 0) > 0 && !p.cost_price_verified
  ).length;

  const recordAdjustment = useMutation({
    mutationFn: async () => {
      if (!selectedProduct) return;
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not authenticated');

      if (adjustForm.type === 'purchase') {
        const { error } = await supabase.rpc('record_stock_purchase', {
          p_product_id: selectedProduct.id,
          p_quantity: adjustForm.quantity,
          p_unit_cost: adjustForm.unitCost,
          p_opening_unit_cost: (selectedProduct.stock_quantity || 0) > 0 && !selectedProduct.cost_price_verified ? adjustForm.openingUnitCost : null,
          p_supplier_name: adjustForm.supplierName || null,
          p_reference_number: adjustForm.referenceNumber || null,
          p_amount_paid: adjustForm.amountPaid,
          p_payment_method: adjustForm.paymentMethod,
          p_notes: adjustForm.notes || null,
        });
        if (error) throw error;
        return;
      }

      throw new Error('Manual stock changes are temporarily disabled. Use a documented stock purchase; sales must be recorded through invoices, and returns/losses require an audited inventory workflow.');
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['products'] });
      queryClient.invalidateQueries({ queryKey: ['inventory-transactions'] });
      queryClient.invalidateQueries({ queryKey: ['journal-ledger-entries'] });
      toast({ title: 'Stock purchase recorded with verified actual cost' });
      setIsAdjustOpen(false);
      setSelectedProduct(null);
      setAdjustForm({ type: 'adjustment', quantity: 0, notes: '', unitCost: 0, openingUnitCost: 0, supplierName: '', referenceNumber: '', amountPaid: 0, paymentMethod: 'cash' });
    },
    onError: (error) => {
      toast({ title: 'Failed to update stock', description: error.message, variant: 'destructive' });
    },
  });

  return (
    <AppLayout title="Inventory Management" subtitle="Track and manage product stock levels">
      {/* Stats */}
      <div className="grid gap-4 md:grid-cols-4 mb-6">
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-primary/10">
                <Boxes className="h-5 w-5 text-primary" />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Total Products</p>
                <p className="text-2xl font-bold">{physicalProducts.length}</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-warning/10">
                <AlertTriangle className="h-5 w-5 text-warning" />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Low Stock</p>
                <p className="text-2xl font-bold">{lowStockCount}</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-success/10">
                <TrendingUp className="h-5 w-5 text-success" />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Verified Stock Value</p>
                <p className="text-2xl font-bold">{currencySymbol}{totalStockValue.toLocaleString(undefined, { maximumFractionDigits: 0 })}</p>
                {uncostedStockCount > 0 && <p className="mt-1 text-xs text-warning">{uncostedStockCount} product(s) need an actual purchase cost</p>}
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-info/10">
                <ArrowUpDown className="h-5 w-5 text-info" />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Recent Transactions</p>
                <p className="text-2xl font-bold">{transactions.length}</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        {/* Stock Levels */}
        <div className="lg:col-span-2">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle>Stock Levels</CardTitle>
              <div className="relative w-64">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input placeholder="Search products..." className="pl-9" value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} />
              </div>
            </CardHeader>
            <CardContent className="p-0">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Product</th>
                    <th>Stock</th>
                    <th>Min Level</th>
                    <th>Value</th>
                    <th>Status</th>
                    <th className="w-20">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredProducts.map(product => {
                    const isLow = product.stock_quantity !== null && product.min_stock_level !== null && product.stock_quantity <= product.min_stock_level;
                    return (
                      <tr key={product.id}>
                        <td>
                          <div>
                            <p className="font-medium">{product.name}</p>
                            <p className="text-xs text-muted-foreground">{product.sku}</p>
                          </div>
                        </td>
                        <td className={cn('font-medium', isLow && 'text-warning')}>{product.stock_quantity ?? 0}</td>
                        <td className="text-muted-foreground">{product.min_stock_level ?? '—'}</td>
                        <td>{product.cost_price_verified
                          ? `${currencySymbol}${((product.stock_quantity || 0) * Number(product.cost_price || 0)).toLocaleString(undefined, { maximumFractionDigits: 0 })}`
                          : <span className="text-warning text-xs">Cost not verified</span>}</td>
                        <td>
                          {isLow ? (
                            <Badge variant="destructive" className="bg-warning/10 text-warning border-warning/20">Low Stock</Badge>
                          ) : (
                            <Badge variant="secondary" className="bg-success/10 text-success">In Stock</Badge>
                          )}
                        </td>
                        <td>
                          <Button size="sm" variant="outline" onClick={() => { setSelectedProduct(product); setAdjustForm({ type: 'adjustment', quantity: 0, notes: '', unitCost: product.cost_price_verified ? Number(product.cost_price || 0) : 0, openingUnitCost: 0, supplierName: '', referenceNumber: '', amountPaid: 0, paymentMethod: 'cash' }); setIsAdjustOpen(true); }}>
                            <ArrowUpDown className="h-3 w-3 mr-1" />
                            Adjust
                          </Button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              {filteredProducts.length === 0 && (
                <div className="py-12 text-center text-muted-foreground">
                  <Package className="h-8 w-8 mx-auto mb-2 opacity-50" />
                  No physical products found
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Recent Transactions */}
        <Card>
          <CardHeader>
            <CardTitle>Recent Activity</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 max-h-[500px] overflow-y-auto">
            {transactions.slice(0, 20).map(tx => (
              <div key={tx.id} className="flex items-start gap-3 pb-3 border-b last:border-0">
                <div className={cn('p-1.5 rounded',
                  tx.type === 'purchase' || tx.type === 'return' ? 'bg-success/10' : 'bg-warning/10'
                )}>
                  {tx.type === 'purchase' || tx.type === 'return' ? (
                    <TrendingUp className="h-3.5 w-3.5 text-success" />
                  ) : (
                    <TrendingDown className="h-3.5 w-3.5 text-warning" />
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate">{tx.product?.name || 'Unknown'}</p>
                  <p className="text-xs text-muted-foreground capitalize">{tx.type}: {tx.quantity} units</p>
                  <p className="text-xs text-muted-foreground">{format(new Date(tx.created_at), 'MMM d, h:mm a')}</p>
                </div>
              </div>
            ))}
            {transactions.length === 0 && (
              <p className="text-sm text-muted-foreground text-center py-4">No transactions yet</p>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Adjust Stock Dialog */}
      <Dialog open={isAdjustOpen} onOpenChange={setIsAdjustOpen}>
        <DialogContent className="flex max-h-[85dvh] flex-col overflow-hidden">
          <DialogHeader>
            <DialogTitle>Record Stock Purchase - {selectedProduct?.name}</DialogTitle>
            <DialogDescription>
              Current stock: {selectedProduct?.stock_quantity ?? 0} units
            </DialogDescription>
          </DialogHeader>
          <div className="min-h-0 flex-1 space-y-4 overflow-y-auto overscroll-contain py-4 pr-2">
            <div className="rounded-md border border-warning/40 bg-warning/5 p-3 text-sm text-muted-foreground">
              Only evidenced stock purchases can currently change inventory from this screen. Sales must be posted through invoices so revenue and cost of goods sold stay linked. Returns, damage and count adjustments will be enabled after their audited accounting workflows are implemented.
            </div>
            <div className="space-y-2">
              <Label>Purchase Quantity</Label>
              <Input
                type="number"
                min="0"
                value={adjustForm.quantity || ''}
                onChange={e => setAdjustForm({ ...adjustForm, quantity: parseInt(e.target.value) || 0 })}
              />
            </div>
            {adjustForm.type === 'purchase' && (
              <>
                <div className="rounded-md border border-warning/40 bg-warning/5 p-3 text-sm text-muted-foreground">
                  Enter the supplier's actual unit purchase cost. This purchase will update the product's weighted-average cost and post Inventory against Cash/Bank and Accounts Payable.
                  {(selectedProduct?.stock_quantity || 0) > 0 && !selectedProduct?.cost_price_verified && (
                    <div className="mt-3 space-y-2">
                      <p className="font-medium text-warning">Existing stock needs an opening valuation before this purchase can be posted.</p>
                      <Label>Actual unit cost of existing stock ({currencySymbol}) *</Label>
                      <Input type="number" min="0" step="0.0001" value={adjustForm.openingUnitCost || ''} onChange={e => setAdjustForm({ ...adjustForm, openingUnitCost: Number(e.target.value) || 0 })} />
                      <p className="text-xs text-muted-foreground">This value is recorded once as opening Inventory against Owner's Equity. The new purchase is then blended into the weighted-average cost.</p>
                    </div>
                  )}
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-2">
                    <Label>Actual Unit Cost ({currencySymbol}) *</Label>
                    <Input type="number" min="0" step="0.0001" value={adjustForm.unitCost || ''} onChange={e => setAdjustForm({ ...adjustForm, unitCost: Number(e.target.value) || 0 })} />
                  </div>
                  <div className="space-y-2">
                    <Label>Amount Paid ({currencySymbol})</Label>
                    <Input type="number" min="0" step="0.01" value={adjustForm.amountPaid || ''} onChange={e => setAdjustForm({ ...adjustForm, amountPaid: Number(e.target.value) || 0 })} />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-2">
                    <Label>Supplier</Label>
                    <Input value={adjustForm.supplierName} onChange={e => setAdjustForm({ ...adjustForm, supplierName: e.target.value })} placeholder="Supplier name (optional)" />
                  </div>
                  <div className="space-y-2">
                    <Label>Supplier Reference *</Label>
                    <Input value={adjustForm.referenceNumber} onChange={e => setAdjustForm({ ...adjustForm, referenceNumber: e.target.value })} placeholder="Required invoice / receipt reference" />
                  </div>
                </div>
                <div className="space-y-2">
                  <Label>Payment Method</Label>
                  <Select value={adjustForm.paymentMethod} onValueChange={v => setAdjustForm({ ...adjustForm, paymentMethod: v as typeof adjustForm.paymentMethod })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="cash">Cash</SelectItem>
                      <SelectItem value="mobile_payment">Mobile Money</SelectItem>
                      <SelectItem value="bank_transfer">Bank Transfer</SelectItem>
                      <SelectItem value="credit_card">Credit Card</SelectItem>
                      <SelectItem value="debit_card">Debit Card</SelectItem>
                      <SelectItem value="check">Cheque</SelectItem>
                      <SelectItem value="other">Other</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </>
            )}
            <div className="space-y-2">
              <Label>Notes</Label>
              <Textarea
                value={adjustForm.notes}
                onChange={e => setAdjustForm({ ...adjustForm, notes: e.target.value })}
                placeholder="Purchase details and supporting notes..."
                rows={2}
              />
            </div>
            <div className="sticky bottom-0 z-10 flex shrink-0 justify-end gap-3 border-t bg-background pt-4">
              <Button variant="outline" onClick={() => setIsAdjustOpen(false)}>Cancel</Button>
              <Button onClick={() => recordAdjustment.mutate()} disabled={
                recordAdjustment.isPending || adjustForm.quantity <= 0 ||
                (adjustForm.type === 'purchase' && (
                  adjustForm.unitCost <= 0 ||
                  !adjustForm.referenceNumber.trim() ||
                  adjustForm.amountPaid > adjustForm.quantity * adjustForm.unitCost ||
                  ((selectedProduct?.stock_quantity || 0) > 0 && !selectedProduct?.cost_price_verified && adjustForm.openingUnitCost <= 0)
                ))
              }>
                {recordAdjustment.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                Record Purchase
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </AppLayout>
  );
}
