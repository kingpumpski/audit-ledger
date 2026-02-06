import { useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/contexts/AuthContext';
import { Key, Mail, MessageSquare, Shield, ExternalLink, CheckCircle, XCircle, Loader2 } from 'lucide-react';

interface SecretStatus {
  name: string;
  configured: boolean;
  label: string;
  description: string;
  docsUrl: string;
}

const INTEGRATION_SECRETS: SecretStatus[] = [
  {
    name: 'RESEND_API_KEY',
    configured: true, // We know this exists from project secrets
    label: 'Resend (Email)',
    description: 'Send transactional emails (invoices, receipts, notifications)',
    docsUrl: 'https://resend.com/api-keys',
  },
  {
    name: 'TWILIO_ACCOUNT_SID',
    configured: false,
    label: 'Twilio Account SID',
    description: 'SMS notifications for customers',
    docsUrl: 'https://console.twilio.com/',
  },
  {
    name: 'TWILIO_AUTH_TOKEN',
    configured: false,
    label: 'Twilio Auth Token',
    description: 'Authentication token for Twilio API',
    docsUrl: 'https://console.twilio.com/',
  },
  {
    name: 'TWILIO_PHONE_NUMBER',
    configured: false,
    label: 'Twilio Phone Number',
    description: 'The phone number to send SMS from',
    docsUrl: 'https://console.twilio.com/us1/develop/phone-numbers',
  },
];

export function IntegrationsSettings() {
  const { hasRole } = useAuth();
  const { toast } = useToast();
  const [isLoading, setIsLoading] = useState(false);

  const isAdmin = hasRole('admin');

  if (!isAdmin) {
    return (
      <Card>
        <CardContent className="py-12">
          <div className="text-center">
            <Shield className="h-12 w-12 mx-auto text-muted-foreground/50" />
            <h3 className="mt-4 text-lg font-medium">Admin Access Required</h3>
            <p className="text-muted-foreground">
              Only administrators can manage API keys and integrations.
            </p>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      <Alert>
        <Shield className="h-4 w-4" />
        <AlertTitle>Secure API Key Management</AlertTitle>
        <AlertDescription>
          API keys are stored securely and encrypted. They are only accessible to backend functions
          and are never exposed to the frontend. Contact your system administrator to add or update keys.
        </AlertDescription>
      </Alert>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Mail className="h-5 w-5" />
            Email Integration (Resend)
          </CardTitle>
          <CardDescription>
            Send invoice emails, payment confirmations, and overdue reminders to customers.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between p-4 border rounded-lg">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-primary/10">
                <Key className="h-4 w-4 text-primary" />
              </div>
              <div>
                <p className="font-medium">RESEND_API_KEY</p>
                <p className="text-sm text-muted-foreground">Resend API key for email delivery</p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Badge variant="outline" className="bg-success/10 text-success border-success/20">
                <CheckCircle className="h-3 w-3 mr-1" />
                Configured
              </Badge>
              <Button variant="outline" size="sm" asChild>
                <a href="https://resend.com/api-keys" target="_blank" rel="noopener noreferrer">
                  <ExternalLink className="h-3 w-3 mr-1" />
                  Manage
                </a>
              </Button>
            </div>
          </div>

          <div className="p-4 border rounded-lg bg-muted/50">
            <h4 className="font-medium mb-2">Domain Verification Required</h4>
            <p className="text-sm text-muted-foreground mb-3">
              To send emails to external recipients (customers), you must verify a sending domain in Resend.
              Without domain verification, emails can only be sent to your own email address for testing.
            </p>
            <Button variant="outline" size="sm" asChild>
              <a href="https://resend.com/domains" target="_blank" rel="noopener noreferrer">
                <ExternalLink className="h-3 w-3 mr-1" />
                Verify Domain
              </a>
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <MessageSquare className="h-5 w-5" />
            SMS Integration (Twilio)
          </CardTitle>
          <CardDescription>
            Send SMS notifications to customers for invoices and payment updates.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {['TWILIO_ACCOUNT_SID', 'TWILIO_AUTH_TOKEN', 'TWILIO_PHONE_NUMBER'].map((secretName) => {
            const secret = INTEGRATION_SECRETS.find(s => s.name === secretName);
            return (
              <div key={secretName} className="flex items-center justify-between p-4 border rounded-lg">
                <div className="flex items-center gap-3">
                  <div className="p-2 rounded-lg bg-muted">
                    <Key className="h-4 w-4 text-muted-foreground" />
                  </div>
                  <div>
                    <p className="font-medium">{secretName}</p>
                    <p className="text-sm text-muted-foreground">{secret?.description}</p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <Badge variant="outline" className="text-muted-foreground">
                    <XCircle className="h-3 w-3 mr-1" />
                    Not Configured
                  </Badge>
                </div>
              </div>
            );
          })}

          <div className="p-4 border rounded-lg bg-muted/50">
            <h4 className="font-medium mb-2">How to Configure SMS</h4>
            <ol className="text-sm text-muted-foreground space-y-1 list-decimal list-inside">
              <li>Sign up for a Twilio account at <a href="https://console.twilio.com/" target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">console.twilio.com</a></li>
              <li>Get your Account SID and Auth Token from the dashboard</li>
              <li>Purchase or set up a phone number for sending SMS</li>
              <li>Contact your system administrator to add these secrets</li>
            </ol>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Shield className="h-5 w-5" />
            Security Keys
          </CardTitle>
          <CardDescription>
            Additional security-related configurations and keys.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="p-4 border rounded-lg bg-muted/50">
            <p className="text-sm text-muted-foreground">
              Security keys like JWT secrets and encryption keys are managed automatically by the system.
              Contact your system administrator if you need to rotate or update security credentials.
            </p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
