import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Loader2, Shield, CheckCircle, AlertCircle } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';

export function InitialAdminSetup() {
  const { user, roles, isLoading: authLoading } = useAuth();
  const [isChecking, setIsChecking] = useState(true);
  const [isFirstUser, setIsFirstUser] = useState(false);
  const [isClaiming, setIsClaiming] = useState(false);
  const [claimed, setClaimed] = useState(false);
  const navigate = useNavigate();
  const { toast } = useToast();

  useEffect(() => {
    checkFirstUser();
  }, [user]);

  const checkFirstUser = async () => {
    if (!user) {
      setIsChecking(false);
      return;
    }

    try {
      const { data, error } = await supabase.rpc('is_first_user');
      
      if (error) throw error;
      setIsFirstUser(data === true);
    } catch (error) {
      console.error('Error checking first user:', error);
    } finally {
      setIsChecking(false);
    }
  };

  const claimAdminRole = async () => {
    setIsClaiming(true);
    try {
      const { data, error } = await supabase.rpc('claim_initial_admin');
      
      if (error) throw error;
      
      if (data) {
        setClaimed(true);
        toast({
          title: 'Admin role assigned!',
          description: 'You are now the system administrator.',
        });
        // Refresh auth state
        setTimeout(() => {
          window.location.reload();
        }, 1500);
      } else {
        toast({
          title: 'Could not assign role',
          description: 'Another user may have already claimed admin.',
          variant: 'destructive',
        });
      }
    } catch (error: any) {
      console.error('Error claiming admin:', error);
      toast({
        title: 'Error',
        description: error.message,
        variant: 'destructive',
      });
    } finally {
      setIsClaiming(false);
    }
  };

  if (authLoading || isChecking) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!user) {
    return null;
  }

  // If user already has roles, don't show this
  if (roles.length > 0) {
    return null;
  }

  // If not first user, show pending message
  if (!isFirstUser) {
    return null;
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          <div className="w-16 h-16 rounded-full bg-primary/10 flex items-center justify-center mx-auto mb-4">
            {claimed ? (
              <CheckCircle className="h-8 w-8 text-success" />
            ) : (
              <Shield className="h-8 w-8 text-primary" />
            )}
          </div>
          <CardTitle className="text-2xl">
            {claimed ? 'Setup Complete!' : 'Initial Setup'}
          </CardTitle>
          <CardDescription>
            {claimed
              ? 'You are now the system administrator.'
              : 'You are the first user. Claim admin privileges to get started.'}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {!claimed ? (
            <>
              <div className="bg-muted/50 rounded-lg p-4 text-sm space-y-2">
                <p className="font-medium">As admin, you will be able to:</p>
                <ul className="list-disc list-inside space-y-1 text-muted-foreground">
                  <li>Manage user accounts and roles</li>
                  <li>Configure system settings</li>
                  <li>View all invoices, receipts, and reports</li>
                  <li>Access audit logs</li>
                  <li>Manage products, taxes, and discounts</li>
                </ul>
              </div>
              <Button
                className="w-full"
                size="lg"
                onClick={claimAdminRole}
                disabled={isClaiming}
              >
                {isClaiming ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Setting up...
                  </>
                ) : (
                  <>
                    <Shield className="mr-2 h-4 w-4" />
                    Claim Admin Role
                  </>
                )}
              </Button>
            </>
          ) : (
            <div className="text-center text-sm text-muted-foreground">
              Redirecting to dashboard...
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
