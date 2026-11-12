# Architecture rules
- Invoice and receipt views share one document model and renderer; PDF exports use the same loaded records to avoid mismatched financial output.
- Password reset classifications and CSV escaping live in a tested helper shared by dashboard filtering and exports.- Document previews and PDF downloads are logged client-side via src/lib/document-audit.ts (view/export actions with document metadata); PDFs use a bundled TTF font so exports don't depend on remote assets.
