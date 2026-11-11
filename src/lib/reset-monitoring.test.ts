import { describe, it, expect } from 'vitest';
import { tokenStatus, suspiciousAttempts, csvCell, type ResetAttempt } from './reset-monitoring';
describe('reset monitoring', () => {
  it('classifies pending tokens separately from completed and expired', () => {
    const now = Date.parse('2026-11-10T10:00:00Z');
    expect(tokenStatus({ used_at: null, expires_at: '2026-11-10T10:30:00Z' }, now)).toBe('pending');
    expect(tokenStatus({ used_at: '2026-11-10T09:59:00Z', expires_at: '2026-11-10T10:30:00Z' }, now)).toBe('completed');
    expect(tokenStatus({ used_at: null, expires_at: '2026-11-10T10:00:00Z' }, now)).toBe('expired');
  });
  it('flags five requests in an hour but not requests spread across days', () => {
    const rows: ResetAttempt[] = Array.from({ length: 5 }, (_, i) => ({ id: String(i), email: null, ip_address: '192.0.2.1', user_agent: null, result: 'requested', reason: null, created_at: new Date(Date.parse('2026-11-10T10:00:00Z') + i * 60_000).toISOString() }));
    expect(suspiciousAttempts(rows).size).toBe(5);
    expect(suspiciousAttempts(rows.slice(0, 4)).size).toBe(0);
    expect(suspiciousAttempts(rows.map((a, i) => ({ ...a, created_at: new Date(Date.parse(a.created_at) + i * 86_400_000).toISOString() }))).size).toBe(0);
  });
  it('escapes spreadsheet formulas and quoted fields', () => {
    expect(csvCell('=1+1')).toBe('"\'=1+1"');
    expect(csvCell('a"b')).toBe('"a""b"');
  });
});