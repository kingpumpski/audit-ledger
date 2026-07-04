import { createClient } from 'npm:@supabase/supabase-js@2'
import { corsHeaders } from 'npm:@supabase/supabase-js@2/cors'

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
  try { const b = await req.json(); token = String(b?.token || ''); otp = String(b?.otp || '') }
  catch { return json({ error: 'invalid_body' }, 400) }
  if (!/^\d{6}$/.test(otp)) return json({ error: 'invalid_otp_format' }, 400)

  const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
  const tokenHash = await sha256(token)
  const { data: row } = await admin.from('password_reset_tokens')
    .select('*').eq('token_hash', tokenHash).maybeSingle()
  if (!row) return json({ error: 'invalid_token' }, 400)
  if (row.used_at) return json({ error: 'token_used' }, 400)
  if (new Date(row.expires_at).getTime() < Date.now()) return json({ error: 'token_expired' }, 400)
  if ((row.otp_attempts ?? 0) >= 5) return json({ error: 'otp_locked' }, 429)
  const otpHash = await sha256(otp)
  if (row.otp_hash !== otpHash) {
    await admin.from('password_reset_tokens').update({ otp_attempts: (row.otp_attempts ?? 0) + 1 }).eq('id', row.id)
    return json({ error: 'otp_mismatch' }, 400)
  }
  return json({ ok: true })
})