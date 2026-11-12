"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { test } = require("node:test");
const { hash, matrixMatches, validateApproval } =
    require("../scripts/runtime-permission-approval");

const root = path.join(__dirname, "..");
function sqlBlock(file, heading) {
    const text = fs.readFileSync(path.join(root, file), "utf8");
    const section = text.slice(text.indexOf(heading));
    const match = /```sql\r?\n([\s\S]*?)\r?\n```/.exec(section);
    assert.ok(match, `Missing SQL block in ${file}`);
    return match[1];
}

const candidateSql = sqlBlock("docs\\database-permissions.md", "## Owner-operated SQL template");
const recoverySql = sqlBlock("docs\\runtime-permission-deployment.md", "## 4. Post-commit forward-recovery SQL");
const inventory = fs.readFileSync(
    path.join(root, "docs", "database-permissions-owner-decision.md"), "utf8"
);
const tableNames = [...inventory.matchAll(/^\| ([a-z_]+) \| S=0 I=0 U=0 D=0 T=0 R=0 G=0 \|/gm)]
    .map(match => match[1]);
const sequenceNames = [...inventory.matchAll(/^\| ([a-z_]+_seq) \| USAGE=0 SELECT=0 UPDATE=0 \|/gm)]
    .map(match => match[1]);
const grantedTables = [
    "account_suspensions", "admin_action_logs", "announcement_recipients",
    "announcements", "appeal_assignments", "appeals", "bookmarks",
    "chapter_unlocks", "chapters", "comments", "comment_reactions",
    "follows", "genres", "notifications", "novel_genres", "novels",
    "reading_history", "reports", "review_reactions", "reviews", "users",
    "wallet_transactions", "wallets"
];
const { publicKey, privateKey } = crypto.generateKeyPairSync("ed25519");
const trustedPublicKey = publicKey.export({ type: "spki", format: "pem" });
const now = Date.parse("2026-01-01T00:00:00Z");

function fixture() {
    assert.equal(tableNames.length, 28);
    assert.equal(sequenceNames.length, 20);
    const relations = [...tableNames.map(relname => ({ relname, relkind: "r" })),
        ...sequenceNames.map(relname => ({ relname, relkind: "S" }))]
        .map((row, index) => ({
            ...row, oid: String(index + 1), owner_oid: "10", acl: null,
            public_grant: false
        }));
    return {
        identity: {
            database: "Noveltail", database_oid: "20", schema_oid: "30",
            system_identifier: "12345", host: "127.0.0.1", port: 54321
        },
        shared: { public_temporary: false, public_schema_create: false },
        relations,
        columns: [],
        routines: [{ oid: "50", proname: "create_user_wallet", pronargs: 0,
            result_type: "trigger", prosecdef: false, public_execute: false }],
        triggers: [{ relname: "users", tgname: "users_create_wallet",
            tgenabled: "O", routine_oid: "50" }],
        defaults: [], policies: [], constraints: [], indexes: [], roles: [],
        memberships: [], migration: { table_exists: false, index_exists: false }
    };
}

function approvalFor(snapshot) {
    return {
        version: 1, purpose: "noveltail-runtime-deployment",
        issued_at: "2025-12-31T23:00:00Z", expires_at: "2026-01-01T23:00:00Z",
        target_database: snapshot.identity.database,
        target_database_oid: snapshot.identity.database_oid,
        target_schema_oid: snapshot.identity.schema_oid,
        target_system_identifier: snapshot.identity.system_identifier,
        baseline_sha256: hash(JSON.stringify(snapshot)),
        candidate_sha256: hash(candidateSql),
        recovery_sha256: hash(recoverySql),
        public_objects: snapshot.relations.map(row => ({
            oid: row.oid, name: row.relname, kind: row.relkind, decision: "retain-no-public"
        })),
        public_temporary: "absent-approved",
        public_routine_execute: "absent-approved",
        raw_acl_policy: "null-to-owner-default-only",
        allowed_raw_drift_table_oids: snapshot.relations
            .filter(row => row.relkind === "r" && row.acl === null &&
                grantedTables.includes(row.relname)).map(row => row.oid),
        raw_acl_checks: "identities-owners-grantors-options-memberships-defaults-public-rls-triggers",
        recovery_plan: "fresh-role-only-targeted-forward",
        migration_005: "absent"
    };
}

function validate(snapshot, approval, overrides = {}) {
    const payload = Buffer.from(JSON.stringify(approval));
    const signature = crypto.sign(null, payload, privateKey);
    return validateApproval({
        payload, signature, trustedPublicKey, snapshot, candidateSql, recoverySql,
        now, ...overrides
    });
}

test("valid signed evidence remains blocked by the incompatible migration", () => {
    const snapshot = fixture();
    const result = validate(snapshot, approvalFor(snapshot));
    assert.deepEqual(result.failures, ["production_migration_compatibility"]);
    assert.equal(result.deploymentAllowed, false);
    assert.equal(matrixMatches(candidateSql), true);
});

test("rejects forged, expired, missing and changed approvals", () => {
    const snapshot = fixture();
    const approval = approvalFor(snapshot);
    assert.equal(validate(snapshot, approval, { signature: Buffer.alloc(64) })
        .checks.owner_signature, false);
    const other = crypto.generateKeyPairSync("ed25519").publicKey
        .export({ type: "spki", format: "pem" });
    assert.equal(validate(snapshot, approval, { trustedPublicKey: other })
        .checks.owner_signature, false);
    approval.expires_at = "2025-12-31T23:59:59Z";
    assert.equal(validate(snapshot, approval).checks.approval_format, false);
    delete approval.raw_acl_policy;
    assert.equal(validate(snapshot, approval).checks.raw_acl_drift_policy, false);
});

test("rejects changed baseline and any extra candidate grant even if re-signed", () => {
    const snapshot = fixture();
    const approval = approvalFor(snapshot);
    snapshot.relations[0].owner_oid = "999";
    assert.equal(validate(snapshot, approval).checks.baseline, false);
    const modifiedSql = `${candidateSql}\nGRANT UPDATE ON public.wallet_transactions TO noveltail_runtime;`;
    approval.candidate_sha256 = hash(modifiedSql);
    assert.equal(validate(snapshot, approval, { candidateSql: modifiedSql })
        .checks.permission_matrix, false);
});

test("requires every PUBLIC decision and verifies shared grants and trigger", () => {
    const snapshot = fixture();
    const approval = approvalFor(snapshot);
    approval.public_objects.pop();
    assert.equal(validate(snapshot, approval).checks.public_acl_decision, false);
    const complete = approvalFor(snapshot);
    snapshot.relations[0].public_grant = true;
    assert.equal(validate(snapshot, complete).checks.public_acl_decision, false);
    snapshot.relations[0].public_grant = false;
    snapshot.shared.public_temporary = true;
    assert.equal(validate(snapshot, complete).checks.public_acl_decision, false);
    snapshot.shared.public_temporary = false;
    snapshot.routines[0].public_execute = true;
    assert.equal(validate(snapshot, complete).checks.public_acl_decision, false);
    snapshot.routines[0].public_execute = false;
    snapshot.triggers[0].tgenabled = "D";
    assert.equal(validate(snapshot, complete).checks.public_acl_decision, false);
});

test("rejects unapproved drift, recovery changes, existing role and migration mismatch", () => {
    const snapshot = fixture();
    const approval = approvalFor(snapshot);
    approval.allowed_raw_drift_table_oids.push("not-in-baseline");
    assert.equal(validate(snapshot, approval).checks.raw_acl_drift_policy, false);
    const corrected = approvalFor(snapshot);
    corrected.allowed_raw_drift_table_oids.pop();
    assert.equal(validate(snapshot, corrected).checks.raw_acl_drift_policy, true);
    const changedRecovery = `${recoverySql}\nDROP OWNED BY noveltail_runtime;`;
    corrected.recovery_sha256 = hash(changedRecovery);
    assert.equal(validate(snapshot, corrected, { recoverySql: changedRecovery })
        .checks.recovery_plan, false);
    corrected.recovery_sha256 = hash(recoverySql);
    snapshot.roles.push({ rolname: "noveltail_runtime" });
    assert.equal(validate(snapshot, corrected).checks.recovery_plan, false);
    snapshot.migration.table_exists = true;
    assert.equal(validate(snapshot, corrected).checks.migration_observation, false);
});

test("a report status cannot authorize deployment", () => {
    const snapshot = fixture();
    const approval = approvalFor(snapshot);
    approval.report_status = "PASS";
    const result = validate(snapshot, approval);
    assert.equal(result.deploymentAllowed, false);
    assert.ok(result.failures.includes("production_migration_compatibility"));
});
