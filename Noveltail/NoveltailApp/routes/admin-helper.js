async function logAdminAction(
    client,
    {
        actorId,
        actorRole,
        targetType,
        targetId,
        targetUserId = null,
        action,
        reason = null,
        oldValues = {},
        newValues = {}
    }
) {
    await client.query(
        `INSERT INTO admin_action_logs (
            actor_id, actor_role, target_type, target_id, target_user_id,
            action, reason, old_values, new_values
         )
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9::jsonb)`,
        [
            actorId,
            actorRole,
            targetType,
            targetId,
            targetUserId,
            action,
            reason,
            JSON.stringify(oldValues),
            JSON.stringify(newValues)
        ]
    );
}

module.exports = { logAdminAction };
