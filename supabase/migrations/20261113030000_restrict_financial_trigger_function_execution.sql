-- Restrict financial trigger helpers to internal database execution.
-- Their SECURITY DEFINER privileges are needed by triggers, not by direct API callers.
REVOKE ALL ON FUNCTION public.apply_invoice_payment_and_post_journal() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.post_invoice_journal_after_issue() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.validate_invoice_payment_insert() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.set_default_tax_liability_account() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.snapshot_invoice_tax_liability_account() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.post_receipt_journal_by_id(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.post_unapplied_receipt_journal() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.reverse_unapplied_receipt_journal() FROM PUBLIC, anon, authenticated;

-- Cover the new foreign keys used by ledger joins and account filtering.
CREATE INDEX IF NOT EXISTS idx_invoice_taxes_liability_account_id
  ON public.invoice_taxes(liability_account_id);
CREATE INDEX IF NOT EXISTS idx_journal_entries_created_by
  ON public.journal_entries(created_by);
CREATE INDEX IF NOT EXISTS idx_taxes_liability_account_id
  ON public.taxes(liability_account_id);

NOTIFY pgrst, 'reload schema';