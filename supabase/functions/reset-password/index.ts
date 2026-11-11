import { createClient } from 'npm:@supabase/supabase-js@2'
import { corsHeaders } from 'npm:@supabase/supabase-js@2/cors'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

function json(b: unknown, s = 200) {
  return new Response(JSON.stringify(b), { status: s, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
}
async function sha256(t: string) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(t))
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('')
}

type PasswordPolicy = {
  min_length?: number | null;
  require_uppercase?: boolean | null;
  require_lowercase?: boolean | null;
  require_number?: boolean | null;
  require_special?: boolean | null;
  disallow_spaces?: boolean | null;
  require_mfa?: boolean | null;
  history_count?: number | null;
};

function validate(pw: string, policy: PasswordPolicy | null, email?: string) {
  const errs: string[] = []
  if (pw.length < (policy?.min_length ?? 12)) errs.push(`min_length_${policy?.min_length ?? 12}`)
  if (policy?.require_uppercase && !/[A-Z]/.test(pw)) errs.push('uppercase')
  if (policy?.require_lowercase && !/[a-z]/.test(pw)) errs.push('lowercase')
  if (policy?.require_number && !/\d/.test(pw)) errs.push('number')
  if (policy?.require_special && !/[^A-Za-z0-9]/.test(pw)) errs.push('special')
  if (policy?.disallow_spaces && /\s/.test(pw)) errs.push('spaces')
  if (email && pw.toLowerCase().includes(email.split('@')[0].toLowerCase())) errs.push('contains_email')
  return errs
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405)

  let token = '', password = ''
  try { const b = await req.json(); token = String(b?.token || ''); password = String(b?.password || '') }
  catch { return json({ error: 'invalid_body' }, 400) }

  if (!token || !password) return json({ error: 'missing_fields' }, 400)
  if (password.length > 200) return json({ error: 'password_too_long' }, 400)

  const admin = createClient(SUPABASE_URL, SERVICE_KEY)
  const tokenHash = await sha256(token)
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || null
  const ua = req.headers.get('user-agent') || null

  const { data: row } = await admin.from('password_reset_tokens')
    .select('id, user_id, expires_at, used_at, mfa_required, mfa_method, mfa_verified_at')
    .eq('token_hash', tokenHash).maybeSingle()
  if (!row) return json({ error: 'invalid_token' }, 400)
  if (row.used_at) return json({ error: 'token_used' }, 400)
  if (new Date(row.expires_at).getTime() < Date.now()) return json({ error: 'token_expired' }, 400)

  const { data: policy } = await admin.from('password_policy').select('*').eq('id', 1).single()

  const { data: userRes } = await admin.auth.admin.getUserById(row.user_id)
  const email = userRes?.user?.email

  const { data: lockedNow } = await admin.rpc('is_reset_locked', { _email: email ?? null, _ip: ip })
  if (lockedNow === true) return json({ error: 'locked_out' }, 429)

  const { data: mfaSettings } = await admin.from('user_mfa').select('enabled').eq('user_id', row.user_id).maybeSingle()
  const mfaRequired = Boolean(row.mfa_required) || Boolean(mfaSettings?.enabled) || Boolean(policy?.require_mfa)
  if (mfaRequired && !row.mfa_verified_at) {
    return json({ error: 'mfa_required', method: row.mfa_method || 'email' }, 403)
  }

  const errs = validate(password, policy, email)
  if (errs.length) return json({ error: 'policy_violation', reasons: errs }, 400)

  const historyCount = policy?.history_count ?? 10
  const pwHash = await sha256(password + ':' + row.user_id)
  const { data: history } = await admin.from('password_history')
    .select('password_hash').eq('user_id', row.user_id)
    .order('created_at', { ascending: false }).limit(historyCount)
  if (history?.some(h => h.password_hash === pwHash)) {
    return json({ error: 'password_reused' }, 400)
  }

  const { error: updErr } = await admin.auth.admin.updateUserById(row.user_id, { password })
  if (updErr) return json({ error: 'update_failed', detail: updErr.message }, 500)

  await admin.from('password_reset_tokens').update({ used_at: new Date().toISOString() }).eq('id', row.id)
  await admin.from('password_history').insert({ user_id: row.user_id, password_hash: pwHash })
  const { data: extra } = await admin.from('password_history')
    .select('id').eq('user_id', row.user_id)
    .order('created_at', { ascending: false }).range(historyCount, historyCount + 100)
  if (extra?.length) await admin.from('password_history').delete().in('id', extra.map(e => e.id))

  try {
    const { error } = await admin.auth.admin.signOut(row.user_id, 'global')
    if (error) console.error('Could not invalidate reset user sessions:', error.message)
  } catch (error) {
    console.error('Could not invalidate reset user sessions:', error)
  }

  try {
    const { error } = await admin.rpc('clear_reset_lockout', { _email: email ?? null, _ip: ip })
    if (error) console.error('Could not clear password reset lockout:', error.message)
  } catch (error) {
    console.error('Could not clear password reset lockout:', error)
  }

  try {
    const { error } = await admin.from('password_reset_tokens')
      .update({ used_at: new Date().toISOString() })
      .eq('user_id', row.user_id).is('used_at', null)
    if (error) console.error('Could not invalidate outstanding reset tokens:', error.message)
  } catch (error) {
    console.error('Could not invalidate outstanding reset tokens:', error)
  }

  const { error: attemptError } = await admin.from('password_reset_attempts').insert({
    email: email ?? null, ip_address: ip, user_agent: ua,
    result: 'completed', reason: mfaRequired ? `mfa_${row.mfa_method || 'email'}` : null,
  })
  if (attemptError) console.error('Could not record completed password reset:', attemptError.message)

  try {
    const { error } = await admin.from('audit_logs').insert({
      user_id: row.user_id, user_email: email, action: 'UPDATE',
      entity_type: 'auth.password', entity_id: row.user_id,
      new_data: { via: 'password-reset', ip, ua },
    })
    if (error) console.error('Could not audit password reset:', error.message)
  } catch (error) {
    console.error('Could not audit password reset:', error)
  }

  try {
    const { error } = await admin.from('notifications').insert({
      user_id: row.user_id, type: 'security',
      title: 'Password changed',
      message: `Your password was changed from ${ip || 'unknown IP'}. If this wasn't you, contact your administrator immediately.`,
    })
    if (error) console.error('Could not notify user about password reset:', error.message)
  } catch (error) {
    console.error('Could not notify user about password reset:', error)
  }

  return json({ ok: true })
})