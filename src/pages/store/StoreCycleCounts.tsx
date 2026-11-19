import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Ban, CheckCircle2, ClipboardCheck, Loader2, Plus, RefreshCw, Send, ShieldCheck } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useBusiness } from '@/contexts/BusinessContext';
import { useStoreInventoryData } from '@/hooks/useStoreInventoryData';
import { supabase } from '@/integrations/supabase/client';
import type { Tables } from '@/integrations/supabase/types';

type StockCount = Tables<'store_stock_counts'>;
type StockCountLine = Tables<'store_stock_count_lines'>;

const physicalTypes = new Set(['store', 'warehouse', 'van']);
const canApprove = new Set(['owner', 'admin', 'accountant']);

export default function StoreCycleCounts() {
  const queryClient = useQueryClient();
  const { activeBusiness, activeMembership } = useBusiness();
  const { data: inventory, isLoading: inventoryLoading, error: inventoryError } = useStoreInventoryData();
  const businessId = activeBusiness?.id;
  const [locationId, setLocationId] = useState('');
  const [reference, setReference] = useState('');
  const [notes, setNotes] = useState('');
  const [selectedProductIds, setSelectedProductIds] = useState<string[]>([]);
  const [selectedCountId, setSelectedCountId] = useState('');
  const [quantities, setQuantities] = useState<Record<string, string>>({});
  const [reasons, setReasons] = useState<Record<string, string>>({});
  const [cancelReason, setCancelReason] = useState('');

  const countsQuery = useQuery({
    queryKey: ['store-stock-counts', businessId],
    enabled: Boolean(businessId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from('store_stock_counts')
        .select('*')
        .eq('business_id', businessId!)
        .order('created_at', { ascending: false })
        .limit(100);
      if (error) throw error;
      return data as StockCount[];
    },
  });

  const linesQuery = useQuery({
    queryKey: ['store-stock-count-lines', businessId, selectedCountId],
    enabled: Boolean(businessId && selectedCountId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from('store_stock_count_lines')
        .select('*')
        .eq('business_id', businessId!)
        .eq('count_id', selectedCountId)
        .order('created_at');
      if (error) throw error;
      return data as StockCountLine[];
    },
  });

  const invalidate = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['store-stock-counts', businessId] }),
      queryClient.invalidateQueries({ queryKey: ['store-stock-count-lines', businessId] }),
      queryClient.invalidateQueries({ queryKey: ['store-inventory-snapshot', businessId] }),
    ]);
  };

  const mutation = useMutation({
    mutationFn: async (action: () => PromiseLike<{ error: { message: string } | null }>) => {
      const result = await action();
      if (result.error) throw result.error;
    },
    onSuccess: async () => {
      await invalidate();
      setCancelReason('');
      toast.success('Stock-count action completed.');
    },
    onError: (error: Error) => toast.error(error.message || 'The stock-count action failed.'),
  });

  const selectedCount = useMemo(
    () => countsQuery.data?.find(count => count.id === selectedCountId) ?? null,
    [countsQuery.data, selectedCountId],
  );
  const productsById = useMemo(
    () => new Map((inventory?.products ?? []).map(product => [product.id, product])),
    [inventory?.products],
  );
  const locations = (inventory?.locations ?? []).filter(
    location => location.is_active && physicalTypes.has(location.location_type),
  );
  const manager = canApprove.has(activeMembership?.role ?? '');
  const canCount = new Set(['owner', 'admin', 'accountant', 'cashier']).has(activeMembership?.role ?? '');

  const createCount = () => {
    if (!locationId || !reference.trim()) {
      toast.error('Choose a physical location and enter a count reference.');
      return;
    }
    mutation.mutate(() => supabase.rpc('create_store_stock_count', {
      p_location_id: locationId,
      p_reference_number: reference.trim(),
      p_notes: notes.trim() || null,
      p_idempotency_key: crypto.randomUUID(),
      p_product_ids: selectedProductIds.length ? selectedProductIds : null,
    }).then(({ error }) => ({ error })), {
      onSuccess: () => {
        setReference('');
        setNotes('');
        setSelectedProductIds([]);
      },
    });
  };

  const saveLine = (line: StockCountLine) => {
    const raw = quantities[line.product_id] ?? (line.counted_quantity === null ? '' : String(line.counted_quantity));
    const value = Number(raw);
    if (raw.trim() === '' || !Number.isSafeInteger(value) || value < 0) {
      toast.error('Enter a whole-number physical count of zero or more.');
      return;
    }
    mutation.mutate(() => supabase.rpc('record_store_stock_count_line', {
      p_count_id: line.count_id,
      p_product_id: line.product_id,
      p_counted_quantity: value,
      p_reason: reasons[line.product_id]?.trim() || null,
    }).then(({ error }) => ({ error })));
  };

  if (inventoryLoading || countsQuery.isLoading) {
    return <Skeleton className="h-96 rounded-xl" />;
  }
  if (inventoryError || countsQuery.error || !inventory) {
    return <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">
      {inventoryError?.message ?? (countsQuery.error as Error | null)?.message ?? 'Cycle counts could not be loaded.'}
    </div>;
  }

  return (
    <div className="space-y-6">
      {canCount && <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><Plus className="h-5 w-5" /> Start a blind stock count</CardTitle>
          <p className="text-sm text-muted-foreground">
            The system snapshots stock without showing expected quantities to counters. Leave SKU selection empty for all active physical SKUs, or select specific products for a focused count.
          </p>
        </CardHeader>
        <CardContent className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
          <select value={locationId} onChange={event => setLocationId(event.target.value)}
            className="h-10 rounded-md border border-input bg-background px-3 text-sm" aria-label="Count location">
            <option value="">Select location</option>
            {locations.map(location => <option key={location.id} value={location.id}>{location.name}</option>)}
          </select>
          <Input value={reference} onChange={event => setReference(event.target.value)} placeholder="Count reference" aria-label="Count reference" />
          <Input value={notes} onChange={event => setNotes(event.target.value)} placeholder="Notes (optional)" aria-label="Count notes" />
          <select multiple value={selectedProductIds}
            onChange={event => setSelectedProductIds(Array.from(event.target.selectedOptions, option => option.value))}
            aria-label="Optional SKU selection" title="Leave empty to count every active physical SKU"
            className="min-h-10 rounded-md border border-input bg-background px-3 py-2 text-sm">
            {(inventory.products ?? []).filter(product => product.is_service !== true && product.is_active !== false)
              .map(product => <option key={product.id} value={product.id}>{product.sku} · {product.name}</option>)}
          </select>
          <Button onClick={createCount} disabled={mutation.isPending || !locationId || !reference.trim()}>
            {mutation.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <ClipboardCheck className="mr-2 h-4 w-4" />}
            Start count
          </Button>
        </CardContent>
      </Card>}

      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-3">
          <div><CardTitle>Stock-count register</CardTitle><p className="text-sm text-muted-foreground">Track counting, independent approval and posting status</p></div>
          <Button variant="outline" size="sm" onClick={() => void invalidate()}><RefreshCw className="mr-2 h-4 w-4" /> Refresh</Button>
        </CardHeader>
        <CardContent>
          {(countsQuery.data ?? []).length === 0 ? (
            <p className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">No stock-count sessions have been created.</p>
          ) : (
            <div className="overflow-x-auto"><Table>
              <TableHeader><TableRow><TableHead>Reference</TableHead><TableHead>Location</TableHead><TableHead>Status</TableHead><TableHead>Created</TableHead><TableHead /></TableRow></TableHeader>
              <TableBody>{(countsQuery.data ?? []).map(count => (
                <TableRow key={count.id} data-state={selectedCountId === count.id ? 'selected' : undefined}>
                  <TableCell className="font-medium">{count.reference_number}</TableCell>
                  <TableCell>{inventory.locations.find(location => location.id === count.location_id)?.name ?? 'Location unavailable'}</TableCell>
                  <TableCell className="capitalize">{count.status}</TableCell>
                  <TableCell>{new Date(count.created_at).toLocaleString()}</TableCell>
                  <TableCell><Button size="sm" variant={selectedCountId === count.id ? 'default' : 'outline'} onClick={() => setSelectedCountId(count.id)}>Open</Button></TableCell>
                </TableRow>
              ))}</TableBody>
            </Table></div>
          )}
        </CardContent>
      </Card>

      {selectedCount && (
        <Card>
          <CardHeader>
            <CardTitle className="flex flex-wrap items-center justify-between gap-2">
              <span>{selectedCount.reference_number} · {selectedCount.status}</span>
              <span className="text-sm font-normal text-muted-foreground">{linesQuery.data?.length ?? 0} SKUs</span>
            </CardTitle>
            <p className="text-sm text-muted-foreground">
              System quantities remain hidden during counting. Variances require a reason and verified inventory cost before posting.
            </p>
          </CardHeader>
          <CardContent className="space-y-4">
            {linesQuery.isLoading ? <Skeleton className="h-40" /> : linesQuery.error ? (
              <p className="text-sm text-destructive">{(linesQuery.error as Error).message}</p>
            ) : (
              <div className="overflow-x-auto"><Table>
                <TableHeader><TableRow><TableHead>Product</TableHead><TableHead>SKU</TableHead><TableHead>Physical quantity</TableHead><TableHead>Variance reason</TableHead>{selectedCount.status === 'counting' && <TableHead />}</TableRow></TableHeader>
                <TableBody>{(linesQuery.data ?? []).map(line => {
                  const product = productsById.get(line.product_id);
                  return <TableRow key={line.id}>
                    <TableCell className="font-medium">{product?.name ?? 'Unknown product'}</TableCell>
                    <TableCell>{product?.sku ?? '—'}</TableCell>
                    <TableCell className="min-w-36">
                      {selectedCount.status === 'counting' ? (
                        <Input type="number" min="0" step="1" inputMode="numeric"
                          value={quantities[line.product_id] ?? (line.counted_quantity === null ? '' : String(line.counted_quantity))}
                          onChange={event => setQuantities(current => ({ ...current, [line.product_id]: event.target.value }))}
                          aria-label={`Physical count for ${product?.name ?? line.product_id}`} />
                      ) : (line.counted_quantity ?? 'Not counted')}
                    </TableCell>
                    <TableCell className="min-w-48">
                      {selectedCount.status === 'counting' ? (
                        <Input value={reasons[line.product_id] ?? line.reason ?? ''}
                          onChange={event => setReasons(current => ({ ...current, [line.product_id]: event.target.value }))}
                          placeholder="Required if variance exists" aria-label={`Variance reason for ${product?.name ?? line.product_id}`} />
                      ) : (line.reason || '—')}
                    </TableCell>
                    {selectedCount.status === 'counting' && <TableCell><Button size="sm" variant="outline" disabled={mutation.isPending} onClick={() => saveLine(line)}>Save count</Button></TableCell>}
                  </TableRow>;
                })}</TableBody>
              </Table></div>
            )}

            {selectedCount.status === 'counting' && <Button disabled={mutation.isPending || !linesQuery.data?.length || linesQuery.data.some(line => line.counted_quantity === null)}
              onClick={() => mutation.mutate(() => supabase.rpc('submit_store_stock_count', { p_count_id: selectedCount.id }).then(({ error }) => ({ error })))}>
              <Send className="mr-2 h-4 w-4" /> Submit for independent approval
            </Button>}

            {selectedCount.status === 'submitted' && manager && <Button disabled={mutation.isPending}
              onClick={() => mutation.mutate(() => supabase.rpc('approve_store_stock_count', { p_count_id: selectedCount.id }).then(({ error }) => ({ error })))}>
              <ShieldCheck className="mr-2 h-4 w-4" /> Approve count
            </Button>}

            {selectedCount.status === 'approved' && manager && <Button disabled={mutation.isPending}
              onClick={() => mutation.mutate(() => supabase.rpc('post_store_stock_count', {
                p_count_id: selectedCount.id,
                p_idempotency_key: crypto.randomUUID(),
              }).then(({ error }) => ({ error })))}>
              <CheckCircle2 className="mr-2 h-4 w-4" /> Post stock adjustment and journal
            </Button>}

            {['counting', 'submitted', 'approved'].includes(selectedCount.status) && manager && (
              <div className="flex flex-col gap-2 border-t pt-4 sm:flex-row">
                <Input value={cancelReason} onChange={event => setCancelReason(event.target.value)}
                  placeholder="Reason for canceling this count" aria-label="Stock-count cancellation reason" />
                <Button variant="destructive" disabled={mutation.isPending || !cancelReason.trim()}
                  onClick={() => mutation.mutate(() => supabase.rpc('cancel_store_stock_count', {
                    p_count_id: selectedCount.id,
                    p_reason: cancelReason.trim(),
                  }).then(({ error }) => ({ error })))}>
                  <Ban className="mr-2 h-4 w-4" /> Cancel count and release locks
                </Button>
              </div>
            )}

            {selectedCount.status === 'counting' && <p className="text-xs text-muted-foreground">
              Save each physical count. Submission is enabled only after every SKU has been counted. Approval and posting are separate manager-controlled steps.
            </p>}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
