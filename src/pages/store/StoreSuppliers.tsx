import { useMemo, useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { useBusiness } from '@/contexts/BusinessContext';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Plus, Search, Truck } from 'lucide-react';

type SupplierDraft = {
  supplier_code: string;
  name: string;
  legal_name: string;
  contact_name: string;
  email: string;
  phone: string;
  tax_identifier: string;
  payment_terms_days: string;
  currency: string;
  address: string;
};

type SupplierProductDraft = {
  supplier_id: string;
  product_id: string;
  supplier_sku: string;
  unit_cost: string;
  currency: string;
  minimum_order_quantity: string;
  order_multiple: string;
  lead_time_days: string;
};

const emptySupplier: SupplierDraft = {
  supplier_code: '', name: '', legal_name: '', contact_name: '', email: '',
  phone: '', tax_identifier: '', payment_terms_days: '0', currency: '', address: '',
};

const emptySupplierProduct: SupplierProductDraft = {
  supplier_id: '', product_id: '', supplier_sku: '', unit_cost: '', currency: '',
  minimum_order_quantity: '1', order_multiple: '1', lead_time_days: '0',
};

const optionalText = (value: string) => value.trim() || null;
export default function StoreSuppliers() {
  const { activeBusiness, activeMembership } = useBusiness();
  const businessId = activeBusiness?.id;
  const queryClient = useQueryClient();
  const canManage = ['owner', 'admin', 'accountant'].includes(activeMembership?.role ?? '');
  const [search, setSearch] = useState('');
  const [showSupplierForm, setShowSupplierForm] = useState(false);
  const [showProductForm, setShowProductForm] = useState(false);
  const [supplierDraft, setSupplierDraft] = useState<SupplierDraft>(emptySupplier);
  const [productDraft, setProductDraft] = useState<SupplierProductDraft>(emptySupplierProduct);

  const directory = useQuery({
    queryKey: ['supplier-directory', businessId],
    enabled: Boolean(businessId),
    queryFn: async () => {
      if (!businessId) throw new Error('Select an active business workspace.');
      const [supplierResult, linkResult, productResult] = await Promise.all([
        supabase.from('suppliers').select('*').eq('business_id', businessId).order('name'),
        supabase.from('supplier_products').select('*').eq('business_id', businessId).order('created_at', { ascending: false }),
        supabase.from('products').select('id, name, sku, is_service').eq('business_id', businessId).is('deleted_at', null).order('name'),
      ]);
      const error = supplierResult.error ?? linkResult.error ?? productResult.error;
      if (error) throw error;
      return {
        suppliers: supplierResult.data ?? [],
        links: linkResult.data ?? [],
        products: (productResult.data ?? []).filter(product => product.is_service !== true),
      };
    },
  });

  const refresh = async () => {
    await queryClient.invalidateQueries({ queryKey: ['supplier-directory', businessId] });
  };

  const createSupplier = useMutation({
    mutationFn: async (draft: SupplierDraft) => {
      if (!businessId) throw new Error('Select an active business workspace.');
      const paymentTerms = Number(draft.payment_terms_days);
      if (!Number.isInteger(paymentTerms) || paymentTerms < 0) {
        throw new Error('Payment terms must be a whole number of days (zero or more).');
      }
      const { error } = await supabase.from('suppliers').insert({
        business_id: businessId,
        supplier_code: optionalText(draft.supplier_code),
        name: draft.name.trim(),
        legal_name: optionalText(draft.legal_name),
        contact_name: optionalText(draft.contact_name),
        email: optionalText(draft.email),
        phone: optionalText(draft.phone),
        tax_identifier: optionalText(draft.tax_identifier),
        address: optionalText(draft.address),
        payment_terms_days: paymentTerms,
        currency: optionalText(draft.currency)?.toUpperCase() ?? null,
      });
      if (error) throw error;
    },
    onSuccess: async () => {
      setSupplierDraft(emptySupplier);
      setShowSupplierForm(false);
      await refresh();
      toast.success('Supplier added to this business.');
    },
    onError: error => toast.error(error.message || 'Supplier could not be saved.'),
  });

  const createSupplierProduct = useMutation({
    mutationFn: async (draft: SupplierProductDraft) => {
      if (!businessId) throw new Error('Select an active business workspace.');
      if (!draft.supplier_id || !draft.product_id) throw new Error('Select both a supplier and a product.');
      const minimum = Number(draft.minimum_order_quantity);
      const multiple = Number(draft.order_multiple);
      const leadTime = Number(draft.lead_time_days);
      const cost = draft.unit_cost.trim() ? Number(draft.unit_cost) : null;
      if (!Number.isFinite(minimum) || minimum <= 0 || !Number.isFinite(multiple) || multiple <= 0) {
        throw new Error('Minimum order quantity and order multiple must be greater than zero.');
      }
      if (!Number.isInteger(leadTime) || leadTime < 0) throw new Error('Lead time must be a whole number of days.');
      if (cost !== null && (!Number.isFinite(cost) || cost < 0)) throw new Error('Unit cost must be zero or greater.');
      const currency = optionalText(draft.currency)?.toUpperCase() ?? null;
      if (cost !== null && !currency) throw new Error('Enter the currency when recording a unit cost.');
      if (currency && !/^[A-Z]{3}$/.test(currency)) throw new Error('Currency must be a three-letter code, such as GHS.');
      const { error } = await supabase.from('supplier_products').insert({
        business_id: businessId,
        supplier_id: draft.supplier_id,
        product_id: draft.product_id,
        supplier_sku: optionalText(draft.supplier_sku),
        unit_cost: cost,
        currency: cost === null ? null : currency,
        minimum_order_quantity: minimum,
        order_multiple: multiple,
        lead_time_days: leadTime,
      });
      if (error) throw error;
    },
    onSuccess: async () => {
      setProductDraft(emptySupplierProduct);
      setShowProductForm(false);
      await refresh();
      toast.success('Supplier product terms saved.');
    },
    onError: error => toast.error(error.message || 'Supplier product terms could not be saved.'),
  });

  const setSupplierActive = useMutation({
    mutationFn: async ({ id, isActive }: { id: string; isActive: boolean }) => {
      if (!businessId) throw new Error('Select an active business workspace.');
      const { error } = await supabase.from('suppliers')
        .update({ is_active: isActive })
        .eq('business_id', businessId)
        .eq('id', id);
      if (error) throw error;
    },
    onSuccess: async () => {
      await refresh();
      toast.success('Supplier status updated.');
    },
    onError: error => toast.error(error.message || 'Supplier status could not be updated.'),
  });

  const deactivateSupplierProduct = useMutation({
    mutationFn: async (id: string) => {
      if (!businessId) throw new Error('Select an active business workspace.');
      const { error } = await supabase.from('supplier_products')
        .update({ is_active: false, is_preferred: false })
        .eq('business_id', businessId)
        .eq('id', id);
      if (error) throw error;
    },
    onSuccess: async () => {
      await refresh();
      toast.success('Supplier product link deactivated.');
    },
    onError: error => toast.error(error.message || 'Supplier product link could not be deactivated.'),
  });

  const visibleSuppliers = useMemo(() => {
    const rows = directory.data?.suppliers ?? [];
    const query = search.trim().toLowerCase();
    if (!query) return rows;
    return rows.filter(supplier => [
      supplier.name, supplier.legal_name, supplier.supplier_code, supplier.contact_name,
      supplier.email, supplier.phone,
    ].some(value => value?.toLowerCase().includes(query)));
  }, [directory.data?.suppliers, search]);

  const supplierName = new Map((directory.data?.suppliers ?? []).map(item => [item.id, item.name]));
  const productName = new Map((directory.data?.products ?? []).map(item => [item.id, item.name]));
  const handleSupplierSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!supplierDraft.name.trim()) {
      toast.error('Supplier name is required.');
      return;
    }
    createSupplier.mutate(supplierDraft);
  };
  const handleProductSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    createSupplierProduct.mutate(productDraft);
  };

  if (directory.isLoading) return <Skeleton className="h-96 rounded-xl" />;
  if (directory.error || !directory.data) {
    return (
      <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive" role="alert">
        {directory.error?.message ?? 'Supplier directory could not be loaded.'}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold">Supplier directory</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Business-scoped supplier records and product purchasing terms. Purchase orders and goods receiving are separate controlled workflows.
          </p>
        </div>
        {canManage && (
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" onClick={() => setShowProductForm(value => !value)}>
              <Plus className="mr-2 h-4 w-4" /> Link product
            </Button>
            <Button onClick={() => setShowSupplierForm(value => !value)}>
              <Plus className="mr-2 h-4 w-4" /> Add supplier
            </Button>
          </div>
        )}
      </div>

      {showSupplierForm && canManage && (
        <Card>
          <CardHeader><CardTitle>New supplier</CardTitle></CardHeader>
          <CardContent>
            <form onSubmit={handleSupplierSubmit} className="space-y-4">
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                <div className="space-y-2"><Label htmlFor="supplier-name">Supplier name *</Label><Input id="supplier-name" required value={supplierDraft.name} onChange={event => setSupplierDraft({ ...supplierDraft, name: event.target.value })} /></div>
                <div className="space-y-2"><Label htmlFor="supplier-code">Supplier code</Label><Input id="supplier-code" value={supplierDraft.supplier_code} onChange={event => setSupplierDraft({ ...supplierDraft, supplier_code: event.target.value })} /></div>
                <div className="space-y-2"><Label htmlFor="supplier-legal-name">Legal name</Label><Input id="supplier-legal-name" value={supplierDraft.legal_name} onChange={event => setSupplierDraft({ ...supplierDraft, legal_name: event.target.value })} /></div>
                <div className="space-y-2"><Label htmlFor="supplier-contact">Contact person</Label><Input id="supplier-contact" value={supplierDraft.contact_name} onChange={event => setSupplierDraft({ ...supplierDraft, contact_name: event.target.value })} /></div>
                <div className="space-y-2"><Label htmlFor="supplier-email">Email</Label><Input id="supplier-email" type="email" value={supplierDraft.email} onChange={event => setSupplierDraft({ ...supplierDraft, email: event.target.value })} /></div>
                <div className="space-y-2"><Label htmlFor="supplier-phone">Phone</Label><Input id="supplier-phone" value={supplierDraft.phone} onChange={event => setSupplierDraft({ ...supplierDraft, phone: event.target.value })} /></div>
                <div className="space-y-2"><Label htmlFor="supplier-tax">Tax identifier</Label><Input id="supplier-tax" value={supplierDraft.tax_identifier} onChange={event => setSupplierDraft({ ...supplierDraft, tax_identifier: event.target.value })} /></div>
                <div className="space-y-2"><Label htmlFor="supplier-terms">Payment terms (days)</Label><Input id="supplier-terms" type="number" min="0" step="1" value={supplierDraft.payment_terms_days} onChange={event => setSupplierDraft({ ...supplierDraft, payment_terms_days: event.target.value })} /></div>
                <div className="space-y-2"><Label htmlFor="supplier-currency">Default currency (optional)</Label><Input id="supplier-currency" maxLength={3} placeholder="GHS" value={supplierDraft.currency} onChange={event => setSupplierDraft({ ...supplierDraft, currency: event.target.value.toUpperCase() })} /></div>
                <div className="space-y-2 sm:col-span-2 lg:col-span-3"><Label htmlFor="supplier-address">Address</Label><Input id="supplier-address" value={supplierDraft.address} onChange={event => setSupplierDraft({ ...supplierDraft, address: event.target.value })} /></div>
              </div>
              <div className="flex justify-end gap-2"><Button type="button" variant="outline" onClick={() => setShowSupplierForm(false)}>Cancel</Button><Button type="submit" disabled={createSupplier.isPending}>{createSupplier.isPending ? 'Saving…' : 'Save supplier'}</Button></div>
            </form>
          </CardContent>
        </Card>
      )}

      {showProductForm && canManage && (
        <Card>
          <CardHeader><CardTitle>Supplier product terms</CardTitle></CardHeader>
          <CardContent>
            <form onSubmit={handleProductSubmit} className="space-y-4">
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                <div className="space-y-2"><Label htmlFor="link-supplier">Supplier *</Label><select id="link-supplier" required value={productDraft.supplier_id} onChange={event => setProductDraft({ ...productDraft, supplier_id: event.target.value })} className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"><option value="">Select supplier</option>{directory.data.suppliers.filter(item => item.is_active).map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></div>
                <div className="space-y-2"><Label htmlFor="link-product">Product *</Label><select id="link-product" required value={productDraft.product_id} onChange={event => setProductDraft({ ...productDraft, product_id: event.target.value })} className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"><option value="">Select product</option>{directory.data.products.map(item => <option key={item.id} value={item.id}>{item.name} ({item.sku})</option>)}</select></div>
                <div className="space-y-2"><Label htmlFor="supplier-sku">Supplier SKU</Label><Input id="supplier-sku" value={productDraft.supplier_sku} onChange={event => setProductDraft({ ...productDraft, supplier_sku: event.target.value })} /></div>
                <div className="space-y-2"><Label htmlFor="supplier-unit-cost">Unit cost (optional)</Label><Input id="supplier-unit-cost" type="number" min="0" step="0.0001" value={productDraft.unit_cost} onChange={event => setProductDraft({ ...productDraft, unit_cost: event.target.value })} /></div>
                <div className="space-y-2"><Label htmlFor="supplier-cost-currency">Cost currency</Label><Input id="supplier-cost-currency" maxLength={3} placeholder="GHS" value={productDraft.currency} onChange={event => setProductDraft({ ...productDraft, currency: event.target.value.toUpperCase() })} /></div>
                <div className="space-y-2"><Label htmlFor="supplier-moq">Minimum order quantity</Label><Input id="supplier-moq" type="number" min="0.001" step="0.001" value={productDraft.minimum_order_quantity} onChange={event => setProductDraft({ ...productDraft, minimum_order_quantity: event.target.value })} /></div>
                <div className="space-y-2"><Label htmlFor="supplier-multiple">Order multiple</Label><Input id="supplier-multiple" type="number" min="0.001" step="0.001" value={productDraft.order_multiple} onChange={event => setProductDraft({ ...productDraft, order_multiple: event.target.value })} /></div>
                <div className="space-y-2"><Label htmlFor="supplier-lead">Lead time (days)</Label><Input id="supplier-lead" type="number" min="0" step="1" value={productDraft.lead_time_days} onChange={event => setProductDraft({ ...productDraft, lead_time_days: event.target.value })} /></div>
              </div>
              <div className="flex justify-end gap-2"><Button type="button" variant="outline" onClick={() => setShowProductForm(false)}>Cancel</Button><Button type="submit" disabled={createSupplierProduct.isPending || directory.data.suppliers.length === 0 || directory.data.products.length === 0}>{createSupplierProduct.isPending ? 'Saving…' : 'Save product terms'}</Button></div>
            </form>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader className="space-y-4">
          <div className="flex items-center justify-between gap-3"><CardTitle>Suppliers <Badge variant="secondary">{directory.data.suppliers.length}</Badge></CardTitle><div className="relative w-full max-w-xs"><Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" /><Input aria-label="Search suppliers" placeholder="Search suppliers…" value={search} onChange={event => setSearch(event.target.value)} className="pl-9" /></div></div>
        </CardHeader>
        <CardContent>
          {visibleSuppliers.length === 0 ? (
            <div className="rounded-lg border border-dashed p-8 text-center"><Truck className="mx-auto mb-3 h-8 w-8 text-muted-foreground" /><p className="font-medium">{directory.data.suppliers.length === 0 ? 'No suppliers yet' : 'No matching suppliers'}</p><p className="mt-1 text-sm text-muted-foreground">{directory.data.suppliers.length === 0 ? 'Add suppliers to build this business’s purchasing directory.' : 'Try a different name, code or contact.'}</p></div>
          ) : (
            <div className="overflow-x-auto"><Table><TableHeader><TableRow><TableHead>Supplier</TableHead><TableHead>Code</TableHead><TableHead>Contact</TableHead><TableHead>Terms</TableHead><TableHead>Currency</TableHead><TableHead>Products</TableHead><TableHead>Status</TableHead></TableRow></TableHeader><TableBody>
              {visibleSuppliers.map(supplier => {
                const linked = directory.data.links.filter(link => link.supplier_id === supplier.id && link.is_active);
                return <TableRow key={supplier.id}><TableCell className="font-medium"><div>{supplier.name}</div>{supplier.legal_name && <div className="text-xs text-muted-foreground">{supplier.legal_name}</div>}</TableCell><TableCell>{supplier.supplier_code ?? '—'}</TableCell><TableCell><div>{supplier.contact_name ?? '—'}</div><div className="text-xs text-muted-foreground">{supplier.email ?? supplier.phone ?? ''}</div></TableCell><TableCell>{supplier.payment_terms_days} days</TableCell><TableCell>{supplier.currency ?? activeBusiness?.base_currency ?? '—'}</TableCell><TableCell><div className="font-medium">{linked.length}</div><div className="max-w-48 truncate text-xs text-muted-foreground">{linked.slice(0, 2).map(link => productName.get(link.product_id)).filter(Boolean).join(', ') || 'No linked products'}</div></TableCell><TableCell><div className="flex items-center gap-2"><Badge variant={supplier.is_active ? 'default' : 'secondary'}>{supplier.is_active ? 'Active' : 'Inactive'}</Badge>{canManage && <Button type="button" size="sm" variant="ghost" disabled={setSupplierActive.isPending} onClick={() => setSupplierActive.mutate({ id: supplier.id, isActive: !supplier.is_active })}>{supplier.is_active ? 'Deactivate' : 'Reactivate'}</Button>}</div></TableCell></TableRow>;
              })}
            </TableBody></Table></div>
          )}
        </CardContent>
      </Card>
      <Card>
        <CardHeader><CardTitle>Supplier product terms</CardTitle></CardHeader>
        <CardContent>
          {directory.data.links.length === 0 ? <p className="text-sm text-muted-foreground">No supplier-product terms have been recorded.</p> : (
            <div className="overflow-x-auto"><Table><TableHeader><TableRow><TableHead>Product</TableHead><TableHead>Supplier</TableHead><TableHead>Supplier SKU</TableHead><TableHead className="text-right">Unit cost</TableHead><TableHead className="text-right">MOQ</TableHead><TableHead className="text-right">Multiple</TableHead><TableHead className="text-right">Lead time</TableHead><TableHead>Preferred</TableHead></TableRow></TableHeader><TableBody>
              {directory.data.links.map(link => <TableRow key={link.id}><TableCell className="font-medium">{productName.get(link.product_id) ?? 'Unavailable product'}</TableCell><TableCell>{supplierName.get(link.supplier_id) ?? 'Unavailable supplier'}</TableCell><TableCell>{link.supplier_sku ?? '—'}</TableCell><TableCell className="text-right tabular-nums">{link.unit_cost === null ? 'Not recorded' : `${link.currency ?? ''} ${Number(link.unit_cost).toFixed(4)}`}</TableCell><TableCell className="text-right tabular-nums">{link.minimum_order_quantity}</TableCell><TableCell className="text-right tabular-nums">{link.order_multiple}</TableCell><TableCell className="text-right tabular-nums">{link.lead_time_days} days</TableCell><TableCell><div className="flex items-center gap-2">{link.is_preferred && <Badge>Preferred</Badge>}{!link.is_active && <Badge variant="secondary">Inactive</Badge>}{canManage && link.is_active && <Button type="button" size="sm" variant="ghost" disabled={deactivateSupplierProduct.isPending} onClick={() => deactivateSupplierProduct.mutate(link.id)}>Deactivate</Button>}</div></TableCell></TableRow>)}
            </TableBody></Table></div>
          )}
          {!canManage && <p className="mt-3 text-xs text-muted-foreground">Your role has read-only access to supplier records. Contact a business owner, administrator or accountant to make changes.</p>}
        </CardContent>
      </Card>
    </div>
  );
}
