const express = require("express");
const pool = require("../db");
const requireAuth = require("../middleware/auth");
const { requireAdmin, requireSuperAdmin } = require("../middleware/admin");
const { createNotification } = require("./notification-helper");
const { logAdminAction } = require("./admin-helper");
const { restoreExpiredSuspension } = require("../middleware/suspensions");
const { rateLimits } = require("../middleware/rate-limit");

const router = express.Router();
router.use(requireAuth, requireAdmin, rateLimits.admin);

function validId(value) {
    return /^\d+$/.test(String(value)) && Number(value) > 0;
}

function parsePage(value) {
    const page = Number.parseInt(value, 10);
    return Number.isSafeInteger(page) && page > 0 ? Math.min(page, 100000) : 1;
}

function escapeLike(value) {
    return value.replace(/[\\%_]/g, "\\$&");
}

function canManageAccount(actor, target) {
    if (String(actor.user_id) === String(target.user_id) ||
        target.role === "SUPER_ADMIN") {
        return false;
    }
    if (actor.role === "SUPER_ADMIN") {
        return ["USER", "ADMIN"].includes(target.role);
    }
    if (actor.role === "ADMIN" || actor.is_admin === true) {
        return target.role === "USER" && target.is_admin !== true;
    }
    return false;
}

router.get("/users", async (req, res) => {
    const query = typeof req.query.q === "string"
        ? req.query.q.trim().slice(0, 100)
        : "";
    const page = parsePage(req.query.page);
    const role = typeof req.query.role === "string" ? req.query.role : "";
    if (role && !["USER", "ADMIN", "SUPER_ADMIN"].includes(role)) {
        return res.status(400).json({ message: "Invalid account role filter." });
    }

    try {
        const values = [];
        const conditions = [];
        if (query) {
            values.push(`%${escapeLike(query)}%`);
            conditions.push(
                `(username ILIKE $${values.length} ESCAPE E'\\\\' OR ` +
                `display_name ILIKE $${values.length} ESCAPE E'\\\\' OR ` +
                `email ILIKE $${values.length} ESCAPE E'\\\\')`
            );
        }
        if (role) {
            values.push(role);
            conditions.push(`role = $${values.length}`);
        }
        const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
        const pageSize = 25;
        const offset = (page - 1) * pageSize;
        const [accounts, count] = await Promise.all([
            pool.query(
                `SELECT user_id, username, display_name, role, account_status,
                        created_at
                 FROM users
                 ${where}
                 ORDER BY username, user_id
                 LIMIT ${pageSize} OFFSET ${offset}`,
                values
            ),
            pool.query(
                `SELECT COUNT(*)::int AS total FROM users ${where}`,
                values
            )
        ]);
        res.json({
            users: accounts.rows,
            page,
            pageSize,
            total: count.rows[0].total,
            canManageRoles: req.user.role === "SUPER_ADMIN"
        });
    } catch (error) {
        console.error("Search user accounts:", error);
        res.status(500).json({ message: "Could not search user accounts." });
    }
});

router.get("/users/:userId", async (req, res) => {
    if (!validId(req.params.userId)) {
        return res.status(400).json({ message: "Invalid user ID." });
    }
    try {
        await restoreExpiredSuspension(req.params.userId);
        const [account, suspensions] = await Promise.all([
            pool.query(
                `SELECT user_id, username, display_name, email, role,
                        account_status, suspended_until, status_reason,
                        created_at
                 FROM users
                 WHERE user_id = $1`,
                [req.params.userId]
            ),
            pool.query(
                `SELECT s.suspension_id, s.issued_by, s.reason,
                        s.suspended_at, s.suspended_until, s.restored_at,
                        issuer.username AS issued_by_username
                 FROM account_suspensions s
                 LEFT JOIN users issuer ON issuer.user_id = s.issued_by
                 WHERE s.user_id = $1
                 ORDER BY s.suspended_at DESC, s.suspension_id DESC`,
                [req.params.userId]
            )
        ]);
        if (!account.rowCount) {
            return res.status(404).json({ message: "User account not found." });
        }
        res.json({
            user: account.rows[0],
            suspensions: suspensions.rows,
            canManage: canManageAccount(req.user, account.rows[0]),
            canManageRole: req.user.role === "SUPER_ADMIN" &&
                ["USER", "ADMIN"].includes(account.rows[0].role)
        });
    } catch (error) {
        console.error("Get account moderation detail:", error);
        res.status(500).json({ message: "Could not load account details." });
    }
});

router.patch(
    "/users/:userId/role",
    requireSuperAdmin,
    async (req, res) => {
        if (!validId(req.params.userId)) {
            return res.status(400).json({ message: "Invalid user ID." });
        }
        const role = req.body?.role;
        const reason = typeof req.body?.reason === "string"
            ? req.body.reason.trim()
            : "";
        if (!["USER", "ADMIN"].includes(role)) {
            return res.status(400).json({
                message: "Role must be USER or ADMIN."
            });
        }
        if (reason.length < 3 || reason.length > 500) {
            return res.status(400).json({
                message: "Enter an audit reason of 3–500 characters."
            });
        }

        const client = await pool.connect();
        try {
            await client.query("BEGIN");
            const actor = await client.query(
                `SELECT role
                 FROM users
                 WHERE user_id = $1
                 FOR SHARE`,
                [req.user.user_id]
            );
            if (!actor.rowCount || actor.rows[0].role !== "SUPER_ADMIN") {
                await client.query("ROLLBACK");
                return res.status(403).json({
                    message: "Only the SUPER_ADMIN can manage administrator roles."
                });
            }
            const result = await client.query(
                `SELECT user_id, username, display_name, role, is_admin
                 FROM users
                 WHERE user_id = $1
                 FOR UPDATE`,
                [req.params.userId]
            );
            if (!result.rowCount) {
                await client.query("ROLLBACK");
                return res.status(404).json({ message: "User account not found." });
            }
            const target = result.rows[0];
            if (!["USER", "ADMIN"].includes(target.role)) {
                await client.query("ROLLBACK");
                return res.status(409).json({
                    message: "SUPER_ADMIN accounts cannot be changed through the API."
                });
            }
            if (target.role === role) {
                await client.query("COMMIT");
                return res.json({
                    changed: false,
                    message: `This account is already ${role}.`,
                    user: {
                        user_id: target.user_id,
                        username: target.username,
                        display_name: target.display_name,
                        role: target.role
                    }
                });
            }

            const updated = await client.query(
                `UPDATE users
                 SET role = $1,
                     is_admin = $2,
                     updated_at = CURRENT_TIMESTAMP
                 WHERE user_id = $3
                 RETURNING user_id, username, display_name, role`,
                [role, role === "ADMIN", target.user_id]
            );
            await logAdminAction(client, {
                actorId: req.user.user_id,
                actorRole: "SUPER_ADMIN",
                targetType: "user",
                targetId: target.user_id,
                targetUserId: target.user_id,
                action: role === "ADMIN"
                    ? "admin_role_granted"
                    : "admin_role_revoked",
                reason,
                oldValues: { role: target.role, isAdmin: target.is_admin },
                newValues: { role, isAdmin: role === "ADMIN" }
            });
            await client.query("COMMIT");
            res.json({
                changed: true,
                message: role === "ADMIN"
                    ? "Administrator role assigned."
                    : "Administrator role removed.",
                user: updated.rows[0]
            });
        } catch (error) {
            await client.query("ROLLBACK");
            console.error("Change administrator role:", error);
            res.status(500).json({
                message: "Could not change the account role."
            });
        } finally {
            client.release();
        }
    }
);

router.post("/users/:userId/suspensions", async (req, res) => {
    if (!validId(req.params.userId)) {
        return res.status(400).json({ message: "Invalid user ID." });
    }
    const reason = typeof req.body?.reason === "string"
        ? req.body.reason.trim()
        : "";
    const duration = req.body?.duration;
    const permanent = duration === "permanent";
    const durationDays = Number(duration);
    if (reason.length < 3 || reason.length > 2000 ||
        (!permanent &&
            (!Number.isInteger(durationDays) ||
                durationDays < 1 ||
                durationDays > 365))) {
        return res.status(400).json({
            message: "Enter a reason of 3–2,000 characters and choose a duration of 1–365 days or permanent."
        });
    }

    await restoreExpiredSuspension(req.params.userId);
    const client = await pool.connect();
    try {
        await client.query("BEGIN");
        const result = await client.query(
            `SELECT user_id, username, role, is_admin, account_status,
                    suspended_until
             FROM users
             WHERE user_id = $1
             FOR UPDATE`,
            [req.params.userId]
        );
        if (!result.rowCount) {
            await client.query("ROLLBACK");
            return res.status(404).json({ message: "User account not found." });
        }
        const target = result.rows[0];
        if (!canManageAccount(req.user, target)) {
            await client.query("ROLLBACK");
            return res.status(403).json({
                message: "You do not have permission to manage this account."
            });
        }
        if (target.account_status !== "active") {
            await client.query("ROLLBACK");
            return res.status(409).json({
                message: "This account cannot be suspended in its current state."
            });
        }

        const inserted = await client.query(
            `INSERT INTO account_suspensions (
                user_id, issued_by, reason, suspended_at, suspended_until
             )
             VALUES (
                $1, $2, $3, CURRENT_TIMESTAMP,
                CASE WHEN $4::boolean THEN NULL
                     ELSE CURRENT_TIMESTAMP + ($5::int * INTERVAL '1 day')
                END
             )
             RETURNING suspension_id, suspended_at, suspended_until`,
            [
                target.user_id,
                req.user.user_id,
                reason,
                permanent,
                permanent ? null : durationDays
            ]
        );
        const suspension = inserted.rows[0];
        await client.query(
            `UPDATE users
             SET account_status = 'suspended',
                 suspended_until = $1,
                 status_reason = $2,
                 updated_at = CURRENT_TIMESTAMP
             WHERE user_id = $3`,
            [suspension.suspended_until, reason, target.user_id]
        );
        await logAdminAction(client, {
            actorId: req.user.user_id,
            actorRole: req.adminRole,
            targetType: "user",
            targetId: target.user_id,
            targetUserId: target.user_id,
            action: "account_suspended",
            reason,
            oldValues: { accountStatus: target.account_status },
            newValues: {
                accountStatus: "suspended",
                suspensionId: String(suspension.suspension_id),
                suspensionType: permanent ? "permanent" : "temporary",
                suspendedUntil: suspension.suspended_until
            }
        });
        await createNotification(client, {
            userId: target.user_id,
            type: "system",
            category: "account",
            message: permanent
                ? "Your account has been permanently suspended."
                : `Your account has been suspended until ${
                    new Date(suspension.suspended_until).toLocaleString("en-US")
                }`,
            metadata: {
                event: "account_suspended",
                suspensionId: String(suspension.suspension_id),
                suspensionType: permanent ? "permanent" : "temporary",
                appealsUrl: "/appeals.html"
            }
        });
        await client.query("COMMIT");
        res.status(201).json({
            message: "Account suspended.",
            suspension
        });
    } catch (error) {
        await client.query("ROLLBACK");
        if (error.code === "23505") {
            return res.status(409).json({
                message: "This account already has an active suspension."
            });
        }
        console.error("Suspend user account:", error);
        res.status(500).json({ message: "Could not suspend account." });
    } finally {
        client.release();
    }
});

router.patch(
    "/users/:userId/suspensions/:suspensionId/restore",
    async (req, res) => {
        if (!validId(req.params.userId) ||
            !validId(req.params.suspensionId)) {
            return res.status(400).json({
                message: "Invalid user or suspension ID."
            });
        }
        const reason = typeof req.body?.reason === "string"
            ? req.body.reason.trim()
            : "";
        if (reason.length < 3 || reason.length > 2000) {
            return res.status(400).json({
                message: "Enter a reason of 3–2,000 characters."
            });
        }

        const client = await pool.connect();
        try {
            await client.query("BEGIN");
            const userResult = await client.query(
                `SELECT user_id, role, is_admin, account_status,
                        suspended_until
                 FROM users
                 WHERE user_id = $1
                 FOR UPDATE`,
                [req.params.userId]
            );
            if (!userResult.rowCount) {
                await client.query("ROLLBACK");
                return res.status(404).json({ message: "User account not found." });
            }
            const target = userResult.rows[0];
            if (!canManageAccount(req.user, target)) {
                await client.query("ROLLBACK");
                return res.status(403).json({
                    message: "You do not have permission to manage this account."
                });
            }
            const suspensionResult = await client.query(
                `SELECT suspension_id, reason, suspended_until, restored_at
                 FROM account_suspensions
                 WHERE suspension_id = $1 AND user_id = $2
                 FOR UPDATE`,
                [req.params.suspensionId, target.user_id]
            );
            if (!suspensionResult.rowCount) {
                await client.query("ROLLBACK");
                return res.status(404).json({
                    message: "Suspension history for this account was not found."
                });
            }
            const suspension = suspensionResult.rows[0];
            if (suspension.restored_at ||
                target.account_status !== "suspended") {
                await client.query("ROLLBACK");
                return res.status(409).json({
                    message: "This suspension has already ended."
                });
            }

            await client.query(
                `UPDATE account_suspensions
                 SET restored_at = CURRENT_TIMESTAMP
                 WHERE suspension_id = $1`,
                [suspension.suspension_id]
            );
            await client.query(
                `UPDATE users
                 SET account_status = 'active',
                     suspended_until = NULL,
                     status_reason = NULL,
                     updated_at = CURRENT_TIMESTAMP
                 WHERE user_id = $1`,
                [target.user_id]
            );
            await logAdminAction(client, {
                actorId: req.user.user_id,
                actorRole: req.adminRole,
                targetType: "user",
                targetId: target.user_id,
                targetUserId: target.user_id,
                action: "account_suspension_cancelled",
                reason,
                oldValues: {
                    accountStatus: target.account_status,
                    suspensionId: String(suspension.suspension_id)
                },
                newValues: { accountStatus: "active" }
            });
            await createNotification(client, {
                userId: target.user_id,
                type: "system",
                category: "account",
                message: "Your suspension has been lifted. Your account is active again.",
                metadata: {
                    event: "account_suspension_cancelled",
                    suspensionId: String(suspension.suspension_id)
                }
            });
            await client.query("COMMIT");
            res.json({ message: "Account restored." });
        } catch (error) {
            await client.query("ROLLBACK");
            console.error("Restore user account:", error);
            res.status(500).json({ message: "Could not restore account." });
        } finally {
            client.release();
        }
    }
);

router.get("/novels", async (req, res) => {
    const page = parsePage(req.query.page);
    const query = typeof req.query.q === "string"
        ? req.query.q.trim().slice(0, 100)
        : "";
    const status = ["active", "suspended"].includes(req.query.status)
        ? req.query.status
        : null;
    const values = [];
    const conditions = [];
    if (query) {
        values.push(`%${escapeLike(query)}%`);
        conditions.push(
            `(n.title ILIKE $${values.length} ESCAPE E'\\\\' OR ` +
            `u.username ILIKE $${values.length} ESCAPE E'\\\\')`
        );
    }
    if (status) {
        values.push(status);
        conditions.push(`n.moderation_status = $${values.length}`);
    }
    const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
    try {
        const [items, count] = await Promise.all([
            pool.query(
                `SELECT n.novel_id, n.title, n.status, n.moderation_status,
                        n.created_at, n.updated_at, u.user_id AS owner_id,
                        u.username AS owner_username, u.display_name AS owner_name,
                        COUNT(c.chapter_id)::int AS chapter_count
                 FROM novels n
                 JOIN users u ON u.user_id = n.user_id
                 LEFT JOIN chapters c ON c.novel_id = n.novel_id
                 ${where}
                 GROUP BY n.novel_id, u.user_id
                 ORDER BY n.updated_at DESC, n.novel_id DESC
                 LIMIT 20 OFFSET ${(page - 1) * 20}`,
                values
            ),
            pool.query(
                `SELECT COUNT(*)::int AS total
                 FROM novels n
                 JOIN users u ON u.user_id = n.user_id
                 ${where}`,
                values
            )
        ]);
        res.json({
            novels: items.rows,
            page,
            pageSize: 20,
            total: count.rows[0].total
        });
    } catch (error) {
        console.error("List novels for moderation:", error);
        res.status(500).json({ message: "Could not search novels." });
    }
});

router.get("/novels/:novelId", async (req, res) => {
    if (!validId(req.params.novelId)) {
        return res.status(400).json({ message: "Invalid novel ID." });
    }
    try {
        const result = await pool.query(
            `SELECT n.novel_id, n.title, n.description, n.cover_image_url,
                    n.status, n.moderation_status, n.created_at, n.updated_at,
                    u.user_id AS owner_id, u.username AS owner_username,
                    u.display_name AS owner_name, u.account_status AS owner_status
             FROM novels n
             JOIN users u ON u.user_id = n.user_id
             WHERE n.novel_id = $1`,
            [req.params.novelId]
        );
        if (!result.rowCount) {
            return res.status(404).json({ message: "Novel not found." });
        }
        const [chapters, actions] = await Promise.all([
            pool.query(
                `SELECT chapter_id, chapter_number, title, status,
                        is_paid, price, created_at, updated_at
                 FROM chapters
                 WHERE novel_id = $1
                 ORDER BY chapter_number`,
                [req.params.novelId]
            ),
            pool.query(
                `SELECT log_id, actor_id, actor_role, action, reason,
                        old_values, new_values, created_at
                 FROM admin_action_logs
                 WHERE target_type = 'novel' AND target_id = $1
                 ORDER BY created_at DESC, log_id DESC
                 LIMIT 50`,
                [req.params.novelId]
            )
        ]);
        res.json({
            novel: result.rows[0],
            chapters: chapters.rows,
            actions: actions.rows
        });
    } catch (error) {
        console.error("Get novel moderation detail:", error);
        res.status(500).json({ message: "Could not load novel details." });
    }
});

router.patch("/novels/:novelId/moderation", async (req, res) => {
    if (!validId(req.params.novelId) ||
        !["active", "suspended"].includes(req.body?.moderation_status)) {
        return res.status(400).json({ message: "Invalid novel moderation details." });
    }
    const reason = typeof req.body.reason === "string"
        ? req.body.reason.trim()
        : "";
    if (reason.length < 3 || reason.length > 1000) {
        return res.status(400).json({
            message: "Enter a reason of 3–1,000 characters."
        });
    }

    const client = await pool.connect();
    try {
        await client.query("BEGIN");
        const current = await client.query(
            `SELECT n.novel_id, n.title, n.user_id, n.moderation_status
             FROM novels n
             WHERE n.novel_id = $1
             FOR UPDATE`,
            [req.params.novelId]
        );
        if (!current.rowCount) {
            await client.query("ROLLBACK");
            return res.status(404).json({ message: "Novel not found." });
        }
        const novel = current.rows[0];
        const nextStatus = req.body.moderation_status;
        if (novel.moderation_status === nextStatus) {
            await client.query("COMMIT");
            return res.json({
                message: "Novel already has this status.",
                moderation_status: nextStatus,
                changed: false
            });
        }
        await client.query(
            `UPDATE novels
             SET moderation_status = $1, updated_at = CURRENT_TIMESTAMP
             WHERE novel_id = $2`,
            [nextStatus, novel.novel_id]
        );
        await logAdminAction(client, {
            actorId: req.user.user_id,
            actorRole: req.adminRole,
            targetType: "novel",
            targetId: novel.novel_id,
            targetUserId: novel.user_id,
            action: nextStatus === "suspended" ? "novel_suspended" : "novel_restored",
            reason,
            oldValues: { moderationStatus: novel.moderation_status },
            newValues: { moderationStatus: nextStatus }
        });
        await createNotification(client, {
            userId: novel.user_id,
            type: "novel_status",
            category: "novel",
            message: nextStatus === "suspended"
                ? `Novel "${novel.title}" has been suspended from publication.`
                : `Novel "${novel.title}" is available for publication again.`,
            novelId: novel.novel_id,
            metadata: { moderationStatus: nextStatus }
        });
        await client.query("COMMIT");
        res.json({
            message: nextStatus === "suspended"
                ? "Novel suspended."
                : "Novel restored.",
            moderation_status: nextStatus,
            changed: true
        });
    } catch (error) {
        await client.query("ROLLBACK");
        console.error("Update novel moderation status:", error);
        res.status(500).json({ message: "Could not update novel status." });
    } finally {
        client.release();
    }
});

module.exports = router;
