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
    .select('id, user_id, expires_at, used_at')
    .eq('token_hash', tokenHash).maybeSingle()
  if (!row) return json({ status: 'invalid' })
  if (row.used_at) return json({ status: 'used' })
  if (new Date(row.expires_at).getTime() < Date.now()) return json({ status: 'expired' })
  return json({ status: 'valid' })
})