import { useState, useMemo } from 'react';
import { AppLayout } from '@/components/layout/AppLayout';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useProducts } from '@/hooks/useProducts';
import { useSettings } from '@/hooks/useSettings';
import { CSVImport } from '@/components/import/CSVImport';
import { SeedProductsButton } from '@/components/admin/SeedProductsButton';
import { productCategories, sampleProducts, currencyOptions } from '@/data/productCategories';
import { 
  Plus, 
  Search, 
  Filter, 
  Package, 
  MoreHorizontal,
  Loader2,
  Edit,
  Trash2,
  Eye,
  Boxes
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { type Product } from '@/hooks/useProducts';

export default function Products() {
  const { products, isLoading, createProduct, updateProduct, updateProductAsync, deleteProduct, isCreating, isUpdating } = useProducts();
  const { settings } = useSettings();
  const [searchQuery, setSearchQuery] = useState('');
  const [categoryFilter, setCategoryFilter] = useState<string>('all');
  const [isAddDialogOpen, setIsAddDialogOpen] = useState(false);
  const [selectedProduct, setSelectedProduct] = useState<Product | null>(null);
  const [isEditingProduct, setIsEditingProduct] = useState(false);
  const [editFormData, setEditFormData] = useState({
    name: '', sku: '', description: '', category: '', current_price: 0,
    cost_price: 0, stock_quantity: 0, min_stock_level: 0, unit: 'piece',
    is_service: false, is_active: true,
  });

  const openProductDetails = (product: Product) => {
    setSelectedProduct(product);
    setIsEditingProduct(false);
    setEditFormData({
      name: product.name,
      sku: product.sku || '',
      description: product.description || '',
      category: product.category || '',
      current_price: Number(product.current_price) || 0,
      cost_price: Number(product.cost_price) || 0,
      stock_quantity: Number(product.stock_quantity) || 0,
      min_stock_level: Number(product.min_stock_level) || 0,
      unit: product.unit || 'piece',
      is_service: Boolean(product.is_service),
      is_active: product.is_active ?? true,
    });
  };

  const handleSaveProduct = async () => {
    if (!selectedProduct || !editFormData.name.trim()) return;
    try {
      await updateProductAsync({
        id: selectedProduct.id,
        name: editFormData.name.trim(),
        sku: editFormData.sku.trim(),
        description: editFormData.description.trim() || null,
        category: editFormData.category.trim() || null,
        current_price: editFormData.current_price,
        cost_price: editFormData.cost_price,
        stock_quantity: editFormData.is_service ? null : editFormData.stock_quantity,
        min_stock_level: editFormData.is_service ? null : editFormData.min_stock_level,
        unit: editFormData.unit,
        is_service: editFormData.is_service,
        is_active: editFormData.is_active,
      });
      setSelectedProduct(null);
      setIsEditingProduct(false);
    } catch (error) {
      console.error('Failed to update product:', error);
    }
  };
  
  // Form state
  const [formData, setFormData] = useState({
    name: '',
    sku: '', // Optional SKU field
    description: '',
    category: '',
    current_price: 0,
    cost_price: 0,
    stock_quantity: 0,
    min_stock_level: 0,
    unit: 'piece',
    is_service: false,
    is_active: true,
  });

  const currencySymbol = settings?.currency_symbol || '$';

  const filteredProducts = useMemo(() => {
    return products.filter(product => {
      const matchesSearch = 
        product.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        product.sku.toLowerCase().includes(searchQuery.toLowerCase()) ||
        (product.description?.toLowerCase().includes(searchQuery.toLowerCase()) ?? false);
      
      const matchesCategory = categoryFilter === 'all' || product.category === categoryFilter;
      
      return matchesSearch && matchesCategory;
    });
  }, [products, searchQuery, categoryFilter]);

  const categories = useMemo(() => {
    const cats = new Set(products.map(p => p.category).filter(Boolean));
    return Array.from(cats).sort();
  }, [products]);

  const handleSubmit = async () => {
    // Auto-generate SKU from category if not provided
    let sku = formData.sku;
    if (!sku && formData.category) {
      const { getSKUPrefix } = await import('@/components/settings/SKUSettings');
      const prefix = getSKUPrefix(formData.category);
      // Count existing products in category to determine next number
      const categoryCount = products.filter(p => p.category === formData.category).length;
      sku = `${prefix}-${String(categoryCount + 1).padStart(3, '0')}`;
    }

    try {
      await createProduct({
        name: formData.name,
        sku: sku || undefined,
        description: formData.description,
        category: formData.category,
        current_price: formData.current_price,
        cost_price: formData.cost_price,
        stock_quantity: formData.is_service ? null : formData.stock_quantity,
        min_stock_level: formData.is_service ? null : formData.min_stock_level,
        unit: formData.unit,
        is_service: formData.is_service,
        is_active: formData.is_active,
      });
      setIsAddDialogOpen(false);
      resetForm();
    } catch (error) {
      console.error('Failed to create product:', error);
    }
  };

  const resetForm = () => {
    setFormData({
      name: '',
      sku: '',
      description: '',
      category: '',
      current_price: 0,
      cost_price: 0,
      stock_quantity: 0,
      min_stock_level: 0,
      unit: 'piece',
      is_service: false,
      is_active: true,
    });
  };

  const handleImportProducts = async (data: Record<string, string>[]): Promise<{ success: number; failed: number }> => {
    let success = 0;
    let failed = 0;

    for (const item of data) {
      try {
        await createProduct({
          name: item.name,
          description: item.description || '',
          category: item.category || 'Uncategorized',
          current_price: parseFloat(item.price || item.current_price) || 0,
          cost_price: parseFloat(item.cost_price) || 0,
          stock_quantity: parseInt(item.stock_quantity) || null,
          unit: item.unit || 'piece',
          is_service: item.is_service === 'true',
          is_active: true,
        });
        success++;
      } catch (error) {
        failed++;
      }
    }

    return { success, failed };
  };

  const sampleCSVData = [
    { name: 'Sample Product', description: 'Product description', category: 'Electronics', price: '99.99', cost_price: '60.00', stock_quantity: '100', unit: 'piece', is_service: 'false' },
    { name: 'Consulting Service', description: 'Hourly consulting', category: 'Services', price: '150.00', cost_price: '0', stock_quantity: '', unit: 'hour', is_service: 'true' },
  ];

  return (
    <AppLayout
      title="Products & Services"
      subtitle="Manage your product catalog and inventory"
      actions={
        <div className="flex gap-2">
          <SeedProductsButton />
          <CSVImport
            entityType="products"
            onImport={handleImportProducts}
            sampleData={sampleCSVData}
            requiredFields={['name', 'price']}
            optionalFields={['description', 'category', 'cost_price', 'stock_quantity', 'unit', 'is_service']}
          />
          <Dialog open={isAddDialogOpen} onOpenChange={setIsAddDialogOpen}>
            <DialogTrigger asChild>
              <Button>
                <Plus className="mr-2 h-4 w-4" />
                Add Product
              </Button>
            </DialogTrigger>
            <DialogContent className="flex max-h-[85dvh] max-w-2xl flex-col overflow-hidden">
              <DialogHeader>
                <DialogTitle>Add New Product</DialogTitle>
                <DialogDescription>
                  Add a new product or service to your catalog
                </DialogDescription>
              </DialogHeader>
              <div className="min-h-0 flex-1 space-y-4 overflow-y-auto overscroll-contain py-4 pr-2">
                <div className="grid gap-4 md:grid-cols-2">
                  <div className="space-y-2">
                    <Label>Product Name *</Label>
                    <Input
                      value={formData.name}
                      onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                      placeholder="Enter product name"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>SKU (Optional)</Label>
                    <Input
                      value={formData.sku}
                      onChange={(e) => setFormData({ ...formData, sku: e.target.value })}
                      placeholder="Auto-generated if left blank"
                    />
                    <p className="text-xs text-muted-foreground">
                      Stock Keeping Unit - unique product identifier. Leave blank to auto-generate.
                    </p>
                  </div>
                </div>

                <div className="grid gap-4 md:grid-cols-2">
                  <div className="space-y-2">
                    <Label>Category</Label>
                    <Select
                      value={formData.category}
                      onValueChange={(v) => setFormData({ ...formData, category: v })}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="Select category" />
                      </SelectTrigger>
                      <SelectContent>
                        {productCategories.map(cat => (
                          <SelectItem key={cat} value={cat}>{cat}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label>Unit</Label>
                    <Select
                      value={formData.unit}
                      onValueChange={(v) => setFormData({ ...formData, unit: v })}
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="piece">Piece</SelectItem>
                        <SelectItem value="unit">Unit</SelectItem>
                        <SelectItem value="hour">Hour</SelectItem>
                        <SelectItem value="day">Day</SelectItem>
                        <SelectItem value="kg">Kilogram</SelectItem>
                        <SelectItem value="meter">Meter</SelectItem>
                        <SelectItem value="pack">Pack</SelectItem>
                        <SelectItem value="set">Set</SelectItem>
                        <SelectItem value="kit">Kit</SelectItem>
                        <SelectItem value="box">Box</SelectItem>
                        <SelectItem value="pair">Pair</SelectItem>
                        <SelectItem value="bottle">Bottle</SelectItem>
                        <SelectItem value="roll">Roll</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                <div className="space-y-2">
                  <Label>Description</Label>
                  <Textarea
                    value={formData.description}
                    onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                    placeholder="Product description"
                    rows={2}
                  />
                </div>

                <div className="grid gap-4 md:grid-cols-2">
                  <div className="space-y-2">
                    <Label>Price ({currencySymbol}) *</Label>
                    <Input
                      type="number"
                      min="0"
                      step="0.01"
                      value={formData.current_price || ''}
                      onChange={(e) => setFormData({ ...formData, current_price: parseFloat(e.target.value) || 0 })}
                      placeholder="0.00"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>Cost Price ({currencySymbol})</Label>
                    <Input
                      type="number"
                      min="0"
                      step="0.01"
                      value={formData.cost_price || ''}
                      onChange={(e) => setFormData({ ...formData, cost_price: parseFloat(e.target.value) || 0 })}
                      placeholder="0.00"
                    />
                  </div>
                </div>

                <div className="grid gap-4 md:grid-cols-2">
                  <div className="space-y-2">
                    <Label>Stock Quantity</Label>
                    <Input
                      type="number"
                      min="0"
                      value={formData.stock_quantity || ''}
                      onChange={(e) => setFormData({ ...formData, stock_quantity: parseInt(e.target.value) || 0 })}
                      placeholder="0"
                      disabled={formData.is_service}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>Min Stock Level</Label>
                    <Input
                      type="number"
                      min="0"
                      value={formData.min_stock_level || ''}
                      onChange={(e) => setFormData({ ...formData, min_stock_level: parseInt(e.target.value) || 0 })}
                      placeholder="0"
                      disabled={formData.is_service}
                    />
                  </div>
                </div>

                <div className="flex items-center gap-6">
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={formData.is_service}
                      onChange={(e) => setFormData({ ...formData, is_service: e.target.checked })}
                      className="rounded border-border"
                    />
                    <span className="text-sm">This is a service (no stock tracking)</span>
                  </label>
                </div>
              </div>

              <div className="sticky bottom-0 z-10 flex shrink-0 justify-end gap-3 border-t bg-background pt-4">
                <Button variant="outline" onClick={() => setIsAddDialogOpen(false)}>
                  Cancel
                </Button>
                <Button onClick={handleSubmit} disabled={isCreating || !formData.name || !formData.current_price}>
                  {isCreating ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Creating...
                    </>
                  ) : (
                    <>
                      <Plus className="mr-2 h-4 w-4" />
                      Create Product
                    </>
                  )}
                </Button>
              </div>
            </DialogContent>
          </Dialog>
        </div>
      }
    >
      {/* Stats */}
      <div className="grid gap-4 md:grid-cols-4 mb-6">
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-primary/10">
                <Boxes className="h-5 w-5 text-primary" />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Total Products</p>
                <p className="text-2xl font-bold">{products.length}</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-success/10">
                <Package className="h-5 w-5 text-success" />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Active</p>
                <p className="text-2xl font-bold">{products.filter(p => p.is_active).length}</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-warning/10">
                <Package className="h-5 w-5 text-warning" />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Low Stock</p>
                <p className="text-2xl font-bold">
                  {products.filter(p => 
                    p.stock_quantity !== null && 
                    p.min_stock_level !== null && 
                    p.stock_quantity <= p.min_stock_level
                  ).length}
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-info/10">
                <Filter className="h-5 w-5 text-info" />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Categories</p>
                <p className="text-2xl font-bold">{categories.length}</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardContent className="p-0">
          <div className="flex items-center gap-3 p-4 border-b">
            <div className="relative flex-1 max-w-sm">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input 
                placeholder="Search by name, SKU, or description..." 
                className="pl-9"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
            </div>
            <Select value={categoryFilter} onValueChange={setCategoryFilter}>
              <SelectTrigger className="w-[200px]">
                <SelectValue placeholder="All Categories" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Categories</SelectItem>
                {categories.map(cat => (
                  <SelectItem key={cat} value={cat}>{cat}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {isLoading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            </div>
          ) : filteredProducts.length === 0 ? (
            <div className="text-center py-12">
              <Package className="h-12 w-12 mx-auto text-muted-foreground/50" />
              <h3 className="mt-4 text-lg font-medium">No products found</h3>
              <p className="text-muted-foreground">
                {searchQuery || categoryFilter !== 'all' 
                  ? 'Try adjusting your filters' 
                  : 'Add your first product to get started'}
              </p>
            </div>
          ) : (
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
                {filteredProducts.map((product) => (
                  <tr key={product.id}>
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
                    <td>
                      <Badge variant="secondary">{product.category || 'Uncategorized'}</Badge>
                    </td>
                    <td className="font-medium">
                      {currencySymbol}{product.current_price.toFixed(2)}
                    </td>
                    <td className="text-muted-foreground">
                      {product.is_service ? (
                        <span className="text-info">Service</span>
                      ) : product.stock_quantity !== null ? (
                        <span className={cn(
                          product.min_stock_level && product.stock_quantity <= product.min_stock_level
                            ? 'text-warning font-medium'
                            : ''
                        )}>
                          {product.stock_quantity}
                        </span>
                      ) : '—'}
                    </td>
                    <td>
                      <Badge 
                        variant={product.is_active ? 'default' : 'secondary'} 
                        className={product.is_active ? 'bg-success/10 text-success' : ''}
                      >
                        {product.is_active ? 'Active' : 'Inactive'}
                      </Badge>
                    </td>
                    <td>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="icon" className="h-8 w-8">
                            <MoreHorizontal className="h-4 w-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem onClick={() => openProductDetails(product)}>
                            <Eye className="mr-2 h-4 w-4" />
                            View Details
                          </DropdownMenuItem>
                          <DropdownMenuItem onClick={() => {
                            openProductDetails(product);
                            setIsEditingProduct(true);
                          }}>
                            <Edit className="mr-2 h-4 w-4" />
                            Edit Product
                          </DropdownMenuItem>
                          <DropdownMenuItem 
                            onClick={() => updateProduct({ 
                              id: product.id, 
                              is_active: !product.is_active 
                            })}
                          >
                            <Edit className="mr-2 h-4 w-4" />
                            {product.is_active ? 'Deactivate' : 'Activate'}
                          </DropdownMenuItem>
                          <DropdownMenuItem 
                            className="text-destructive"
                            onClick={() => deleteProduct(product.id)}
                          >
                            <Trash2 className="mr-2 h-4 w-4" />
                            Delete
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>

      {/* Product Details Dialog */}
      <Dialog open={!!selectedProduct} onOpenChange={(open) => { if (!open) { setSelectedProduct(null); setIsEditingProduct(false); } }}>
        <DialogContent className="max-h-[85dvh] max-w-2xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{isEditingProduct ? 'Edit Product or Service' : selectedProduct?.name}</DialogTitle>
            <DialogDescription>{isEditingProduct ? 'Correct product details without creating a duplicate.' : `SKU: ${selectedProduct?.sku}`}</DialogDescription>
          </DialogHeader>
          {selectedProduct && (isEditingProduct ? (
            <div className="space-y-4">
              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-2"><Label>Product Name *</Label><Input value={editFormData.name} onChange={e => setEditFormData(v => ({ ...v, name: e.target.value }))} /></div>
                <div className="space-y-2"><Label>SKU</Label><Input value={editFormData.sku} onChange={e => setEditFormData(v => ({ ...v, sku: e.target.value }))} /></div>
                <div className="space-y-2"><Label>Category</Label><Input value={editFormData.category} onChange={e => setEditFormData(v => ({ ...v, category: e.target.value }))} /></div>
                <div className="space-y-2"><Label>Unit</Label><Input value={editFormData.unit} onChange={e => setEditFormData(v => ({ ...v, unit: e.target.value }))} /></div>
                <div className="space-y-2"><Label>Selling Price ({currencySymbol})</Label><Input type="number" min="0" step="0.01" value={editFormData.current_price} onChange={e => setEditFormData(v => ({ ...v, current_price: Number(e.target.value) }))} /></div>
                <div className="space-y-2"><Label>Cost Price ({currencySymbol})</Label><Input type="number" min="0" step="0.01" value={editFormData.cost_price} onChange={e => setEditFormData(v => ({ ...v, cost_price: Number(e.target.value) }))} /></div>
                <div className="space-y-2"><Label>Stock Quantity</Label><Input type="number" min="0" disabled={editFormData.is_service} value={editFormData.stock_quantity} onChange={e => setEditFormData(v => ({ ...v, stock_quantity: Number(e.target.value) }))} /></div>
                <div className="space-y-2"><Label>Minimum Stock Level</Label><Input type="number" min="0" disabled={editFormData.is_service} value={editFormData.min_stock_level} onChange={e => setEditFormData(v => ({ ...v, min_stock_level: Number(e.target.value) }))} /></div>
              </div>
              <div className="space-y-2"><Label>Description</Label><Textarea rows={3} value={editFormData.description} onChange={e => setEditFormData(v => ({ ...v, description: e.target.value }))} /></div>
              <div className="flex flex-wrap gap-6">
                <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={editFormData.is_service} onChange={e => setEditFormData(v => ({ ...v, is_service: e.target.checked }))} /> Service (no stock tracking)</label>
                <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={editFormData.is_active} onChange={e => setEditFormData(v => ({ ...v, is_active: e.target.checked }))} /> Active</label>
              </div>
              <div className="flex justify-end gap-2 border-t pt-4">
                <Button variant="outline" onClick={() => setIsEditingProduct(false)}>Cancel</Button>
                <Button onClick={handleSaveProduct} disabled={isUpdating || !editFormData.name.trim() || editFormData.current_price < 0}>
                  {isUpdating ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Edit className="mr-2 h-4 w-4" />}Save Changes
                </Button>
              </div>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div><p className="text-sm text-muted-foreground">Category</p><p className="font-medium">{selectedProduct.category || 'Uncategorized'}</p></div>
                <div><p className="text-sm text-muted-foreground">Type</p><p className="font-medium">{selectedProduct.is_service ? 'Service' : 'Product'}</p></div>
                <div><p className="text-sm text-muted-foreground">Price</p><p className="font-medium">{currencySymbol}{selectedProduct.current_price.toFixed(2)}</p></div>
                <div><p className="text-sm text-muted-foreground">Cost</p><p className="font-medium">{currencySymbol}{(selectedProduct.cost_price || 0).toFixed(2)}</p></div>
                {!selectedProduct.is_service && <><div><p className="text-sm text-muted-foreground">Stock</p><p className="font-medium">{selectedProduct.stock_quantity ?? '—'}</p></div><div><p className="text-sm text-muted-foreground">Min Stock Level</p><p className="font-medium">{selectedProduct.min_stock_level ?? '—'}</p></div></>}
              </div>
              {selectedProduct.description && <div><p className="text-sm text-muted-foreground">Description</p><p className="text-sm">{selectedProduct.description}</p></div>}
              <div className="flex justify-end border-t pt-4"><Button onClick={() => setIsEditingProduct(true)}><Edit className="mr-2 h-4 w-4" />Edit Product</Button></div>
            </div>
          ))}
        </DialogContent>
      </Dialog>
    </AppLayout>
  );
}
