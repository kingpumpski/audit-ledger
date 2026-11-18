import type { Tables } from '@/integrations/supabase/types';

type StockBalance = Pick<Tables<'stock_balances'>, 'location_id' | 'on_hand' | 'available_quantity'>;
type StoreLocation = Pick<Tables<'store_locations'>, 'id' | 'location_type' | 'is_active'>;

export function isPhysicalStoreLocation(locationType: string | null | undefined): boolean {
  return locationType === 'store' || locationType === 'warehouse' || locationType === 'van';
}

export function summarizeStoreAvailability(
  balances: StockBalance[],
  locations: StoreLocation[],
) {
  const locationById = new Map(locations.map(location => [location.id, location]));
  let unitsInStores = 0;
  let availableInStores = 0;
  let unitsInTransit = 0;

  for (const balance of balances) {
    const location = locationById.get(balance.location_id);
    if (!location) continue;

    if (location.location_type === 'virtual') {
      unitsInTransit += balance.on_hand;
      continue;
    }

    if (!location.is_active || !isPhysicalStoreLocation(location.location_type)) continue;
    unitsInStores += balance.on_hand;
    availableInStores += balance.available_quantity;
  }

  return {
    unitsInStores,
    availableInStores,
    unitsInTransit,
    activePhysicalLocations: locations.filter(
      location => location.is_active && isPhysicalStoreLocation(location.location_type),
    ).length,
  };
}
