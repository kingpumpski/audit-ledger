# Supplier directory acceptance checklist

This checklist covers the supplier master-data scope delivered by the supplier directory foundation and UI. It does not authorize production database changes.

## Automated validation

- [ ] Frontend lint, TypeScript, unit tests and production build pass.
- [ ] Clean isolated Supabase migration replay passes.
- [ ] Complete database integration suite passes, including supplier RLS, role permissions, uniqueness and cross-business foreign-key tests.
- [ ] GitHub Pages artifact build passes.

## Authenticated browser acceptance

Run against a disposable/test environment with at least two businesses and users assigned the listed roles.

### Business owner, admin and accountant

- [ ] Can view suppliers belonging to the active business only.
- [ ] Can create a supplier with optional code, contact details, payment terms and optional default currency.
- [ ] Required supplier name and invalid payment-term/currency inputs are rejected with a clear message.
- [ ] Can link a product belonging to the same business and record supplier SKU, optional unit cost/currency, MOQ, order multiple and lead time.
- [ ] Invalid MOQ, order multiple, lead time, unit cost or missing cost currency is rejected.
- [ ] Can deactivate/reactivate a supplier and deactivate a supplier-product link without deleting historical records.
- [ ] Refreshing the page shows persisted changes and does not duplicate records.

### Cashier, auditor and other read-only members

- [ ] Can view supplier and supplier-product information for their active business.
- [ ] Cannot see supplier records or product links from another business.
- [ ] Do not see supplier create, link, activate/deactivate controls.
- [ ] Direct API attempts to write are rejected by database RLS, not merely hidden by the UI.

### Workspace switching and isolation

- [ ] Switching businesses refreshes the active business claim before supplier data is queried.
- [ ] Supplier rows, linked products and cached results from the previous business are not shown after switching.
- [ ] A supplier-product link cannot reference a supplier or product from a different business.
- [ ] Deactivated records remain visible with inactive status and are not hard-deleted.

## Explicit scope exclusions

Purchase requisitions, purchase orders, approvals, goods receipts, inventory movements, supplier invoice matching, accounts payable, supplier payments and returns are separate future workflows. Do not treat this directory as a procurement or receiving workflow.
