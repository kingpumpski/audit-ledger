import { useEffect, useState } from 'react';
import { AppLayout } from '@/components/layout/AppLayout';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { MfaSettingsCard } from '@/components/auth/MfaSettingsCard';

export default function Profile() {
  const { user, profile } = useAuth();
  const [p, setP] = useState<any>(profile || {});

  useEffect(() => { setP(profile || {}); }, [profile]);

  const save = async () => {
    if (!user) return;
    const { error } = await supabase.from('profiles').update({
      full_name: p.full_name, phone: p.phone, job_title: p.job_title, department: p.department,
    }).eq('id', user.id);
    if (error) return toast.error(error.message);
    toast.success('Profile updated');
  };

  return (
    <AppLayout title="My Profile" subtitle="Personal information and preferences" actions={<Button onClick={save}>Save</Button>}>
      <div className="space-y-6">
      <Card><CardHeader><CardTitle>Personal information</CardTitle></CardHeader>
        <CardContent className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div><Label>Full name</Label><Input value={p.full_name || ''} onChange={e => setP({ ...p, full_name: e.target.value })} /></div>
          <div><Label>Email</Label><Input value={p.email || ''} disabled /></div>
          <div><Label>Phone</Label><Input value={p.phone || ''} onChange={e => setP({ ...p, phone: e.target.value })} /></div>
          <div><Label>Job title</Label><Input value={p.job_title || ''} onChange={e => setP({ ...p, job_title: e.target.value })} /></div>
          <div><Label>Department</Label><Input value={p.department || ''} onChange={e => setP({ ...p, department: e.target.value })} /></div>
        </CardContent>
      </Card>
      <MfaSettingsCard />
      </div>
    </AppLayout>
  );
}