"use strict";

const { captureActiveBaseline, hash, RECOVERY_SHA256, permissionMatrix } =
    require("./runtime-permission-approval");

async function captureRecoveryEvidence(client) {
    const snapshot = await captureActiveBaseline(client);
    const relationAcls = (await client.query(`SELECT c.oid::text AS oid,
        c.relacl IS NOT DISTINCT FROM acldefault('r', c.relowner) AS owner_default
        FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
        WHERE n.nspname='public' AND c.relkind IN ('r','p')
        ORDER BY c.oid`)).rows;
    const entries = (await client.query(`SELECT c.oid::text AS oid,
        a.grantor::text, a.grantee::text, a.privilege_type, a.is_grantable
        FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
        CROSS JOIN LATERAL aclexplode(COALESCE(c.relacl,acldefault(
            CASE WHEN c.relkind='S' THEN 's'::"char" ELSE 'r'::"char" END,c.relowner))) a
        WHERE n.nspname='public' AND c.relkind IN ('r','p','S','v','m','f')
        ORDER BY c.oid,a.grantor,a.grantee,a.privilege_type,a.is_grantable`)).rows;
    const columnEntries = (await client.query(`SELECT c.oid::text AS oid, col.attnum,
        a.grantor::text, a.grantee::text, a.privilege_type, a.is_grantable
        FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
        JOIN pg_attribute col ON col.attrelid=c.oid
        CROSS JOIN LATERAL aclexplode(col.attacl) a
        WHERE n.nspname='public' AND c.relkind IN ('r','p','v','m','f')
            AND col.attnum>0 AND NOT col.attisdropped
        ORDER BY c.oid,col.attnum,a.grantor,a.grantee,a.privilege_type,a.is_grantable`)).rows;
    const effective = await captureEffectivePrivileges(client);
    return { snapshot, relationAcls, entries, columnEntries, effective };
}

async function captureEffectivePrivileges(client) {
    return (await client.query(`
        SELECT r.oid::text AS role_oid, 'database' AS kind, d.oid::text AS object_oid,
            0 AS attnum, p.privilege,
            has_database_privilege(r.oid,d.oid,p.privilege) AS allowed,
            has_database_privilege(r.oid,d.oid,p.privilege || ' WITH GRANT OPTION') AS grantable
        FROM pg_roles r CROSS JOIN pg_database d
        CROSS JOIN (VALUES ('CONNECT'),('CREATE'),('TEMPORARY')) p(privilege)
        WHERE d.datname=current_database()
        UNION ALL
        SELECT r.oid::text, 'schema', n.oid::text, 0, p.privilege,
            has_schema_privilege(r.oid,n.oid,p.privilege),
            has_schema_privilege(r.oid,n.oid,p.privilege || ' WITH GRANT OPTION')
        FROM pg_roles r CROSS JOIN pg_namespace n
        CROSS JOIN (VALUES ('USAGE'),('CREATE')) p(privilege)
        WHERE n.nspname='public'
        UNION ALL
        SELECT r.oid::text, 'table', c.oid::text, 0, p.privilege,
            has_table_privilege(r.oid,c.oid,p.privilege),
            has_table_privilege(r.oid,c.oid,p.privilege || ' WITH GRANT OPTION')
        FROM pg_roles r CROSS JOIN pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
        CROSS JOIN (VALUES ('SELECT'),('INSERT'),('UPDATE'),('DELETE'),('TRUNCATE'),
            ('REFERENCES'),('TRIGGER'),('MAINTAIN')) p(privilege)
        WHERE n.nspname='public' AND c.relkind IN ('r','p','v','m','f')
        UNION ALL
        SELECT r.oid::text, 'column', c.oid::text, a.attnum, p.privilege,
            has_column_privilege(r.oid,c.oid,a.attnum,p.privilege),
            has_column_privilege(r.oid,c.oid,a.attnum,p.privilege || ' WITH GRANT OPTION')
        FROM pg_roles r CROSS JOIN pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
        JOIN pg_attribute a ON a.attrelid=c.oid
        CROSS JOIN (VALUES ('SELECT'),('INSERT'),('UPDATE'),('REFERENCES')) p(privilege)
        WHERE n.nspname='public' AND c.relkind IN ('r','p','v','m','f')
            AND a.attnum>0 AND NOT a.attisdropped
        UNION ALL
        SELECT r.oid::text, 'sequence', c.oid::text, 0, p.privilege,
            has_sequence_privilege(r.oid,c.oid,p.privilege),
            has_sequence_privilege(r.oid,c.oid,p.privilege || ' WITH GRANT OPTION')
        FROM pg_roles r CROSS JOIN pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
        CROSS JOIN (VALUES ('SELECT'),('USAGE'),('UPDATE')) p(privilege)
        WHERE n.nspname='public' AND c.relkind='S'
        UNION ALL
        SELECT r.oid::text, 'routine', f.oid::text, 0, 'EXECUTE',
            has_function_privilege(r.oid,f.oid,'EXECUTE'),
            has_function_privilege(r.oid,f.oid,'EXECUTE WITH GRANT OPTION')
        FROM pg_roles r CROSS JOIN pg_proc f JOIN pg_namespace n ON n.oid=f.pronamespace
        WHERE n.nspname='public'
        ORDER BY 1,2,3,4,5`)).rows;
}

function assertEqual(actual, expected, message) {
    if (JSON.stringify(actual) !== JSON.stringify(expected)) throw new Error(message);
}

function assertPostDeployment(expected, actual) {
    assertEqual(actual, expected, "Post-deployment evidence changed; recovery must stop.");
}

function verifyDeploymentEvidence(baseline, deployed, allowlist) {
    const before = baseline.snapshot;
    const after = deployed.snapshot;
    if (!Array.isArray(allowlist) || new Set(allowlist).size !== allowlist.length) {
        throw new Error("Invalid raw ACL drift allowlist.");
    }
    const eligible = new Set(before.relations.filter(row =>
        (row.relkind === "r" || row.relkind === "p") && row.acl === null
    ).map(row => row.oid));
    if (allowlist.some(oid => !eligible.has(oid))) {
        throw new Error("Allowlist contains an object not eligible in the baseline.");
    }
    const deployedRelations = new Map(after.relations.map(row => [row.oid, row]));
    for (const relation of before.relations) {
        const current = deployedRelations.get(relation.oid);
        if (eligible.has(relation.oid) && current && current.acl !== relation.acl &&
            !allowlist.includes(relation.oid)) {
            throw new Error(`Potential unapproved raw ACL drift: ${relation.oid}.`);
        }
    }
    if (before.roles.some(role => role.rolname === "noveltail_runtime")) {
        throw new Error("Runtime role existed in the baseline.");
    }
    const runtime = after.roles.filter(role => role.rolname === "noveltail_runtime");
    if (runtime.length !== 1 || !runtime[0].rolcanlogin || runtime[0].rolsuper ||
        runtime[0].rolinherit || runtime[0].rolcreaterole || runtime[0].rolcreatedb ||
        runtime[0].rolreplication || runtime[0].rolbypassrls) {
        throw new Error("Runtime role attributes are outside the matrix.");
    }
    const roleOid = runtime[0].oid;
    assertEqual(after.roles.filter(role => role.oid !== roleOid), before.roles, "Existing roles changed.");
    for (const key of ["identity", "shared", "routines", "defaults", "triggers",
        "policies", "constraints", "indexes", "memberships", "migration"]) {
        assertEqual(after[key], before[key], `Deployment changed baseline: ${key}.`);
    }
    const metadata = rows => rows.map(({ acl, ...row }) => row);
    assertEqual(metadata(after.relations), metadata(before.relations), "Relation identity or ownership changed.");
    assertEqual(metadata(after.columns), metadata(before.columns), "Column identity or PUBLIC privileges changed.");
    assertEqual(deployed.entries.filter(entry => entry.grantee !== roleOid),
        baseline.entries, "Deployment changed existing relation ACL entries.");
    assertEqual(deployed.columnEntries.filter(entry => entry.grantee !== roleOid),
        baseline.columnEntries, "Deployment changed existing column ACL entries.");
    assertEqual(deployed.effective.filter(entry => entry.role_oid !== roleOid),
        baseline.effective, "Deployment changed an existing role's effective privileges.");

    const relations = new Map(after.relations.map(row => [row.oid, row]));
    const columns = new Map(after.columns.map(row => [`${row.relation_oid}:${row.attnum}`, row.attname]));
    const read = permissionMatrix.reads;
    const updates = permissionMatrix.updates;
    const deletes = permissionMatrix.deletes;
    const rights = deployed.effective.filter(entry => entry.role_oid === roleOid);
    const shape = entries => entries.map(({ role_oid, allowed, grantable, ...entry }) => entry);
    if (before.roles.length === 0) throw new Error("Baseline role inventory is empty.");
    const expectedShape = shape(baseline.effective.filter(entry => entry.role_oid === before.roles[0].oid));
    if (expectedShape.length === 0) throw new Error("Baseline effective privilege evidence is missing.");
    for (const role of before.roles) {
        assertEqual(shape(baseline.effective.filter(entry => entry.role_oid === role.oid)),
            expectedShape, `Incomplete effective privilege evidence: ${role.oid}.`);
    }
    assertEqual(shape(rights), expectedShape, "Incomplete runtime effective privilege evidence.");
    for (const right of rights) {
        const relation = relations.get(right.object_oid);
        const table = relation && ["r", "p"].includes(relation.relkind) ? relation.relname : "";
        let expected = false;
        if (right.kind === "database") expected = right.privilege === "CONNECT";
        if (right.kind === "schema") expected = right.privilege === "USAGE";
        if (right.kind === "table") {
            if (right.privilege === "SELECT") expected = read.includes(table);
            if (right.privilege === "INSERT") expected = read.includes(table) && table !== "genres";
            if (right.privilege === "UPDATE") expected = updates.includes(table);
            if (right.privilege === "DELETE") expected = deletes.includes(table);
        }
        if (right.kind === "column") {
            const column = columns.get(`${right.object_oid}:${right.attnum}`);
            if (right.privilege === "SELECT") expected = read.includes(table);
            if (right.privilege === "INSERT") expected = read.includes(table) && table !== "genres";
            if (right.privilege === "UPDATE") {
                expected = updates.includes(table) ||
                    (["comment_reactions", "review_reactions"].includes(table) &&
                        ["reaction_type", "updated_at"].includes(column));
            }
        }
        if (right.allowed !== expected || right.grantable) {
            throw new Error(`Runtime permission outside matrix: ${right.kind} ${right.object_oid} ${right.privilege}.`);
        }
    }
}

function verifyRecoveredEvidence(baseline, recovered, allowlist) {
    if (!Array.isArray(allowlist) || new Set(allowlist).size !== allowlist.length) {
        throw new Error("Invalid raw ACL drift allowlist.");
    }
    const before = baseline.snapshot;
    const after = recovered.snapshot;
    const byOid = new Map(after.relations.map(row => [row.oid, row]));
    const ownerDefaults = new Map(recovered.relationAcls.map(row => [row.oid, row.owner_default]));
    const eligible = new Set(before.relations.filter(row =>
        (row.relkind === "r" || row.relkind === "p") && row.acl === null
    ).map(row => row.oid));
    if (allowlist.some(oid => !eligible.has(oid))) {
        throw new Error("Allowlist contains an object not eligible in the baseline.");
    }
    if (before.relations.length !== after.relations.length || byOid.size !== after.relations.length) {
        throw new Error("Relation inventory changed.");
    }
    const drift = [];
    for (const old of before.relations) {
        const current = byOid.get(old.oid);
        if (!current) throw new Error(`Missing relation ${old.oid}.`);
        const { acl: oldAcl, ...oldMetadata } = old;
        const { acl: currentAcl, ...currentMetadata } = current;
        assertEqual(currentMetadata, oldMetadata, `Relation identity or ownership changed: ${old.oid}.`);
        if (oldAcl === currentAcl) continue;
        if (oldAcl !== null || currentAcl === null || currentAcl === "{}" ||
            !allowlist.includes(old.oid) || ownerDefaults.get(old.oid) !== true) {
            throw new Error(`Unexpected raw ACL drift: ${old.oid}.`);
        }
        drift.push({ oid: old.oid, name: old.relname, owner_oid: old.owner_oid });
    }
    for (const key of ["identity", "shared", "columns", "routines", "defaults",
        "triggers", "policies", "constraints", "indexes", "roles", "memberships", "migration"]) {
        assertEqual(after[key], before[key], `Baseline changed: ${key}.`);
    }
    assertEqual(recovered.entries, baseline.entries, "Expanded ACL entries changed.");
    assertEqual(recovered.columnEntries, baseline.columnEntries, "Expanded column ACL entries changed.");
    assertEqual(recovered.effective, baseline.effective, "Existing role effective privileges changed.");
    return { drift };
}

async function recoverAgainstRecordedBaseline(client, {
    baseline, expectedCommitted, allowlist, recoverySql
}) {
    if (typeof client.getTransactionStatus !== "function" ||
        client.getTransactionStatus() !== "I") {
        throw new Error("Recovery requires an idle, exclusively owned PostgreSQL client.");
    }
    if (typeof recoverySql !== "string" || hash(recoverySql) !== RECOVERY_SHA256 ||
        !recoverySql.startsWith("BEGIN;")) {
        throw new Error("Recovery SQL does not match the reviewed candidate.");
    }
    await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ");
    try {
        assertPostDeployment(expectedCommitted, await captureRecoveryEvidence(client));
        await client.query(recoverySql.replace(/^BEGIN;\s*/, ""));
        const verification = verifyRecoveredEvidence(
            baseline, await captureRecoveryEvidence(client), allowlist
        );
        await client.query("COMMIT");
        return verification;
    } catch (error) {
        try {
            await client.query("ROLLBACK");
        } catch (rollbackError) {
            throw new AggregateError([error, rollbackError], "Recovery and rollback failed.");
        }
        throw error;
    }
}

module.exports = {
    assertPostDeployment, captureEffectivePrivileges, captureRecoveryEvidence, recoverAgainstRecordedBaseline,
    verifyDeploymentEvidence, verifyRecoveredEvidence
};
