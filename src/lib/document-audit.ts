import { supabase } from '@/integrations/supabase/client';

export type DocumentAuditEvent = 'preview' | 'download';

/** Map a document event to the stored audit action. */
export function documentAuditAction(event: DocumentAuditEvent) {
  return event === 'preview' ? 'view' as const : 'export' as const;
}

/** Record an invoice/receipt preview or PDF download in the audit trail. Never throws. */
export async function logDocumentEvent(kind: 'invoice' | 'receipt', id: string, number: string, event: DocumentAuditEvent) {
  try {
    const { data } = await supabase.auth.getUser();
    const user = data.user;
    if (!user) return;
    const { error } = await supabase.from('audit_logs').insert({
      user_id: user.id,
      user_email: user.email ?? null,
      action: documentAuditAction(event),
      entity_type: kind === 'invoice' ? 'invoices' : 'receipts',
      entity_id: id,
      metadata: { event, document_number: number, format: event === 'download' ? 'pdf' : 'screen' },
      user_agent: navigator.userAgent,
    });
    if (error) console.error('[document-audit] failed to log', event, error);
  } catch (e) {
    console.error('[document-audit] failed to log', event, e);
  }
}
