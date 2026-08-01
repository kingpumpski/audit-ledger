import { useEffect, useMemo, useState } from 'react';
import { AppLayout } from '@/components/layout/AppLayout';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Skeleton } from '@/components/ui/skeleton';
import { QueryDiagnostics } from '@/components/diagnostics/QueryDiagnostics';
import { Download, RefreshCw, ShieldAlert, ShieldCheck, Clock, Lock, Search } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell, Legend,
} from 'recharts';

type Attempt = {
  id: string; email: string | null; ip_address: string | null; user_agent: string | null;
  result: string; reason: string | null; created_at: string;
};
type TokenRow = {
  id: string; user_id: string; channel: string; expires_at: string; used_at: string | null;
  mfa_required: boolean | null; mfa_method: string | null; mfa_verified_at: string | null;
  otp_attempts: number | null; ip_address: string | null; created_at: string;
};
type Lockout = {
  id: string; email: string | null; ip_address: string | null;
  failure_count: number; locked_until: string | null; last_failure_at: string;
};

const RANGES = [
  { value: '7', label: 'Last 7 days' },
  { value: '30', label: 'Last 30 days' },
  { value: '90', label: 'Last 90 days' },
];

const RESULT_COLORS: Record<string, string> = {
  requested: 'hsl(var(--primary))',
  sent: 'hsl(var(--accent))',
  completed: 'hsl(var(--success))',
  failed: 'hsl(var(--destructive))',
  blocked: 'hsl(var(--warning))',
  locked: 'hsl(var(--destructive))',
};

function statusVariant(result: string) {
  if (result === 'completed') return 'default';
  if (result === 'failed' || result === 'locked') return 'destructive';
  if (result === 'blocked') return 'secondary';
  return 'outline';
}

export default function AdminPasswordResets() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<any>(null);
  const [attempts, setAttempts] = useState<Attempt[]>([]);
  const [tokens, setTokens] = useState<TokenRow[]>([]);
  const [lockouts, setLockouts] = useState<Lockout[]>([]);
  const [range, setRange] = useState('30');
  const [resultFilter, setResultFilter] = useState('all');
  const [search, setSearch] = useState('');

  const load = async () => {
    setLoading(true);
    setError(null);
    const since = new Date(Date.now() - Number(range) * 86_400_000).toISOString();
    const [a, t, l] = await Promise.all([
      supabase.from('password_reset_attempts').select('*').gte('created_at', since).order('created_at', { ascending: false }).limit(1000),
      supabase.from('password_reset_tokens').select('id, user_id, channel, expires_at, used_at, mfa_required, mfa_method, mfa_verified_at, otp_attempts, ip_address, created_at').gte('created_at', since).order('created_at', { ascending: false }).limit(1000),
      supabase.from('password_reset_lockouts').select('*').order('last_failure_at', { ascending: false }).limit(200),
    ]);
    console.debug('[AdminPasswordResets] fetch', {
      attempts: a.data?.length, tokens: t.data?.length, lockouts: l.data?.length,
      errors: [a.error, t.error, l.error].filter(Boolean),
    });
    const firstError = a.error || t.error || l.error;
    if (firstError) setError(firstError);
    setAttempts((a.data as Attempt[]) || []);
    setTokens((t.data as TokenRow[]) || []);
    setLockouts((l.data as Lockout[]) || []);
    setLoading(false);
  };

  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [range]);

  const now = Date.now();
  const stats = useMemo(() => {
    const pending = tokens.filter(t => !t.used_at && new Date(t.expires_at).getTime() > now).length;
    const expired = tokens.filter(t => !t.used_at && new Date(t.expires_at).getTime() <= now).length;
    const completed = tokens.filter(t => t.used_at).length;
    const failed = attempts.filter(a => a.result === 'failed' || a.result === 'locked').length;
    const lockedNow = lockouts.filter(l => l.locked_until && new Date(l.locked_until).getTime() > now).length;
    const suspiciousIps = Object.entries(
      attempts.reduce<Record<string, number>>((acc, a) => {
        if (a.ip_address) acc[a.ip_address] = (acc[a.ip_address] || 0) + 1;
        return acc;
      }, {}),
    ).filter(([, c]) => c >= 5).length;
    return { pending, expired, completed, failed, lockedNow, suspiciousIps };
  }, [tokens, attempts, lockouts, now]);

  const dailySeries = useMemo(() => {
    const days = Number(range);
    const buckets: Record<string, { day: string; requests: number; completed: number; failed: number }> = {};
    for (let i = days - 1; i >= 0; i--) {
      const d = new Date(now - i * 86_400_000).toISOString().slice(0, 10);
      buckets[d] = { day: d.slice(5), requests: 0, completed: 0, failed: 0 };
    }
    attempts.forEach(a => {
      const key = a.created_at.slice(0, 10);
      const b = buckets[key];
      if (!b) return;
      if (a.result === 'requested') b.requests++;
      else if (a.result === 'completed') b.completed++;
      else if (a.result === 'failed' || a.result === 'locked' || a.result === 'blocked') b.failed++;
    });
    return Object.values(buckets);
  }, [attempts, range, now]);

  const resultBreakdown = useMemo(() => {
    const counts = attempts.reduce<Record<string, number>>((acc, a) => {
      acc[a.result] = (acc[a.result] || 0) + 1;
      return acc;
    }, {});
    return Object.entries(counts).map(([name, value]) => ({ name, value }));
  }, [attempts]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return attempts.filter(a => {
      if (resultFilter !== 'all' && a.result !== resultFilter) return false;
      if (!q) return true;
      return (a.email || '').toLowerCase().includes(q)
        || (a.ip_address || '').toLowerCase().includes(q)
        || (a.reason || '').toLowerCase().includes(q);
    });
  }, [attempts, resultFilter, search]);

  const exportCsv = () => {
    const head = ['created_at', 'email', 'ip_address', 'result', 'reason', 'user_agent'];
    const rows = filtered.map(a => head.map(k => `"${String((a as any)[k] ?? '').replace(/"/g, '""')}"`).join(','));
    const blob = new Blob([[head.join(','), ...rows].join('\n')], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `password-resets-${new Date().toISOString().slice(0, 10)}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const cards = [
    { label: 'Pending', value: stats.pending, icon: Clock },
    { label: 'Completed', value: stats.completed, icon: ShieldCheck },
    { label: 'Expired', value: stats.expired, icon: Clock },
    { label: 'Failed', value: stats.failed, icon: ShieldAlert },
    { label: 'Locked now', value: stats.lockedNow, icon: Lock },
    { label: 'Suspicious IPs', value: stats.suspiciousIps, icon: ShieldAlert },
  ];

  return (
    <AppLayout>
      <div className="space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-display font-bold">Password Reset Monitoring</h1>
            <p className="text-sm text-muted-foreground">
              Track pending, completed, failed and suspicious password reset activity.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Select value={range} onValueChange={setRange}>
              <SelectTrigger className="w-[150px]"><SelectValue /></SelectTrigger>
              <SelectContent>
                {RANGES.map(r => <SelectItem key={r.value} value={r.value}>{r.label}</SelectItem>)}
              </SelectContent>
            </Select>
            <Button variant="outline" onClick={load} disabled={loading}>
              <RefreshCw className={`mr-2 h-4 w-4 ${loading ? 'animate-spin' : ''}`} />Refresh
            </Button>
            <Button onClick={exportCsv} disabled={!filtered.length}>
              <Download className="mr-2 h-4 w-4" />Export CSV
            </Button>
          </div>
        </div>

        {error && <QueryDiagnostics label="password resets" error={error} count={null} />}

        <div className="grid gap-4 grid-cols-2 lg:grid-cols-6">
          {cards.map(c => (
            <Card key={c.label}>
              <CardContent className="pt-6">
                <div className="flex items-center justify-between">
                  <p className="text-xs text-muted-foreground">{c.label}</p>
                  <c.icon className="h-4 w-4 text-muted-foreground" />
                </div>
                {loading ? <Skeleton className="h-7 w-12 mt-2" /> : <p className="text-2xl font-bold mt-1">{c.value}</p>}
              </CardContent>
            </Card>
          ))}
        </div>

        <div className="grid gap-4 lg:grid-cols-3">
          <Card className="lg:col-span-2">
            <CardHeader>
              <CardTitle className="text-base">Reset activity</CardTitle>
              <CardDescription>Requests, completions and failures per day</CardDescription>
            </CardHeader>
            <CardContent className="h-[300px]">
              {loading ? <Skeleton className="h-full w-full" /> : (
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={dailySeries}>
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                    <XAxis dataKey="day" tick={{ fontSize: 11 }} />
                    <YAxis tick={{ fontSize: 11 }} allowDecimals={false} />
                    <Tooltip contentStyle={{ background: 'hsl(var(--card))', border: '1px solid hsl(var(--border))' }} />
                    <Legend />
                    <Bar dataKey="requests" stackId="a" fill="hsl(var(--primary))" />
                    <Bar dataKey="completed" stackId="a" fill="hsl(var(--accent))" />
                    <Bar dataKey="failed" stackId="a" fill="hsl(var(--destructive))" />
                  </BarChart>
                </ResponsiveContainer>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Outcome breakdown</CardTitle>
              <CardDescription>Attempts grouped by result</CardDescription>
            </CardHeader>
            <CardContent className="h-[300px]">
              {loading ? <Skeleton className="h-full w-full" /> : resultBreakdown.length === 0 ? (
                <p className="text-sm text-muted-foreground">No attempts recorded in this period.</p>
              ) : (
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie data={resultBreakdown} dataKey="value" nameKey="name" innerRadius={50} outerRadius={90}>
                      {resultBreakdown.map(entry => (
                        <Cell key={entry.name} fill={RESULT_COLORS[entry.name] || 'hsl(var(--muted-foreground))'} />
                      ))}
                    </Pie>
                    <Legend />
                    <Tooltip contentStyle={{ background: 'hsl(var(--card))', border: '1px solid hsl(var(--border))' }} />
                  </PieChart>
                </ResponsiveContainer>
              )}
            </CardContent>
          </Card>
        </div>

        {lockouts.some(l => l.locked_until && new Date(l.locked_until).getTime() > now) && (
          <Card className="border-destructive/40">
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <Lock className="h-4 w-4 text-destructive" />Active lockouts
              </CardTitle>
              <CardDescription>Identities temporarily blocked from resetting their password</CardDescription>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Email</TableHead><TableHead>IP</TableHead>
                    <TableHead>Failures</TableHead><TableHead>Locked until</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {lockouts.filter(l => l.locked_until && new Date(l.locked_until).getTime() > now).map(l => (
                    <TableRow key={l.id}>
                      <TableCell>{l.email || '—'}</TableCell>
                      <TableCell className="font-mono text-xs">{l.ip_address || '—'}</TableCell>
                      <TableCell>{l.failure_count}</TableCell>
                      <TableCell>{new Date(l.locked_until!).toLocaleString()}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        )}

        <Card>
          <CardHeader className="gap-3">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <CardTitle className="text-base">Reset attempts</CardTitle>
                <CardDescription>{filtered.length} record(s)</CardDescription>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <Input className="pl-9 w-[240px]" placeholder="Search email, IP or reason"
                    value={search} onChange={e => setSearch(e.target.value)} />
                </div>
                <Select value={resultFilter} onValueChange={setResultFilter}>
                  <SelectTrigger className="w-[160px]"><SelectValue placeholder="All results" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All results</SelectItem>
                    {['requested', 'sent', 'completed', 'failed', 'blocked', 'locked'].map(r => (
                      <SelectItem key={r} value={r}>{r}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            {loading ? (
              <div className="space-y-2">{[...Array(5)].map((_, i) => <Skeleton key={i} className="h-10 w-full" />)}</div>
            ) : filtered.length === 0 ? (
              <p className="text-sm text-muted-foreground py-8 text-center">No reset attempts match these filters.</p>
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>When</TableHead><TableHead>Email</TableHead>
                      <TableHead>Result</TableHead><TableHead>Reason</TableHead>
                      <TableHead>IP</TableHead><TableHead>Browser</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filtered.slice(0, 200).map(a => (
                      <TableRow key={a.id}>
                        <TableCell className="whitespace-nowrap text-xs">{new Date(a.created_at).toLocaleString()}</TableCell>
                        <TableCell>{a.email || '—'}</TableCell>
                        <TableCell><Badge variant={statusVariant(a.result) as any}>{a.result}</Badge></TableCell>
                        <TableCell className="text-xs">{a.reason || '—'}</TableCell>
                        <TableCell className="font-mono text-xs">{a.ip_address || '—'}</TableCell>
                        <TableCell className="text-xs max-w-[220px] truncate">{a.user_agent || '—'}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </AppLayout>
  );
}
