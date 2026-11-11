import { useCallback, useEffect, useState } from 'react';
import { AppLayout } from '@/components/layout/AppLayout';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { format } from 'date-fns';
import { CheckCheck } from 'lucide-react';
import { Tables } from '@/integrations/supabase/types';
import { getErrorMessage } from '@/lib/error-message';

export default function Notifications() {
  const { user } = useAuth();
  const [items, setItems] = useState<Tables<'notifications'>[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!user) {
      setLoading(false);
      return;
    }
    const { data, error } = await supabase.from('notifications').select('*').eq('user_id', user.id).order('created_at', { ascending: false }).limit(200);
    if (error) toast.error(getErrorMessage(error, 'Could not load notifications.'));
    else setItems(data || []);
    setLoading(false);
  }, [user]);
  useEffect(() => { void load(); }, [load]);

  const markAllRead = async () => {
    if (!user) return;
    const { error } = await supabase.from('notifications').update({ is_read: true, read_at: new Date().toISOString() }).eq('user_id', user.id).eq('is_read', false);
    if (error) return toast.error(error.message);
    load();
  };

  return (
    <AppLayout title="Notifications" subtitle="System alerts and updates" actions={
      <Button variant="outline" onClick={markAllRead}><CheckCheck className="mr-2 h-4 w-4" />Mark all read</Button>
    }>
      <Card><CardContent className="p-0 divide-y">
        {loading ? <div className="p-6 text-center text-muted-foreground">Loading…</div> :
         items.length === 0 ? <div className="p-6 text-center text-muted-foreground">No notifications</div> :
         items.map(n => (
          <div key={n.id} className={`p-4 ${!n.is_read ? 'bg-primary/5' : ''}`}>
            <div className="flex justify-between items-start gap-3">
              <div>
                <div className="flex items-center gap-2">
                  <p className="font-medium">{n.title}</p>
                  {!n.is_read && <Badge variant="secondary" className="text-[10px]">New</Badge>}
                </div>
                <p className="text-sm text-muted-foreground mt-1">{n.message}</p>
              </div>
              <p className="text-xs text-muted-foreground whitespace-nowrap">{format(new Date(n.created_at), 'PPp')}</p>
            </div>
          </div>
        ))}
      </CardContent></Card>
    </AppLayout>
  );
}