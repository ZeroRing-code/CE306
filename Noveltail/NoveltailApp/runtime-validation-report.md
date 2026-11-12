# Runtime Validation Report

**Generated:** 2026-11-11T18:32:52+07:00  
**Target:** `C:\Users\Rutchapol\OneDrive\เดสก์ท็อป\งาน\Noveltest`

## Migration 003 apply and verification

**Overall:** PASS. Migration 003 was applied to the approved live `Noveltail` database in a transaction after rechecking the target and verified backup. Post-apply schema checks and regression tests passed. No existing data rows changed.

| Area | Status | Evidence |
|---|---|---|
| Live target identity | PASS | Configured and connected DB `Noveltail`, `localhost:5432` (`::1`), PostgreSQL 18.6, user `postgres`, schema `public` |
| Migration history | PASS | No migration-history table exists; status determined from database schema signatures |
| Migration 001 | PASS | Wallet, wallet transaction, chapter unlock tables and paid chapter columns present |
| Migration 002 | PASS | Reversal column, novel moderation column and active appeal assignment index present |
| Migration 003 on live DB | PASS | Applied transactionally; `SYSTEM` actor role constraint and both Migration 003 indexes verified |
| Migration 004 on live DB | PASS | 3/3 Reports indexes and `announcement` audit target support present |
| Full backup | PASS | 99,765 bytes; `pg_restore --list` reports 28 public tables and 28 table-data entries |
| Full restore rehearsal | PASS | Restored to an isolated disposable DB; row counts, FK, index, and semantic constraint comparisons passed |
| Migration 003 rehearsal | PASS | Applied twice on restored DB; only intended role constraint and two indexes changed; no row count/FK changes; Migration 004 remained intact |
| Migration 003 rollback rehearsal | PASS | SYSTEM audit guard refused rollback; successful rollback on disposable DB preserved Migration 004 |
| `npm run migration` after apply | PASS | Exit 0; required columns 4/4, no active suspension conflicts, Migration 004 3/3 |
| `npm test` after apply (run 1) | PASS | Exit 0; 6 passed, 0 failed |
| `npm test` after apply (run 2) | PASS | Exit 0; 6 passed, 0 failed |
| `npm run test:e2e` | PASS | Exit 0; 4 passed, 0 failed |
| `npm audit --omit=dev` | PASS | Exit 0; 0 vulnerabilities |
| JavaScript syntax | PASS | `node --check` passed for all 61 JavaScript files |

### Confirmed live schema and data before Migration 003

- Existing tables: `users`, `account_suspensions`, `appeals`, `appeal_assignments`, `admin_action_logs`; their expected columns, keys, constraints, and foreign keys are present.
- Current user roles: 1 `SUPER_ADMIN`, 1 `USER`; no existing `ADMIN` accounts.
- Row counts: `users` 2; `account_suspensions` 0; `appeals` 0; `appeal_assignments` 0; `admin_action_logs` 0. Reports and Announcements tables are also present and empty.
- No duplicate active suspensions; no `SYSTEM` audit records.
- Existing actor role check allows `ADMIN` and `SUPER_ADMIN`. Existing audit target check includes `announcement`.
- Migration 003 indexes are not present: `account_suspensions_one_active_per_user` and `account_suspensions_expiration`.
- Existing appeal indexes, including `appeal_assignments_one_active_per_appeal`, remain present.
- Migration 004's three report indexes are present. No schema discrepancy was found that requires changing Migration 003.

### Backup and restore evidence

Full custom-format backup:

`C:\Users\Rutchapol\.copilot\session-state\641e8705-cc52-4f63-bf7b-22b79fad5206\files\Noveltail-pre-migration-003-20261111112331_66992_b8e8a.dump`

- Size: **99,765 bytes**
- SHA-256: `4127A035967EE426824AE9BA75FA57404146216D87ECC50BC199F75886EDA4FC`
- Archive validation: PASS; `pg_restore --list` returned 28 table definitions and 28 table-data entries.
- Restore rehearsal: PASS on a unique disposable database; all 28 public table row counts matched. Foreign keys, index definitions, and constraints matched semantically. PostgreSQL may render equivalent CHECK expressions with different cast/parenthesis formatting after restore; normalized expressions and constraint names/types were compared.
- The disposable restore DB was removed. The verified backup was retained; no existing backup was overwritten.

### Migration rehearsal and workflow regression

On a fresh disposable restore of the backup, Migration 003 ran twice successfully. It added only:

1. `account_suspensions_one_active_per_user` — unique index on `user_id` where `restored_at IS NULL`.
2. `account_suspensions_expiration` — index on `(suspended_until, user_id)` where the suspension is unrestored and has an expiration.

The migration replaced the Admin Action Log actor-role check to add `SYSTEM`; other constraints and all foreign keys were preserved. All 28 public table row counts remained unchanged. Migration 004's three report indexes and `announcement` target constraint remained intact.

The rollback script was rehearsed only on a disposable restore. Its guard refused rollback while a synthetic `SYSTEM` audit row existed and left both indexes in place. After removing only that synthetic row, rollback completed on the disposable DB, restored the pre-003 actor-role check, and preserved Migration 004. No rollback or test data was applied to the live DB.

`npm test` and `npm run test:e2e` use disposable PostgreSQL databases, not database mocks. Existing suspension/appeal integration coverage includes temporary/permanent suspension, restore and duplicate-restore denial, expiry restoration, active-admin authorization, first appeal and repeated attempts up to the maximum of four, early takeover rejection, takeover after eight days, and assignment history. E2E covers the Admin suspension and user appeal journey. The tests replay numbered migrations on disposable databases.

| Command | Result |
|---|---|
| `npm run migration` | PASS — exit 0; read-only preflight; 4/4 prerequisite columns, no active suspension conflicts, Migration 004 3/3 |
| `npm test` | PASS — exit 0; 6 passed, 0 failed |
| `npm run test:e2e` | PASS — exit 0; 4 passed, 0 failed |
| `npm audit --omit=dev` | PASS — exit 0; 0 vulnerabilities |
| `node --check` | PASS — exit 0; 61 JavaScript files |

A direct `node --test tests/integration.test.js` invocation was safely rejected because the suite requires the disposable-database marker. The supported `npm test` command then passed; the direct invocation did not write to the live DB.

### Live apply and post-apply checks

Immediately before applying, the connection was rechecked: configured host `localhost`, port `5432`, database `Noveltail`, user `postgres`; PostgreSQL reported `::1:5432`, version 18.6, schema `public`. The reported backup still existed at 99,765 bytes with SHA-256 `4127A035967EE426824AE9BA75FA57404146216D87ECC50BC199F75886EDA4FC`. `pg_restore --list` succeeded and showed 28 public table definitions and 28 public table-data entries. The migration preflight passed, both Migration 003 indexes were absent, the old actor-role constraint excluded `SYSTEM`, and all three Migration 004 indexes plus announcement audit support were present.

The project migration file `migrations/003_account_suspension_workflow.sql` was applied with `psql` to the approved target. A same-connection guard verified the database name, port, schema, pending Migration 003 signatures, Migration 004 signatures, and absence of duplicate active suspensions before the file ran. The SQL completed `BEGIN`, constraint updates, both index creations, and `COMMIT`; `psql` exited 0.

Post-apply verification confirmed:

- `account_suspensions_one_active_per_user` is unique on `user_id` with predicate `restored_at IS NULL`.
- `account_suspensions_expiration` indexes `(suspended_until, user_id)` with the expected active/non-null expiration predicate.
- The actor-role CHECK is `admin_action_logs_actor_role_check` and allows `ADMIN`, `SUPER_ADMIN`, and `SYSTEM`.
- Migration 004's three partial unique report indexes are intact, as is `admin_action_target_type_check` support for `announcement`.
- All seven suspension/appeal/assignment foreign keys remain present and validated.
- All 28 public table row counts exactly match the captured pre-apply counts; no duplicate active suspensions exist.
- `npm run migration` passed after apply. `npm test` passed twice after apply (6/6 each). Each run replayed migrations 001–004 twice on its isolated schema-only database snapshot and successfully exercised backup/restore of synthetic test data. The runner did not copy or change source table data.
- Migration 003 was applied only once to the live database; no other migration was applied.

## Previous Migration 004 application

Migration 004 was applied to the approved live database in the preceding task. Its three partial unique report indexes and `announcement` audit target support remain present after Migration 003.

## Remaining limitations

- **OPEN:** Rate limits are process-local; deploy one application instance until a shared store is implemented.
- **NOT TESTED:** Manual visual/accessibility review, performance/load testing, and exhaustive penetration testing remain outstanding.

## Master Final QA follow-up

**Generated:** 2026-11-11T19:05:21+07:00  
**Scope:** Continue final QA using disposable PostgreSQL databases for writes; production database checks remained read-only. No migration was applied and no production data was changed in this follow-up.

### Verdict

**Overall: NEEDS ACTION before production deployment.** The implemented functional/security regression suites passed. Production readiness is still blocked on deployment configuration and outstanding manual/security/performance checks listed below.

| Area | Status | Evidence |
|---|---|---|
| Live database identity and read-only preflight | PASS | Configured `Noveltail` on `localhost:5432`, PostgreSQL 18.6, schema `public`; preflight confirmed 4/4 Migration 003 prerequisite columns, no active-suspension conflicts, 22/22 Reports/Announcements columns, Migration 004 indexes 3/3, and announcement audit support. No migration was applied by the preflight. |
| Live schema integrity | PASS | Read-only inspection found 28 public tables and 60 validated foreign keys; no orphan rows or invalid constraints/indexes were found. No live data or schema was changed during this QA follow-up. |
| `npm test` | PASS | Exit 0; 7 passed, 0 failed. Includes disposable-database integration coverage. |
| `npm run test` | PASS | Exit 0; 7 passed, 0 failed. Same canonical test runner, independently rerun. |
| `npm run migration` | PASS | Exit 0; read-only preflight only. |
| `npm run test:e2e` | PASS | Exit 0; 4 passed, 0 failed, Chromium. The runner restored and verified its synthetic-data disposable database. |
| Concurrent Wallet workflows | PASS | Integration coverage now sends concurrent duplicate top-ups with one idempotency key, concurrent unlocks with different keys, and concurrent refunds. It asserts stable balances, one unlock, one successful refund, one conflict, and a single reversal while preserving the 90/10 allocation. |
| `npm audit --omit=dev` | PASS | Exit 0; 0 vulnerabilities. |
| JavaScript syntax | PASS | `node --check` passed for all 64 JavaScript files. |
| Responsive checks | PASS | E2E checks horizontal overflow at 360, 390, 430, 768, 1024, 1280, 1440, and 1920 px across the exercised pages; the 1024 px navigation overflow found earlier is fixed. |

### Test environment and scope

- Node.js v24.20.0; Chromium/Playwright available.
- Docker daemon unavailable. This did not prevent browser E2E; test runs used the project's disposable PostgreSQL workflow against local PostgreSQL, not mocks for database integration.
- Integration and E2E test setup replayed migrations 001–004 on isolated test schemas. Source database contents were not copied into test data and were not altered.
- E2E covers registration/login/logout and Wallet, reading and chapter unlock, bookmark/comment/review/follow/history, suspension and appeal, Reports, Announcements, admin role flows, CSRF, login throttling, and responsive overflow for exercised pages.
- All eight documented responsive widths are automated checks, not a manual visual or accessibility audit.

### Fixed during final QA

- Added the 901–1200 px profile-navigation layout breakpoint after the 1024 px overflow was detected.
- Added responsive overflow checks at eight viewport widths and included useful overflowing-element details on failure.
- Added security response headers and regression coverage; `X-Powered-By` is disabled and HSTS is conditional on production HTTPS.
- Added `.env.example` with placeholders and README setup guidance; it contains no live secrets.
- Added concurrent Wallet idempotency/unlock/refund regression coverage.

### Deployment blockers and remaining work

| Status | Finding | Required action |
|---|---|---|
| BLOCKED | Configured database user is the PostgreSQL `postgres` superuser. | The exact runtime grants now pass an isolated PostgreSQL rehearsal; the owner must still provision/configure the runtime role on the live database after approval. |
| BLOCKED | `NODE_ENV` and `APP_ORIGIN` are unset in the current environment. | Configure `NODE_ENV=production`, the exact HTTPS public origin, and a high-entropy secret via deployment secret management; verify production cookie/origin behavior. |
| BLOCKED for multiple instances | Rate-limit counters are process-local. | Keep one application instance or introduce and test a shared rate-limit store before scaling out. |
| NOT TESTED | Manual accessibility and cross-browser review. | Perform the release accessibility review and test supported browsers/devices. |
| NOT TESTED | Performance, load, and exhaustive penetration testing. | Run these against a production-like isolated environment before opening public traffic. |
| LIMITED | Slow-query/index-usage analysis is incomplete because `pg_stat_statements` is unavailable. | Enable approved query telemetry before drawing index-removal or performance conclusions. |
| NOT IMPLEMENTED | Password reset/change endpoints are absent. | Keep password-recovery claims/features out of release scope until implemented and tested. |
| LIMITED | No CSP policy is configured. | Design and validate a CSP against the existing inline/external assets before enabling it; do not deploy a speculative policy that breaks the UI. |

### Artifacts and changes

- [runtime-validation-report.md](./runtime-validation-report.md) — this final QA evidence and remaining deployment conditions.
- [tests/integration.test.js](./tests/integration.test.js) — concurrent Wallet regression coverage.
- [tests/e2e/noveltail.spec.js](./tests/e2e/noveltail.spec.js) — responsive and browser regression coverage.
- [public/profile-nav.css](./public/profile-nav.css) — tablet navigation overflow fix.
- [server.js](./server.js) and [tests/security.test.js](./tests/security.test.js) — security headers and regression test.
- [.env.example](./.env.example) and [README.md](./README.md) — safe configuration example and setup/test guidance.

No deploy was performed. Migrations 003 and 004 are already applied to the live database as documented above; this QA follow-up applied no additional migrations.

## Production readiness hardening follow-up

**Generated:** 2026-11-11T19:48:08+07:00  
**Scope:** Production safeguards, shared rate limiter, automated accessibility, and bounded load tests. All database writes and migration replays below used the project's uniquely named disposable PostgreSQL databases. No live credentials, production secrets, database grants, or deployments were changed.

### Verdict

**Overall: BLOCKED - not production-ready.** Code safeguards and local/disposable regression evidence are in place, but the live database still uses the `postgres` superuser, Migration 005 is pending on it, production environment values are not configured, and manual/production-like reviews remain.

| Check | Status | Result |
|---|---|---|
| `npm test` | PASS | Exit 0; latest run 17 passed, 0 failed. The runner verified its schema-only archive, replayed migrations 001-005 twice on a disposable database, and verified a synthetic-data backup/restore. |
| `npm run test` | PASS | Exit 0; 17 passed, 0 failed. Same canonical test runner, independently rerun after final code changes. |
| `npm run test:e2e` | PASS | Exit 0; 6 passed, 0 failed, Chromium. |
| Automated accessibility | PASS (automated scope only) | Axe found zero violations on all 18 scanned routes; keyboard test for auth tabs/forms passed. |
| `npm run migration` | PASS (read-only) | Exit 0; Migration 003 prerequisites 4/4, no active suspension conflicts, Reports/Announcements columns 22/22, Migration 004 indexes 3/3 and announcement audit support present. Migration 005 is pending. |
| `npm audit` | PASS | Exit 0; 0 vulnerabilities. |
| JavaScript syntax | PASS | `node --check` passed for all 70 project JavaScript files. |
| Database permission rehearsal | BLOCKED | No dedicated disposable PostgreSQL cluster was available; Docker CLI is not installed. No roles or grants were created or changed on the configured cluster. |
| Production configuration | BLOCKED | Current `.env.example` is development-only (`NODE_ENV=development`, `DB_SSL=false`, `RATE_LIMIT_STORE=memory`); deployment values and secrets must be set by the owner. |
| Penetration testing | NOT TESTED | Dependency and automated security regression checks are not a penetration test. |
| Manual accessibility | NOT TESTED | No manual screen-reader, cross-browser, or user assessment was performed. |

### Bounded local load evidence

`tests/load.test.js` executed against the disposable PostgreSQL-backed app. Each profile issued 72 GET requests across the home page, novel listing/detail/chapters, comments, reviews, wallet, notifications, and Admin users endpoints. The table shows all four observed runs; the variation is retained rather than selecting only the faster run.

| Run | Concurrency | Requests / HTTP errors | Throughput (req/s) | Latency p50 / p95 / max (ms) | App-process CPU (%) | Heap delta (bytes) | DB pool peak / waiting |
|---|---:|---|---:|---|---:|---:|---|
| 1 | 1 | 72 / 0 | 36.39 | 16.93 / 67.37 / 109.59 | 13.45 | 7,055,712 | 1 / 0 |
| 1 | 5 | 72 / 0 | 97.98 | 18.69 / 171.13 / 327.38 | 38.24 | 1,141,680 | 5 / 0 |
| 1 | 10 | 72 / 0 | 113.29 | 23.08 / 240.95 / 378.88 | 36.98 | -34,584 | 10 / 0 |
| 2 | 1 | 72 / 0 | 75.37 | 14.62 / 17.90 / 21.38 | 50.67 | 1,464,808 | 1 / 0 |
| 2 | 5 | 72 / 0 | 272.30 | 11.42 / 93.95 / 133.20 | 112.32 | 1,582,408 | 5 / 0 |
| 2 | 10 | 72 / 0 | 287.67 | 24.84 / 141.28 / 161.11 | 112.27 | 1,385,568 | 9 / 0 |
| 3 | 1 | 72 / 0 | 71.87 | 15.14 / 18.60 / 31.73 | 43.72 | 1,445,720 | 1 / 0 |
| 3 | 5 | 72 / 0 | 259.26 | 14.52 / 76.40 / 101.26 | 78.86 | 1,421,488 | 5 / 0 |
| 3 | 10 | 72 / 0 | 263.59 | 21.27 / 137.84 / 171.96 | 114.22 | 1,807,096 | 10 / 0 |
| 4 | 1 | 72 / 0 | 48.80 | 15.38 / 37.96 / 221.02 | 24.40 | 1,356,376 | 1 / 0 |
| 4 | 5 | 72 / 0 | 95.31 | 20.47 / 253.77 / 460.50 | 24.89 | 1,488,576 | 5 / 0 |
| 4 | 10 | 72 / 0 | 315.86 | 22.65 / 104.66 / 226.25 | 82.04 | 6,199,944 | 9 / 0 |

Each run also sent ten concurrent duplicate top-ups with one idempotency key, ten concurrent chapter unlocks, and two simultaneous refunds of the same purchase. Assertions passed: one top-up ledger entry, one purchase, one successful refund and one HTTP 409 conflict, no negative wallets, refunded unlock removed, and the original 90/10 creator/platform allocation preserved.

These are short local smoke-load samples, not a capacity benchmark or production SLO. Heap delta is a before/after Node heap measurement, not peak resident memory; CPU is the Node process measurement and may exceed 100% across cores. PostgreSQL host CPU/memory, long-duration saturation, pool limits under multiple application instances, and production-like network conditions were not measured.

### Implemented safeguards and shared rate limiter

- Production startup validation requires a non-placeholder JWT secret, explicit HTTPS `APP_ORIGIN`, TLS, explicit trusted proxy hops, PostgreSQL rate-limit storage, and required database configuration.
- Startup rejects a configured database-name mismatch and runtime roles with superuser, role/database administration or privileged-role membership, public-object ownership, database/schema `CREATE`, excess table DDL, or sequence `UPDATE` privileges; an integration test executes this catalog query against disposable PostgreSQL.
- Shared PostgreSQL rate-limit counters use atomic upserts and HMAC-derived bucket keys. Multi-instance counters, HTTP 429/`Retry-After`, and fail-closed 503 behavior passed automated disposable-database tests.
- `migrations/005_shared_rate_limit_store.sql` was replayed only in disposable tests. It has **not** been applied to the configured `Noveltail` database. The live preflight reports Migration 004 intact and 3/3 indexes present.
- Current live role was previously read-only verified as `postgres` with administrative privileges. Production startup will reject that role; the isolated least-privilege grant rehearsal has now passed, but owner provisioning and live configuration remain outstanding.

### Changed files and references

- [runtime-validation-report.md](./runtime-validation-report.md) — this follow-up evidence and updated blockers.
- [PROJECT_DECISIONS.md](./PROJECT_DECISIONS.md), [README.md](./README.md), and [.env.example](./.env.example) — production/shared-limiter decisions, safe configuration example, migration replay scope, and setup-guide links.
- [config/runtime-validation.js](./config/runtime-validation.js), [config/production-database.js](./config/production-database.js), [db.js](./db.js), and [server.js](./server.js) — production environment, TLS/pool, database identity and least-privilege startup guards.
- [middleware/rate-limit.js](./middleware/rate-limit.js), [migrations/005_shared_rate_limit_store.sql](./migrations/005_shared_rate_limit_store.sql), [scripts/check-migration-003.js](./scripts/check-migration-003.js), [package.json](./package.json), and [package-lock.json](./package-lock.json) — shared PostgreSQL counters, read-only migration status, and test dependency wiring.
- [docs/production-setup.md](./docs/production-setup.md) — production configuration and release checklist.
- [docs/database-permissions.md](./docs/database-permissions.md) — owner-operated least-privilege role procedure and rehearsal requirements.
- [docs/shared-rate-limiter.md](./docs/shared-rate-limiter.md) — shared-store configuration, failure behavior, and verification.
- [tests/runtime-config.test.js](./tests/runtime-config.test.js), [tests/rate-limit-store.test.js](./tests/rate-limit-store.test.js), [tests/load.test.js](./tests/load.test.js), and [tests/e2e/accessibility.spec.js](./tests/e2e/accessibility.spec.js) — production privilege/config tests, multi-instance limiter coverage, bounded load and Wallet integrity, and axe/keyboard scans.
- [tests/integration.test.js](./tests/integration.test.js), [tests/e2e/noveltail.spec.js](./tests/e2e/noveltail.spec.js), [playwright.config.js](./playwright.config.js), and [public/](./public/) — concurrent Wallet regressions, browser/responsive checks, and accessibility fixes across rendered pages/styles.

### Remaining release blockers

1. **BLOCKED:** Owner must provision/configure the least-privilege application role on the live database after approval. The isolated DML/sequence and denied-DDL rehearsal passed; no production grant or credential was changed.
2. Owner must configure production secrets and values through a secret manager, including `NODE_ENV=production`, `DB_SSL=true`, `RATE_LIMIT_STORE=postgres`, `APP_ORIGIN`, `TRUST_PROXY_HOPS`, and the approved database credentials.
3. Migration 005 must be backed up, rehearsed, approved, and applied by the database owner before production shared limiting can be enabled. It was not applied here.
4. Perform manual accessibility and supported-browser testing, a production-like load/capacity exercise, and an authorized penetration test before public release.
5. Confirm connection budgets/monitoring and production deployment readiness. No deployment was performed.

## PostgreSQL runtime-role preparation and isolated rehearsal

**Generated:** 2026-11-11T20:12:22+07:00  
**Scope:** Prepare least-privilege PostgreSQL runtime grants and validate the application on a disposable PostgreSQL cluster. No live role, grant, password, schema, table data, migration, production secret, or deployment was changed.

### Verdict

**Runtime-role rehearsal: PASS. Live role change: BLOCKED pending database-owner approval and execution.** Production is not ready solely because this focused rehearsal passed; all remaining release gates above still apply.

| Check | Status | Evidence |
|---|---|---|
| Source connection preflight | PASS | Read-only connection confirmed `Noveltail`, `localhost:5432` (loopback `::1`), schema `public`, PostgreSQL 18.6. |
| Source snapshot | PASS | `pg_dump --schema-only`; 28 public tables inspected and no table data copied. The harness rejected a snapshot if `public.rate_limit_buckets` existed, preserving Migration 005 as pending. |
| Effective table grants | PASS | 23 readable tables; 22 writable tables overall: 22 `INSERT`, 14 `UPDATE`, and 12 `DELETE` grants, with overlapping table sets documented in `docs/database-permissions.md`. No `TRUNCATE`, `TRIGGER`, `REFERENCES`, or table grant options. |
| Wallet ledger least privilege | PASS | `wallet_transactions` has `SELECT`/`INSERT` only; no `UPDATE` or `DELETE`. Refund and cancellation serialize using a transaction-scoped advisory lock, preserving append-only ledger entries and the 90/10 reversal allocation. |
| Sequences and routines | PASS | 15 identity sequences, zero serial/default sequences needing direct grants; inserts generating identity values passed without sequence privileges. No custom public function `EXECUTE` privilege remained for the test role; trigger-based wallet creation passed. |
| Role and DDL boundaries | PASS | Test role had no `SUPERUSER`, `CREATEDB`, `CREATEROLE`, `BYPASSRLS`, or memberships; no database/schema persistent `CREATE`; `CREATE TABLE`, `ALTER TABLE`, `DROP TABLE`, and `TRUNCATE` were denied. |
| Targeted application tests | PASS | `node scripts/test-runtime-role.js` exit 0; 3 passed, 0 failed. Covered login, Wallet/refund and chapter unlock, moderation/suspension/Appeals, Reports, Announcements, and notifications under the restricted role. |
| Syntax | PASS | `node --check scripts/test-runtime-role.js` and `node --check routes/wallet.js` passed. |
| Full QA suite | NOT TESTED | Intentionally not rerun per task scope. |
| Live role creation/grants and credential configuration | BLOCKED | Must be performed by the database owner after approval; the configured live role remains unchanged. |

### Rehearsal details

The harness used the repository's existing `.env` connection only for a read-only identity check and schema-only dump. It verified the server was PostgreSQL 18.6 at `Noveltail` / `localhost:5432` / `public`, then initialized a uniquely named local PostgreSQL cluster, restored the schema snapshot, and created `noveltail_runtime` only inside that disposable cluster. It did not copy user/table data, replay migrations, or modify the source database. The disposable cluster, role, test database, and dump were removed after the run.

The first attempt at the added source preflight stopped before creating the temporary cluster because IPv6 loopback was formatted as `::1/128`; the check was normalized to compare the host address. The subsequent full rehearsal passed. Neither attempt wrote to the configured database.

The initial Wallet failure exposed that `SELECT ... FOR UPDATE` on `wallet_transactions` requires table `UPDATE` privilege even when no ledger row is modified. Rather than grant mutation rights on the append-only ledger, the refund and simulated top-up cancellation routes now serialize each reversal with a transaction-scoped advisory lock and read ledger rows without `FOR UPDATE`. Existing concurrent-refund coverage passed: one refund succeeded, the competing request received a conflict, the purchase was not double-reversed, and the 90/10 allocation remained unchanged.

`scripts/test-runtime-role.js` now checks the source connection identity before dumping, reports identity-backed sequences, applies exact DML grants, validates effective privileges, denies persistent DDL/destructive table operations, and exercises the restricted-role API paths. The detailed owner SQL, exact table lists, test procedure, and live owner checklist are in [docs/database-permissions.md](./docs/database-permissions.md). Production environment requirements remain as described in [docs/production-setup.md](./docs/production-setup.md).

### Required owner actions

1. Review current live `PUBLIC` privileges, role memberships, object ownership, custom routine execution, and the exact grants in `docs/database-permissions.md`.
2. Obtain approval for the live database role change, then create the dedicated login and set its credential interactively through the approved secret manager. Do not copy a password from the rehearsal.
3. Apply the reviewed grants to the intended live database only; do not apply Migration 005 as part of this role change.
4. Configure the application to use that login and run the approved startup/application verification. Keep the migration/administration identity separate.

No live database grant or credential was changed. Migration 005 remains pending on the configured database. The application remains **BLOCKED from production readiness** until owner-controlled provisioning/configuration and all other release gates are complete.

## Focused runtime-role permission review — 2026-11-11

This follow-up supersedes the earlier runtime-role **PASS** as an approval verdict. **Overall: BLOCKED.** The previous matrix fails two real application upserts; the corrected candidate passes focused synthetic PostgreSQL checks but has not been verified against a faithful current schema, owners, ACLs or application workflows. This follow-up did not connect to `Noveltail`, change any actual database, role, grant or credential, apply migration 005, rerun full QA, or modify application code.

| Scope | Status | Evidence / limitation |
|---|---|---|
| Old permission matrix vs application | **FAIL** | `routes/reactions.js` uses `INSERT ... ON CONFLICT DO UPDATE` for `comment_reactions` and `review_reactions`. The previous grants omitted UPDATE; PostgreSQL 18.6 denied even the initial upsert with SQLSTATE `42501`. The earlier targeted tests did not cover these paths. |
| Corrected reaction privileges | **PASS — synthetic only** | Candidate grants UPDATE only on `reaction_type` and `updated_at` on each reaction table. Both initial inserts and conflict updates succeeded; updating another reaction column was denied. Real application/schema integration remains untested. |
| `PUBLIC` and role membership | **PASS — synthetic only; target BLOCKED** | Default `PUBLIC` database TEMPORARY and routine EXECUTE each made the candidate abort. Added `PUBLIC` table, column, view and sequence grants were detected; membership was rejected even for a NOINHERIT role. Actual target privileges and role memberships were not inspected. |
| Table, sequence and routine ownership | **PASS — synthetic only; target BLOCKED** | Candidate rejects runtime ownership of public relations, routines, types, schema or current database. An owned test table caused an abort. Actual owners are unknown; a restored snapshot made with `--no-owner` cannot establish them. |
| `public` default privileges | **PASS — synthetic demonstration; target BLOCKED** | Granting a creator's default SELECT to `PUBLIC` gave access to a subsequently created table. The owner must inspect global and `public` defaults for every creating role; a null/absent ACL does not eliminate built-in `PUBLIC` defaults. Candidate does not alter or ensure future default ACLs. |
| Custom function EXECUTE | **PASS — synthetic only; target BLOCKED** | Default `PUBLIC` EXECUTE was detected; after its test-only revocation, an existing trigger and identity insert succeeded without direct function or sequence privileges. Revoking `PUBLIC` may break other direct callers or trigger creation; real callers and signatures require owner review. |
| All 28 tables and source usage | **BLOCKED** | Historical snapshot reported 28 tables: 23 in the grant lists, 5 with no direct grants. This follow-up used 23 named synthetic tables and five placeholders, not the actual 28-table schema. Static review found the reaction omissions; actual object names, column ACLs, RLS, triggers, cascades and every application path must be checked on a faithful disposable restore. |
| `wallet_transactions` / excess matrix rights | **PASS — synthetic only; target BLOCKED** | Effective UPDATE and DELETE were denied on the synthetic ledger; TRUNCATE and an extra reaction-column update were also denied. Candidate asserts table and column privileges and rejects unexpected grants on views, foreign tables, sequences and routines. Actual schema and indirect side effects remain unverified. |
| Repeatability and rollback | **PASS — synthetic only; target BLOCKED** | Candidate succeeded twice under unchanged prerequisites. Failed transactions removed a newly created role or preserved previously committed grants. `DROP OWNED` plus `DROP ROLE` removed the newly created test role in the single test database. Restoring an existing role's ACLs, grants by other grantors, or shared `PUBLIC`/default ACLs requires a recorded baseline and has not been rehearsed. |
| Production readiness | **BLOCKED** | The candidate intentionally excludes migration 005 and the `rate_limit_buckets` permissions required by production startup. Owner review, separate migration approval, faithful rehearsal and remaining release gates are required. |

### Test boundaries and owner handoff

The test created a new loopback-only, password-authenticated PostgreSQL 18.6 cluster with a randomly selected port and a synthetic database. The SQL candidate was extracted from [database-permissions.md](./docs/database-permissions.md), with only its database-name guard replaced for that disposable database. Test-only changes to `PUBLIC`, default privileges, memberships and ownership were confined to this cluster. The test stopped and removed the cluster after completion; no source dump or data was used.

The earlier `--no-owner --no-acl` restore could demonstrate application behavior under its own test grants, not the original target's effective permissions, ownership or default ACLs. Its earlier wallet and workflow results remain historical evidence only. The final candidate SQL, owner inventory queries, default-privilege cautions, explicit `PUBLIC` impact, and rollback steps are in [database-permissions.md](./docs/database-permissions.md). The candidate is for owner consideration, **not authorized for application**. In particular, standard `PUBLIC` TEMPORARY and function EXECUTE can cause a deliberate abort; the owner must decide any shared-privilege changes separately after assessing all consumers.

## Runtime-role and reaction regression follow-up — 2026-11-11

**Overall: BLOCKED — not production-ready.** Reaction behavior and the proposed role grants passed the focused synthetic rehearsal, but target ACLs, ownership, default privileges and the actual reaction schema were not inspected. No connection to the configured database, migration 005, production grant, credential or secret change, full QA run, or business-rule change occurred.

| Check | Result | Evidence |
|---|---|---|
| Reaction source audit | **PASS** | Two reaction upserts, in `routes/reactions.js`, target `comment_reactions` and `review_reactions`. Both update only `reaction_type` and `updated_at`. Related eligibility reads use `comments`/`reviews`, `chapters` and `novels`. Other source upserts are `reading_history` and the out-of-scope migration-005 rate limiter. |
| Old matrix negative test | **PASS — failure reproduced** | With reaction UPDATE column grants removed, the real comment and review PUT handlers both returned 500 and PostgreSQL `42501`, even for initial inserts. |
| Corrected reaction regression | **PASS — synthetic only** | The actual reaction router executed initial `like`, conflict update to `dislike`, timestamp refresh, invalid input, missing/draft/suspended target and delete paths. Tests confirmed only the two required UPDATE columns were effective and other reaction columns and table-wide UPDATE were denied. |
| Runtime role and ledger | **PASS — synthetic only** | The candidate executed twice against 23 named tables plus five placeholders. A test session used `SET ROLE noveltail_runtime`; ledger INSERT succeeded, while UPDATE, DELETE and TRUNCATE returned `42501`, and no ledger column had UPDATE. A synthetic identity and wallet trigger worked without direct sequence or function grants. |
| Effective privileges | **PASS — synthetic only** | Candidate rejected default `PUBLIC` TEMPORARY and function EXECUTE, role membership, and injected `PUBLIC` wallet UPDATE. Test-only revocations of `PUBLIC` were confined to the synthetic cluster. A failed rerun preserved previously committed role grants. |
| SQL rollback | **PASS — new synthetic role only** | The documented transaction refused a role with object ownership or membership; after removing those test conditions it removed the new role and its grants without dropping fixture tables or ledger rows. Grant/rollback could then be repeated. A pre-existing role's exact ACL and shared privileges were not restored or tested. |
| Live ACL, ownership, defaults and 28-table schema | **BLOCKED** | No target connection or source snapshot was used. The synthetic fixture cannot establish actual reaction unique indexes, RLS, triggers, foreign keys, owner identities, inherited privileges or defaults. |
| Production readiness | **BLOCKED** | Owner inventory, faithful disposable restore, approval and remaining release gates are outstanding. Production's rate-limit table and its grants remain outside this pre-005 candidate. |

### Execution boundary

PostgreSQL 18.6 was initialized as a new, password-authenticated, loopback-only cluster on a random port and removed after the tests. The candidate grant and rollback SQL were extracted from [database-permissions.md](./docs/database-permissions.md), changing only the database-name guard to the disposable name. The HTTP regression loaded the actual reaction router with a test user injected instead of authentication; it did not test a real runtime login, CSRF, the complete server, the real schema or other application workflows. The synthetic database used an administrator session with `SET ROLE`; this checks effective rights as `noveltail_runtime`, not login configuration. No real credentials or secrets were loaded or modified.

The final owner SQL, guarded new-role rollback, and pre-approval ACL/ownership/default-privilege inventory are in [database-permissions.md](./docs/database-permissions.md). An existing role's rollback requires its captured per-grantor baseline; do not use the new-role removal SQL for it.

## Live Noveltail permission preflight — 2026-11-11

**Overall: BLOCKED — not production-ready.** The current application database identity is a superuser and can mutate the wallet ledger. `noveltail_runtime` does not exist. Current `PUBLIC` privileges would cause the proposed runtime-role SQL to abort, and no new role was created to test its effective privileges.

### Identity and read-only boundary

| Item | Observed |
|---|---|
| Database / configured host / server / port | `Noveltail` / `localhost` / `::1` / `5432` |
| Current user / session user / schema | `postgres` / `postgres` / `public` |
| PostgreSQL / search path | `18.6` / `"$user", public` |
| Transaction | `REPEATABLE READ`, `transaction_read_only=on`, `default_transaction_read_only=on` |
| Final snapshot | 2026-11-11 20:33:58.126 +07:00 |

Each connection set the session default to read-only before starting a read-only transaction. After verifying identity, queries read PostgreSQL catalogs only; savepoints isolated any potential catalog-query errors and the transaction was rolled back. All final catalog sections succeeded. No application table rows were queried, and no role, grant, credential, secret, object, migration, data or deployment was changed. Full QA was not run.

The complete point-in-time role attributes, membership edges, object owners, raw and expanded ACLs with grantors, effective current privileges, default ACLs, sequence dependencies, and reaction/ledger catalog definitions are recorded in [runtime-permission-baseline.json](./runtime-permission-baseline.json). It contains infrastructure and permission metadata, not passwords or application rows; restrict access appropriately. SHA-256: `1B9CCCE1B8CDE45AF8F5B124B962E228726CDE53FB477DD4003DA76051BAE440`. Capture a separate after-change snapshot; do not overwrite this baseline.

**Correction from the final rehearsal:** the original baseline's expanded `relation_acl` entries for sequences are incomplete: `acldefault('S', ...)` describes a foreign server, not a sequence. Its raw sequence ACLs and `effective_sequences` results remain unchanged. The separate [corrected baseline](./runtime-permission-baseline-corrected.json) expands the 20 NULL sequence ACLs using `acldefault('s', ...)`, verified on the PostgreSQL 18.6 disposable restore; all other source fields are retained. The original is preserved for audit. Corrected SHA-256: `26E41D24E4B916CD89C69602511386E8FC655BFE8FB8230AA60F2CA197CEBC05`.

### Results

| Check | Status | Actual evidence |
|---|---|---|
| Current identity | **FAIL** against runtime policy | `postgres` has LOGIN, SUPERUSER, CREATEDB, CREATEROLE, REPLICATION and BYPASSRLS; it owns the database and is the configured application database user. |
| Proposed runtime role | **BLOCKED** | No `noveltail_runtime` role exists. Its actual login, membership and effective grants cannot be tested until separately approved provisioning. No hypothetical future access is presented as an observed role. |
| Memberships | **PASS — inventoried** | No explicit membership edge has `postgres` as member. The three recorded edges are `pg_monitor` membership in `pg_read_all_settings`, `pg_read_all_stats` and `pg_stat_scan_tables`. The database owner also has implicit `pg_database_owner` membership; superuser status independently bypasses normal privilege checks. |
| Database and schema `PUBLIC` ACL | **FAIL** against candidate prerequisite | `PUBLIC` has database `CONNECT` and `TEMPORARY` from built-in defaults, and `public` schema `USAGE` but not `CREATE`. The candidate forbids effective TEMPORARY; without a separately approved resolution it would abort. |
| Tables, sequences and columns | **PASS — inventoried** | There are 28 public tables and 20 sequences, all owned by `postgres`; no views, materialized views, foreign tables or other user schemas were observed. Table and sequence ACLs are NULL/built-in owner defaults, with no `PUBLIC` object grants and no explicit column ACLs. All 20 sequence dependencies are identity columns (`GENERATED BY DEFAULT`); the current superuser has USAGE, SELECT and UPDATE on all 20. |
| Functions | **FAIL** against candidate prerequisite | One public routine, `create_user_wallet()`, is owned by `postgres`, is not SECURITY DEFINER, and has default `PUBLIC EXECUTE`. The enabled `users_create_wallet` trigger calls it. The candidate requires no effective routine EXECUTE and therefore would also abort unless this is separately resolved. This is a trigger function, not an ordinary SQL-callable function; revocation can prevent other users from creating triggers that invoke it. Existing trigger execution alone does not establish safety for every consumer. |
| Default privileges | **PASS — inventoried** | No `pg_default_acl` entries were present for global or `public` scope. This does **not** mean no defaults: built-in defaults include `PUBLIC EXECUTE` on new functions. |
| Reaction schema | **PASS — structural** | Both tables have `user_id`, their target ID, `reaction_type`, `created_at` and `updated_at`. Their non-deferrable primary keys `(user_id, comment_id)` and `(user_id, review_id)` have valid, ready, immediate unique indexes appropriate for the source conflict targets. Both CHECK constraints allow `like`/`dislike`; required columns are NOT NULL. No user-defined triggers were found on these tables and RLS is off. Actual upserts were not executed on live data. |
| Reaction permissions | **FAIL** for current user; **BLOCKED** for proposed role | `postgres` has table-wide UPDATE on both reaction tables and UPDATE on every column, broader than the two-column proposal. The proposed role is absent, so its effective privileges and live upserts are unverified. |
| Wallet ledger | **FAIL** for current user; **BLOCKED** for proposed role | `postgres` has SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES and TRIGGER on `wallet_transactions`, plus UPDATE on every ledger column. RLS is off and no user-defined ledger trigger was found. The proposed role is absent. The `user_id` foreign key uses `ON DELETE SET NULL`, so permitted deletion of users by another actor can also change ledger rows indirectly; the proposed matrix does not grant runtime DELETE on `users`. |
| Schema/matrix comparison | **FAIL** for current user | All 23 named tables exist; the five outside the matrix are `chapter_revisions`, `comment_mentions`, `novel_follows`, `novel_likes`, and `novel_revisions`. The current superuser has all four table-level DML rights on all 28 tables: 41 table-level DML privileges exceed the candidate's table-level lists, including broad reaction UPDATE and ledger UPDATE/DELETE. It also has TRUNCATE, REFERENCES and TRIGGER on all 28. Reaction column grants are additional intended privileges, not table-wide UPDATE. |
| Migration 005 | **PASS — absent** | `public.rate_limit_buckets` was not present in the catalog snapshot. No migration was applied. |

### Required owner decisions before approval

1. Rehearse the final candidate and rollback on a faithful, isolated restore, including actual reaction upserts, ledger boundaries and comparison against this baseline. Separately approve creation and configuration of a non-owner, non-superuser runtime login; never change the existing administrator's grants as a shortcut.
2. Assess all database consumers before deciding how to address `PUBLIC TEMPORARY` and `PUBLIC EXECUTE` on `create_user_wallet()`. The present candidate deliberately does not revoke either and would fail its checks. Review trigger creation and other dependent administrative workflows, future function defaults, and per-creator default privileges; do not assume changing shared privileges is harmless.
3. Verify effective `PUBLIC`, membership, ownership, table/column/sequence/function and grant-option permissions again after any separately approved change. Confirm the runtime role cannot mutate ledger rows directly or indirectly, and that its reaction rights match the two-column matrix.
4. Handle migration 005 and the production shared-rate-limit grants through a separate approved workflow. This preflight does not approve any role, credential, grant, migration or deployment.

## Final runtime-role rehearsal on disposable restore — 2026-11-11

**Overall: BLOCKED — not production-ready.** All requested application workflows passed on the restored schema after **test-only** changes to two `PUBLIC` privileges. Against the unchanged live-baseline ACLs, the candidate SQL deliberately aborts. The new-role rollback restores effective relation privileges in the rehearsal but does **not** restore the original raw NULL ACL representation. Neither result authorizes a live change.

### Isolation and fidelity

The configured source identity was rechecked as `Noveltail` / `::1:5432` / `postgres` / `public` in a read-only transaction. `pg_dump --schema-only` ran with `default_transaction_read_only=on`; archive inspection found no table data, sequence state or blobs. A new loopback-only PostgreSQL 18.6 cluster restored that archive **without** `--no-owner` or `--no-acl`. No production rows or personal data were copied: all application fixtures were synthetic.

Before any test grant, the restored 28 tables, 20 sequences and one public function matched the live preflight's raw object ACLs and owners; the database/schema ACLs and global/`public` default ACLs matched too. Reaction and ledger columns, indexes and constraints matched after normalizing four equivalent PostgreSQL CHECK cast renderings. Migration 005 was absent and was not applied. The isolated administrator used a newly generated test-only password; a temporary loopback HBA `trust` rule was limited to the test role and test database. Therefore a real `noveltail_runtime` database login was exercised, but production password/TLS authentication was not. The cluster, temporary credential, synthetic rows and schema archive were removed after the run. No live role, grant, credential, secret, object or row was changed.

### Results

| Test | Result | Evidence |
|---|---|---|
| Restore / ACL / ownership / default privileges | **PASS** | Matched the recorded baseline as described above; no source table data was copied. |
| Candidate on unchanged baseline | **FAIL — expected guard** | Unchanged `PUBLIC TEMPORARY` made the documented SQL abort; after removing that privilege only on the disposable database, unchanged `PUBLIC EXECUTE` on `create_user_wallet()` independently made it abort. The failed transaction did not create the role. |
| Candidate after test-only prerequisites | **PASS, conditional** | After separately revoking those two `PUBLIC` privileges **only in the disposable cluster**, the exact documented SQL, with its database-name guard changed for that cluster, created `noveltail_runtime` and succeeded on a second run. |
| Login and registration | **PASS** | Application registration and login passed using synthetic users under a real disposable runtime login. |
| Wallet and simulated top-up | **PASS** | Restricted-role wallet operations and top-up, including idempotent retry, passed. |
| Chapter unlock / refund / revenue split | **PASS** | Concurrent unlock and refund checks passed; the existing 90/10 allocation and reversals were preserved, including the test's rounding for a price of 5. |
| Reaction upsert | **PASS** | The actual authenticated application routes inserted `like`, updated the existing comment/review reaction to `dislike`, validated input and deleted reactions on the restored schema. |
| Notifications / Appeals / Reports / Admin | **PASS** | The focused integration and Reports/Announcements tests passed, including authorization and notification checks. Total: 4 test cases passed, 0 failed; no full QA suite was run. |
| Effective permissions, `PUBLIC` and membership | **PASS, conditional** | Independently checked all 28 tables and every UPDATE column, plus table/column grant options, sequences, functions, database TEMPORARY, schema CREATE and role membership after the test-only adjustments. The runtime role had no memberships. An injected disposable `PUBLIC` ledger UPDATE was detected and the candidate transaction aborted. |
| Ledger and DDL denial | **PASS** | UPDATE/DELETE on `wallet_transactions`, and CREATE/ALTER/DROP/TRUNCATE attempts by the runtime login all returned SQLSTATE `42501`. |
| New-role rollback, effective ACLs | **PASS, limited** | The documented new-role rollback removed the role. Expanded effective relation ACL entries matched the pre-role state. The separately test-adjusted database/function `PUBLIC` entries were then restored semantically to the initial baseline. |
| Exact rollback of raw ACLs | **FAIL** | After role removal, all 28 tables and 20 sequences had explicit owner ACLs rather than the original NULL representation. Separately restoring test-only `PUBLIC` grants also left explicit database/function ACLs instead of their original NULLs. Effective expanded privileges matched, but the raw catalog baseline was not restored exactly. A reused role's per-grantor baseline was not tested. |
| Live approval / production authentication | **BLOCKED** | The live runtime role was not provisioned; production authentication, owner-approved shared `PUBLIC` decisions, exact ACL rollback requirements, migration 005 and other release gates remain outstanding. |

### Verified matrix and owner handoff

The tested matrix grants SELECT on 23 tables, INSERT on 22, table UPDATE on 14, UPDATE only on `reaction_type` and `updated_at` on each reaction table, and DELETE on 12. Five other public tables receive no direct runtime table grant. No runtime sequence privilege, public routine EXECUTE, table TRUNCATE/REFERENCES/TRIGGER or grant option is allowed. `wallet_transactions` is SELECT/INSERT only; the `users` foreign key's `ON DELETE SET NULL` remains an indirect ledger risk for other actors with user-delete rights.

The candidate SQL, complete table lists, and new-role rollback are in [database-permissions.md](./docs/database-permissions.md). The owner must decide separately whether and how to change the two shared `PUBLIC` privileges after assessing all consumers, and whether an effective-equivalent rollback is acceptable when raw ACLs differ. Restore an existing role from its captured per-grantor baseline rather than using the new-role rollback. No production-ready claim follows from this rehearsal.

## Focused PUBLIC ACL and raw rollback analysis — 2026-11-11

**Overall: BLOCKED — not production-ready.** This section supersedes the prior rollback result for the **revised proposal only**; the earlier result remains historical evidence for the earlier SQL. [Owner decision](./docs/database-permissions-owner-decision.md) lists all 48 objects, per-privilege PUBLIC state, matrix rights, risks, revoke impacts, recommendations, optional shared-PUBLIC SQL and decisions. [Database permissions](./docs/database-permissions.md) contains the revised role SQL and new-role rollback.

### Evidence and isolation

No Noveltail connection was made in this follow-up. The 2026-11-11 read-only baseline recorded 28 tables and 20 sequences, all `relacl = NULL`, owned by `postgres`, with no expanded PUBLIC relation privileges and no explicit column ACLs. PUBLIC had database CONNECT/TEMPORARY, schema USAGE, and function EXECUTE; the baseline recorded no explicit global or `public` default ACL rows. No runtime role existed in that baseline. This is a dated observation, not a current-state assertion.

Only a newly initialized loopback-only PostgreSQL 18.6 cluster was used. Its synthetic schema reproduced the 28 object names, 20 identity-sequence names, raw relation defaults, and relevant PUBLIC database/function defaults. It used the source wallet trigger function and synthetic registration tables/rows, **not** a full schema restore or production data. The real registration route used an isolated PostgreSQL session under `SET ROLE noveltail_runtime`, rather than a production credential or independent runtime login. The test stopped and removed the disposable cluster. It did not apply migration 005, run full QA, change application business rules or change live grants, credentials or objects.

### Focused results

| Check | Result | Evidence / limitation |
|---|---|---|
| PUBLIC inventory | **PASS, dated** | No PUBLIC grants on the 28 tables or 20 sequences; no PUBLIC column ACL was recorded. The object-by-object inventory is in the owner decision. Other roles' effective access and current live drift need renewed review. |
| Raw and expanded baseline capture SQL | **PASS, scoped** | The documented read-only inventory queries ran on the disposable cluster and distinguished sequence owner defaults from PUBLIC, while identifying database TEMPORARY and function EXECUTE for PUBLIC. The expanded output alone is not a membership or future-default calculation. |
| Candidate on recorded shared defaults | **PASS — expected denial** | The transaction rejected PUBLIC TEMPORARY; after the test-only TEMPORARY revoke, it independently rejected PUBLIC EXECUTE. The failed transaction left no runtime role or raw ACL change. |
| Revised candidate and repetition | **PASS, conditional** | After the two test-only shared revocations, the exact documented candidate, with only the test database-name guard substituted, succeeded twice. Its existing matrix assertions ran on the synthetic objects. The proposal does not sweep-revoke direct grants. |
| Excess direct privilege / membership | **PASS** | A pre-existing runtime DELETE grant on the ledger and a separate membership each caused rejection; neither was silently removed. Reused-role restoration with complex grantors remains untested. |
| Trigger and registration | **PASS, scoped** | With PUBLIC EXECUTE revoked and runtime lacking EXECUTE, the actual registration route inserted a synthetic user and the existing trigger created its wallet. A second disposable role could create a trigger referencing the function before revocation but received SQLSTATE `42501` after it. Other consumers and migrations were not tested. |
| PUBLIC TEMPORARY impact | **PASS, scoped** | A representative consumer created a temporary table before revocation; after revocation, attempts in both its existing session and a new session received `42501`. Roles with other grants and actual workloads were not tested. |
| Ledger restriction | **PASS** | Runtime UPDATE and DELETE attempts on synthetic `wallet_transactions` returned `42501`; no matrix change was introduced. |
| No-commit transaction rollback | **PASS** | Replacing the candidate's final COMMIT with ROLLBACK preserved the tested raw database, schema, function, relation and column ACL snapshots exactly and removed the transaction-created role. This is not post-commit recovery. |
| Post-commit new-role rollback, effective relation ACLs | **PASS, limited** | The documented `DROP OWNED ... RESTRICT` / `DROP ROLE` transaction removed the new role; expanded relation ACL entries matched the pre-candidate snapshot. Post-shared-revocation raw database/schema/function ACLs and all tested column ACLs also matched that pre-candidate state. |
| Post-commit raw ACL equality | **FAIL** | The 23 directly granted tables retained explicit owner ACLs instead of the original NULL. The other five tables and 20 sequences remained NULL; tested column ACLs returned to their prior values. Changing a table to the same owner did not restore NULL. The removed broad REVOKEs had previously materialized all 48 object ACLs; avoiding them reduces but does not eliminate drift. |
| Optional shared-PUBLIC SQL and inverse | **PASS, semantic only** | The exact proposed revoke and inverse transactions executed on the disposable database. Effective PUBLIC TEMPORARY/EXECUTE returned, but the original raw NULL database and function ACLs became explicit. The test does not establish a general exact inverse or restore other grantors. |
| Exact raw recovery after commit / approval | **BLOCKED** | No supported generic SQL inverse was established. An owner-approved, independently tested backup/recovery plan is required if raw equality is mandatory. Never edit system catalogs to force equality. Existing-role recovery and all affected consumers need their own baseline and plan. |

### Root cause and decisions

PostgreSQL interprets a NULL ACL using built-in defaults. A GRANT or even a broad no-op REVOKE can materialize those defaults into an explicit ACL; dropping the role removes its grant but does not necessarily convert the representation back to NULL. Thus equivalent expanded grants are not proof of byte-for-byte raw restoration. Capture both raw nullable values and expanded entries with owners, grantors and grant options, plus column and default ACLs. For rollback, distinguish transaction abort from committed changes; do not assume same-owner ALTER or an inverse GRANT restores raw NULL.

The owner must decide (1) whether to revoke each shared PUBLIC privilege after consumer analysis or approve an exception requiring a new candidate; (2) whether effective equivalence with documented raw drift is acceptable or exact recovery is mandatory; (3) whether the role is new and what per-grantor recovery applies; and (4) whether future function default privileges need a separately reviewed change. At this rehearsal the candidate did not check `rolreplication`; the later transaction proposal adds that check. Until these decisions and remaining release gates are resolved, deployment remains **BLOCKED**.

## Raw ACL post-commit recovery — 2026-11-11

**Overall: FAIL for the requested ACL-only, post-commit raw-exact rollback.** Do not treat effective-equivalent permissions as a pass. A full-cluster physical backup restored the synthetic test baseline exactly in a separate cluster, but it also discarded later data; it is not an ACL-only rollback. Production remains **BLOCKED** and is not production-ready.

### Baseline and cause

The owner inventory in [database-permissions.md](./docs/database-permissions.md) now reads under a repeatable-read, read-only transaction and records object identifiers and each raw ACL's `NULL`, `EMPTY`, or `ENTRIES` state. Preserve the raw arrays, owners, grantors, grant options, role membership, and complete row sets, including missing default-ACL rows; expanded effective privileges are a separate comparison. Exact comparison must distinguish `NULL` from `{}` and from explicit owner entries.

`NULL` means PostgreSQL computes built-in default privileges; it is not an empty ACL. Granting to a role materializes an ACL with explicit entries. Removing that role's grant can leave the owner/default entries explicit, rather than reverting the catalog value to `NULL`. Neither prior same-owner ALTER nor the tested role-removal SQL established a safe supported inverse to restore raw NULL. The old role-removal SQL is withdrawn as an exact rollback; do not modify system catalogs directly.

### Disposable-only verification

No connection to Noveltail was made. A loopback-only PostgreSQL 18.6 cluster used synthetic objects and rows, an isolated administrator and test roles. No GRANT or REVOKE targeted PUBLIC, and its effective entries were compared before and after the role test. The database's raw ACL nevertheless changed when CONNECT was granted to the test role. No migration 005, production credentials, application data or full QA was used.

| Test | Result | Evidence |
|---|---|---|
| Baseline capture | **PASS** | The documented read-only inventory distinguished 46 NULL relation ACLs, one empty ACL and one ACL with explicit entries, including an explicit column ACL and grant option. All values were synthetic; this does not replace the live baseline. |
| Physical backup | **PASS, scoped** | A pre-change `pg_basebackup` completed and `pg_verifybackup` succeeded. The backup and restored server remained isolated on loopback. |
| Apply → commit | **PASS, scoped** | A test transaction applied the unchanged documented matrix grant statements and committed. PUBLIC effective entries remained unchanged. This exercised only the grant block; the complete candidate and its guards were not executed as part of this transaction. |
| Full candidate on unchanged PUBLIC | **BLOCKED, expected** | Its existing guard rejected inherited PUBLIC TEMPORARY; no PUBLIC ACL was changed to make the guard pass. The previous conditional full-candidate rehearsal remains separate historical evidence. |
| Historical role-removal rollback: raw ACL | **FAIL** | After committed grants and role removal, 22 previously NULL granted tables and the database ACL remained explicit. The synthetic explicitly granted table and empty-ACL table retained their original raw ACLs. The real recorded baseline had 23 granted tables with NULL ACLs; this mixed fixture intentionally had one explicitly granted table. |
| Historical rollback: effective privileges | **PASS, limited** | Representative `acl_observer` table, sequence, column, database, schema and function effective privileges, including checked grant options, matched the pre-apply baseline. This does not satisfy the raw-equality requirement. |
| Whole-cluster backup restore | **PASS, isolated recovery only** | A separate cluster started from the verified pre-change physical backup. Exact raw snapshots matched for 83 scoped items: database, `public` schema, 28 tables, 20 sequences, 32 columns and one function. NULL, empty and explicit raw values, object identities, owners, tested role/membership state and representative effective privileges matched; the recorded default-ACL row set was empty in this fixture. The documented inventory result sets also matched. |
| Scope and data loss | **FAIL for ACL-only use** | A synthetic row committed after the backup existed on the source fixture but was absent from the recovered cluster. The recovery replaces cluster state and can lose changes across all databases, not just ACLs. It was not a cutover or recovery of Noveltail and is not approved for that purpose. |

Both disposable clusters and the temporary backup were stopped and removed. An ACL-only post-commit SQL solution that preserves the required raw values and unrelated state remains unverified; the candidate remains blocked. Any real whole-cluster recovery would require an independently verified backup/WAL recovery point, exact comparison across all affected objects and databases, explicit owner approval, and an acceptable data-loss and cutover plan.

## Transactional permission deployment and forward recovery — 2026-11-11

**Overall: BLOCKED — design and scoped rehearsal only; not production-ready.** [The transaction design](./docs/runtime-permission-deployment.md) separates baseline, deployment, validation and forward-recovery SQL. It requires the runtime role to be absent in the baseline and does not use physical restore. It restores effective permissions, **not** exact raw ACL representation, so explicit owner acceptance is required. The decision-verifying controller, production-safe pre-commit workflows and actual owner decisions are not implemented or approved.

### Disposable-only setup

No Noveltail connection or change occurred. A separate loopback-only PostgreSQL 18.6 cluster used synthetic objects, users and data. Its relation inventory matched the recorded 28 table and 20 sequence names; one table had an explicit grant to a synthetic observer and one had an empty ACL. For the successful-path fixture only, PUBLIC TEMPORARY and EXECUTE on the synthetic wallet trigger function were revoked **inside the disposable cluster** as simulated owner decisions before the test baseline. This does not imply any actual owner approval or change to the live PUBLIC ACL. The original source trigger function and the source reaction-upsert SQL were used; no migration 005, production credentials, real data, physical restore or full QA was used.

### Results

| Case | Result | Raw ACL / effective privileges and scope |
|---|---|---|
| Current shared PUBLIC defaults | **PASS — expected denial** | The candidate rejected synthetic PUBLIC TEMPORARY; rollback restored the pre-attempt raw ACL and effective snapshot. No owner decision was assumed. |
| 48-object decision gate | **PASS, mock only** | The documented query returned all 28 table and 20 sequence identities and PUBLIC entries. A test-only in-memory decision comparison rejected missing or mismatched records. It is not a trusted signature or an implemented owner-approval controller; actual authorization remains **BLOCKED**. |
| Injected pre-commit failure | **PASS** | After the same-connection grants and fixture workflow checks, an injected SQL error and ROLLBACK restored all captured raw ACLs, expanded ACL entries, role/membership state, observer effective rights and synthetic rows to the test baseline. |
| Successful commit | **PASS, conditional** | Under simulated PUBLIC decisions, the same session executed the complete candidate matrix assertions, assumed the uncommitted runtime role, exercised a synthetic user insert and its wallet trigger, and inserted then updated both reaction types using the source upsert SQL. A savepoint removed fixtures before commit. Ledger UPDATE/DELETE were denied. Another session could not see the uncommitted role. |
| Commit comparison | **PASS, scoped** | At commit, raw ACLs differed on 23 tables, four reaction columns, the database and schema. The pre-existing observer's checked effective privileges and all non-runtime expanded ACL entries were unchanged; the candidate's full runtime table/column/sequence/function assertions passed. The synthetic user sequence and business fixtures were unchanged by pre-commit probes. |
| Unexpected recovery drift | **PASS — expected denial** | A test-only extra TRUNCATE grant left a dependency, so `DROP ROLE` failed; rolling back the recovery transaction preserved the entire pre-recovery snapshot, including the unexpected grant. Production must stop earlier on controller-detected drift. |
| Forward recovery | **PASS, scoped** | The documented targeted revokes and role removal ran in one transaction. Before COMMIT, expanded ACL entries including grantors and grant options, role/membership state, PUBLIC entries for all 48 objects and representative observer effective rights matched the pre-deployment baseline. A synthetic business row committed after deployment remained intact. |
| Recovery raw ACL comparison | **FAIL for raw-exact equality; expected** | Effective privileges matched, but 22 formerly NULL granted tables retained explicit owner ACLs. The explicitly granted table and empty-ACL table retained their baseline values; the other captured objects and columns matched. This mixed synthetic baseline is not the real baseline, where all 23 granted table ACLs were NULL. |
| Repeatability and fresh-role gate | **PASS, scoped** | The standalone grant body was rerun under unchanged disposable prerequisites without ACL changes; the new deployment gate refused to treat an existing role as a fresh deployment. |
| Real login and full workflows before COMMIT | **BLOCKED** | `SET LOCAL ROLE` on the owner's connection is not a separate runtime login, TLS/password check, or multi-session application flow. An uncommitted role is invisible to another connection. Synthetic savepoint writes are not safe to run on the real database: sequence and external effects need not roll back. |

The disposable cluster and test credentials were removed. The test did not exercise an existing runtime role, multiple grantors for that role, other-database role dependencies, non-cooperating administrators, or a connection loss during COMMIT. Recovery requires owner-approved change isolation, baseline and decision verification, draining runtime sessions, reconciliation of uncertain commits, and post-recovery effective checks before commit. It must not be used if the owner requires raw-exact post-commit ACLs.

## Final owner decision and deployment preparation — 2026-11-11

**Overall: BLOCKED — not production-ready.** The [final decision sheet](./docs/runtime-permission-final-owner-decision.md) recommends specific choices for the 48 PUBLIC objects, database TEMPORARY and wallet-function EXECUTE; analyses the 22 synthetic raw-ACL differences; defines verifiable acceptance criteria; and gives pre/post-commit and forward-recovery checklists. Recommendations are not owner approvals. No database was contacted or changed, and no rehearsal or full QA was rerun for this review.

| Item | Status | Evidence / remaining gate |
|---|---|---|
| PUBLIC table and sequence inventory | **PASS, dated** | The recorded baseline had no PUBLIC rights on all 28 tables and 20 sequences. Keep that absence; do not blanket-revoke. All 48 decisions, fresh identities and current ACLs still need owner verification. |
| Shared PUBLIC TEMPORARY and function EXECUTE | **BLOCKED** | Recommend separately revoking each only after consumer analysis and approval. Prior disposable registration succeeded through the existing wallet trigger without PUBLIC EXECUTE; creating a new trigger required EXECUTE. No owner decision or shared change occurred in this review. |
| Raw ACL drift | **FAIL for exact equality** | The latest mixed synthetic fixture retained explicit owner ACLs on 22 formerly NULL tables. The historical Noveltail baseline instead had NULL on all 23 directly granted tables. Conditional acceptance now additionally requires a named refreshed-baseline allowlist, exact owner-default arrays, identities, owners, grantors, grant options, role paths, PUBLIC/default/column ACLs, RLS and trigger checks, and independently reviewed evidence; effective equality alone is insufficient. |
| Transactional validation and forward recovery | **PASS, scoped rehearsal / BLOCKED for deployment** | Prior synthetic tests exercised same-session SET ROLE, trigger and reaction upserts, transaction failure, committed grants and targeted forward recovery preserving a later synthetic business row. The real owner-decision verifier, production-safe pre-commit workflows and recovery authorization are missing. |
| Post-commit smoke | **BLOCKED** | A proposed read-only runtime SQL smoke checks identity and representative permissions without business DML. It has not been run with a real runtime credential or target TLS; application login and startup are not demonstrated by the SQL check. |
| Production application | **BLOCKED** | Production configuration requires the PostgreSQL rate-limit store and its startup guard queries `public.rate_limit_buckets`; the current candidate explicitly rejects that migration-005 table. Starting the app also starts the announcement scheduler, and authenticated flows can restore suspensions. Migration 005, production startup and their grants require a separate approved plan and are not applied here. |
| Final SQL handoff | **BLOCKED** | The previously rehearsed SQL fragments and new checklist are documented, but no integrated approval-verifying controller or approved safe complete pre-commit workflow exists. They are not a ready-to-run production script; owner approval alone does not close those gates. |

Owner approval is required for the recommended D1–D7 choices, especially the shared PUBLIC changes, the narrowly bounded raw-drift criterion, fresh-role scope, change freeze and safe validation/recovery procedures. Physical restore is not the permission-recovery method in this proposal.

## Final deployment blocker resolution — 2026-11-11

**Overall: BLOCKED — not production-ready.** This follow-up did not connect to Noveltail, alter a real database, change real credentials, apply migration 005, deploy, change business rules or run full QA. Tests used a newly initialized loopback-only PostgreSQL 18.6 cluster, a synthetic `Noveltail` database, synthetic roles and rows, and a random test-only password. The harness verified its data directory and port before creating fixtures, stopped its own server and removed its temporary cluster. No real data was copied.

| Item | Status | Evidence / qualification |
|---|---|---|
| 48 PUBLIC objects | **PASS, synthetic / BLOCKED, target** | The [per-object inventory](./docs/database-permissions-owner-decision.md#forty-eight-object-inventory) recommends retaining the recorded absence on all 28 tables and 20 sequences, without blanket/no-op revokes. Current live identities and privileges require a fresh authorized baseline and individual owner decisions. |
| PUBLIC TEMPORARY and EXECUTE | **PASS, synthetic / BLOCKED, approval** | Only database TEMPORARY and the exact `create_user_wallet()` EXECUTE were revoked in the disposable fixture. Runtime lost both rights, an unrelated function kept PUBLIC EXECUTE, the existing trigger created a wallet with the matrix's users INSERT and wallets SELECT/INSERT, and creating a new trigger using the revoked function failed. Other real consumers and migration identities were not tested. See the [scoped open-transaction proposal](./docs/database-permissions-owner-decision.md#current-scoped-public-proposal--approval-required). |
| Raw ACL exact restoration | **FAIL, unchanged criterion** | After committed role grants and role removal, 22 synthetic tables remained NULL-to-explicit; raw ACL equality was not restored. No physical restore or repeated attempt to force exact raw rollback was used. |
| Raw drift analysis | **PASS, scoped synthetic evidence / BLOCKED, acceptance** | Each of the 22 explicit arrays equalled its original owner's default. All other relation raw ACLs, expanded grantor/grantee/privilege/grant-option sets, owners, memberships, default ACLs and effective table privileges for three fixture roles matched baseline. Changing default ACLs did not change any existing relation; subsequent identical grants and ownership transfers were compared on all 22 against an untouched reference. This does not prove live safety or every principal. The [acceptance criteria](./docs/runtime-permission-final-owner-decision.md#measurable-acceptance-after-forward-recovery) still require independent reviewers, a fresh complete baseline, exact allowed arrays, other raw ACLs, owners, role paths, PUBLIC, RLS and triggers. |
| Signed approval checks | **PASS, prototype / BLOCKED, enforcement** | Six focused Node tests passed. The verifier checks Ed25519 signatures, expiry, fresh-capture hash and identities, the pinned candidate/matrix, all 48 signed object decisions and shared PUBLIC state, the named drift policy, migration observation and pinned new-role recovery. Forged/expired approvals, changed evidence, extra SQL, missing decisions, existing role and recovery changes were rejected. Changing a report status cannot make the verifier authorize deployment: it never reads the report and always returns `deploymentAllowed: false`. |
| Deployment controller | **BLOCKED** | The verifier accepts inputs from its caller, has no protected production key or two-reviewer enforcement, and is not connected to a mandatory same-session controller. The standalone SQL remains executable by an administrator. A report-only edit cannot authorize through the prototype, but access to direct SQL, caller, code, key or credentials can bypass it. Complete effective/grantor-aware post-grant and recovery checks, same-transaction freshness and production-safe workflow validation remain unimplemented. |
| Migration 005 dependency | **PASS, source analysis / BLOCKED, deployment** | Production requires the PostgreSQL rate limiter and startup reads its table; the existing pre-005 candidate rejects the table. The migration file has its own transaction boundary and must not be embedded in the permission transaction. A proposed separate migration owner and narrowed limiter grants are documented; owner approval, actual migration state/schema verification, a reviewed post-005 29-table candidate and rehearsal are missing. |
| Limiter rights | **PASS, synthetic lookalike only** | A manually created synthetic table, not migration 005, supported initial/conflict upserts and cleanup with column SELECT/INSERT, UPDATE on `hits, expires_at`, and table DELETE; UPDATE of `bucket_key` was denied. Table-wide DELETE can remove unexpired counters and needs explicit owner acceptance. |
| SQL and recovery handoff | **BLOCKED** | The pre-005 [candidate](./docs/database-permissions.md#owner-operated-sql-template), [targeted forward recovery](./docs/runtime-permission-deployment.md#4-post-commit-forward-recovery-sql), scoped PUBLIC proposal and limiter grants are review fragments, not an executable production bundle. Post-commit raw-exact recovery remains unavailable. |

Focused commands: `node --test tests\runtime-permission-approval.test.js` (6 passed) and `node scripts\test-runtime-permission-blockers.js` (synthetic PostgreSQL checks above). An initial synthetic trigger test omitted the matrix's wallets SELECT and correctly failed with permission denied; adding that existing matrix privilege to the fixture made the focused test pass. No application permission or business rule was changed to obtain this result.

Before any real change, the owner must explicitly approve: (1) every refreshed PUBLIC object decision and the two separate shared revocations after consumer/trigger-creator inventory; (2) the precise raw-drift criterion and reviewers; (3) the protected signing key, mandatory controller, change freeze, baseline and forward-recovery authority; (4) a separate migration owner and migration 005 change; (5) the proposed limiter rights, including table-wide DELETE, and a revised post-005 matrix; and (6) safe pre-commit validation, post-commit smoke and recovery procedures. Any missing approval or failed check remains **BLOCKED**.

## Approved restricted raw ACL drift — 2026-11-11

This section supersedes the earlier unapproved-drift status. The Project Owner approved the restricted policy, **not production deployment**. This update did not connect to or alter the real Noveltail database, change real credentials or PUBLIC rights, apply migration 005, enable a production gateway, change business rules or run full QA. All database operations below used an isolated synthetic PostgreSQL 18.6 cluster, synthetic roles and rows; its identity was checked and its temporary files removed.

| Area | Status | Evidence / remaining limitation |
|---|---|---|
| Decision | **PASS / APPROVED** | Only individually allowlisted baseline NULL-to-exact-original-owner-default table ACL drift is approved, subject to unchanged existing-role effective rights, grantors/grantees/privileges/options, ownership, memberships, defaults and other scoped raw ACLs. The allowlist must be based on a fresh actual baseline, not a fixed count. |
| Implementation | **PASS, disposable / BLOCKED, production** | [Recovery verification](./scripts/runtime-permission-recovery.js) captures the full scoped privilege matrix for all pre-existing roles, checks the runtime matrix and potential unapproved drift before commit, and compares post-commit evidence before recovery and recovered evidence before its commit. Its recovery transaction rolls back on mismatch. The production gateway, protected evidence/signature binding, change freeze and real target allowlist are absent. |
| NULL, EMPTY and ENTRIES | **PASS, synthetic** | The fixture included 46 NULL relation ACLs, one EMPTY ACL and one pre-existing explicit ACL. After committed candidate and recovery, only 22 baseline-derived, allowlisted NULL table ACLs were explicit owner-default; the number is fixture-specific and is not hardcoded in verification. All other scoped raw ACLs and expanded entries matched. |
| Existing roles / runtime | **PASS, synthetic** | For every baseline `pg_roles` role, scoped effective database, schema, table, column, sequence and function privileges and grant options matched after recovery; owners, memberships and default ACLs matched. The candidate and verifier checked runtime permissions, including no ledger UPDATE/DELETE or extra MAINTAIN. |
| PUBLIC CONNECT / schema USAGE | **PASS, synthetic** | Historical PUBLIC rights make direct runtime grants redundant. The revised candidate and recovery do not add/remove direct CONNECT or USAGE; effective rights were preserved. If either PUBLIC right was absent, the candidate failed and the transaction was rolled back. No PUBLIC grant was changed on the real database. |
| Pre-commit failure | **PASS, synthetic** | Injected ledger UPDATE and unexpected direct/PUBLIC grants, owner change and grant-option escalation were rejected before commit; transaction rollback reproduced the exact raw and effective baseline. A missing allowlist entry was also rejected before commit. |
| Forward recovery | **PASS, synthetic** | Candidate → COMMIT → verified recovery passed; a synthetic business row inserted after deployment COMMIT remained. Unexpected direct/PUBLIC grants, owner change and grant-option escalation caused recovery to stop and roll back without committing. A too-narrow allowlist also caused rollback. Column, database, schema, sequence, function, default ACL and membership deviations were rejected. |
| Raw-exact post-commit rollback | **FAIL, unchanged** | PostgreSQL left the allowlisted raw NULL ACLs explicit; this is acceptable only under the newly approved restricted policy and is not raw-exact restoration. No physical restore or direct system-catalog update was used. |
| Actual target / deployment | **BLOCKED** | The actual current ACL, role and membership baseline, approved OID/owner allowlist, trusted evidence, mandatory gateway, safe production workflow and separately authorized recovery remain missing. The existing pre-005 candidate is incompatible with the required migration-005 production schema, which has not been approved for application. |

Focused validation: `node --test tests\runtime-permission-approval.test.js` (6 passed) and `node scripts\test-runtime-permission-blockers.js` (targeted disposable checks passed). The [SQL handoff and limitations](./docs/runtime-permission-deployment.md) remain proposals; neither the signed-approval prototype nor this report permits production deployment.

## Final runtime permission workstream closure — 2026-11-11

**Overall: BLOCKED — not production-ready.** This section supersedes earlier statements that the target had not been refreshed. Target access was limited to identity and catalog SELECTs inside a repeatable-read, read-only transaction ending in ROLLBACK. No business rows were read or exported; no target role, grant, credential, schema, migration or business data was changed. Migration 005 was applied only to a newly initialized loopback-only disposable PostgreSQL cluster; no full QA, E2E, load test or audit was run.

| Area | Decision | Implementation | Verification and limitations |
|---|---|---|---|
| Fresh catalog baseline | Read-only inspection authorized | **PASS**, local timestamped artifact, older files preserved | **PASS** for recorded scope: `Noveltail`, `::1:5432`, `postgres`, `public`, PostgreSQL 18.6, system identifier captured; 28 tables, 20 sequences, 193 columns, 17 roles, three membership edges and 18,054 per-role privilege/grant-option rows. All relation and column raw ACLs NULL; database ACL NULL, schema ACL explicit; owner OID `10` for all 48 relations and the one routine; no global/public default-ACL rows. No PUBLIC grants on the 48 relations or columns. This is a point-in-time pre-005 baseline, not a post-change approval. |
| Candidate drift allowlist | Restricted policy **APPROVED**, not deployment | **PASS** for derivation from captured NULL owner-default ACLs; 23 table OIDs and owners, not a hardcoded count | **BLOCKED** for use: artifact is unsigned, must be independently approved and regenerated after PUBLIC or migration changes. Effective equality alone does not accept drift; grantor, grantee, grant option, ownership, memberships, default and other raw ACL checks remain mandatory. |
| PUBLIC | TEMPORARY revoke and limited unnecessary-function EXECUTE revoke **APPROVED**; no approval to revoke CONNECT or schema USAGE | **PENDING** on target | Current PUBLIC CONNECT, TEMPORARY, schema USAGE and `create_user_wallet()` EXECUTE are present. Its enabled existing trigger targets the SECURITY INVOKER function. Previously passed disposable trigger tests are not repeated. Consumer and trigger-creator inventory and target execution authorization remain necessary; do not blanket-revoke. |
| Wallet and reaction matrix | Existing pre-005 limits retained | **PENDING** on target | The target runtime role is absent, so its effective rights cannot yet be observed. The current `postgres` capture identity is a superuser and can modify the ledger; the role proposal remains ledger SELECT/INSERT only and reaction UPDATE only on `reaction_type` and `updated_at`. Earlier disposable ledger/reaction results were not rerun. |
| Migration 005 / limiter | Separate migration owner **APPROVED**; real apply and limiter grants **PENDING** | **PASS** disposable separate owner; startup guard now checks required limiter INSERT/UPDATE/DELETE in addition to the existing SELECT probe; target implementation **PENDING** | **PASS scoped:** actual 005 file created its table/index on disposable PostgreSQL, actual application store performed first insert and conflict update, and timer-driven expired-row DELETE succeeded under narrowed privileges; UPDATE of `bucket_key` was denied. Removing one required UPDATE made startup validation reject. Production uses table-wide DELETE, which can remove unexpired counters; this risk and revised matrix require separate acceptance. The entire 29-table candidate, real login and post-005 recovery remain unverified. |
| Transaction/recovery | Restricted owner-default drift policy **APPROVED** | **PASS scoped** limiter grant/revoke fixture; integrated post-005 controller **BLOCKED** | **PASS scoped:** explicit pre-commit rollback restored exact table/column raw ACLs and all scoped effective rights. After committed limiter grants, scoped revocation preserved a later synthetic bucket, NULL raw column ACLs and all roles' effective rights; the table ACL was either unchanged or exact owner-default. It did not exercise the whole 29-table recovery or inject a pre-commit failure. Earlier pre-005 injected failures, anomalies and whole-candidate recovery were already verified and not rerun. Raw-exact post-commit restoration remains unavailable. |
| Deployment Gateway | Production authorization **PENDING** | **BLOCKED**: only the existing fail-closed verifier prototype and disposable recovery components exist | **BLOCKED** for the required positive end-to-end approval, negative gateway tests and unknown-COMMIT reconciliation. A caller-controlled public key/snapshot is not a protected trust anchor; direct admin SQL can bypass a local tool. The new sanitized baseline has a different format/hash convention from the prototype snapshot. No enforced official deployment path, trusted evidence binding, transaction controller or post-005 SQL exists. A report edit cannot make the prototype authorize deployment, but that is not gateway enforcement. |

Focused command run once: `node scripts\test-runtime-permission-migration-005.js` — **PASS**, exit 0. The emitted phrase “failed pre-commit equivalent” referred to an explicit rollback, not an injected failure; the harness label was corrected afterward without changing its tested behavior. The test used synthetic roles, rows and an ephemeral password; the disposable cluster was stopped and removed. The previously passing pre-005 anomaly/recovery and signed-verifier suites were not rerun, so their earlier results are historical evidence rather than new post-005 or gateway validation.

The local session baseline `runtime-permission-baseline-2026-11-11T15-54-35-976Z.json` has SHA-256 `e9decf636e4b0d028beaa58142417048f62b9bb24bbe97a38e648501e7c74960`; the local `runtime-permission-allowlist-2026-11-11T15-54-35-976Z.json` has SHA-256 `2fbd6160db1b886db1a35f4f81ea19e25e30ffd9429feedd612a72d1d657cc4d`. Files contain infrastructure catalog metadata, not passwords or business rows, and must be retained in owner-controlled storage. They do not prove current state after this capture or cover other databases. The required complete post-change baseline also needs the schema/trigger/policy/constraint and trusted binding checks that the current sanitized artifact does not fully provide.

**Outstanding owner-controlled actions:** provision an external protected verification key and signing/reviewer process and ensure administrators cannot bypass the official gateway; review and sign the exact refreshed post-change baseline, 48-object decisions and derived OID/owner allowlist; separately authorize the real migration 005, revised limiter rights including DELETE risk, recovery/change-freeze procedure and production deployment. Previously approved TEMPORARY, limited EXECUTE and restricted-drift policies do not need to be decided again. Technical work remains to build and exercise the enforced gateway, integrate and test a post-005 candidate/recovery, verify independent login and implement unknown-COMMIT reconciliation.
