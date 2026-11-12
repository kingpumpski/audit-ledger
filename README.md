# Audit Ledger

**Simple, trustworthy business record-keeping for small businesses, growing companies and finance teams.**

Audit Ledger is intended to help people run and understand their business finances in everyday language. It should be useful to a market trader or small grocery shop owner who has never studied accounting, while providing the controls and reporting needed by larger organisations.

The product is being developed with small-business usability as the first priority. It is not intended to force every user to learn accounting terminology before they can record a sale, track spending, follow up money owed or understand how the business is doing.

## Who we are building for

- **Market women, market traders and sole traders:** fast daily sales, cash and mobile-money records, stock, customer credit and a clear end-of-day picture.
- **Grocery shops and retailers:** product pricing, purchases, stock movement, low-stock reminders, sales and customer balances.
- **Small and medium-sized businesses:** invoices, receipts, expenses, supplier/customer records, cash flow, reports and staff access.
- **Corporate organisations:** multiple users, stronger permissions, approvals, audit history, structured reporting and (as the product evolves) branches or departments.
- **Financial institutions and finance professionals:** reliable records, traceable transactions, reconciliation support and controlled read-only access where appropriate.

The needs of each group are not identical. Advanced finance and administration tools should not overwhelm people who only need to record daily business activity.

## Product principles

1. **Everyday language first.** Say “Money customers owe” before “Accounts receivable”, and explain unfamiliar terms where they cannot be avoided.
2. **Fast daily tasks.** Common activities should take as few steps as possible and work well on phones and small screens.
3. **No accounting knowledge required.** The application should guide users through recording activity; accounting reports can be generated from properly recorded transactions.
4. **Financial accuracy before convenience.** Prevent duplicate payments, negative stock, accidental deletion and silent changes to historical transactions.
5. **Visible explanations.** Show how totals were calculated, what period they cover and what a user should do next.
6. **Local business realities.** Support configurable currencies, cash, bank and mobile-money payment methods, flexible product units and local date/number formats.
7. **Secure by default.** Separate each business's data, apply least-privilege roles, keep an audit trail and never expose privileged credentials in the browser.
8. **Progressive complexity.** Simple daily workflows for small operators; advanced accounting, approvals and audit tools for qualified staff.
9. **Accessible and resilient.** Clear labels, large touch targets, readable contrast, helpful empty states and graceful handling of slow or interrupted connections.

## Priority user journeys

### 1. Market trader / small shop owner — highest usability priority

A user should be able to:
- Set up a shop with a name, currency and a few products (or start without a product catalogue).
- Record a cash, bank or mobile-money sale quickly.
- Record a business expense or stock purchase.
- See today's money received, money spent and estimated difference.
- Track stock quantities and know what needs restocking.
- Record sales made on credit and see who owes money.
- Record part-payments and see the remaining balance.
- Close the day with a simple summary and a printable/shareable record.

The experience must not require the user to create a formal invoice or sign a receipt for every ordinary counter sale.

### 2. Grocery shop / retailer

- Maintain products, units, selling prices and purchase costs.
- Record stock coming in, sales, returns, damage and adjustments.
- Warn before stock runs out.
- Show sales, gross margin estimates and stock value with clear explanations.
- Track suppliers, customer balances and payment methods.

### 3. Growing SME

- Create and send invoices, issue receipts and manage customer/supplier accounts.
- Record income and expenses with categories.
- Review cash flow, unpaid invoices, spending and business performance.
- Manage staff permissions and retain a traceable transaction history.

### 4. Corporate and institutional users

- Multiple users with role-based permissions and approval steps.
- Branch, department and cost-centre reporting.
- Reconciliation, exports and audit-ready transaction history.
- Controlled access for external auditors or financial partners.

These are product goals, not claims that every workflow is already implemented.

## Development priorities

1. **Reliable foundation:** tenant/business data isolation, financial transaction integrity, authentication, backups, audit trail and production configuration.
2. **Simple daily records:** fast sale, expense, stock purchase, customer credit and payment workflows; walk-in customers; cash/mobile money/bank methods.
3. **Market-friendly interface:** mobile-first layout, plain-language dashboard, guided first-time setup, large controls, fewer mandatory fields and useful defaults.
4. **Useful daily visibility:** today's sales, expenses, cash received, balances owed, low stock and end-of-day summary.
5. **SME operations:** inventory, suppliers, invoices, receipts, recurring expenses, reports and exports.
6. **Organisational controls:** multi-user access, approvals, branches, audit tools and institution-oriented reporting.
7. **Resilience and localisation:** low-bandwidth behaviour, safe retry/idempotency, local currencies, units, date formats and appropriate language support.

## Current application capabilities

The application currently includes a dashboard, invoices, receipts, customers, products/services, inventory, accounting tools, taxes, discounts, reports, user administration, settings and audit history. Availability is role-controlled in several areas.

Some workflows still reflect formal invoicing and accounting processes. The product roadmap above identifies the work required to make everyday record-keeping substantially simpler, especially for market traders and small retailers.

## Technology

- React, TypeScript and Vite
- Supabase for authentication, PostgreSQL data and backend functions
- TanStack Query for client data fetching and caching
- GitHub Actions and GitHub Pages for the current deployment workflow

## Local development

Requirements: Node.js 22 (recommended) and npm.

```powershell
npm ci
Copy-Item .env.example .env.local
# Edit .env.local with a dedicated DEVELOPMENT Supabase project URL and publishable key.
npm run dev
```

For the GitHub CLI-assisted development environment bootstrap:

```powershell
gh auth login
npm run env:pull
npm run dev
```

The helper uses development-scoped GitHub Actions variables when available and refuses to use the configured production project for local development.

**Important:** GitHub Actions Variables are only injected into GitHub-hosted workflows; they are not automatically available to a local Vite process. If you run `npm run dev` locally, you must first create `.env.local` with a separate development project's URL and publishable key. If you want to pull them from GitHub, add all three `DEV_VITE_SUPABASE_PROJECT_ID`, `DEV_VITE_SUPABASE_URL` and `DEV_VITE_SUPABASE_PUBLISHABLE_KEY` variables, authenticate with `gh auth login`, and run `npm run env:pull`. The standard `VITE_SUPABASE_*` repository variables are reserved for the production Pages build and are intentionally rejected by the local bootstrap helper when they point to production.

## Environment and credential safety

- Commit only the placeholder template `.env.example`.
- Keep `.env.local` and all real `.env.*` files out of Git.
- Use GitHub Actions **Variables** for the public production project ID, URL and publishable key.
- Use GitHub Actions **Secrets** or Supabase Edge Function Secrets for privileged backend credentials when a workflow/function genuinely needs them.
- Never put a Supabase secret or service-role key in a `VITE_*` variable or browser bundle.
- Use separate development and production Supabase projects. Do not test destructive changes against production.

## Quality and release policy

Changes should be made on a feature or repair branch and opened as a pull request. Before merging, run lint, TypeScript, automated tests, production build, lockfile verification and clean Supabase migration replay where applicable. Review security-sensitive database changes and verify live deployment separately from CI success.

Financial changes must be tested for partial payments, duplicate submissions, reversals, rounding, concurrent updates and audit history. Never perform destructive production migrations or silently rewrite historical financial records.
