import { useState } from 'react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { AlertCircle, ChevronDown, ChevronRight } from 'lucide-react';

export type QueryError = {
  message?: string;
  code?: string;
  details?: string;
  hint?: string;
} | null | undefined;

export function QueryDiagnostics({ label, error, count }: { label: string; error: QueryError; count: number | null }) {
  const [open, setOpen] = useState(false);
  if (!error) return null;
  const hint =
    error.code === '42501' || error.code === 'PGRST301' || error.message?.toLowerCase().includes('permission')
      ? 'This looks like a Row Level Security / GRANT issue. Verify RLS policies allow the current role, and that the table has GRANT SELECT to authenticated.'
      : error.code === 'PGRST116'
      ? 'The query returned no rows where one was required.'
      : 'Check the Supabase error details below.';
  return (
    <Alert variant="destructive" className="mb-4">
      <AlertCircle className="h-4 w-4" />
      <AlertTitle>Failed to load {label}</AlertTitle>
      <AlertDescription>
        <div className="text-sm">{error.message || 'Unknown error'} {count !== null && <span className="opacity-70">(count: {count})</span>}</div>
        <Button variant="ghost" size="sm" className="mt-2 h-7 px-2" onClick={() => setOpen(o => !o)}>
          {open ? <ChevronDown className="h-3 w-3 mr-1" /> : <ChevronRight className="h-3 w-3 mr-1" />}
          Diagnostics
        </Button>
        {open && (
          <pre className="mt-2 text-xs bg-muted/40 p-2 rounded overflow-auto max-h-48">
{JSON.stringify({ code: error.code, message: error.message, details: error.details, hint: error.hint, guidance: hint }, null, 2)}
          </pre>
        )}
      </AlertDescription>
    </Alert>
  );
}