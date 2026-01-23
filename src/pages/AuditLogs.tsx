import { useState } from 'react';
import { AppLayout } from '@/components/layout/AppLayout';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { 
  Select, 
  SelectContent, 
  SelectItem, 
  SelectTrigger, 
  SelectValue 
} from '@/components/ui/select';
import { 
  Table, 
  TableBody, 
  TableCell, 
  TableHead, 
  TableHeader, 
  TableRow 
} from '@/components/ui/table';
import { Calendar } from '@/components/ui/calendar';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { useAuditLogs, useAuditLogStats } from '@/hooks/useAuditLogs';
import { 
  Search, 
  CalendarIcon, 
  FileText, 
  Download, 
  Loader2,
  Activity,
  Eye,
  Edit,
  Trash2,
  LogIn,
  LogOut,
  FileSignature,
  Upload
} from 'lucide-react';
import { format } from 'date-fns';
import { cn } from '@/lib/utils';
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, PieChart, Pie, Cell } from 'recharts';

const actionIcons: Record<string, React.ElementType> = {
  create: FileText,
  update: Edit,
  delete: Trash2,
  login: LogIn,
  logout: LogOut,
  view: Eye,
  export: Download,
  sign: FileSignature,
};

const actionColors: Record<string, string> = {
  create: 'bg-success/10 text-success border-success/20',
  update: 'bg-info/10 text-info border-info/20',
  delete: 'bg-destructive/10 text-destructive border-destructive/20',
  login: 'bg-primary/10 text-primary border-primary/20',
  logout: 'bg-muted text-muted-foreground',
  view: 'bg-secondary text-secondary-foreground',
  export: 'bg-accent/10 text-accent border-accent/20',
  sign: 'bg-warning/10 text-warning border-warning/20',
};

const CHART_COLORS = ['#14b8a6', '#6366f1', '#f59e0b', '#ef4444', '#8b5cf6', '#06b6d4', '#84cc16', '#f97316'];

export default function AuditLogs() {
  const [filters, setFilters] = useState({
    action: 'all',
    entityType: 'all',
    search: '',
    dateFrom: undefined as Date | undefined,
    dateTo: undefined as Date | undefined,
  });

  const { data: logs, isLoading } = useAuditLogs(filters);
  const { data: stats } = useAuditLogStats();

  const entityTypes = [...new Set(logs?.map(l => l.entity_type) || [])];

  const chartData = Object.entries(stats?.dailyCounts || {})
    .map(([date, count]) => ({ date, count }))
    .sort((a, b) => a.date.localeCompare(b.date))
    .slice(-14);

  const pieData = Object.entries(stats?.actionCounts || {})
    .map(([name, value]) => ({ name, value }));

  const exportToCSV = () => {
    if (!logs) return;

    const headers = ['Timestamp', 'User', 'Action', 'Entity Type', 'Entity ID', 'Details'];
    const rows = logs.map(log => [
      new Date(log.created_at).toISOString(),
      log.user_email || 'System',
      log.action,
      log.entity_type,
      log.entity_id || '',
      JSON.stringify(log.new_data || log.old_data || {}),
    ]);

    const csvContent = [
      headers.join(','),
      ...rows.map(row => row.map(cell => `"${cell}"`).join(',')),
    ].join('\n');

    const blob = new Blob([csvContent], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `audit-logs-${format(new Date(), 'yyyy-MM-dd')}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <AppLayout
      title="Audit Logs"
      subtitle="Track all system activities and changes"
      actions={
        <Button onClick={exportToCSV} disabled={!logs?.length}>
          <Download className="mr-2 h-4 w-4" />
          Export CSV
        </Button>
      }
    >
      <div className="space-y-6">
        {/* Stats Overview */}
        <div className="grid gap-4 md:grid-cols-3">
          <Card className="md:col-span-2">
            <CardHeader>
              <CardTitle className="text-sm font-medium">Activity Trend (Last 14 Days)</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="h-[200px]">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={chartData}>
                    <defs>
                      <linearGradient id="auditGradient" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="hsl(var(--primary))" stopOpacity={0.3} />
                        <stop offset="100%" stopColor="hsl(var(--primary))" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                    <XAxis 
                      dataKey="date" 
                      tickFormatter={(val) => format(new Date(val), 'MMM d')}
                      stroke="hsl(var(--muted-foreground))"
                      fontSize={12}
                    />
                    <YAxis stroke="hsl(var(--muted-foreground))" fontSize={12} />
                    <Tooltip
                      contentStyle={{
                        backgroundColor: 'hsl(var(--card))',
                        border: '1px solid hsl(var(--border))',
                        borderRadius: '8px',
                      }}
                    />
                    <Area
                      type="monotone"
                      dataKey="count"
                      stroke="hsl(var(--primary))"
                      fill="url(#auditGradient)"
                      strokeWidth={2}
                    />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-sm font-medium">Actions by Type</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="h-[200px]">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={pieData}
                      cx="50%"
                      cy="50%"
                      innerRadius={50}
                      outerRadius={80}
                      paddingAngle={2}
                      dataKey="value"
                    >
                      {pieData.map((_, index) => (
                        <Cell key={`cell-${index}`} fill={CHART_COLORS[index % CHART_COLORS.length]} />
                      ))}
                    </Pie>
                    <Tooltip />
                  </PieChart>
                </ResponsiveContainer>
              </div>
              <div className="flex flex-wrap gap-2 mt-2">
                {pieData.slice(0, 4).map((item, index) => (
                  <div key={item.name} className="flex items-center gap-1 text-xs">
                    <div 
                      className="w-2 h-2 rounded-full" 
                      style={{ backgroundColor: CHART_COLORS[index] }} 
                    />
                    <span className="capitalize">{item.name}</span>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Filters */}
        <Card>
          <CardContent className="p-4">
            <div className="flex flex-wrap gap-3">
              <div className="relative flex-1 min-w-[200px]">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Search by email or ID..."
                  value={filters.search}
                  onChange={(e) => setFilters(f => ({ ...f, search: e.target.value }))}
                  className="pl-9"
                />
              </div>

              <Select 
                value={filters.action} 
                onValueChange={(v) => setFilters(f => ({ ...f, action: v }))}
              >
                <SelectTrigger className="w-[140px]">
                  <SelectValue placeholder="Action" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Actions</SelectItem>
                  <SelectItem value="create">Create</SelectItem>
                  <SelectItem value="update">Update</SelectItem>
                  <SelectItem value="delete">Delete</SelectItem>
                  <SelectItem value="login">Login</SelectItem>
                  <SelectItem value="logout">Logout</SelectItem>
                  <SelectItem value="view">View</SelectItem>
                  <SelectItem value="export">Export</SelectItem>
                  <SelectItem value="sign">Sign</SelectItem>
                </SelectContent>
              </Select>

              <Select 
                value={filters.entityType} 
                onValueChange={(v) => setFilters(f => ({ ...f, entityType: v }))}
              >
                <SelectTrigger className="w-[150px]">
                  <SelectValue placeholder="Entity" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Entities</SelectItem>
                  {entityTypes.map(type => (
                    <SelectItem key={type} value={type} className="capitalize">
                      {type}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              <Popover>
                <PopoverTrigger asChild>
                  <Button variant="outline" className="w-[140px] justify-start">
                    <CalendarIcon className="mr-2 h-4 w-4" />
                    {filters.dateFrom ? format(filters.dateFrom, 'MMM d') : 'From'}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0">
                  <Calendar
                    mode="single"
                    selected={filters.dateFrom}
                    onSelect={(date) => setFilters(f => ({ ...f, dateFrom: date }))}
                  />
                </PopoverContent>
              </Popover>

              <Popover>
                <PopoverTrigger asChild>
                  <Button variant="outline" className="w-[140px] justify-start">
                    <CalendarIcon className="mr-2 h-4 w-4" />
                    {filters.dateTo ? format(filters.dateTo, 'MMM d') : 'To'}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0">
                  <Calendar
                    mode="single"
                    selected={filters.dateTo}
                    onSelect={(date) => setFilters(f => ({ ...f, dateTo: date }))}
                  />
                </PopoverContent>
              </Popover>

              {(filters.dateFrom || filters.dateTo || filters.action !== 'all' || filters.entityType !== 'all' || filters.search) && (
                <Button 
                  variant="ghost" 
                  size="sm"
                  onClick={() => setFilters({
                    action: 'all',
                    entityType: 'all',
                    search: '',
                    dateFrom: undefined,
                    dateTo: undefined,
                  })}
                >
                  Clear Filters
                </Button>
              )}
            </div>
          </CardContent>
        </Card>

        {/* Logs Table */}
        <Card>
          <CardContent className="p-0">
            {isLoading ? (
              <div className="flex items-center justify-center py-12">
                <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-[180px]">Timestamp</TableHead>
                    <TableHead>User</TableHead>
                    <TableHead className="w-[100px]">Action</TableHead>
                    <TableHead>Entity</TableHead>
                    <TableHead>Details</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {logs?.map((log) => {
                    const ActionIcon = actionIcons[log.action] || Activity;
                    return (
                      <TableRow key={log.id}>
                        <TableCell className="font-mono text-sm text-muted-foreground">
                          {format(new Date(log.created_at), 'MMM d, yyyy HH:mm:ss')}
                        </TableCell>
                        <TableCell>
                          <span className="text-sm">{log.user_email || 'System'}</span>
                        </TableCell>
                        <TableCell>
                          <Badge className={cn('capitalize', actionColors[log.action])}>
                            <ActionIcon className="mr-1 h-3 w-3" />
                            {log.action}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          <div>
                            <span className="capitalize font-medium">{log.entity_type}</span>
                            {log.entity_id && (
                              <span className="text-xs text-muted-foreground block font-mono">
                                {log.entity_id.slice(0, 8)}...
                              </span>
                            )}
                          </div>
                        </TableCell>
                        <TableCell className="max-w-[300px]">
                          {log.new_data ? (
                            <Popover>
                              <PopoverTrigger asChild>
                                <Button variant="ghost" size="sm" className="text-xs">
                                  View Changes
                                </Button>
                              </PopoverTrigger>
                              <PopoverContent className="w-[400px] max-h-[300px] overflow-auto">
                                <pre className="text-xs whitespace-pre-wrap">
                                  {JSON.stringify(log.new_data, null, 2)}
                                </pre>
                              </PopoverContent>
                            </Popover>
                          ) : (
                            <span className="text-sm text-muted-foreground">—</span>
                          )}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </div>
    </AppLayout>
  );
}
