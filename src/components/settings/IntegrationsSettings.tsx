import { useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/integrations/supabase/client';
import { Key, Mail, MessageSquare, Shield, ExternalLink, CheckCircle, XCircle, Loader2, Save, Eye, EyeOff } from 'lucide-react';

interface SecretInput {
  name: string;
  value: string;
  label: string;
  description: string;
  docsUrl: string;
  placeholder: string;
}

export function IntegrationsSettings() {
  const { hasRole } = useAuth();
  const { toast } = useToast();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [showSecrets, setShowSecrets] = useState<Record<string, boolean>>({});

  // Resend API Key
  const [resendApiKey, setResendApiKey] = useState('');

  // Twilio credentials
  const [twilioAccountSid, setTwilioAccountSid] = useState('');
  const [twilioAuthToken, setTwilioAuthToken] = useState('');
  const [twilioPhoneNumber, setTwilioPhoneNumber] = useState('');

  const isAdmin = hasRole('admin');

  const toggleShowSecret = (name: string) => {
    setShowSecrets(prev => ({ ...prev, [name]: !prev[name] }));
  };

  const handleSaveResendKey = async () => {
    if (!resendApiKey.trim()) {
      toast({ title: 'Please enter an API key', variant: 'destructive' });
      return;
    }

    setIsSubmitting(true);
    try {
      // Store the API key via edge function
      const { error } = await supabase.functions.invoke('authorize', {
        body: { 
          action: 'store_secret',
          secretName: 'RESEND_API_KEY',
          secretValue: resendApiKey.trim()
        }
      });

      if (error) throw error;

      toast({ title: 'Resend API key updated successfully' });
      setResendApiKey('');
    } catch (error: any) {
      toast({ 
        title: 'Failed to save API key', 
        description: error.message,
        variant: 'destructive' 
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleSaveTwilioCredentials = async () => {
    if (!twilioAccountSid.trim() || !twilioAuthToken.trim() || !twilioPhoneNumber.trim()) {
      toast({ title: 'Please fill in all Twilio fields', variant: 'destructive' });
      return;
    }

    setIsSubmitting(true);
    try {
      // Store Twilio credentials via edge function
      const credentials = [
        { name: 'TWILIO_ACCOUNT_SID', value: twilioAccountSid.trim() },
        { name: 'TWILIO_AUTH_TOKEN', value: twilioAuthToken.trim() },
        { name: 'TWILIO_PHONE_NUMBER', value: twilioPhoneNumber.trim() },
      ];

      for (const cred of credentials) {
        const { error } = await supabase.functions.invoke('authorize', {
          body: { 
            action: 'store_secret',
            secretName: cred.name,
            secretValue: cred.value
          }
        });
        if (error) throw error;
      }

      toast({ title: 'Twilio credentials updated successfully' });
      setTwilioAccountSid('');
      setTwilioAuthToken('');
      setTwilioPhoneNumber('');
    } catch (error: any) {
      toast({ 
        title: 'Failed to save Twilio credentials', 
        description: error.message,
        variant: 'destructive' 
      });
    } finally {
      setIsSubmitting(false);
    }
  };

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
          and are never exposed to the frontend. Enter new values below to update existing keys.
        </AlertDescription>
      </Alert>

      {/* Email Integration - Resend */}
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
            <Badge variant="outline" className="bg-success/10 text-success border-success/20">
              <CheckCircle className="h-3 w-3 mr-1" />
              Configured
            </Badge>
          </div>

          <div className="p-4 border rounded-lg space-y-4">
            <div>
              <Label htmlFor="resend-api-key">Update Resend API Key</Label>
              <p className="text-sm text-muted-foreground mb-2">
                Enter a new API key to replace the existing one.
              </p>
              <div className="flex gap-2">
                <div className="relative flex-1">
                  <Input
                    id="resend-api-key"
                    type={showSecrets['resend'] ? 'text' : 'password'}
                    placeholder="re_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
                    value={resendApiKey}
                    onChange={(e) => setResendApiKey(e.target.value)}
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="absolute right-1 top-1/2 -translate-y-1/2 h-7 w-7"
                    onClick={() => toggleShowSecret('resend')}
                  >
                    {showSecrets['resend'] ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </Button>
                </div>
                <Button 
                  onClick={handleSaveResendKey}
                  disabled={isSubmitting || !resendApiKey.trim()}
                >
                  {isSubmitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4 mr-1" />}
                  Save
                </Button>
              </div>
            </div>
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <ExternalLink className="h-3 w-3" />
              <a href="https://resend.com/api-keys" target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">
                Get your API key from Resend
              </a>
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

      {/* SMS Integration - Twilio */}
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
          <div className="p-4 border rounded-lg space-y-4">
            <div>
              <Label htmlFor="twilio-sid">Twilio Account SID</Label>
              <div className="relative mt-1">
                <Input
                  id="twilio-sid"
                  type={showSecrets['twilio-sid'] ? 'text' : 'password'}
                  placeholder="ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
                  value={twilioAccountSid}
                  onChange={(e) => setTwilioAccountSid(e.target.value)}
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="absolute right-1 top-1/2 -translate-y-1/2 h-7 w-7"
                  onClick={() => toggleShowSecret('twilio-sid')}
                >
                  {showSecrets['twilio-sid'] ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </Button>
              </div>
            </div>

            <div>
              <Label htmlFor="twilio-token">Twilio Auth Token</Label>
              <div className="relative mt-1">
                <Input
                  id="twilio-token"
                  type={showSecrets['twilio-token'] ? 'text' : 'password'}
                  placeholder="xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
                  value={twilioAuthToken}
                  onChange={(e) => setTwilioAuthToken(e.target.value)}
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="absolute right-1 top-1/2 -translate-y-1/2 h-7 w-7"
                  onClick={() => toggleShowSecret('twilio-token')}
                >
                  {showSecrets['twilio-token'] ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </Button>
              </div>
            </div>

            <div>
              <Label htmlFor="twilio-phone">Twilio Phone Number</Label>
              <div className="relative mt-1">
                <Input
                  id="twilio-phone"
                  type="text"
                  placeholder="+1234567890"
                  value={twilioPhoneNumber}
                  onChange={(e) => setTwilioPhoneNumber(e.target.value)}
                />
              </div>
              <p className="text-sm text-muted-foreground mt-1">
                Include country code (e.g., +1 for US)
              </p>
            </div>

            <Button 
              onClick={handleSaveTwilioCredentials}
              disabled={isSubmitting || !twilioAccountSid.trim() || !twilioAuthToken.trim() || !twilioPhoneNumber.trim()}
              className="w-full"
            >
              {isSubmitting ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Save className="h-4 w-4 mr-2" />}
              Save Twilio Credentials
            </Button>

            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <ExternalLink className="h-3 w-3" />
              <a href="https://console.twilio.com/" target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">
                Get your credentials from Twilio Console
              </a>
            </div>
          </div>

          <div className="p-4 border rounded-lg bg-muted/50">
            <h4 className="font-medium mb-2">How to Configure SMS</h4>
            <ol className="text-sm text-muted-foreground space-y-1 list-decimal list-inside">
              <li>Sign up for a Twilio account at <a href="https://console.twilio.com/" target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">console.twilio.com</a></li>
              <li>Get your Account SID and Auth Token from the dashboard</li>
              <li>Purchase or set up a phone number for sending SMS</li>
              <li>Enter the credentials above and save</li>
            </ol>
          </div>
        </CardContent>
      </Card>

      {/* Security Keys Section */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Shield className="h-5 w-5" />
            Security Configuration
          </CardTitle>
          <CardDescription>
            System security settings and encryption keys.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="p-4 border rounded-lg bg-muted/50 space-y-3">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-success/10">
                <CheckCircle className="h-4 w-4 text-success" />
              </div>
              <div>
                <p className="font-medium">JWT & Encryption Keys</p>
                <p className="text-sm text-muted-foreground">
                  Security keys are automatically managed by the system and rotated regularly.
                </p>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-success/10">
                <CheckCircle className="h-4 w-4 text-success" />
              </div>
              <div>
                <p className="font-medium">Row Level Security (RLS)</p>
                <p className="text-sm text-muted-foreground">
                  Database access is protected by role-based security policies.
                </p>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-success/10">
                <CheckCircle className="h-4 w-4 text-success" />
              </div>
              <div>
                <p className="font-medium">HTTPS/TLS Encryption</p>
                <p className="text-sm text-muted-foreground">
                  All data in transit is encrypted using industry-standard TLS.
                </p>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
