# Procurement and goods-receiving implementation contract

## Status and scope

This document defines the next procurement implementation boundary for Audit Ledger. It is deliberately a design/acceptance contract, not a migration. It does not create tables, change application behavior, or authorize production changes.

The supplier master foundation is being introduced by PR #89 (supplier records and supplier/product terms). Location stock balances and transfer workflows are separate foundations. Procurement must connect these systems without bypassing their tenant, inventory, accounting or audit controls.

## Existing constraints that procurement must preserve

- Every operational row must be scoped to one `business_id`; references between a purchase document, supplier, product, location and receipt must be tenant-consistent using composite foreign keys where possible.
- Use the active business claim and current membership role. Do not use a legacy global role as the only authorization check.
- Owner/admin/accountant may maintain supplier and financial purchasing records. Store/purchasing operators may receive only the operational permissions explicitly granted to their business role. Approval must be separate from preparation where the approval policy requires separation of duties.
- Supplier and supplier-product records are deactivated, not hard-deleted, so purchasing history remains intact.
- Inventory quantities are location-based. Do not silently post receipts to the default location if a receiving location was not selected.
- Inventory valuation must use a verified actual unit cost and the business currency. Do not silently treat an unknown cost as zero.
- Journal entries are immutable after posting. Corrections use reversal/adjustment records, not edits to posted ledger lines.
- Every state-changing RPC must be tenant-checked, authenticated, role-checked, idempotent and auditable. Client table writes must not bypass transition guards.
- Legacy `record_stock_purchase` is a global-role/default-location legacy path. It must not be reused for location-aware PO receiving without a reviewed tenant-safe refactor.

## Proposed document model

### Purchase requisition

Purpose: capture an internal request before supplier commitment.

Header fields:
- `id`, `business_id`, human-readable reference, requesting location, requester, requested date, required-by date, justification, status, and timestamps.
- Status lifecycle: `draft -> submitted -> approved | rejected -> converted | canceled`.
- A rejected or canceled requisition remains available for audit; do not delete it.

Line fields:
- `business_id`, requisition ID, product ID, requested quantity, optional preferred supplier-product reference, need-by date, notes.
- Quantity must be positive; product and optional supplier terms must belong to the same business.
- Requisition quantities are not stock reservations and do not change inventory.

### Purchase order

Purpose: authorized supplier commitment.

Header fields:
- `id`, `business_id`, supplier ID, supplier currency, supplier reference, internal PO number, destination location, order date, expected delivery date, payment terms snapshot, status, totals snapshot, requester/creator, approver, and timestamps.
- Status lifecycle: `draft -> submitted -> approved -> sent -> partially_received -> received`; terminal alternatives include `rejected`, `canceled`, and `closed_short`.
- Only an approved PO may be sent or received. A sent PO may be partially received more than once. Over-receipt is blocked unless a separately authorized tolerance policy is explicitly configured.
- Approval must capture approver identity/time and reject self-approval when policy requires a different person.
- Supplier name, supplier code, supplier SKU, payment terms, currency and unit price are immutable document snapshots. Later supplier-directory edits must not rewrite historical POs.

Line fields:
- `business_id`, PO ID, product ID, supplier-product ID (optional but if present tenant-consistent), product description/SKU snapshot, supplier SKU snapshot, ordered quantity, received quantity (derived from immutable receipt lines or maintained only by guarded RPC), unit cost, currency, discount/tax snapshots, expected date, and notes.
- Enforce positive ordered quantity, non-negative unit cost, valid currency and consistent line/header currency unless a documented FX conversion model is added.
- Snapshot supplier MOQ, order multiple and lead time when the PO is created. Replenishment suggestions must satisfy MOQ and pack multiple before an order is submitted.

### Goods receipt (GRN)

Purpose: record physical arrival and increase stock exactly once.

Header fields:
- `id`, `business_id`, PO ID, receiving location, GRN reference, received timestamp, receiver identity, delivery note/reference, status, idempotency key and request fingerprint.
- Status lifecycle: `draft -> submitted -> posted`, with `canceled` allowed only before posting.
- A posted GRN is immutable. Corrections require a separate supplier return or inventory adjustment, never editing the original receipt.

Line fields:
- PO line ID, product ID, accepted quantity, rejected/damaged/quarantined quantity, unit-cost snapshot, lot/batch/expiry attributes when product tracking is enabled, notes and discrepancy reason.
- Received quantity must be positive; accepted + rejected must not exceed the remaining receivable quantity. A receipt must identify a location and cannot move products across businesses.
- Quarantined/damaged goods must not increase available quantity. Preserve separate on-hand and quarantined quantities; only an authorized inspection/release workflow may move quarantined stock to available.

## Atomic posting contract

Posting one GRN must be a single database transaction. Either all effects commit, or none do:

1. Lock the PO header and affected PO lines in deterministic order.
2. Verify active business, receiver permission, PO status, destination location, currency and all product/supplier/line references.
3. Verify idempotency key and request fingerprint. Replaying the exact request returns the original GRN result; reusing a key with different details fails.
4. Recompute remaining quantities from posted receipt lines under lock. Reject over-receipt and duplicate line submission.
5. Insert immutable inventory movement rows at the selected receiving location. Update the location stock balance through one guarded database path; never update both the legacy aggregate and location projection independently without a defined reconciliation rule.
6. Value accepted stock using the verified PO cost snapshot. If landed costs are introduced, allocate them deterministically and retain the original cost plus allocation basis.
7. Debit the correct business-scoped inventory account and credit the correct accounts-payable / goods-received-not-invoiced clearing account according to the approved accounting policy. Tax must be snapshotted and posted to a configured liability/input-tax account only where applicable.
8. Create balanced immutable journal entry and lines with source links to the GRN and inventory movements.
9. Update PO line remaining quantities and header status through guarded transitions.
10. Write audit activity with actor, business, document references and before/after state.
11. Return a stable GRN and journal reference.

No external payment or supplier balance should be posted merely because goods were received. Receipt liability and supplier invoice recognition/payment are distinct accounting events.

## Supplier invoice matching and accounts payable

- Supplier invoice is a separate document linked to supplier and optionally one or more PO/GRN records.
- Match supplier, currency, supplier invoice number, quantities, unit costs, discounts and tax against approved PO and posted GRN lines.
- Enforce duplicate invoice detection per business + supplier + normalized invoice reference.
- Differences beyond configured tolerances require explicit review/approval; never silently overwrite PO cost or GRN cost.
- AP recognition should debit GRNI/clearing and tax accounts as appropriate and credit supplier payable. Payment settlement is a separate idempotent transaction and must reconcile to the business cash/bank account.
- Supplier balances are derived from posted AP invoices, debit notes, credit notes, payments and allocations; do not maintain a second manually editable balance.
- Supplier returns reference original GRN/PO lines, record quantities and reason, decrement stock only for goods physically returned, and post the appropriate inventory/AP or supplier-credit journal. A return must not rewrite the original GRN.

## Replenishment integration

- Inventory position per product/location = on-hand - reserved - quarantined + dispatched inbound transfer quantities + outstanding approved/sent supplier PO quantities - backorders, with each component sourced from its authoritative ledger.
- Do not count draft/unapproved POs, canceled POs, un-dispatched transfers or already received quantities as inbound.
- Use supplier-product lead time, MOQ and order multiple snapshots. Round the minimum compliant order quantity up to a valid pack multiple.
- Demand-based reorder point = lead-time demand + safety stock. Safety stock uses a configured service-level factor and demand variability only when sufficient trustworthy observations exist.
- Exclude stockout-censored days from naive zero-demand averages; disclose excluded days and confidence. Do not infer zero demand from unavailable stock.
- Suggestions are advisory. Creating a PO is a separate user action and requires the same approval controls as a manually prepared PO.

## Required database security and concurrency

- Enable RLS on all new tables. Members may read only within their active business membership; writes require explicit business roles.
- Use composite tenant foreign keys for business-scoped relationships.
- Revoke direct client writes to posted document/ledger tables. Expose narrowly scoped RPCs for transitions.
- Any SECURITY DEFINER function must use a restricted owner, fixed empty search_path, fully qualified object names, narrow EXECUTE grants and explicit auth/business/role validation. Do not make the function owner bypass RLS.
- Lock PO lines and balance rows consistently to prevent two concurrent GRNs from receiving the same remaining quantity.
- Enforce uniqueness for business-scoped references, idempotency keys, source-to-journal postings and supplier invoice references.
- Do not let an application retry create a second stock movement, GRN, journal entry or supplier payable.

## Implementation sequence

1. Review/merge supplier directory foundation only after authenticated role and tenant acceptance.
2. Add PO/requisition schema and guarded transitions, with isolated DB tests.
3. Add approval queue and PO UI; verify separation of duties.
4. Add GRN schema and atomic posting RPC, including concurrent and replay tests.
5. Add location balance, valuation and balanced journal integration.
6. Add supplier invoice matching, AP subledger and settlement.
7. Add supplier returns and credit notes.
8. Connect outstanding PO quantities and supplier pack rules to replenishment.
9. Add lot/batch/expiry tracking and quarantine/release if enabled for a product.
10. Run role-based browser acceptance and staging reconciliation before production approval.

## Acceptance test matrix

| Scenario | Expected result |
|---|---|
| User from business A references supplier/product/location from business B | Rejected by tenant FK/RLS/RPC |
| Cashier attempts supplier or PO approval action without permission | Denied |
| Requester tries to self-approve where separation applies | Denied and audited |
| Draft or rejected PO receives goods | Denied |
| PO line receives more than remaining quantity | Denied under concurrent transaction lock |
| Two concurrent GRNs attempt to receive same remaining quantity | At most the valid remaining quantity posts |
| Exact GRN request retried with same idempotency key | Original result returned, no duplicate stock/journal |
| Same idempotency key reused with changed quantity | Rejected |
| Unknown/unverified inventory cost | Posting blocked pending valuation resolution |
| Receipt includes damaged/quarantined units | Those units are excluded from available stock |
| Posted GRN is edited/deleted | Denied; correction uses return/reversal |
| Journal debit/credit mismatch | Entire posting rolls back |
| Supplier directory details change after PO approval | Historical PO snapshots remain unchanged |
| Draft/canceled PO exists | Not counted as inbound replenishment |
| Partial receipt posted | Only remaining outstanding PO quantity counts as inbound |
| Supplier invoice duplicates existing reference | Rejected within same business/supplier |
| Production database migration history differs from repo | Rollout pauses for explicit reconciliation |

## Explicit non-goals

- Do not use generic suppliers or customers to bypass required relationships.
- Do not relax `invoices.customer_id NOT NULL`.
- Do not route purchasing through the legacy default-location `record_stock_purchase` RPC without a reviewed tenant-safe refactor.
- Do not update stock balances from the browser.
- Do not treat a purchase order as proof that stock has arrived.
- Do not treat a goods receipt as proof that an invoice was paid.
- Do not apply production migrations as part of this design document.
