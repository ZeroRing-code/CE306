# Owner decision: PUBLIC privileges and ACL rollback

**Production decision status: PENDING; implementation: BLOCKED — not production-ready.** On 2026-11-11 the Project Owner approved the policies to revoke PUBLIC TEMPORARY and EXECUTE only for unnecessary functions while preserving registration and its trigger; both implementations are pending. The owner subsequently approved restricted baseline-allowlisted NULL-to-original-owner-default raw drift, subject to all [recorded invariants](./runtime-permission-final-owner-decision.md#measurable-acceptance-after-forward-recovery). This does not authorize production deployment. The [final decision register](./runtime-permission-final-owner-decision.md#decision-register) separates policy decisions from implementation and execution authorization. The source is the read-only Noveltail baseline of 2026-11-11 20:33:58 +07:00 and the [corrected baseline](../runtime-permission-baseline-corrected.json); the [original](../runtime-permission-baseline.json) remains preserved. The baseline is historical and must be refreshed before execution. No live database was contacted for this follow-up.

## Forty-eight object inventory

All 28 tables and 20 sequences below had raw `relacl = NULL`. Expanded built-in defaults showed **no PUBLIC table or sequence privilege**, and the recorded column ACL inventory was empty. NULL does not mean nobody has access: each object was owned by `postgres`, which retains owner rights. PUBLIC applies to all roles, whereas individual grants, ownership, memberships, security-definer code and other databases require separate review.

For table rows, `S/I/U/D/T/R/G` mean SELECT/INSERT/UPDATE/DELETE/TRUNCATE/REFERENCES/TRIGGER; `0` means absent from PUBLIC. For sequences, `0` means the named privilege is absent. `Required runtime` is the proposed direct matrix, **not** a requirement to grant anything to PUBLIC. `U[reaction_type,updated_at]` is column-only; no other runtime UPDATE is intended on reaction tables. Sequence rights are not required for the identity inserts observed in the dated baseline.

Each row uses the following shared, object-specific interpretation:

- **R0 — risk if retained:** retaining the observed absence adds no PUBLIC access to that object. This does not rule out access through another path. Granting PUBLIC rights would expose that object to every role; for `wallet_transactions`, PUBLIC UPDATE/DELETE would undermine the ledger restriction.
- **I0 — impact of revoke:** no recorded PUBLIC privilege exists to remove on that object, so revocation brings no effective PUBLIC reduction. A no-op REVOKE can still materialize the raw NULL ACL and must not be assumed raw-neutral; other roles' access is not inventoried by this row.
- **K0 — recommendation:** keep PUBLIC privileges absent; do not run a blanket REVOKE or add PUBLIC grants. Recheck raw, expanded and column ACLs before acting and grant the listed runtime rights directly only after approval.

| Table in `public` | Current PUBLIC privileges | Required runtime | Risk | Revoke impact | Recommendation |
|---|---|---|---|---|---|
| account_suspensions | S=0 I=0 U=0 D=0 T=0 R=0 G=0 | S, I, U | R0 | I0 | K0 |
| admin_action_logs | S=0 I=0 U=0 D=0 T=0 R=0 G=0 | S, I | R0 | I0 | K0 |
| announcement_recipients | S=0 I=0 U=0 D=0 T=0 R=0 G=0 | S, I, U | R0 | I0 | K0 |
| announcements | S=0 I=0 U=0 D=0 T=0 R=0 G=0 | S, I, U | R0 | I0 | K0 |
| appeal_assignments | S=0 I=0 U=0 D=0 T=0 R=0 G=0 | S, I, U | R0 | I0 | K0 |
| appeals | S=0 I=0 U=0 D=0 T=0 R=0 G=0 | S, I, U | R0 | I0 | K0 |
| bookmarks | S=0 I=0 U=0 D=0 T=0 R=0 G=0 | S, I, D | R0 | I0 | K0 |
| chapter_revisions | S=0 I=0 U=0 D=0 T=0 R=0 G=0 | none | R0 | I0 | K0 |
| chapters | S=0 I=0 U=0 D=0 T=0 R=0 G=0 | S, I, U, D | R0 | I0 | K0 |
| chapter_unlocks | S=0 I=0 U=0 D=0 T=0 R=0 G=0 | S, I, D | R0 | I0 | K0 |
| comment_mentions | S=0 I=0 U=0 D=0 T=0 R=0 G=0 | none | R0 | I0 | K0 |
| comment_reactions | S=0 I=0 U=0 D=0 T=0 R=0 G=0 | S, I, U[reaction_type,updated_at], D | R0 | I0 | K0 |
| comments | S=0 I=0 U=0 D=0 T=0 R=0 G=0 | S, I, U, D | R0 | I0 | K0 |
| follows | S=0 I=0 U=0 D=0 T=0 R=0 G=0 | S, I, D | R0 | I0 | K0 |
| genres | S=0 I=0 U=0 D=0 T=0 R=0 G=0 | S | R0 | I0 | K0 |
| notifications | S=0 I=0 U=0 D=0 T=0 R=0 G=0 | S, I, U, D | R0 | I0 | K0 |
| novel_follows | S=0 I=0 U=0 D=0 T=0 R=0 G=0 | none | R0 | I0 | K0 |
| novel_genres | S=0 I=0 U=0 D=0 T=0 R=0 G=0 | S, I, D | R0 | I0 | K0 |
| novel_likes | S=0 I=0 U=0 D=0 T=0 R=0 G=0 | none | R0 | I0 | K0 |
| novel_revisions | S=0 I=0 U=0 D=0 T=0 R=0 G=0 | none | R0 | I0 | K0 |
| novels | S=0 I=0 U=0 D=0 T=0 R=0 G=0 | S, I, U, D | R0 | I0 | K0 |
| reading_history | S=0 I=0 U=0 D=0 T=0 R=0 G=0 | S, I, U, D | R0 | I0 | K0 |
| reports | S=0 I=0 U=0 D=0 T=0 R=0 G=0 | S, I, U | R0 | I0 | K0 |
| review_reactions | S=0 I=0 U=0 D=0 T=0 R=0 G=0 | S, I, U[reaction_type,updated_at], D | R0 | I0 | K0 |
| reviews | S=0 I=0 U=0 D=0 T=0 R=0 G=0 | S, I, U, D | R0 | I0 | K0 |
| users | S=0 I=0 U=0 D=0 T=0 R=0 G=0 | S, I, U | R0 | I0 | K0 |
| wallet_transactions | S=0 I=0 U=0 D=0 T=0 R=0 G=0 | S, I | R0 | I0 | K0 |
| wallets | S=0 I=0 U=0 D=0 T=0 R=0 G=0 | S, I, U | R0 | I0 | K0 |

| Sequence in `public` | Current PUBLIC privileges | Required runtime | Risk | Revoke impact | Recommendation |
|---|---|---|---|---|---|
| account_suspensions_suspension_id_seq | USAGE=0 SELECT=0 UPDATE=0 | none | R0 | I0 | K0 |
| admin_action_logs_log_id_seq | USAGE=0 SELECT=0 UPDATE=0 | none | R0 | I0 | K0 |
| announcements_announcement_id_seq | USAGE=0 SELECT=0 UPDATE=0 | none | R0 | I0 | K0 |
| appeal_assignments_assignment_id_seq | USAGE=0 SELECT=0 UPDATE=0 | none | R0 | I0 | K0 |
| appeals_appeal_id_seq | USAGE=0 SELECT=0 UPDATE=0 | none | R0 | I0 | K0 |
| bookmarks_bookmark_id_seq | USAGE=0 SELECT=0 UPDATE=0 | none | R0 | I0 | K0 |
| chapter_revisions_revision_id_seq | USAGE=0 SELECT=0 UPDATE=0 | none | R0 | I0 | K0 |
| chapters_chapter_id_seq | USAGE=0 SELECT=0 UPDATE=0 | none | R0 | I0 | K0 |
| comment_mentions_mention_id_seq | USAGE=0 SELECT=0 UPDATE=0 | none | R0 | I0 | K0 |
| comments_comment_id_seq | USAGE=0 SELECT=0 UPDATE=0 | none | R0 | I0 | K0 |
| genres_genre_id_seq | USAGE=0 SELECT=0 UPDATE=0 | none | R0 | I0 | K0 |
| notifications_notification_id_seq | USAGE=0 SELECT=0 UPDATE=0 | none | R0 | I0 | K0 |
| novel_likes_like_id_seq | USAGE=0 SELECT=0 UPDATE=0 | none | R0 | I0 | K0 |
| novel_revisions_revision_id_seq | USAGE=0 SELECT=0 UPDATE=0 | none | R0 | I0 | K0 |
| novels_novel_id_seq | USAGE=0 SELECT=0 UPDATE=0 | none | R0 | I0 | K0 |
| reading_history_history_id_seq | USAGE=0 SELECT=0 UPDATE=0 | none | R0 | I0 | K0 |
| reports_report_id_seq | USAGE=0 SELECT=0 UPDATE=0 | none | R0 | I0 | K0 |
| reviews_review_id_seq | USAGE=0 SELECT=0 UPDATE=0 | none | R0 | I0 | K0 |
| users_user_id_seq | USAGE=0 SELECT=0 UPDATE=0 | none | R0 | I0 | K0 |
| wallet_transactions_transaction_id_seq | USAGE=0 SELECT=0 UPDATE=0 | none | R0 | I0 | K0 |

## Shared privileges outside the 48 objects

| Object / PUBLIC privilege in baseline | Runtime need and risk if retained | Impact of revocation | Recommendation |
|---|---|---|---|
| Database `Noveltail`: CONNECT present | CONNECT is necessary; the revised candidate relies on PUBLIC and makes no redundant direct grant. PUBLIC allows all otherwise eligible roles to connect. | Other roles relying only on PUBLIC cannot make new connections; existing sessions are not necessarily terminated. | Keep unchanged in this proposal; separately inventory consumers if the owner wishes to restrict it. The candidate stops if PUBLIC CONNECT is absent. |
| Database `Noveltail`: TEMPORARY present | Not allowed by the strict matrix. PUBLIC lets roles create temporary objects subject to other limits, with resource and object-shadowing risks. | All consumers relying only on PUBLIC lose that privilege. In the isolated test both a new and an already-used consumer session were denied new temp tables after revoke; roles with separate grants may differ. | Revocation policy **APPROVED**; implementation **PENDING**. Inventory consumers, arrange replacement grants and obtain change/recovery authorization before execution. Until then the strict candidate blocks; do not revoke automatically. |
| Schema `public`: USAGE present | USAGE is necessary; the revised candidate relies on PUBLIC and makes no redundant direct grant. PUBLIC makes object lookup possible, but does not itself grant object privileges. | Roles relying on PUBLIC may lose access to objects in the schema even if they have object grants. | Keep unchanged here; inventory consumers before any separate restriction. The candidate stops if PUBLIC USAGE is absent. |
| `public.create_user_wallet()`: EXECUTE present | Strict matrix disallows runtime EXECUTE. Function is a `SECURITY INVOKER` trigger function, not an ordinary direct SQL-callable function; PUBLIC EXECUTE enables otherwise eligible users to create triggers using it, with their own table and execution privileges. | Existing `users_create_wallet` trigger continued to execute after revoke in the isolated registration test, but another role could no longer create a trigger referencing the function. Other consumers and future migrations need review. | The policy to revoke only unnecessary function EXECUTE is **APPROVED**; implementation **PENDING**. This function is a candidate, not an approved unchecked list: verify consumers and migrations and preserve registration and the trigger before exact change authorization. |

The 2026-11-11 baseline has no explicit `pg_default_acl` entries. Built-in defaults still grant PUBLIC EXECUTE on new functions. Default privileges are per creator; global and per-schema defaults combine. A per-schema REVOKE alone cannot cancel a global default grant. Changing defaults affects **future** objects and other consumers and is a separate owner decision; this proposal makes no default-ACL changes.

## Decision options

1. **PUBLIC TEMPORARY and function EXECUTE:** the owner approved the respective revocation policies; implementations remain pending. Identify every affected consumer, verify the exact unnecessary functions and specify replacement direct grants and rollout/rollback before separate execution authorization. Preserve registration and its trigger.
2. **Recovery acceptance:** prior raw-exact post-commit rollback **failed**. The owner approved restricted drift, not production execution. The [forward-recovery design](./runtime-permission-deployment.md) avoids physical restore and verifies the policy in disposable tests; a real signed baseline, independently approved object allowlist, enforced gateway and separate recovery authorization remain **BLOCKED**. A transaction abort before COMMIT is not post-commit recovery.
3. **Role identity and consumers:** confirm whether the cluster-wide role is new; capture all memberships, ownership, database grants and dependencies before selecting forward recovery. The new deployment path requires the role to be absent in the baseline. For an existing role, approve a tailored per-grantor plan instead. The updated candidate checks `rolreplication`, but cross-database role usage still needs owner review.
4. **Future defaults:** decide whether to retain built-in function EXECUTE for future functions or commission a separate, creator-specific default-ACL change after assessing future callers. Do not silently change other creators' defaults.

## Current scoped PUBLIC proposal — approval required

The recommendation is to retain the observed absence of PUBLIC rights on **each** of the 48 relations above, without a no-op or blanket revoke; those individual object decisions remain pending. The two shared changes below are proposals **only** for database TEMPORARY and the exact zero-argument wallet trigger function. The Project Owner approved the general TEMPORARY and unnecessary-function EXECUTE revocation policies, but implementation is pending. The exact function scope, fresh baseline, consumer impact, preservation of registration/trigger and recovery plan must be verified and authorized before execution. No other function, overload, table, sequence or default privilege is included. The [approval verifier](./runtime-permission-deployment.md#0-signed-approval-verifier-scope-and-hard-stop) is not an enforced controller, so this is not authorized production SQL.

```sql
BEGIN;
DO $$ BEGIN
    IF current_database() <> 'Noveltail' THEN
        RAISE EXCEPTION 'Wrong database: %', current_database();
    END IF;
END $$;
REVOKE TEMPORARY ON DATABASE "Noveltail" FROM PUBLIC RESTRICT;
REVOKE EXECUTE ON FUNCTION public.create_user_wallet() FROM PUBLIC RESTRICT;
-- Compare the complete approved pre-change baseline and both resulting ACLs.
-- Leave the transaction open for the independent controller and owner decision.
```

For any failed or missing pre-commit check, issue `ROLLBACK;` on the same connection. `RESTRICT` must fail rather than removing dependent grants. The two revokes have cluster-wide consumer consequences through PUBLIC; they must not be assumed safe from the database-name check alone. After a successful commit, any separately authorized forward recovery must account for the original grantors, grant options and dependencies and verify raw and expanded ACLs. Regranting the privileges does **not** guarantee the original raw NULL ACLs; it is not raw-exact rollback.

On a synthetic PostgreSQL cluster, removing those two grants denied a runtime role TEMPORARY and wallet-function EXECUTE, left an unrelated trigger function's PUBLIC EXECUTE unchanged, and preserved wallet creation through the existing `users_create_wallet` trigger when the runtime role had the matrix's `INSERT` on users and `SELECT`/`INSERT` on wallets. Creating a **new** trigger using the revoked function was denied. This does not establish safety for other real consumers or migration identities.

### Optional shared PUBLIC change — proposal only

**Historical proposal, superseded by the open-transaction proposal above. Do not execute this SQL.** Only a separate future owner-approved change could consider both shared revocations after verifying the baseline, consumers and recovery window. It is not part of the role candidate. If only one privilege is ever approved, prepare and review a narrower transaction instead.

```sql
BEGIN;
DO $$ BEGIN
    IF current_database() <> 'Noveltail' THEN
        RAISE EXCEPTION 'Wrong database: %', current_database();
    END IF;
END $$;
REVOKE TEMPORARY ON DATABASE "Noveltail" FROM PUBLIC RESTRICT;
REVOKE EXECUTE ON FUNCTION public.create_user_wallet() FROM PUBLIC RESTRICT;
COMMIT;
```

Conditional semantic rollback **only when the captured pre-change baseline had exactly these PUBLIC grants**, their original grantors can be preserved, and restoring them has been separately approved:

```sql
BEGIN;
DO $$ BEGIN
    IF current_database() <> 'Noveltail' THEN
        RAISE EXCEPTION 'Wrong database: %', current_database();
    END IF;
END $$;
GRANT TEMPORARY ON DATABASE "Noveltail" TO PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_user_wallet() TO PUBLIC;
COMMIT;
```

This restores the tested PUBLIC privileges semantically, **not** the prior raw `NULL` database and function ACLs. It must not be used under the present exact-raw requirement or against a different baseline. The [runtime role SQL and rollback status](./database-permissions.md) are separate; no post-commit ACL-only exact rollback has been established. For any failure before either transaction commits, use `ROLLBACK;` instead of these post-commit inverses.

## Evidence and limits

The focused PostgreSQL 18.6 disposable test reproduced the baseline's 28 table/20 identity-sequence raw NULL ACLs and PUBLIC database/function defaults using synthetic schema and rows. The revised candidate blocked on each unapproved shared grant, succeeded twice after test-only revocations, and rejected an existing excess grant and membership without removing them. The real registration route, with a real isolated PostgreSQL session under `SET ROLE noveltail_runtime`, created a wallet through the existing trigger even though runtime lacked function EXECUTE. The test did not use a production login, a faithful full-schema restore, or other consumers' real workloads.

After candidate commit and new-role removal, expanded relation ACLs matched the pre-candidate state, but 23 table ACLs were explicit rather than NULL; the other five tables, all 20 sequences and all tested column ACLs retained their raw values. Database/schema/function raw ACLs matched their **post-PUBLIC-revoke, pre-candidate** values; separate PUBLIC regrants did not restore the original NULL database/function ACLs. Same-owner `ALTER TABLE` did not restore NULL. A later focused test, with no PUBLIC privilege change, again found raw drift after role removal; a physical backup restored its synthetic ACL baseline only by restoring the entire cluster to an earlier point. See [runtime validation report](../runtime-validation-report.md) for results and limits.
