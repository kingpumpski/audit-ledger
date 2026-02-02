import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { useProducts } from '@/hooks/useProducts';
import { sampleProducts } from '@/data/productCategories';
import { Loader2, Database, CheckCircle } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';

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
            cost_price: product.costPrice,
            unit: product.unit,
            is_service: product.isService,
            stock_quantity: product.isService ? null : Math.floor(Math.random() * 100) + 10,
            min_stock_level: product.isService ? null : 5,
            is_active: true,
          });
          success++;
        } catch (error) {
          failed++;
        }
      }

      toast({
        title: 'Products Seeded Successfully',
        description: `Added ${success} products. ${failed > 0 ? `${failed} failed.` : ''}`,
      });
      setSeeded(true);
    } catch (error: any) {
      toast({
        title: 'Seeding Failed',
        description: error.message,
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
