import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { Tables, TablesInsert } from '@/integrations/supabase/types';

type Product = Tables<'products'>;
type ProductInsert = TablesInsert<'products'>;
type ProductInsertWithOptionalSku = Omit<ProductInsert, 'sku'> & { sku?: string | null };

export function useProducts() {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const productsQuery = useQuery({
    queryKey: ['products'],
    queryFn: async (): Promise<Product[]> => {
      const { data, error } = await supabase
        .from('products')
        .select('*')
        .is('deleted_at', null)
        .order('name', { ascending: true });

      if (error) throw error;
      return data;
    },
  });

  const createProductMutation = useMutation({
    mutationFn: async (productData: Omit<ProductInsert, 'sku'> & { sku?: string }) => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not authenticated');

      // SKU is optional: if blank, the backend auto-generates it (enforced by a DB trigger)
      const sku = productData.sku?.trim();

      const { sku: _, ...restProductData } = productData;

      // DB trigger enforces SKU generation when missing; our generated types still mark sku as required,
      // so we use a local type here to allow sku to be omitted.
      const payload: ProductInsertWithOptionalSku = {
        ...restProductData,
        ...(sku ? { sku } : {}),
        created_by: user.id,
      };

      const { data, error } = await supabase
        .from('products')
        .insert(payload as any)
        .select()
        .single();

      if (error) throw error;

      // Record price history
      await supabase
        .from('product_price_history')
        .insert({
          product_id: data.id,
          price: productData.current_price,
          changed_by: user.id,
          change_reason: 'Initial price',
        });

      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['products'] });
      toast({ title: 'Product created successfully' });
    },
    onError: (error) => {
      toast({ title: 'Failed to create product', description: error.message, variant: 'destructive' });
    },
  });

  const updateProductMutation = useMutation({
    mutationFn: async ({ id, ...data }: Partial<Product> & { id: string; priceChangeReason?: string }) => {
      const { data: { user } } = await supabase.auth.getUser();

      // If price is changing, record history
      if (data.current_price !== undefined) {
        const { data: oldProduct } = await supabase
          .from('products')
          .select('current_price')
          .eq('id', id)
          .single();

        if (oldProduct && oldProduct.current_price !== data.current_price) {
          // Close previous price period
          await supabase
            .from('product_price_history')
            .update({ effective_to: new Date().toISOString() })
            .eq('product_id', id)
            .is('effective_to', null);

          // Create new price record
          await supabase
            .from('product_price_history')
            .insert({
              product_id: id,
              price: data.current_price,
              changed_by: user?.id,
              change_reason: data.priceChangeReason || 'Price update',
            });
        }
      }

      const { priceChangeReason, ...updateData } = data;
      const { error } = await supabase
        .from('products')
        .update(updateData)
        .eq('id', id);

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['products'] });
      toast({ title: 'Product updated successfully' });
    },
    onError: (error) => {
      toast({ title: 'Failed to update product', description: error.message, variant: 'destructive' });
    },
  });

  const deleteProductMutation = useMutation({
    mutationFn: async (id: string) => {
      // Soft delete
      const { error } = await supabase
        .from('products')
        .update({ deleted_at: new Date().toISOString(), is_active: false })
        .eq('id', id);

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['products'] });
      toast({ title: 'Product deleted' });
    },
    onError: (error) => {
      toast({ title: 'Failed to delete product', description: error.message, variant: 'destructive' });
    },
  });

  return {
    products: productsQuery.data || [],
    isLoading: productsQuery.isLoading,
    error: productsQuery.error,
    createProduct: createProductMutation.mutateAsync,
    updateProduct: updateProductMutation.mutate,
    deleteProduct: deleteProductMutation.mutate,
    isCreating: createProductMutation.isPending,
    isUpdating: updateProductMutation.isPending,
    isDeleting: deleteProductMutation.isPending,
  };
}
