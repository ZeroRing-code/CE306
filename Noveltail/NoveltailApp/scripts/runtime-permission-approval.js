"use strict";

const crypto = require("node:crypto");

const CANDIDATE_SHA256 = "f6739f2cdbbc902749a6790ada777bb23b870290b28405fcba641f9f8178f9c1";
const RECOVERY_SHA256 = "25c88defd425a9dae78e8047bdd4700a578a52f0244ff00f55d9134a3984b893";
const READ_TABLES = [
    "account_suspensions", "admin_action_logs", "announcement_recipients",
    "announcements", "appeal_assignments", "appeals", "bookmarks",
    "chapter_unlocks", "chapters", "comments", "comment_reactions",
    "follows", "genres", "notifications", "novel_genres", "novels",
    "reading_history", "reports", "review_reactions", "reviews", "users",
    "wallet_transactions", "wallets"
];
const UPDATE_TABLES = [
    "account_suspensions", "announcement_recipients", "announcements",
    "appeal_assignments", "appeals", "chapters", "comments", "notifications",
    "novels", "reading_history", "reports", "reviews", "users", "wallets"
];
const DELETE_TABLES = [
    "bookmarks", "chapter_unlocks", "chapters", "comments",
    "comment_reactions", "follows", "notifications", "novel_genres",
    "novels", "reading_history", "review_reactions", "reviews"
];
const OTHER_TABLES = [
    "chapter_revisions", "comment_mentions", "novel_follows", "novel_likes",
    "novel_revisions"
];
const SEQUENCES = [
    "account_suspensions_suspension_id_seq", "admin_action_logs_log_id_seq",
    "announcements_announcement_id_seq", "appeal_assignments_assignment_id_seq",
    "appeals_appeal_id_seq", "bookmarks_bookmark_id_seq",
    "chapter_revisions_revision_id_seq", "chapters_chapter_id_seq",
    "comment_mentions_mention_id_seq", "comments_comment_id_seq",
    "genres_genre_id_seq", "notifications_notification_id_seq",
    "novel_likes_like_id_seq", "novel_revisions_revision_id_seq",
    "novels_novel_id_seq", "reading_history_history_id_seq",
    "reports_report_id_seq", "reviews_review_id_seq", "users_user_id_seq",
    "wallet_transactions_transaction_id_seq"
];

function hash(value) {
    return crypto.createHash("sha256").update(value).digest("hex");
}

function sameStrings(actual, expected) {
    return Array.isArray(actual) &&
        JSON.stringify([...actual].sort()) === JSON.stringify([...expected].sort());
}

function tableGrants(sql, privilege) {
    const pattern = new RegExp(
        `\\bGRANT\\s+${privilege}\\s+ON\\s+TABLE\\s+([\\s\\S]*?)\\s+TO\\s+noveltail_runtime\\s*;`,
        "gi"
    );
    const matches = [...sql.matchAll(pattern)];
    if (matches.length !== 1) return null;
    const names = matches[0][1].split(",").map(value => value.trim());
    if (!names.every(value => /^public\.[a-z_]+$/.test(value))) return null;
    return names.map(value => value.slice("public.".length));
}

function matrixMatches(sql) {
    const inserts = READ_TABLES.filter(name => name !== "genres");
    const columnGrant = table => new RegExp(
        `\\bGRANT\\s+UPDATE\\s*\\(\\s*reaction_type\\s*,\\s*updated_at\\s*\\)` +
        `\\s+ON\\s+TABLE\\s+public\\.${table}\\s+TO\\s+noveltail_runtime\\s*;`,
        "gi"
    );
    const columnMatches = ["comment_reactions", "review_reactions"]
        .every(table => [...sql.matchAll(columnGrant(table))].length === 1);
    const allColumnGrants = [...sql.matchAll(/\bGRANT\s+UPDATE\s*\(/gi)];
    return sameStrings(tableGrants(sql, "SELECT"), READ_TABLES) &&
        sameStrings(tableGrants(sql, "INSERT"), inserts) &&
        sameStrings(tableGrants(sql, "UPDATE"), UPDATE_TABLES) &&
        sameStrings(tableGrants(sql, "DELETE"), DELETE_TABLES) &&
        columnMatches && allColumnGrants.length === 2;
}

async function captureActiveBaseline(client) {
    if (typeof client.getTransactionStatus !== "function" ||
        client.getTransactionStatus() !== "T") {
        throw new Error("Catalog capture requires an active transaction on an exclusively owned client.");
    }
    await client.query("SET LOCAL search_path = pg_catalog");
    const identity = (await client.query(`SELECT current_database() AS database,
        current_user AS capture_user, host(inet_server_addr()) AS host,
        inet_server_port() AS port, current_setting('server_version_num') AS version,
        (SELECT oid::text FROM pg_database WHERE datname=current_database()) AS database_oid,
        (SELECT datdba::text FROM pg_database WHERE datname=current_database()) AS database_owner_oid,
        (SELECT oid::text FROM pg_namespace WHERE nspname='public') AS schema_oid,
        (SELECT nspowner::text FROM pg_namespace WHERE nspname='public') AS schema_owner_oid,
        (pg_control_system()).system_identifier::text AS system_identifier`)).rows[0];
    const shared = (await client.query(`SELECT d.datacl::text AS database_acl,
        n.nspacl::text AS schema_acl,
        EXISTS (SELECT 1 FROM aclexplode(COALESCE(d.datacl,acldefault('d',d.datdba))) a
                WHERE a.grantee=0 AND a.privilege_type='TEMPORARY') AS public_temporary,
        EXISTS (SELECT 1 FROM aclexplode(COALESCE(n.nspacl,acldefault('n',n.nspowner))) a
                WHERE a.grantee=0 AND a.privilege_type='CREATE') AS public_schema_create
        FROM pg_database d CROSS JOIN pg_namespace n
        WHERE d.datname=current_database() AND n.nspname='public'`)).rows[0];
    const relations = (await client.query(`SELECT c.relkind, c.relname, c.oid::text AS oid,
        c.relowner::text AS owner_oid, c.relacl::text AS acl,
        c.relrowsecurity, c.relforcerowsecurity,
        EXISTS (SELECT 1 FROM aclexplode(COALESCE(c.relacl,acldefault(
            CASE WHEN c.relkind='S' THEN 's'::"char" ELSE 'r'::"char" END,c.relowner))) a
            WHERE a.grantee=0) AS public_grant
        FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
        WHERE n.nspname='public' AND c.relkind IN ('r','p','S','v','m','f')
        ORDER BY c.relkind,c.relname`)).rows;
    const columns = (await client.query(`SELECT c.oid::text AS relation_oid,
        c.relname, a.attnum, a.attname, a.attacl::text AS acl,
        format_type(a.atttypid,a.atttypmod) AS type, a.attnotnull, a.attidentity,
        pg_get_expr(d.adbin,d.adrelid) AS default_expression,
        EXISTS (SELECT 1 FROM aclexplode(a.attacl) x WHERE x.grantee=0) AS public_grant
        FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
        JOIN pg_attribute a ON a.attrelid=c.oid
        LEFT JOIN pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum
        WHERE n.nspname='public' AND c.relkind IN ('r','p','v','m','f')
          AND a.attnum>0 AND NOT a.attisdropped ORDER BY c.relname,a.attnum`)).rows;
    const routines = (await client.query(`SELECT p.oid::text AS oid,
        p.proname, p.pronargs, p.prorettype::regtype::text AS result_type,
        p.oid::regprocedure::text AS signature, p.proowner::text AS owner_oid,
        p.prokind, p.prosecdef, p.proacl::text AS acl, p.prosrc, p.proconfig,
        CASE WHEN p.prokind IN ('f','p') THEN pg_get_functiondef(p.oid) END AS definition,
        EXISTS (SELECT 1 FROM aclexplode(COALESCE(p.proacl,acldefault('f',p.proowner))) a
                WHERE a.grantee=0 AND a.privilege_type='EXECUTE') AS public_execute
        FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
        WHERE n.nspname='public' ORDER BY p.oid::regprocedure::text`)).rows;
    const defaults = (await client.query(`SELECT d.defaclrole::text AS creator_oid,
        d.defaclnamespace::text AS schema_oid, d.defaclobjtype, d.defaclacl::text AS acl
        FROM pg_default_acl d LEFT JOIN pg_namespace n ON n.oid=d.defaclnamespace
        WHERE d.defaclnamespace=0 OR n.nspname='public'
        ORDER BY d.defaclrole,d.defaclnamespace,d.defaclobjtype`)).rows;
    const triggers = (await client.query(`SELECT c.oid::text AS relation_oid,
        c.relname,t.tgfoid::text AS routine_oid,t.tgname,t.tgenabled,
        pg_get_triggerdef(t.oid) AS definition
        FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid
        JOIN pg_namespace n ON n.oid=c.relnamespace
        WHERE n.nspname='public' AND NOT t.tgisinternal ORDER BY c.oid,t.tgname`)).rows;
    const policies = (await client.query(`SELECT schemaname,tablename,policyname,
        permissive,roles,cmd,qual,with_check FROM pg_policies
        WHERE schemaname='public' ORDER BY tablename,policyname`)).rows;
    const constraints = (await client.query(`SELECT c.oid::text AS relation_oid,
        x.conname,x.contype,pg_get_constraintdef(x.oid) AS definition
        FROM pg_constraint x JOIN pg_class c ON c.oid=x.conrelid
        JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public'
        ORDER BY c.oid,x.conname`)).rows;
    const indexes = (await client.query(`SELECT c.oid::text AS relation_oid,
        i.indexrelid::text AS index_oid, i.indisvalid, i.indisready,
        pg_get_indexdef(i.indexrelid) AS definition
        FROM pg_index i JOIN pg_class c ON c.oid=i.indrelid
        JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public'
        ORDER BY c.oid,i.indexrelid`)).rows;
    const roles = (await client.query(`SELECT oid::text AS oid,rolname,rolsuper,
        rolinherit,rolcreaterole,rolcreatedb,rolcanlogin,rolreplication,rolbypassrls,
        rolconnlimit,rolvaliduntil::text,rolconfig
        FROM pg_roles ORDER BY oid`)).rows;
    const memberships = (await client.query(`SELECT roleid::text,member::text,
        grantor::text,admin_option,inherit_option,set_option
        FROM pg_auth_members ORDER BY roleid,member,grantor`)).rows;
    const migration = (await client.query(`SELECT
        to_regclass('public.rate_limit_buckets') IS NOT NULL AS table_exists,
        to_regclass('public.rate_limit_buckets_expires_at_idx') IS NOT NULL AS index_exists`)).rows[0];
    return { identity, shared, relations, columns, routines, defaults, triggers,
        policies, constraints, indexes, roles, memberships, migration };
}

async function captureBaseline(client) {
    if (typeof client.getTransactionStatus !== "function" ||
        client.getTransactionStatus() !== "I") {
        throw new Error("Baseline capture requires an idle, exclusively owned PostgreSQL client.");
    }
    await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
    try {
        const snapshot = await captureActiveBaseline(client);
        await client.query("COMMIT");
        return snapshot;
    } catch (error) {
        try {
            await client.query("ROLLBACK");
        } catch (rollbackError) {
            throw new AggregateError([error, rollbackError], "Baseline capture and rollback failed.");
        }
        throw error;
    }
}

function validateApproval({ payload, signature, trustedPublicKey, snapshot,
    candidateSql, recoverySql, now = Date.now() }) {
    const failures = [];
    const checks = {};
    function check(name, passed) {
        checks[name] = Boolean(passed);
        if (!passed) failures.push(name);
    }

    const key = crypto.createPublicKey(trustedPublicKey);
    const signatureValid = key.asymmetricKeyType === "ed25519" &&
        Buffer.isBuffer(payload) && Buffer.isBuffer(signature) &&
        crypto.verify(null, payload, key, signature);
    check("owner_signature", signatureValid);
    if (!signatureValid) return { checks, failures, deploymentAllowed: false };

    let approval;
    try {
        approval = JSON.parse(payload.toString("utf8"));
    } catch (error) {
        if (!(error instanceof SyntaxError)) throw error;
        check("approval_format", false);
        return { checks, failures, deploymentAllowed: false };
    }
    if (!approval || typeof approval !== "object" || Array.isArray(approval)) {
        check("approval_format", false);
        return { checks, failures, deploymentAllowed: false };
    }
    const issued = Date.parse(approval.issued_at);
    const expires = Date.parse(approval.expires_at);
    check("approval_format", approval.version === 1 &&
        approval.purpose === "noveltail-runtime-deployment" &&
        typeof approval.issued_at === "string" && typeof approval.expires_at === "string" &&
        Number.isFinite(issued) && Number.isFinite(expires) &&
        issued <= now && now < expires && expires > issued &&
        expires - issued <= 24 * 60 * 60 * 1000);
    check("baseline", approval.baseline_sha256 === hash(JSON.stringify(snapshot)) &&
        approval.target_database === "Noveltail" &&
        approval.target_database === snapshot.identity.database &&
        typeof snapshot.identity.host === "string" && Number.isInteger(snapshot.identity.port) &&
        approval.target_database_oid === snapshot.identity.database_oid &&
        approval.target_schema_oid === snapshot.identity.schema_oid &&
        approval.target_system_identifier === snapshot.identity.system_identifier);
    check("permission_matrix", typeof candidateSql === "string" &&
        approval.candidate_sha256 === hash(candidateSql) &&
        hash(candidateSql) === CANDIDATE_SHA256 && matrixMatches(candidateSql));

    const tables = snapshot.relations.filter(row => row.relkind === "r" || row.relkind === "p");
    const sequences = snapshot.relations.filter(row => row.relkind === "S");
    const decisions = approval.public_objects;
    const expectedObjects = [...tables, ...sequences].map(row => ({
        oid: row.oid, name: row.relname, kind: row.relkind, decision: "retain-no-public"
    })).sort((a, b) => a.oid.localeCompare(b.oid));
    const actualObjects = Array.isArray(decisions)
        ? [...decisions].sort((a, b) => String(a.oid).localeCompare(String(b.oid)))
        : [];
    check("public_acl_decision", sameStrings(tables.map(row => row.relname), [...READ_TABLES, ...OTHER_TABLES]) &&
        sameStrings(sequences.map(row => row.relname), SEQUENCES) &&
        JSON.stringify(actualObjects) === JSON.stringify(expectedObjects) &&
        snapshot.relations.every(row => !row.public_grant) &&
        snapshot.columns.every(row => !row.public_grant) &&
        snapshot.routines.every(row => !row.public_execute) &&
        snapshot.routines.some(row => row.proname === "create_user_wallet" &&
            row.pronargs === 0 && row.result_type === "trigger" && !row.prosecdef &&
            snapshot.triggers.some(trigger => trigger.relname === "users" &&
                trigger.tgname === "users_create_wallet" &&
                ["O", "A"].includes(trigger.tgenabled) &&
                trigger.routine_oid === row.oid)) &&
        !snapshot.shared.public_temporary && !snapshot.shared.public_schema_create &&
        approval.public_temporary === "absent-approved" &&
        approval.public_routine_execute === "absent-approved");

    const eligibleDrift = tables.filter(row => READ_TABLES.includes(row.relname) && row.acl === null)
        .map(row => row.oid);
    const allowedDrift = approval.allowed_raw_drift_table_oids;
    check("raw_acl_drift_policy", approval.raw_acl_policy === "null-to-owner-default-only" &&
        Array.isArray(allowedDrift) && new Set(allowedDrift).size === allowedDrift.length &&
        allowedDrift.every(oid => eligibleDrift.includes(oid)) &&
        approval.raw_acl_checks === "identities-owners-grantors-options-memberships-defaults-public-rls-triggers");
    check("recovery_plan", typeof recoverySql === "string" &&
        approval.recovery_sha256 === hash(recoverySql) &&
        hash(recoverySql) === RECOVERY_SHA256 &&
        approval.recovery_plan === "fresh-role-only-targeted-forward" &&
        !snapshot.roles.some(role => role.rolname === "noveltail_runtime"));
    check("migration_observation", approval.migration_005 ===
        (snapshot.migration.table_exists ? "present" : "absent") &&
        snapshot.migration.table_exists === snapshot.migration.index_exists);

    // The documented candidate explicitly rejects 005, while production requires it.
    check("production_migration_compatibility", false);
    return { checks, failures, deploymentAllowed: false };
}

module.exports = {
    captureActiveBaseline, captureBaseline, hash, matrixMatches, validateApproval,
    RECOVERY_SHA256,
    permissionMatrix: { reads: READ_TABLES, updates: UPDATE_TABLES, deletes: DELETE_TABLES }
};
