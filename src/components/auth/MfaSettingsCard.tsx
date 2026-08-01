import { useEffect, useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { ShieldCheck, Loader2 } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

type Method = 'email' | 'sms' | 'totp';
type Settings = { method: Method; phone: string | null; enabled: boolean; totp_confirmed: boolean } | null;

export function MfaSettingsCard() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [settings, setSettings] = useState<Settings>(null);
  const [method, setMethod] = useState<Method>('email');
  const [phone, setPhone] = useState('');
  const [enabled, setEnabled] = useState(false);
  const [otpauth, setOtpauth] = useState<string | null>(null);
  const [secret, setSecret] = useState<string | null>(null);
  const [code, setCode] = useState('');

  const call = async (body: Record<string, unknown>) => {
    const { data, error } = await supabase.functions.invoke('mfa-setup', { body });
    if (error) throw error;
    if ((data as any)?.error) throw new Error((data as any).error);
    return data as any;
  };

  const load = async () => {
    setLoading(true);
    try {
      const d = await call({ action: 'status' });
      console.debug('[MfaSettingsCard] status', d);
      setSettings(d.settings);
      if (d.settings) {
        setMethod(d.settings.method);
        setPhone(d.settings.phone || '');
        setEnabled(d.settings.enabled);
      }
    } catch (e) {
      console.error('[MfaSettingsCard] status', e);
    } finally { setLoading(false); }
  };

  useEffect(() => { load(); }, []);

  const save = async () => {
    setSaving(true);
    try {
      await call({ action: 'save', method, phone, enabled });
      toast.success('Verification settings saved');
      await load();
    } catch (e: any) {
      const msg = e?.message || '';
      toast.error(
        msg.includes('invalid_phone') ? 'Enter your phone in international format, e.g. +233201234567.' :
        msg.includes('totp_not_confirmed') ? 'Confirm your authenticator app first.' :
        'Could not save verification settings.',
      );
    } finally { setSaving(false); }
  };

  const startTotp = async () => {
    setSaving(true);
    try {
      const d = await call({ action: 'totp_start' });
      setSecret(d.secret);
      setOtpauth(d.otpauth_url);
      setMethod('totp');
    } catch (e) {
      toast.error('Could not start authenticator setup.');
    } finally { setSaving(false); }
  };

  const confirmTotp = async () => {
    setSaving(true);
    try {
      await call({ action: 'totp_confirm', code });
      toast.success('Authenticator app enabled');
      setOtpauth(null); setSecret(null); setCode('');
      await load();
    } catch (e: any) {
      toast.error(e?.message?.includes('invalid_code') ? 'That code is incorrect — try the current one.' : 'Could not confirm the code.');
    } finally { setSaving(false); }
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between gap-3">
          <div>
            <CardTitle className="flex items-center gap-2">
              <ShieldCheck className="h-4 w-4" />Two-factor verification
            </CardTitle>
            <CardDescription>
              Require an extra verification step when resetting your password.
            </CardDescription>
          </div>
          {!loading && (
            <Badge variant={settings?.enabled ? 'default' : 'outline'}>
              {settings?.enabled ? 'Enabled' : 'Disabled'}
            </Badge>
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {loading ? <Skeleton className="h-24 w-full" /> : (
          <>
            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <Label>Verification method</Label>
                <Select value={method} onValueChange={(v) => setMethod(v as Method)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="email">Email code</SelectItem>
                    <SelectItem value="sms">SMS code</SelectItem>
                    <SelectItem value="totp">Authenticator app</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              {method === 'sms' && (
                <div className="space-y-2">
                  <Label htmlFor="mfa-phone">Mobile number</Label>
                  <Input id="mfa-phone" placeholder="+233201234567" value={phone}
                    onChange={e => setPhone(e.target.value)} />
                </div>
              )}
            </div>

            <div className="flex items-center justify-between rounded-lg border border-border p-3">
              <div>
                <p className="text-sm font-medium">Require verification on password reset</p>
                <p className="text-xs text-muted-foreground">
                  You'll enter a 6-digit code before choosing a new password.
                </p>
              </div>
              <Switch checked={enabled} onCheckedChange={setEnabled}
                aria-label="Require verification on password reset" />
            </div>

            {method === 'totp' && (
              <div className="space-y-3 rounded-lg border border-border p-3">
                {settings?.totp_confirmed && !otpauth ? (
                  <Alert><AlertDescription>Your authenticator app is set up. Re-run setup to link a new device.</AlertDescription></Alert>
                ) : null}
                {otpauth ? (
                  <div className="space-y-3">
                    <img
                      src={`https://api.qrserver.com/v1/create-qr-code/?size=180x180&data=${encodeURIComponent(otpauth)}`}
                      alt="QR code to add this account to your authenticator app"
                      className="h-[180px] w-[180px] rounded bg-background p-2"
                      loading="lazy"
                    />
                    <p className="text-xs text-muted-foreground break-all">
                      Or enter this key manually: <span className="font-mono">{secret}</span>
                    </p>
                    <div className="flex items-end gap-2">
                      <div className="space-y-2">
                        <Label htmlFor="totp-code">Enter the 6-digit code</Label>
                        <Input id="totp-code" className="w-[140px] font-mono tracking-widest" maxLength={6}
                          inputMode="numeric" value={code}
                          onChange={e => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))} />
                      </div>
                      <Button onClick={confirmTotp} disabled={saving || code.length !== 6}>
                        {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Confirm'}
                      </Button>
                    </div>
                  </div>
                ) : (
                  <Button variant="outline" onClick={startTotp} disabled={saving}>
                    {settings?.totp_confirmed ? 'Re-link authenticator app' : 'Set up authenticator app'}
                  </Button>
                )}
              </div>
            )}

            <Button onClick={save} disabled={saving}>
              {saving ? (<><Loader2 className="mr-2 h-4 w-4 animate-spin" />Saving...</>) : 'Save verification settings'}
            </Button>
          </>
        )}
      </CardContent>
    </Card>
  );
}
