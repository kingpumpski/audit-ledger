# Backup & Recovery — worker and control-plane design

Status: design only. No service, database, bucket, secret, DNS record or paid resource has been provisioned.

## 1. Deployment boundary

Use three separately deployable parts:

- Audit Ledger React page: requests jobs and displays sanitized status only.
- Backup control-plane API: authenticates the user, authorizes global project ownership, creates and reports jobs, issues short-lived artifact download links.
- Isolated backup worker: runs PostgreSQL/Supabase export tools and object-storage sync; never runs in the browser or in a request-bound Edge Function.

The worker must have outbound access to the source Supabase project and independent artifact storage. It must not be publicly reachable. The control-plane API is the only public interface and must validate the Supabase JWT and current global-admin/owner authorization on every request.

## 2. Provider-neutral job API

Suggested endpoints (all authenticated):

| Method | Endpoint | Purpose |
|---|---|---|
| POST | /api/admin/backups | Enqueue a full-project backup |
| GET | /api/admin/backups | List sanitized backup jobs |
| GET | /api/admin/backups/:id | Get one job and component status |
| POST | /api/admin/backups/:id/download | Issue one short-lived download URL |
| POST | /api/admin/backups/:id/verify | Queue integrity verification |
| POST | /api/admin/backups/:id/restore-rehearsal | Queue restore into an approved isolated target |

Do not expose an endpoint that accepts an arbitrary database URL, shell command, bucket URL or restore target supplied by the browser. Restore targets must be pre-registered, allow-listed and independently authorized. Production overwrite is explicitly out of scope for the normal API.

## 3. Control-plane data model

Store job metadata in a dedicated private control-plane database, not in the production business schema. Suggested records:

### backup_jobs
- id (UUID), source_project_ref, requested_by, status
- created_at, started_at, completed_at, retention_expires_at
- source_git_commit, migration_history_fingerprint
- manifest_object_key, encrypted_archive_object_key
- archive_bytes, archive_sha256, encryption_key_reference
- restore_rehearsal_id, sanitized_error_code, sanitized_error_summary

### backup_job_components
- job_id, component (database, roles, auth, storage_metadata, storage_objects, configuration, edge_functions)
- status, started_at, completed_at, item_count, bytes, checksum, sanitized_error_code

### backup_audit_events
- actor, action, job_id, timestamp, source_ip (if approved), sanitized_metadata

All tables are private to the control plane. The application user must not receive direct table access. Writes happen through the API/worker only. Never store passwords, access tokens, database URLs, signed URLs or encryption key material in these records.

## 4. Worker lifecycle

1. Claim a queued job using an atomic lease/lock; prevent duplicate workers from processing the same job.
2. Revalidate source project identity and pinned Git commit.
3. Record the current migration history fingerprint.
4. Export PostgreSQL using a consistent snapshot and explicit schema/data/role strategy.
5. Export Auth only using a documented and restore-tested method. Record unsupported categories explicitly; do not assume Auth Admin API output contains password hashes, MFA factors or sessions.
6. Inventory Storage buckets and object metadata, copy object bytes, compute per-object checksums and detect objects changed during the copy. Reconcile/retry changed objects before finalizing.
7. Capture project configuration and Edge Function source at the pinned Git commit. Secrets are references in a separate secrets manager, never exported in plaintext.
8. Generate a manifest with component status, object counts, byte counts, timestamps, tool versions, source project ref, Git commit and migration history fingerprint.
9. Package and encrypt with envelope encryption. The data-encryption key is wrapped by a KMS-managed key; only the key reference is recorded in job metadata.
10. Upload to private independent storage with versioning/immutability where available.
11. Re-download/stream-verify the archive and every component checksum.
12. Queue an isolated restore rehearsal. Only a successful restore and invariant suite can set status to verified.

A job cannot be complete or verified if a required component is skipped, partial, unsupported without an approved recovery procedure, or failed.

## 5. Auth and Storage completeness rules

### Auth
The design must prove whether the selected export/restore method preserves:
- user IDs and account metadata;
- password hashes and recovery behaviour;
- identities and provider linkage;
- MFA factors and recovery codes;
- sessions/refresh tokens and invalidation behaviour;
- auth configuration, redirect URLs, hooks and provider settings.

Where Supabase does not support a category's export/import, mark it as unsupported and provide a documented user re-enrolment/password-reset recovery procedure. Never silently claim bit-for-bit Auth restoration.

### Storage
Capture both database metadata and object bytes. For each bucket/object preserve path, content type, size, checksum/etag/version where available, cache-control and relevant metadata. Compare source and copied object inventories and reconcile concurrent writes. Bucket policies and public/private status are part of configuration recovery.

## 6. Supabase export and restore boundaries (verified 2026-11-20)

The worker must not treat a normal `supabase db dump` as a full-project backup. The current CLI excludes Supabase-managed schemas by default, including `auth`, `storage` and extension-managed schemas. Its default output is schema-only and does not include table data or custom roles unless the corresponding flags are requested.

A baseline logical export therefore needs separate, explicitly verified components:

```bash
supabase db dump --remote="$SUPABASE_DB_URL" -f roles.sql --role-only
supabase db dump --remote="$SUPABASE_DB_URL" -f schema.sql
supabase db dump --remote="$SUPABASE_DB_URL" -f data.sql --data-only --use-copy \
  -x "storage.buckets_vectors" -x "storage.vector_indexes"
```

These commands are a baseline for the application database, not proof of Auth/Storage completeness. The worker must add a separately tested export for required Auth data and Storage metadata, and must copy the actual Storage object bytes. A database backup alone does not contain those bytes.

The restore runbook must also account for the following platform boundaries:

- Supabase's documented “Restore to a new project” flow can copy Auth user data (including password hashes and authentication records) and the project's encryption root key, but it does not copy Storage objects/settings, Edge Functions, Auth settings/API keys, Realtime settings, extension configuration or read replicas. The flow is currently plan-gated and can create additional monthly costs.
- A manual logical restore requires required extensions and Realtime publications/settings to be recreated. If Vault/pgsodium is used, its encryption root key must be transferred separately through a secure process; it is not contained in the logical backup archive.
- Custom role passwords are not included in Supabase's daily backup downloads and must be reset after restoration.
- Migration history may need a separate schema/data export and restore; never mark a target ready solely because application tables restored.

Official references:
- [Supabase Database Backups](https://supabase.com/docs/guides/platform/backups)
- [Supabase CLI `db dump`](https://supabase.com/docs/reference/cli/global-flags)
- [Backup and Restore using the CLI](https://supabase.com/docs/guides/platform/migrating-within-supabase/backup-restore)
- [Restore to a new project](https://supabase.com/docs/guides/platform/clone-project)

The worker must expose each unsupported or unverified component as an explicit failed/partial component. It must not convert these limitations into a “full backup” success state.

## 8. Migration safety-gate contract

The migration workflow must call the control-plane API using a workload identity before applying production migrations. The gate returns allow only if:
- the artifact source project ref exactly matches the configured production ref;
- status is verified, not merely complete;
- restore rehearsal passed against an isolated target;
- all required components are present and checksummed;
- artifact age is within the configured freshness window;
- the migration-history fingerprint matches the current production history;
- no unresolved warnings exist;
- at least one other independently stored verified recovery point is retained.

A browser checkbox, UI status, manual SQL row or GitHub artifact is never sufficient. Gate failure must stop the migration job before any DDL/DML or migration-history mutation.

The gate does not replace migration sequence reconciliation, data preflight, staging validation, review and explicit release approval.

## 7. Scheduling, retention and operations

- Schedule daily full backups initially; choose incremental/object-deduplicated optimizations only after restore testing.
- Trigger an additional backup before approved production migration releases.
- Serialize full exports unless snapshot and worker capacity are proven safe for concurrency.
- Keep at least two independently stored verified recovery points; retention must never delete the last known-good point.
- Alert on missed schedule, failed component, checksum mismatch, storage quota, expired credentials, failed restore rehearsal and migration-gate rejection.
- Measure RPO/RTO in recurring recovery exercises.
- Download URLs must be short-lived, one-artifact scoped, and audited.

## 9. Required secrets and cost decision before implementation

Before provisioning, the owner must approve:
- worker hosting/provider and monthly cost ceiling;
- independent object-storage provider, region, retention and egress costs;
- KMS/envelope-encryption provider and key rotation policy;
- control-plane database location and backup policy;
- network access and operational identities;
- restore-rehearsal target and any temporary project costs.

Do not reuse the production Supabase service-role key as the worker's general credential. Prefer a narrowly scoped operational identity and dedicated database credentials; document any unavoidable Supabase platform-level privilege requirement and rotate it.

No secret should be requested in chat or committed to GitHub. Provision through the provider's secret manager.

## 10. Acceptance tests before production use

- Non-owner requests are denied by the API even if they call endpoints directly.
- Forged job IDs and cross-project artifact IDs are denied.
- Duplicate job delivery is idempotent; worker lease expiry safely recovers abandoned jobs.
- A database-only dump cannot be marked full/verified.
- Missing Auth category or Storage object causes incomplete status.
- Object mutation during export is detected and reconciled.
- Corrupt archive, manifest or component checksum fails verification.
- Signed URL expires and cannot access another artifact.
- Restore rehearsal creates an isolated target and cannot overwrite production.
- Tenant RLS, cross-business isolation, accounting balances, inventory quantities, audit history and authenticated smoke tests pass after restore.
- Migration gate rejects stale, wrong-project, incomplete, unverified and history-mismatched artifacts.

## 11. Current implementation status

This document defines M1. It is not an implemented service. The current Backup & Recovery UI must continue to display "not configured" until the worker, API, independent storage, encryption, Auth/Storage recovery, restore rehearsal and migration gate have all passed operational acceptance.
