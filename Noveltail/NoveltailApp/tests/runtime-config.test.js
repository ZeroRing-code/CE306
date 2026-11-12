const assert = require("node:assert/strict");
const { after, test } = require("node:test");
const { validateRuntimeConfig } = require("../config/runtime-validation");
const { validateProductionDatabase } =
    require("../config/production-database");
const pool = require("../db");

assert.match(
    process.env.NOVELTAIL_TEST_DB || "",
    /^noveltail_test_\d+_\d+$/,
    "Database privilege integration checks must use the disposable database."
);

after(async () => {
    await pool.end();
});

const validProductionConfig = {
    NODE_ENV: "production",
    DB_HOST: "db.internal",
    DB_PORT: "5432",
    DB_NAME: "noveltail",
    DB_USER: "noveltail_runtime",
    DB_PASSWORD: "configured-out-of-band-password",
    DB_SSL: "true",
    JWT_SECRET: "a-production-only-secret-value-with-at-least-32-bytes",
    APP_ORIGIN: "https://noveltail.example",
    TRUST_PROXY_HOPS: "1",
    RATE_LIMIT_STORE: "postgres"
};

test("production configuration accepts valid HTTPS and shared-store settings", () => {
    assert.equal(validateRuntimeConfig(validProductionConfig), true);
});

test("production configuration rejects missing and placeholder secrets", () => {
    assert.throws(
        () => validateRuntimeConfig({
            ...validProductionConfig,
            JWT_SECRET: "replace-with-a-random-secret-at-least-32-characters"
        }),
        /JWT_SECRET must be a non-placeholder/
    );
    assert.throws(
        () => validateRuntimeConfig({
            ...validProductionConfig,
            APP_ORIGIN: "http://noveltail.example"
        }),
        /APP_ORIGIN must be an exact HTTPS origin/
    );
    assert.throws(
        () => validateRuntimeConfig({
            ...validProductionConfig,
            RATE_LIMIT_STORE: "memory"
        }),
        /RATE_LIMIT_STORE must be postgres/
    );
    assert.throws(
        () => validateRuntimeConfig({
            ...validProductionConfig,
            DB_SSL: "false"
        }),
        /DB_SSL must be true/
    );
});

test("non-production configuration keeps local setup permissive", () => {
    assert.equal(validateRuntimeConfig({ NODE_ENV: "development" }), true);
});

test("production database validation rejects an overprivileged DB role", async () => {
    let queries = 0;
    const database = {
        async query() {
            queries += 1;
            return {
                rows: [{
                    database_name: "Noveltail",
                    rolsuper: true,
                    rolcreatedb: true,
                    rolcreaterole: true,
                    rolreplication: false,
                    database_create: true,
                    schema_create: true,
                    member_of_privileged_role: false,
                    owns_public_objects: false,
                    has_excess_table_privileges: false,
                    can_update_sequences: false
                }]
            };
        }
    };
    await assert.rejects(
        validateProductionDatabase(database, "Noveltail"),
        /must not have administrative or replication privileges/
    );
    assert.equal(queries, 1, "Do not probe more DB privileges after a role is rejected.");
});

test("production database privilege query executes on disposable PostgreSQL", async () => {
    await assert.rejects(
        validateProductionDatabase(pool, process.env.NOVELTAIL_TEST_DB),
        /must not have administrative or replication privileges/
    );
});

test("production database validation rejects object ownership and excess DDL grants", async () => {
    for (const privilege of [
        "rolreplication",
        "member_of_privileged_role",
        "owns_public_objects",
        "has_excess_table_privileges",
        "can_update_sequences"
    ]) {
        let queries = 0;
        const database = {
            async query() {
                queries += 1;
                return {
                    rows: [{
                        database_name: "Noveltail",
                        rolsuper: false,
                        rolcreatedb: false,
                        rolcreaterole: false,
                        rolreplication: privilege === "rolreplication",
                        database_create: false,
                        schema_create: false,
                        member_of_privileged_role:
                            privilege === "member_of_privileged_role",
                        owns_public_objects: privilege === "owns_public_objects",
                        has_excess_table_privileges:
                            privilege === "has_excess_table_privileges",
                        can_update_sequences: privilege === "can_update_sequences"
                    }]
                };
            }
        };
        await assert.rejects(
            validateProductionDatabase(database, "Noveltail"),
            /must not have administrative or replication privileges/
        );
        assert.equal(queries, 1);
    }
});

test("production database validation rejects wallet ledger mutation grants on disposable PostgreSQL", async () => {
    const client = await pool.connect();
    const database = await client.query("SELECT current_database() AS name");
    assert.equal(database.rows[0].name, process.env.NOVELTAIL_TEST_DB);

    try {
        for (const [index, privilege] of ["UPDATE", "DELETE"].entries()) {
            const roleName =
                `noveltail_ledger_guard_${process.pid}_${Date.now()}_${index}`;
            let created = false;
            try {
                await client.query(`CREATE ROLE ${roleName} NOLOGIN`);
                created = true;
                await client.query(
                    `GRANT ${privilege} ON TABLE public.wallet_transactions TO ${roleName}`
                );
                await client.query(`SET ROLE ${roleName}`);
                await assert.rejects(
                    validateProductionDatabase(
                        client,
                        process.env.NOVELTAIL_TEST_DB
                    ),
                    /must not have administrative or replication privileges/
                );
            } finally {
                await client.query("RESET ROLE");
                if (created) {
                    await client.query(`DROP OWNED BY ${roleName}`);
                    await client.query(`DROP ROLE ${roleName}`);
                }
            }
        }
    } finally {
        client.release();
    }
});

test("production database validation requires the shared limiter table", async () => {
    let queries = 0;
    const database = {
        async query() {
            queries += 1;
            if (queries === 1) {
                return {
                    rows: [{
                        database_name: "Noveltail",
                        rolsuper: false,
                        rolcreatedb: false,
                        rolcreaterole: false,
                        rolreplication: false,
                        database_create: false,
                        schema_create: false,
                        member_of_privileged_role: false,
                        owns_public_objects: false,
                        has_excess_table_privileges: false,
                        can_update_sequences: false
                    }]
                };
            }
            throw new Error("relation does not exist");
        }
    };
    await assert.rejects(
        validateProductionDatabase(database, "Noveltail"),
        /missing the shared rate-limit table/
    );
});
