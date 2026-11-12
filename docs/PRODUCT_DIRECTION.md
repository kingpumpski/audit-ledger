# Product direction: simple business operations first

## Product promise

A business owner should be able to answer five questions without knowing accounting:

1. How much money came in today?
2. How much did I spend today?
3. Who still owes me money?
4. What stock do I have, and what is running low?
5. After the day's activity, how is my business doing?

The interface should guide the user to record the underlying activity correctly. The application can then produce more advanced accounting views for users who need them.

## First persona: market trader

Design for a person serving customers quickly, sometimes alone, often using an entry-level Android phone, with limited time for typing and potentially inconsistent connectivity.

### Must-have daily tasks
- One obvious action to record a sale, without forcing an invoice or signature for a walk-in cash sale.
- Optional product selection; allow a quick amount/description entry for unlisted goods.
- Quantity and unit support (piece, bottle, bag, crate, kilogram, bowl, etc.).
- Payment split across cash, mobile money and bank transfer where needed.
- Optional customer identity; a walk-in sale must not require creating a full customer profile.
- Credit sale with customer balance and later part-payment collection.
- Expense entry with a short category list and optional note/photo.
- Stock purchase/restock and stock reduction linked to recorded sales where stock tracking is enabled.
- A simple day summary and a way to correct mistakes with an audit trail.

### Interface requirements
- Phone-first, thumb-friendly controls and readable text.
- Short forms, numeric keypad for amounts/quantities, sensible defaults and minimal mandatory fields.
- Plain labels: “Money received”, “Money spent”, “Customers who owe you”, “Stock running low”.
- Confirmation before irreversible actions; never silently discard entered data.
- Friendly empty states and short contextual help, not accounting lectures.
- Make the next action obvious, but do not hide important totals or warnings.

## Other target groups

| Group | Primary workflows | Additional controls |
|---|---|---|
| Market traders / sole traders | Daily sales, expenses, stock, customer credit, payment collection | Simple PIN/session controls, clear daily summary |
| Grocery shops / retailers | Product catalogue, stock purchases, sales, returns, supplier balances | Stock movement history, low-stock alerts, margin visibility |
| SMEs | Sales, invoices, expenses, suppliers, cash flow and reports | Staff roles, approvals, exports and audit history |
| Corporate organisations | Multi-user finance operations, branches, departments and budgets | Segregation of duties, approvals, audit logs, consolidated reports |
| Financial institutions / finance partners | Traceable records, reconciliation and reporting | Least-privilege or read-only access, controlled exports |

## Non-negotiable financial rules

- A receipt is evidence of money received; it must not accidentally create a second payment when it is generated from an existing payment.
- A reversal must be atomic, authorised, traceable and applied exactly once.
- A sale, expense, stock movement and payment must have a clear relationship and source of truth.
- Do not delete completed financial history; use controlled reversals/voids with reasons and audit events.
- Every dashboard figure must state its period and meaning. Do not label invoice totals as cash received or revenue if the underlying calculation does not support that label.
- Separate business data by tenant/business at the database and storage-policy level; frontend filtering is not a security boundary.
- Use idempotency and concurrency controls for money and stock operations.

## Delivery sequence

### Foundation and discovery
Audit the current schema and RLS for business-level tenancy, identify the authoritative records for sales/payments/expenses/stock, and map all current workflows. Do not add another parallel financial ledger before identifying existing sources of truth.

### Market-trader MVP
Implement a guided business setup, quick sale, quick expense, simple credit/customer balance, stock purchase and day summary. The user must be able to start with minimal setup and add detail later.

### Retail and SME expansion
Add supplier records, purchase orders or purchase entry, returns, margin reporting, reminders and configurable workflows.

### Corporate / financial partner expansion
Add multi-branch tenancy, approval policies, audit exports, scoped external access and reconciliation tools only after the underlying transaction model is reliable.

## Acceptance tests for the market-trader experience

- A first-time user can configure a shop and record a first walk-in cash sale without creating a customer profile or issuing a signed invoice.
- A sale can be paid by cash, mobile money or bank transfer, including split tender.
- A credit sale creates a visible customer balance; a part-payment reduces it correctly.
- An expense changes the daily cash summary but does not get counted as a sale.
- Stock changes once per relevant sale/restock and cannot silently become negative.
- Repeated taps, network retries or simultaneous staff actions do not duplicate money or stock movements.
- A user can understand every dashboard total from its label and a short explanation.
- Voids and corrections preserve the original record and show who made the change and why.

## Scope discipline

The existing application already contains invoices, receipts, customers, products, inventory, accounting, reports and administration. The market-trader workflows above are not assumed to exist merely because related screens exist. Each one must be implemented end-to-end (UI, database constraints/RLS, atomic backend operation, audit history, tests and documentation) before being described as available.
