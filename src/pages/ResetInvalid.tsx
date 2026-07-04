import { Link, useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { AlertTriangle } from 'lucide-react';

export default function ResetInvalid() {
  const navigate = useNavigate();
  return (
    <div className="min-h-screen flex items-center justify-center p-4 bg-background">
      <Card className="max-w-md w-full">
        <CardHeader className="text-center">
          <div className="mx-auto inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-destructive/10 mb-4">
            <AlertTriangle className="h-8 w-8 text-destructive" />
          </div>
          <CardTitle>Invalid reset link</CardTitle>
          <CardDescription>This link is invalid or has already been used. Request a new one to reset your password.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-2">
          <Button onClick={() => navigate('/forgot-password')} size="lg">Request new link</Button>
          <Button variant="outline" asChild><Link to="/login">Back to Login</Link></Button>
        </CardContent>
      </Card>
    </div>
  );
}