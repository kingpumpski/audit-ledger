import { useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';

export function useReceiptPrint() {
  const [isPrinting, setIsPrinting] = useState(false);
  const { toast } = useToast();

  const printReceipt = async (receiptId: string) => {
    // Open the window synchronously during the click so popup blockers do not
    // prevent the print document from opening after the network request.
    const printWindow = window.open('', '_blank');
    if (!printWindow) {
      toast({
        title: 'Pop-up blocked',
        description: 'Allow pop-ups for this site, then try printing the receipt again.',
        variant: 'destructive',
      });
      return;
    }

    setIsPrinting(true);
    printWindow.document.write('<!doctype html><title>Preparing receipt…</title><p style="font:16px sans-serif;padding:24px">Preparing receipt for printing…</p>');
    printWindow.document.close();

    try {
      const { data, error } = await supabase.functions.invoke('generate-receipt-pdf', {
        body: { receiptId },
      });

      if (error) throw error;

      const html = typeof data === 'string'
        ? data
        : data && typeof data.html === 'string'
          ? data.html
          : null;

      if (!html || !html.toLowerCase().includes('<html')) {
        throw new Error('The receipt PDF service returned an invalid document.');
      }

      printWindow.document.open();
      printWindow.document.write(html);
      printWindow.document.close();

      // Wait for the document, web fonts and embedded images before opening
      // the print dialog; otherwise the first print can omit the logo or styles.
      if (printWindow.document.readyState !== 'complete') {
        await new Promise<void>((resolve) => {
          printWindow.addEventListener('load', () => resolve(), { once: true });
        });
      }
      if (printWindow.document.fonts?.ready) {
        await printWindow.document.fonts.ready;
      }
      await Promise.all(
        Array.from(printWindow.document.images).map((image) =>
          typeof image.decode === 'function' ? image.decode().catch(() => undefined) : Promise.resolve()
        )
      );
      await new Promise<void>((resolve) => {
        printWindow.requestAnimationFrame(() => resolve());
      });

      if (printWindow.closed) {
        throw new Error('The print window was closed before the receipt was ready.');
      }
      printWindow.focus();
      printWindow.print();
    } catch (error) {
      printWindow.close();
      const message = error instanceof Error ? error.message : 'An unexpected error occurred.';
      console.error('Failed to generate receipt for printing:', error);
      toast({
        title: 'Receipt could not be printed',
        description: message.includes('Failed to fetch') || message.toLowerCase().includes('cors')
          ? 'The receipt service is not reachable. Its Supabase Edge Function CORS configuration must be deployed before printing can work.'
          : message,
        variant: 'destructive',
      });
    } finally {
      setIsPrinting(false);
    }
  };

  return { printReceipt, isPrinting };
}
