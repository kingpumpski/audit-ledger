import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useStoreInventoryData } from '@/hooks/useStoreInventoryData';

export default function StoreLocations() {
  const { data, isLoading, error } = useStoreInventoryData();

  if (isLoading) return <Skeleton className="h-80 rounded-xl" />;

  if (error || !data) {
    return (
      <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">
        {error?.message ?? 'Store locations could not be loaded.'}
      </div>
    );
  }

  const balanceCountByLocation = new Map<string, number>();
  for (const balance of data.balances) {
    balanceCountByLocation.set(
      balance.location_id,
      (balanceCountByLocation.get(balance.location_id) ?? 0) + 1,
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Store locations</CardTitle>
        <p className="text-sm text-muted-foreground">
          Each business starts with a default location. Additional locations can be introduced through the controlled location-management workflow.
        </p>
      </CardHeader>
      <CardContent>
        {data.locations.length === 0 ? (
          <p className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
            No store locations are configured for this workspace.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Location</TableHead>
                  <TableHead>Code</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Timezone</TableHead>
                  <TableHead className="text-right">Stock records</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.locations.map(location => (
                  <TableRow key={location.id}>
                    <TableCell className="font-medium">
                      <div>{location.name}</div>
                      {location.is_default && (
                        <span className="text-xs text-primary">Default location</span>
                      )}
                    </TableCell>
                    <TableCell>{location.code}</TableCell>
                    <TableCell className="capitalize">{location.location_type}</TableCell>
                    <TableCell>{location.timezone}</TableCell>
                    <TableCell className="text-right tabular-nums">
                      {balanceCountByLocation.get(location.id) ?? 0}
                    </TableCell>
                    <TableCell>
                      <span className={location.is_active ? 'text-emerald-700 dark:text-emerald-400' : 'text-muted-foreground'}>
                        {location.is_active ? 'Active' : 'Inactive'}
                      </span>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
        <p className="mt-3 text-xs text-muted-foreground">
          Location creation, deactivation and transfer permissions will be enabled with the audited location-management workflows.
        </p>
      </CardContent>
    </Card>
  );
}
