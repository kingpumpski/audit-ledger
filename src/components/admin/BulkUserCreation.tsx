import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { 
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { 
  Select, 
  SelectContent, 
  SelectItem, 
  SelectTrigger, 
  SelectValue 
} from '@/components/ui/select';
import { Checkbox } from '@/components/ui/checkbox';
import { useToast } from '@/hooks/use-toast';
import { getErrorMessage } from '@/lib/error-message';

type CreateUserResult = { email: string; success: boolean; error?: string };

function isCreateUserResult(value: unknown): value is CreateUserResult {
  return typeof value === 'object' && value !== null &&
    'email' in value && typeof value.email === 'string' &&
    'success' in value && typeof value.success === 'boolean' &&
    (!('error' in value) || typeof value.error === 'string');
}
import { supabase } from '@/integrations/supabase/client';
import { Plus, Loader2, UserPlus, Trash2, Users } from 'lucide-react';
import { cn } from '@/lib/utils';

type AppRole = 'admin' | 'accountant' | 'cashier' | 'auditor';

interface NewUser {
  email: string;
  fullName: string;
  roles: AppRole[];
  password: string;
}

const roleColors: Record<AppRole, string> = {
  admin: 'bg-accent text-accent-foreground',
  accountant: 'bg-primary text-primary-foreground',
  cashier: 'bg-success text-success-foreground',
  auditor: 'bg-warning text-warning-foreground',
};

const ALL_ROLES: AppRole[] = ['admin', 'accountant', 'cashier', 'auditor'];

export function BulkUserCreation() {
  const { toast } = useToast();
  const [isOpen, setIsOpen] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  const [users, setUsers] = useState<NewUser[]>([
    { email: '', fullName: '', roles: ['cashier'], password: 'bredas@2026' }
  ]);
  const [defaultPassword, setDefaultPassword] = useState('bredas@2026');

  const addUser = () => {
    setUsers([...users, { email: '', fullName: '', roles: ['cashier'], password: defaultPassword }]);
  };

  const removeUser = (index: number) => {
    if (users.length > 1) {
      setUsers(users.filter((_, i) => i !== index));
    }
  };

  const updateUser = (index: number, field: keyof NewUser, value: string | AppRole[]) => {
    const updated = [...users];
    updated[index] = { ...updated[index], [field]: value };
    setUsers(updated);
  };

  const toggleRole = (index: number, role: AppRole) => {
    const updated = [...users];
    const currentRoles = updated[index].roles;
    if (currentRoles.includes(role)) {
      updated[index].roles = currentRoles.filter(r => r !== role);
    } else {
      updated[index].roles = [...currentRoles, role];
    }
    setUsers(updated);
  };

  const applyDefaultPassword = () => {
    setUsers(users.map(u => ({ ...u, password: defaultPassword })));
    toast({ title: 'Default password applied to all users' });
  };

  const handleSubmit = async () => {
    // Validate
    const invalidUsers = users.filter(u => !u.email || !u.fullName || u.roles.length === 0);
    if (invalidUsers.length > 0) {
      toast({ 
        title: 'Invalid users', 
        description: 'All users must have email, name, and at least one role',
        variant: 'destructive'
      });
      return;
    }

    setIsCreating(true);

    try {
      const { data, error } = await supabase.functions.invoke('create-users', {
        body: { 
          users: users.map(u => ({
            email: u.email,
            full_name: u.fullName,
            roles: u.roles,
            password: u.password,
          }))
        },
      });

      if (error) throw error;

      const results: CreateUserResult[] = Array.isArray(data?.results)
        ? data.results.filter(isCreateUserResult)
        : [];
      const successCount = results.filter((result) => result.success).length;
      const failCount = results.filter((result) => !result.success).length;

      if (failCount > 0) {
        const failedEmails = results
          .filter((result) => !result.success)
          .map((result) => `${result.email}: ${result.error || 'Unknown error'}`)
          .join('\n');
        
        toast({
          title: `Created ${successCount} users, ${failCount} failed`,
          description: failedEmails,
          variant: 'destructive',
        });
      } else {
        toast({
          title: `Successfully created ${successCount} users`,
          description: 'Users can now log in with their credentials',
        });
        setIsOpen(false);
        setUsers([{ email: '', fullName: '', roles: ['cashier'], password: defaultPassword }]);
      }
    } catch (error: unknown) {
      console.error('Failed to create users:', error);
      toast({
        title: 'Failed to create users',
        description: getErrorMessage(error, 'An unexpected error occurred.'),
        variant: 'destructive',
      });
    } finally {
      setIsCreating(false);
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={setIsOpen}>
      <DialogTrigger asChild>
        <Button>
          <UserPlus className="mr-2 h-4 w-4" />
          Create Users
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Users className="h-5 w-5" />
            Bulk User Creation
          </DialogTitle>
          <DialogDescription>
            Create multiple user accounts at once with predefined roles and passwords.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-6 py-4">
          {/* Default Password Setting */}
          <Card>
            <CardHeader className="py-3">
              <CardTitle className="text-sm">Default Password</CardTitle>
            </CardHeader>
            <CardContent className="py-3">
              <div className="flex gap-2">
                <Input
                  value={defaultPassword}
                  onChange={(e) => setDefaultPassword(e.target.value)}
                  placeholder="Enter default password"
                  type="text"
                />
                <Button variant="outline" onClick={applyDefaultPassword}>
                  Apply to All
                </Button>
              </div>
            </CardContent>
          </Card>

          {/* User List */}
          <div className="space-y-4">
            {users.map((user, index) => (
              <Card key={index} className="relative">
                <CardContent className="pt-4">
                  <div className="grid gap-4 md:grid-cols-2">
                    <div className="space-y-2">
                      <Label>Email *</Label>
                      <Input
                        type="email"
                        value={user.email}
                        onChange={(e) => updateUser(index, 'email', e.target.value)}
                        placeholder="user@example.com"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label>Full Name *</Label>
                      <Input
                        value={user.fullName}
                        onChange={(e) => updateUser(index, 'fullName', e.target.value)}
                        placeholder="John Doe"
                      />
                    </div>
                  </div>

                  <div className="mt-4 space-y-2">
                    <Label>Roles *</Label>
                    <div className="flex flex-wrap gap-2">
                      {ALL_ROLES.map(role => (
                        <button
                          key={role}
                          type="button"
                          onClick={() => toggleRole(index, role)}
                          className={cn(
                            'px-3 py-1.5 rounded-lg text-sm font-medium transition-all border',
                            user.roles.includes(role)
                              ? roleColors[role]
                              : 'bg-muted text-muted-foreground border-border hover:bg-muted/80'
                          )}
                        >
                          {role}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="mt-4 flex items-center justify-between">
                    <div className="flex gap-2 items-center">
                      <Label className="text-muted-foreground">Password:</Label>
                      <Input
                        value={user.password}
                        onChange={(e) => updateUser(index, 'password', e.target.value)}
                        className="w-40 h-8 text-sm"
                      />
                    </div>
                    {users.length > 1 && (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => removeUser(index)}
                        className="text-destructive hover:text-destructive"
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    )}
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>

          {/* Add User Button */}
          <Button variant="outline" onClick={addUser} className="w-full">
            <Plus className="mr-2 h-4 w-4" />
            Add Another User
          </Button>

          {/* Submit */}
          <div className="flex justify-end gap-3 pt-4 border-t">
            <Button variant="outline" onClick={() => setIsOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleSubmit} disabled={isCreating}>
              {isCreating ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Creating {users.length} users...
                </>
              ) : (
                <>
                  <UserPlus className="mr-2 h-4 w-4" />
                  Create {users.length} User{users.length > 1 ? 's' : ''}
                </>
              )}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
