import { useMemo, useState } from 'react';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Skeleton } from '@/components/ui/skeleton';
import { useStoreInventoryData } from '@/hooks/useStoreInventoryData';

const quantity = (value: number) => new Intl.NumberFormat(undefined, {
  maximumFractionDigits: 3,
}).format(value);

export default function StoreStock() {
  const { data, isLoading, error } = useStoreInventoryData();
  const [search, setSearch] = useState('');
  const [locationFilter, setLocationFilter] = useState('all');

  const rows = useMemo(() => {
    if (!data) return [];
    const products = new Map(data.products.map(product => [product.id, product]));
    const locations = new Map(data.locations.map(location => [location.id, location]));
    const settings = new Map(data.settings.map(setting => [
      `${setting.location_id}:${setting.product_id}`,
      setting,
    ]));
    const normalizedSearch = search.trim().toLowerCase();

    return data.balances
      .map(balance => ({
        balance,
        product: products.get(balance.product_id),
        location: locations.get(balance.location_id),
        setting: settings.get(`${balance.location_id}:${balance.product_id}`),
      }))
      .filter(row => row.product && row.product.is_service !== true)
      .filter(row => locationFilter === 'all' || row.balance.location_id === locationFilter)
      .filter(row => !normalizedSearch || [
        row.product?.name,
        row.product?.sku,
        row.location?.name,
      ].some(value => value?.toLowerCase().includes(normalizedSearch)))
      .sort((a, b) => (a.product?.name ?? '').localeCompare(b.product?.name ?? ''));
  }, [data, locationFilter, search]);

  if (isLoading) {
    return <Skeleton className="h-96 rounded-xl" />;
  }

  if (error || !data) {
    return (
      <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">
        {error?.message ?? 'Stock balances could not be loaded.'}
      </div>
    );
  }

  return (
    <Card>
      <CardHeader className="space-y-4">
        <div>
          <CardTitle>Stock levels</CardTitle>
          <p className="mt-1 text-sm text-muted-foreground">
            On-hand, reserved, quarantined and available quantities by store location
          </p>
        </div>
        <div className="flex flex-col gap-3 sm:flex-row">
          <Input
            value={search}
            onChange={event => setSearch(event.target.value)}
            placeholder="Search product, SKU or location..."
            aria-label="Search stock"
            className="sm:max-w-sm"
          />
          <select
            value={locationFilter}
            onChange={event => setLocationFilter(event.target.value)}
            aria-label="Filter by location"
            className="h-10 rounded-md border border-input bg-background px-3 text-sm sm:w-64"
          >
            <option value="all">All locations</option>
            {data.locations.map(location => (
              <option key={location.id} value={location.id}>{location.name}</option>
            ))}
          </select>
        </div>
      </CardHeader>
      <CardContent>
        {rows.length === 0 ? (
          <p className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
            No stock records match the current filters.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Product</TableHead>
                  <TableHead>SKU</TableHead>
                  <TableHead>Location</TableHead>
                  <TableHead className="text-right">On hand</TableHead>
                  <TableHead className="text-right">Reserved</TableHead>
                  <TableHead className="text-right">Quarantined</TableHead>
                  <TableHead className="text-right">Available / transit</TableHead>
                  <TableHead className="text-right">Reorder point</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map(({ balance, product, location, setting }) => (
                  <TableRow key={balance.id}>
                    <TableCell className="font-medium">{product?.name}</TableCell>
                    <TableCell>{product?.sku}</TableCell>
                    <TableCell>{location?.name ?? '—'}</TableCell>
                    <TableCell className="text-right tabular-nums">{quantity(balance.on_hand)}</TableCell>
                    <TableCell className="text-right tabular-nums">{quantity(balance.reserved)}</TableCell>
                    <TableCell className="text-right tabular-nums">{quantity(balance.quarantined)}</TableCell>
                    <TableCell className="text-right font-semibold tabular-nums">
                      {location?.location_type === 'virtual' ? (
                        <span className="text-muted-foreground">In transit: {quantity(balance.on_hand)}</span>
                      ) : quantity(balance.available_quantity)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {quantity(setting?.reorder_point ?? product?.min_stock_level ?? 0)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
        <p className="mt-3 text-xs text-muted-foreground">
          Quantities are read-only here. All stock changes must be recorded through an approved store transaction.
        </p>
      </CardContent>
    </Card>
  );
}
