// Alias: just calls forgot-password logic. Kept separate for API clarity.
import { createClient } from 'npm:@supabase/supabase-js@2'
import { corsHeaders } from 'npm:@supabase/supabase-js@2/cors'

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return new Response('method_not_allowed', { status: 405, headers: corsHeaders })
  const body = await req.text()
  const url = `${Deno.env.get('SUPABASE_URL')}/functions/v1/forgot-password`
  const r = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-forwarded-for': req.headers.get('x-forwarded-for') || '',
      'user-agent': req.headers.get('user-agent') || '',
      origin: req.headers.get('origin') || '',
    },
    body,
  })
  const text = await r.text()
  return new Response(text, { status: r.status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
})