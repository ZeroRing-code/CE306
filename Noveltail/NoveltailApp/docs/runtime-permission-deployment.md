# Transactional runtime permissions and forward recovery

**Deployment decision status: PENDING; implementation: BLOCKED — not production-ready.** On 2026-11-11 the Project Owner approved restricted raw-ACL drift and the policies to revoke PUBLIC TEMPORARY and EXECUTE only for unnecessary functions while preserving registration and its trigger. The PUBLIC implementations remain pending; migration-owner separation was approved, not application of migration 005. See the [decision register and checklist](./runtime-permission-final-owner-decision.md#decision-register). A disposable recovery verifier exists, but an enforced Deployment Gateway and safe production workflow probes are not implemented. Policy decisions do not authorize deployment, PUBLIC changes or migration 005.

The latest target catalog capture and 23-object derived **candidate** allowlist are described in [database permissions](./database-permissions.md#latest-read-only-baseline). Neither is signed; both describe the pre-005 state before approved PUBLIC changes. They use a sanitized OID-based format, not the snapshot format or hash convention accepted by the prototype below. Do not feed one format into the other or claim the current verifier authenticates these artifacts. A new complete, signed post-change baseline and corresponding allowlist remain necessary.

## 0. Signed approval verifier: scope and hard stop

The local [verifier prototype](../scripts/runtime-permission-approval.js) does not read the report and **always returns `deploymentAllowed: false`**. It is not a deployment command and cannot grant or revoke privileges. Its tests use locally generated Ed25519 keys; no production signing key, signed deployment approval, trust anchor or credentials have been created or changed.

The verifier requires a valid Ed25519 signature over the exact UTF-8 JSON payload, using a public key supplied by a trusted caller independently of the payload and report. It checks issuance and expiry (maximum 24 hours), the hash of `JSON.stringify(snapshot)` from its read-only catalog capture, cluster/database/schema identities, the exact pinned candidate SQL and matrix, a signed decision for each of the 48 `(oid, name, kind)` entries, absence of PUBLIC object/column/routine excess, separately approved absence of PUBLIC TEMPORARY and routine EXECUTE, the named NULL-to-owner-default drift policy, a new runtime role, the exact pinned recovery SQL, and observed migration table/index presence. Any failed check returns a rejection; malformed inputs or failed catalog queries also stop with an error. The pinned SQL is the existing **pre-005 candidate**, not a newly approved production script; its pin must not be changed without independent review and focused testing.

The baseline collector requires an idle, exclusively owned `pg` client, starts its own repeatable-read read-only transaction, fixes `search_path` to `pg_catalog`, captures catalog evidence without business rows, and commits only that read-only transaction. It rejects a client already in a transaction. The database identity, raw ACLs, owners, role/membership records, default ACLs, columns, routine definitions, constraints, indexes, RLS policies and triggers are captured; this may contain application definitions and must stay in owner-controlled storage. Access to `pg_control_system()` and the required catalogs is mandatory; if unavailable, capture is **BLOCKED**, not guessed. The function EXECUTE check fails closed for **any** additional PUBLIC-executable routine; it does not revoke one. The signed allowlist may be a subset of baseline NULL-ACL directly granted tables; an omitted table whose ACL the candidate changes causes pre-commit verification to stop.

**Not enforced:** the prototypes have no protected production trust-anchor provisioning, two-reviewer verification, mandatory deployment gateway, trusted binding of the complete recovery evidence and committed-state snapshot, change-freeze enforcement, cross-database verification, independent login or business workflow validation. The caller can supply a snapshot, allowlist and key; therefore an untrusted caller can fabricate inputs, and an administrator with direct SQL or control of code, key or credentials can bypass a local tool. Editing `runtime-validation-report.md` alone cannot make the approval verifier authorize a deployment, but the standalone SQL below remains independently executable. **Do not use the verifier output or report status as a substitute for an enforced, owner-protected controller.** Until that controller exists, no SQL here is authorized for production.

## 0.1. Disposable recovery verifier

The [recovery module](../scripts/runtime-permission-recovery.js) captures catalog state, expanded grantor/grantee/privilege/grant-option entries and effective database, public-schema, table, column, sequence and public-function privileges for **every existing `pg_roles` role** in the scoped database. `verifyDeploymentEvidence` checks existing roles/memberships, existing effective rights and ACL entries, the full runtime matrix, and whether a prospective NULL-ACL change is in the caller's baseline-derived allowlist. It must run in the same deployment transaction before COMMIT.

`recoverAgainstRecordedBaseline` begins a transaction on an idle, exclusively owned client, compares current evidence with the recorded committed deployment state, runs only the pinned recovery SQL, and verifies the recovered state before COMMIT. It distinguishes raw NULL, `{}` and explicit entries; only an allowlisted NULL-to-exact-`acldefault('r', original_owner)` table ACL is accepted. Owners, memberships, default ACLs, all other captured raw ACLs, expanded entries and existing-role effective privileges must match. Errors roll back the recovery transaction; the SQL itself is not a standalone allowlist guard.

These are **disposable-tested building blocks, not an enabled production gateway**. They assume an exclusively owned connection, a cooperating-administrator change freeze, trusted baseline/committed evidence and an independently approved allowlist; the recovery function does not verify their signatures itself. A repeatable-read snapshot or advisory lock cannot stop uncooperative administrators. Separately approved changes to PUBLIC or another ACL must be completed and captured in a fresh baseline first; this verifier does not accept additional exceptions inside the recovery. `MAINTAIN` checks require PostgreSQL 17 or newer. A fresh pre-005 target snapshot exists, but current post-change state, all other databases, protected signing, gateway enforcement and real-login/business workflows remain unverified.

## 1. Baseline and owner decision

Before any deployment, an owner captures the immutable, NULL-aware raw and expanded inventory from [database permissions](./database-permissions.md#owner-inventory-before-approval), including all 28 tables, 20 sequences, columns, database, schema, routines, defaults, owners, grantors, grant options, role attributes and memberships. Record database/cluster identity and version and the complete row sets, not just PUBLIC entries. Capture after any separately approved PUBLIC decision, so recovery returns to that **pre-deployment** baseline and never changes PUBLIC.

For each of the 48 objects, an authorized owner must explicitly approve the applicable PUBLIC state in [owner decision](./database-permissions-owner-decision.md). Recommendations and a historical absence of PUBLIC object grants are **not approval**. The intended controller must verify a trusted approval bound to the exact baseline, object identities, PUBLIC entries, scope and expiration; missing or changed approval means **stop**. The verifier prototype is not an enforced controller. Also review PUBLIC column, database, schema and routine ACLs and role memberships; the 48-object list alone is not sufficient.

The following read-only query inventories PUBLIC entries on all 48 relation objects. The controller must compare the complete 48 `(kind, name, oid)` identities and PUBLIC entries against the approved baseline; it must not merely check the count. The other raw/column/shared ACL queries in the baseline are still required.

```sql
SELECT c.relkind, c.relname, c.oid, c.relacl,
       COALESCE(
           jsonb_agg(jsonb_build_object(
               'grantor', pg_get_userbyid(a.grantor),
               'privilege', a.privilege_type,
               'grantable', a.is_grantable
           ) ORDER BY a.grantor, a.privilege_type, a.is_grantable)
               FILTER (WHERE a.grantee = 0),
           '[]'::jsonb
       ) AS public_entries
FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
LEFT JOIN LATERAL aclexplode(COALESCE(c.relacl, acldefault(
    CASE WHEN c.relkind = 'S' THEN 's'::"char" ELSE 'r'::"char" END,
    c.relowner))) a ON a.grantee = 0
WHERE n.nspname = 'public' AND c.relkind IN ('r','p','S')
GROUP BY c.relkind, c.relname, c.oid, c.relacl
ORDER BY c.relkind, c.relname;
```

## 2. Deployment SQL and transaction boundary

Use the [candidate SQL](./database-permissions.md#owner-operated-sql-template), unchanged matrix and its existing privilege assertions. It starts `BEGIN` and intentionally has **no COMMIT**. For this forward-recovery design, the controller must execute the fresh-role gate below **immediately after BEGIN and before the rest of the candidate**, on the same connection. It must compare the complete current baseline and owner approval within the transaction, under an owner-controlled change freeze that prevents concurrent ACL, ownership, role and schema changes. An advisory lock alone cannot stop other administrators who do not cooperate.

```sql
DO $$ BEGIN
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'noveltail_runtime') THEN
        RAISE EXCEPTION 'Existing runtime role requires a separate deployment and recovery plan';
    END IF;
END $$;
```

The controller then executes the candidate body without a second `BEGIN`, the validation SQL below, and all approved workflow validations in **the same connection and transaction**. It compares all 48 PUBLIC identities and privileges with the approved decision and verifies all effective privileges, column rights, grant options, ownership and membership. Only after every check succeeds can that session issue `COMMIT;`. On any error, mismatch, missing approval, disconnect or timeout, it issues `ROLLBACK;` or closes the connection; no COMMIT is allowed. A lost connection during COMMIT has an **unknown outcome** and requires owner reconciliation of role existence and the recorded grant delta before retrying.

Do not treat the standalone candidate as an implementation of the approval gate or controller. The previous all-in-one template ended in COMMIT; the current template intentionally leaves the transaction open. The standalone grant body remains repeatable for unchanged prerequisites, but the **new deployment path** rejects an existing role because the recovery below assumes the role did not exist in the baseline.

### Unknown COMMIT outcome — reconciliation design, not implemented

Never automatically retry a lost COMMIT. Keep application use stopped and retain the independent audit/change-freeze evidence. Reconnect read-only with a separately authorized administrative identity, verify cluster/database/schema identity, and capture the same complete evidence used by the signed baseline and expected committed state. Compare role existence and identity, grants including grantor/options, all 48 original PUBLIC objects and any post-005 object, owners, memberships, defaults and effective permissions. An exact pre-transaction match is consistent with rollback; an exact expected committed match is consistent with commit. Either inference additionally requires reliable evidence that no other actor changed the state afterward. Mixed state, missing evidence, unverifiable exclusivity or an identity mismatch is **BLOCKED/unknown**: no retry or automatic recovery. Recovery is a separately authorized transaction after outcome and dependencies are verified. No reconciliation controller or connection-loss test exists yet.

## 3. Pre-commit validation SQL and workflow limits

The candidate's assertion block checks the full matrix and rejects PUBLIC/Membership excess. The following same-session check additionally proves the transaction can assume the new role and checks representative ledger/reaction privileges; it must not replace the full matrix and owner-decision checks.

```sql
SET LOCAL ROLE noveltail_runtime;
DO $$ BEGIN
    IF current_user <> 'noveltail_runtime'
       OR has_table_privilege(current_user, 'public.wallet_transactions', 'UPDATE')
       OR has_table_privilege(current_user, 'public.wallet_transactions', 'DELETE')
       OR has_any_column_privilege(current_user, 'public.wallet_transactions', 'UPDATE')
       OR NOT has_column_privilege(current_user, 'public.comment_reactions', 'reaction_type', 'UPDATE')
       OR NOT has_column_privilege(current_user, 'public.comment_reactions', 'updated_at', 'UPDATE')
       OR NOT has_column_privilege(current_user, 'public.review_reactions', 'reaction_type', 'UPDATE')
       OR NOT has_column_privilege(current_user, 'public.review_reactions', 'updated_at', 'UPDATE')
    THEN
        RAISE EXCEPTION 'Runtime validation failed';
    END IF;
END $$;
RESET ROLE;
```

In the disposable rehearsal, representative registration/wallet-trigger and both reaction upserts execute under `SET LOCAL ROLE` on this same connection, inside a savepoint that is rolled back before commit. These are **synthetic, scoped checks**, not a full application or production-login test. A newly created uncommitted role and its grants are not visible to other sessions: a separate application pool cannot authenticate as it or use its uncommitted permissions. `SET ROLE` does not test login, password, TLS, `session_user`, separate connections or code that starts/commits its own transactions. Such application flows cannot simply be attached to the owner's uncommitted transaction.

Do not run synthetic write probes against the live database. `ROLLBACK TO SAVEPOINT` does not undo sequence advancement, external effects or all session-level effects, and real triggers may have side effects. Production pre-commit workflow execution is **BLOCKED** until the owner approves safe, transaction-compatible checks with no business-data, sequence or external effects. Full real-login and multi-session workflows require an isolated committed rehearsal and, if approved, post-commit checks with the forward-recovery plan. If the owner requires those real-login checks to pass before COMMIT, this single-transaction design cannot meet that requirement.

## 4. Post-commit forward-recovery SQL

Forward recovery restores the effective permission baseline, not raw ACL equality. The role was absent before deployment; this narrowly scoped example removes only this proposal's direct grants and then drops the new role. It does not use `DROP OWNED`, touch business rows or change PUBLIC. PostgreSQL may leave raw NULL ACLs as explicit owner ACLs. The Project Owner approved only the restricted owner-default policy, not production execution: the captured pre-005 candidate allowlist is unsigned and a new post-change allowlist, trusted evidence, enforced controller and separate recovery authorization remain missing. If raw-exact recovery is required, this plan is **not acceptable**.

**Hard preconditions:** separately authorize recovery; stop application use and drain all runtime sessions; prevent concurrent ACL/ownership/role/schema changes across the cluster; verify the role was absent in the signed baseline and created only by this deployment; compare the current grantor-aware direct grants, objects, role attributes, memberships, owners and PUBLIC ACLs against the recorded post-commit deployment snapshot. Any drift, ownership, role membership, delegated grant, other-database dependency, unexpected grantor or reused role means **stop** and design a separately reviewed recovery. The SQL checks some conditions but cannot verify the signed baseline or detect every other session's `SET ROLE`; the owner-controlled barrier and controller checks are mandatory. `RESTRICT` and `DROP ROLE` must be allowed to fail; never use CASCADE.

The recovery transaction also remains open. The controller must compare all affected effective privileges, grantors, memberships, PUBLIC entries and business-data integrity with the baseline before issuing `COMMIT;`; on any mismatch it must `ROLLBACK;`. A loss of connection during COMMIT again requires outcome reconciliation. This SQL is a proposal, not authorization to run it.

```sql
BEGIN;
DO $$
DECLARE
    r oid;
    t text;
    reads text[] := ARRAY['account_suspensions','admin_action_logs','announcement_recipients','announcements','appeal_assignments','appeals','bookmarks','chapter_unlocks','chapters','comments','comment_reactions','follows','genres','notifications','novel_genres','novels','reading_history','reports','review_reactions','reviews','users','wallet_transactions','wallets'];
    updates text[] := ARRAY['account_suspensions','announcement_recipients','announcements','appeal_assignments','appeals','chapters','comments','notifications','novels','reading_history','reports','reviews','users','wallets'];
    deletes text[] := ARRAY['bookmarks','chapter_unlocks','chapters','comments','comment_reactions','follows','notifications','novel_genres','novels','reading_history','review_reactions','reviews'];
BEGIN
    IF current_database() <> 'Noveltail' THEN
        RAISE EXCEPTION 'Wrong database: %', current_database();
    END IF;
    SELECT oid INTO STRICT r FROM pg_roles WHERE rolname = 'noveltail_runtime';
    IF EXISTS (SELECT 1 FROM pg_auth_members WHERE member = r OR roleid = r)
       OR EXISTS (SELECT 1 FROM pg_shdepend
                  WHERE refclassid = 'pg_authid'::regclass
                    AND refobjid = r AND deptype = 'o')
       OR EXISTS (SELECT 1 FROM pg_stat_activity
                  WHERE usename = 'noveltail_runtime' AND pid <> pg_backend_pid()) THEN
        RAISE EXCEPTION 'Runtime ownership, membership or active login; stop recovery';
    END IF;
    FOREACH t IN ARRAY reads LOOP
        EXECUTE format('REVOKE SELECT ON TABLE public.%I FROM noveltail_runtime RESTRICT', t);
    END LOOP;
    FOREACH t IN ARRAY array_remove(reads, 'genres') LOOP
        EXECUTE format('REVOKE INSERT ON TABLE public.%I FROM noveltail_runtime RESTRICT', t);
    END LOOP;
    FOREACH t IN ARRAY updates LOOP
        EXECUTE format('REVOKE UPDATE ON TABLE public.%I FROM noveltail_runtime RESTRICT', t);
    END LOOP;
    REVOKE UPDATE (reaction_type, updated_at) ON TABLE public.comment_reactions FROM noveltail_runtime RESTRICT;
    REVOKE UPDATE (reaction_type, updated_at) ON TABLE public.review_reactions FROM noveltail_runtime RESTRICT;
    FOREACH t IN ARRAY deletes LOOP
        EXECUTE format('REVOKE DELETE ON TABLE public.%I FROM noveltail_runtime RESTRICT', t);
    END LOOP;
END $$;
DROP ROLE noveltail_runtime;
-- Transaction intentionally remains open for effective-baseline verification.
```

`DROP ROLE` fails if remaining cluster-wide dependencies exist; the whole transaction must then be rolled back, not forced. A pre-existing role, grants with other grantors or post-deployment drift need a bespoke baseline-derived plan; they are outside this example. Physical restore is not a permission-recovery method in this design.

## 5. Required owner approvals and remaining gates

1. **D2/D3 policy APPROVED; implementation PENDING:** inventory consumers, preserve registration and the trigger, and obtain execution authorization for the exact shared changes. Approve a refreshed baseline and explicit decisions for all 48 PUBLIC objects and shared/column/default privileges; those object decisions remain pending.
2. Approve the fresh-role-only scope, capture/verify method, change freeze, credential handoff and independent no-business-effect pre-commit workflow checks.
3. **D5 policy APPROVED; disposable verification COMPLETED; actual-target integration BLOCKED:** approve the exact fresh-baseline allowlist and separately authorize recovery. Effective equivalence alone is not sufficient; all approved raw ACL, grantor, grant-option, ownership, membership, default and effective privilege checks must pass.
4. **M1 separation policy APPROVED; implementation PENDING:** establish a separate migration owner. Real migration 005 remains unapproved. Independently test the missing Deployment Gateway, unknown-COMMIT reconciliation, real-login/post-commit workflow and incident procedures; deployment authorization remains PENDING and implementation BLOCKED.

See the [runtime validation report](../runtime-validation-report.md) for what was actually tested; this design alone does not satisfy release approval.
