import { useState } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { FileText, Loader2, Mail, ArrowLeft, CheckCircle, AlertCircle } from 'lucide-react';

export default function ForgotPassword() {
  const [email, setEmail] = useState('');
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [isSuccess, setIsSuccess] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (!email || !email.includes('@')) {
      setError('Please enter a valid email address');
      return;
    }

    setIsLoading(true);

    try {
      const { error: resetError } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: `${window.location.origin}/reset-password`,
      });

      if (resetError) {
        setError(resetError.message);
      } else {
        setIsSuccess(true);
      }
    } catch (err) {
      setError('An unexpected error occurred. Please try again.');
    } finally {
      setIsLoading(false);
    }
  };

  if (isSuccess) {
    return (
      <div className="min-h-screen flex items-center justify-center p-4 bg-background">
        <div className="fixed inset-0 overflow-hidden pointer-events-none">
          <div className="absolute -top-40 -right-40 w-80 h-80 rounded-full bg-primary/10 blur-3xl" />
          <div className="absolute -bottom-40 -left-40 w-80 h-80 rounded-full bg-accent/10 blur-3xl" />
        </div>

        <div className="w-full max-w-md relative z-10">
          <div className="text-center mb-8">
            <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-success mb-4">
              <CheckCircle className="h-7 w-7 text-success-foreground" />
            </div>
            <h1 className="text-2xl font-display font-bold text-foreground">Check your email</h1>
            <p className="text-muted-foreground text-sm mt-1">We've sent a password reset link</p>
          </div>

          <Card className="shadow-xl border-border/50 backdrop-blur-sm bg-card/80">
            <CardContent className="pt-6 text-center space-y-4">
              <p className="text-muted-foreground">
                We've sent a password reset link to <strong>{email}</strong>. 
                Please check your email and click the link to reset your password.
              </p>
              <p className="text-sm text-muted-foreground">
                Didn't receive the email? Check your spam folder or try again.
              </p>
            </CardContent>
            <CardFooter className="flex flex-col gap-4">
              <Button 
                variant="outline" 
                className="w-full" 
                onClick={() => setIsSuccess(false)}
              >
                Try another email
              </Button>
              <Link 
                to="/login" 
                className="text-sm text-primary font-medium hover:text-primary/80 transition-colors"
              >
                <ArrowLeft className="inline h-4 w-4 mr-1" />
                Back to login
              </Link>
            </CardFooter>
          </Card>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-4 bg-background">
      <div className="fixed inset-0 overflow-hidden pointer-events-none">
        <div className="absolute -top-40 -right-40 w-80 h-80 rounded-full bg-primary/10 blur-3xl" />
        <div className="absolute -bottom-40 -left-40 w-80 h-80 rounded-full bg-accent/10 blur-3xl" />
      </div>

      <div className="w-full max-w-md relative z-10">
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-primary mb-4">
            <FileText className="h-7 w-7 text-primary-foreground" />
          </div>
          <h1 className="text-2xl font-display font-bold text-foreground">InvoiceHub</h1>
          <p className="text-muted-foreground text-sm mt-1">Invoice & Receipt Management</p>
        </div>

        <Card className="shadow-xl border-border/50 backdrop-blur-sm bg-card/80">
          <CardHeader className="text-center pb-4">
            <CardTitle className="text-xl">Forgot your password?</CardTitle>
            <CardDescription>
              Enter your email and we'll send you a reset link
            </CardDescription>
          </CardHeader>

          <form onSubmit={handleSubmit}>
            <CardContent className="space-y-4">
              {error && (
                <Alert variant="destructive" className="py-3">
                  <AlertCircle className="h-4 w-4" />
                  <AlertDescription>{error}</AlertDescription>
                </Alert>
              )}

              <div className="space-y-2">
                <Label htmlFor="email">Email</Label>
                <div className="relative">
                  <Mail className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <Input
                    id="email"
                    type="email"
                    placeholder="name@company.com"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className="pl-10"
                    required
                    autoComplete="email"
                  />
                </div>
              </div>
            </CardContent>

            <CardFooter className="flex flex-col gap-4">
              <Button 
                type="submit" 
                className="w-full btn-shine" 
                size="lg"
                disabled={isLoading}
              >
                {isLoading ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Sending reset link...
                  </>
                ) : (
                  'Send reset link'
                )}
              </Button>

              <Link 
                to="/login" 
                className="text-sm text-primary font-medium hover:text-primary/80 transition-colors"
              >
                <ArrowLeft className="inline h-4 w-4 mr-1" />
                Back to login
              </Link>
            </CardFooter>
          </form>
        </Card>
      </div>
    </div>
  );
}
