import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { useProducts } from '@/hooks/useProducts';
import { sampleProducts } from '@/data/productCategories';
import { Loader2, Database, CheckCircle } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { getErrorMessage } from '@/lib/error-message';

export function SeedProductsButton() {
  const [isSeeding, setIsSeeding] = useState(false);
  const [seeded, setSeeded] = useState(false);
  const { createProduct } = useProducts();
  const { toast } = useToast();

  const handleSeedProducts = async () => {
    setIsSeeding(true);
    let success = 0;
    let failed = 0;

    try {
      for (const product of sampleProducts) {
        try {
          await createProduct({
            name: product.name,
            description: product.description,
            category: product.category,
            current_price: product.price,
            cost_price: null,
            unit: product.unit,
            is_service: product.isService,
            stock_quantity: product.isService ? null : 0,
            min_stock_level: product.isService ? null : 5,
            is_active: true,
            // SKU is NOT passed - system will auto-generate
          });
          success++;
        } catch (error) {
          console.error(`Failed to seed product ${product.name}:`, error);
          failed++;
        }
      }

      toast({
        title: 'Products Seeded Successfully',
        description: `Added ${success} products. ${failed > 0 ? `${failed} failed.` : ''}`,
      });
      setSeeded(true);
    } catch (error: unknown) {
      toast({
        title: 'Seeding Failed',
        description: getErrorMessage(error, 'An unexpected error occurred.'),
        variant: 'destructive',
      });
    } finally {
      setIsSeeding(false);
    }
  };

  if (seeded) {
    return (
      <Button variant="outline" disabled className="gap-2">
        <CheckCircle className="h-4 w-4 text-success" />
        Products Seeded
      </Button>
    );
  }

  return (
    <Button onClick={handleSeedProducts} disabled={isSeeding} variant="outline" className="gap-2">
      {isSeeding ? (
        <>
          <Loader2 className="h-4 w-4 animate-spin" />
          Seeding {sampleProducts.length} Products...
        </>
      ) : (
        <>
          <Database className="h-4 w-4" />
          Seed Sample Products
        </>
      )}
    </Button>
  );
}
