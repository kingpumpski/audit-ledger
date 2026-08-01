import { createClient } from 'npm:@supabase/supabase-js@2'
import { corsHeaders } from 'npm:@supabase/supabase-js@2/cors'
import { verifyTotp } from '../_shared/totp.ts'

function json(b: unknown, s = 200) {
  return new Response(JSON.stringify(b), { status: s, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
}
async function sha256(t: string) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(t))
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('')
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405)

  let token = '', otp = ''
  try { const b = await req.json(); token = String(b?.token || ''); otp = String(b?.otp || '').trim() }
  catch { return json({ error: 'invalid_body' }, 400) }
  if (!/^\d{6}$/.test(otp)) return json({ error: 'invalid_otp_format' }, 400)

  const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || null
  const tokenHash = await sha256(token)

  const { data: row } = await admin.from('password_reset_tokens')
    .select('*').eq('token_hash', tokenHash).maybeSingle()
  if (!row) return json({ error: 'invalid_token' }, 400)
  if (row.used_at) return json({ error: 'token_used' }, 400)
  if (new Date(row.expires_at).getTime() < Date.now()) return json({ error: 'token_expired' }, 400)

  const { data: profile } = await admin.from('profiles').select('email').eq('id', row.user_id).maybeSingle()
  const email = profile?.email ?? null

  const { data: locked } = await admin.rpc('is_reset_locked', { _email: email, _ip: ip })
  if (locked === true) return json({ error: 'locked_out' }, 429)
  if ((row.otp_attempts ?? 0) >= 5) return json({ error: 'otp_locked' }, 429)

  let ok = false
  if (row.mfa_method === 'totp') {
    const { data: mfa } = await admin.from('user_mfa').select('totp_secret, totp_confirmed').eq('user_id', row.user_id).maybeSingle()
    ok = Boolean(mfa?.totp_secret && mfa?.totp_confirmed) && await verifyTotp(mfa!.totp_secret as string, otp)
  } else {
    ok = Boolean(row.otp_hash) && row.otp_hash === await sha256(otp)
  }

  if (!ok) {
    await admin.from('password_reset_tokens')
      .update({ otp_attempts: (row.otp_attempts ?? 0) + 1, mfa_attempts: (row.mfa_attempts ?? 0) + 1 })
      .eq('id', row.id)
    const { data: lock } = await admin.rpc('register_reset_failure', { _email: email, _ip: ip })
    try {
      await admin.from('password_reset_attempts').insert({
        email, ip_address: ip, user_agent: req.headers.get('user-agent') || null,
        result: (lock as any)?.locked ? 'locked' : 'failed',
        reason: (lock as any)?.locked ? 'lockout_after_failed_mfa' : 'mfa_mismatch',
      })
    } catch (_) { /* noop */ }
    if ((lock as any)?.locked) {
      return json({ error: 'locked_out', locked_until: (lock as any)?.locked_until }, 429)
    }
    return json({ error: 'otp_mismatch', attempts_remaining: Math.max(0, 5 - ((row.otp_attempts ?? 0) + 1)) }, 400)
  }

  await admin.from('password_reset_tokens')
    .update({ mfa_verified_at: new Date().toISOString(), otp_attempts: 0 }).eq('id', row.id)
  try { await admin.rpc('clear_reset_lockout', { _email: email, _ip: ip }) } catch (_) { /* noop */ }
  try {
    await admin.from('password_reset_attempts').insert({
      email, ip_address: ip, user_agent: req.headers.get('user-agent') || null,
      result: 'sent', reason: `mfa_verified_${row.mfa_method || 'email'}`,
    })
  } catch (_) { /* noop */ }

  return json({ ok: true })
})
