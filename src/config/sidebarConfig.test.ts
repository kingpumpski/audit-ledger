import { describe, expect, it } from 'vitest';
import {
  expertSidebarItems,
  getSidebarItems,
  simplifiedSidebarItems,
} from './sidebarConfig';

describe('persona sidebar configuration', () => {
  it('provides the requested navigation labels in both modes', () => {
    expect(expertSidebarItems.map((item) => item.name)).toEqual([
      'Dashboard',
      'Invoices',
      'Receipts',
      'Customers',
      'Products',
      'Accounting',
      'Inventory',
      'Taxes',
      'Discounts',
      'Reports',
      'Audit Logs',
    ]);

    expect(simplifiedSidebarItems.map((item) => item.name)).toEqual([
      'Dashboard',
      'Sales & Invoices',
      'Money Received',
      'Customers',
      'Products & Services',
      'Accounting Tools',
      'Stock',
      'Taxes',
      'Discounts',
      'Business Reports',
      'Activity History',
    ]);
  });

  it('keeps route paths identical between personas', () => {
    expect(expertSidebarItems.map((item) => item.path)).toEqual(
      simplifiedSidebarItems.map((item) => item.path),
    );
  });

  it('uses the same icons for equivalent navigation items', () => {
    expertSidebarItems.forEach((expertItem, index) => {
      expect(simplifiedSidebarItems[index].icon).toBe(expertItem.icon);
    });
  });

  it('returns the correct configuration for the selected persona', () => {
    expect(getSidebarItems('expert')).toBe(expertSidebarItems);
    expect(getSidebarItems('simplified')).toBe(simplifiedSidebarItems);
  });
});
