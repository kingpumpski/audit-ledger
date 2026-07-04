import { Link } from 'react-router-dom';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { ArrowLeft } from 'lucide-react';

export default function HelpPasswordReset() {
  return (
    <div className="min-h-screen flex items-center justify-center p-4 bg-background">
      <Card className="max-w-lg w-full">
        <CardHeader>
          <CardTitle>Password reset help</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm text-muted-foreground">
          <p><strong>Didn't get the email?</strong> Check your spam folder. Links expire after 30 minutes; you can request another one from the Forgot Password page.</p>
          <p><strong>Account locked or disabled?</strong> Contact your system administrator to reactivate the account.</p>
          <p><strong>Password requirements:</strong> at least 12 characters with uppercase, lowercase, a number and a special character. You cannot reuse any of your last 10 passwords.</p>
          <p><strong>Still need help?</strong> Email <a className="text-primary hover:underline" href="mailto:admin@company.local">admin@company.local</a>.</p>
          <Button variant="outline" asChild><Link to="/forgot-password"><ArrowLeft className="h-4 w-4 mr-2" />Back</Link></Button>
        </CardContent>
      </Card>
    </div>
  );
}