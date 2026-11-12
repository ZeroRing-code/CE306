# PostgreSQL application-role permissions

This guide documents a **proposal, not an approval to deploy**. A catalog-only, read-only target baseline was captured on 2026-11-11 15:54:35 UTC; it is a point-in-time pre-005 baseline and must be refreshed after any approved PUBLIC or migration changes and immediately before deployment. See [owner decision](./database-permissions-owner-decision.md) for per-object PUBLIC privileges and unresolved choices.

**Decision / implementation / verification:** the restricted owner-default raw ACL drift policy is **APPROVED**; its verifier and recovery orchestration are implemented and verified on synthetic PostgreSQL, but production integration and actual-target verification remain **BLOCKED**. PUBLIC TEMPORARY and narrowly scoped unnecessary-function EXECUTE revocation policies are **APPROVED**, implementation **PENDING**. Migration-owner separation is **APPROVED**, implementation **PENDING**; real migration 005 is not approved. Production authorization is **PENDING**, deployment **BLOCKED**. See the [dated owner decision register](./runtime-permission-final-owner-decision.md#decision-register).

**Current blocker:** the matrix and SQL below cover only the pre-005 schema, while production startup requires migration 005. The [separate migration-owner plan and proposed limiter column grants](./runtime-permission-final-owner-decision.md#migration-005-separate-ownership-and-proposed-minimum) are not approved additions to this matrix. Actual migration 005, those limiter grants and the amended startup guard passed a focused disposable test, but the complete post-005 29-table candidate and recovery are not integrated or approved. A [signed-evidence verifier prototype](./runtime-permission-deployment.md#0-signed-approval-verifier-scope-and-hard-stop) rejects every deployment; it is not an enforced deployment controller. Neither the old SQL nor policy approval alone is sufficient for production.

## Latest read-only baseline

The verified target was `Noveltail`, `::1:5432`, user `postgres`, schema `public`, PostgreSQL 18.6. A repeatable-read, read-only transaction was rolled back after catalog capture; no business rows were read. All 28 tables and 20 sequences have NULL raw ACLs, owner OID `10`, and no PUBLIC entries; 193 column ACLs are NULL. PUBLIC has CONNECT and TEMPORARY on the database, USAGE on `public`, and EXECUTE on the sole public routine `create_user_wallet()`. The enabled `users_create_wallet` trigger points to it; the function is not SECURITY DEFINER. There are 17 inventoried roles, three membership edges and no global/public default-ACL rows; effective scoped privileges and grant options for all 17 roles were captured. The database ACL is NULL and the schema ACL is explicit. `noveltail_runtime` and the migration-005 table/index are absent.

The local session baseline `runtime-permission-baseline-2026-11-11T15-54-35-976Z.json` has SHA-256 `e9decf636e4b0d028beaa58142417048f62b9bb24bbe97a38e648501e7c74960`; its separate derived candidate allowlist has SHA-256 `2fbd6160db1b886db1a35f4f81ea19e25e30ffd9429feedd612a72d1d657cc4d`. It contains 23 eligible pre-005 table OIDs and original owners, derived from NULL ACLs and owner-only built-in defaults, not from a fixed count. It is not a signed deployment approval and cannot be reused after a baseline-changing PUBLIC or migration action. These files are local session artifacts, not checked into or copied into the synchronized workspace; protect their metadata and retain them under owner-controlled access.

### Post-005 limiter matrix — proposed, not production-approved

| Object / operation | Minimum privileges used by the current application |
|---|---|
| `rate_limit_buckets` reads and `RETURNING` | SELECT on `bucket_key`, `hits`, `expires_at` |
| Initial insert / conflict target | INSERT on `bucket_key`, `hits`, `expires_at` |
| Conflict update | UPDATE only on `hits`, `expires_at` |
| Expired-bucket cleanup | table DELETE; this also permits deleting unexpired rows |

No UPDATE on `bucket_key`, sequence grant, DDL, ownership or grant option is needed. PostgreSQL has no row-predicate-limited DELETE grant; separating cleanup needs a separately reviewed operational/application design, not an assumed reduction. The synthetic test applied the actual migration under a distinct migration owner and exercised the actual store's initial and conflict upserts, SELECT and timer-driven DELETE under the runtime role. The startup guard now verifies required limiter write privileges in addition to the existing read probe; it is not a complete permission-matrix or migration-definition validator.

## Separation of duties

- **Runtime role:** `noveltail_runtime`, a dedicated login for the application. It needs `CONNECT`, `public` schema `USAGE`, and only the table DML listed below. It must not be a superuser, own application objects, inherit privileged-role membership, create persistent schema objects, manage roles/databases, or change grants.
- **Migration/administration role:** a separate owner-controlled identity used only for reviewed migrations and grants. Do not configure this identity in the application environment.

The earlier snapshot contained 28 public tables; five had no direct table grants. The corrected proposal reads 23 tables, inserts into 22, updates 14 tables plus two reaction tables at column level, and deletes from 12. `wallet_transactions` is intentionally append-only: runtime gets `SELECT` and `INSERT`, but not `UPDATE` or `DELETE`. Refund and simulated top-up cancellation serialize against an advisory transaction lock and append reversal entries instead of locking or modifying ledger rows.

### Exact table grants

| Privilege | Tables |
|---|---|
| `SELECT` | `account_suspensions`, `admin_action_logs`, `announcement_recipients`, `announcements`, `appeal_assignments`, `appeals`, `bookmarks`, `chapter_unlocks`, `chapters`, `comments`, `comment_reactions`, `follows`, `genres`, `notifications`, `novel_genres`, `novels`, `reading_history`, `reports`, `review_reactions`, `reviews`, `users`, `wallet_transactions`, `wallets` |
| `INSERT` | `account_suspensions`, `admin_action_logs`, `announcement_recipients`, `announcements`, `appeal_assignments`, `appeals`, `bookmarks`, `chapter_unlocks`, `chapters`, `comments`, `comment_reactions`, `follows`, `notifications`, `novel_genres`, `novels`, `reading_history`, `reports`, `review_reactions`, `reviews`, `users`, `wallet_transactions`, `wallets` |
| `UPDATE` | `account_suspensions`, `announcement_recipients`, `announcements`, `appeal_assignments`, `appeals`, `chapters`, `comments`, `notifications`, `novels`, `reading_history`, `reports`, `reviews`, `users`, `wallets` |
| `UPDATE (reaction_type, updated_at)` only | `comment_reactions`, `review_reactions` |
| `DELETE` | `bookmarks`, `chapter_unlocks`, `chapters`, `comments`, `comment_reactions`, `follows`, `notifications`, `novel_genres`, `novels`, `reading_history`, `review_reactions`, `reviews` |

The former matrix omitted the two column-level updates required by `INSERT ... ON CONFLICT DO UPDATE` in `routes/reactions.js`; even an initial insert requires those privileges. No table grants `TRUNCATE`, `TRIGGER`, `REFERENCES`, `MAINTAIN`, or grant options. The latest recorded live baseline found 20 identity-backed sequences and no serial/default sequences requiring a direct sequence grant; this is historical evidence, not proof about the current target. The trigger function's existing trigger still ran without `PUBLIC EXECUTE` in the focused disposable test, but other users' ability to create triggers was affected.

### Reaction source review

The application has exactly two reaction `ON CONFLICT DO UPDATE` statements:

| Route | Conflict key | Changed columns | Related reads |
|---|---|---|---|
| `PUT /api/reactions/comments/:commentId` | `comment_reactions (user_id, comment_id)` | `reaction_type`, `updated_at` | `comments`, `chapters`, `novels` |
| `PUT /api/reactions/reviews/:reviewId` | `review_reactions (user_id, review_id)` | `reaction_type`, `updated_at` | `reviews`, `chapters`, `novels` |

Both tables also require their listed `SELECT`, `INSERT` and `DELETE` rights for the existing routes. No table-wide UPDATE or UPDATE on user, target or creation columns is needed. The other source upserts are `reading_history` (already in the table UPDATE list) and `rate_limit_buckets` (migration 005, deliberately outside this proposal). The live preflight recorded reaction columns, constraints, indexes, policies and triggers, and the previous restored-schema rehearsal exercised both routes. This is a dated baseline, not a guarantee of current schema state.

## Owner-operated SQL template

**BLOCKED for deployment:** PUBLIC policy decisions are recorded but implementation is pending. A real pre-005 candidate allowlist exists, but it is unsigned and an enforced gateway is missing. Approve pre-commit workflow coverage and operational safeguards in [transaction deployment design](./runtime-permission-deployment.md), and separately authorize production deployment. The following candidate is scoped to the current 28-table / migration-001–004 snapshot only. It deliberately does not change `PUBLIC`, default privileges, passwords, role memberships or migration 005. Run only on an approved target in one persistent session with `ON_ERROR_STOP=1`, using an owner able to grant on every object, with no concurrent ACL changes. The database name comparison is case-sensitive: `current_database()` must be exactly `Noveltail`; PostgreSQL folds an unquoted `Noveltail` to `noveltail`. Replace only that literal for a disposable database. Role creation is cluster-wide and may affect other databases.

The template creates the role if absent and refuses unsafe attributes or memberships. It adds only the required table/column grants and does **not** sweep-revoke direct grants. The historical baseline had PUBLIC database CONNECT and schema USAGE, so redundant direct grants and recovery revokes have been removed. The candidate requires those exact PUBLIC grants and aborts if either is absent; do not silently substitute direct grants. The forward-recovery design additionally requires a same-transaction, fresh-role-only gate; existing-role reuse is outside that design. The assertions reject effective excess privileges, including `PUBLIC` and column grants, rather than silently changing them. On failure, roll back the entire transaction. Normal PostgreSQL defaults grant database `TEMPORARY` to `PUBLIC`; this candidate treats it as outside the matrix and blocks until a separately approved resolution. This is intentionally not an automatic `REVOKE FROM PUBLIC`. The template leaves the transaction **open**: the same session must perform all required validation before an explicit commit; merely executing this block is not deployment.

```sql
BEGIN;

DO $$
DECLARE r pg_roles%ROWTYPE;
BEGIN
    IF current_database() <> 'Noveltail' THEN
        RAISE EXCEPTION 'Wrong database: %', current_database();
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'noveltail_runtime') THEN
        CREATE ROLE noveltail_runtime LOGIN NOSUPERUSER NOCREATEDB
            NOCREATEROLE NOINHERIT NOBYPASSRLS NOREPLICATION;
    END IF;
    SELECT * INTO STRICT r FROM pg_roles WHERE rolname = 'noveltail_runtime';
    IF NOT r.rolcanlogin OR r.rolsuper OR r.rolcreatedb OR r.rolcreaterole
       OR r.rolinherit OR r.rolbypassrls OR r.rolreplication
       OR EXISTS (SELECT 1 FROM pg_auth_members WHERE member = r.oid) THEN
        RAISE EXCEPTION 'Unsafe runtime role attributes or memberships';
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM pg_database d,
            LATERAL aclexplode(COALESCE(d.datacl, acldefault('d', d.datdba))) a
        WHERE d.datname = current_database() AND a.grantee = 0 AND a.privilege_type = 'CONNECT'
    ) OR NOT EXISTS (
        SELECT 1 FROM pg_namespace n,
            LATERAL aclexplode(COALESCE(n.nspacl, acldefault('n', n.nspowner))) a
        WHERE n.nspname = 'public' AND a.grantee = 0 AND a.privilege_type = 'USAGE'
    ) THEN
        RAISE EXCEPTION 'Approved PUBLIC CONNECT or schema USAGE is absent';
    END IF;
    IF EXISTS (
        SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public' AND c.relowner = r.oid
    ) OR EXISTS (
        SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = 'public' AND p.proowner = r.oid
    ) OR EXISTS (
        SELECT 1 FROM pg_database d WHERE d.datname = current_database() AND d.datdba = r.oid
    ) OR EXISTS (
        SELECT 1 FROM pg_namespace n WHERE n.nspname = 'public' AND n.nspowner = r.oid
    ) OR EXISTS (
        SELECT 1 FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace
        WHERE n.nspname = 'public' AND t.typowner = r.oid AND t.typtype <> 'p'
    ) THEN
        RAISE EXCEPTION 'Runtime owns database, schema, relation, routine or type';
    END IF;
    IF (SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p')) <> 28
       OR to_regclass('public.rate_limit_buckets') IS NOT NULL THEN
        RAISE EXCEPTION 'Unexpected table inventory or migration 005 present';
    END IF;
END $$;

-- CONNECT and schema USAGE must already be effective through PUBLIC.
-- The assertions below reject deployment if either is absent.

GRANT SELECT ON TABLE
    public.account_suspensions, public.admin_action_logs,
    public.announcement_recipients, public.announcements,
    public.appeal_assignments, public.appeals, public.bookmarks,
    public.chapter_unlocks, public.chapters, public.comments,
    public.comment_reactions, public.follows, public.genres,
    public.notifications, public.novel_genres, public.novels,
    public.reading_history, public.reports, public.review_reactions,
    public.reviews, public.users, public.wallet_transactions, public.wallets
TO noveltail_runtime;

GRANT INSERT ON TABLE
    public.account_suspensions, public.admin_action_logs,
    public.announcement_recipients, public.announcements,
    public.appeal_assignments, public.appeals, public.bookmarks,
    public.chapter_unlocks, public.chapters, public.comments,
    public.comment_reactions, public.follows, public.notifications,
    public.novel_genres, public.novels, public.reading_history,
    public.reports, public.review_reactions, public.reviews,
    public.users, public.wallet_transactions, public.wallets
TO noveltail_runtime;

GRANT UPDATE ON TABLE
    public.account_suspensions, public.announcement_recipients,
    public.announcements, public.appeal_assignments, public.appeals,
    public.chapters, public.comments, public.notifications, public.novels,
    public.reading_history, public.reports, public.reviews, public.users,
    public.wallets
TO noveltail_runtime;

GRANT UPDATE (reaction_type, updated_at) ON TABLE public.comment_reactions TO noveltail_runtime;
GRANT UPDATE (reaction_type, updated_at) ON TABLE public.review_reactions TO noveltail_runtime;

GRANT DELETE ON TABLE
    public.bookmarks, public.chapter_unlocks, public.chapters,
    public.comments, public.comment_reactions, public.follows,
    public.notifications, public.novel_genres, public.novels,
    public.reading_history, public.review_reactions, public.reviews
TO noveltail_runtime;

DO $$
DECLARE
    x record;
    p text;
    expected boolean;
    reads text[] := ARRAY['account_suspensions','admin_action_logs','announcement_recipients','announcements','appeal_assignments','appeals','bookmarks','chapter_unlocks','chapters','comments','comment_reactions','follows','genres','notifications','novel_genres','novels','reading_history','reports','review_reactions','reviews','users','wallet_transactions','wallets'];
    inserts text[] := array_remove(reads, 'genres');
    updates text[] := ARRAY['account_suspensions','announcement_recipients','announcements','appeal_assignments','appeals','chapters','comments','notifications','novels','reading_history','reports','reviews','users','wallets'];
    deletes text[] := ARRAY['bookmarks','chapter_unlocks','chapters','comments','comment_reactions','follows','notifications','novel_genres','novels','reading_history','review_reactions','reviews'];
BEGIN
    IF has_database_privilege('noveltail_runtime', current_database(), 'CREATE')
       OR has_database_privilege('noveltail_runtime', current_database(), 'TEMPORARY')
       OR has_database_privilege('noveltail_runtime', current_database(), 'CONNECT WITH GRANT OPTION')
       OR NOT has_database_privilege('noveltail_runtime', current_database(), 'CONNECT')
       OR NOT has_schema_privilege('noveltail_runtime', 'public', 'USAGE')
       OR has_schema_privilege('noveltail_runtime', 'public', 'CREATE')
       OR has_schema_privilege('noveltail_runtime', 'public', 'USAGE WITH GRANT OPTION') THEN
        RAISE EXCEPTION 'Unexpected effective database/schema privileges';
    END IF;
    IF EXISTS (SELECT 1 FROM unnest(reads) t(name)
        WHERE NOT EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
            WHERE n.nspname = 'public' AND c.relname = t.name AND c.relkind IN ('r', 'p'))) THEN
        RAISE EXCEPTION 'Expected application table missing';
    END IF;
    FOR x IN SELECT c.oid, c.relname FROM pg_class c
        JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p')
    LOOP
        FOREACH p IN ARRAY ARRAY['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER','MAINTAIN'] LOOP
            expected := CASE p WHEN 'SELECT' THEN x.relname = ANY(reads)
                WHEN 'INSERT' THEN x.relname = ANY(inserts)
                WHEN 'UPDATE' THEN x.relname = ANY(updates)
                WHEN 'DELETE' THEN x.relname = ANY(deletes) ELSE false END;
            IF has_table_privilege('noveltail_runtime', x.oid, p) <> expected
               OR has_table_privilege('noveltail_runtime', x.oid, p || ' WITH GRANT OPTION') THEN
                RAISE EXCEPTION 'Unexpected table privilege % on %', p, x.relname;
            END IF;
        END LOOP;
    END LOOP;
    FOR x IN SELECT c.oid, c.relname FROM pg_class c
        JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public' AND c.relkind IN ('v', 'm', 'f')
    LOOP
        FOREACH p IN ARRAY ARRAY['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER','MAINTAIN'] LOOP
            IF has_table_privilege('noveltail_runtime', x.oid, p) THEN
                RAISE EXCEPTION 'Unexpected relation privilege % on %', p, x.relname;
            END IF;
        END LOOP;
        FOREACH p IN ARRAY ARRAY['SELECT','INSERT','UPDATE','REFERENCES'] LOOP
            IF has_any_column_privilege('noveltail_runtime', x.oid, p) THEN
                RAISE EXCEPTION 'Unexpected column privilege % on %', p, x.relname;
            END IF;
        END LOOP;
    END LOOP;
    FOR x IN SELECT c.oid, c.relname, a.attname FROM pg_class c
        JOIN pg_namespace n ON n.oid = c.relnamespace
        JOIN pg_attribute a ON a.attrelid = c.oid
        WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p')
          AND a.attnum > 0 AND NOT a.attisdropped
    LOOP
        FOREACH p IN ARRAY ARRAY['SELECT','INSERT','UPDATE','REFERENCES'] LOOP
            expected := CASE p WHEN 'SELECT' THEN x.relname = ANY(reads)
                WHEN 'INSERT' THEN x.relname = ANY(inserts)
                WHEN 'UPDATE' THEN x.relname = ANY(updates) OR
                    (x.relname IN ('comment_reactions','review_reactions')
                     AND x.attname IN ('reaction_type','updated_at'))
                ELSE false END;
            IF has_column_privilege('noveltail_runtime', x.oid, x.attname, p) <> expected
               OR has_column_privilege('noveltail_runtime', x.oid, x.attname, p || ' WITH GRANT OPTION') THEN
                RAISE EXCEPTION 'Unexpected column privilege % on %.%', p, x.relname, x.attname;
            END IF;
        END LOOP;
    END LOOP;
    IF EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public' AND c.relkind = 'S'
        AND (has_sequence_privilege('noveltail_runtime', c.oid, 'USAGE')
          OR has_sequence_privilege('noveltail_runtime', c.oid, 'SELECT')
          OR has_sequence_privilege('noveltail_runtime', c.oid, 'UPDATE')))
       OR EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = 'public'
          AND has_function_privilege('noveltail_runtime', p.oid, 'EXECUTE')) THEN
        RAISE EXCEPTION 'Unexpected effective sequence or routine privileges';
    END IF;
END $$;

-- Transaction intentionally remains open for required same-session validation.
```

Set a credential only after approval, via the approved secret manager or interactive `\password noveltail_runtime`; never place it in a SQL file or command history. Do not automatically revoke routine privileges from `PUBLIC`: PostgreSQL normally grants `EXECUTE` on new functions to `PUBLIC`, so the candidate will block if any such routine is effectively executable. Before any separately approved change, inventory all callers, other users and routines (including overloads and security-definer functions). Existing trigger invocation does not recheck runtime EXECUTE, but creating a trigger requires EXECUTE. `create_user_wallet()` is a trigger function, not an ordinary SQL-callable function. The disposable registration test does not prove all other consumers are safe.

Before commit, an error aborts the transaction; explicitly roll back or disconnect. The standalone grant block can be rerun under unchanged prerequisites, but the new forward-recovery deployment path must reject any pre-existing role. It does not verify other schemas/databases, row-level security, `SECURITY DEFINER` side effects or cascades, and does not guarantee future objects stay compliant. Review those separately. The forward-recovery proposal requires the recorded baseline and must never grant broad rights to `PUBLIC`.

## Disposable rehearsal

The historical harness is:

```powershell
node scripts\test-runtime-role.js
```

**Do not run it under the current disposable-only instruction:** it contacts the configured source for a read-only identity check and schema-only dump. It also applies the **old** matrix, not the corrected column grants or the final candidate above, and restores with `--no-owner --no-acl`; it cannot establish the source's effective ACLs, ownership or default privileges. Its historical application coverage was limited to:

- `tests/integration.test.js` — Login, Wallet and chapter unlock/refund, moderation, suspension and Appeals integration coverage.
- `tests/reports-announcements.test.js` — Reports, Announcements and notification coverage.

The harness asserts no superuser, `CREATEDB`, `CREATEROLE`, `BYPASSRLS`, role memberships, schema/database persistent `CREATE`, table grant options, excess table privileges, sequence privileges, or custom public function `EXECUTE`. It attempts `CREATE TABLE`, `ALTER TABLE`, `DROP TABLE`, and `TRUNCATE` as the runtime role and expects privilege denials. It verifies the migration-005 shared rate-limit table is absent and does not apply or test migration 005. The temporary server, test role, test database, and schema dump are removed at the end.

Historical result: exit code 0, three targeted tests passed, but reaction upserts were not covered. The new synthetic-cluster checks are reported separately in `runtime-validation-report.md`; they are not a full-schema application rehearsal. No full QA was rerun.

The subsequent focused rehearsal executed the **actual reaction router** against synthetic tables and this document's candidate grants in a new disposable PostgreSQL 18.6 cluster. The old matrix returned permission errors for both upserts; with the corrected column grants, both initial insert and conflict update passed, as did validation, delete and denied ledger mutations. The test injected a test user in place of authentication and used `SET ROLE noveltail_runtime` on an isolated administrator session; it did not test a real runtime login, the complete server, CSRF, or the real schema. It copied no source schema or data and did not connect to the configured database. See the latest report for rollback and scope details.

## Owner inventory before approval

The following queries are for an owner to run read-only on a separately approved target; they were **not** run on the configured database in this follow-up. Save the results, including grantors, before any change. An empty `pg_default_acl` result does not mean no default rights: PostgreSQL's built-in defaults include function `EXECUTE` for `PUBLIC`. Global defaults and per-schema defaults combine; defaults belong to each creating role and are not inherited from roles it belongs to. Review every creator, including migration identities.

```sql
BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY;

SELECT current_database(), current_user, current_setting('server_version');
SELECT r.rolname, r.rolcanlogin, r.rolinherit, r.rolsuper, r.rolcreatedb,
       r.rolcreaterole, r.rolbypassrls, r.rolreplication FROM pg_roles r
WHERE r.rolname = 'noveltail_runtime';
SELECT member.rolname AS member, parent.rolname AS granted_role, m.*
FROM pg_auth_members m
JOIN pg_roles member ON member.oid = m.member
JOIN pg_roles parent ON parent.oid = m.roleid
ORDER BY member.rolname, parent.rolname;

SELECT datname, oid, pg_get_userbyid(datdba) AS owner, datacl,
       CASE WHEN datacl IS NULL THEN 'NULL'
            WHEN cardinality(datacl) = 0 THEN 'EMPTY' ELSE 'ENTRIES' END AS acl_state
FROM pg_database WHERE datname = current_database();
SELECT nspname, oid, pg_get_userbyid(nspowner) AS owner, nspacl,
       CASE WHEN nspacl IS NULL THEN 'NULL'
            WHEN cardinality(nspacl) = 0 THEN 'EMPTY' ELSE 'ENTRIES' END AS acl_state
FROM pg_namespace WHERE nspname = 'public';
SELECT c.relkind, c.relname, c.oid, pg_get_userbyid(c.relowner) AS owner,
       c.relacl, CASE WHEN c.relacl IS NULL THEN 'NULL'
            WHEN cardinality(c.relacl) = 0 THEN 'EMPTY' ELSE 'ENTRIES' END AS acl_state,
       c.relrowsecurity, c.relforcerowsecurity
FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public' AND c.relkind IN ('r','p','S','v','m','f')
ORDER BY c.relkind, c.relname;
SELECT c.relname, c.oid, a.attnum, a.attname, a.attacl,
       CASE WHEN a.attacl IS NULL THEN 'NULL'
            WHEN cardinality(a.attacl) = 0 THEN 'EMPTY' ELSE 'ENTRIES' END AS acl_state
FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
JOIN pg_attribute a ON a.attrelid = c.oid
WHERE n.nspname = 'public' AND a.attnum > 0 AND NOT a.attisdropped
ORDER BY c.relname, a.attname;
SELECT p.oid, p.oid::regprocedure AS signature, p.prokind,
       pg_get_userbyid(p.proowner) AS owner, p.prosecdef, p.proacl,
       CASE WHEN p.proacl IS NULL THEN 'NULL'
            WHEN cardinality(p.proacl) = 0 THEN 'EMPTY' ELSE 'ENTRIES' END AS acl_state
FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public' ORDER BY 1;
SELECT d.oid, pg_get_userbyid(d.defaclrole) AS creator,
       COALESCE(n.nspname, '<global>') AS schema_scope,
       d.defaclobjtype, d.defaclacl,
       CASE WHEN d.defaclacl IS NULL THEN 'NULL'
            WHEN cardinality(d.defaclacl) = 0 THEN 'EMPTY' ELSE 'ENTRIES' END AS acl_state
FROM pg_default_acl d LEFT JOIN pg_namespace n ON n.oid = d.defaclnamespace
WHERE d.defaclnamespace = 0 OR n.nspname = 'public'
ORDER BY 1, 2, 3;

WITH object_acls AS (
    SELECT 'database'::text AS kind, d.datname::text AS object_name,
           d.datacl AS raw_acl, COALESCE(d.datacl, acldefault('d', d.datdba)) AS expanded_acl
    FROM pg_database d WHERE d.datname = current_database()
    UNION ALL
    SELECT 'schema', n.nspname::text, n.nspacl,
           COALESCE(n.nspacl, acldefault('n', n.nspowner))
    FROM pg_namespace n WHERE n.nspname = 'public'
    UNION ALL
    SELECT CASE WHEN c.relkind = 'S' THEN 'sequence' ELSE 'relation' END,
           c.relname::text, c.relacl,
           COALESCE(c.relacl, acldefault(
               CASE WHEN c.relkind = 'S' THEN 's'::"char" ELSE 'r'::"char" END, c.relowner))
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relkind IN ('r','p','S','v','m','f')
    UNION ALL
    SELECT 'routine', p.oid::regprocedure::text, p.proacl,
           COALESCE(p.proacl, acldefault('f', p.proowner))
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
    UNION ALL
    SELECT 'column', format('%I.%I', c.relname, a.attname), a.attacl, a.attacl
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    JOIN pg_attribute a ON a.attrelid = c.oid
    WHERE n.nspname = 'public' AND c.relkind IN ('r','p','v','m','f')
      AND a.attnum > 0 AND NOT a.attisdropped
)
SELECT o.kind, o.object_name, o.raw_acl,
       pg_get_userbyid(a.grantor) AS grantor,
       CASE WHEN a.grantee = 0 THEN 'PUBLIC' ELSE pg_get_userbyid(a.grantee) END AS grantee,
       a.privilege_type, a.is_grantable
FROM object_acls o CROSS JOIN LATERAL aclexplode(o.expanded_acl) a
ORDER BY o.kind, o.object_name, grantor, grantee, a.privilege_type;

COMMIT;
```

Preserve **all** raw query result sets, including NULL columns, as typed JSON or another format that retains SQL NULL separately from an empty array and retains ACL entry order. Record object identity, owner, ACL state, role attributes and memberships; compare the entire row sets, including missing or new objects and default-ACL rows, not just entries returned by `aclexplode`. When comparing in PostgreSQL, use `IS NOT DISTINCT FROM` on the original ACL arrays and compare the identity/owner keys separately. OIDs are useful for a physical recovery of the same cluster but are not stable across logical recreations. Capture with no concurrent ACL changes and keep the baseline immutable.

The expanded query emits rows only for ACL entries and does not replace the raw inventory. It expands database, schema, relation, sequence and routine built-in defaults, and explicit column entries; it is not a transitive effective-privilege or future-default calculation. ACL `NULL` means PostgreSQL's built-in defaults, not no access. A missing default-ACL row is distinct from an explicit empty row. Inspect direct, `PUBLIC`, membership and transitive/`SET ROLE` paths, object owners, column ACLs, grant options, other schemas/databases, trigger and security-definer effects, and default ACLs. The inventory above scopes the target database and `public` schema; for a whole-cluster recovery, the owner must also inventory other databases and relevant cluster-wide objects. Once the role exists, the candidate's `has_*_privilege` checks test current effective rights, including `PUBLIC`; they do not prove future defaults or indirect execution paths.

## Rollback

**Post-commit ACL-only exact rollback: FAIL.** No supported SQL inverse has been established that restores a prior `NULL` raw ACL on an existing object without affecting other data or dependencies. Do not use `DROP OWNED`, generic GRANT/REVOKE, direct system-catalog updates, or object recreation as an exact-raw rollback. They are not an approved substitute for the requested equality. The old role-removal SQL has therefore been withdrawn; its effective-equivalence result is historical only.

Before `COMMIT`, an error under `ON_ERROR_STOP=1` aborts the transaction; issue:

```sql
ROLLBACK;
```

For a no-commit preview, replace the candidate's final `COMMIT;` with `ROLLBACK;`, avoid application writes, and compare the complete raw snapshots. This is not a post-commit rollback.

### Historical physical-restore experiment

The prior disposable experiment recovered raw ACLs by restoring an entire cluster, but lost a post-backup synthetic row. **Do not use physical restore for this permission deployment.** The new [forward-recovery design](./runtime-permission-deployment.md) preserves data in its scoped test but restores effective, not raw-exact, privileges and needs explicit owner acceptance.

## Owner verification after an approved setup

Connect as the runtime login and check the effective privileges, not only direct role grants:

```sql
SELECT current_database(), current_user;

SELECT r.rolsuper, r.rolcreatedb, r.rolcreaterole, r.rolbypassrls, r.rolreplication,
       has_database_privilege(current_user, current_database(), 'CONNECT')
           AS can_connect,
       has_database_privilege(current_user, current_database(), 'CREATE')
           AS can_create_database_objects,
       has_database_privilege(current_user, current_database(), 'TEMPORARY')
           AS can_create_temporary_objects,
       has_schema_privilege(current_user, 'public', 'USAGE') AS can_use_public,
       has_schema_privilege(current_user, 'public', 'CREATE') AS can_create_in_public
FROM pg_roles r
WHERE r.rolname = current_user;

SELECT pg_has_role(current_user, 'pg_read_all_data', 'MEMBER')
       OR pg_has_role(current_user, 'pg_write_all_data', 'MEMBER')
       AS has_broad_builtin_membership;

SELECT c.relname,
       has_table_privilege(current_user, c.oid, 'SELECT') AS can_select,
       has_table_privilege(current_user, c.oid, 'INSERT') AS can_insert,
       has_table_privilege(current_user, c.oid, 'UPDATE') AS can_update,
       has_table_privilege(current_user, c.oid, 'DELETE') AS can_delete,
       has_table_privilege(current_user, c.oid, 'TRUNCATE') AS can_truncate,
       has_table_privilege(current_user, c.oid, 'TRIGGER') AS can_create_trigger,
       has_table_privilege(current_user, c.oid, 'REFERENCES') AS can_reference
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p')
ORDER BY c.relname;
```

Also check per-column rights with `has_column_privilege`: the two reaction tables have column-level UPDATE even though `has_table_privilege(..., 'UPDATE')` is false, and every `wallet_transactions` column must lack UPDATE. Verify ownership, memberships, routines, grant options and all other objects. Validate writes, rollback, wallet reversals, reactions, notifications, Appeals, Reports, and Admin authorization in a disposable environment. Never test destructive permission boundaries against the live database.

For the reaction and ledger checks, after the role exists:

```sql
SELECT c.relname, a.attname,
       has_column_privilege('noveltail_runtime', c.oid, a.attname, 'UPDATE') AS can_update,
       has_column_privilege('noveltail_runtime', c.oid, a.attname, 'UPDATE WITH GRANT OPTION') AS can_grant_update
FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
JOIN pg_attribute a ON a.attrelid = c.oid
WHERE n.nspname = 'public'
  AND c.relname IN ('comment_reactions', 'review_reactions', 'wallet_transactions')
  AND a.attnum > 0 AND NOT a.attisdropped
ORDER BY c.relname, a.attnum;

SELECT has_table_privilege('noveltail_runtime', 'public.wallet_transactions', 'UPDATE') AS wallet_update,
       has_table_privilege('noveltail_runtime', 'public.wallet_transactions', 'DELETE') AS wallet_delete,
       has_any_column_privilege('noveltail_runtime', 'public.wallet_transactions', 'UPDATE') AS any_wallet_column_update;
```

Only `reaction_type` and `updated_at` should have column UPDATE on either reaction table; all grant-option results and all ledger UPDATE/DELETE results must be false. Run the owner inventory and resolve any `PUBLIC` or inherited rights before relying on this result.

## Live-database owner checklist

The rehearsal did not make changes to `Noveltail`. Before production use, the database owner must:

1. Recheck the target database/host/port, schema, migrations 001–004, and current live grants.
2. Review inherited `PUBLIC` privileges, role memberships, object ownership, custom routine execution, and any application-specific environment constraints.
3. Use an approved backup/change procedure; create the runtime role and set its credential interactively through the owner-approved secret-management workflow.
4. Apply the reviewed grants to the intended database only; do not apply migration 005 as part of this role change.
5. Do not treat this pre-005 proposal as production-ready: production startup requires the separately approved shared-rate-limit migration and its additional grants. Only after that separate gate, configure the application through the secret manager and perform approved startup/workflow checks.
6. Keep the migration/administration credential separate from the application environment and record the actual owner-run verification results.
