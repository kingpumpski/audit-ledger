import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useReceiptPrint } from './useReceiptPrint';
import { supabase } from '@/integrations/supabase/client';

const toast = vi.fn();

vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    functions: {
      invoke: vi.fn(),
    },
  },
}));

vi.mock('@/hooks/use-toast', () => ({
  useToast: () => ({ toast }),
}));

const invoke = vi.mocked(supabase.functions.invoke);

function createPrintWindow() {
  const childDocument = {
    readyState: 'complete',
    fonts: { ready: Promise.resolve() },
    images: [],
    write: vi.fn(),
    open: vi.fn(),
    close: vi.fn(),
  };
  const childWindow = {
    document: childDocument,
    closed: false,
    focus: vi.fn(),
    print: vi.fn(),
    close: vi.fn(),
    requestAnimationFrame: (callback: FrameRequestCallback) => callback(0),
    addEventListener: vi.fn(),
  };

  return { childWindow, childDocument };
}

describe('useReceiptPrint', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('reports a blocked popup without calling the receipt service', async () => {
    vi.spyOn(window, 'open').mockReturnValue(null);
    const { result } = renderHook(() => useReceiptPrint());

    await act(async () => {
      await result.current.printReceipt('receipt-1');
    });

    expect(invoke).not.toHaveBeenCalled();
    expect(toast).toHaveBeenCalledWith(expect.objectContaining({
      title: 'Pop-up blocked',
      variant: 'destructive',
    }));
    expect(result.current.isPrinting).toBe(false);
  });

  it('prints only after a valid receipt document has loaded', async () => {
    const { childWindow, childDocument } = createPrintWindow();
    vi.spyOn(window, 'open').mockReturnValue(childWindow as unknown as Window);
    invoke.mockResolvedValue({
      data: { html: '<html><body>Receipt</body></html>' },
      error: null,
    } as never);
    const { result } = renderHook(() => useReceiptPrint());

    await act(async () => {
      await result.current.printReceipt('receipt-1');
    });

    expect(invoke).toHaveBeenCalledWith('generate-receipt-pdf', {
      body: { receiptId: 'receipt-1' },
    });
    expect(childDocument.open).toHaveBeenCalledOnce();
    expect(childDocument.write).toHaveBeenCalledWith('<html><body>Receipt</body></html>');
    expect(childWindow.focus).toHaveBeenCalledOnce();
    expect(childWindow.print).toHaveBeenCalledOnce();
    expect(toast).not.toHaveBeenCalled();
    expect(result.current.isPrinting).toBe(false);
  });

  it('closes the print window and reports service errors', async () => {
    const { childWindow } = createPrintWindow();
    vi.spyOn(window, 'open').mockReturnValue(childWindow as unknown as Window);
    invoke.mockResolvedValue({
      data: null,
      error: new Error('Receipt service unavailable'),
    } as never);
    const { result } = renderHook(() => useReceiptPrint());

    await act(async () => {
      await result.current.printReceipt('receipt-1');
    });

    expect(childWindow.close).toHaveBeenCalledOnce();
    expect(childWindow.print).not.toHaveBeenCalled();
    expect(toast).toHaveBeenCalledWith(expect.objectContaining({
      title: 'Receipt could not be printed',
      description: 'Receipt service unavailable',
      variant: 'destructive',
    }));
    expect(result.current.isPrinting).toBe(false);
  });

  it('rejects an invalid document instead of printing it', async () => {
    const { childWindow } = createPrintWindow();
    vi.spyOn(window, 'open').mockReturnValue(childWindow as unknown as Window);
    invoke.mockResolvedValue({ data: { html: 'not html' }, error: null } as never);
    const { result } = renderHook(() => useReceiptPrint());

    await act(async () => {
      await result.current.printReceipt('receipt-1');
    });

    expect(childWindow.close).toHaveBeenCalledOnce();
    expect(childWindow.print).not.toHaveBeenCalled();
    expect(toast).toHaveBeenCalledWith(expect.objectContaining({
      title: 'Receipt could not be printed',
      description: 'The receipt PDF service returned an invalid document.',
    }));
    expect(result.current.isPrinting).toBe(false);
  });
});
