"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const net = require("node:net");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { Client } = require("pg");
const { validateProductionDatabase } = require("../config/production-database");
const { captureEffectivePrivileges } = require("./runtime-permission-recovery");

process.env.NODE_ENV = "test";
process.env.RATE_LIMIT_STORE = "memory";
const { createPostgresRateLimitStore } = require("../middleware/rate-limit");
const rateLimitDatabasePool = require("../db");

const bin = "C:\\Program Files\\PostgreSQL\\18\\bin";
const tempRoot = os.tmpdir();
const temp = fs.mkdtempSync(path.join(tempRoot, "noveltail-migration005-synthetic-"));
const data = path.join(temp, "data");
const passwordFile = path.join(temp, "password.txt");
const password = crypto.randomBytes(24).toString("base64url");
fs.writeFileSync(passwordFile, password, { mode: 0o600 });
let startAttempted = false;
let client;
let store;
let failed = false;

function command(name, args) {
    const result = spawnSync(path.join(bin, `${name}.exe`), args, {
        encoding: "utf8", windowsHide: true,
        stdio: name === "pg_ctl" ? "ignore" : "pipe"
    });
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
    const port = server.address().port;
    await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    return port;
}

async function rawAcls() {
    return (await client.query(`SELECT 'table' AS kind, 0 AS attnum, c.relacl::text AS acl
        FROM pg_class c WHERE c.oid='public.rate_limit_buckets'::regclass
        UNION ALL
        SELECT 'column', a.attnum, a.attacl::text
        FROM pg_attribute a WHERE a.attrelid='public.rate_limit_buckets'::regclass
            AND a.attnum>0 AND NOT a.attisdropped ORDER BY kind,attnum`)).rows;
}

const grants = `GRANT SELECT (bucket_key,hits,expires_at), INSERT (bucket_key,hits,expires_at),
    UPDATE (hits,expires_at), DELETE ON public.rate_limit_buckets TO noveltail_runtime`;
const revokes = `REVOKE SELECT (bucket_key,hits,expires_at), INSERT (bucket_key,hits,expires_at),
    UPDATE (hits,expires_at), DELETE ON public.rate_limit_buckets FROM noveltail_runtime RESTRICT`;

async function main() {
    const port = await unusedPort();
    command("initdb", ["-D", data, "-U", "fixture_admin", "--pwfile", passwordFile,
        "--auth-host=scram-sha-256", "--auth-local=scram-sha-256", "--encoding=UTF8"]);
    startAttempted = true;
    command("pg_ctl", ["-D", data, "-l", path.join(temp, "server.log"), "-o",
        `-h 127.0.0.1 -p ${port}`, "-w", "start"]);
    client = new Client({ host: "127.0.0.1", port, user: "fixture_admin",
        password, database: "postgres" });
    await client.connect();
    const identity = (await client.query(
        "SELECT current_setting('data_directory') AS directory, inet_server_port() AS port"
    )).rows[0];
    assert.equal(path.resolve(identity.directory).toLowerCase(), path.resolve(data).toLowerCase());
    assert.equal(identity.port, port);

    await client.query("CREATE ROLE migration_owner NOLOGIN; CREATE ROLE noveltail_runtime NOLOGIN NOINHERIT");
    await client.query("GRANT CREATE ON SCHEMA public TO migration_owner");
    await client.query("SET ROLE migration_owner");
    const migration = fs.readFileSync(path.join(__dirname, "..", "migrations",
        "005_shared_rate_limit_store.sql"), "utf8");
    await client.query(migration);
    await client.query("RESET ROLE");
    const owner = (await client.query(`SELECT pg_get_userbyid(c.relowner) AS owner,
        to_regclass('public.rate_limit_buckets_expires_at_idx') IS NOT NULL AS indexed
        FROM pg_class c WHERE c.oid='public.rate_limit_buckets'::regclass`)).rows[0];
    assert.deepEqual(owner, { owner: "migration_owner", indexed: true });
    const before = await rawAcls();
    const effectiveBefore = await captureEffectivePrivileges(client);
    await client.query("BEGIN; SET LOCAL ROLE migration_owner");
    await client.query(grants);
    await client.query("ROLLBACK");
    assert.deepEqual(await rawAcls(), before);
    assert.deepEqual(await captureEffectivePrivileges(client), effectiveBefore);
    console.log("PASS migration 005 as separate owner; explicit pre-commit rollback is raw/effective exact");

    await client.query("BEGIN; SET LOCAL ROLE migration_owner");
    await client.query(grants);
    await client.query("COMMIT");
    await client.query("SET ROLE noveltail_runtime");
    await validateProductionDatabase(client, "postgres");
    await assert.rejects(client.query(
        "UPDATE public.rate_limit_buckets SET bucket_key='changed'"
    ), error => error.code === "42501");
    await client.query("RESET ROLE; SET ROLE migration_owner");
    await client.query("INSERT INTO public.rate_limit_buckets VALUES ('synthetic-expired',1,now()-interval '1 minute')");
    await client.query("RESET ROLE; SET ROLE noveltail_runtime");
    let cleanupDone;
    const cleaned = new Promise(resolve => { cleanupDone = resolve; });
    const database = {
        async query(sql, params) {
            const result = await client.query(sql, params);
            if (sql.startsWith("DELETE FROM public.rate_limit_buckets")) cleanupDone(result.rowCount);
            return result;
        }
    };
    store = createPostgresRateLimitStore({ database, secret: crypto.randomBytes(32).toString("hex"),
        namespace: "synthetic-only", cleanupIntervalMs: 50 });
    assert.equal((await store.consume("probe", 60_000)).hits, 1);
    assert.equal((await store.consume("probe", 60_000)).hits, 2);
    let timeout;
    const removed = await Promise.race([cleaned, new Promise((_, reject) => {
        timeout = setTimeout(() => reject(new Error("Cleanup did not run")), 5000);
    })]).finally(() => clearTimeout(timeout));
    assert.equal(removed, 1);
    await store.close();
    store = undefined;
    await client.query("RESET ROLE");
    await client.query("BEGIN; SET LOCAL ROLE migration_owner; REVOKE UPDATE (hits) ON public.rate_limit_buckets FROM noveltail_runtime");
    await client.query("SET LOCAL ROLE noveltail_runtime");
    await assert.rejects(validateProductionDatabase(client, "postgres"), /lacks required shared rate-limit/);
    await client.query("ROLLBACK");
    console.log("PASS committed least-privilege INSERT/ON CONFLICT UPDATE/SELECT/DELETE and startup missing-grant rejection");

    await client.query("BEGIN; SET LOCAL ROLE migration_owner");
    await client.query(revokes);
    const after = await rawAcls();
    const effectiveAfter = await captureEffectivePrivileges(client);
    assert.deepEqual(effectiveAfter, effectiveBefore);
    const count = (await client.query("SELECT count(*)::int AS count FROM public.rate_limit_buckets")).rows[0].count;
    assert.equal(count, 1);
    const columnBefore = before.filter(row => row.kind === "column");
    const columnAfter = after.filter(row => row.kind === "column");
    if (JSON.stringify(columnBefore) !== JSON.stringify(columnAfter)) {
        failed = true;
        console.error("FAIL post-005 recovery would change raw column ACLs; recovery must roll back");
        console.error(JSON.stringify({ columnBefore, columnAfter }));
        await client.query("ROLLBACK");
    } else {
        const relation = after.find(row => row.kind === "table");
        const ownerDefault = (await client.query(`SELECT c.relacl IS NOT DISTINCT FROM
            acldefault('r',c.relowner) AS owner_default FROM pg_class c
            WHERE c.oid='public.rate_limit_buckets'::regclass`)).rows[0].owner_default;
        assert.ok(relation.acl === before.find(row => row.kind === "table").acl || ownerDefault);
        await client.query("COMMIT");
        console.log("PASS column raw ACL unchanged; only baseline-eligible owner-default table drift; post-commit synthetic data preserved");
    }
    if (failed) process.exitCode = 1;
}

main().catch(error => {
    console.error(error);
    process.exitCode = 1;
}).finally(async () => {
    if (store) await store.close();
    await rateLimitDatabasePool.end();
    if (client) await client.end().catch(error => { console.error(error); process.exitCode = 1; });
    if (startAttempted) {
        const status = spawnSync(path.join(bin, "pg_ctl.exe"), ["-D", data, "status"],
            { stdio: "ignore", windowsHide: true });
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
    if (!path.basename(temp).startsWith("noveltail-migration005-synthetic-") ||
        path.resolve(path.dirname(temp)) !== path.resolve(tempRoot)) {
        throw new Error("Unsafe synthetic cleanup path");
    }
    fs.rmSync(temp, { recursive: true, force: true });
});
