import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2'
import { corsHeaders } from 'npm:@supabase/supabase-js@2/cors'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY')

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

async function logAttempt(admin: SupabaseClient, row: Record<string, unknown>) {
  try {
    const { error } = await admin.from('password_reset_attempts').insert(row)
    if (error) console.error('Failed to record password reset attempt:', error.message)
  } catch (error) {
    console.error('Failed to record password reset attempt:', error)
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405)

  const admin = createClient(SUPABASE_URL, SERVICE_KEY)
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || null
  const ua = req.headers.get('user-agent') || null

  let identifier = ''
  try {
    const body = await req.json()
    identifier = String(body?.identifier || body?.email || body?.username || '').trim().toLowerCase()
  } catch { return json({ error: 'invalid_body' }, 400) }

  if (!identifier || identifier.length > 320) {
    return json({ error: 'invalid_identifier' }, 400)
  }

  // Load policy for rate limit
  const { data: policy } = await admin.from('password_policy').select('*').eq('id', 1).single()
  const maxPerHour = policy?.max_requests_per_hour ?? 5
  const tokenTtl = policy?.token_ttl_minutes ?? 30

  const { data: countData } = await admin.rpc('count_recent_reset_requests', {
    _email: identifier, _ip: ip, _minutes: 60,
  })
  const recentCount = Number(countData ?? 0)
  if (recentCount >= maxPerHour) {
    await logAttempt(admin, { email: identifier, ip_address: ip, user_agent: ua, result: 'blocked', reason: 'rate_limited' })
    return json({ ok: true, throttled: true }) // don't reveal
  }

  // Temporary lockout after repeated failures
  const { data: locked } = await admin.rpc('is_reset_locked', { _email: identifier, _ip: ip })
  if (locked === true) {
    await logAttempt(admin, { email: identifier, ip_address: ip, user_agent: ua, result: 'blocked', reason: 'locked_out' })
    return json({ ok: true, locked: true })
  }

  // Look up user by email or profile.username-like (we use email in profiles)
  const { data: profile } = await admin
    .from('profiles')
    .select('id, email, full_name, is_active')
    .or(`email.eq.${identifier}`)
    .maybeSingle()

  await logAttempt(admin, { email: identifier, ip_address: ip, user_agent: ua, result: 'requested' })

  // Neutral response: never disclose whether user exists
  if (!profile) return json({ ok: true })
  if (profile.is_active === false) {
    await logAttempt(admin, { email: identifier, ip_address: ip, user_agent: ua, result: 'blocked', reason: 'inactive' })
    return json({ ok: true })
  }

  // Generate token
  const bytes = new Uint8Array(32); crypto.getRandomValues(bytes)
  const token = Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('')
  const tokenHash = [...new Uint8Array(
    await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token))
  )].map(b => b.toString(16).padStart(2, '0')).join('')
  const expires = new Date(Date.now() + tokenTtl * 60_000).toISOString()

  await admin.from('password_reset_tokens').insert({
    user_id: profile.id,
    token_hash: tokenHash,
    channel: 'email',
    expires_at: expires,
    ip_address: ip,
    user_agent: ua,
  })

  const origin = req.headers.get('origin') || req.headers.get('referer')?.replace(/\/$/, '') || ''
  const link = `${origin}/reset-password?token=${token}`

  // Send email via Resend
  if (RESEND_API_KEY) {
    try {
      const html = `
        <div style="font-family:Arial,sans-serif;max-width:560px;margin:0 auto;padding:24px;color:#111">
          <h2>Password reset request</h2>
          <p>Hi ${profile.full_name || 'there'},</p>
          <p>We received a request to reset your password. Click the button below to choose a new one. This link expires in ${tokenTtl} minutes.</p>
          <p><a href="${link}" style="display:inline-block;background:#0f766e;color:#fff;padding:12px 20px;border-radius:8px;text-decoration:none">Reset password</a></p>
          <p style="font-size:12px;color:#666">If you didn't request this, please ignore this email — your password will not change.</p>
          <p style="font-size:12px;color:#666">IP: ${ip || 'unknown'} • Browser: ${(ua || 'unknown').slice(0,120)}</p>
        </div>`
      const r = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${RESEND_API_KEY}` },
        body: JSON.stringify({
          from: 'Password Reset <onboarding@resend.dev>',
          to: [profile.email],
          subject: 'Reset your password',
          html,
        }),
      })
      const sent = r.ok
      await logAttempt(admin, { email: identifier, ip_address: ip, user_agent: ua, result: sent ? 'sent' : 'failed', reason: sent ? null : `resend_${r.status}` })
    } catch (e) {
      await logAttempt(admin, { email: identifier, ip_address: ip, user_agent: ua, result: 'failed', reason: 'resend_exception' })
    }
  }

  // Notification in-app
  try {
    await admin.from('notifications').insert({
      user_id: profile.id,
      type: 'security',
      title: 'Password reset requested',
      message: `A password reset was requested from ${ip || 'unknown IP'}.`,
    })
  } catch (_) { /* table may differ */ }

  return json({ ok: true })
})