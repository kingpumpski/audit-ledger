import { useEffect, useState } from 'react';
import { AppLayout } from '@/components/layout/AppLayout';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

export default function Settings() {
  const [s, setS] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      const { data, error } = await supabase.from('company_settings').select('*').limit(1).maybeSingle();
      if (error) toast.error(error.message); else setS(data || {});
      setLoading(false);
    })();
  }, []);

  const save = async () => {
    if (!s) return;
    const { id, created_at, updated_at, ...payload } = s;
    const { error } = id
      ? await supabase.from('company_settings').update(payload).eq('id', id)
      : await supabase.from('company_settings').insert(payload);
    if (error) return toast.error(error.message);
    toast.success('Settings saved');
  };

  const f = (k: string) => s?.[k] ?? '';
  const set = (k: string, v: any) => setS({ ...s, [k]: v });

  if (loading) return <AppLayout title="Settings"><Card><CardContent className="p-6">Loading…</CardContent></Card></AppLayout>;

  return (
    <AppLayout title="Settings" subtitle="Company information, document defaults, and notifications" actions={<Button onClick={save}>Save changes</Button>}>
      <Tabs defaultValue="company" className="space-y-4">
        <TabsList>
          <TabsTrigger value="company">Company</TabsTrigger>
          <TabsTrigger value="documents">Documents</TabsTrigger>
          <TabsTrigger value="notifications">Notifications</TabsTrigger>
        </TabsList>
        <TabsContent value="company">
          <Card><CardHeader><CardTitle>Company information</CardTitle></CardHeader>
            <CardContent className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div><Label>Company name</Label><Input value={f('company_name')} onChange={e => set('company_name', e.target.value)} /></div>
              <div><Label>Email</Label><Input value={f('company_email')} onChange={e => set('company_email', e.target.value)} /></div>
              <div><Label>Phone</Label><Input value={f('company_phone')} onChange={e => set('company_phone', e.target.value)} /></div>
              <div><Label>Tax ID</Label><Input value={f('company_tax_id')} onChange={e => set('company_tax_id', e.target.value)} /></div>
              <div className="md:col-span-2"><Label>Address</Label><Input value={f('company_address')} onChange={e => set('company_address', e.target.value)} /></div>
              <div><Label>City</Label><Input value={f('company_city')} onChange={e => set('company_city', e.target.value)} /></div>
              <div><Label>Country</Label><Input value={f('company_country')} onChange={e => set('company_country', e.target.value)} /></div>
              <div><Label>Currency code</Label><Input value={f('currency_code')} onChange={e => set('currency_code', e.target.value)} /></div>
              <div><Label>Currency symbol</Label><Input value={f('currency_symbol')} onChange={e => set('currency_symbol', e.target.value)} /></div>
            </CardContent>
          </Card>
        </TabsContent>
        <TabsContent value="documents">
          <Card><CardHeader><CardTitle>Document prefixes & defaults</CardTitle></CardHeader>
            <CardContent className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div><Label>Invoice prefix</Label><Input value={f('invoice_prefix')} onChange={e => set('invoice_prefix', e.target.value)} /></div>
              <div><Label>Receipt prefix</Label><Input value={f('receipt_prefix')} onChange={e => set('receipt_prefix', e.target.value)} /></div>
              <div><Label>Payment prefix</Label><Input value={f('payment_prefix')} onChange={e => set('payment_prefix', e.target.value)} /></div>
              <div className="md:col-span-3"><Label>Default payment terms</Label><Input value={f('default_payment_terms')} onChange={e => set('default_payment_terms', e.target.value)} /></div>
              <div className="md:col-span-3"><Label>Default invoice notes</Label><Input value={f('default_invoice_notes')} onChange={e => set('default_invoice_notes', e.target.value)} /></div>
            </CardContent>
          </Card>
        </TabsContent>
        <TabsContent value="notifications">
          <Card><CardHeader><CardTitle>Notification preferences</CardTitle></CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center justify-between"><Label>Notify on invoice issued</Label><Switch checked={!!s?.notify_on_invoice_issued} onCheckedChange={v => set('notify_on_invoice_issued', v)} /></div>
              <div className="flex items-center justify-between"><Label>Notify on payment received</Label><Switch checked={!!s?.notify_on_payment_received} onCheckedChange={v => set('notify_on_payment_received', v)} /></div>
              <div className="flex items-center justify-between"><Label>Notify on overdue invoices</Label><Switch checked={!!s?.notify_on_overdue} onCheckedChange={v => set('notify_on_overdue', v)} /></div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </AppLayout>
  );
}