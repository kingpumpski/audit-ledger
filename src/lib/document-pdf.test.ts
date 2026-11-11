import { afterEach, describe, expect, it, vi } from 'vitest';
import { createDocumentPdf } from './document-pdf';
import type { BusinessDocument } from './business-document';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('document PDF generation', () => {
  it('creates a multipage invoice when the remote font is unavailable', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('font asset unavailable')));

    const document = {
      kind: 'invoice',
      number: 'INV-TEST-001',
      date: '2026-11-10',
      status: 'issued',
      company: null,
      customer: null,
      items: Array.from({ length: 90 }, (_, index) => ({
        description: `Test line item ${index + 1} with a description long enough to exercise table wrapping`,
        quantity: 1,
        unit_price: 12.5,
        line_total: 12.5,
      })),
      subtotal: 1125,
      discount: 0,
      tax: 0,
      total: 1125,
      paid: 0,
      balance: 1125,
    } as BusinessDocument;

    const pdf = await createDocumentPdf(document);

    expect(pdf.getNumberOfPages()).toBeGreaterThan(1);
    expect(pdf.output('arraybuffer').byteLength).toBeGreaterThan(1000);
  });
});
