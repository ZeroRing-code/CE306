require("dotenv").config();

const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { Pool } = require("pg");

const sourceDatabase = process.env.DB_NAME;
const adminDatabase = process.env.PG_ADMIN_DATABASE || "postgres";
const testDatabase = `noveltail_test_${Date.now()}_${process.pid}`;
const restoreDatabase = `${testDatabase}_restore`;
const keepDatabase = process.argv.includes("--keep-db");

function quoteIdentifier(value) {
    return `"${String(value).replace(/"/g, '""')}"`;
}

function postgresTool(name) {
    const executable = process.platform === "win32" ? `${name}.exe` : name;
    const postgresRoot = path.join("C:", "Program Files", "PostgreSQL");
    const installedVersions = process.platform === "win32" && fs.existsSync(postgresRoot)
        ? fs.readdirSync(postgresRoot, {
            withFileTypes: true
        }).filter((entry) => entry.isDirectory() && /^\d+$/.test(entry.name))
            .map((entry) => entry.name)
            .sort((left, right) => Number(right) - Number(left))
        : [];
    const candidates = [
        process.env.PG_BIN && path.join(process.env.PG_BIN, executable),
        ...installedVersions.map((version) =>
            path.join(postgresRoot, version, "bin", executable)
        ),
        executable
    ].filter(Boolean);

    return candidates.find((candidate) =>
        candidate === executable || fs.existsSync(candidate)
    );
}

function runPostgresTool(executable, args, env) {
    const result = spawnSync(executable, args, {
        env,
        stdio: "inherit"
    });
    if (result.error) {
        throw result.error;
    }
    if (result.status !== 0) {
        throw new Error(`${path.basename(executable)} exited with code ${result.status}.`);
    }
}

function verifyBackupArchive(executable, dumpFile, env) {
    const result = spawnSync(executable, ["--list", dumpFile], {
        env,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"]
    });
    if (result.error) {
        throw result.error;
    }
    if (result.status !== 0 ||
        !/TABLE DATA|TABLE\s+public(?:\.|\s)/i.test(result.stdout || "")) {
        throw new Error(
            `pg_restore could not validate the disposable backup archive: ${
                result.stderr || `exit code ${result.status}`
            }`
        );
    }
    console.log("Disposable backup archive verified with pg_restore --list.");
}

async function replayMigrations(databaseConfig) {
    const migrationDirectory = path.join(process.cwd(), "migrations");
    const migrationFiles = fs.readdirSync(migrationDirectory)
        .filter((name) => /^\d+_.+\.sql$/.test(name))
        .sort();
    if (!migrationFiles.length) {
        throw new Error("No numbered SQL migration files were found.");
    }

    const testPool = new Pool(databaseConfig);
    try {
        for (const migrationFile of migrationFiles) {
            const sql = fs.readFileSync(
                path.join(migrationDirectory, migrationFile),
                "utf8"
            );
            await testPool.query(sql);
            await testPool.query(sql);
            console.log(`Migration applied and replayed: ${migrationFile}`);
        }
    } finally {
        await testPool.end();
    }
}

async function main() {
    if (!sourceDatabase || sourceDatabase === testDatabase) {
        throw new Error("DB_NAME must identify the existing Noveltail database.");
    }

    const pgDump = postgresTool("pg_dump");
    const pgRestore = postgresTool("pg_restore");
    if (!pgDump || !pgRestore) {
        throw new Error(
            "PostgreSQL pg_dump and pg_restore utilities are required for an isolated test run."
        );
    }

    const config = {
        host: process.env.DB_HOST,
        port: Number(process.env.DB_PORT),
        user: process.env.DB_USER,
        password: process.env.DB_PASSWORD,
        database: adminDatabase
    };

    const adminPool = new Pool(config);
    const tempDirectory = fs.mkdtempSync(
        path.join(os.tmpdir(), `noveltail-test-${process.pid}-`)
    );
    const dumpFile = path.join(tempDirectory, "database.dump");
    const recoveryDumpFile = path.join(tempDirectory, "recovery.dump");
    let databaseCreated = false;
    let restoreDatabaseCreated = false;
    let exitCode = 1;

    try {
        const source = await adminPool.query(
            "SELECT datname FROM pg_database WHERE datname = $1",
            [sourceDatabase]
        );
        if (!source.rowCount) {
            throw new Error(`Source database "${sourceDatabase}" does not exist.`);
        }

        await adminPool.query(
            `CREATE DATABASE ${quoteIdentifier(testDatabase)}`
        );
        databaseCreated = true;

        const postgresEnv = {
            ...process.env,
            PGPASSWORD: process.env.DB_PASSWORD || ""
        };
        const connectionArgs = [
            "--host", process.env.DB_HOST,
            "--port", String(process.env.DB_PORT || 5432),
            "--username", process.env.DB_USER
        ];
        runPostgresTool(
            pgDump,
            [
                ...connectionArgs,
                "--schema-only",
                "--format=custom",
                "--no-owner",
                "--no-acl",
                `--file=${dumpFile}`,
                "--dbname", sourceDatabase
            ],
            postgresEnv
        );
        verifyBackupArchive(pgRestore, dumpFile, postgresEnv);
        console.log("Created a schema-only test snapshot; source table data was not copied.");
        runPostgresTool(
            pgRestore,
            [
                ...connectionArgs,
                "--no-owner",
                "--no-acl",
                "--exit-on-error",
                "--dbname", testDatabase,
                dumpFile
            ],
            postgresEnv
        );

        await replayMigrations({ ...config, database: testDatabase });

        const runBrowserTests = process.argv.includes("--e2e");
        const testFiles = fs.readdirSync(path.join(process.cwd(), "tests"))
            .filter((name) => name.endsWith(".test.js"))
            .sort()
            .map((name) => path.join("tests", name));
        if (!runBrowserTests && !testFiles.length) {
            throw new Error("No Node.js test files were found.");
        }
        const command = runBrowserTests
            ? [
                path.join(process.cwd(), "node_modules", "@playwright", "test", "cli.js"),
                "test"
            ]
            : ["--test", ...testFiles];
        const testProcess = spawnSync(
            process.execPath,
            command,
            {
                cwd: process.cwd(),
                env: {
                    ...process.env,
                    DB_NAME: testDatabase,
                    NOVELTAIL_TEST_DB: testDatabase
                },
                stdio: "inherit"
            }
        );

        exitCode = testProcess.status ?? 1;
        if (testProcess.error) {
            throw testProcess.error;
        }
        if (exitCode === 0) {
            await adminPool.query(`CREATE DATABASE ${quoteIdentifier(restoreDatabase)}`);
            restoreDatabaseCreated = true;
            runPostgresTool(
                pgDump,
                [
                    ...connectionArgs,
                    "--format=custom",
                    "--no-owner",
                    "--no-acl",
                    `--file=${recoveryDumpFile}`,
                    "--dbname", testDatabase
                ],
                postgresEnv
            );
            verifyBackupArchive(pgRestore, recoveryDumpFile, postgresEnv);
            runPostgresTool(
                pgRestore,
                [
                    ...connectionArgs,
                    "--no-owner",
                    "--no-acl",
                    "--exit-on-error",
                    "--dbname", restoreDatabase,
                    recoveryDumpFile
                ],
                postgresEnv
            );
            const sourceTestPool = new Pool({ ...config, database: testDatabase });
            const restoredPool = new Pool({ ...config, database: restoreDatabase });
            try {
                const sourceUsers = await sourceTestPool.query(
                    "SELECT COUNT(*)::int AS count FROM users"
                );
                const restoredUsers = await restoredPool.query(
                    "SELECT COUNT(*)::int AS count FROM users"
                );
                if (sourceUsers.rows[0].count < 1 ||
                    restoredUsers.rows[0].count !== sourceUsers.rows[0].count) {
                    throw new Error(
                        "Synthetic user row count did not match after backup restore."
                    );
                }
            } finally {
                await Promise.all([sourceTestPool.end(), restoredPool.end()]);
            }
            console.log("Synthetic-data backup restored and verified in a disposable database.");
        }
    } finally {
        try {
            if (restoreDatabaseCreated) {
                await adminPool.query(
                    `SELECT pg_terminate_backend(pid)
                     FROM pg_stat_activity
                     WHERE datname = $1 AND pid <> pg_backend_pid()`,
                    [restoreDatabase]
                );
                await adminPool.query(
                    `DROP DATABASE ${quoteIdentifier(restoreDatabase)}`
                );
            }
            if (databaseCreated && !(keepDatabase && exitCode === 0)) {
                await adminPool.query(
                    `SELECT pg_terminate_backend(pid)
                     FROM pg_stat_activity
                     WHERE datname = $1 AND pid <> pg_backend_pid()`,
                    [testDatabase]
                );
                await adminPool.query(
                    `DROP DATABASE ${quoteIdentifier(testDatabase)}`
                );
            } else if (databaseCreated) {
                console.log(`Isolated test database retained for browser QA: ${testDatabase}`);
            }
        } finally {
            await adminPool.end();
            fs.rmSync(tempDirectory, { recursive: true, force: true });
        }
    }

    process.exitCode = exitCode;
}

main().catch((error) => {
    console.error(`Isolated test run failed: ${error.message}`);
    process.exitCode = 1;
});
