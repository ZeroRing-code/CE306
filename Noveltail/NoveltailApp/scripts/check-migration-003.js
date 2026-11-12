require("dotenv").config();

const { Pool } = require("pg");

const pool = new Pool({
    host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT),
    database: process.env.DB_NAME,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD
});

async function main() {
    if (!process.env.DB_NAME) {
        throw new Error("DB_NAME must identify the database to inspect.");
    }

    const database = await pool.query("SELECT current_database() AS name");
    const required = await pool.query(
        `SELECT table_name, column_name
         FROM information_schema.columns
         WHERE table_schema = 'public'
           AND (table_name, column_name) IN (
               ('account_suspensions', 'user_id'),
               ('account_suspensions', 'restored_at'),
               ('account_suspensions', 'suspended_until'),
               ('admin_action_logs', 'actor_role')
           )`
    );
    const duplicates = await pool.query(
        `SELECT user_id, COUNT(*)::int AS active_rows
         FROM account_suspensions
         WHERE restored_at IS NULL
         GROUP BY user_id
         HAVING COUNT(*) > 1
         ORDER BY user_id
         LIMIT 20`
    );
    const roleConstraint = await pool.query(
        `SELECT conname, pg_get_constraintdef(oid) AS definition
         FROM pg_constraint
         WHERE conrelid = 'admin_action_logs'::regclass
           AND contype = 'c'
           AND pg_get_constraintdef(oid) ILIKE '%actor_role%'`
    );
    const roles = await pool.query(
        "SELECT DISTINCT actor_role FROM admin_action_logs ORDER BY actor_role"
    );
    const reportColumns = await pool.query(
        `SELECT table_name, column_name
         FROM information_schema.columns
         WHERE table_schema = 'public'
           AND (table_name, column_name) IN (
               ('reports', 'reporter_id'),
               ('reports', 'target_novel_id'),
               ('reports', 'target_chapter_id'),
               ('reports', 'target_comment_id'),
               ('reports', 'reason'),
               ('reports', 'details'),
               ('reports', 'status'),
               ('reports', 'reviewed_by'),
               ('reports', 'reviewed_at'),
               ('announcements', 'announcement_id'),
               ('announcements', 'title'),
               ('announcements', 'content'),
               ('announcements', 'audience_type'),
               ('announcements', 'audience_filter'),
               ('announcements', 'status'),
               ('announcements', 'published_at'),
               ('announcements', 'expires_at'),
               ('announcement_recipients', 'announcement_id'),
               ('announcement_recipients', 'user_id'),
               ('announcement_recipients', 'is_read'),
               ('announcement_recipients', 'delivered_at'),
               ('announcement_recipients', 'read_at')
           )`
    );
    const reportDuplicates = await pool.query(
        `SELECT target_type, reporter_id, target_id, COUNT(*)::int AS open_reports
         FROM (
             SELECT 'novel'::text AS target_type, reporter_id,
                    target_novel_id AS target_id
             FROM reports
             WHERE target_novel_id IS NOT NULL AND status IN ('pending', 'reviewing')
             UNION ALL
             SELECT 'chapter', reporter_id, target_chapter_id
             FROM reports
             WHERE target_chapter_id IS NOT NULL AND status IN ('pending', 'reviewing')
             UNION ALL
             SELECT 'comment', reporter_id, target_comment_id
             FROM reports
             WHERE target_comment_id IS NOT NULL AND status IN ('pending', 'reviewing')
         ) active
         GROUP BY target_type, reporter_id, target_id
         HAVING COUNT(*) > 1
         ORDER BY target_type, reporter_id, target_id
         LIMIT 20`
    );
    const workflowIndexes = await pool.query(
        `SELECT indexname
         FROM pg_indexes
         WHERE schemaname = 'public'
           AND indexname = ANY($1::text[])`,
        [[
            "reports_one_open_novel_per_reporter",
            "reports_one_open_chapter_per_reporter",
            "reports_one_open_comment_per_reporter"
        ]]
    );
    const logConstraint = await pool.query(
        `SELECT pg_get_constraintdef(oid) AS definition
         FROM pg_constraint
         WHERE conrelid = 'admin_action_logs'::regclass
           AND conname = 'admin_action_target_type_check'`
    );
    const supportsAnnouncementLog = logConstraint.rows.some(row =>
        row.definition.includes("'announcement'")
    );
    const sharedRateLimitTable = await pool.query(
        `SELECT to_regclass('public.rate_limit_buckets') IS NOT NULL AS present`
    );
    const sharedRateLimitReady = sharedRateLimitTable.rows[0].present;

    const expectedColumns = 4;
    console.log(`READ ONLY migration preflight for database "${database.rows[0].name}".`);
    console.log(
        `Required columns: ${required.rowCount}/${expectedColumns}; ` +
            `active suspension conflicts: ${duplicates.rowCount}.`
    );
    console.log(
        `Current actor_role constraint(s): ${
            roleConstraint.rows.map(row => `${row.conname}: ${row.definition}`).join(" | ") ||
            "none found"
        }`
    );
    console.log(
        `Existing actor roles: ${roles.rows.map(row => row.actor_role).join(", ") || "none"}`
    );
    console.log(
        `Reports/Announcements schema: ${reportColumns.rowCount}/22 required columns.`
    );
    console.log(
        `Migration 004 workflow indexes: ${workflowIndexes.rowCount}/3; ` +
        `announcement audit type: ${supportsAnnouncementLog ? "present" : "pending"}.`
    );
    console.log(
        `Migration 005 shared rate-limit table: ${sharedRateLimitReady ? "present" : "pending"}.`
    );

    if (required.rowCount !== expectedColumns) {
        throw new Error("Schema does not match the columns expected by migration 003.");
    }
    if (reportColumns.rowCount !== 22) {
        throw new Error("Reports/Announcements schema is missing required columns.");
    }
    if (duplicates.rowCount) {
        console.error("Duplicate active suspensions must be reviewed before migration:");
        console.error(JSON.stringify(duplicates.rows));
        process.exitCode = 2;
        return;
    }
    if (reportDuplicates.rowCount) {
        console.error("Duplicate open reports must be reviewed before migration 004:");
        console.error(JSON.stringify(reportDuplicates.rows));
        process.exitCode = 2;
        return;
    }
    if (!supportsAnnouncementLog) {
        console.log("Migration 004 must add the announcement Admin Action Log target type.");
    }
    if (workflowIndexes.rowCount !== 3) {
        console.log("Migration 004 must be applied to enable database-level duplicate-report protection.");
    }
    console.log("Preflight passed. No migration was applied.");
}

main()
    .catch(error => {
        console.error(`Migration 003 preflight failed: ${error.message}`);
        process.exitCode = 1;
    })
    .finally(() => pool.end());
