import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useBusiness } from '@/contexts/BusinessContext';

export interface CustomerAccountBalance {
  customer_id: string;
  customer_code: string;
  customer_name: string;
  invoiced_amount: number;
  payments_received: number;
  credit_notes_applied: number;
  customer_credits_applied: number;
  outstanding_balance: number;
  as_of_date: string;
}

/**
 * Receivables calculated from dated issued invoices, payments and credits.
 * Historical balances therefore remain stable when later payments are entered.
 */
export function useCustomerAccountBalances(asOfDate: string, customerId?: string, enabled = true) {
  const { activeBusiness } = useBusiness();
  const businessId = activeBusiness?.id;
  const query = useQuery({
    queryKey: ['customer-account-balances', businessId, asOfDate, customerId || 'all'],
    queryFn: async (): Promise<CustomerAccountBalance[]> => {
      const { data, error } = await supabase.rpc('get_customer_account_balances', {
        p_as_of_date: asOfDate,
        p_customer_id: customerId || null,
      });
      if (error) throw error;
      return (data || []) as CustomerAccountBalance[];
    },
    enabled: Boolean(businessId) && Boolean(asOfDate) && enabled,
    refetchInterval: 30000,
    refetchOnWindowFocus: true,
  });

  return {
    balances: query.data || [],
    isLoading: query.isLoading,
    error: query.error,
    refetch: query.refetch,
  };
}
