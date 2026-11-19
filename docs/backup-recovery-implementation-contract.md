# Backup & Recovery — implementation contract

## Purpose

Provide a project-owner-only Backup & Recovery area for the complete Audit Ledger Supabase project. It must create independently stored, encrypted, downloadable recovery packages and support rehearsed recovery without exposing privileged credentials to the browser.

This contract is not evidence that a backup service is deployed. Until the worker, storage, credential set, restore rehearsal and production verification are configured, the UI must say that backups are not configured and must not display synthetic backup records or allow migration release.

## Scope: project-level recovery

A full recovery point covers the whole Supabase project, not only the currently selected business workspace:

- PostgreSQL application schemas, data, sequences, indexes, constraints, functions, triggers, policies, grants and custom roles.
- Supabase Auth users and the Auth data/configuration required for a tested recovery. The implementation must prove whether password hashes, identities, MFA factors, sessions and provider configuration are restorable. If any category is not exportable/restorable, disclose it and define the user-recovery process; never label the package full/verified while silently omitting it.
- Storage bucket configuration, object metadata, object bytes, content types and paths.
- Realtime/publication configuration, extensions and required project settings.
- Migration history, exact Git commit, project ref, export timestamps, tool versions and a machine-readable manifest.
- A separate secure inventory of required environment variable names and configuration. Secrets must not be placed in a downloadable archive in plaintext; restore operators must provision secrets through a secure channel.

Edge Function source and deployment configuration are version-controlled in Git and must be pinned to the backup's exact commit. Supabase project-level secrets and provider credentials need a separately managed encrypted recovery procedure.

## Architecture

1. React UI is a status/control surface only. It never exports database rows directly and never receives a service-role key, database password, storage secret or encryption key.
2. A trusted backup API validates the caller with Supabase Auth and checks the immutable project-owner/global-admin authorization on the server. Business roles alone are insufficient.
3. The API creates a job in a private control plane. The worker runs outside the browser and outside Edge Function execution limits, with pg_dump/Supabase CLI and object-storage tooling.
4. The worker reads the production project using a dedicated least-privilege operational identity, creates database/Auth/Storage/config exports, computes SHA-256 checksums, builds a manifest, encrypts the package using envelope encryption and uploads it to storage independent of the production project.
5. The control plane records job state and artifact metadata. It never stores plaintext credentials in job rows or logs.
6. Downloads use short-lived, single-purpose signed URLs after server-side authorization. The browser receives only the encrypted archive.
7. Restore is a separate break-glass workflow. The default target is a newly provisioned isolated Supabase project. Production overwrite is not a normal UI action and requires a separately reviewed recovery runbook and explicit approval.

The worker may be deployed as a secured container/worker service (for example, a Render background worker) or equivalent infrastructure. No paid resource may be provisioned without cost review and user approval.

## Backup consistency and completeness

- PostgreSQL export must use a consistent database snapshot and include schema and data, plus role/grant information needed for restore.
- Storage objects change independently of PostgreSQL. Record bucket/object inventory, size, content type, version/etag where available and checksum; detect changes during the export and retry/reconcile changed objects. The final manifest must describe the consistency boundary.
- Auth export must be proven with a restore rehearsal. Do not assume a public Auth Admin API export reproduces password hashes, MFA factors, identities or sessions.
- A package is complete only when every required component has succeeded. It is verified only after archive integrity checks and a successful restore rehearsal against an isolated project.
- A backup is failed on any missing required component, unresolved object mismatch, checksum failure or restore failure.
- Do not use a database-only dump, a schema-only dump, or a list of Storage object paths as a full backup.

## Job lifecycle and records

Recommended states: queued, running, packaging, integrity_check, complete, verified, failed, expired.

Each job records: job ID, initiator, created/started/completed timestamps, source project ref, exact Git commit, production migration history fingerprint, component results, artifact size, checksum, encryption key reference (never key material), retention deadline, restore-test reference and sanitized failure details.

Audit events are required for request, start, completion, failure, download, restore preview, restore approval and restore execution. Logs must redact credentials, signed URLs, tokens and personal data.

## Security requirements

- Project-owner/global-admin only; enforce authorization server-side on every operation, not only by hiding UI controls.
- Use separate service identities for backup and restore; no client-side service-role key.
- Encrypt in transit and at rest; use envelope encryption with keys stored separately in a managed KMS/secret store.
- Store artifacts in a private bucket/account independent of the production Supabase project. Enable object versioning/immutability where supported.
- Signed download links must be short-lived and scoped to one artifact.
- Apply retention with a minimum of two independently stored known-good recovery points. Never delete the last verified recovery point.
- Rate-limit and serialize full backup jobs; prevent concurrent overlapping jobs unless worker capacity and snapshot behavior are explicitly tested.
- Restore must verify package signature/checksum and compatibility, require an isolated target by default, and never silently overwrite production.
- No credentials, user data, database dumps or backup archives in GitHub Actions artifacts, source control, browser local storage or application logs.

## Migration safety gate

A production migration release is blocked unless the server verifies a verified backup that:

1. Belongs to the exact production project ref.
2. Was completed after the latest production data/schema changes and is within the configured freshness window.
3. Contains all required components.
4. Has a successful isolated restore rehearsal.
5. Captures the current production migration history and source commit.
6. Has no unresolved integrity warnings.

The gate is a server-side precondition in the deployment/migration workflow, not a frontend checkbox. The existing production migration history/schema reconciliation and explicit migration approval remain separate mandatory gates.

## Restore workflow

1. Select a verified artifact and validate its manifest, checksum, signature and compatibility.
2. Provision or select an isolated recovery project; confirm region and project ownership.
3. Restore roles/schema/data using the documented Supabase/PostgreSQL sequence.
4. Restore Auth using the supported, rehearsed method; rotate credentials and invalidate old sessions as appropriate.
5. Recreate Storage buckets/policies and upload object bytes; verify object counts and checksums.
6. Reapply Edge Functions and project configuration from the pinned commit; provision secrets separately.
7. Run database invariants, tenant isolation/RLS tests, accounting reconciliation, inventory reconciliation and authenticated smoke tests.
8. Record recovery outcome and RTO/RPO measurements.
9. Production cutover, if ever required, is a separate explicit operation with DNS/client configuration and approval. Never infer that a successful isolated restore authorizes production replacement.

## Delivery milestones

- M0: owner-only UI and explicit not-configured state (this PR).
- M1: threat model, worker deployment design, credential inventory, storage/KMS selection and cost approval.
- M2: worker, control-plane API, job schema, encrypted archive and independent artifact storage.
- M3: database, Auth, Storage and configuration export with manifest/checksums.
- M4: isolated restore automation and acceptance tests; only then may artifacts become verified.
- M5: scheduler, retention, alerting, download audit and migration safety-gate integration.
- M6: authenticated browser acceptance, operational runbook, RTO/RPO exercise and production rollout.

## Acceptance criteria

- A project owner can initiate and monitor a full backup; non-owner roles cannot.
- A backup cannot be marked complete/verified when any required component is absent.
- A package can be downloaded only by an authorized owner using a short-lived link.
- No privileged credential or plaintext key is exposed to the browser, logs or artifact.
- Checksums and manifest detect missing/tampered files and Storage objects.
- A restore into a separate project reproduces supported DB/Auth/Storage state and passes tenant, accounting and inventory checks.
- Failed restore leaves the source project unchanged.
- Migration gate rejects missing, stale, incomplete, unverified or wrong-project artifacts.
- Scheduler, retention and alerts are tested, and the last verified backup cannot be deleted by retention.
- No production schema, data, migration history or schema cache is changed as part of this UI foundation.

## Current status

The UI foundation deliberately reports that no backup provider is configured. This PR does not create backups, provision infrastructure, add credentials, alter production schema or authorize migrations.
