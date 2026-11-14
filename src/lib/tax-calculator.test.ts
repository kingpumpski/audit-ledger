import { describe, expect, it } from 'vitest';
import { calculateLineAmounts, isTaxEffectiveOnDate, validateSelectedTaxRules, validateTaxCategoryApplicability, type TaxRule } from './tax-calculator';

const vat: TaxRule = { id: 'vat', name: 'VAT', code: 'VAT', rate: 10, is_compound: false };
const levy: TaxRule = { id: 'levy', name: 'Levy', code: 'LEVY', rate: 2, is_compound: false };
const compound: TaxRule = { id: 'compound', name: 'Compound levy', code: 'Z-COMP', rate: 5, is_compound: true };

describe('calculateLineAmounts', () => {
  it('calculates multiple non-compound and compound taxes on an exclusive price', () => {
    const result = calculateLineAmounts({
      quantity: 2, unit_price: 100, taxes: [compound, vat, levy], pricesIncludeTax: false,
    });
    expect(result.subtotal).toBe(200);
    expect(result.discount_amount).toBe(0);
    expect(result.tax_amount).toBe(35.2);
    expect(result.line_total).toBe(235.2);
    expect(result.taxes.map(t => t.code)).toEqual(['LEVY', 'VAT', 'Z-COMP']);
  });

  it('extracts the configured tax components from an inclusive price', () => {
    const result = calculateLineAmounts({
      quantity: 1, unit_price: 117.6, taxes: [vat, levy, compound], pricesIncludeTax: true,
    });
    expect(result.line_total).toBe(117.6);
    expect(result.tax_amount).toBeCloseTo(17.6, 2);
    expect(result.taxable_base).toBeCloseTo(100, 2);
  });

  it('applies discounts before calculating tax and caps fixed discounts', () => {
    const result = calculateLineAmounts({
      quantity: 1, unit_price: 100, discount_type: 'percentage', discount_value: 10,
      taxes: [vat], pricesIncludeTax: false,
    });
    expect(result.discount_amount).toBe(10);
    expect(result.tax_amount).toBe(9);
    expect(result.line_total).toBe(99);
  });

  it('returns a no-tax total without changing the price', () => {
    const result = calculateLineAmounts({
      quantity: 3, unit_price: 12.5, taxes: [], pricesIncludeTax: false,
    });
    expect(result.line_total).toBe(37.5);
    expect(result.tax_amount).toBe(0);
  });
});

describe('validateSelectedTaxRules', () => {
  it('rejects selected taxes that are no longer active or available', () => {
    expect(() => validateSelectedTaxRules(['vat', 'inactive'], [vat], '2026-11-14'))
      .toThrow('no longer active or available');
  });

  it('rejects selected taxes outside their effective date', () => {
    const expired: TaxRule = { ...vat, effective_to: '2026-10-31', liability_account_id: 'liability-1' };
    expect(() => validateSelectedTaxRules(['vat'], [expired], '2026-11-14'))
      .toThrow('not effective on the invoice date');
  });

  it('rejects selected taxes without a liability account', () => {
    expect(() => validateSelectedTaxRules(['vat'], [vat], '2026-11-14'))
      .toThrow('has no liability account configured');
  });

  it('accepts all selected taxes when active, effective and mapped', () => {
    const configured: TaxRule = { ...vat, liability_account_id: 'liability-1' };
    expect(() => validateSelectedTaxRules(['vat'], [configured], '2026-11-14')).not.toThrow();
  });
});


describe('validateTaxCategoryApplicability', () => {
  it('preserves general taxes and category-matching taxes', () => {
    const categoryTax: TaxRule = { ...vat, applies_to_category: 'Medical' };
    expect(validateTaxCategoryApplicability([vat, categoryTax], 'medical', 'Consultation'))
      .toEqual([vat, categoryTax]);
  });

  it('rejects a selected tax that does not apply to the item category', () => {
    const categoryTax: TaxRule = { ...vat, applies_to_category: 'Medical' };
    expect(() => validateTaxCategoryApplicability([categoryTax], 'Retail', 'Office chair'))
      .toThrow('does not apply to the category');
  });

  it('rejects category-specific taxes on unclassified manual items', () => {
    const categoryTax: TaxRule = { ...vat, applies_to_category: 'Medical' };
    expect(() => validateTaxCategoryApplicability([categoryTax], null, 'Manual service'))
      .toThrow('does not apply to the category');
  });
});

describe('isTaxEffectiveOnDate', () => {
  it('honours effective start and end dates', () => {
    const dated: TaxRule = { ...vat, effective_from: '2026-10-01', effective_to: '2026-12-31' };
    expect(isTaxEffectiveOnDate(dated, '2026-10-01')).toBe(true);
    expect(isTaxEffectiveOnDate(dated, '2026-09-30')).toBe(false);
    expect(isTaxEffectiveOnDate(dated, '2027-01-01')).toBe(false);
  });
});
