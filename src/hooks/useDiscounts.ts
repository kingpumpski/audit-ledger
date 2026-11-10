import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { Tables, TablesInsert } from '@/integrations/supabase/types';

type Discount = Tables<'discounts'>;
type DiscountInsert = TablesInsert<'discounts'>;

export function useDiscounts() {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const discountsQuery = useQuery({
    queryKey: ['discounts'],
    queryFn: async (): Promise<Discount[]> => {
      const { data, error } = await supabase
        .from('discounts')
        .select('*')
        .order('name', { ascending: true });

      if (error) throw error;
      return data;
    },
  });

  const createDiscountMutation = useMutation({
    mutationFn: async (discountData: Omit<DiscountInsert, 'created_by'>) => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not authenticated');

      const { data, error } = await supabase
        .from('discounts')
        .insert({
          ...discountData,
          created_by: user.id,
        })
        .select()
        .single();

      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['discounts'] });
      toast({ title: 'Discount created successfully' });
    },
    onError: (error) => {
      toast({ title: 'Failed to create discount', description: error.message, variant: 'destructive' });
    },
  });

  const updateDiscountMutation = useMutation({
    mutationFn: async ({ id, ...data }: Partial<Discount> & { id: string }) => {
      const { error } = await supabase
        .from('discounts')
        .update({ ...data, updated_at: new Date().toISOString() })
        .eq('id', id);

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['discounts'] });
      toast({ title: 'Discount updated successfully' });
    },
    onError: (error) => {
      toast({ title: 'Failed to update discount', description: error.message, variant: 'destructive' });
    },
  });

  const toggleDiscountStatusMutation = useMutation({
    mutationFn: async ({ id, isActive }: { id: string; isActive: boolean }) => {
      const { error } = await supabase
        .from('discounts')
        .update({ is_active: isActive, updated_at: new Date().toISOString() })
        .eq('id', id);

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['discounts'] });
      toast({ title: 'Discount status updated' });
    },
    onError: (error) => {
      toast({ title: 'Failed to update discount status', description: error.message, variant: 'destructive' });
    },
  });

  return {
    discounts: discountsQuery.data || [],
    activeDiscounts: (discountsQuery.data || []).filter(d => d.is_active),
    isLoading: discountsQuery.isLoading,
    error: discountsQuery.error,
    createDiscount: createDiscountMutation.mutateAsync,
    updateDiscount: updateDiscountMutation.mutateAsync,
    toggleDiscountStatus: toggleDiscountStatusMutation.mutate,
    isCreating: createDiscountMutation.isPending,
    isUpdating: updateDiscountMutation.isPending,
  };
}
