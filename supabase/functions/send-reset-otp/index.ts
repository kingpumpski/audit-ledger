import { createClient } from 'npm:@supabase/supabase-js@2'
import { corsHeaders } from 'npm:@supabase/supabase-js@2/cors'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY')
const LOVABLE_API_KEY = Deno.env.get('LOVABLE_API_KEY')
const TWILIO_API_KEY = Deno.env.get('TWILIO_API_KEY')
const TWILIO_FROM = Deno.env.get('TWILIO_FROM_NUMBER')

function json(b: unknown, s = 200) {
  return new Response(JSON.stringify(b), { status: s, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
}
async function sha256(t: string) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(t))
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('')
}
function maskPhone(p?: string | null) {
  if (!p) return null
  return p.length <= 4 ? '••••' : `${'•'.repeat(Math.max(0, p.length - 4))}${p.slice(-4)}`
}
function maskEmail(e?: string | null) {
  if (!e) return null
  const [u, d] = e.split('@')
  return `${u.slice(0, 2)}${'•'.repeat(Math.max(1, u.length - 2))}@${d}`
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405)

  let token = ''
  try { const b = await req.json(); token = String(b?.token || '') } catch { return json({ error: 'invalid_body' }, 400) }
  if (!token || token.length < 16 || token.length > 128) return json({ error: 'invalid_token' }, 400)

  const admin = createClient(SUPABASE_URL, SERVICE_KEY)
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || null
  const tokenHash = await sha256(token)

  const { data: row } = await admin.from('password_reset_tokens')
    .select('id, user_id, expires_at, used_at, mfa_verified_at')
    .eq('token_hash', tokenHash).maybeSingle()
  if (!row) return json({ error: 'invalid_token' }, 400)
  if (row.used_at) return json({ error: 'token_used' }, 400)
  if (new Date(row.expires_at).getTime() < Date.now()) return json({ error: 'token_expired' }, 400)

  const { data: policy } = await admin.from('password_policy').select('*').eq('id', 1).single()
  const { data: mfa } = await admin.from('user_mfa').select('*').eq('user_id', row.user_id).maybeSingle()
  const { data: profile } = await admin.from('profiles').select('email, full_name, phone').eq('id', row.user_id).maybeSingle()

  const enabled = Boolean(mfa?.enabled) || Boolean(policy?.require_mfa)
  if (!enabled) {
    await admin.from('password_reset_tokens').update({ mfa_required: false, mfa_method: null }).eq('id', row.id)
    return json({ mfa_required: false })
  }

  const method: 'email' | 'sms' | 'totp' =
    (mfa?.method === 'totp' && mfa?.totp_confirmed) ? 'totp' :
    (mfa?.method === 'sms' && (mfa?.phone || profile?.phone)) ? 'sms' : 'email'

  const ttl = policy?.otp_ttl_minutes ?? 10

  if (method === 'totp') {
    await admin.from('password_reset_tokens')
      .update({ mfa_required: true, mfa_method: 'totp', otp_hash: null, otp_attempts: 0 }).eq('id', row.id)
    return json({ mfa_required: true, method: 'totp', destination: 'your authenticator app' })
  }

  const otp = String(Math.floor(100000 + Math.random() * 900000))
  await admin.from('password_reset_tokens')
    .update({ mfa_required: true, mfa_method: method, otp_hash: await sha256(otp), otp_attempts: 0 })
    .eq('id', row.id)

  let delivered = false
  let destination: string | null = null

  if (method === 'email' && RESEND_API_KEY && profile?.email) {
    destination = maskEmail(profile.email)
    try {
      const r = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${RESEND_API_KEY}` },
        body: JSON.stringify({
          from: 'Security <onboarding@resend.dev>',
          to: [profile.email],
          subject: 'Your password reset verification code',
          html: `<div style="font-family:Arial,sans-serif;max-width:520px;margin:0 auto;padding:24px;color:#111">
            <h2>Verification code</h2>
            <p>Hi ${profile.full_name || 'there'}, use this code to continue resetting your password:</p>
            <p style="font-size:32px;letter-spacing:8px;font-weight:bold">${otp}</p>
            <p style="font-size:12px;color:#666">Expires in ${ttl} minutes. Requested from ${ip || 'unknown IP'}.
            If this wasn't you, contact your administrator immediately.</p>
          </div>`,
        }),
      })
      delivered = r.ok
      if (!r.ok) console.error('[send-reset-otp] resend failed', r.status, await r.text())
    } catch (e) { console.error('[send-reset-otp] resend exception', e) }
  }

  if (method === 'sms') {
    const phone = mfa?.phone || profile?.phone || null
    destination = maskPhone(phone)
    if (phone && LOVABLE_API_KEY && TWILIO_API_KEY && TWILIO_FROM) {
      try {
        const r = await fetch('https://connector-gateway.lovable.dev/twilio/Messages.json', {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${LOVABLE_API_KEY}`,
            'X-Connection-Api-Key': TWILIO_API_KEY,
            'Content-Type': 'application/x-www-form-urlencoded',
          },
          body: new URLSearchParams({
            To: phone, From: TWILIO_FROM,
            Body: `Your password reset code is ${otp}. It expires in ${ttl} minutes.`,
          }),
        })
        delivered = r.ok
        if (!r.ok) console.error('[send-reset-otp] twilio failed', r.status, await r.text())
      } catch (e) { console.error('[send-reset-otp] twilio exception', e) }
    } else {
      console.error('[send-reset-otp] SMS not configured; falling back to email delivery')
    }
  }

  try {
    await admin.from('password_reset_attempts').insert({
      email: profile?.email ?? null, ip_address: ip,
      user_agent: req.headers.get('user-agent') || null,
      result: delivered ? 'sent' : 'failed',
      reason: delivered ? `mfa_${method}` : `mfa_${method}_delivery_failed`,
    })
  } catch (_) { /* noop */ }

  return json({ mfa_required: true, method, destination, delivered, expires_in_minutes: ttl })
})
