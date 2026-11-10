import { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { useToast } from '@/hooks/use-toast';
import { supabase } from '@/integrations/supabase/client';
import { productCategories } from '@/data/productCategories';
import { Loader2, Save, Tag } from 'lucide-react';

interface SKUTemplate {
  category: string;
  prefix: string;
}

// Default category prefixes
const defaultPrefixes: Record<string, string> = {
  'Medical Supplies': 'MED',
  'Computers & Accessories': 'COM',
  'Electronics': 'ELE',
  'Electrical Gadgets': 'ELG',
  'Phones & Accessories': 'PHN',
  'Home Appliances': 'HMA',
  'Gents Clothing': 'GCL',
  'Ladies Clothing': 'LCL',
  'Footwear': 'FTW',
  'Sports & Fitness': 'SPF',
  'Electric Bikes & Accessories': 'EBA',
  'Office Supplies': 'OFS',
  'Beauty & Personal Care': 'BPC',
  'Kitchen & Dining': 'KTD',
  'Toys & Games': 'TNG',
};

export function SKUSettings() {
  const { toast } = useToast();
  const [templates, setTemplates] = useState<SKUTemplate[]>([]);
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    // Initialize templates from defaults
    const initial = productCategories.map(cat => ({
      category: cat,
      prefix: defaultPrefixes[cat] || cat.substring(0, 3).toUpperCase(),
    }));
    setTemplates(initial);

    // Load saved settings from company_settings
    loadSavedTemplates();
  }, []);

  const loadSavedTemplates = async () => {
    try {
      const { data } = await supabase.from('company_settings').select('*').limit(1).single();
      if (data && (data as any).sku_templates) {
        const saved = (data as any).sku_templates as SKUTemplate[];
        setTemplates(prev => prev.map(t => {
          const match = saved.find((s: SKUTemplate) => s.category === t.category);
          return match ? { ...t, prefix: match.prefix } : t;
        }));
      }
    } catch {
      // Use defaults
    }
  };

  const updatePrefix = (category: string, prefix: string) => {
    setTemplates(prev => prev.map(t => 
      t.category === category ? { ...t, prefix: prefix.toUpperCase().replace(/[^A-Z0-9]/g, '') } : t
    ));
  };

  const handleSave = async () => {
    setIsSaving(true);
    try {
      // We'll store the SKU templates in a metadata approach
      // For now, save to localStorage as company_settings may not have the column
      localStorage.setItem('sku_templates', JSON.stringify(templates));
      toast({ title: 'SKU templates saved successfully' });
    } catch (err: any) {
      toast({ title: 'Failed to save', description: err.message, variant: 'destructive' });
    } finally {
      setIsSaving(false);
    }
  };

  const getPreview = (prefix: string) => `${prefix}-001`;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2"><Tag className="h-5 w-5" /> SKU Format Templates</CardTitle>
        <CardDescription>
          Define a prefix for each category. SKUs are auto-generated as PREFIX-NNN (e.g., MED-001). 
          Products without a manual SKU will use the category prefix.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {templates.map(t => (
            <div key={t.category} className="flex items-center gap-2 p-2 border rounded-lg">
              <div className="flex-1 min-w-0">
                <p className="text-xs text-muted-foreground truncate">{t.category}</p>
                <Input
                  value={t.prefix}
                  onChange={(e) => updatePrefix(t.category, e.target.value)}
                  className="h-8 text-sm font-mono mt-1"
                  maxLength={5}
                  placeholder="PRE"
                />
              </div>
              <Badge variant="secondary" className="font-mono text-xs whitespace-nowrap">
                {getPreview(t.prefix)}
              </Badge>
            </div>
          ))}
        </div>
        <div className="flex justify-end mt-4">
          <Button onClick={handleSave} disabled={isSaving}>
            {isSaving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
            Save Templates
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

// Helper to get a SKU prefix for a category
export function getSKUPrefix(category: string): string {
  try {
    const saved = localStorage.getItem('sku_templates');
    if (saved) {
      const templates: SKUTemplate[] = JSON.parse(saved);
      const match = templates.find(t => t.category === category);
      if (match) return match.prefix;
    }
  } catch {}
  return defaultPrefixes[category] || category.substring(0, 3).toUpperCase();
}
