import { useEffect, useState } from 'react';
import { AppLayout } from '@/components/layout/AppLayout';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from '@/components/ui/dialog';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { Plus, Pencil, Trash2 } from 'lucide-react';

type Tax = { id: string; name: string; rate: number; is_active: boolean; is_inclusive?: boolean; description?: string | null };

export default function Taxes() {
  const [items, setItems] = useState<Tax[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Partial<Tax> | null>(null);

  const load = async () => {
    setLoading(true);
    const { data, error } = await supabase.from('taxes').select('*').order('created_at', { ascending: false });
    if (error) toast.error(error.message); else setItems((data as any) || []);
    setLoading(false);
  };
  useEffect(() => { load(); }, []);

  const save = async () => {
    if (!editing?.name || editing.rate === undefined) { toast.error('Name and rate required'); return; }
    const payload: any = { name: editing.name, rate: Number(editing.rate), is_active: editing.is_active ?? true, is_inclusive: editing.is_inclusive ?? false, description: editing.description || null };
    const { error } = editing.id
      ? await supabase.from('taxes').update(payload).eq('id', editing.id)
      : await supabase.from('taxes').insert(payload);
    if (error) return toast.error(error.message);
    toast.success('Saved'); setOpen(false); setEditing(null); load();
  };

  const remove = async (id: string) => {
    if (!confirm('Delete this tax?')) return;
    const { error } = await supabase.from('taxes').delete().eq('id', id);
    if (error) return toast.error(error.message);
    toast.success('Deleted'); load();
  };

  return (
    <AppLayout title="Taxes" subtitle="Manage tax rates applied to invoices" actions={
      <Dialog open={open} onOpenChange={(v) => { setOpen(v); if (!v) setEditing(null); }}>
        <DialogTrigger asChild>
          <Button onClick={() => setEditing({ is_active: true, rate: 0 })}><Plus className="mr-2 h-4 w-4" />Add Tax</Button>
        </DialogTrigger>
        <DialogContent>
          <DialogHeader><DialogTitle>{editing?.id ? 'Edit' : 'New'} Tax</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div><Label>Name</Label><Input value={editing?.name || ''} onChange={e => setEditing({ ...editing, name: e.target.value })} /></div>
            <div><Label>Rate (%)</Label><Input type="number" step="0.01" value={editing?.rate ?? ''} onChange={e => setEditing({ ...editing, rate: parseFloat(e.target.value) })} /></div>
            <div><Label>Description</Label><Input value={editing?.description || ''} onChange={e => setEditing({ ...editing, description: e.target.value })} /></div>
            <div className="flex items-center justify-between"><Label>Active</Label><Switch checked={editing?.is_active ?? true} onCheckedChange={v => setEditing({ ...editing, is_active: v })} /></div>
            <div className="flex items-center justify-between"><Label>Inclusive</Label><Switch checked={editing?.is_inclusive ?? false} onCheckedChange={v => setEditing({ ...editing, is_inclusive: v })} /></div>
          </div>
          <DialogFooter><Button onClick={save}>Save</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    }>
      <Card><CardContent className="p-0">
        <table className="data-table">
          <thead><tr><th>Name</th><th>Rate</th><th>Status</th><th>Description</th><th className="w-24"></th></tr></thead>
          <tbody>
            {loading ? <tr><td colSpan={5} className="p-6 text-center text-muted-foreground">Loading…</td></tr> :
             items.length === 0 ? <tr><td colSpan={5} className="p-6 text-center text-muted-foreground">No taxes yet</td></tr> :
             items.map(t => (
              <tr key={t.id}>
                <td className="font-medium">{t.name}</td>
                <td>{Number(t.rate).toFixed(2)}%</td>
                <td>{t.is_active ? <span className="text-success">Active</span> : <span className="text-muted-foreground">Inactive</span>}</td>
                <td className="text-muted-foreground">{t.description || '—'}</td>
                <td className="flex gap-1 justify-end p-2">
                  <Button variant="ghost" size="icon" onClick={() => { setEditing(t); setOpen(true); }}><Pencil className="h-4 w-4" /></Button>
                  <Button variant="ghost" size="icon" onClick={() => remove(t.id)}><Trash2 className="h-4 w-4 text-destructive" /></Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </CardContent></Card>
    </AppLayout>
  );
}