# Store and Inventory Management Operating Model

Status: architecture baseline / implementation plan  
Scope: store operations, stock control, procurement, POS sales, accounting integration, and application routing

## 1. Purpose and design principles

Audit Ledger will treat store operations as a controlled, auditable inventory subledger connected to sales, purchasing, and the general ledger. The store must support both a small market trader and a business with multiple stores/warehouses without changing accounting rules between them.

Non-negotiable principles:

1. **One source of stock truth.** Posted stock movements form an append-only stock ledger. Product-level quantities are derived/cached balances, never an independently editable source of truth.
2. **Atomic business operations.** A sale, purchase receipt, transfer, return, or count adjustment either commits all its stock, document, cash, tax, and journal effects or commits none.
3. **Tenant and location isolation.** Every store, warehouse, document, stock balance, movement, and RPC is scoped to the active business. Location access is separately permissioned.
4. **Evidence before posting.** Posted transactions require dates, references, responsible users, and reasons where applicable. Corrections use reversals/credit notes, not destructive edits.
5. **Idempotency and concurrency safety.** Client retries cannot double-post. Stock availability is checked and reserved/locked in the database transaction, not trusted from the browser.
6. **Accounting integrity.** Journal entries balance; inventory valuation and COGS use immutable cost snapshots; taxes and payment tenders are recorded independently.
7. **Progressive complexity.** A single-location shop can operate with defaults. Multi-location, batch/expiry, replenishment optimization, and advanced fulfilment can be enabled as the business needs them.
8. **No unsafe production rollout.** Schema work is migration-tested and reviewed first. Production migrations and live data writes require explicit authorization.

## 2. Existing foundation and constraints

The current application already has:

- Products with SKU, service/product classification, current price, stock quantity, minimum stock level, and cost fields.
- Inventory transactions with purchase, sale, damage, and other movement evidence.
- Verified stock-purchase costing and weighted-average cost snapshots for invoice lines.
- Invoice issue hooks that check stock, decrement product stock, create inventory movements, and post COGS.
- Audited stock damage, count corrections, and purchase reversals.
- Tenant foundation and restrictive business-scoped RLS migrations in the repository.
- Existing customer balances and accounting journals.

The current inventory experience is not yet a full store-management system:

- Inventory is presented as a product-level stock list; there is no explicit store/warehouse/bin dimension.
- Product stock quantity is a single aggregate field, not a location balance.
- There is no dedicated purchase-order → goods-received-note → supplier-bill lifecycle.
- There is no separate POS sale model for a walk-in customer. Existing invoices, payments, and receipts require a customer; do not weaken those constraints or invent placeholder customers.
- There is no established reservation/commit model, inter-store transfer workflow, replenishment engine, lot/serial/expiry tracking, or pick/pack/dispatch workflow.
- Existing stock purchase RPCs and invoice triggers must be adapted carefully; do not introduce a second competing stock-decrement path.

These constraints require an additive, staged design rather than replacing existing tables in one migration.

## 3. Target application routing and module map

Use nested, feature-oriented routes under /store, with shared route guards and active-business context. Keep accounting, invoices, and customer routes backward-compatible.

| Route | Module | Primary workflows |
|---|---|---|
| /store | Store overview | Stock alerts, sales today, pending receipts, reorder queue |
| /store/pos | Point of sale | Scan/search items, cart, customer or walk-in, split tenders, receipt |
| /store/sales | Sales register | Search/filter sales, detail, return, void/reversal |
| /store/sales/:id | Sale detail | Lines, tenders, tax, fulfilment, audit trail |
| /store/products | Product catalogue | SKU/barcode, variants, units, price lists, reorder rules |
| /store/stock | Stock control | On-hand, available, reserved, on-order, movement ledger |
| /store/stock/counts | Stock counts | Blind count, cycle count, variance approval and posting |
| /store/stock/transfers | Transfers | Request, approve, dispatch, receive, discrepancy |
| /store/purchasing | Procurement | Requisitions, supplier quotes, purchase orders |
| /store/receiving | Goods receiving | Partial receipts, quality checks, supplier references |
| /store/suppliers | Supplier directory | Contacts, lead times, terms, supplier performance |
| /store/replenishment | Replenishment | Forecast, safety stock, reorder suggestions, approvals |
| /store/locations | Store locations | Warehouses, stores, zones, bins and permissions |
| /store/reports | Store reports | Valuation, ageing, movement, shrinkage, sell-through |

Routing requirements:

- Use lazy-loaded feature pages and a shared StoreLayout with store sub-navigation.
- Guard every route by effective active-business role and explicit permissions; hiding a menu item is not authorization.
- Enforce permissions again inside database RPCs/RLS. Suggested capabilities: store.read, store.catalog.manage, store.purchase.create, store.purchase.approve, store.receive, store.sale.create, store.sale.discount, store.return.approve, store.stock.count, store.stock.adjust, store.transfer.dispatch, store.transfer.receive, store.replenishment.approve, store.reports.value.
- Cashiers may sell and receive payments but cannot approve stock adjustments, supplier returns, or unrestricted discounts. Store managers approve operational exceptions. Accountants control valuation adjustments and financial reversals. Auditors are read-only.
- Route transitions must preserve active workspace boundaries; invalidate business-scoped query caches on workspace change and fail closed when active membership is ambiguous.
- Provide redirects or links from existing /inventory and /products pages during migration, rather than abruptly breaking bookmarks.

## 4. Domain model to implement additively

All new business-owned tables carry business_id NOT NULL, use tenant-consistent foreign keys, have RLS, and use business-scoped unique keys. Existing tables must be backfilled and constrained through reviewed migrations before any new store workflow is enabled.

### Store locations and catalogue

- store_locations: business, code, name, location type (store/warehouse/van/virtual), address, timezone, active state.
- store_bins: location, parent/bin code, zone, picking sequence, capacity and active state.
- product_barcodes: business, product, barcode, unit/pack conversion, primary flag; unique within business.
- Extend product metadata for brand, category hierarchy, base unit, purchase unit, sale unit, unit conversion, track-lot, track-serial, track-expiry, reorder policy, and active status.
- product_location_settings: per-location min/max, reorder point, safety stock, lead-time override, preferred supplier, and replenishment method.

### Stock ledger and balances

- Canonical movement ledger: first evaluate extending the existing append-only inventory_transactions table with location, source document, movement group, from/to location, lot/bin, signed quantity, approval, and reversal references. Do not create a second independent movement ledger. If a normalized movement header/lines model is required for transfers and multi-line documents, inventory_transactions must remain a compatibility view or be migrated with a reconciled, one-way source-of-truth cutover.
- stock_balances: transactionally maintained projection keyed by business + location + product + optional lot/bin. Include on-hand, reserved, and available quantities. Reconcile this projection against the existing product stock_quantity before switching reads or writes.
- stock_reservations: order/sale allocation, quantity, expiry, release/consume state.
- stock_lots and stock_serials: optional traceability records with supplier lot, manufacture/expiry dates, serial state, and recall status.
- stock_cost_layers or equivalent cost-history records: immutable receipts/cost layers to support weighted average initially and FIFO where explicitly enabled.
- Never let a client update stock balance or product stock directly. A narrowly scoped database transaction/RPC writes the ledger and updates projections together.

### Procurement and receiving

- suppliers, supplier_products, purchase_requisitions, purchase_orders, purchase_order_lines.
- goods_receipts and goods_receipt_lines: partial receipts, accepted/rejected quantities, lot/expiry details, landed-cost allocation, receiving location, and source PO.
- Supplier invoice/bill matching: compare ordered, received, and invoiced quantities/costs; support configurable tolerances and approval holds.
- Supplier returns and debit/credit notes must reverse the exact receipt quantities and valuation without rewriting later movements.

### Sales and POS

- store_sales and store_sale_lines are the POS transaction model; they support optional customer_id, nullable for walk-in sales, with captured walk-in/customer display details where required by receipt policy.
- store_sale_tenders: one or more payment methods per sale, with amount, reference, settlement state, and cash drawer/account mapping. Sum of successful tenders must equal amount received; outstanding credit requires a named customer and an approved credit workflow.
- Sale issue RPC atomically validates prices, discounts, tax snapshots, business/location, stock, and idempotency; consumes reservations or decrements availability; writes stock movements and COGS; posts revenue, tax liability, payment/clearing and inventory journals; creates receipt/number sequence; returns the committed sale.
- Refunds/returns use separate immutable records linked to original sale lines and tenders. Re-stock only after inspection and disposition (sellable, damaged, quarantine).
- Do not create a walk-in customer row. Do not route POS through the existing customer-required invoice/payment path unless a deliberate customer-account sale is selected.

### Transfers and counts

- Transfers progress through draft → approved → dispatched → received/partially received → closed. Dispatch removes available stock into in-transit; receipt adds actual accepted quantity at destination. Variances require reason and approval.
- Counts support scheduled cycle counts (ABC class, velocity, risk), blind counts, recount thresholds, variance approval, and immutable adjustment postings. A count snapshot captures expected quantity at count start; concurrent movements are accounted for rather than silently overwritten.
- All corrections are linked to source documents and use reversals/adjustments, not editing posted movement rows.

## 5. Inventory algorithms and operating controls

### Quantity states

For each product and location:

- On hand = physically posted quantity at the location.
- Reserved = quantity committed to open sales/orders/picks.
- Available = on hand − reserved − quarantined.
- On order = approved PO quantity not yet received.
- In transit = dispatched transfer quantity not yet received.

All new quantity calculations use fixed precision suitable for fractional units. The existing products.stock_quantity and inventory_transactions.quantity are integer-based in the current schema, and existing stock RPCs accept integer quantities; a deliberate compatibility migration and RPC/test update is required before fractional units can be enabled. Do not mix integer and decimal paths.

### Replenishment and reorder calculation

Initial transparent policy per product/location:

- Average daily demand (ADD) from a configurable historical window, excluding stockout days where practical.
- Lead-time demand = ADD × supplier lead time.
- Safety stock = service-level z-score × demand standard deviation × sqrt(lead time), with a simpler manual safety-stock override.
- Reorder point = lead-time demand + safety stock.
- Inventory position = available + on-order − backorders.
- Suggested order quantity = max(0, target stock − inventory position), rounded to supplier pack/MOQ.
- Target stock may use max-stock days of cover or economic order quantity (EOQ) only where demand and ordering/holding-cost inputs are reliable.
- Present inputs and reasons with every suggestion; never auto-submit a PO without approval.
- Cold-start fallback: manager-defined min/max and lead time. Forecasts must disclose low-confidence data.

### ABC / XYZ and cycle counting

- ABC by annual consumption value (quantity × cost); XYZ by demand variability (coefficient of variation).
- Count frequency increases for high-value/high-variability items and items with repeated discrepancies.
- Do not classify services as inventory; exclude inactive/deleted products.
- Count differences above configured value/percentage thresholds require independent recount and manager/accountant approval.

### Costing and valuation

- Preserve existing verified weighted-average cost behavior as the default compatibility mode.
- Capture landed costs (freight, duty, handling) and allocate by configured basis (quantity, value, weight, volume).
- Do not rewrite historical COGS when future purchase costs change.
- FIFO/lot-specific costing is a later controlled option requiring accounting policy choice, complete opening layers, and dedicated reconciliation tests.
- Negative stock is blocked by default. Any exceptional override requires a named permission, reason, and an auditable approval; do not allow it by client flag alone.

### Shrinkage, expiry, and recalls

- Track damage, theft, expiry, supplier discrepancy, and count variance as distinct reason codes.
- Expiry alerts use configurable windows and timezone-aware dates; expired/quarantined lots are unavailable to POS.
- Recall can identify affected lot/serials, locations, sales, and customers where traceability exists.
- Stock ageing and slow-moving reports use receipt/movement history, not a guessed creation date.

## 6. Accounting and tax integration

Every posted operation must produce a balanced, source-linked journal where financially relevant:

- Purchase receipt: Dr Inventory / Cr GRNI or Accounts Payable; payment settlement posts cash/bank separately.
- POS sale: Dr Cash/Bank/Clearing and/or Receivable; Cr Revenue and tax payable; Dr COGS / Cr Inventory.
- Supplier return: reverse payable/cash and inventory at the original cost basis, with evidence and duplicate-reversal protection.
- Customer return: reverse revenue/tax as applicable; return inventory only after inspection; reverse COGS using the original sale cost snapshot.
- Damage/expiry/shrinkage: Dr approved inventory loss/expense account / Cr Inventory.
- Transfer within one business: no P&L impact; move location quantity and track in-transit custody.
- Discounts and tax rates are snapshotted at sale time. Tax treatment is configurable by business and jurisdiction; do not hard-code a Ghana tax rate or currency into the engine.
- Daily close reconciles cash drawer opening float + cash tenders − refunds − paid-outs = expected closing cash; compare counted cash and record variance with approval.

## 7. Security, audit and reliability

- New tables use RLS with restrictive tenant policies and tenant-consistent composite foreign keys.
- Security-definer RPCs have empty/locked search paths, explicit execute grants, least-privilege owners, active-business membership checks, and role/permission checks inside the transaction.
- Unique idempotency keys are scoped to business and operation. Replays with identical payload return the original result; conflicting payload reuse is rejected.
- Use row-level locks or serializable-safe stock reservation patterns to prevent concurrent overselling.
- Posted documents, movement lines, cost snapshots, tenders, and journals are immutable; corrections are explicit reversal documents.
- Maintain an audit trail for create, approve, receive, dispatch, sell, refund, count, adjust, transfer, and close actions.
- Realtime and notifications are advisory only; authoritative state is always re-read from the database.
- Index high-volume lookups by business, location, product, effective date, source document, status, and idempotency key. Validate query plans before adding speculative indexes.

## 8. Delivery phases and acceptance gates

### Phase 0 — baseline and design (this document)
- Inventory existing tables, RPCs, triggers, UI routes, permissions, tests, and production migration status.
- Resolve dependencies with the workspace switcher and tenant/RPC ownership work.
- No production schema or data changes.

### Phase 1 — location-aware stock foundation
- Add locations, bins, product-location settings, extend or formally replace the existing inventory_transactions ledger, and add a balance projection. Backfill must start from an explicitly evidenced opening balance and reconcile all existing movement history; never replay historical stock changes into a second ledger without deduplication.
- Provide reconciliation report proving legacy product stock equals sum of new location balances before enabling the new source of truth.
- Add concurrency, tenant isolation, idempotency, fractional quantity, and migration replay tests.
- Keep one default location per existing business for compatibility.

### Phase 2 — procurement and goods receiving
- Suppliers, requisitions, POs, partial GRNs, landed costs, supplier bill matching, returns.
- Journal and stock valuation reconciliation tests.

### Phase 3 — POS and sales fulfilment
- Walk-in and named customer sales, barcode search, discounts, tax snapshots, split tender, cash drawer, receipts, returns/refunds.
- Atomic stock reservation/consumption and COGS/revenue/tax/payment journals.
- End-to-end concurrent checkout and retry tests.

### Phase 4 — store operations
- Transfers, cycle counts, expiry/lot/serial, quarantine, recall, pick/pack/dispatch.
- Permissioned approvals and audit evidence.

### Phase 5 — optimization and reporting
- Reorder suggestions, ABC/XYZ, demand forecasting, slow-moving/ageing/shrinkage, supplier performance, margin and stock-turn reports.
- Back-test forecasts and expose confidence/assumptions; never silently automate purchasing.

### Release acceptance
- Clean migration replay from an empty database and upgrade from the current schema.
- Full database integration suite including multi-tenant adversarial tests.
- Frontend lint, TypeScript, unit tests, production build, and Pages build.
- Browser tests for each role and multiple businesses/locations.
- Reconcile stock ledger to balances, inventory valuation to GL, POS tender totals to cash/clearing, and sales COGS to inventory depletion.
- Verify backups, migration rollback/forward recovery plan, and production approval before rollout.

## 9. Immediate implementation sequence

1. Finish/rebase and validate the workspace switcher; do not make store routes depend on unmerged client assumptions.
2. Audit all existing inventory RPCs/triggers and map each current stock mutation to the new movement ledger.
3. Confirm how legacy businesses are mapped to a default store location and how existing stock is reconciled; never infer opening stock cost where it is unverified.
4. Implement Phase 1 schema and database tests on an isolated branch/database, not production.
5. Implement the Store route shell and read-only location-aware stock views after the schema contract is stable.
6. Only then build procurement and POS on the same stock posting service.

## 10. Explicit non-goals for the first release

- No AI-driven autonomous purchasing or automatic supplier ordering.
- No silent negative stock.
- No direct client writes to stock balances.
- No forced FIFO migration of existing weighted-average inventory.
- No placeholder walk-in customer records.
- No production migrations, destructive backfills, or live transactions without explicit approval.
