const pool = require("../db");
const { createNotification } = require("../routes/notification-helper");

async function restoreExpiredSuspension(userId) {
    const client = await pool.connect();
    let started = false;

    try {
        await client.query("BEGIN");
        started = true;

        const account = await client.query(
            `SELECT user_id, account_status, suspended_until
             FROM users
             WHERE user_id = $1
             FOR UPDATE`,
            [userId]
        );
        if (!account.rowCount) {
            await client.query("COMMIT");
            started = false;
            return;
        }

        const user = account.rows[0];
        if (user.account_status !== "suspended" ||
            !user.suspended_until ||
            new Date(user.suspended_until).getTime() > Date.now()) {
            await client.query("COMMIT");
            started = false;
            return;
        }

        const expired = await client.query(
            `UPDATE account_suspensions
             SET restored_at = COALESCE(restored_at, CURRENT_TIMESTAMP)
             WHERE user_id = $1
               AND restored_at IS NULL
               AND suspended_until IS NOT NULL
               AND suspended_until <= CURRENT_TIMESTAMP
             RETURNING suspension_id`,
            [userId]
        );
        await client.query(
            `UPDATE users
             SET account_status = 'active',
                 suspended_until = NULL,
                 updated_at = CURRENT_TIMESTAMP
             WHERE user_id = $1 AND account_status = 'suspended'`,
            [userId]
        );

        if (expired.rowCount) {
            await client.query(
                `INSERT INTO admin_action_logs (
                    actor_id, actor_role, target_type, target_id, target_user_id,
                    action, reason, old_values, new_values
                 )
                 VALUES (
                    NULL, 'SYSTEM', 'user', $1, $1,
                    'account_suspension_expired', NULL,
                    jsonb_build_object('accountStatus', 'suspended'),
                    jsonb_build_object(
                        'accountStatus', 'active',
                        'suspensionId', $2::text
                    )
                 )`,
                [userId, String(expired.rows[0].suspension_id)]
            );
            await createNotification(client, {
                userId,
                type: "system",
                category: "account",
                message: "Your suspension has ended. Your account is active again.",
                metadata: {
                    event: "account_suspension_expired",
                    suspensionId: String(expired.rows[0].suspension_id)
                }
            });
        }

        await client.query("COMMIT");
        started = false;
    } catch (error) {
        if (started) {
            await client.query("ROLLBACK");
        }
        throw error;
    } finally {
        client.release();
    }
}

module.exports = { restoreExpiredSuspension };
