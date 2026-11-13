import {
  BookOpen,
  Calculator,
  ClipboardList,
  FileText,
  LayoutDashboard,
  Package,
  Percent,
  Receipt,
  Shield,
  Users,
  type LucideIcon,
} from 'lucide-react';

export type UserPersona = 'expert' | 'simplified';

export interface SidebarItem {
  name: string;
  icon: LucideIcon;
  path: string;
  roles?: string[];
}

const sharedAccess = {
  accounting: ['admin', 'accountant', 'auditor'],
  inventory: ['admin', 'accountant', 'cashier'],
  finance: ['admin', 'accountant'],
  reports: ['admin', 'accountant', 'auditor'],
  audit: ['admin', 'auditor'],
};

export const expertSidebarItems: SidebarItem[] = [
  { name: 'Dashboard', icon: LayoutDashboard, path: '/dashboard' },
  { name: 'Invoices', icon: FileText, path: '/invoices' },
  { name: 'Receipts', icon: Receipt, path: '/receipts' },
  { name: 'Customers', icon: Users, path: '/customers' },
  { name: 'Products', icon: Package, path: '/products' },
  { name: 'Accounting', icon: BookOpen, path: '/accounting', roles: sharedAccess.accounting },
  { name: 'Inventory', icon: Package, path: '/inventory', roles: sharedAccess.inventory },
  { name: 'Taxes', icon: Calculator, path: '/taxes', roles: sharedAccess.finance },
  { name: 'Discounts', icon: Percent, path: '/discounts', roles: sharedAccess.finance },
  { name: 'Reports', icon: ClipboardList, path: '/reports', roles: sharedAccess.reports },
  { name: 'Audit Logs', icon: Shield, path: '/audit-logs', roles: sharedAccess.audit },
];

export const simplifiedSidebarItems: SidebarItem[] = [
  { name: 'Dashboard', icon: LayoutDashboard, path: '/dashboard' },
  { name: 'Sales & Invoices', icon: FileText, path: '/invoices' },
  { name: 'Money Received', icon: Receipt, path: '/receipts' },
  { name: 'Customers', icon: Users, path: '/customers' },
  { name: 'Products & Services', icon: Package, path: '/products' },
  { name: 'Accounting Tools', icon: BookOpen, path: '/accounting', roles: sharedAccess.accounting },
  { name: 'Stock', icon: Package, path: '/inventory', roles: sharedAccess.inventory },
  { name: 'Taxes', icon: Calculator, path: '/taxes', roles: sharedAccess.finance },
  { name: 'Discounts', icon: Percent, path: '/discounts', roles: sharedAccess.finance },
  { name: 'Business Reports', icon: ClipboardList, path: '/reports', roles: sharedAccess.reports },
  { name: 'Activity History', icon: Shield, path: '/audit-logs', roles: sharedAccess.audit },
];

export function getSidebarItems(persona: UserPersona): SidebarItem[] {
  return persona === 'expert' ? expertSidebarItems : simplifiedSidebarItems;
}
