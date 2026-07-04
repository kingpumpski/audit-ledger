import { useEffect, useState } from 'react';
import { AppLayout } from '@/components/layout/AppLayout';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from '@/components/ui/dialog';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { Plus, Pencil, Trash2 } from 'lucide-react';
import { QueryDiagnostics, type QueryError } from '@/components/diagnostics/QueryDiagnostics';

type Discount = { id: string; code: string; name: string; type: 'percentage' | 'fixed'; value: number; is_active: boolean; valid_from?: string | null; valid_to?: string | null; usage_limit?: number | null; times_used?: number };

export default function Discounts() {
  const [items, setItems] = useState<Discount[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<QueryError>(null);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Partial<Discount> | null>(null);

  const load = async () => {
    setLoading(true);
    setLoadError(null);
    const { data, error } = await supabase.from('discounts').select('*').order('created_at', { ascending: false });
    console.debug('[Discounts] fetch', { count: data?.length ?? 0, error });
    if (error) { setLoadError(error as any); toast.error(error.message); }
    else setItems((data as any) || []);
    setLoading(false);
  };
  useEffect(() => { load(); }, []);

  const save = async () => {
    if (!editing?.code || !editing.name || editing.value === undefined) { toast.error('Code, name, and value required'); return; }
    const payload: any = {
      code: editing.code, name: editing.name, type: editing.type || 'percentage', value: Number(editing.value),
      is_active: editing.is_active ?? true, valid_from: editing.valid_from || null, valid_to: editing.valid_to || null,
      usage_limit: editing.usage_limit ?? null,
    };
    const { error } = editing.id
      ? await supabase.from('discounts').update(payload).eq('id', editing.id)
      : await supabase.from('discounts').insert(payload);
    if (error) return toast.error(error.message);
    toast.success('Saved'); setOpen(false); setEditing(null); load();
  };

  const remove = async (id: string) => {
    if (!confirm('Delete this discount?')) return;
    const { error } = await supabase.from('discounts').delete().eq('id', id);
    if (error) return toast.error(error.message);
    toast.success('Deleted'); load();
  };

  return (
    <AppLayout title="Discounts" subtitle="Promo codes and discount rules" actions={
      <Dialog open={open} onOpenChange={(v) => { setOpen(v); if (!v) setEditing(null); }}>
        <DialogTrigger asChild>
          <Button onClick={() => setEditing({ is_active: true, type: 'percentage', value: 0 })}><Plus className="mr-2 h-4 w-4" />Add Discount</Button>
        </DialogTrigger>
        <DialogContent className="max-w-lg">
          <DialogHeader><DialogTitle>{editing?.id ? 'Edit' : 'New'} Discount</DialogTitle></DialogHeader>
          <div className="grid grid-cols-2 gap-3">
            <div><Label>Code</Label><Input value={editing?.code || ''} onChange={e => setEditing({ ...editing, code: e.target.value.toUpperCase() })} /></div>
            <div><Label>Name</Label><Input value={editing?.name || ''} onChange={e => setEditing({ ...editing, name: e.target.value })} /></div>
            <div>
              <Label>Type</Label>
              <Select value={editing?.type || 'percentage'} onValueChange={v => setEditing({ ...editing, type: v as any })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent><SelectItem value="percentage">Percentage</SelectItem><SelectItem value="fixed">Fixed</SelectItem></SelectContent>
              </Select>
            </div>
            <div><Label>Value</Label><Input type="number" step="0.01" value={editing?.value ?? ''} onChange={e => setEditing({ ...editing, value: parseFloat(e.target.value) })} /></div>
            <div><Label>Valid From</Label><Input type="date" value={editing?.valid_from?.slice(0, 10) || ''} onChange={e => setEditing({ ...editing, valid_from: e.target.value })} /></div>
            <div><Label>Valid To</Label><Input type="date" value={editing?.valid_to?.slice(0, 10) || ''} onChange={e => setEditing({ ...editing, valid_to: e.target.value })} /></div>
            <div><Label>Usage Limit</Label><Input type="number" value={editing?.usage_limit ?? ''} onChange={e => setEditing({ ...editing, usage_limit: e.target.value ? parseInt(e.target.value) : null })} /></div>
            <div className="flex items-center justify-between col-span-2"><Label>Active</Label><Switch checked={editing?.is_active ?? true} onCheckedChange={v => setEditing({ ...editing, is_active: v })} /></div>
          </div>
          <DialogFooter><Button onClick={save}>Save</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    }>
      <Card><CardContent className="p-0">
        <div className="p-4 pb-0"><QueryDiagnostics label="discounts" error={loadError} count={items.length} /></div>
        <table className="data-table">
          <thead><tr><th>Code</th><th>Name</th><th>Type</th><th>Value</th><th>Used</th><th>Status</th><th className="w-24"></th></tr></thead>
          <tbody>
            {loading ? <tr><td colSpan={7} className="p-6 text-center text-muted-foreground">Loading…</td></tr> :
             items.length === 0 ? <tr><td colSpan={7} className="p-6 text-center text-muted-foreground">No discounts yet</td></tr> :
             items.map(d => (
              <tr key={d.id}>
                <td className="font-mono font-medium">{d.code}</td>
                <td>{d.name}</td>
                <td className="capitalize">{d.type}</td>
                <td>{d.type === 'percentage' ? `${d.value}%` : d.value}</td>
                <td>{d.times_used || 0}{d.usage_limit ? `/${d.usage_limit}` : ''}</td>
                <td>{d.is_active ? <span className="text-success">Active</span> : <span className="text-muted-foreground">Inactive</span>}</td>
                <td className="flex gap-1 justify-end p-2">
                  <Button variant="ghost" size="icon" onClick={() => { setEditing(d); setOpen(true); }}><Pencil className="h-4 w-4" /></Button>
                  <Button variant="ghost" size="icon" onClick={() => remove(d.id)}><Trash2 className="h-4 w-4 text-destructive" /></Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </CardContent></Card>
    </AppLayout>
  );
}