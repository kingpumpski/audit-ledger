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
import { 
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Checkbox } from '@/components/ui/checkbox';
import { useAdminUsers } from '@/hooks/useAdminUsers';
import { BulkUserCreation } from '@/components/admin/BulkUserCreation';
import { 
  Users, 
  Shield, 
  Plus, 
  Loader2, 
  Search,
  UserCog,
  Check,
  X
} from 'lucide-react';
import { cn } from '@/lib/utils';

type AppRole = 'admin' | 'accountant' | 'cashier' | 'auditor';

const ALL_ROLES: AppRole[] = ['admin', 'accountant', 'cashier', 'auditor'];

const roleDescriptions: Record<AppRole, string> = {
  admin: 'Full system access, manage users and settings',
  accountant: 'Manage invoices, products, and financial reports',
  cashier: 'Create invoices, receipts, and handle payments',
  auditor: 'View-only access to all records and audit logs',
};

const roleColors: Record<AppRole, string> = {
  admin: 'bg-accent text-accent-foreground',
  accountant: 'bg-primary text-primary-foreground',
  cashier: 'bg-success text-success-foreground',
  auditor: 'bg-warning text-warning-foreground',
};

export default function AdminUsers() {
  const { users, isLoading, assignRole, removeRole, toggleUserActive, isAssigning } = useAdminUsers();
  const [searchQuery, setSearchQuery] = useState('');
  const [roleFilter, setRoleFilter] = useState<string>('all');
  const [selectedUser, setSelectedUser] = useState<string | null>(null);

  const filteredUsers = users.filter(user => {
    const matchesSearch = 
      user.email.toLowerCase().includes(searchQuery.toLowerCase()) ||
      (user.full_name?.toLowerCase().includes(searchQuery.toLowerCase()) ?? false);
    
    const matchesRole = roleFilter === 'all' || user.roles.includes(roleFilter as AppRole);
    
    return matchesSearch && matchesRole;
  });

  const handleRoleToggle = (userId: string, role: AppRole, hasRole: boolean) => {
    if (hasRole) {
      removeRole({ userId, role });
    } else {
      assignRole({ userId, role });
    }
  };

  return (
    <AppLayout
      title="User Management"
      subtitle="Manage user accounts and role assignments"
      actions={<BulkUserCreation />}
    >
      <div className="space-y-6">
        {/* Stats Cards */}
        <div className="grid gap-4 md:grid-cols-4">
          <Card>
            <CardContent className="p-4">
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-lg bg-primary/10">
                  <Users className="h-5 w-5 text-primary" />
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">Total Users</p>
                  <p className="text-2xl font-bold">{users.length}</p>
                </div>
              </div>
            </CardContent>
          </Card>
          {ALL_ROLES.map(role => (
            <Card key={role}>
              <CardContent className="p-4">
                <div className="flex items-center gap-3">
                  <div className={cn('p-2 rounded-lg', roleColors[role].replace('text-', 'bg-').split(' ')[0] + '/10')}>
                    <Shield className="h-5 w-5 text-current" />
                  </div>
                  <div>
                    <p className="text-sm text-muted-foreground capitalize">{role}s</p>
                    <p className="text-2xl font-bold">
                      {users.filter(u => u.roles.includes(role)).length}
                    </p>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>

        {/* Users Table */}
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle>All Users</CardTitle>
              <div className="flex items-center gap-3">
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <Input
                    placeholder="Search users..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="pl-9 w-[250px]"
                  />
                </div>
                <Select value={roleFilter} onValueChange={setRoleFilter}>
                  <SelectTrigger className="w-[150px]">
                    <SelectValue placeholder="Filter by role" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Roles</SelectItem>
                    {ALL_ROLES.map(role => (
                      <SelectItem key={role} value={role} className="capitalize">
                        {role}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>User</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Roles</TableHead>
                    <TableHead>Joined</TableHead>
                    <TableHead className="w-[100px]">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredUsers.map((user) => (
                    <TableRow key={user.id}>
                      <TableCell>
                        <div>
                          <p className="font-medium">{user.full_name || 'No name'}</p>
                          <p className="text-sm text-muted-foreground">{user.email}</p>
                        </div>
                      </TableCell>
                      <TableCell>
                        <Badge variant={user.is_active ? 'default' : 'secondary'}>
                          {user.is_active ? 'Active' : 'Inactive'}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <div className="flex flex-wrap gap-1">
                          {user.roles.length > 0 ? (
                            user.roles.map(role => (
                              <Badge key={role} className={cn('capitalize', roleColors[role])}>
                                {role}
                              </Badge>
                            ))
                          ) : (
                            <span className="text-sm text-muted-foreground">No roles</span>
                          )}
                        </div>
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {new Date(user.created_at).toLocaleDateString()}
                      </TableCell>
                      <TableCell>
                        <Dialog>
                          <DialogTrigger asChild>
                            <Button variant="ghost" size="sm">
                              <UserCog className="h-4 w-4" />
                            </Button>
                          </DialogTrigger>
                          <DialogContent>
                            <DialogHeader>
                              <DialogTitle>Manage Roles</DialogTitle>
                              <DialogDescription>
                                Assign or remove roles for {user.full_name || user.email}
                              </DialogDescription>
                            </DialogHeader>
                            <div className="space-y-4 py-4">
                              {ALL_ROLES.map(role => {
                                const hasRole = user.roles.includes(role);
                                return (
                                  <div
                                    key={role}
                                    className="flex items-start gap-3 p-3 rounded-lg border hover:bg-muted/50 cursor-pointer"
                                    onClick={() => handleRoleToggle(user.id, role, hasRole)}
                                  >
                                    <Checkbox
                                      checked={hasRole}
                                      disabled={isAssigning}
                                    />
                                    <div className="flex-1">
                                      <div className="flex items-center gap-2">
                                        <span className="font-medium capitalize">{role}</span>
                                        <Badge className={cn('text-xs', roleColors[role])}>
                                          {role}
                                        </Badge>
                                      </div>
                                      <p className="text-sm text-muted-foreground mt-1">
                                        {roleDescriptions[role]}
                                      </p>
                                    </div>
                                  </div>
                                );
                              })}
                            </div>
                            <div className="flex justify-between pt-4 border-t">
                              <Button
                                variant="outline"
                                size="sm"
                                onClick={() => toggleUserActive({ 
                                  userId: user.id, 
                                  isActive: !user.is_active 
                                })}
                              >
                                {user.is_active ? (
                                  <>
                                    <X className="mr-2 h-4 w-4" />
                                    Deactivate User
                                  </>
                                ) : (
                                  <>
                                    <Check className="mr-2 h-4 w-4" />
                                    Activate User
                                  </>
                                )}
                              </Button>
                            </div>
                          </DialogContent>
                        </Dialog>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </div>
    </AppLayout>
  );
}
