import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Progress } from '@/components/ui/progress';
import { KeyRound, Loader2, Eye, EyeOff, Check, X, ArrowLeft, ShieldCheck, Smartphone, Mail, Lock } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';

type Policy = {
  min_length: number; require_uppercase: boolean; require_lowercase: boolean;
  require_number: boolean; require_special: boolean; disallow_spaces: boolean;
};
const defaultPolicy: Policy = {
  min_length: 12, require_uppercase: true, require_lowercase: true,
  require_number: true, require_special: true, disallow_spaces: true,
};

function strength(pw: string) {
  let s = 0;
  if (pw.length >= 8) s++;
  if (pw.length >= 12) s++;
  if (/[A-Z]/.test(pw) && /[a-z]/.test(pw)) s++;
  if (/\d/.test(pw)) s++;
  if (/[^A-Za-z0-9]/.test(pw)) s++;
  if (pw.length >= 16) s++;
  const labels = ['Very Weak','Weak','Fair','Good','Strong','Very Strong'];
  return { score: s, label: labels[Math.min(s, labels.length - 1)] };
}

export default function ResetPassword() {
  const [params] = useSearchParams();
  const token = params.get('token') || '';
  const navigate = useNavigate();
  const [status, setStatus] = useState<'checking'|'valid'|'expired'|'invalid'|'used'|'locked'>('checking');
  const [step, setStep] = useState<'mfa'|'password'>('password');
  const [mfaMethod, setMfaMethod] = useState<'email'|'sms'|'totp'>('email');
  const [mfaDestination, setMfaDestination] = useState<string | null>(null);
  const [otp, setOtp] = useState('');
  const [otpError, setOtpError] = useState('');
  const [otpSending, setOtpSending] = useState(false);
  const [otpVerifying, setOtpVerifying] = useState(false);
  const [policy, setPolicy] = useState<Policy>(defaultPolicy);
  const [pw, setPw] = useState(''); const [pw2, setPw2] = useState('');
  const [show, setShow] = useState(false); const [show2, setShow2] = useState(false);
  const [error, setError] = useState(''); const [submitting, setSubmitting] = useState(false);

  const requestOtp = async (t: string) => {
    setOtpSending(true); setOtpError('');
    try {
      const { data, error } = await supabase.functions.invoke('send-reset-otp', { body: { token: t } });
      if (error) throw error;
      const d = data as any;
      console.debug('[ResetPassword] send-reset-otp', d);
      if (d?.error) throw new Error(d.error);
      if (!d?.mfa_required) { setStep('password'); return; }
      setMfaMethod(d.method || 'email');
      setMfaDestination(d.destination ?? null);
      setStep('mfa');
      if (d.method !== 'totp' && d.delivered === false) {
        setOtpError('We could not deliver your code right now. Try resending, or contact your administrator.');
      }
    } catch (err: any) {
      console.error('[ResetPassword] send-reset-otp', err);
      setOtpError('Could not send your verification code. Please try again.');
    } finally { setOtpSending(false); }
  };

  useEffect(() => {
    if (!token) { setStatus('invalid'); return; }
    (async () => {
      const [{ data: pol }, { data: v }] = await Promise.all([
        supabase.functions.invoke('password-policy'),
        supabase.functions.invoke('verify-reset-token', { body: { token } }),
      ]);
      if (pol) setPolicy({ ...defaultPolicy, ...pol });
      const res = (v as any) || {};
      const s = res.status;
      if (s === 'valid') {
        setStatus('valid');
        if (res.mfa_required && !res.mfa_verified) {
          setMfaMethod(res.mfa_method || 'email');
          setStep('mfa');
          await requestOtp(token);
        } else {
          setStep('password');
        }
      }
      else if (s === 'locked') setStatus('locked');
      else if (s === 'expired') { setStatus('expired'); navigate('/reset-expired', { replace: true }); }
      else if (s === 'used') { setStatus('invalid'); navigate('/reset-invalid', { replace: true }); }
      else { setStatus('invalid'); navigate('/reset-invalid', { replace: true }); }
    })();
  }, [token, navigate]);

  const verifyOtp = async (e: React.FormEvent) => {
    e.preventDefault();
    setOtpError('');
    if (!/^\d{6}$/.test(otp)) { setOtpError('Enter the 6-digit code.'); return; }
    setOtpVerifying(true);
    try {
      const { data, error } = await supabase.functions.invoke('verify-otp', { body: { token, otp } });
      if (error) throw error;
      const d = data as any;
      if (d?.error) throw new Error(d.error);
      setStep('password');
      setOtp('');
    } catch (err: any) {
      console.error('[ResetPassword] verify-otp', err);
      const msg = err?.message || String(err);
      if (msg.includes('locked')) { setStatus('locked'); return; }
      setOtpError(
        msg.includes('otp_mismatch') ? 'That code is incorrect. Please try again.' :
        msg.includes('token_expired') ? 'This reset link has expired. Request a new one.' :
        'Could not verify that code. Please try again.'
      );
    } finally { setOtpVerifying(false); }
  };

  const checks = useMemo(() => ([
    { ok: pw.length >= policy.min_length, label: `At least ${policy.min_length} characters` },
    { ok: !policy.require_uppercase || /[A-Z]/.test(pw), label: 'One uppercase letter' },
    { ok: !policy.require_lowercase || /[a-z]/.test(pw), label: 'One lowercase letter' },
    { ok: !policy.require_number || /\d/.test(pw), label: 'One number' },
    { ok: !policy.require_special || /[^A-Za-z0-9]/.test(pw), label: 'One special character' },
    { ok: !policy.disallow_spaces || !/\s/.test(pw), label: 'No spaces' },
  ]), [pw, policy]);

  const allOk = checks.every(c => c.ok);
  const match = pw && pw === pw2;
  const meter = strength(pw);
  const barColor = ['bg-destructive','bg-destructive','bg-warning','bg-warning','bg-success','bg-success'][meter.score] || 'bg-muted';

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (!allOk) { setError('Password does not meet all requirements.'); return; }
    if (!match) { setError('Passwords do not match.'); return; }
    setSubmitting(true);
    try {
      const { data, error } = await supabase.functions.invoke('reset-password', { body: { token, password: pw } });
      if (error) throw error;
      if ((data as any)?.error) throw new Error((data as any).error);
      try { await supabase.auth.signOut(); } catch {}
      navigate('/reset-success', { replace: true });
    } catch (err: any) {
      console.error('[ResetPassword]', err);
      const msg = err?.message || String(err);
      setError(
        msg === 'password_reused' ? 'You cannot reuse a recent password.' :
        msg === 'policy_violation' ? 'Password does not meet policy requirements.' :
        msg === 'token_expired' ? 'This reset link has expired.' :
        msg.includes('mfa_required') ? 'Additional verification is required before changing your password.' :
        msg.includes('locked_out') ? 'Too many attempts. Password reset is temporarily locked.' :
        msg === 'token_used' || msg === 'invalid_token' ? 'This reset link is invalid.' :
        'Could not reset password. Please try again.'
      );
      if (msg.includes('mfa_required')) { setStep('mfa'); await requestOtp(token); }
      if (msg.includes('locked_out')) setStatus('locked');
    } finally { setSubmitting(false); }
  };

  if (status === 'checking') {
    return <div className="min-h-screen flex items-center justify-center"><Loader2 className="h-6 w-6 animate-spin" /></div>;
  }
  if (status === 'locked') {
    return (
      <div className="min-h-screen flex items-center justify-center p-4 bg-background">
        <Card className="w-full max-w-md shadow-xl">
          <CardHeader>
            <div className="inline-flex items-center justify-center w-12 h-12 rounded-2xl bg-destructive/10 mb-2">
              <Lock className="h-6 w-6 text-destructive" />
            </div>
            <CardTitle>Temporarily locked</CardTitle>
            <CardDescription>
              Too many failed password reset attempts. For your security, this option is locked for 30 minutes.
            </CardDescription>
          </CardHeader>
          <CardFooter className="flex flex-col gap-2">
            <Button className="w-full" onClick={() => navigate('/login')}>Back to Login</Button>
            <Link to="/help/password-reset" className="text-xs text-primary hover:underline">Need help?</Link>
          </CardFooter>
        </Card>
      </div>
    );
  }
  if (status !== 'valid') return null;

  if (step === 'mfa') {
    const MethodIcon = mfaMethod === 'sms' ? Smartphone : mfaMethod === 'totp' ? ShieldCheck : Mail;
    return (
      <div className="min-h-screen flex items-center justify-center p-4 bg-background">
        <div className="w-full max-w-md">
          <div className="text-center mb-6">
            <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-primary mb-4">
              <ShieldCheck className="h-7 w-7 text-primary-foreground" />
            </div>
            <h1 className="text-2xl font-display font-bold">Verify it's you</h1>
          </div>
          <Card className="shadow-xl">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-lg">
                <MethodIcon className="h-4 w-4" />
                {mfaMethod === 'totp' ? 'Authenticator app' : mfaMethod === 'sms' ? 'SMS verification' : 'Email verification'}
              </CardTitle>
              <CardDescription>
                {mfaMethod === 'totp'
                  ? 'Enter the current 6-digit code from your authenticator app.'
                  : `Enter the 6-digit code we sent to ${mfaDestination || 'your registered contact'}.`}
              </CardDescription>
            </CardHeader>
            <form onSubmit={verifyOtp}>
              <CardContent className="space-y-4">
                {otpError && <Alert variant="destructive"><AlertDescription>{otpError}</AlertDescription></Alert>}
                <div className="space-y-2">
                  <Label htmlFor="otp">Verification code</Label>
                  <Input id="otp" inputMode="numeric" autoComplete="one-time-code" maxLength={6}
                    className="text-center text-2xl tracking-[0.5em] font-mono"
                    value={otp} onChange={(e) => setOtp(e.target.value.replace(/\D/g, '').slice(0, 6))}
                    autoFocus required />
                </div>
              </CardContent>
              <CardFooter className="flex flex-col gap-2">
                <Button type="submit" className="w-full" size="lg" disabled={otpVerifying || otp.length !== 6}>
                  {otpVerifying ? (<><Loader2 className="mr-2 h-4 w-4 animate-spin" />Verifying...</>) : 'Verify & continue'}
                </Button>
                {mfaMethod !== 'totp' && (
                  <Button type="button" variant="outline" className="w-full"
                    onClick={() => requestOtp(token)} disabled={otpSending}>
                    {otpSending ? (<><Loader2 className="mr-2 h-4 w-4 animate-spin" />Sending...</>) : 'Resend code'}
                  </Button>
                )}
                <Link to="/login" className="text-xs text-primary hover:underline flex items-center gap-1">
                  <ArrowLeft className="h-3 w-3" />Back to Login
                </Link>
              </CardFooter>
            </form>
          </Card>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-4 bg-background">
      <div className="w-full max-w-md">
        <div className="text-center mb-6">
          <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-primary mb-4">
            <KeyRound className="h-7 w-7 text-primary-foreground" />
          </div>
          <h1 className="text-2xl font-display font-bold">Choose a new password</h1>
        </div>
        <Card className="shadow-xl">
          <CardHeader>
            <CardTitle>Set new password</CardTitle>
            <CardDescription>Your password must meet all requirements below.</CardDescription>
          </CardHeader>
          <form onSubmit={submit}>
            <CardContent className="space-y-4">
              {error && <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>}

              <div className="space-y-2">
                <Label htmlFor="pw">New password</Label>
                <div className="relative">
                  <Input id="pw" type={show ? 'text' : 'password'} value={pw}
                    onChange={(e) => setPw(e.target.value)} autoComplete="new-password" required autoFocus />
                  <button type="button" onClick={() => setShow(s => !s)}
                    aria-label={show ? 'Hide password' : 'Show password'}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground">
                    {show ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
                <div className="space-y-1">
                  <div className="flex justify-between text-xs">
                    <span className="text-muted-foreground">Strength</span>
                    <span>{pw ? meter.label : '—'}</span>
                  </div>
                  <Progress value={(meter.score / 6) * 100} className={`h-2 [&>div]:${barColor}`} />
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="pw2">Confirm password</Label>
                <div className="relative">
                  <Input id="pw2" type={show2 ? 'text' : 'password'} value={pw2}
                    onChange={(e) => setPw2(e.target.value)} autoComplete="new-password" required />
                  <button type="button" onClick={() => setShow2(s => !s)}
                    aria-label={show2 ? 'Hide password' : 'Show password'}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground">
                    {show2 ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
                {pw2 && !match && <p className="text-xs text-destructive">Passwords do not match.</p>}
              </div>

              <ul className="space-y-1 text-xs" aria-label="Password requirements">
                {checks.map((c, i) => (
                  <li key={i} className={c.ok ? 'text-success flex items-center gap-2' : 'text-muted-foreground flex items-center gap-2'}>
                    {c.ok ? <Check className="h-3.5 w-3.5" /> : <X className="h-3.5 w-3.5" />}
                    {c.label}
                  </li>
                ))}
              </ul>
            </CardContent>
            <CardFooter className="flex flex-col gap-2">
              <Button type="submit" className="w-full" size="lg" disabled={submitting || !allOk || !match}>
                {submitting ? (<><Loader2 className="mr-2 h-4 w-4 animate-spin" />Updating...</>) : 'Update password'}
              </Button>
              <Button type="button" variant="outline" className="w-full" onClick={() => navigate('/login')}>Cancel</Button>
              <Link to="/login" className="text-xs text-primary hover:underline flex items-center gap-1">
                <ArrowLeft className="h-3 w-3" />Back to Login
              </Link>
            </CardFooter>
          </form>
        </Card>
      </div>
    </div>
  );
}