import { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogTrigger,
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { useAuth } from '@/contexts/AuthContext';
import { useToast } from '@/hooks/use-toast';
import { Plus, Pencil, Trash2, Search, Loader2, Lock } from 'lucide-react';
import { z } from 'zod';

type AccountType = 'asset' | 'liability' | 'equity' | 'revenue' | 'expense';
type AccountSubtype =
  | 'current_asset' | 'fixed_asset' | 'other_asset'
  | 'current_liability' | 'long_term_liability'
  | 'equity'
  | 'operating_revenue' | 'other_revenue'
  | 'cost_of_sales' | 'operating_expense' | 'other_expense';

interface Account {
  id: string;
  code: string;
  name: string;
  description: string | null;
  account_type: AccountType;
  account_subtype: AccountSubtype | null;
  parent_id: string | null;
  is_active: boolean;
  is_system: boolean;
  opening_balance: number;
  current_balance: number;
  currency: string;
}

const accountSchema = z.object({
  code: z.string().trim().min(1, 'Code is required').max(20, 'Max 20 chars')
    .regex(/^[A-Za-z0-9_.-]+$/, 'Letters, digits, _ . - only'),
  name: z.string().trim().min(1, 'Name is required').max(120, 'Max 120 chars'),
  description: z.string().trim().max(500, 'Max 500 chars').optional().or(z.literal('')),
  account_type: z.enum(['asset', 'liability', 'equity', 'revenue', 'expense']),
  account_subtype: z.string().optional().nullable(),
  opening_balance: z.number().min(-1_000_000_000).max(1_000_000_000),
  currency: z.string().trim().length(3).toUpperCase(),
  is_active: z.boolean(),
});

const SUBTYPES_BY_TYPE: Record<AccountType, AccountSubtype[]> = {
  asset: ['current_asset', 'fixed_asset', 'other_asset'],
  liability: ['current_liability', 'long_term_liability'],
  equity: ['equity'],
  revenue: ['operating_revenue', 'other_revenue'],
  expense: ['cost_of_sales', 'operating_expense', 'other_expense'],
};

const TYPE_BADGE: Record<AccountType, string> = {
  asset: 'bg-success/15 text-success border-success/30',
  liability: 'bg-warning/15 text-warning border-warning/30',
  equity: 'bg-primary/15 text-primary border-primary/30',
  revenue: 'bg-accent/15 text-accent border-accent/30',
  expense: 'bg-destructive/15 text-destructive border-destructive/30',
};

const emptyForm = {
  code: '',
  name: '',
  description: '',
  account_type: 'asset' as AccountType,
  account_subtype: 'current_asset' as AccountSubtype,
  opening_balance: 0,
  currency: 'USD',
  is_active: true,
};

export function ChartOfAccounts() {
  const { roles } = useAuth();
  const { toast } = useToast();
  const canEdit = roles.includes('admin') || roles.includes('accountant');
  const canDelete = roles.includes('admin');

  const [accounts, setAccounts] = useState<Account[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState<string>('all');
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<Account | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from('chart_of_accounts')
      .select('*')
      .order('code', { ascending: true });
    if (error) {
      toast({ title: 'Failed to load accounts', description: error.message, variant: 'destructive' });
    } else {
      setAccounts((data as Account[]) || []);
    }
    setLoading(false);
  }, [toast]);

  useEffect(() => { void load(); }, [load]);

  const filtered = useMemo(() => {
    return accounts.filter(a => {
      const matchesSearch = !search ||
        a.code.toLowerCase().includes(search.toLowerCase()) ||
        a.name.toLowerCase().includes(search.toLowerCase());
      const matchesType = typeFilter === 'all' || a.account_type === typeFilter;
      return matchesSearch && matchesType;
    });
  }, [accounts, search, typeFilter]);

  const openNew = () => {
    setEditing(null);
    setForm(emptyForm);
    setFormError(null);
    setDialogOpen(true);
  };

  const openEdit = (a: Account) => {
    setEditing(a);
    setForm({
      code: a.code,
      name: a.name,
      description: a.description ?? '',
      account_type: a.account_type,
      account_subtype: (a.account_subtype ?? SUBTYPES_BY_TYPE[a.account_type][0]) as AccountSubtype,
      opening_balance: Number(a.opening_balance) || 0,
      currency: a.currency || 'USD',
      is_active: a.is_active,
    });
    setFormError(null);
    setDialogOpen(true);
  };

  const handleSave = async () => {
    setFormError(null);
    const parsed = accountSchema.safeParse(form);
    if (!parsed.success) {
      setFormError(parsed.error.issues[0]?.message ?? 'Invalid input');
      return;
    }
    setSaving(true);
    const payload = {
      code: parsed.data.code.toUpperCase(),
      name: parsed.data.name,
      description: parsed.data.description || null,
      account_type: parsed.data.account_type,
      account_subtype: parsed.data.account_subtype as AccountSubtype,
      opening_balance: parsed.data.opening_balance,
      currency: parsed.data.currency,
      is_active: parsed.data.is_active,
    };
    const op = editing
      ? supabase.from('chart_of_accounts').update(payload).eq('id', editing.id)
      : supabase.from('chart_of_accounts').insert({ ...payload, current_balance: payload.opening_balance });
    const { error } = await op;
    setSaving(false);
    if (error) {
      setFormError(error.message);
      return;
    }
    toast({ title: editing ? 'Account updated' : 'Account created' });
    setDialogOpen(false);
    await load();
  };

  const handleDelete = async (a: Account) => {
    const { error } = await supabase.from('chart_of_accounts').delete().eq('id', a.id);
    if (error) {
      toast({ title: 'Delete failed', description: error.message, variant: 'destructive' });
    } else {
      toast({ title: 'Account deleted' });
      await load();
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3 justify-between">
        <div className="flex flex-wrap gap-2 items-center flex-1">
          <div className="relative max-w-xs flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search code or name…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-9"
            />
          </div>
          <Select value={typeFilter} onValueChange={setTypeFilter}>
            <SelectTrigger className="w-44"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All types</SelectItem>
              <SelectItem value="asset">Assets</SelectItem>
              <SelectItem value="liability">Liabilities</SelectItem>
              <SelectItem value="equity">Equity</SelectItem>
              <SelectItem value="revenue">Revenue</SelectItem>
              <SelectItem value="expense">Expenses</SelectItem>
            </SelectContent>
          </Select>
        </div>
        {canEdit && (
          <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
            <DialogTrigger asChild>
              <Button onClick={openNew}>
                <Plus className="h-4 w-4 mr-2" />New Account
              </Button>
            </DialogTrigger>
            <DialogContent className="max-w-lg">
              <DialogHeader>
                <DialogTitle>{editing ? 'Edit Account' : 'New Account'}</DialogTitle>
              </DialogHeader>
              <div className="grid gap-4 py-2">
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <Label>Code</Label>
                    <Input
                      value={form.code}
                      onChange={(e) => setForm({ ...form, code: e.target.value })}
                      placeholder="e.g. 1100"
                      disabled={!!editing?.is_system}
                    />
                  </div>
                  <div>
                    <Label>Currency</Label>
                    <Input
                      value={form.currency}
                      maxLength={3}
                      onChange={(e) => setForm({ ...form, currency: e.target.value.toUpperCase() })}
                    />
                  </div>
                </div>
                <div>
                  <Label>Name</Label>
                  <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <Label>Type</Label>
                    <Select
                      value={form.account_type}
                      onValueChange={(v) => setForm({
                        ...form,
                        account_type: v as AccountType,
                        account_subtype: SUBTYPES_BY_TYPE[v as AccountType][0],
                      })}
                      disabled={!!editing?.is_system}
                    >
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="asset">Asset</SelectItem>
                        <SelectItem value="liability">Liability</SelectItem>
                        <SelectItem value="equity">Equity</SelectItem>
                        <SelectItem value="revenue">Revenue</SelectItem>
                        <SelectItem value="expense">Expense</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label>Sub-type</Label>
                    <Select
                      value={form.account_subtype}
                      onValueChange={(v) => setForm({ ...form, account_subtype: v as AccountSubtype })}
                    >
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {SUBTYPES_BY_TYPE[form.account_type].map(st => (
                          <SelectItem key={st} value={st}>{st.replace(/_/g, ' ')}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                <div>
                  <Label>Opening Balance</Label>
                  <Input
                    type="number"
                    step="0.01"
                    value={form.opening_balance}
                    onChange={(e) => setForm({ ...form, opening_balance: Number(e.target.value) || 0 })}
                    disabled={!!editing}
                  />
                  {editing && (
                    <p className="text-xs text-muted-foreground mt-1">
                      Opening balance is locked after creation to preserve audit trail.
                    </p>
                  )}
                </div>
                <div>
                  <Label>Description</Label>
                  <Textarea
                    rows={2}
                    value={form.description}
                    onChange={(e) => setForm({ ...form, description: e.target.value })}
                  />
                </div>
                {formError && <p className="text-sm text-destructive">{formError}</p>}
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setDialogOpen(false)}>Cancel</Button>
                <Button onClick={handleSave} disabled={saving}>
                  {saving && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                  {editing ? 'Save changes' : 'Create account'}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        )}
      </div>

      <Card className="overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-24">Code</TableHead>
              <TableHead>Name</TableHead>
              <TableHead>Type</TableHead>
              <TableHead>Sub-type</TableHead>
              <TableHead className="text-right">Balance</TableHead>
              <TableHead className="w-20">Status</TableHead>
              <TableHead className="w-32 text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              <TableRow><TableCell colSpan={7} className="text-center py-8">
                <Loader2 className="h-5 w-5 animate-spin inline" />
              </TableCell></TableRow>
            ) : filtered.length === 0 ? (
              <TableRow><TableCell colSpan={7} className="text-center py-8 text-muted-foreground">
                No accounts found.
              </TableCell></TableRow>
            ) : filtered.map(a => (
              <TableRow key={a.id}>
                <TableCell className="font-mono text-sm">{a.code}</TableCell>
                <TableCell>
                  <div className="flex items-center gap-2">
                    <span className="font-medium">{a.name}</span>
                    {a.is_system && <Lock className="h-3 w-3 text-muted-foreground" aria-label="System account" />}
                  </div>
                  {a.description && <p className="text-xs text-muted-foreground line-clamp-1">{a.description}</p>}
                </TableCell>
                <TableCell>
                  <Badge variant="outline" className={TYPE_BADGE[a.account_type]}>
                    {a.account_type}
                  </Badge>
                </TableCell>
                <TableCell className="capitalize text-sm text-muted-foreground">
                  {a.account_subtype?.replace(/_/g, ' ') ?? '—'}
                </TableCell>
                <TableCell className="text-right font-mono">
                  {a.currency} {Number(a.current_balance).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </TableCell>
                <TableCell>
                  <Badge variant={a.is_active ? 'default' : 'secondary'}>
                    {a.is_active ? 'Active' : 'Inactive'}
                  </Badge>
                </TableCell>
                <TableCell className="text-right">
                  {canEdit && (
                    <Button size="icon" variant="ghost" onClick={() => openEdit(a)}>
                      <Pencil className="h-4 w-4" />
                    </Button>
                  )}
                  {canDelete && !a.is_system && (
                    <AlertDialog>
                      <AlertDialogTrigger asChild>
                        <Button size="icon" variant="ghost" className="text-destructive">
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </AlertDialogTrigger>
                      <AlertDialogContent>
                        <AlertDialogHeader>
                          <AlertDialogTitle>Delete account {a.code}?</AlertDialogTitle>
                          <AlertDialogDescription>
                            This permanently removes the account. This action is logged in the audit trail.
                          </AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                          <AlertDialogCancel>Cancel</AlertDialogCancel>
                          <AlertDialogAction onClick={() => handleDelete(a)}>Delete</AlertDialogAction>
                        </AlertDialogFooter>
                      </AlertDialogContent>
                    </AlertDialog>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>
    </div>
  );
}