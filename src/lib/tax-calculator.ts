export interface TaxRule {
  id: string;
  name: string;
  code: string;
  rate: number;
  is_compound: boolean | null;
  applies_to_category?: string | null;
  effective_from?: string | null;
  effective_to?: string | null;
  liability_account_id?: string | null;
}

export interface LineTaxBreakdown {
  tax_id: string;
  name: string;
  code: string;
  rate: number;
  taxable_amount: number;
  tax_amount: number;
  is_compound: boolean;
  tax_order: number;
}

export interface LineCalculation {
  subtotal: number;
  discount_amount: number;
  taxable_base: number;
  tax_amount: number;
  line_total: number;
  nominal_tax_rate: number;
  taxes: LineTaxBreakdown[];
}

const roundMoney = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100;

export function calculateLineAmounts(input: {
  quantity: number;
  unit_price: number;
  discount_type?: 'fixed' | 'percentage';
  discount_value?: number;
  taxes: TaxRule[];
  pricesIncludeTax: boolean;
}): LineCalculation {
  const quantity = Math.max(0, Number(input.quantity) || 0);
  const unitPrice = Math.max(0, Number(input.unit_price) || 0);
  const subtotal = roundMoney(quantity * unitPrice);
  const requestedDiscount = Math.max(0, Number(input.discount_value) || 0);
  const discount = input.discount_type === 'percentage'
    ? subtotal * Math.min(requestedDiscount, 100) / 100
    : Math.min(requestedDiscount, subtotal);
  const discountAmount = roundMoney(discount);
  const amountAfterDiscount = Math.max(0, subtotal - discountAmount);

  const orderedTaxes = [...input.taxes]
    .filter(tax => Number.isFinite(Number(tax.rate)) && Number(tax.rate) > 0)
    .sort((a, b) => Number(Boolean(a.is_compound)) - Number(Boolean(b.is_compound)) || a.code.localeCompare(b.code));

  // Non-compound taxes use the base amount. Compound taxes are calculated
  // after the non-compound taxes and earlier compound taxes have been added.
  let accumulatedTaxFactor = 0;
  const taxFactors = orderedTaxes.map(tax => {
    const taxableFactor = tax.is_compound ? 1 + accumulatedTaxFactor : 1;
    const taxFactor = taxableFactor * Number(tax.rate) / 100;
    accumulatedTaxFactor += taxFactor;
    return { tax, taxableFactor, taxFactor };
  });
  const totalTaxFactor = taxFactors.reduce((sum, item) => sum + item.taxFactor, 0);
  const taxableBase = input.pricesIncludeTax
    ? (totalTaxFactor > 0 ? amountAfterDiscount / (1 + totalTaxFactor) : amountAfterDiscount)
    : amountAfterDiscount;

  const taxes = taxFactors.map(({ tax, taxableFactor, taxFactor }, taxOrder) => ({
    tax_id: tax.id,
    name: tax.name,
    code: tax.code,
    rate: Number(tax.rate),
    taxable_amount: roundMoney(taxableBase * taxableFactor),
    tax_amount: roundMoney(taxableBase * taxFactor),
    is_compound: Boolean(tax.is_compound),
    tax_order: taxOrder,
  }));
  const taxAmount = roundMoney(taxes.reduce((sum, tax) => sum + tax.tax_amount, 0));
  const lineTotal = input.pricesIncludeTax
    ? amountAfterDiscount
    : roundMoney(amountAfterDiscount + taxAmount);

  return {
    subtotal,
    discount_amount: discountAmount,
    taxable_base: roundMoney(taxableBase),
    tax_amount: taxAmount,
    line_total: roundMoney(lineTotal),
    nominal_tax_rate: roundMoney(orderedTaxes.reduce((sum, tax) => sum + Number(tax.rate), 0)),
    taxes,
  };
}

export function isTaxEffectiveOnDate(tax: TaxRule, date: string): boolean {
  if (tax.effective_from && tax.effective_from > date) return false;
  if (tax.effective_to && tax.effective_to < date) return false;
  return true;
}

/**
 * Fail closed when a tax explicitly selected on an invoice is no longer
 * available, effective for the invoice date, or mapped to a liability account.
 * Silently dropping a selected tax would create a misleading invoice total.
 */
export function validateSelectedTaxRules(selectedTaxIds: string[], taxRules: TaxRule[], date: string): void {
  const availableTaxIds = new Set(taxRules.map(tax => tax.id));
  if (selectedTaxIds.some(id => !availableTaxIds.has(id))) {
    throw new Error('One or more selected taxes are no longer active or available. Refresh the tax list and review this invoice before saving.');
  }

  const ineffectiveTax = taxRules.find(tax => !isTaxEffectiveOnDate(tax, date));
  if (ineffectiveTax) {
    throw new Error(`Tax ${ineffectiveTax.code} is not effective on the invoice date. Remove it or choose a valid invoice date.`);
  }

  const unconfiguredTax = taxRules.find(tax => !tax.liability_account_id);
  if (unconfiguredTax) {
    throw new Error(`Tax ${unconfiguredTax.code} has no liability account configured.`);
  }
}

/** Validate selected category-specific taxes instead of silently dropping them. */
export function validateTaxCategoryApplicability(
  selectedTaxes: TaxRule[],
  category: string | null | undefined,
  itemDescription: string,
): TaxRule[] {
  const mismatch = selectedTaxes.find(tax =>
    tax.applies_to_category &&
    tax.applies_to_category.toLowerCase() !== (category || '').toLowerCase()
  );
  if (mismatch) {
    throw new Error(`Tax ${mismatch.code} does not apply to the category of invoice item "${itemDescription}". Review the selected taxes.`);
  }
  return selectedTaxes;
}
