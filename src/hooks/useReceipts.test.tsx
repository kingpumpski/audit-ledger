import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useReceipts } from './useReceipts';
import { supabase } from '@/integrations/supabase/client';

const { toast } = vi.hoisted(() => ({ toast: vi.fn() }));

vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    from: vi.fn(),
    auth: { getUser: vi.fn() },
    rpc: vi.fn(),
  },
}));

vi.mock('@/hooks/use-toast', () => ({
  useToast: () => ({ toast }),
}));

const from = vi.mocked(supabase.from);

function makeBuilder(result: { data: unknown; error: unknown }) {
  const builder: {
    select: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
    eq: ReturnType<typeof vi.fn>;
    is: ReturnType<typeof vi.fn>;
    or: ReturnType<typeof vi.fn>;
    order: ReturnType<typeof vi.fn>;
    maybeSingle: ReturnType<typeof vi.fn>;
    then: (resolve: (value: typeof result) => unknown) => Promise<unknown>;
  } = {
    select: vi.fn(),
    update: vi.fn(),
    eq: vi.fn(),
    is: vi.fn(),
    or: vi.fn(),
    order: vi.fn(),
    maybeSingle: vi.fn(),
    then: (resolve) => Promise.resolve(result).then(resolve),
  };

  for (const method of ['select', 'update', 'eq', 'is', 'or', 'order']) {
    builder[method].mockReturnValue(builder);
  }
  builder.maybeSingle.mockResolvedValue(result);
  return builder;
}

function renderReceiptsHook() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  return renderHook(() => useReceipts(), { wrapper });
}

describe('useReceipts updateReceipt', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('updates notes only on an issued, non-deleted receipt and invalidates receipt queries', async () => {
    const builder = makeBuilder({ data: { id: 'receipt-1' }, error: null });
    from.mockReturnValue(builder as never);
    const { result } = renderReceiptsHook();

    await act(async () => {
      await result.current.updateReceipt({ id: 'receipt-1', data: { notes: 'Corrected note' } });
    });

    expect(builder.update).toHaveBeenCalledWith({ notes: 'Corrected note' });
    expect(builder.eq).toHaveBeenCalledWith('id', 'receipt-1');
    expect(builder.eq).toHaveBeenCalledWith('status', 'issued');
    expect(builder.is).toHaveBeenCalledWith('deleted_at', null);
    expect(builder.select).toHaveBeenCalledWith('id');
    expect(builder.maybeSingle).toHaveBeenCalledOnce();
    await waitFor(() => expect(toast).toHaveBeenCalledWith({
      title: 'Receipt updated successfully',
    }));
  });

  it('rejects a receipt update when no eligible issued row was changed', async () => {
    const builder = makeBuilder({ data: null, error: null });
    from.mockReturnValue(builder as never);
    const { result } = renderReceiptsHook();

    await expect(
      act(async () => {
        await result.current.updateReceipt({ id: 'receipt-voided', data: { notes: 'Should not save' } });
      }),
    ).rejects.toThrow('This receipt could not be updated. It may have been voided, deleted or is no longer available for editing.');

    expect(toast).toHaveBeenCalledWith(expect.objectContaining({
      title: 'Failed to update receipt',
      variant: 'destructive',
    }));
    expect(toast).not.toHaveBeenCalledWith(expect.objectContaining({
      title: 'Receipt updated successfully',
    }));
  });

  it('surfaces database errors instead of reporting a successful edit', async () => {
    const builder = makeBuilder({ data: null, error: new Error('Permission denied') });
    from.mockReturnValue(builder as never);
    const { result } = renderReceiptsHook();

    await expect(
      act(async () => {
        await result.current.updateReceipt({ id: 'receipt-1', data: { notes: 'Attempt' } });
      }),
    ).rejects.toThrow('Permission denied');

    expect(toast).toHaveBeenCalledWith(expect.objectContaining({
      title: 'Failed to update receipt',
      description: 'Permission denied',
      variant: 'destructive',
    }));
  });
});
