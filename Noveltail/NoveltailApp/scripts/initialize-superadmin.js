require("dotenv").config();

const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const readline = require("node:readline");
const bcrypt = require("bcryptjs");
const pool = require("../db");

function promptLine(question) {
    const interface_ = readline.createInterface({
        input: process.stdin,
        output: process.stdout
    });
    return new Promise(resolve => {
        interface_.question(question, answer => {
            interface_.close();
            resolve(answer.trim());
        });
    });
}

function promptSecret(question) {
    const input = process.stdin;
    if (!input.isTTY || typeof input.setRawMode !== "function") {
        return Promise.reject(
            new Error("Run this initializer from an interactive terminal.")
        );
    }

    return new Promise((resolve, reject) => {
        let value = "";
        const finish = (error) => {
            input.removeListener("data", onData);
            input.setRawMode(false);
            input.pause();
            process.stdout.write("\n");
            if (error) reject(error);
            else resolve(value);
        };
        const onData = chunk => {
            for (const character of chunk) {
                if (character === "\u0003") {
                    finish(new Error("Initialization cancelled."));
                    return;
                }
                if (character === "\r" || character === "\n") {
                    finish();
                    return;
                }
                if (character === "\u007f" || character === "\b") {
                    value = value.slice(0, -1);
                } else if (character >= " ") {
                    value += character;
                }
            }
        };

        process.stdout.write(question);
        input.setEncoding("utf8");
        input.setRawMode(true);
        input.resume();
        input.on("data", onData);
    });
}

function getPsqlEnvironment() {
    const env = { ...process.env };
    if (process.env.DB_HOST) env.PGHOST = process.env.DB_HOST;
    if (process.env.DB_PORT) env.PGPORT = process.env.DB_PORT;
    if (process.env.DB_NAME) env.PGDATABASE = process.env.DB_NAME;
    if (process.env.DB_USER) env.PGUSER = process.env.DB_USER;
    if (process.env.DB_PASSWORD !== undefined) {
        env.PGPASSWORD = process.env.DB_PASSWORD;
    }
    env.PGSSLMODE = process.env.DB_SSL === "true" ? "verify-full" : "disable";
    return env;
}

function findPsql() {
    const executable = process.platform === "win32" ? "psql.exe" : "psql";
    const postgresRoot = path.join("C:", "Program Files", "PostgreSQL");
    const versions = process.platform === "win32" && fs.existsSync(postgresRoot)
        ? fs.readdirSync(postgresRoot, { withFileTypes: true })
            .filter(entry => entry.isDirectory() && /^\d+$/.test(entry.name))
            .map(entry => entry.name)
            .sort((left, right) => Number(right) - Number(left))
        : [];
    const candidates = [
        process.env.PG_BIN && path.join(process.env.PG_BIN, executable),
        ...versions.map(version =>
            path.join(postgresRoot, version, "bin", executable)
        ),
        executable
    ].filter(Boolean);
    return candidates.find(candidate =>
        candidate === executable || fs.existsSync(candidate)
    );
}

async function main() {
    const resetPassword = process.argv.includes("--reset-password");
    let database;
    try {
        const identity = await pool.query(
            `SELECT current_database() AS database,
                    COALESCE(inet_server_addr()::text, 'local socket') AS host,
                    inet_server_port() AS port,
                    current_user AS user_name,
                    (SELECT COUNT(*)::integer
                     FROM users
                     WHERE role = 'SUPER_ADMIN') AS superadmin_count`
        );
        database = identity.rows[0];
    } finally {
        await pool.end();
    }

    console.log(
        `Connected database: ${database.database} at ${database.host}:` +
        `${database.port ?? "local"} as ${database.user_name}.`
    );
    const confirmation = await promptLine(
        "Type the database name exactly to confirm initialization: "
    );
    if (confirmation !== database.database) {
        throw new Error("Database confirmation did not match; nothing was changed.");
    }

    const env = getPsqlEnvironment();
    if (resetPassword && database.superadmin_count !== 1) {
        throw new Error("Password reset requires exactly one existing SUPER_ADMIN.");
    }
    if (database.superadmin_count === 0 || resetPassword) {
        const password = await promptSecret("New SUPER_ADMIN password: ");
        const confirmationPassword = await promptSecret("Confirm password: ");
        const passwordLength = Buffer.byteLength(password, "utf8");
        if (password !== confirmationPassword) {
            throw new Error("Passwords do not match.");
        }
        if (passwordLength < 8 || passwordLength > 72) {
            throw new Error("Password must be 8–72 bytes for bcrypt compatibility.");
        }
        env.NOVELTAIL_SUPERADMIN_BCRYPT_HASH = await bcrypt.hash(password, 12);
    } else {
        console.log("An existing SUPER_ADMIN was detected; the SQL checks will validate it without changing credentials.");
    }

    const script = path.resolve(
        __dirname,
        "..",
        "sql",
        resetPassword
            ? "reset-superadmin-password.sql"
            : "initialize-superadmin.sql"
    );
    const psql = findPsql();
    if (!psql) {
        throw new Error("Install PostgreSQL client tools or set PG_BIN to the PostgreSQL bin directory.");
    }
    const result = spawnSync(
        psql,
        [
            "-X",
            "-v",
            "ON_ERROR_STOP=1",
            "-f",
            script
        ],
        { env, stdio: "inherit", windowsHide: true }
    );
    if (result.error) {
        throw new Error("Could not start psql. Install PostgreSQL client tools and add psql to PATH.");
    }
    if (result.status !== 0) {
        throw new Error(`SUPER_ADMIN initialization failed with psql exit code ${result.status}.`);
    }
}

main().catch(error => {
    console.error(error.message);
    process.exitCode = 1;
});
