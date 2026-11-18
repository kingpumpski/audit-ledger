import { useQuery } from '@tanstack/react-query';
import { useBusiness } from '@/contexts/BusinessContext';
import { supabase } from '@/integrations/supabase/client';
import type { Tables } from '@/integrations/supabase/types';

export interface StoreInventorySnapshot {
  balances: Tables<'stock_balances'>[];
  locations: Tables<'store_locations'>[];
  settings: Tables<'product_location_settings'>[];
  products: Tables<'products'>[];
}

export function useStoreInventoryData() {
  const { activeBusiness } = useBusiness();
  const businessId = activeBusiness?.id;

  return useQuery({
    queryKey: ['store-inventory-snapshot', businessId],
    enabled: Boolean(businessId),
    staleTime: 15_000,
    queryFn: async (): Promise<StoreInventorySnapshot> => {
      if (!businessId) {
        throw new Error('Select an active business workspace to view store inventory.');
      }

      const [balanceResult, locationResult, settingsResult, productResult] = await Promise.all([
        supabase
          .from('stock_balances')
          .select('*')
          .eq('business_id', businessId)
          .order('updated_at', { ascending: false }),
        supabase
          .from('store_locations')
          .select('*')
          .eq('business_id', businessId)
          .order('is_default', { ascending: false })
          .order('name'),
        supabase
          .from('product_location_settings')
          .select('*')
          .eq('business_id', businessId)
          .eq('is_active', true),
        supabase
          .from('products')
          .select('*')
          .eq('business_id', businessId)
          .is('deleted_at', null)
          .order('name'),
      ]);

      const error = balanceResult.error
        ?? locationResult.error
        ?? settingsResult.error
        ?? productResult.error;
      if (error) throw error;

      return {
        balances: balanceResult.data ?? [],
        locations: locationResult.data ?? [],
        settings: settingsResult.data ?? [],
        products: productResult.data ?? [],
      };
    },
  });
}
