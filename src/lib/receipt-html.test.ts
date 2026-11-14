import { describe, expect, it } from 'vitest';
import { escapeHtml } from '../../supabase/functions/_shared/html.ts';

describe('receipt HTML escaping', () => {
  it('escapes markup and attribute delimiters from untrusted values', () => {
    expect(escapeHtml('<script>alert("x")</script> & \'receipt\''))
      .toBe('&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt; &amp; &#39;receipt&#39;');
  });

  it('handles nullish values and preserves ordinary text', () => {
    expect(escapeHtml(null)).toBe('');
    expect(escapeHtml(undefined)).toBe('');
    expect(escapeHtml('GHS 100.00')).toBe('GHS 100.00');
  });
});
