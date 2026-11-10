import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { KeyRound, Loader2, Mail, ArrowLeft, HelpCircle, ShieldCheck } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { z } from 'zod';
import { getErrorMessage } from '@/lib/error-message';

const schema = z.object({
  identifier: z.string().trim().min(3, 'Enter your email or username').max(320),
});

export default function ForgotPassword() {
  const [identifier, setIdentifier] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [sent, setSent] = useState(false);
  const navigate = useNavigate();

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    const p = schema.safeParse({ identifier });
    if (!p.success) { setError(p.error.issues[0]?.message ?? 'Please check the information entered'); return; }
    setLoading(true);
    try {
      const { error } = await supabase.functions.invoke('forgot-password', {
        body: { identifier: identifier.trim().toLowerCase() },
      });
      if (error) throw error;
      setSent(true);
    } catch (err: unknown) {
      // Never disclose — show neutral message anyway
      console.error('[ForgotPassword]', getErrorMessage(err, 'Password reset request failed.'));
      setSent(true);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center p-4 bg-background">
      <div className="fixed inset-0 overflow-hidden pointer-events-none">
        <div className="absolute -top-40 -right-40 w-80 h-80 rounded-full bg-primary/10 blur-3xl" />
        <div className="absolute -bottom-40 -left-40 w-80 h-80 rounded-full bg-accent/10 blur-3xl" />
      </div>

      <div className="w-full max-w-md relative z-10">
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-primary mb-4">
            <KeyRound className="h-7 w-7 text-primary-foreground" />
          </div>
          <h1 className="text-2xl font-display font-bold">Forgot Password</h1>
        </div>

        <Card className="shadow-xl border-border/50 backdrop-blur-sm bg-card/80">
          <CardHeader className="pb-4">
            <CardTitle className="text-xl">Reset your password</CardTitle>
            <CardDescription>
              Enter your registered email address or username to receive a password reset link.
            </CardDescription>
          </CardHeader>

          {sent ? (
            <CardContent className="space-y-4">
              <Alert>
                <ShieldCheck className="h-4 w-4" />
                <AlertDescription>
                  If an account exists for that address, a password reset link has been sent.
                  The link expires in 30 minutes. Check your inbox and spam folder.
                </AlertDescription>
              </Alert>
              <div className="flex flex-col gap-2">
                <Button variant="outline" onClick={() => setSent(false)}>Send to a different address</Button>
                <Button variant="ghost" onClick={() => navigate('/login')}>
                  <ArrowLeft className="mr-2 h-4 w-4" />Back to Login
                </Button>
              </div>
            </CardContent>
          ) : (
            <form onSubmit={submit}>
              <CardContent className="space-y-4">
                {error && (
                  <Alert variant="destructive" className="py-3">
                    <AlertDescription>{error}</AlertDescription>
                  </Alert>
                )}
                <div className="space-y-2">
                  <Label htmlFor="identifier">Email or username</Label>
                  <div className="relative">
                    <Mail className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                    <Input
                      id="identifier"
                      type="text"
                      placeholder="name@company.com"
                      value={identifier}
                      onChange={(e) => setIdentifier(e.target.value)}
                      className="pl-10"
                      autoComplete="username email"
                      required
                      autoFocus
                      aria-describedby="identifier-help"
                    />
                  </div>
                  <p id="identifier-help" className="text-xs text-muted-foreground">
                    We'll email a secure single-use link to the address on file.
                  </p>
                </div>
              </CardContent>

              <CardFooter className="flex flex-col gap-3">
                <Button type="submit" className="w-full" size="lg" disabled={loading}>
                  {loading ? (<><Loader2 className="mr-2 h-4 w-4 animate-spin" />Sending...</>) : 'Continue'}
                </Button>
                <Button type="button" variant="outline" className="w-full" onClick={() => navigate('/login')}>
                  Cancel
                </Button>
              </CardFooter>
            </form>
          )}
        </Card>

        <div className="flex flex-wrap justify-center gap-4 mt-6 text-xs">
          <Link to="/login" className="text-primary hover:underline flex items-center gap-1">
            <ArrowLeft className="h-3 w-3" />Back to Login
          </Link>
          <a href="mailto:admin@company.local?subject=Password%20reset%20help"
             className="text-primary hover:underline">Contact Administrator</a>
          <Link to="/help/password-reset" className="text-primary hover:underline flex items-center gap-1">
            <HelpCircle className="h-3 w-3" />Need Help?
          </Link>
        </div>
      </div>
    </div>
  );
}