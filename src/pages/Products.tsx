import { AppLayout } from '@/components/layout/AppLayout';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Plus, Search, Filter, Package, MoreHorizontal } from 'lucide-react';
import { Link } from 'react-router-dom';

const mockProducts = [
  { sku: 'PROD-001', name: 'Consulting Hour', price: 150, category: 'Services', stock: null, active: true },
  { sku: 'PROD-002', name: 'Widget Pro', price: 49.99, category: 'Products', stock: 234, active: true },
  { sku: 'PROD-003', name: 'Premium Support Plan', price: 299, category: 'Services', stock: null, active: true },
  { sku: 'PROD-004', name: 'Starter Kit', price: 89, category: 'Products', stock: 12, active: false },
];

export default function Products() {
  return (
    <AppLayout
      title="Products & Services"
      subtitle="Manage your product catalog"
      actions={
        <Button asChild>
          <Link to="/products/new">
            <Plus className="mr-2 h-4 w-4" />
            Add Product
          </Link>
        </Button>
      }
    >
      <Card>
        <CardContent className="p-0">
          <div className="flex items-center gap-3 p-4 border-b">
            <div className="relative flex-1 max-w-sm">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input placeholder="Search products..." className="pl-9" />
            </div>
            <Button variant="outline" size="sm">
              <Filter className="mr-2 h-4 w-4" />
              Filters
            </Button>
          </div>

          <table className="data-table">
            <thead>
              <tr>
                <th>Product</th>
                <th>Category</th>
                <th>Price</th>
                <th>Stock</th>
                <th>Status</th>
                <th className="w-10"></th>
              </tr>
            </thead>
            <tbody>
              {mockProducts.map((product) => (
                <tr key={product.sku}>
                  <td>
                    <div className="flex items-center gap-3">
                      <div className="w-9 h-9 rounded-lg bg-muted flex items-center justify-center">
                        <Package className="h-4 w-4 text-muted-foreground" />
                      </div>
                      <div>
                        <p className="font-medium">{product.name}</p>
                        <p className="text-xs text-muted-foreground">{product.sku}</p>
                      </div>
                    </div>
                  </td>
                  <td><Badge variant="secondary">{product.category}</Badge></td>
                  <td className="font-medium">${product.price.toFixed(2)}</td>
                  <td className="text-muted-foreground">{product.stock ?? '—'}</td>
                  <td>
                    <Badge variant={product.active ? 'default' : 'secondary'} className={product.active ? 'bg-success/10 text-success' : ''}>
                      {product.active ? 'Active' : 'Inactive'}
                    </Badge>
                  </td>
                  <td>
                    <Button variant="ghost" size="icon" className="h-8 w-8">
                      <MoreHorizontal className="h-4 w-4" />
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>
    </AppLayout>
  );
}
