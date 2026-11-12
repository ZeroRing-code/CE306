async function validateProductionDatabase(pool, expectedDatabase) {
    const result = await pool.query(
        `SELECT
            current_database() AS database_name,
            role.rolsuper,
            role.rolcreatedb,
            role.rolcreaterole,
            role.rolreplication,
            has_database_privilege(current_user, current_database(), 'CREATE')
                AS database_create,
            has_schema_privilege(current_user, 'public', 'CREATE')
                AS schema_create,
            EXISTS (
                SELECT 1
                FROM pg_roles granted_role
                WHERE pg_has_role(role.oid, granted_role.oid, 'MEMBER')
                    AND (
                        granted_role.rolsuper
                        OR granted_role.rolcreatedb
                        OR granted_role.rolcreaterole
                        OR granted_role.rolreplication
                        OR has_database_privilege(
                            granted_role.oid, current_database(), 'CREATE'
                        )
                        OR has_schema_privilege(
                            granted_role.oid, 'public', 'CREATE'
                        )
                    )
            ) AS member_of_privileged_role,
            EXISTS (
                SELECT 1
                FROM pg_class c
                JOIN pg_namespace n ON n.oid = c.relnamespace
                WHERE n.nspname = 'public'
                    AND c.relowner = role.oid
            )
            OR EXISTS (
                SELECT 1
                FROM pg_proc p
                JOIN pg_namespace n ON n.oid = p.pronamespace
                WHERE n.nspname = 'public'
                    AND p.proowner = role.oid
            )
            OR EXISTS (
                SELECT 1
                FROM pg_type t
                JOIN pg_namespace n ON n.oid = t.typnamespace
                WHERE n.nspname = 'public'
                    AND t.typowner = role.oid
                    AND t.typtype <> 'p'
            ) AS owns_public_objects,
            EXISTS (
                SELECT 1
                FROM pg_class c
                JOIN pg_namespace n ON n.oid = c.relnamespace
                WHERE n.nspname = 'public'
                    AND c.relkind IN ('r', 'p')
                    AND (
                        has_table_privilege(current_user, c.oid, 'TRUNCATE')
                        OR has_table_privilege(current_user, c.oid, 'TRIGGER')
                        OR has_table_privilege(current_user, c.oid, 'REFERENCES')
                        OR (
                            c.relname = 'wallet_transactions'
                            AND (
                                has_table_privilege(current_user, c.oid, 'UPDATE')
                                OR has_any_column_privilege(
                                    current_user, c.oid, 'UPDATE'
                                )
                                OR has_table_privilege(current_user, c.oid, 'DELETE')
                            )
                        )
                    )
            ) AS has_excess_table_privileges,
            EXISTS (
                SELECT 1
                FROM pg_class c
                JOIN pg_namespace n ON n.oid = c.relnamespace
                WHERE n.nspname = 'public'
                    AND c.relkind = 'S'
                    AND has_sequence_privilege(current_user, c.oid, 'UPDATE')
            ) AS can_update_sequences
         FROM pg_roles role
         WHERE role.rolname = current_user`
    );
    const role = result.rows[0];
    if (!role || role.database_name !== expectedDatabase) {
        throw new Error("Connected database does not match configured DB_NAME.");
    }
    if (role.rolsuper || role.rolcreatedb || role.rolcreaterole ||
        role.rolreplication ||
        role.database_create || role.schema_create || role.owns_public_objects ||
        role.member_of_privileged_role || role.has_excess_table_privileges ||
        role.can_update_sequences) {
        throw new Error(
            "Production application role must not have administrative or replication privileges, own public objects, or have DDL/excess table or sequence privileges."
        );
    }

    try {
        await pool.query(
            "SELECT bucket_key, hits, expires_at FROM public.rate_limit_buckets LIMIT 0"
        );
    } catch {
        throw new Error(
            "Production database is missing the shared rate-limit table or the application role cannot read it; apply the reviewed migration and grants first."
        );
    }

    const limiter = await pool.query(
        `SELECT
            has_column_privilege(current_user, 'public.rate_limit_buckets', 'bucket_key', 'INSERT')
            AND has_column_privilege(current_user, 'public.rate_limit_buckets', 'hits', 'INSERT')
            AND has_column_privilege(current_user, 'public.rate_limit_buckets', 'expires_at', 'INSERT')
            AND has_column_privilege(current_user, 'public.rate_limit_buckets', 'hits', 'UPDATE')
            AND has_column_privilege(current_user, 'public.rate_limit_buckets', 'expires_at', 'UPDATE')
            AND has_table_privilege(current_user, 'public.rate_limit_buckets', 'DELETE')
                AS can_use_shared_limiter`
    );
    if (!limiter.rows[0] || !limiter.rows[0].can_use_shared_limiter) {
        throw new Error(
            "Production application role lacks required shared rate-limit INSERT, UPDATE, or DELETE privileges."
        );
    }
}

module.exports = { validateProductionDatabase };
