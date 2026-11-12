require("dotenv").config({ quiet: true });

const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const crypto = require("node:crypto");
const fs = require("node:fs");
const net = require("node:net");
const os = require("node:os");
const path = require("node:path");
const { Pool } = require("pg");

const SOURCE_DATABASE = "Noveltail";
const RUNTIME_ROLE = "noveltail_runtime";
const READ_TABLES = [
    "account_suspensions",
    "admin_action_logs",
    "announcement_recipients",
    "announcements",
    "appeal_assignments",
    "appeals",
    "bookmarks",
    "chapter_unlocks",
    "chapters",
    "comments",
    "comment_reactions",
    "follows",
    "genres",
    "notifications",
    "novel_genres",
    "novels",
    "reading_history",
    "reports",
    "review_reactions",
    "reviews",
    "users",
    "wallet_transactions",
    "wallets"
];
const INSERT_TABLES = [
    "account_suspensions",
    "admin_action_logs",
    "announcement_recipients",
    "announcements",
    "appeal_assignments",
    "appeals",
    "bookmarks",
    "chapter_unlocks",
    "chapters",
    "comments",
    "comment_reactions",
    "follows",
    "notifications",
    "novel_genres",
    "novels",
    "reading_history",
    "reports",
    "review_reactions",
    "reviews",
    "users",
    "wallet_transactions",
    "wallets"
];
const UPDATE_TABLES = [
    "account_suspensions",
    "announcement_recipients",
    "announcements",
    "appeal_assignments",
    "appeals",
    "chapters",
    "comments",
    "notifications",
    "novels",
    "reading_history",
    "reports",
    "reviews",
    "users",
    "wallets"
];
const DELETE_TABLES = [
    "bookmarks",
    "chapter_unlocks",
    "chapters",
    "comments",
    "comment_reactions",
    "follows",
    "notifications",
    "novel_genres",
    "novels",
    "reading_history",
    "review_reactions",
    "reviews"
];

function postgresTool(name) {
    const executable = process.platform === "win32" ? `${name}.exe` : name;
    const postgresRoot = path.join("C:", "Program Files", "PostgreSQL");
    const installedVersions = process.platform === "win32" &&
        fs.existsSync(postgresRoot)
        ? fs.readdirSync(postgresRoot, { withFileTypes: true })
            .filter(entry => entry.isDirectory() && /^\d+$/.test(entry.name))
            .map(entry => entry.name)
            .sort((left, right) => Number(right) - Number(left))
        : [];
    const candidates = [
        process.env.PG_BIN && path.join(process.env.PG_BIN, executable),
        ...installedVersions.map(version =>
            path.join(postgresRoot, version, "bin", executable)
        ),
        executable
    ].filter(Boolean);

    return candidates.find(candidate =>
        candidate === executable || fs.existsSync(candidate)
    );
}

function runTool(executable, args, options = {}) {
    const result = spawnSync(executable, args, {
        cwd: process.cwd(),
        env: options.env || process.env,
        encoding: "utf8",
        stdio: options.stdio || "inherit",
        windowsHide: true
    });
    if (result.error) throw result.error;
    if (result.status !== 0) {
        throw new Error(
            `${path.basename(executable)} exited with code ${result.status}: ${
                result.stderr || result.stdout || "no diagnostic output"
            }`
        );
    }
    return result.stdout || "";
}

function quoteIdentifier(identifier) {
    return `"${String(identifier).replace(/"/g, '""')}"`;
}

function quoteLiteral(value) {
    return `'${String(value).replace(/'/g, "''")}'`;
}

async function getFreePort() {
    const server = net.createServer();
    await new Promise((resolve, reject) => {
        server.once("error", reject);
        server.listen(0, "127.0.0.1", resolve);
    });
    const { port } = server.address();
    await new Promise((resolve, reject) =>
        server.close(error => error ? reject(error) : resolve())
    );
    return port;
}

async function waitForDatabase(config) {
    const deadline = Date.now() + 15_000;
    while (Date.now() < deadline) {
        const pool = new Pool(config);
        try {
            await pool.query("SELECT 1");
            return;
        } catch {
            await new Promise(resolve => setTimeout(resolve, 200));
        } finally {
            await pool.end();
        }
    }
    throw new Error("The isolated PostgreSQL cluster did not become ready.");
}

async function grantPrivileges(adminPool, databaseName, role) {
    const tableResult = await adminPool.query(
        `SELECT c.relname
         FROM pg_class c
         JOIN pg_namespace n ON n.oid = c.relnamespace
         WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p')`
    );
    const existingTables = new Set(tableResult.rows.map(row => row.relname));
    const missingTables = READ_TABLES.filter(table => !existingTables.has(table));
    assert.deepEqual(
        missingTables,
        [],
        "The cloned database schema is missing tables required by source SQL."
    );

    await adminPool.query(
        `REVOKE ALL PRIVILEGES ON ALL TABLES IN SCHEMA public FROM ${quoteIdentifier(role)}`
    );
    await adminPool.query(
        `REVOKE ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public FROM ${quoteIdentifier(role)}`
    );
    await adminPool.query(
        `REVOKE CREATE ON SCHEMA public FROM ${quoteIdentifier(role)}`
    );
    await adminPool.query(
        `REVOKE CREATE, TEMPORARY ON DATABASE ${quoteIdentifier(databaseName)} FROM ${quoteIdentifier(role)}`
    );
    await adminPool.query(
        `GRANT USAGE ON SCHEMA public TO ${quoteIdentifier(role)}`
    );

    async function grant(privilege, tables) {
        const relationList = tables
            .map(table => `public.${quoteIdentifier(table)}`)
            .join(", ");
        await adminPool.query(
            `GRANT ${privilege} ON TABLE ${relationList} TO ${quoteIdentifier(role)}`
        );
    }

    await grant("SELECT", READ_TABLES);
    await grant("INSERT", INSERT_TABLES);
    await grant("UPDATE", UPDATE_TABLES);
    await grant("DELETE", DELETE_TABLES);

    const sequenceResult = await adminPool.query(
        `SELECT n.nspname AS schema_name, seq.relname AS sequence_name
         FROM pg_class seq
         JOIN pg_namespace n ON n.oid = seq.relnamespace
         JOIN pg_depend dependency
           ON dependency.classid = 'pg_class'::regclass
          AND dependency.objid = seq.oid
          AND dependency.refclassid = 'pg_class'::regclass
         JOIN pg_class table_object ON table_object.oid = dependency.refobjid
         JOIN pg_attribute column_object
           ON column_object.attrelid = table_object.oid
          AND column_object.attnum = dependency.refobjsubid
         JOIN pg_attrdef column_default
           ON column_default.adrelid = table_object.oid
          AND column_default.adnum = column_object.attnum
         WHERE seq.relkind = 'S'
           AND n.nspname = 'public'
           AND table_object.relname = ANY($1::text[])
           AND column_object.attidentity = ''
           AND pg_get_expr(column_default.adbin, column_default.adrelid)
               LIKE 'nextval(%'
         ORDER BY seq.relname`,
        [INSERT_TABLES]
    );
    const sequences = sequenceResult.rows;
    for (const sequence of sequences) {
        await adminPool.query(
            `GRANT USAGE ON SEQUENCE ${quoteIdentifier(sequence.schema_name)}.${quoteIdentifier(sequence.sequence_name)} TO ${quoteIdentifier(role)}`
        );
    }
    const identitySequenceResult = await adminPool.query(
        `SELECT seq.relname AS sequence_name,
                table_object.relname AS table_name,
                column_object.attname AS column_name
         FROM pg_class seq
         JOIN pg_namespace n ON n.oid = seq.relnamespace
         JOIN pg_depend dependency
           ON dependency.classid = 'pg_class'::regclass
          AND dependency.objid = seq.oid
          AND dependency.refclassid = 'pg_class'::regclass
          AND dependency.deptype = 'i'
         JOIN pg_class table_object ON table_object.oid = dependency.refobjid
         JOIN pg_attribute column_object
           ON column_object.attrelid = table_object.oid
          AND column_object.attnum = dependency.refobjsubid
         WHERE seq.relkind = 'S'
           AND n.nspname = 'public'
           AND table_object.relname = ANY($1::text[])
         ORDER BY table_object.relname, column_object.attname`,
        [INSERT_TABLES]
    );

    const triggerFunction = await adminPool.query(
        `SELECT p.oid::regprocedure::text AS signature
         FROM pg_proc p
         JOIN pg_namespace n ON n.oid = p.pronamespace
         WHERE n.nspname = 'public' AND p.proname = 'create_user_wallet'`
    );
    assert.equal(
        triggerFunction.rowCount,
        1,
        "Expected the existing wallet trigger function in the source schema."
    );
    await adminPool.query(
        `REVOKE EXECUTE ON FUNCTION ${triggerFunction.rows[0].signature} FROM PUBLIC`
    );
    await adminPool.query(
        `REVOKE EXECUTE ON FUNCTION ${triggerFunction.rows[0].signature} FROM ${quoteIdentifier(role)}`
    );

    return {
        sequences: sequences.map(row => row.sequence_name),
        identitySequences: identitySequenceResult.rows
    };
}

async function verifyPrivileges(pool, role, sequences, identitySequences) {
    const roleResult = await pool.query(
        `SELECT
            role.rolsuper,
            role.rolcreatedb,
            role.rolcreaterole,
            role.rolbypassrls,
            has_database_privilege(current_user, current_database(), 'CONNECT')
                AS can_connect,
            has_database_privilege(current_user, current_database(), 'CREATE')
                AS can_create_database_objects,
            has_schema_privilege(current_user, 'public', 'USAGE')
                AS can_use_public,
            has_schema_privilege(current_user, 'public', 'CREATE')
                AS can_create_in_public
         FROM pg_roles role
         WHERE role.rolname = current_user`
    );
    const roleStatus = roleResult.rows[0];
    assert.ok(roleStatus, "Runtime login must map to a PostgreSQL role.");
    assert.equal(roleStatus.rolsuper, false);
    assert.equal(roleStatus.rolcreatedb, false);
    assert.equal(roleStatus.rolcreaterole, false);
    assert.equal(roleStatus.rolbypassrls, false);
    assert.equal(roleStatus.can_connect, true);
    assert.equal(roleStatus.can_create_database_objects, false);
    assert.equal(roleStatus.can_use_public, true);
    assert.equal(roleStatus.can_create_in_public, false);

    const membership = await pool.query(
        `SELECT COUNT(*)::int AS count
         FROM pg_auth_members membership
         JOIN pg_roles member ON member.oid = membership.member
         WHERE member.rolname = current_user`
    );
    assert.equal(membership.rows[0].count, 0, "Runtime role must have no role memberships.");

    const tableResults = await pool.query(
        `SELECT c.relname,
            has_table_privilege(current_user, c.oid, 'SELECT') AS can_select,
            has_table_privilege(current_user, c.oid, 'INSERT') AS can_insert,
            has_table_privilege(current_user, c.oid, 'UPDATE') AS can_update,
            has_table_privilege(current_user, c.oid, 'DELETE') AS can_delete,
            has_table_privilege(current_user, c.oid, 'TRUNCATE') AS can_truncate,
            has_table_privilege(current_user, c.oid, 'TRIGGER') AS can_create_trigger,
            has_table_privilege(current_user, c.oid, 'REFERENCES') AS can_reference,
            (
                has_table_privilege(current_user, c.oid, 'SELECT WITH GRANT OPTION')
                OR has_table_privilege(current_user, c.oid, 'INSERT WITH GRANT OPTION')
                OR has_table_privilege(current_user, c.oid, 'UPDATE WITH GRANT OPTION')
                OR has_table_privilege(current_user, c.oid, 'DELETE WITH GRANT OPTION')
            ) AS can_grant_table_privileges
         FROM pg_class c
         JOIN pg_namespace n ON n.oid = c.relnamespace
         WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p')
         ORDER BY c.relname`
    );
    const expected = new Map(
        tableResults.rows.map(row => [
            row.relname,
            {
                can_select: READ_TABLES.includes(row.relname),
                can_insert: INSERT_TABLES.includes(row.relname),
                can_update: UPDATE_TABLES.includes(row.relname),
                can_delete: DELETE_TABLES.includes(row.relname),
                can_truncate: false,
                can_create_trigger: false,
                can_reference: false,
                can_grant_table_privileges: false
            }
        ])
    );
    for (const row of tableResults.rows) {
        const actual = {
            can_select: row.can_select,
            can_insert: row.can_insert,
            can_update: row.can_update,
            can_delete: row.can_delete,
            can_truncate: row.can_truncate,
            can_create_trigger: row.can_create_trigger,
            can_reference: row.can_reference,
            can_grant_table_privileges: row.can_grant_table_privileges
        };
        assert.deepEqual(
            actual,
            expected.get(row.relname),
            `Unexpected effective table privileges on public.${row.relname}`
        );
    }

    const sequenceResults = await pool.query(
        `SELECT n.nspname, seq.relname,
            has_sequence_privilege(current_user, seq.oid, 'USAGE') AS can_use,
            has_sequence_privilege(current_user, seq.oid, 'SELECT') AS can_select,
            has_sequence_privilege(current_user, seq.oid, 'UPDATE') AS can_update
         FROM pg_class seq
         JOIN pg_namespace n ON n.oid = seq.relnamespace
         WHERE n.nspname = 'public' AND seq.relkind = 'S'
         ORDER BY seq.relname`
    );
    const requiredSequences = new Set(sequences);
    for (const row of sequenceResults.rows) {
        assert.equal(
            row.can_use,
            requiredSequences.has(row.relname),
            `Unexpected USAGE privilege on public.${row.relname}`
        );
        assert.equal(row.can_select, false, `Unexpected SELECT on public.${row.relname}`);
        assert.equal(row.can_update, false, `Unexpected UPDATE on public.${row.relname}`);
    }

    const functions = await pool.query(
        `SELECT p.oid::regprocedure::text AS signature,
                has_function_privilege(current_user, p.oid, 'EXECUTE') AS can_execute
         FROM pg_proc p
         JOIN pg_namespace n ON n.oid = p.pronamespace
         WHERE n.nspname = 'public' AND p.prokind IN ('f', 'p')`
    );
    for (const fn of functions.rows) {
        assert.equal(fn.can_execute, false, `Unexpected EXECUTE on ${fn.signature}`);
    }

    await pool.query("SELECT now(), jsonb_build_object('role', current_user)");
    await pool.query("BEGIN");
    try {
        await pool.query("SELECT pg_advisory_xact_lock(hashtextextended('role-test', 0))");
    } finally {
        await pool.query("ROLLBACK");
    }
    for (const statement of [
        "CREATE TABLE public.runtime_role_forbidden (id integer)",
        "ALTER TABLE public.users ADD COLUMN runtime_role_forbidden integer",
        "DROP TABLE public.users",
        "TRUNCATE TABLE public.users"
    ]) {
        await assert.rejects(
            pool.query(statement),
            error => error.code === "42501",
            `Expected privilege denial for: ${statement}`
        );
    }

    const ownerCheck = await pool.query(
        `SELECT
            pg_has_role(current_user, 'pg_database_owner', 'MEMBER') AS database_owner_member
         `
    );
    assert.equal(
        ownerCheck.rows[0].database_owner_member,
        false,
        "Runtime role must not be a member of pg_database_owner."
    );
    console.log(JSON.stringify({
        role,
        database: process.env.NOVELTAIL_TEST_DB,
        tableCount: tableResults.rowCount,
        readableTables: READ_TABLES.length,
        writableTables: new Set([...INSERT_TABLES, ...UPDATE_TABLES, ...DELETE_TABLES]).size,
        serialSequences: sequences,
        identitySequences,
        publicFunctionsWithExecute: functions.rows.filter(row => row.can_execute).length,
        databaseCreate: roleStatus.can_create_database_objects,
        publicSchemaCreate: roleStatus.can_create_in_public
    }, null, 2));
}

async function main() {
    if (process.platform !== "win32") {
        throw new Error("This repository's disposable runtime-role harness is currently Windows-only.");
    }
    if (process.env.DB_NAME !== SOURCE_DATABASE ||
        process.env.DB_HOST !== "localhost" ||
        Number(process.env.DB_PORT) !== 5432) {
        throw new Error(
            "Read-only schema snapshot must target Noveltail at localhost:5432; no role or schema changes will be made there."
        );
    }

    const requiredTools = ["initdb", "pg_ctl", "pg_dump", "pg_restore"];
    const tools = Object.fromEntries(requiredTools.map(name => [name, postgresTool(name)]));
    for (const [name, executable] of Object.entries(tools)) {
        if (!executable) throw new Error(`Required PostgreSQL tool is unavailable: ${name}`);
    }
    const { DB_HOST, DB_PORT, DB_USER, DB_PASSWORD } = process.env;
    if (!DB_USER || !DB_PASSWORD) {
        throw new Error("Source PostgreSQL credentials are required through the existing environment.");
    }
    const sourcePool = new Pool({
        host: DB_HOST,
        port: Number(DB_PORT),
        user: DB_USER,
        password: DB_PASSWORD,
        database: SOURCE_DATABASE,
        ssl: process.env.DB_SSL === "true"
            ? { rejectUnauthorized: true }
            : false,
        connectionTimeoutMillis: 5_000
    });
    try {
        const identity = await sourcePool.query(
            `SELECT current_database() AS database_name,
                    current_user AS database_user,
                    current_schema() AS schema_name,
                    host(inet_server_addr()) AS server_address,
                    inet_server_port() AS server_port,
                    current_setting('server_version') AS server_version`
        );
        const target = identity.rows[0];
        assert.equal(target.database_name, SOURCE_DATABASE);
        assert.equal(target.database_user, DB_USER);
        assert.equal(target.schema_name, "public");
        assert.ok(
            ["127.0.0.1", "::1"].includes(target.server_address),
            `Expected a loopback PostgreSQL connection, got ${target.server_address}.`
        );
        assert.equal(Number(target.server_port), 5432);
        console.log(
            `Read-only source confirmed: ${target.database_name} at localhost:${target.server_port}, schema ${target.schema_name}, PostgreSQL ${target.server_version}.`
        );
    } finally {
        await sourcePool.end();
    }

    const tempDirectory = fs.mkdtempSync(
        path.join(os.tmpdir(), `noveltail-role-rehearsal-${process.pid}-`)
    );
    const dataDirectory = path.join(tempDirectory, "data");
    const sourceDump = path.join(tempDirectory, "source-schema.dump");
    const postgresLog = path.join(tempDirectory, "postgres.log");
    const databaseName = `noveltail_test_${Date.now()}_${process.pid}`;
    const port = await getFreePort();
    let serverStarted = false;
    let testProcessStatus = 1;
    let adminPool;
    let runtimePool;

    try {
        const sourceEnv = {
            ...process.env,
            PGPASSWORD: DB_PASSWORD
        };
        runTool(tools.pg_dump, [
            "--no-password",
            "--host", DB_HOST,
            "--port", String(DB_PORT),
            "--username", DB_USER,
            "--schema-only",
            "--format=custom",
            "--no-owner",
            "--no-acl",
            `--file=${sourceDump}`,
            "--dbname", SOURCE_DATABASE
        ], { env: sourceEnv });
        console.log(
            "Created a schema-only source snapshot; no Noveltail table data was copied."
        );

        runTool(tools.initdb, [
            "--auth-local=trust",
            "--auth-host=trust",
            "--username=postgres",
            "--encoding=UTF8",
            "--locale=C",
            "--no-instructions",
            dataDirectory
        ]);
        runTool(tools.pg_ctl, [
            "-D", dataDirectory,
            "-l", postgresLog,
            "-o", `-h 127.0.0.1 -p ${port}`,
            "-w", "start"
        ]);
        serverStarted = true;

        const adminConfig = {
            host: "127.0.0.1",
            port,
            user: "postgres",
            database: "postgres",
            connectionTimeoutMillis: 5_000
        };
        await waitForDatabase(adminConfig);
        adminPool = new Pool(adminConfig);
        await adminPool.query(`CREATE DATABASE ${quoteIdentifier(databaseName)}`);
        runTool(tools.pg_restore, [
            "--no-password",
            "--host", "127.0.0.1",
            "--port", String(port),
            "--username", "postgres",
            "--dbname", databaseName,
            "--no-owner",
            "--no-acl",
            "--exit-on-error",
            sourceDump
        ]);

        const dbCheck = new Pool({ ...adminConfig, database: databaseName });
        try {
            const rateLimitTable = await dbCheck.query(
                "SELECT to_regclass('public.rate_limit_buckets') AS table_name"
            );
            assert.equal(
                rateLimitTable.rows[0].table_name,
                null,
                "Migration 005 must remain unapplied in this 001-004 role rehearsal."
            );
        } finally {
            await dbCheck.end();
        }

        await adminPool.query(
            `CREATE ROLE ${quoteIdentifier(RUNTIME_ROLE)} LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS`
        );
        await adminPool.query(`GRANT CONNECT ON DATABASE ${quoteIdentifier(databaseName)} TO ${quoteIdentifier(RUNTIME_ROLE)}`);
        const testAdminPool = new Pool({ ...adminConfig, database: databaseName });
        let grants;
        try {
            grants = await grantPrivileges(testAdminPool, databaseName, RUNTIME_ROLE);
        } finally {
            await testAdminPool.end();
        }

        const runtimeConfig = {
            host: "127.0.0.1",
            port,
            user: RUNTIME_ROLE,
            password: "",
            database: databaseName,
            connectionTimeoutMillis: 5_000
        };
        runtimePool = new Pool(runtimeConfig);
        await verifyPrivileges(
            runtimePool,
            RUNTIME_ROLE,
            grants.sequences,
            grants.identitySequences
        );
        await runtimePool.end();
        runtimePool = undefined;

        const testFiles = [
            path.join("tests", "integration.test.js"),
            path.join("tests", "reports-announcements.test.js")
        ];
        const testEnvironment = {
            ...process.env,
            DB_HOST: "127.0.0.1",
            DB_PORT: String(port),
            DB_NAME: databaseName,
            DB_USER: RUNTIME_ROLE,
            DB_PASSWORD: "",
            DB_SSL: "false",
            DB_POOL_MAX: "10",
            NODE_ENV: "test",
            JWT_SECRET: crypto.randomBytes(32).toString("hex"),
            RATE_LIMIT_STORE: "memory",
            NOVELTAIL_TEST_DB: databaseName
        };
        const testRun = spawnSync(
            process.execPath,
            ["--test", ...testFiles],
            {
                cwd: process.cwd(),
                env: testEnvironment,
                stdio: "inherit",
                windowsHide: true
            }
        );
        if (testRun.error) throw testRun.error;
        testProcessStatus = testRun.status ?? 1;
        if (testProcessStatus !== 0) {
            throw new Error(`Targeted runtime-role API tests failed with exit code ${testProcessStatus}.`);
        }
        console.log(
            "PASS: Login, Wallet/refund, chapter unlock, moderation/appeals, Reports, Announcements/notifications ran as the restricted role."
        );
    } finally {
        if (runtimePool) await runtimePool.end();
        if (adminPool) await adminPool.end();
        if (serverStarted) {
            try {
                runTool(tools.pg_ctl, ["-D", dataDirectory, "-m", "fast", "-w", "stop"]);
            } catch (error) {
                console.error(`Disposable PostgreSQL shutdown failed: ${error.message}`);
                testProcessStatus = 1;
            }
        }
        fs.rmSync(tempDirectory, { recursive: true, force: true });
        console.log("Removed the isolated PostgreSQL cluster, runtime role, test DB, and schema-only dump.");
    }
    process.exitCode = testProcessStatus;
}

main().catch(error => {
    console.error(`Runtime role rehearsal failed: ${error.message}`);
    process.exitCode = 1;
});
