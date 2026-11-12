export interface SupabasePublicConfig {
  url?: string | null;
  publishableKey?: string | null;
}

export interface ValidatedSupabaseConfig {
  url: string;
  publishableKey: string;
}

/**
 * Validate browser-safe Supabase configuration before constructing the client.
 * GitHub Actions repository variables are available to CI workflows, not to a
 * developer's local Vite process unless they are copied into .env.local.
 */
export function getSupabaseConfig(config: SupabasePublicConfig): ValidatedSupabaseConfig {
  const url = config.url?.trim();
  const publishableKey = config.publishableKey?.trim();

  if (!url || !publishableKey) {
    throw new Error(
      [
        'Audit Ledger cannot connect to Supabase because local environment configuration is missing.',
        'Required values: VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY.',
        'For local development, copy .env.example to .env.local and add a dedicated development project.',
        'Alternatively, configure DEV_VITE_SUPABASE_PROJECT_ID, DEV_VITE_SUPABASE_URL and DEV_VITE_SUPABASE_PUBLISHABLE_KEY in GitHub Actions Variables, run "gh auth login" and then "npm run env:pull".',
        'GitHub Actions Variables are not automatically available to a local Vite dev server. Restart Vite after changing .env.local.',
      ].join(' ')
    );
  }

  let parsedUrl: URL;
  try {
    parsedUrl = new URL(url);
  } catch {
    throw new Error('Audit Ledger has an invalid VITE_SUPABASE_URL. Use the Supabase project URL, for example https://your-project-ref.supabase.co.');
  }

  if (!['https:', 'http:'].includes(parsedUrl.protocol) || !parsedUrl.hostname) {
    throw new Error('Audit Ledger has an invalid VITE_SUPABASE_URL. The URL must use HTTPS (or HTTP for a local Supabase instance).');
  }

  if (publishableKey.startsWith('sb_secret_')) {
    throw new Error('A Supabase secret key was supplied to the browser client. Use the project's publishable key; never expose secret or service-role credentials in VITE_* variables.');
  }

  return { url: parsedUrl.toString().replace(/\/$/, ''), publishableKey };
}
