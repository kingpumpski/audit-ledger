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
import { useAuth } from '@/contexts/AuthContext';
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
  const { products } = useProducts();
  const { roles } = useAuth();
  const canRecordInventoryDamage = roles.includes('admin') || roles.includes('accountant');
  const { settings } = useSettings();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [searchQuery, setSearchQuery] = useState('');
  const [isAdjustOpen, setIsAdjustOpen] = useState(false);
  const [isCountOpen, setIsCountOpen] = useState(false);
  const [countIdempotencyKey, setCountIdempotencyKey] = useState(() => crypto.randomUUID());
  const [countForm, setCountForm] = useState({
    countedQuantity: 0,
    countedOn: format(new Date(), 'yyyy-MM-dd'),
    reason: '',
    referenceNumber: '',
  });
  const [adjustIdempotencyKey, setAdjustIdempotencyKey] = useState(() => crypto.randomUUID());
  const [selectedProduct, setSelectedProduct] = useState<Product | null>(null);
  const [adjustForm, setAdjustForm] = useState({
    type: 'purchase' as 'purchase' | 'damage',
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

  const recordStockCount = useMutation({
    mutationFn: async () => {
      if (!selectedProduct) throw new Error('Select a product to reconcile.');
      if (!canRecordInventoryDamage) throw new Error('Only an admin or accountant can approve stock-count corrections.');
      if (!countForm.reason.trim() || !countForm.referenceNumber.trim()) {
        throw new Error('A count explanation and signed count-sheet/reference are required.');
      }
      const { error } = await supabase.rpc('record_stock_count_adjustment', {
        p_product_id: selectedProduct.id,
        p_counted_quantity: countForm.countedQuantity,
        p_counted_on: countForm.countedOn,
        p_reason: countForm.reason.trim(),
        p_reference_number: countForm.referenceNumber.trim(),
        p_idempotency_key: countIdempotencyKey,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['products'] });
      void queryClient.invalidateQueries({ queryKey: ['inventory-transactions'] });
      void queryClient.invalidateQueries({ queryKey: ['journal-ledger-entries'] });
      void queryClient.invalidateQueries({ queryKey: ['profit-loss-journal'] });
      toast({ title: 'Stock count reconciled', description: 'The verified variance was recorded in inventory history and the general ledger.' });
      setIsCountOpen(false);
      setSelectedProduct(null);
      setCountForm({ countedQuantity: 0, countedOn: format(new Date(), 'yyyy-MM-dd'), reason: '', referenceNumber: '' });
      setCountIdempotencyKey(crypto.randomUUID());
    },
    onError: error => toast({ title: 'Stock count was not posted', description: error.message, variant: 'destructive' }),
  });

  const recordAdjustment = useMutation({
    mutationFn: async () => {
      if (!selectedProduct) return;
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not authenticated');

      if (adjustForm.type === 'damage') {
        const { error } = await supabase.rpc('record_inventory_damage', {
          p_product_id: selectedProduct.id,
          p_quantity: adjustForm.quantity,
          p_reference_number: adjustForm.referenceNumber,
          p_idempotency_key: adjustIdempotencyKey,
          p_notes: adjustForm.notes || null,
        });
        if (error) throw error;
        return;
      }

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
        p_idempotency_key: adjustIdempotencyKey,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['products'] });
      queryClient.invalidateQueries({ queryKey: ['inventory-transactions'] });
      queryClient.invalidateQueries({ queryKey: ['journal-ledger-entries'] });
      queryClient.invalidateQueries({ queryKey: ['profit-loss-journal'] });
      toast({ title: adjustForm.type === 'damage' ? 'Stock damage recorded and posted to the ledger' : 'Stock purchase recorded with verified actual cost' });
      setIsAdjustOpen(false);
      setSelectedProduct(null);
      setAdjustForm({ type: 'purchase', quantity: 0, notes: '', unitCost: 0, openingUnitCost: 0, supplierName: '', referenceNumber: '', amountPaid: 0, paymentMethod: 'cash' });
      setAdjustIdempotencyKey(crypto.randomUUID());
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
                          <div className="flex flex-wrap gap-2">
                            <Button size="sm" variant="outline" onClick={() => { setSelectedProduct(product); setAdjustForm({ type: 'purchase', quantity: 0, notes: '', unitCost: product.cost_price_verified ? Number(product.cost_price || 0) : 0, openingUnitCost: 0, supplierName: '', referenceNumber: '', amountPaid: 0, paymentMethod: 'cash' }); setAdjustIdempotencyKey(crypto.randomUUID()); setIsAdjustOpen(true); }}>
                              <ArrowUpDown className="h-3 w-3 mr-1" />
                              Adjust
                            </Button>
                            {canRecordInventoryDamage && (
                              <Button size="sm" variant="secondary" onClick={() => {
                                setSelectedProduct(product);
                                setCountForm({ countedQuantity: product.stock_quantity || 0, countedOn: format(new Date(), 'yyyy-MM-dd'), reason: '', referenceNumber: '' });
                                setCountIdempotencyKey(crypto.randomUUID());
                                setIsCountOpen(true);
                              }}>
                                Count
                              </Button>
                            )}
                          </div>
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

      <Dialog open={isCountOpen} onOpenChange={setIsCountOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Reconcile Physical Stock Count</DialogTitle>
            <DialogDescription>
              {selectedProduct?.name}: system quantity is {selectedProduct?.stock_quantity ?? 0}. Enter the independently counted quantity; the difference will be valued at the verified weighted-average cost.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Physical quantity counted *</Label>
              <Input type="number" min="0" step="1" value={countForm.countedQuantity}
                onChange={e => setCountForm({ ...countForm, countedQuantity: Math.max(0, parseInt(e.target.value, 10) || 0) })} />
            </div>
            <div className="space-y-2">
              <Label>Count date *</Label>
              <Input type="date" max={format(new Date(), 'yyyy-MM-dd')} value={countForm.countedOn}
                onChange={e => setCountForm({ ...countForm, countedOn: e.target.value })} />
            </div>
            <div className="space-y-2">
              <Label>Signed count-sheet / approval reference *</Label>
              <Input value={countForm.referenceNumber} onChange={e => setCountForm({ ...countForm, referenceNumber: e.target.value })}
                placeholder="e.g. COUNT-2026-001" />
            </div>
            <div className="space-y-2">
              <Label>Reason / explanation *</Label>
              <Textarea value={countForm.reason} onChange={e => setCountForm({ ...countForm, reason: e.target.value })}
                placeholder="Explain the variance and the count approval..." rows={3} />
            </div>
            <div className="rounded-md border bg-muted/40 p-3 text-sm text-muted-foreground">
              Increases debit Inventory and credit Inventory Count Variance Gain. Shortages debit Inventory Shrinkage and credit Inventory. The system refuses unverified costs, backdated counts and duplicate submissions.
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setIsCountOpen(false)}>Cancel</Button>
              <Button onClick={() => recordStockCount.mutate()} disabled={
                recordStockCount.isPending || !selectedProduct?.cost_price_verified ||
                !countForm.countedOn || !countForm.reason.trim() || !countForm.referenceNumber.trim() ||
                countForm.countedQuantity === (selectedProduct?.stock_quantity || 0)
              }>
                {recordStockCount.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Approve & Post Count
              </Button>
            </div>
            {!selectedProduct?.cost_price_verified && (
              <p className="text-xs text-destructive">This product's purchase cost is not verified. Resolve its actual cost evidence before reconciling stock.</p>
            )}
          </div>
        </DialogContent>
      </Dialog>

      {/* Adjust Stock Dialog */}
      <Dialog open={isAdjustOpen} onOpenChange={setIsAdjustOpen}>
        <DialogContent className="flex max-h-[85dvh] flex-col overflow-hidden">
          <DialogHeader>
            <DialogTitle>{adjustForm.type === 'damage' ? 'Record Stock Damage' : 'Record Stock Purchase'} - {selectedProduct?.name}</DialogTitle>
            <DialogDescription>
              Current stock: {selectedProduct?.stock_quantity ?? 0} units
            </DialogDescription>
          </DialogHeader>
          <div className="min-h-0 flex-1 space-y-4 overflow-y-auto overscroll-contain py-4 pr-2">
            <div className="space-y-2">
              <Label>Inventory action</Label>
              <Select value={adjustForm.type} onValueChange={value => setAdjustForm({ ...adjustForm, type: value as 'purchase' | 'damage', quantity: 0, referenceNumber: '', notes: '' })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="purchase">Record stock purchase</SelectItem>
                  {canRecordInventoryDamage && <SelectItem value="damage">Record stock damage / shrinkage</SelectItem>}
                </SelectContent>
              </Select>
            </div>
            {adjustForm.type === 'damage' ? (
              <div className="rounded-md border border-warning/40 bg-warning/5 p-3 text-sm text-muted-foreground">
                Damage is valued at the product's verified weighted-average purchase cost and posted as Inventory Shrinkage against Inventory. A damage report or supporting reference is required. Products without verified purchase cost cannot be written off yet.
              </div>
            ) : (
              <div className="rounded-md border border-warning/40 bg-warning/5 p-3 text-sm text-muted-foreground">
                Only evidenced stock purchases and documented damage can currently change inventory from this screen. Sales must be posted through invoices so revenue and cost of goods sold stay linked. Customer returns remain blocked until their audited credit-note and stock-return workflow is implemented. Count differences must be approved and supported by a count-sheet reference.
              </div>
            )}
            <div className="space-y-2">
              <Label>{adjustForm.type === 'damage' ? 'Units Damaged' : 'Purchase Quantity'}</Label>
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
            {adjustForm.type === 'damage' && (
              <div className="space-y-2">
                <Label>Damage Report / Reference *</Label>
                <Input value={adjustForm.referenceNumber} onChange={e => setAdjustForm({ ...adjustForm, referenceNumber: e.target.value })} placeholder="Incident or damage report reference" />
              </div>
            )}
            <div className="space-y-2">
              <Label>Notes</Label>
              <Textarea
                value={adjustForm.notes}
                onChange={e => setAdjustForm({ ...adjustForm, notes: e.target.value })}
                placeholder={adjustForm.type === 'damage' ? 'Describe the damage, spoilage or loss...' : 'Purchase details and supporting notes...'}
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
                )) ||
                (adjustForm.type === 'damage' && (
                  !adjustForm.referenceNumber.trim() || !selectedProduct?.cost_price_verified ||
                  (selectedProduct?.stock_quantity || 0) < adjustForm.quantity
                ))
              }>
                {recordAdjustment.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                {adjustForm.type === 'damage' ? 'Record Damage' : 'Record Purchase'}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </AppLayout>
  );
}
