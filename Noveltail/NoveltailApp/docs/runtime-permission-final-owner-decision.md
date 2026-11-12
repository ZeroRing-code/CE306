# Final owner decision: runtime permission deployment

**Production deployment: BLOCKED; production authorization: PENDING.** On 2026-11-11 the Project Owner approved the restricted raw-ACL drift policy below. Policy approval is not authorization for production deployment. A new read-only target baseline and derived pre-005 candidate allowlist were captured on 2026-11-11; they are unsigned, and another baseline is required after any approved PUBLIC or migration changes. No real database was changed, migration 005 applied to the real database, or full QA run for this update.

## Decision register

Decision, implementation and verification statuses are independent. **APPROVED** means the stated policy is approved, **REJECTED** means a policy is not approved, **PENDING** means a decision or action is outstanding, **BLOCKED** means an outstanding condition prevents progress, and **COMPLETED** means the stated scope was implemented or verified.

| ID / topic | Owner decision | Decision status | Implementation status | Verification status | Date / decision maker | Reason and conditions |
|---|---|---|---|---|---|---|
| D2 — PUBLIC TEMPORARY | Approve revocation. | **APPROVED** | **PENDING** | **PENDING** | 2026-11-11 / Project Owner | Inventory affected consumers, provide necessary direct grants, refresh the baseline and approve the change and recovery procedure before execution. |
| D3 — PUBLIC EXECUTE | Approve revocation only for functions shown unnecessary, preserving registration and its trigger. | **APPROVED** | **PENDING** | **PENDING** | 2026-11-11 / Project Owner | Verify each function, callers, trigger creators and migrations; no blanket revoke or unchecked function list. |
| D5 — Raw ACL drift | Approve only the [restricted policy below](#measurable-acceptance-after-forward-recovery). | **APPROVED** | **COMPLETED** for disposable verifier; **BLOCKED** for mandatory production integration | **COMPLETED** on synthetic PostgreSQL; **BLOCKED** on actual target | 2026-11-11 / Project Owner | Only NULL-to-exact-original-owner-default ACL for individually approved baseline objects; every other policy invariant remains mandatory. This does not authorize production. |
| M1 — Migration 005 | Approve separating Migration Owner from Runtime Role; real migration 005 is not approved. | **APPROVED** (separation only) | **COMPLETED** for disposable owner and startup guard; **PENDING** for production | **COMPLETED** for the focused disposable limiter; **BLOCKED** for the complete post-005 deployment | 2026-11-11 / Project Owner | Migration execution, limiter grants and the integrated revised matrix need separate review and approval. |
| P1 — Production deployment | Do not deploy until gates are satisfied; production authorization remains undecided. | **PENDING** | **BLOCKED** | **BLOCKED** | 2026-11-11 / Project Owner | An enforced Deployment Gateway, signed post-change target baseline/allowlist, integrated post-005 candidate and production authorization are missing. |

Other proposals remain **PENDING**, not implicitly approved: D1 (the individual 48-object PUBLIC decisions), D4 (PUBLIC CONNECT and schema USAGE), D6 (the transaction and fresh-role recovery plan), and D7 (future function default privileges). Each also has implementation **PENDING**. Obtain the relevant owner decision before acting.

## Raw ACL drift: 22 disposable tables

In the latest mixed synthetic fixture, the 22 tables below changed from raw NULL to an explicit owner ACL after forward recovery. Expanded entries for the fixture's owner, grantor, privilege and grant-option values matched the pre-deployment snapshot, and checked effective privileges matched. This is **no observed effective privilege change in that fixture**, not proof of live safety. `account_suspensions` had an explicit ACL before the test and is not one of the 22; the historical Noveltail baseline instead had NULL for all 23 granted tables. Never assume a live allowlist of exactly 22.

`S` identifies particularly sensitive consequences **if** an unapproved privilege, grantor, owner or membership change is also present; it does not assert that the raw representation alone created an access vulnerability. `N` means the same rejection checks apply, with no such additional sensitivity classification made here.

| Table | Observed raw change | Consequence of an anomalous ACL, not of verified owner-only drift | Review |
|---|---|---|---|
| admin_action_logs | NULL → explicit | Audit data exposure or alteration | S |
| announcement_recipients | NULL → explicit | Recipient data exposure or alteration | N |
| announcements | NULL → explicit | Unauthorized publication changes | N |
| appeal_assignments | NULL → explicit | Assignment or moderation data access | S |
| appeals | NULL → explicit | Appeal data exposure or modification | S |
| bookmarks | NULL → explicit | Reading activity exposure or modification | N |
| chapter_unlocks | NULL → explicit | Unauthorized access entitlement changes | S |
| chapters | NULL → explicit | Chapter content changes | N |
| comment_reactions | NULL → explicit | Unauthorized reaction changes | N |
| comments | NULL → explicit | Comment data changes | N |
| follows | NULL → explicit | Follow activity changes | N |
| genres | NULL → explicit | Category data exposure or modification | N |
| notifications | NULL → explicit | Notification data exposure or modification | N |
| novel_genres | NULL → explicit | Category association changes | N |
| novels | NULL → explicit | Novel content or moderation changes | N |
| reading_history | NULL → explicit | Reading activity exposure or modification | N |
| reports | NULL → explicit | Report data exposure or modification | S |
| review_reactions | NULL → explicit | Unauthorized reaction changes | N |
| reviews | NULL → explicit | Review data changes | N |
| users | NULL → explicit | Account data exposure or alteration | S |
| wallet_transactions | NULL → explicit | Ledger confidentiality or append-only integrity | S |
| wallets | NULL → explicit | Balance confidentiality or integrity | S |

### Focused drift evidence for every listed table

The latest isolated PostgreSQL 18.6 fixture reproduced all 22 named changes with `account_suspensions` initially explicit. For **each** drifted table, post-recovery ACL was the exact owner-default array; the other 26 relation ACLs were unchanged. Full expanded relation entries (grantor, grantee, privilege, grant option), the fixture roles' table effective privileges, owners, memberships and default-ACL rows matched before and after the role grant/removal. The fixture runtime role did not have ledger UPDATE/DELETE. This confirms only the synthetic fixtures and the checked principals, not every live principal or a complete live recovery.

| Question | Result for all 22 synthetic tables | Required policy conditions |
|---|---|---|
| Default privileges | Changing a creator's default ACL left every existing relation ACL unchanged; a subsequently created table received the new default grant. | Captured global and schema-specific default ACLs and creators must remain exactly unchanged through recovery. Never interpret NULL as a live reference to future defaults. |
| Future grants | After granting the same SELECT to a test principal, each drifted table's expanded entries matched an untouched NULL-ACL reference table with the same owner. | Require the observed owner-default representation without an unexplained additional grant. Future grants must still be individually reviewed; a synthetic equivalence is not a guarantee about other grantors or schemas. |
| Security | Expanded entries and the tested principals' effective permissions were unchanged, including no ledger UPDATE/DELETE for the fixture runtime. | Reject any extra PUBLIC/direct/inherited privilege, grantor or grant option, unexpected membership, RLS or trigger change, or incomplete principal inventory; equal effective privileges alone do not pass. |
| Ownership | Each drifted table and the untouched reference were transferred to the same synthetic new owner; their expanded entries matched after transfer. | Actual recovery must **not** change an owner. Reject any changed owner, OID or identity even when the tested transfer gives equivalent privileges. |

These are focused synthetic observations. The owner must use the freshly captured identities and actual ACL arrays for acceptance; the historical live baseline had 23, not 22, nullable directly granted tables.

### Measurable acceptance after forward recovery

The Project Owner **approved** the restricted drift policy on 2026-11-11. All conditions below are mandatory; otherwise **FAIL / stop**. This policy does not approve any particular real object, authorize production deployment, or accept additional privileges:

1. Capture and preserve a signed, immutable, refreshed pre-deployment raw and expanded baseline plus a post-commit grant-delta snapshot. Identify cluster/database/version and every object's schema, kind, name, OID and owner. Freeze ACL, membership, ownership, schema and default-privilege changes throughout comparison. Verify complete sets, including missing/new objects and absent default-ACL rows.
2. The only permitted raw differences are a **named, owner-approved baseline-derived subset of directly granted tables** whose baseline `relacl` was SQL NULL and whose owner and identity did not change. After recovery each such `relacl` must equal `acldefault('r', original_owner_oid)` **as an ACL array**, not merely grant equivalent runtime privileges. Baseline explicit or empty ACLs must remain exactly equal. The actual count and names must be derived from the refreshed baseline and verified; 22 is not a live expectation.
3. Every other raw ACL must be `IS NOT DISTINCT FROM` baseline: all other tables, all sequences, columns, database, schema, routines and default ACLs. No unexpected role, grant, grantor, grant option, ownership, membership, PUBLIC entry, RLS flag/policy, trigger or function-definition difference is allowed. Check other affected databases and cluster-wide dependencies separately.
4. Compare expanded ACL entries as complete sets **with grantor, grantee, privilege and grant option**, and compare role paths and effective privileges for every inventoried affected principal, including PUBLIC and the prior application identity. Verify ledger UPDATE/DELETE and column UPDATE are absent for the runtime role while it exists. Confirm intended prior application access and audit the result. An effective-privilege match alone is insufficient.
5. Two independently authorized reviewers record the baseline and comparison artifact hashes, the exact allowlisted identities/differences, owner approvals and pass/fail results. The owner separately approves the baseline-derived object allowlist and any actual recovery. Unknown, incomplete, unauthenticated or mismatched evidence is **FAIL**.

The following read-only evidence query helps identify owner-only explicit table ACLs after recovery; it does **not** compare the baseline or implement the other mandatory checks. Compare each returned OID/owner/raw value to the signed baseline; do not infer acceptance from this boolean alone.

```sql
SELECT n.nspname, c.relname, c.oid, c.relowner,
       c.relacl, c.relacl IS NULL AS raw_is_null,
       c.relacl IS NOT DISTINCT FROM acldefault('r', c.relowner) AS explicit_owner_default
FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public' AND c.relkind IN ('r','p')
ORDER BY c.relname;
```

Changing default privileges affects future objects, not existing objects merely because their ACL is NULL. Raw drift can nevertheless invalidate audit assumptions, conceal extra entries or grantors, or mislead later tooling. A real added PUBLIC grant, grant option, inherited role, changed owner, policy or trigger is a security-relevant change and must not be classified as harmless representation drift.

## Pre-commit and post-commit workflow

**Pre-commit, same session:** after the fresh-role gate and candidate grants, run the complete matrix assertions and the [SET LOCAL ROLE validation SQL](./runtime-permission-deployment.md#3-pre-commit-validation-sql-and-workflow-limits). Compare all 48 PUBLIC objects and shared/column ACLs to the approved decision and verify the full baseline/delta. On any failure, missing approval, timeout or mismatch, ROLLBACK or disconnect; do not COMMIT. The existing trigger and reaction upserts were exercised before commit only with synthetic rows on a disposable cluster. Do not execute those write probes against the live database: savepoint rollback does not undo sequence advances or external effects.

**Not established before commit:** a separate runtime login, real credential/TLS/pg_hba, multi-connection transaction flow, application startup and real registration/top-up/unlock/refund. The role and grants are invisible to other sessions until commit, and application code may issue its own COMMIT. If those checks are required before commit, deployment is **BLOCKED**; obtain an approved transaction-compatible, non-mutating workflow plan rather than treating privilege checks as a substitute.

**Post-commit read-only database smoke, only after separate authorization and credential setup:** use a new connection as `noveltail_runtime`, through the approved secret manager and TLS configuration, and verify database/host/port/role and every result against the approved target without displaying secrets or business rows. The following proposal performs no business DML. A read-only transaction does not make arbitrary functions or application startup side-effect free.

```sql
BEGIN TRANSACTION READ ONLY;
SELECT current_database(), current_user, inet_server_addr(), inet_server_port();
SELECT has_database_privilege(current_user, current_database(), 'CONNECT') AS can_connect,
       has_database_privilege(current_user, current_database(), 'TEMPORARY') AS can_temp,
       has_schema_privilege(current_user, 'public', 'USAGE') AS schema_usage,
       has_schema_privilege(current_user, 'public', 'CREATE') AS schema_create,
       has_function_privilege(current_user, 'public.create_user_wallet()', 'EXECUTE') AS wallet_function_execute;
SELECT has_table_privilege(current_user, 'public.wallet_transactions', 'SELECT') AS ledger_select,
       has_table_privilege(current_user, 'public.wallet_transactions', 'INSERT') AS ledger_insert,
       has_table_privilege(current_user, 'public.wallet_transactions', 'UPDATE') AS ledger_update,
       has_table_privilege(current_user, 'public.wallet_transactions', 'DELETE') AS ledger_delete,
       has_any_column_privilege(current_user, 'public.wallet_transactions', 'UPDATE') AS ledger_column_update;
SELECT c.relname, a.attname,
       has_column_privilege(current_user, c.oid, a.attname, 'UPDATE') AS can_update
FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
JOIN pg_attribute a ON a.attrelid = c.oid
WHERE n.nspname = 'public'
  AND c.relname IN ('comment_reactions','review_reactions')
  AND a.attnum > 0 AND NOT a.attisdropped
ORDER BY c.relname, a.attnum;
ROLLBACK;
```

Expected: CONNECT and schema USAGE true; TEMPORARY, schema CREATE, function EXECUTE and ledger UPDATE/DELETE/column UPDATE false; ledger SELECT/INSERT true; reaction UPDATE only on `reaction_type` and `updated_at`. Mismatch, authentication failure or uncertain commit means stop and reconcile state. The proposed [forward recovery](./runtime-permission-deployment.md#4-post-commit-forward-recovery-sql) requires a separately authorized recovery, an approved target-baseline allowlist and an enforced controller; the policy approval does not authorize running it. These are representative smoke checks, not a substitute for the full matrix or business-flow tests.

Do **not** restart the production app merely to perform this smoke. Its [startup guard](../config/production-database.js) requires the migration-005 `rate_limit_buckets` table, while the current candidate explicitly rejects that table; production also requires the PostgreSQL rate-limit store. Application startup starts the announcement scheduler, and authenticated routes can restore suspensions; these can write business data. Even `/api/test-db`, whose handler itself only selects `NOW()`, does not make starting the server side-effect-free. Migration 005, its grants and application rollout remain a separate blocked gate and are not authorized here.

## Migration 005: separate ownership and proposed minimum

Production configuration requires `RATE_LIMIT_STORE=postgres`; startup executes a zero-row SELECT from `public.rate_limit_buckets`, and the rate limiter performs an atomic INSERT/`ON CONFLICT` update plus expired-row DELETE. Migration 005 creates that table, its primary key, check constraint and expiration index, and contains its own `BEGIN`/`COMMIT`. The existing runtime candidate explicitly requires 28 tables and rejects this table. It therefore cannot work both before 005 (startup fails) and after 005 (candidate fails). Executing the migration file inside a supposed outer permission transaction would allow its `COMMIT` to end that transaction early; do not combine them that way.

The Project Owner has approved separating the migration owner from the runtime identity; implementing that separation in production is pending, and applying migration 005 to the real database is **not approved**. The actual migration was applied under a separate owner only on disposable PostgreSQL. The migration owner, never used by the app, must separately obtain approval, apply it only under its own approved change, and verify table/index definitions, ownership, constraints and migration state. `IF NOT EXISTS` by itself does not verify the definition of a pre-existing table or index. Then capture and approve a **new** post-migration baseline, review a revised 29-table matrix and same-transaction candidate, and rehearse both before any runtime deployment.

For review only, the smallest rights identified from the current limiter source are:

```sql
-- PROPOSAL ONLY: not part of the approved pre-005 matrix or current candidate.
GRANT SELECT (bucket_key, hits, expires_at),
      INSERT (bucket_key, hits, expires_at),
      UPDATE (hits, expires_at),
      DELETE
ON TABLE public.rate_limit_buckets TO noveltail_runtime;
```

`DELETE` is necessarily table-wide for the current cleanup statement and also permits deletion of unexpired counters; the owner must explicitly accept that risk or request an independently reviewed design change. No sequence, DDL, ownership, grant option or UPDATE of `bucket_key` is needed by these statements. A focused disposable test applied the actual migration under a distinct owner, used the actual store to insert and conflict-update a bucket and clean an expired bucket, denied UPDATE of `bucket_key`, and exercised the amended startup guard. Removing these grants preserved the synthetic post-commit row, existing-role effective rights and NULL column ACLs; the table's owner-default ACL is eligible only if included in a newly approved post-005 baseline allowlist. This is not a test of the integrated 29-table candidate or complete post-005 recovery; both remain **BLOCKED**.

The following is the corresponding limiter-only recovery fragment, **not standalone recovery and not production authorization**. It must run as the original grantor within a verified recovery transaction, followed by complete post-005 baseline/allowlist checks; mismatch requires ROLLBACK.

```sql
REVOKE SELECT (bucket_key, hits, expires_at),
       INSERT (bucket_key, hits, expires_at),
       UPDATE (hits, expires_at),
       DELETE
ON TABLE public.rate_limit_buckets FROM noveltail_runtime RESTRICT;
```

## Deployment checklist and SQL handoff

- [x] Record the Project Owner's D2, D3, D5 and M1 policy decisions and P1 deployment block dated 2026-11-11. This records policy only, not implementation or production authorization.
- [x] Capture the current target's read-only, NULL-aware pre-005 catalog baseline and candidate allowlist; see [evidence](./database-permissions.md#latest-read-only-baseline).
- [ ] Approve the 48 exact D1 object decisions and D6 recovery/transaction procedure, appoint authorized reviewers, and recapture identity and the complete baseline after approved changes. Preserve PUBLIC CONNECT, schema USAGE and default ACLs; no new decision to revoke them is implied.
- [ ] **D2 implementation PENDING:** inventory TEMPORARY consumers and finalize change and recovery authorization; execute only when the required gates are met, then capture a new baseline.
- [ ] **D3 implementation PENDING:** identify functions proven unnecessary, review all consumers and trigger creators, and preserve registration and the wallet trigger; authorize the exact change before executing it. No blanket EXECUTE revoke.
- [x] **D5 policy APPROVED:** the Project Owner approved the restricted raw-ACL drift criterion on 2026-11-11; disposable implementation and focused verification are complete.
- [ ] **D5 production implementation / verification BLOCKED:** separately approve the exact post-change baseline-derived OID/owner allowlist; establish trusted evidence, an enforced gateway and a separately authorized recovery. Never assume a fixed count or accept drift outside the approved policy.
- [ ] Confirm the runtime role is absent cluster-wide, no related dependencies exist, the prior application access can be restored, and the change freeze and tested forward-recovery conditions are in force.
- [ ] Provision an owner-protected trust anchor and two-reviewer signing process; integrate and independently test a mandatory approval-verifying controller and same-session orchestration. The [prototype verifier](./runtime-permission-deployment.md#0-signed-approval-verifier-scope-and-hard-stop) alone always rejects deployment. The controller must recheck the approved baseline and all PUBLIC decisions within the transaction, run the fresh-role gate, the **revised post-005 candidate**, and validation without changing sessions or allowing an intermediate COMMIT.
- [ ] Only after every pre-commit gate passes, issue `COMMIT;` on that session; otherwise issue `ROLLBACK;`. If connection outcome is unknown, reconcile before any retry.
- [ ] After separate credential and smoke-test authorization, run the read-only checks above. On failure, stop runtime use and drain sessions. The [targeted forward-recovery SQL](./runtime-permission-deployment.md#4-post-commit-forward-recovery-sql) is a proposal; first establish trusted baseline/allowlist evidence and a separately authorized recovery, then verify every condition **before** COMMIT. Never use `DROP OWNED`, CASCADE or physical restore as permission recovery.
- [ ] **M1 production implementation PENDING:** establish the separate migration owner; obtain separate authorization for real migration 005, verify its resulting state, approve the limiter rights and a revised post-005 matrix/candidate, and test the integrated post-005 deployment/recovery. The actual migration and limiter-only fixture have already passed on disposable PostgreSQL. Keep production application startup as a separate approved gate.
- [ ] **P1 deployment BLOCKED:** do not deploy or claim Production Ready until raw recovery, the mandatory gateway, migration prerequisites and production authorization are complete.

**SQL handoff: decision status PENDING for production deployment; implementation BLOCKED.** The existing [candidate](./database-permissions.md#owner-operated-sql-template) and [forward recovery](./runtime-permission-deployment.md#4-post-commit-forward-recovery-sql) remain pre-005 fragments. The approved drift policy is implemented and tested only in disposable PostgreSQL; the target pre-005 candidate allowlist is unsigned and no production integration exists. TEMPORARY and unnecessary-function EXECUTE implementations remain pending, and the [scoped PUBLIC proposal](./database-permissions-owner-decision.md#current-scoped-public-proposal--approval-required) is not execution authorization. Real migration 005 and proposed limiter grants are not approved. The prototype approval verifier rejects deployment; an enforced gateway, safe production workflow and reviewed post-005 candidate remain missing.

## Local schema execution update — 2026-11-12

A later explicit Project Owner authorization covered schema migrations 005–007 on the backed-up local `Noveltail` database only. Before applying them, a full custom-format database backup was restored into a disposable database; all public table row counts, sequence values, and schema object counts matched. Migrations 005–007 were applied in order to `localhost:5432`; existing row counts did not change. No PostgreSQL role, grant, revoke, or migration-ledger table was changed or created.

This local schema update does not approve production permission changes or deployment. The 2026-11-11 baseline and pre-005 allowlist remain historical, are not a current post-migration baseline, and must not be used to authorize production changes. The enforced gateway, fresh post-005/006/007 baseline, reviewed runtime matrix, role separation, recovery workflow, and production authorization remain **BLOCKED**.
