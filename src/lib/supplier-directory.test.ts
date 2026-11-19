import { describe, expect, it } from 'vitest';
import {
  canManageSupplierDirectory,
  normalizeSupplierMaster,
  normalizeSupplierProduct,
} from './supplier-directory';

const supplier = {
  supplier_code: '  SUP-01 ',
  name: '  Acme Supplies  ',
  legal_name: '',
  contact_name: ' Jane Doe ',
  email: 'jane@example.com',
  phone: '',
  tax_identifier: '',
  payment_terms_days: '30',
  currency: ' ghs ',
  address: '',
};

const supplierProduct = {
  supplier_id: 'supplier-1',
  product_id: 'product-1',
  supplier_sku: ' AC-100 ',
  unit_cost: '12.5',
  currency: 'ghs',
  minimum_order_quantity: '5',
  order_multiple: '2',
  lead_time_days: '7',
};

describe('supplier directory input normalization', () => {
  it('normalizes supplier text, currency and payment terms', () => {
    expect(normalizeSupplierMaster(supplier)).toEqual({
      supplier_code: 'SUP-01',
      name: 'Acme Supplies',
      legal_name: null,
      contact_name: 'Jane Doe',
      email: 'jane@example.com',
      phone: null,
      tax_identifier: null,
      payment_terms_days: 30,
      currency: 'GHS',
      address: null,
    });
  });

  it('accepts optional currency when no supplier default is recorded', () => {
    expect(normalizeSupplierMaster({ ...supplier, currency: '' }).currency).toBeNull();
  });

  it('rejects blank supplier names, invalid terms and malformed currencies', () => {
    expect(() => normalizeSupplierMaster({ ...supplier, name: '  ' })).toThrow('name is required');
    expect(() => normalizeSupplierMaster({ ...supplier, payment_terms_days: '1.5' })).toThrow('whole number');
    expect(() => normalizeSupplierMaster({ ...supplier, currency: 'GH' })).toThrow('three-letter');
  });

  it('normalizes supplier product terms and permits missing cost without currency', () => {
    expect(normalizeSupplierProduct(supplierProduct)).toEqual({
      supplier_id: 'supplier-1',
      product_id: 'product-1',
      supplier_sku: 'AC-100',
      unit_cost: 12.5,
      currency: 'GHS',
      minimum_order_quantity: 5,
      order_multiple: 2,
      lead_time_days: 7,
    });
    expect(normalizeSupplierProduct({ ...supplierProduct, unit_cost: '', currency: '' })).toMatchObject({
      unit_cost: null,
      currency: null,
    });
  });

  it('rejects invalid MOQ, order multiples, lead times, costs and missing cost currency', () => {
    expect(() => normalizeSupplierProduct({ ...supplierProduct, minimum_order_quantity: '0' })).toThrow('Minimum order quantity');
    expect(() => normalizeSupplierProduct({ ...supplierProduct, order_multiple: '-2' })).toThrow('Order multiple');
    expect(() => normalizeSupplierProduct({ ...supplierProduct, lead_time_days: '2.5' })).toThrow('whole number');
    expect(() => normalizeSupplierProduct({ ...supplierProduct, unit_cost: '-1' })).toThrow('non-negative');
    expect(() => normalizeSupplierProduct({ ...supplierProduct, currency: '' })).toThrow('Enter the currency');
  });

  it('allows directory writes only for owner, admin and accountant roles', () => {
    expect(canManageSupplierDirectory('owner')).toBe(true);
    expect(canManageSupplierDirectory('admin')).toBe(true);
    expect(canManageSupplierDirectory('accountant')).toBe(true);
    expect(canManageSupplierDirectory('cashier')).toBe(false);
    expect(canManageSupplierDirectory('auditor')).toBe(false);
    expect(canManageSupplierDirectory(null)).toBe(false);
  });
});
