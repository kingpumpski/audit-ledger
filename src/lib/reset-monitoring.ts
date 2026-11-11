export type ResetAttempt = { id: string; email: string | null; ip_address: string | null; user_agent: string | null; result: string; reason: string | null; created_at: string };
export type ResetToken = { id: string; user_id: string; channel: string; expires_at: string; used_at: string | null; mfa_required: boolean | null; mfa_method: string | null; mfa_verified_at: string | null; otp_attempts: number | null; ip_address: string | null; created_at: string };
export function tokenStatus(token: Pick<ResetToken, 'used_at' | 'expires_at'>, now: number) {
  return token.used_at ? 'completed' : new Date(token.expires_at).getTime() > now ? 'pending' : 'expired';
}
export function suspiciousAttempts(attempts: ResetAttempt[]) {
  // Flag explicit failures/blocks and bursts of at least five requests within one hour, not lifetime totals.
  const requests = attempts.filter(a => a.result === 'requested' && a.ip_address);
  return new Set(attempts.filter(a => {
    if (['failed', 'locked', 'blocked'].includes(a.result)) return true;
    if (!a.ip_address) return false;
    const time = new Date(a.created_at).getTime();
    return requests.filter(r => r.ip_address === a.ip_address && Math.abs(new Date(r.created_at).getTime() - time) < 3_600_000).length >= 5;
  }).map(a => a.id));
}
export function csvCell(value: unknown) {
  const text = String(value ?? '');
  return `"${(/^[\s]*[=+\-@]/.test(text) ? "'" : '') + text.replace(/"/g, '""')}"`;
}