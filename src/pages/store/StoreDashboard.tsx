import { Link } from 'react-router-dom';
import { AlertTriangle, Boxes, MapPin, PackageCheck } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Skeleton } from '@/components/ui/skeleton';
import { useStoreInventoryData } from '@/hooks/useStoreInventoryData';

const quantity = (value: number) => new Intl.NumberFormat(undefined, {
  maximumFractionDigits: 3,
}).format(value);

export default function StoreDashboard() {
  const { data, isLoading, error } = useStoreInventoryData();

  if (isLoading) {
    return (
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {Array.from({ length: 4 }).map((_, index) => (
          <Skeleton key={index} className="h-28 rounded-xl" />
        ))}
        <Skeleton className="h-72 rounded-xl md:col-span-2 xl:col-span-4" />
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">
        {error?.message ?? 'Store inventory could not be loaded.'}
      </div>
    );
  }

  const productById = new Map(data.products.map(product => [product.id, product]));
  const locationById = new Map(data.locations.map(location => [location.id, location]));
  const settingByKey = new Map(data.settings.map(setting => [
    `${setting.location_id}:${setting.product_id}`,
    setting,
  ]));
  const physicalProducts = data.products.filter(product => product.is_service !== true && product.is_active !== false);
  const totalOnHand = data.balances.reduce((sum, balance) => sum + balance.on_hand, 0);
  const totalAvailable = data.balances.reduce((sum, balance) => sum + balance.available_quantity, 0);
  const lowStock = data.balances
    .map(balance => {
      const product = productById.get(balance.product_id);
      const location = locationById.get(balance.location_id);
      const setting = settingByKey.get(`${balance.location_id}:${balance.product_id}`);
      return { balance, product, location, reorderPoint: setting?.reorder_point ?? product?.min_stock_level ?? 0 };
    })
    .filter(item => item.product && item.product.is_service !== true && item.balance.available_quantity <= item.reorderPoint)
    .sort((a, b) => a.balance.available_quantity - b.balance.available_quantity)
    .slice(0, 8);

  const metrics = [
    { label: 'Active locations', value: quantity(data.locations.filter(location => location.is_active).length), icon: MapPin },
    { label: 'Stocked products', value: quantity(physicalProducts.length), icon: Boxes },
    { label: 'Units on hand', value: quantity(totalOnHand), icon: PackageCheck },
    { label: 'Units available', value: quantity(totalAvailable), icon: AlertTriangle },
  ];

  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {metrics.map(({ label, value, icon: Icon }) => (
          <Card key={label}>
            <CardContent className="flex items-center justify-between p-5">
              <div>
                <p className="text-sm text-muted-foreground">{label}</p>
                <p className="mt-1 text-2xl font-semibold tabular-nums">{value}</p>
              </div>
              <div className="rounded-lg bg-primary/10 p-3 text-primary">
                <Icon className="h-5 w-5" />
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-3">
          <div>
            <CardTitle>Stock requiring attention</CardTitle>
            <p className="mt-1 text-sm text-muted-foreground">
              Items at or below their configured reorder point
            </p>
          </div>
          <Link to="/store/stock" className="text-sm font-medium text-primary hover:underline">
            View all stock
          </Link>
        </CardHeader>
        <CardContent>
          {lowStock.length === 0 ? (
            <p className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
              No items are currently at or below their reorder point.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Product</TableHead>
                    <TableHead>SKU</TableHead>
                    <TableHead>Location</TableHead>
                    <TableHead className="text-right">Available</TableHead>
                    <TableHead className="text-right">Reorder point</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {lowStock.map(({ balance, product, location, reorderPoint }) => (
                    <TableRow key={balance.id}>
                      <TableCell className="font-medium">{product?.name ?? 'Unknown product'}</TableCell>
                      <TableCell>{product?.sku ?? '—'}</TableCell>
                      <TableCell>{location?.name ?? 'Unknown location'}</TableCell>
                      <TableCell className="text-right tabular-nums">{quantity(balance.available_quantity)}</TableCell>
                      <TableCell className="text-right tabular-nums">{quantity(reorderPoint)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
