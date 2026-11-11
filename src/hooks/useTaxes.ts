import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { Tables, TablesInsert } from '@/integrations/supabase/types';

export type Tax = Tables<'taxes'>;
type TaxInsert = TablesInsert<'taxes'>;

export function useTaxes() {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const taxesQuery = useQuery({
    queryKey: ['taxes'],
    queryFn: async (): Promise<Tax[]> => {
      const { data, error } = await supabase
        .from('taxes')
        .select('*')
        .order('name', { ascending: true });

      if (error) throw error;
      return data;
    },
  });

  const createTaxMutation = useMutation({
    mutationFn: async (taxData: Omit<TaxInsert, 'created_by'>) => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not authenticated');

      const { data, error } = await supabase
        .from('taxes')
        .insert({
          ...taxData,
          created_by: user.id,
        })
        .select()
        .single();

      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['taxes'] });
      toast({ title: 'Tax created successfully' });
    },
    onError: (error) => {
      toast({ title: 'Failed to create tax', description: error.message, variant: 'destructive' });
    },
  });

  const updateTaxMutation = useMutation({
    mutationFn: async ({ id, ...data }: Partial<Tax> & { id: string }) => {
      const { error } = await supabase
        .from('taxes')
        .update({ ...data, updated_at: new Date().toISOString() })
        .eq('id', id);

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['taxes'] });
      toast({ title: 'Tax updated successfully' });
    },
    onError: (error) => {
      toast({ title: 'Failed to update tax', description: error.message, variant: 'destructive' });
    },
  });

  const toggleTaxStatusMutation = useMutation({
    mutationFn: async ({ id, isActive }: { id: string; isActive: boolean }) => {
      const { error } = await supabase
        .from('taxes')
        .update({ is_active: isActive, updated_at: new Date().toISOString() })
        .eq('id', id);

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['taxes'] });
      toast({ title: 'Tax status updated' });
    },
    onError: (error) => {
      toast({ title: 'Failed to update tax status', description: error.message, variant: 'destructive' });
    },
  });

  return {
    taxes: taxesQuery.data || [],
    activeTaxes: (taxesQuery.data || []).filter(t => t.is_active),
    isLoading: taxesQuery.isLoading,
    error: taxesQuery.error,
    createTax: createTaxMutation.mutateAsync,
    updateTax: updateTaxMutation.mutateAsync,
    toggleTaxStatus: toggleTaxStatusMutation.mutate,
    isCreating: createTaxMutation.isPending,
    isUpdating: updateTaxMutation.isPending,
  };
}
