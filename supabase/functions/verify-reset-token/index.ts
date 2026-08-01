import { createClient } from 'npm:@supabase/supabase-js@2'
import { corsHeaders } from 'npm:@supabase/supabase-js@2/cors'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

function json(b: unknown, s = 200) {
  return new Response(JSON.stringify(b), { status: s, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
}

async function sha256(text: string) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('')
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405)
  let token = ''
  try { const b = await req.json(); token = String(b?.token || '').trim() } catch { return json({ status: 'invalid' }, 400) }
  if (!token || token.length < 16 || token.length > 128) return json({ status: 'invalid' })

  const admin = createClient(SUPABASE_URL, SERVICE_KEY)
  const tokenHash = await sha256(token)
  const { data: row } = await admin.from('password_reset_tokens')
    .select('id, user_id, expires_at, used_at, mfa_required, mfa_method, mfa_verified_at')
    .eq('token_hash', tokenHash).maybeSingle()
  if (!row) return json({ status: 'invalid' })
  if (row.used_at) return json({ status: 'used' })
  if (new Date(row.expires_at).getTime() < Date.now()) return json({ status: 'expired' })

  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || null
  const { data: profile } = await admin.from('profiles').select('email').eq('id', row.user_id).maybeSingle()
  const { data: locked } = await admin.rpc('is_reset_locked', { _email: profile?.email ?? null, _ip: ip })
  if (locked === true) return json({ status: 'locked' })

  const { data: policy } = await admin.from('password_policy').select('require_mfa').eq('id', 1).maybeSingle()
  const { data: mfa } = await admin.from('user_mfa').select('enabled, method, totp_confirmed').eq('user_id', row.user_id).maybeSingle()
  const mfaRequired = Boolean(row.mfa_required) || Boolean(mfa?.enabled) || Boolean(policy?.require_mfa)

  return json({
    status: 'valid',
    mfa_required: mfaRequired,
    mfa_method: row.mfa_method || (mfa?.method === 'totp' && mfa?.totp_confirmed ? 'totp' : mfa?.method) || 'email',
    mfa_verified: Boolean(row.mfa_verified_at),
  })
})