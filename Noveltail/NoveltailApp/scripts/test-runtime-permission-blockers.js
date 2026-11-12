"use strict";
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const net = require("node:net");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const root = path.resolve(__dirname, "..");
const { Client } = require(path.join(root, "node_modules", "pg"));
const { captureBaseline, hash, validateApproval } =
    require(path.join(root, "scripts", "runtime-permission-approval"));
const { captureRecoveryEvidence, recoverAgainstRecordedBaseline, verifyDeploymentEvidence,
    verifyRecoveredEvidence } =
    require(path.join(root, "scripts", "runtime-permission-recovery"));

const bin = "C:\\Program Files\\PostgreSQL\\18\\bin";
const tempRoot = os.tmpdir();
const temp = fs.mkdtempSync(path.join(tempRoot, "noveltail-acl-synthetic-"));
const data = path.join(temp, "data");
const passwordFile = path.join(temp, "synthetic-password.txt");
const password = crypto.randomBytes(24).toString("base64url");
fs.writeFileSync(passwordFile, password, { mode: 0o600 });
const user = "fixture_owner";
let startAttempted = false;
let client;
let port;

function command(name, args) {
    const result = spawnSync(path.join(bin, `${name}.exe`), args,
        { encoding: "utf8", windowsHide: true,
            stdio: name === "pg_ctl" ? "ignore" : "pipe" });
    if (result.error || result.status !== 0) {
        throw result.error || new Error(`${name}: ${result.stderr}\n${result.stdout}`);
    }
}
async function unusedPort() {
    const server = net.createServer();
    await new Promise((resolve, reject) => {
        server.once("error", reject);
        server.listen(0, "127.0.0.1", resolve);
    });
    const selected = server.address().port;
    await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    return selected;
}
function quote(name) { return `"${name.replace(/"/g, '""')}"`; }
function sqlBlock(file, heading) {
    const text = fs.readFileSync(path.join(root, file), "utf8");
    const match = /```sql\r?\n([\s\S]*?)\r?\n```/.exec(text.slice(text.indexOf(heading)));
    assert.ok(match);
    return match[1];
}
async function expectDenied(sql) {
    await assert.rejects(client.query(sql), error => error.code === "42501");
}

async function main() {
    port = await unusedPort();
    command("initdb", ["-D", data, "-U", user, "--pwfile", passwordFile,
        "--auth-host=scram-sha-256", "--auth-local=scram-sha-256", "--encoding=UTF8"]);
    startAttempted = true;
    command("pg_ctl", ["-D", data, "-l", path.join(temp, "server.log"), "-o",
        `-h 127.0.0.1 -p ${port}`, "-w", "start"]);
    client = new Client({ host: "127.0.0.1", port, user, password, database: "postgres" });
    await client.connect();
    const identity = (await client.query("SELECT current_setting('data_directory') AS directory, inet_server_port() AS port")).rows[0];
    assert.equal(path.resolve(identity.directory).toLowerCase(), path.resolve(data).toLowerCase());
    assert.equal(identity.port, port);
    await client.query('CREATE DATABASE "Noveltail"');
    await client.end();
    client = new Client({ host: "127.0.0.1", port, user, password, database: "Noveltail" });
    await client.connect();

    const inventory = fs.readFileSync(path.join(root, "docs", "database-permissions-owner-decision.md"), "utf8");
    const tables = [...inventory.matchAll(/^\| ([a-z_]+) \| S=0 I=0 U=0 D=0 T=0 R=0 G=0 \|/gm)].map(x => x[1]);
    const sequences = [...inventory.matchAll(/^\| ([a-z_]+_seq) \| USAGE=0 SELECT=0 UPDATE=0 \|/gm)].map(x => x[1]);
    assert.equal(tables.length, 28);
    assert.equal(sequences.length, 20);
    for (const table of tables) {
        const definition = table === "users" ? "user_id bigint PRIMARY KEY" :
            table === "wallets" ? "user_id bigint PRIMARY KEY" :
            ["comment_reactions", "review_reactions"].includes(table)
                ? "id bigint, reaction_type text, updated_at timestamptz" : "id bigint";
        await client.query(`CREATE TABLE public.${quote(table)} (${definition})`);
    }
    for (const sequence of sequences) await client.query(`CREATE SEQUENCE public.${quote(sequence)}`);
    const migration = fs.readFileSync(path.join(root, "migrations", "001_wallet_paid_chapters_notifications.sql"), "utf8");
    const functionSql = /CREATE OR REPLACE FUNCTION create_user_wallet\(\)[\s\S]*?\n\$\$;/.exec(migration);
    assert.ok(functionSql);
    await client.query(functionSql[0]);
    await client.query("CREATE TRIGGER users_create_wallet AFTER INSERT ON public.users FOR EACH ROW EXECUTE FUNCTION public.create_user_wallet()");
    await client.query("CREATE FUNCTION public.unrelated_trigger() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RETURN NEW; END $$");
    await client.query("CREATE ROLE fixture_runtime NOLOGIN; CREATE ROLE fixture_observer NOLOGIN; CREATE ROLE fixture_newowner NOLOGIN");
    await client.query('REVOKE TEMPORARY ON DATABASE "Noveltail" FROM PUBLIC RESTRICT');
    await client.query("REVOKE EXECUTE ON FUNCTION public.create_user_wallet() FROM PUBLIC RESTRICT");
    let rights = (await client.query(`SELECT has_database_privilege('fixture_runtime',current_database(),'TEMPORARY') AS temp,
        has_function_privilege('fixture_runtime','public.create_user_wallet()','EXECUTE') AS wallet_exec,
        has_function_privilege('fixture_runtime','public.unrelated_trigger()','EXECUTE') AS other_exec`)).rows[0];
    assert.deepEqual(rights, { temp: false, wallet_exec: false, other_exec: true });
    await client.query("SET ROLE fixture_runtime");
    await expectDenied("CREATE TEMP TABLE should_be_denied (id int)");
    await client.query("RESET ROLE");

    await client.query("BEGIN");
    await client.query("GRANT INSERT ON public.users, public.wallets TO fixture_runtime; GRANT SELECT ON public.wallets TO fixture_runtime");
    await client.query("SET LOCAL ROLE fixture_runtime");
    await client.query("INSERT INTO public.users (user_id) VALUES (123)");
    await client.query("RESET ROLE");
    assert.equal((await client.query("SELECT count(*)::int AS n FROM public.wallets WHERE user_id=123")).rows[0].n, 1);
    await client.query("ROLLBACK");
    await client.query("CREATE SCHEMA trigger_probe AUTHORIZATION fixture_runtime");
    await client.query("SET ROLE fixture_runtime");
    await client.query("CREATE TABLE trigger_probe.owned_table (id int)");
    await expectDenied("CREATE TRIGGER denied_trigger AFTER INSERT ON trigger_probe.owned_table FOR EACH ROW EXECUTE FUNCTION public.create_user_wallet()");
    await client.query("RESET ROLE");
    await client.query("DROP SCHEMA trigger_probe CASCADE");
    await client.query("DROP FUNCTION public.unrelated_trigger()");
    console.log("PASS scoped PUBLIC TEMPORARY/EXECUTE revocation, unaffected unrelated routine, existing wallet trigger; new trigger denied");

    await client.query("GRANT SELECT ON public.account_suspensions TO fixture_observer");
    await client.query("REVOKE ALL ON public.chapter_revisions FROM fixture_owner");
    await client.query("BEGIN");
    await assert.rejects(captureBaseline(client), /requires an idle/);
    assert.equal(client.getTransactionStatus(), "T");
    await client.query("ROLLBACK");
    const before = await captureBaseline(client);
    assert.equal(before.identity.database, "Noveltail");
    assert.equal(before.identity.port, port);
    assert.equal(before.relations.length, 48);
    assert.equal(before.relations.filter(row => row.acl === null).length, 46);
    assert.equal(before.relations.find(row => row.relname === "chapter_revisions").acl, "{}");
    const candidateSql = sqlBlock("docs\\database-permissions.md", "## Owner-operated SQL template");
    const recoverySql = sqlBlock("docs\\runtime-permission-deployment.md", "## 4. Post-commit forward-recovery SQL");
    const reads = ["account_suspensions", "admin_action_logs", "announcement_recipients", "announcements",
        "appeal_assignments", "appeals", "bookmarks", "chapter_unlocks", "chapters", "comments",
        "comment_reactions", "follows", "genres", "notifications", "novel_genres", "novels",
        "reading_history", "reports", "review_reactions", "reviews", "users", "wallet_transactions", "wallets"];
    const { publicKey, privateKey } = crypto.generateKeyPairSync("ed25519");
    const signed = {
        version: 1, purpose: "noveltail-runtime-deployment",
        issued_at: new Date(Date.now() - 60000).toISOString(),
        expires_at: new Date(Date.now() + 60000).toISOString(),
        target_database: before.identity.database, target_database_oid: before.identity.database_oid,
        target_schema_oid: before.identity.schema_oid,
        target_system_identifier: before.identity.system_identifier,
        baseline_sha256: hash(JSON.stringify(before)), candidate_sha256: hash(candidateSql),
        recovery_sha256: hash(recoverySql),
        public_objects: before.relations.map(row => ({ oid: row.oid, name: row.relname, kind: row.relkind, decision: "retain-no-public" })),
        public_temporary: "absent-approved", public_routine_execute: "absent-approved",
        raw_acl_policy: "null-to-owner-default-only",
        allowed_raw_drift_table_oids: before.relations.filter(row => row.relkind === "r" && reads.includes(row.relname) && row.acl === null).map(row => row.oid),
        raw_acl_checks: "identities-owners-grantors-options-memberships-defaults-public-rls-triggers",
        recovery_plan: "fresh-role-only-targeted-forward", migration_005: "absent"
    };
    const payload = Buffer.from(JSON.stringify(signed));
    const approvalResult = validateApproval({ payload, signature: crypto.sign(null, payload, privateKey),
        trustedPublicKey: publicKey.export({ type: "spki", format: "pem" }),
        snapshot: before, candidateSql, recoverySql });
    assert.deepEqual(approvalResult.failures, ["production_migration_compatibility"]);
    console.log("PASS snapshot collector and signed checks against synthetic PostgreSQL; production deployment remains denied");

    async function readEvidence() {
        await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
        try {
            const evidence = await captureRecoveryEvidence(client);
            await client.query("COMMIT");
            return evidence;
        } catch (error) {
            await client.query("ROLLBACK");
            throw error;
        }
    }
    const baseline = await readEvidence();
    assert.deepEqual(baseline.snapshot, before);
    const allowlist = signed.allowed_raw_drift_table_oids;

    for (const revokePublic of [
        'REVOKE CONNECT ON DATABASE "Noveltail" FROM PUBLIC',
        "REVOKE USAGE ON SCHEMA public FROM PUBLIC"
    ]) {
        await client.query("BEGIN");
        await client.query(revokePublic);
        await assert.rejects(client.query(candidateSql), /Approved PUBLIC CONNECT or schema USAGE is absent/);
        await client.query("ROLLBACK");
        assert.deepEqual(await readEvidence(), baseline);
    }
    console.log("PASS missing PUBLIC CONNECT or schema USAGE blocks deployment without a direct fallback grant");

    await client.query(candidateSql);
    const staged = await captureRecoveryEvidence(client);
    verifyDeploymentEvidence(baseline, staged, allowlist);
    assert.throws(() => verifyDeploymentEvidence(baseline, staged, []),
        /Potential unapproved raw ACL drift/);
    await client.query("GRANT UPDATE ON public.wallet_transactions TO noveltail_runtime");
    const invalidRuntime = await captureRecoveryEvidence(client);
    assert.throws(() => verifyDeploymentEvidence(baseline, invalidRuntime, allowlist), /outside matrix/);
    await assert.rejects(client.query(`DO $$ BEGIN
        IF has_table_privilege('noveltail_runtime','public.wallet_transactions','UPDATE') THEN
            RAISE EXCEPTION 'ledger privilege outside matrix';
        END IF;
    END $$`), /ledger privilege outside matrix/);
    await client.query("ROLLBACK");
    assert.deepEqual(await readEvidence(), baseline);
    console.log("PASS pre-commit failure restores exact raw ACL and effective baseline");

    for (const anomaly of [
        "GRANT SELECT ON public.genres TO fixture_observer",
        "GRANT SELECT ON public.genres TO PUBLIC",
        "ALTER TABLE public.genres OWNER TO fixture_newowner",
        "GRANT SELECT ON public.account_suspensions TO fixture_observer WITH GRANT OPTION"
    ]) {
        await client.query(candidateSql);
        await client.query(anomaly);
        const unexpected = await captureRecoveryEvidence(client);
        assert.throws(() => verifyDeploymentEvidence(baseline, unexpected, allowlist), /changed/);
        await client.query("ROLLBACK");
        assert.deepEqual(await readEvidence(), baseline);
    }
    console.log("PASS pre-commit verifier rejects unexpected grants, PUBLIC, ownership and grant-option changes");

    await client.query(candidateSql);
    verifyDeploymentEvidence(baseline, await captureRecoveryEvidence(client), allowlist);
    const runtimeRights = (await client.query(`SELECT
        has_database_privilege('noveltail_runtime',current_database(),'CONNECT') AS connect,
        has_schema_privilege('noveltail_runtime','public','USAGE') AS usage,
        has_table_privilege('noveltail_runtime','public.wallet_transactions','UPDATE') AS ledger_update,
        has_table_privilege('noveltail_runtime','public.wallet_transactions','DELETE') AS ledger_delete`)).rows[0];
    assert.deepEqual(runtimeRights, { connect: true, usage: true, ledger_update: false, ledger_delete: false });
    await client.query("COMMIT");
    await client.query("INSERT INTO public.reports (id) VALUES (12345)");
    const committed = await readEvidence();

    const anomalies = [
        ["GRANT SELECT ON public.genres TO fixture_observer",
            "REVOKE SELECT ON public.genres FROM fixture_observer"],
        ["GRANT SELECT ON public.genres TO PUBLIC", "REVOKE SELECT ON public.genres FROM PUBLIC"],
        ["ALTER TABLE public.genres OWNER TO fixture_newowner", "ALTER TABLE public.genres OWNER TO fixture_owner"],
        ["GRANT SELECT ON public.account_suspensions TO fixture_observer WITH GRANT OPTION",
            "REVOKE GRANT OPTION FOR SELECT ON public.account_suspensions FROM fixture_observer"]
    ];
    const recoveryOptions = { baseline, expectedCommitted: committed, allowlist, recoverySql };
    for (const [anomaly, undo] of anomalies) {
        await client.query(anomaly);
        const unexpected = await readEvidence();
        await assert.rejects(recoverAgainstRecordedBaseline(client, recoveryOptions), /must stop/);
        assert.deepEqual(await readEvidence(), unexpected);
        assert.ok((await client.query("SELECT 1 FROM pg_roles WHERE rolname='noveltail_runtime'")).rowCount);
        await client.query(undo);
        assert.deepEqual(await readEvidence(), committed);
    }
    console.log("PASS recovery stops without commit on unexpected grant, PUBLIC grant, owner and grant-option changes");

    await assert.rejects(recoverAgainstRecordedBaseline(client, {
        ...recoveryOptions, allowlist: []
    }), /Unexpected raw ACL drift/);
    assert.deepEqual(await readEvidence(), committed);
    const verified = await recoverAgainstRecordedBaseline(client, recoveryOptions);
    const recovered = await readEvidence();
    assert.ok(verified.drift.length > 0);
    assert.throws(() => verifyRecoveredEvidence(baseline, recovered,
        allowlist.filter(oid => oid !== verified.drift[0].oid)), /Unexpected raw ACL drift/);
    assert.equal((await client.query("SELECT count(*)::int AS n FROM public.reports WHERE id=12345")).rows[0].n, 1);
    assert.deepEqual(await readEvidence(), recovered);
    console.log(`PASS committed candidate and forward recovery: ${verified.drift.length} allowlisted ACL changes; later business row preserved`);

    for (const [anomaly] of anomalies) {
        await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ");
        await client.query(anomaly);
        const unexpected = await captureRecoveryEvidence(client);
        assert.throws(() => verifyRecoveredEvidence(baseline, unexpected, allowlist));
        await client.query("ROLLBACK");
    }
    const otherDrifts = [
        "GRANT SELECT ON public.chapter_revisions TO fixture_observer",
        "GRANT UPDATE (id) ON public.reports TO fixture_observer",
        'GRANT CONNECT ON DATABASE "Noveltail" TO fixture_observer',
        "GRANT USAGE ON SCHEMA public TO fixture_observer",
        "GRANT USAGE ON SEQUENCE public.genres_genre_id_seq TO fixture_observer",
        "GRANT EXECUTE ON FUNCTION public.create_user_wallet() TO fixture_observer",
        "ALTER DEFAULT PRIVILEGES FOR ROLE fixture_owner GRANT SELECT ON TABLES TO fixture_observer",
        "GRANT fixture_observer TO fixture_newowner"
    ];
    for (const anomaly of otherDrifts) {
        await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ");
        await client.query(anomaly);
        const unexpected = await captureRecoveryEvidence(client);
        assert.throws(() => verifyRecoveredEvidence(baseline, unexpected, allowlist));
        await client.query("ROLLBACK");
    }
    console.log("PASS verifier rejects unexpected grants, PUBLIC, ownership, grant option, EMPTY and other scoped ACL changes");
}

main().catch(error => {
    console.error(error);
    process.exitCode = 1;
}).finally(async () => {
    if (client) await client.end().catch(error => { console.error(error); process.exitCode = 1; });
    if (startAttempted) {
        const status = spawnSync(path.join(bin, "pg_ctl.exe"),
            ["-D", data, "status"], { stdio: "ignore", windowsHide: true });
        if (status.error || (status.status !== 0 && status.status !== 3)) {
            console.error(status.error || new Error("Cannot determine synthetic cluster status."));
            process.exitCode = 1;
            return;
        }
        if (status.status === 0) {
            try { command("pg_ctl", ["-D", data, "-m", "fast", "-w", "stop"]); }
            catch (error) { console.error(error); process.exitCode = 1; return; }
        }
    }
    if (!path.basename(temp).startsWith("noveltail-acl-synthetic-") ||
        path.resolve(path.dirname(temp)) !== path.resolve(tempRoot)) {
        throw new Error("Unsafe synthetic cleanup path");
    }
    fs.rmSync(temp, { recursive: true, force: true });
});
