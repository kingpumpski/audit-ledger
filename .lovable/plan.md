This is a large, multi-part request. Below is the delivery plan. I'll ship it in phases so each is testable — please confirm the phasing (or tell me to build it all in one go).

## Scope

Two workstreams:
1. **Enterprise Password Reset Module** (Prompts 1–30)
2. **Debug instrumentation** for Taxes, Discounts, Audit Logs, Reports pages

---

## Part A — Compatibility Report (Prompt 1)

Current auth stack analysed:
- **Auth provider**: Lovable Cloud (Supabase Auth) — email/password, JWT sessions in `localStorage`, auto-refresh.
- **Users**: `auth.users` (managed) + `public.profiles` (id, email, full_name, phone, is_active, …).
- **Roles**: `public.user_roles` + `has_role` / `has_any_role` SECURITY DEFINER functions.
- **Session mgmt**: `AuthContext.tsx` with `onAuthStateChange` + `getSession`.
- **Email**: Resend (via `RESEND_API_KEY`) — existing edge functions.
- **SMS**: Twilio integration (existing).
- **Audit**: `audit_logs` table + `audit_trigger_func`.
- **Notifications**: `notifications` table + centralized edge fn.

**Integration approach (no breaking changes):**
- Use Supabase's built-in `resetPasswordForEmail` for the email link path (issues a recovery token bound to `auth.users`), plus a companion `password_reset_tokens` table for our own SMS OTP flow, rate-limits, IP/browser tracking, and admin dashboard.
- Password history stored in new `password_history` table (bcrypt hash of prior 10). Enforced in a Postgres RPC called from the reset edge function.
- All writes go through edge functions (`forgot-password`, `verify-reset-token`, `reset-password`, `resend-reset-link`, `verify-otp`, `password-policy`) using service role. RLS-safe; anon revoked on privileged funcs.
- Every action writes to `audit_logs` and `notifications`. Force sign-out via `supabase.auth.admin.signOut(userId, 'global')`.

---

## Part B — Phased Delivery

### Phase 1 — Foundation (this turn if you say "go phase 1")
- Migration: `password_reset_tokens`, `password_history`, `password_reset_attempts` (rate limit), `password_policy` (admin config) with RLS, GRANTs, audit triggers.
- Edge functions: `forgot-password`, `verify-reset-token`, `reset-password`, `verify-otp`, `resend-reset-link`, `password-policy`.
- Pages: `/forgot-password`, `/reset-password`, `/reset-success`, `/reset-expired`, `/reset-invalid` — fully wired, no dead links, ARIA/keyboard/dark-mode, strength meter, live validation checklist, show/hide password.
- Wire "Forgot password?" link on Login page.

### Phase 2 — SMS OTP + MFA
- Twilio OTP send/verify path, retry limits, rate limits per email/IP/hour (5/hr), CAPTCHA after 3 failures.
- Optional MFA gate (email OTP / SMS OTP / TOTP) before password commit.
- Security questions (admin-toggleable).

### Phase 3 — Admin Dashboard & Alerts
- `/admin/password-resets` — pending / completed / failed / expired / locked / suspicious, charts (recharts), filters, search, CSV export.
- Admin alert emails + in-app notifications for suspicious patterns.

### Phase 4 — Tests & Hardening
- Vitest unit tests + Deno edge-function tests covering all Prompt 29 cases.
- SQLi/XSS/CSRF/token-replay review, production readiness checklist (Prompt 30).

---

## Part C — Debug instrumentation (I'll do this in Phase 1 alongside foundation)

For `Taxes.tsx`, `Discounts.tsx`, `AuditLogs.tsx`, `Reports.tsx`:
- Add loading skeletons + explicit empty states.
- Add error boundary panel showing the Supabase error `code`, `message`, `details`, `hint`.
- `console.debug('[Taxes] fetch', { count, error })` on every query.
- Show a "Diagnostics" collapsible with the RLS-permission hint when a 401/403/PGRST error is caught, so we can pinpoint whether it's RLS, GRANT, or empty-table.

---

## Confirm

Reply with one of:
- **"go phase 1"** — I build Phase 1 + debug instrumentation now (largest single turn; ~1 migration, 6 edge functions, 5 pages, 4 page patches).
- **"build all"** — I ship Phases 1–4 sequentially across multiple turns without stopping for confirmation between phases.
- **Adjust** — tell me what to add/remove/reorder (e.g. skip SMS, skip MFA, skip admin dashboard).