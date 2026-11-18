import { describe, expect, it } from 'vitest';
import { isPhysicalStoreLocation, summarizeStoreAvailability } from './store-stock-availability';

describe('store stock availability', () => {
  it('counts physical store stock as saleable availability and tracks transit separately', () => {
    const summary = summarizeStoreAvailability(
      [
        { location_id: 'store-1', on_hand: 10, available_quantity: 7 },
        { location_id: 'transit', on_hand: 4, available_quantity: 4 },
        { location_id: 'inactive-store', on_hand: 8, available_quantity: 8 },
      ],
      [
        { id: 'store-1', location_type: 'store', is_active: true },
        { id: 'transit', location_type: 'virtual', is_active: true },
        { id: 'inactive-store', location_type: 'warehouse', is_active: false },
      ],
    );

    expect(summary).toEqual({
      unitsInStores: 10,
      availableInStores: 7,
      unitsInTransit: 4,
      activePhysicalLocations: 1,
    });
  });

  it('fails closed for unknown or virtual location types', () => {
    expect(isPhysicalStoreLocation('store')).toBe(true);
    expect(isPhysicalStoreLocation('warehouse')).toBe(true);
    expect(isPhysicalStoreLocation('van')).toBe(true);
    expect(isPhysicalStoreLocation('virtual')).toBe(false);
    expect(isPhysicalStoreLocation('unknown')).toBe(false);
    expect(isPhysicalStoreLocation(undefined)).toBe(false);
  });

  it('does not count stock without a known location as saleable', () => {
    const summary = summarizeStoreAvailability(
      [{ location_id: 'missing', on_hand: 5, available_quantity: 5 }],
      [],
    );

    expect(summary.availableInStores).toBe(0);
    expect(summary.unitsInTransit).toBe(0);
  });
});
