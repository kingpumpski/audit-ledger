import { useEffect, useState } from 'react';
import { AppLayout } from '@/components/layout/AppLayout';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { format } from 'date-fns';
import { QueryDiagnostics, type QueryError } from '@/components/diagnostics/QueryDiagnostics';

type Log = { id: string; user_email: string | null; action: string; entity_type: string; entity_id: string | null; created_at: string; new_data: any; old_data: any };

export default function AuditLogs() {
  const [logs, setLogs] = useState<Log[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<QueryError>(null);
  const [filter, setFilter] = useState('');

  useEffect(() => {
    (async () => {
      const { data, error } = await supabase.from('audit_logs').select('*').order('created_at', { ascending: false }).limit(500);
      console.debug('[AuditLogs] fetch', { count: data?.length ?? 0, error });
      if (error) { setLoadError(error as any); toast.error(error.message); }
      else setLogs((data as any) || []);
      setLoading(false);
    })();
  }, []);

  const filtered = logs.filter(l =>
    !filter || l.user_email?.toLowerCase().includes(filter.toLowerCase()) ||
    l.entity_type.toLowerCase().includes(filter.toLowerCase()) ||
    l.action.toLowerCase().includes(filter.toLowerCase())
  );

  const actionColor = (a: string) => a === 'INSERT' ? 'bg-success/20 text-success' : a === 'UPDATE' ? 'bg-primary/20 text-primary' : a === 'DELETE' ? 'bg-destructive/20 text-destructive' : 'bg-muted';

  return (
    <AppLayout title="Audit Logs" subtitle="Append-only record of all system changes">
      <Card><CardContent className="p-0">
        <div className="p-4 pb-0"><QueryDiagnostics label="audit logs" error={loadError} count={logs.length} /></div>
        <div className="p-4 border-b">
          <Input placeholder="Filter by user, action, or entity..." value={filter} onChange={e => setFilter(e.target.value)} className="max-w-md" />
        </div>
        <div className="overflow-x-auto">
          <table className="data-table">
            <thead><tr><th>Time</th><th>User</th><th>Action</th><th>Entity</th><th>Record ID</th></tr></thead>
            <tbody>
              {loading ? <tr><td colSpan={5} className="p-6 text-center text-muted-foreground">Loading…</td></tr> :
               filtered.length === 0 ? <tr><td colSpan={5} className="p-6 text-center text-muted-foreground">No audit entries</td></tr> :
               filtered.map(l => (
                <tr key={l.id}>
                  <td className="whitespace-nowrap text-xs text-muted-foreground">{format(new Date(l.created_at), 'PPp')}</td>
                  <td className="text-sm">{l.user_email || '—'}</td>
                  <td><Badge className={actionColor(l.action)}>{l.action}</Badge></td>
                  <td className="text-sm">{l.entity_type}</td>
                  <td className="font-mono text-xs text-muted-foreground">{l.entity_id?.slice(0, 8) || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </CardContent></Card>
    </AppLayout>
  );
}