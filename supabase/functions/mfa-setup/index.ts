import { createClient } from 'npm:@supabase/supabase-js@2'
import { corsHeaders } from 'npm:@supabase/supabase-js@2/cors'
import { generateTotpSecret, verifyTotp } from '../_shared/totp.ts'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!

function json(b: unknown, s = 200) {
  return new Response(JSON.stringify(b), { status: s, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405)

  const authHeader = req.headers.get('Authorization') || ''
  if (!authHeader.startsWith('Bearer ')) return json({ error: 'unauthorized' }, 401)

  const authed = createClient(SUPABASE_URL, ANON_KEY, { global: { headers: { Authorization: authHeader } } })
  const { data: userData, error: userErr } = await authed.auth.getUser()
  if (userErr || !userData?.user) return json({ error: 'unauthorized' }, 401)
  const user = userData.user

  let action = '', code = '', method = '', phone = '', enabled: boolean | undefined
  try {
    const b = await req.json()
    action = String(b?.action || '')
    code = String(b?.code || '').trim()
    method = String(b?.method || '')
    phone = String(b?.phone || '').trim()
    if (typeof b?.enabled === 'boolean') enabled = b.enabled
  } catch { return json({ error: 'invalid_body' }, 400) }

  const admin = createClient(SUPABASE_URL, SERVICE_KEY)

  if (action === 'status') {
    const { data } = await admin.from('user_mfa')
      .select('method, phone, enabled, totp_confirmed').eq('user_id', user.id).maybeSingle()
    return json({ ok: true, settings: data ?? null })
  }

  if (action === 'save') {
    if (!['email', 'sms', 'totp'].includes(method)) return json({ error: 'invalid_method' }, 400)
    if (method === 'sms' && !/^\+[1-9]\d{7,14}$/.test(phone)) return json({ error: 'invalid_phone' }, 400)
    const { data: existing } = await admin.from('user_mfa').select('totp_confirmed').eq('user_id', user.id).maybeSingle()
    if (method === 'totp' && enabled && !existing?.totp_confirmed) return json({ error: 'totp_not_confirmed' }, 400)
    const { error } = await admin.from('user_mfa').upsert({
      user_id: user.id, method, phone: method === 'sms' ? phone : null,
      enabled: enabled ?? false, updated_at: new Date().toISOString(),
    }, { onConflict: 'user_id' })
    if (error) return json({ error: 'save_failed', detail: error.message }, 500)
    return json({ ok: true })
  }

  if (action === 'totp_start') {
    const secret = generateTotpSecret()
    const { error } = await admin.from('user_mfa').upsert({
      user_id: user.id, method: 'totp', totp_secret: secret, totp_confirmed: false,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'user_id' })
    if (error) return json({ error: 'save_failed', detail: error.message }, 500)
    const label = encodeURIComponent(user.email || user.id)
    return json({
      ok: true, secret,
      otpauth_url: `otpauth://totp/Finance:${label}?secret=${secret}&issuer=Finance&algorithm=SHA1&digits=6&period=30`,
    })
  }

  if (action === 'totp_confirm') {
    const { data } = await admin.from('user_mfa').select('totp_secret').eq('user_id', user.id).maybeSingle()
    if (!data?.totp_secret) return json({ error: 'no_totp_setup' }, 400)
    if (!await verifyTotp(data.totp_secret as string, code)) return json({ error: 'invalid_code' }, 400)
    await admin.from('user_mfa').update({
      totp_confirmed: true, enabled: true, method: 'totp', updated_at: new Date().toISOString(),
    }).eq('user_id', user.id)
    return json({ ok: true })
  }

  if (action === 'disable') {
    await admin.from('user_mfa').update({ enabled: false, updated_at: new Date().toISOString() }).eq('user_id', user.id)
    return json({ ok: true })
  }

  return json({ error: 'unknown_action' }, 400)
})
