export interface SupplierMasterInput {
  supplier_code: string;
  name: string;
  legal_name: string;
  contact_name: string;
  email: string;
  phone: string;
  tax_identifier: string;
  payment_terms_days: string;
  currency: string;
  address: string;
}

export interface SupplierProductInput {
  supplier_id: string;
  product_id: string;
  supplier_sku: string;
  unit_cost: string;
  currency: string;
  minimum_order_quantity: string;
  order_multiple: string;
  lead_time_days: string;
}

export interface NormalizedSupplierMaster {
  supplier_code: string | null;
  name: string;
  legal_name: string | null;
  contact_name: string | null;
  email: string | null;
  phone: string | null;
  tax_identifier: string | null;
  payment_terms_days: number;
  currency: string | null;
  address: string | null;
}

export interface NormalizedSupplierProduct {
  supplier_id: string;
  product_id: string;
  supplier_sku: string | null;
  unit_cost: number | null;
  currency: string | null;
  minimum_order_quantity: number;
  order_multiple: number;
  lead_time_days: number;
}

const optionalText = (value: string) => value.trim() || null;

function currencyCode(value: string, required: boolean): string | null {
  const normalized = value.trim().toUpperCase();
  if (!normalized) {
    if (required) throw new Error('Enter the currency when recording a unit cost.');
    return null;
  }
  if (!/^[A-Z]{3}$/.test(normalized)) {
    throw new Error('Currency must be a three-letter code, such as GHS.');
  }
  return normalized;
}

function positiveQuantity(value: string, label: string): number {
  const parsed = Number(value);
  if (!value.trim() || !Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`${label} must be a finite number greater than zero.`);
  }
  return parsed;
}

export function normalizeSupplierMaster(input: SupplierMasterInput): NormalizedSupplierMaster {
  const name = input.name.trim();
  if (!name) throw new Error('Supplier name is required.');
  const paymentTerms = Number(input.payment_terms_days);
  if (!Number.isInteger(paymentTerms) || paymentTerms < 0) {
    throw new Error('Payment terms must be a whole number of days (zero or more).');
  }
  return {
    supplier_code: optionalText(input.supplier_code),
    name,
    legal_name: optionalText(input.legal_name),
    contact_name: optionalText(input.contact_name),
    email: optionalText(input.email),
    phone: optionalText(input.phone),
    tax_identifier: optionalText(input.tax_identifier),
    payment_terms_days: paymentTerms,
    currency: currencyCode(input.currency, false),
    address: optionalText(input.address),
  };
}

export function normalizeSupplierProduct(input: SupplierProductInput): NormalizedSupplierProduct {
  if (!input.supplier_id || !input.product_id) {
    throw new Error('Select both a supplier and a product.');
  }
  const minimum = positiveQuantity(input.minimum_order_quantity, 'Minimum order quantity');
  const multiple = positiveQuantity(input.order_multiple, 'Order multiple');
  const leadTime = Number(input.lead_time_days);
  if (!Number.isInteger(leadTime) || leadTime < 0) {
    throw new Error('Lead time must be a whole number of days.');
  }
  const unitCost = input.unit_cost.trim() ? Number(input.unit_cost) : null;
  if (unitCost !== null && (!Number.isFinite(unitCost) || unitCost < 0)) {
    throw new Error('Unit cost must be a finite, non-negative number.');
  }
  const currency = currencyCode(input.currency, unitCost !== null);
  return {
    supplier_id: input.supplier_id,
    product_id: input.product_id,
    supplier_sku: optionalText(input.supplier_sku),
    unit_cost: unitCost,
    currency: unitCost === null ? null : currency,
    minimum_order_quantity: minimum,
    order_multiple: multiple,
    lead_time_days: leadTime,
  };
}

export function canManageSupplierDirectory(role: string | null | undefined): boolean {
  return role === 'owner' || role === 'admin' || role === 'accountant';
}
