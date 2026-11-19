import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { AlertTriangle, ArrowDownToLine, ClipboardList, PackageSearch } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useBusiness } from '@/contexts/BusinessContext';
import { useStoreInventoryData } from '@/hooks/useStoreInventoryData';
import { supabase } from '@/integrations/supabase/client';
import { isPhysicalStoreLocation } from '@/lib/store-stock-availability';
import { buildReplenishmentLocationProductRows, calculateMinMaxReplenishment } from '@/lib/inventory-planning';

const quantity = (value: number) => new Intl.NumberFormat(undefined, {
  maximumFractionDigits: 3,
}).format(value);

type IncomingTransfer = {
  id: string;
  destination_location_id: string;
};

export default function StoreReplenishment() {
  const queryClient = useQueryClient();
  const { activeBusiness, activeMembership } = useBusiness();
  const [configuringKey, setConfiguringKey] = useState<string | null>(null);
  const [configValues, setConfigValues] = useState({ minimum: '0', reorderPoint: '0', target: '', leadTimeDays: '0' });
  const canConfigure = ['owner', 'admin', 'accountant'].includes(activeMembership?.role ?? '');
  const businessId = activeBusiness?.id;
  const inventory = useStoreInventoryData();

  const inboundQuery = useQuery({
    queryKey: ['store-inbound-transfer-quantities', businessId],
    enabled: Boolean(businessId),
    staleTime: 15_000,
    queryFn: async () => {
      if (!businessId) throw new Error('Select an active business workspace.');
      const transfersResult = await supabase
        .from('stock_transfers')
        .select('id, destination_location_id')
        .eq('business_id', businessId)
        .in('status', ['in_transit', 'partially_received']);
      if (transfersResult.error) throw transfersResult.error;

      const transfers = (transfersResult.data ?? []) as IncomingTransfer[];
      if (!transfers.length) return new Map<string, number>();

      const transferIds = transfers.map(transfer => transfer.id);
      const linesResult = await supabase
        .from('stock_transfer_lines')
        .select('transfer_id, product_id, dispatched_quantity, received_quantity')
        .eq('business_id', businessId)
        .in('transfer_id', transferIds);
      if (linesResult.error) throw linesResult.error;

      const destinationByTransfer = new Map(transfers.map(transfer => [
        transfer.id,
        transfer.destination_location_id,
      ]));
      const incoming = new Map<string, number>();
      for (const line of linesResult.data ?? []) {
        const locationId = destinationByTransfer.get(line.transfer_id);
        const outstanding = Math.max(0, Number(line.dispatched_quantity) - Number(line.received_quantity));
        if (!locationId || outstanding <= 0) continue;
        const key = `${locationId}:${line.product_id}`;
        incoming.set(key, (incoming.get(key) ?? 0) + outstanding);
      }
      return incoming;
    },
  });

  const rows = useMemo(() => {
    const data = inventory.data;
    if (!data) return [];
    const productById = new Map(data.products.map(product => [product.id, product]));
    const locationById = new Map(data.locations.map(location => [location.id, location]));
    const settingsByKey = new Map(data.settings.map(setting => [
      `${setting.location_id}:${setting.product_id}`,
      setting,
    ]));
    const incoming = inboundQuery.data ?? new Map<string, number>();

    return buildReplenishmentLocationProductRows(data.balances, data.settings, incoming)
      .map(pair => {
        const product = productById.get(pair.productId);
        const location = locationById.get(pair.locationId);
        const setting = settingsByKey.get(`${pair.locationId}:${pair.productId}`);
        const inbound = incoming.get(`${pair.locationId}:${pair.productId}`) ?? 0;
        const minimum = Number(setting?.minimum_quantity ?? product?.min_stock_level ?? 0);
        const configuredReorderPoint = Number(setting?.reorder_point ?? product?.min_stock_level ?? 0);
        // Never let a configured reorder trigger undercut the minimum stock floor.
        const reorderPoint = Math.max(minimum, configuredReorderPoint);
        const target = setting?.target_quantity === null || setting?.target_quantity === undefined
          ? null
          : Number(setting.target_quantity);
        const plan = calculateMinMaxReplenishment({
          available: pair.available,
          incoming: inbound,
          reorderPoint,
          targetStock: target,
        });
        const needsReorder = Boolean(
          product && product.is_service !== true && product.is_active !== false
          && location?.is_active && isPhysicalStoreLocation(location.location_type)
          && setting?.is_active !== false
          && setting?.replenishment_method !== 'manual'
          && plan.shouldReorder,
        );
        const inventoryPosition = plan.inventoryPosition;
        const targetConfigured = plan.targetConfigured;
        const suggestedQuantity = plan.suggestedQuantity;
        return {
          id: pair.id,
          product,
          location,
          available: pair.available,
          inbound,
          inventoryPosition,
          reorderPoint,
          target,
          needsReorder,
          targetConfigured,
          suggestedQuantity,
          method: setting?.replenishment_method ?? 'min_max',
          minimum,
          leadTimeDays: Number(setting?.lead_time_days ?? 0),
        };
      })
      .filter(row => row.product && row.location
        && row.product.is_service !== true && row.product.is_active !== false
        && row.location.is_active && isPhysicalStoreLocation(row.location.location_type))
      .sort((a, b) => {
        if (a.needsReorder !== b.needsReorder) return a.needsReorder ? -1 : 1;
        return a.inventoryPosition - a.reorderPoint - (b.inventoryPosition - b.reorderPoint);
      });
  }, [inventory.data, inboundQuery.data]);

  const saveSettings = useMutation({
    mutationFn: async () => {
      if (!businessId || !configuringKey) throw new Error('Select a stock item to configure.');
      const selected = rows.find(row => row.id === configuringKey);
      if (!selected?.product || !selected.location) throw new Error('The selected stock item is no longer available.');
      const minimum = Number(configValues.minimum);
      const reorderPoint = Number(configValues.reorderPoint);
      const target = configValues.target.trim() === '' ? null : Number(configValues.target);
      const leadTimeDays = Number(configValues.leadTimeDays);
      if (![minimum, reorderPoint, leadTimeDays].every(Number.isFinite)
        || minimum < 0 || reorderPoint < 0 || leadTimeDays < 0
        || !Number.isInteger(leadTimeDays)) {
        throw new Error('Minimum, reorder point and lead time must be valid non-negative values.');
      }
      if (target !== null && (!Number.isFinite(target) || target <= Math.max(minimum, reorderPoint))) {
        throw new Error('Target stock must be blank or greater than the effective minimum/reorder trigger.');
      }
      const { error } = await supabase.from('product_location_settings').upsert({
        business_id: businessId,
        location_id: selected.location.id,
        product_id: selected.product.id,
        minimum_quantity: minimum,
        reorder_point: reorderPoint,
        target_quantity: target,
        lead_time_days: leadTimeDays,
        replenishment_method: 'min_max',
        is_active: true,
      }, { onConflict: 'business_id,location_id,product_id' });
      if (error) throw error;
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['store-inventory-snapshot', businessId] });
      setConfiguringKey(null);
      toast.success('Location replenishment settings saved.');
    },
    onError: error => toast.error(error instanceof Error ? error.message : 'Could not save replenishment settings.'),
  });

  if (inventory.isLoading || inboundQuery.isLoading) {
    return <Skeleton className="h-96 rounded-xl" />;
  }

  if (inventory.error || inboundQuery.error || !inventory.data) {
    return (
      <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">
        {inventory.error?.message ?? inboundQuery.error?.message ?? 'Replenishment data could not be loaded.'}
      </div>
    );
  }

  const reorderRows = rows.filter(row => row.needsReorder);
  const suggestions = reorderRows.filter(row => row.targetConfigured);

  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-3">
        <Card>
          <CardContent className="flex items-center justify-between p-5">
            <div>
              <p className="text-sm text-muted-foreground">Items to review</p>
              <p className="mt-1 text-2xl font-semibold tabular-nums">{reorderRows.length}</p>
            </div>
            <AlertTriangle className="h-5 w-5 text-warning" />
          </CardContent>
        </Card>
        <Card>
          <CardContent className="flex items-center justify-between p-5">
            <div>
              <p className="text-sm text-muted-foreground">Order quantities suggested</p>
              <p className="mt-1 text-2xl font-semibold tabular-nums">{suggestions.length}</p>
            </div>
            <ClipboardList className="h-5 w-5 text-primary" />
          </CardContent>
        </Card>
        <Card>
          <CardContent className="flex items-center justify-between p-5">
            <div>
              <p className="text-sm text-muted-foreground">Inbound transfer lines</p>
              <p className="mt-1 text-2xl font-semibold tabular-nums">{rows.filter(row => row.inbound > 0).length}</p>
            </div>
            <ArrowDownToLine className="h-5 w-5 text-primary" />
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><PackageSearch className="h-5 w-5" /> Replenishment review</CardTitle>
          <p className="text-sm text-muted-foreground">
            Suggestions use available stock, configured reorder points and outstanding inbound transfers.
            No purchase order is created automatically.
          </p>
        </CardHeader>
        <CardContent>
          {rows.length === 0 ? (
            <p className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
              No physical stock records are available for this workspace yet.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Product</TableHead>
                    <TableHead>Location</TableHead>
                    <TableHead className="text-right">Available</TableHead>
                    <TableHead className="text-right">Inbound</TableHead>
                    <TableHead className="text-right">Inventory position</TableHead>
                    <TableHead className="text-right">Reorder point</TableHead>
                    <TableHead className="text-right">Target</TableHead>
                    <TableHead className="text-right">Suggested qty.</TableHead>
                    <TableHead>Action</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map(row => (
                    <TableRow key={row.id}>
                      <TableCell>
                        <div className="font-medium">{row.product?.name}</div>
                        <div className="text-xs text-muted-foreground">{row.product?.sku || 'No SKU'}</div>
                      </TableCell>
                      <TableCell>{row.location?.name}</TableCell>
                      <TableCell className="text-right tabular-nums">{quantity(row.available)}</TableCell>
                      <TableCell className="text-right tabular-nums">{quantity(row.inbound)}</TableCell>
                      <TableCell className="text-right tabular-nums">{quantity(row.inventoryPosition)}</TableCell>
                      <TableCell className="text-right tabular-nums">{quantity(row.reorderPoint)}</TableCell>
                      <TableCell className="text-right tabular-nums">{row.target === null ? 'Not set' : quantity(row.target)}</TableCell>
                      <TableCell className="text-right font-semibold tabular-nums">
                        {row.needsReorder
                          ? row.targetConfigured ? quantity(row.suggestedQuantity) : 'Configure target'
                          : '—'}
                      </TableCell>
                      <TableCell>
                        {row.inbound > 0 && !row.needsReorder
                          ? <span className="text-xs text-muted-foreground">Await receipt</span>
                          : row.needsReorder && !row.targetConfigured
                            ? <span className="text-xs text-muted-foreground">Manager setup required</span>
                            : row.needsReorder
                              ? <span className="text-xs text-warning">Review before ordering</span>
                              : <span className="text-xs text-muted-foreground">Inbound</span>}
                        {canConfigure && <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => {
                            setConfiguringKey(row.id);
                            setConfigValues({
                              minimum: String(row.minimum),
                              reorderPoint: String(row.reorderPoint),
                              target: row.target === null ? '' : String(row.target),
                              leadTimeDays: String(row.leadTimeDays),
                            });
                          }}
                        >Settings</Button>}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {configuringKey && canConfigure && (
        <Card>
          <CardHeader>
            <CardTitle>Location replenishment settings</CardTitle>
            <p className="text-sm text-muted-foreground">
              The effective reorder trigger is the higher of the minimum quantity and reorder point. Supplier lead time is recorded for the upcoming demand-forecast and purchasing workflow; this first min/max view does not yet calculate demand from it.
            </p>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <label className="space-y-1 text-sm">
                <span>Minimum quantity</span>
                <Input type="number" min="0" step="0.001" value={configValues.minimum}
                  onChange={event => setConfigValues(current => ({ ...current, minimum: event.target.value }))} />
              </label>
              <label className="space-y-1 text-sm">
                <span>Reorder point</span>
                <Input type="number" min="0" step="0.001" value={configValues.reorderPoint}
                  onChange={event => setConfigValues(current => ({ ...current, reorderPoint: event.target.value }))} />
              </label>
              <label className="space-y-1 text-sm">
                <span>Target stock quantity</span>
                <Input type="number" min="0" step="0.001" value={configValues.target}
                  placeholder="Required for order suggestion"
                  onChange={event => setConfigValues(current => ({ ...current, target: event.target.value }))} />
              </label>
              <label className="space-y-1 text-sm">
                <span>Supplier lead time (days; forecast input)</span>
                <Input type="number" min="0" step="1" value={configValues.leadTimeDays}
                  onChange={event => setConfigValues(current => ({ ...current, leadTimeDays: event.target.value }))} />
              </label>
            </div>
            <div className="flex flex-wrap justify-end gap-2">
              <Button variant="outline" onClick={() => setConfiguringKey(null)} disabled={saveSettings.isPending}>Cancel</Button>
              <Button onClick={() => saveSettings.mutate()} disabled={saveSettings.isPending}>
                {saveSettings.isPending ? 'Saving…' : 'Save settings'}
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      <p className="text-xs text-muted-foreground">
        This first planning view is deliberately rule-based, not a statistical demand forecast. It does not yet subtract open supplier purchase orders; that requires the purchasing workflow and receiving ledger.
      </p>
    </div>
  );
}
