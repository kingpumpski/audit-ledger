import { Link, useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { CheckCircle2 } from 'lucide-react';

export default function ResetSuccess() {
  const navigate = useNavigate();
  return (
    <div className="min-h-screen flex items-center justify-center p-4 bg-background">
      <Card className="max-w-md w-full">
        <CardHeader className="text-center">
          <div className="mx-auto inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-success/10 mb-4">
            <CheckCircle2 className="h-8 w-8 text-success" />
          </div>
          <CardTitle>Password successfully changed</CardTitle>
          <CardDescription>
            Your password has been updated. For your security you have been signed out of all sessions.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-2">
          <Button onClick={() => navigate('/login')} size="lg">Login now</Button>
          <Button variant="outline" asChild><Link to="/">Return home</Link></Button>
        </CardContent>
      </Card>
    </div>
  );
}