import { describe, expect, it } from 'vitest';
import { getSupabaseConfig } from './config';

describe('getSupabaseConfig', () => {
  it('returns a trimmed project URL and publishable key', () => {
    expect(getSupabaseConfig({
      url: ' https://example.supabase.co/ ',
      publishableKey: ' sb_publishable_example ',
    })).toEqual({
      url: 'https://example.supabase.co',
      publishableKey: 'sb_publishable_example',
    });
  });

  it('supports a local Supabase URL for development', () => {
    expect(getSupabaseConfig({
      url: 'http://127.0.0.1:54321',
      publishableKey: 'local-anon-key',
    }).url).toBe('http://127.0.0.1:54321');
  });

  it('explains how to configure missing local environment values', () => {
    expect(() => getSupabaseConfig({ url: '', publishableKey: '' })).toThrow(
      /GitHub Actions Variables are not automatically available to a local Vite dev server/
    );
  });

  it('rejects malformed and unsupported URLs', () => {
    expect(() => getSupabaseConfig({
      url: 'not-a-url',
      publishableKey: 'public-key',
    })).toThrow(/invalid VITE_SUPABASE_URL/);
    expect(() => getSupabaseConfig({
      url: 'ftp://example.supabase.co',
      publishableKey: 'public-key',
    })).toThrow(/must use HTTPS/);
  });

  it('rejects Supabase secret keys in the browser client', () => {
    expect(() => getSupabaseConfig({
      url: 'https://example.supabase.co',
      publishableKey: 'sb_secret_do_not_use_in_browser',
    })).toThrow(/never expose secret or service-role credentials/);
  });
});
