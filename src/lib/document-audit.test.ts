import { describe, it, expect } from 'vitest';
import { documentAuditAction } from './document-audit';
describe('documentAuditAction', () => {
  it('logs previews as view', () => expect(documentAuditAction('preview')).toBe('view'));
  it('logs downloads as export', () => expect(documentAuditAction('download')).toBe('export'));
});
