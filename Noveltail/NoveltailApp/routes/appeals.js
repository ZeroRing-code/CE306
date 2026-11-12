const express = require("express");
const pool = require("../db");
const requireAppealAuth = require("../middleware/appeal-auth");
const { requireAdmin } = require("../middleware/admin");
const { createNotification } = require("./notification-helper");
const { logAdminAction } = require("./admin-helper");
const { rateLimits } = require("../middleware/rate-limit");

const router = express.Router();
const MAX_ATTEMPTS = 4;
const MAX_APPEAL_LENGTH = 5000;
const ACTIVE_STATUSES = new Set(["pending", "reviewing"]);
router.use(requireAppealAuth);

function validId(value) {
    return /^\d+$/.test(String(value)) && Number(value) > 0;
}

function boundedPage(value) {
    const page = Number.parseInt(value, 10);
    return Number.isSafeInteger(page) && page > 0 ? Math.min(page, 100000) : 1;
}

function requireActiveAdmin(req, res, next) {
    if (req.user.account_status !== "active") {
        return res.status(403).json({
            message: "The administrator account is not eligible to perform this action."
        });
    }
    return requireAdmin(req, res, next);
}

router.get("/me/suspensions", async (req, res) => {
    try {
        const result = await pool.query(
            `SELECT s.suspension_id, s.reason, s.suspended_at,
                    s.suspended_until, s.restored_at,
                    COALESCE(a.attempt_count, 0)::int AS attempt_count,
                    a.latest_status,
                    CASE
                        WHEN s.restored_at IS NOT NULL THEN FALSE
                        WHEN $2 <> 'suspended' THEN FALSE
                        WHEN COALESCE(a.attempt_count, 0) >= $3 THEN FALSE
                        WHEN a.latest_status IN ('pending', 'reviewing') THEN FALSE
                        WHEN a.latest_status = 'accepted' THEN FALSE
                        ELSE TRUE
                    END AS can_appeal
             FROM account_suspensions s
             LEFT JOIN LATERAL (
                 SELECT COUNT(*)::int AS attempt_count,
                        (ARRAY_AGG(status ORDER BY attempt_no DESC))[1] AS latest_status
                 FROM appeals
                 WHERE suspension_id = s.suspension_id
             ) a ON TRUE
             WHERE s.user_id = $1
             ORDER BY s.suspended_at DESC, s.suspension_id DESC`,
            [req.user.user_id, req.user.account_status, MAX_ATTEMPTS]
        );
        res.json({
            suspensions: result.rows,
            accountStatus: req.user.account_status,
            maxAttempts: MAX_ATTEMPTS
        });
    } catch (error) {
        console.error("List account suspension history:", error);
        res.status(500).json({ message: "Could not load account suspension history." });
    }
});

router.get("/me", async (req, res) => {
    try {
        const result = await pool.query(
            `SELECT a.appeal_id, a.suspension_id, a.attempt_no,
                    a.appeal_text, a.status, a.decision_note,
                    a.submitted_at, a.reviewed_at,
                    s.reason AS suspension_reason
             FROM appeals a
             JOIN account_suspensions s ON s.suspension_id = a.suspension_id
             WHERE a.user_id = $1
             ORDER BY a.submitted_at DESC, a.appeal_id DESC`,
            [req.user.user_id]
        );
        res.json({ appeals: result.rows });
    } catch (error) {
        console.error("List user appeals:", error);
        res.status(500).json({ message: "Could not load appeals." });
    }
});

router.post("/suspensions/:suspensionId/appeals", rateLimits.appeals, async (req, res) => {
    if (!validId(req.params.suspensionId)) {
        return res.status(400).json({ message: "Invalid suspension ID." });
    }
    const appealText = typeof req.body?.appeal_text === "string"
        ? req.body.appeal_text.trim()
        : "";
    if (!appealText || appealText.length > MAX_APPEAL_LENGTH) {
        return res.status(400).json({
            message: `Enter appeal details of no more than ${MAX_APPEAL_LENGTH} characters.`
        });
    }

    const client = await pool.connect();
    try {
        await client.query("BEGIN");
        const suspensionResult = await client.query(
            `SELECT suspension_id, user_id, restored_at
             FROM account_suspensions
             WHERE suspension_id = $1
             FOR UPDATE`,
            [req.params.suspensionId]
        );
        if (!suspensionResult.rowCount ||
            String(suspensionResult.rows[0].user_id) !== String(req.user.user_id)) {
            await client.query("ROLLBACK");
            return res.status(404).json({ message: "Account suspension history not found." });
        }
        const suspension = suspensionResult.rows[0];
        if (suspension.restored_at || req.user.account_status !== "suspended") {
            await client.query("ROLLBACK");
            return res.status(409).json({
                message: "An appeal cannot be submitted for this suspension."
            });
        }
        const history = await client.query(
            `SELECT attempt_no, status
             FROM appeals
             WHERE suspension_id = $1
             ORDER BY attempt_no DESC
             FOR UPDATE`,
            [suspension.suspension_id]
        );
        const latest = history.rows[0];
        if (latest && ACTIVE_STATUSES.has(latest.status)) {
            await client.query("ROLLBACK");
            return res.status(409).json({
                message: "An appeal for this suspension is already under review."
            });
        }
        if (latest && latest.status !== "rejected") {
            await client.query("ROLLBACK");
            return res.status(409).json({
                message: "A duplicate appeal cannot be submitted for this suspension."
            });
        }
        const attemptNo = Number(latest?.attempt_no || 0) + 1;
        if (attemptNo > MAX_ATTEMPTS) {
            await client.query("ROLLBACK");
            return res.status(409).json({
                message: "The maximum number of appeals has been reached."
            });
        }
        const created = await client.query(
            `INSERT INTO appeals (
                suspension_id, user_id, attempt_no, appeal_text, status,
                last_progress_at, submitted_at
             )
             VALUES ($1, $2, $3, $4, 'pending', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
             RETURNING appeal_id, attempt_no, status, submitted_at`,
            [suspension.suspension_id, req.user.user_id, attemptNo, appealText]
        );
        await client.query("COMMIT");
        res.status(201).json({
            message: "Appeal submitted.",
            appeal: created.rows[0],
            attemptsRemaining: MAX_ATTEMPTS - attemptNo
        });
    } catch (error) {
        await client.query("ROLLBACK");
        console.error("Submit account appeal:", error);
        res.status(500).json({ message: "Could not submit appeal." });
    } finally {
        client.release();
    }
});

router.get("/admin", requireActiveAdmin, rateLimits.admin, async (req, res) => {
    const page = boundedPage(req.query.page);
    const status = ["pending", "reviewing", "accepted", "rejected"].includes(
        req.query.status
    ) ? req.query.status : null;
    const values = [];
    const where = status
        ? (values.push(status), `WHERE a.status = $${values.length}`)
        : "";
    try {
        const [items, count] = await Promise.all([
            pool.query(
                `SELECT a.appeal_id, a.suspension_id, a.attempt_no, a.status,
                        a.submitted_at, a.last_progress_at,
                        u.user_id, u.username, u.display_name,
                        s.reason AS suspension_reason,
                        assignment.admin_id AS assigned_admin_id,
                        admin.username AS assigned_admin_username
                 FROM appeals a
                 JOIN users u ON u.user_id = a.user_id
                 JOIN account_suspensions s ON s.suspension_id = a.suspension_id
                 LEFT JOIN appeal_assignments assignment
                   ON assignment.appeal_id = a.appeal_id
                  AND assignment.released_at IS NULL
                 LEFT JOIN users admin ON admin.user_id = assignment.admin_id
                 ${where}
                 ORDER BY a.submitted_at DESC, a.appeal_id DESC
                 LIMIT 20 OFFSET ${(page - 1) * 20}`,
                values
            ),
            pool.query(
                `SELECT COUNT(*)::int AS total FROM appeals a ${where}`,
                values
            )
        ]);
        res.json({
            appeals: items.rows,
            page,
            pageSize: 20,
            total: count.rows[0].total
        });
    } catch (error) {
        console.error("List appeals for review:", error);
        res.status(500).json({ message: "Could not load appeals." });
    }
});

router.get("/admin/:appealId", requireActiveAdmin, rateLimits.admin, async (req, res) => {
    if (!validId(req.params.appealId)) {
        return res.status(400).json({ message: "Invalid appeal ID." });
    }
    try {
        const appeal = await pool.query(
            `SELECT a.appeal_id, a.suspension_id, a.user_id, a.attempt_no,
                    a.appeal_text, a.status, a.decision_note, a.submitted_at,
                    a.reviewed_at, a.last_progress_at,
                    u.username, u.display_name, u.account_status,
                    s.reason AS suspension_reason, s.suspended_at,
                    s.suspended_until, s.restored_at
             FROM appeals a
             JOIN users u ON u.user_id = a.user_id
             JOIN account_suspensions s ON s.suspension_id = a.suspension_id
             WHERE a.appeal_id = $1`,
            [req.params.appealId]
        );
        if (!appeal.rowCount) {
            return res.status(404).json({ message: "Appeal not found." });
        }
        const [history, assignments, actions] = await Promise.all([
            pool.query(
                `SELECT appeal_id, attempt_no, appeal_text, status,
                        decision_note, submitted_at, reviewed_at
                 FROM appeals
                 WHERE suspension_id = $1
                 ORDER BY attempt_no`,
                [appeal.rows[0].suspension_id]
            ),
            pool.query(
                `SELECT aa.assignment_id, aa.admin_id, aa.assigned_at,
                        aa.released_at, aa.assignment_reason, u.username
                 FROM appeal_assignments aa
                 JOIN users u ON u.user_id = aa.admin_id
                 WHERE aa.appeal_id = $1
                 ORDER BY aa.assigned_at, aa.assignment_id`,
                [req.params.appealId]
            ),
            pool.query(
                `SELECT log_id, actor_id, actor_role, action, reason,
                        old_values, new_values, created_at
                 FROM admin_action_logs
                 WHERE target_type = 'appeal' AND target_id = $1
                 ORDER BY created_at DESC, log_id DESC`,
                [req.params.appealId]
            )
        ]);
        res.json({
            appeal: appeal.rows[0],
            attempts: history.rows,
            assignments: assignments.rows,
            actions: actions.rows
        });
    } catch (error) {
        console.error("Get appeal review detail:", error);
        res.status(500).json({ message: "Could not load appeal details." });
    }
});

router.post("/admin/:appealId/assignment", requireActiveAdmin, rateLimits.admin, async (req, res) => {
    if (!validId(req.params.appealId)) {
        return res.status(400).json({ message: "Invalid appeal ID." });
    }
    const reason = typeof req.body?.reason === "string"
        ? req.body.reason.trim().slice(0, 1000) || null
        : null;
    const client = await pool.connect();
    try {
        await client.query("BEGIN");
        const result = await client.query(
            `SELECT appeal_id, suspension_id, user_id, status, last_progress_at
             FROM appeals
             WHERE appeal_id = $1
             FOR UPDATE`,
            [req.params.appealId]
        );
        if (!result.rowCount) {
            await client.query("ROLLBACK");
            return res.status(404).json({ message: "Appeal not found." });
        }
        const appeal = result.rows[0];
        if (!ACTIVE_STATUSES.has(appeal.status)) {
            await client.query("ROLLBACK");
            return res.status(409).json({ message: "This appeal is closed." });
        }
        const active = await client.query(
            `SELECT assignment_id, admin_id
             FROM appeal_assignments
             WHERE appeal_id = $1 AND released_at IS NULL
             FOR UPDATE`,
            [appeal.appeal_id]
        );
        const current = active.rows[0];
        if (current && String(current.admin_id) === String(req.user.user_id)) {
            await client.query("COMMIT");
            return res.json({ message: "You are already assigned to this appeal." });
        }
        if (current) {
            const stale = await client.query(
                `SELECT last_progress_at < CURRENT_TIMESTAMP - INTERVAL '7 days' AS can_take_over
                 FROM appeals
                 WHERE appeal_id = $1`,
                [appeal.appeal_id]
            );
            if (!stale.rows[0].can_take_over) {
                await client.query("ROLLBACK");
                return res.status(409).json({
                    message: "Reassignment is allowed only after more than 7 days without activity."
                });
            }
            await client.query(
                `UPDATE appeal_assignments
                 SET released_at = CURRENT_TIMESTAMP
                 WHERE assignment_id = $1`,
                [current.assignment_id]
            );
        }
        await client.query(
            `INSERT INTO appeal_assignments (
                appeal_id, admin_id, assignment_reason
             )
             VALUES ($1, $2, $3)`,
            [appeal.appeal_id, req.user.user_id, reason]
        );
        const nextStatus = appeal.status === "pending" ? "reviewing" : appeal.status;
        await client.query(
            `UPDATE appeals
             SET status = $1, last_progress_at = CURRENT_TIMESTAMP
             WHERE appeal_id = $2`,
            [nextStatus, appeal.appeal_id]
        );
        await logAdminAction(client, {
            actorId: req.user.user_id,
            actorRole: req.adminRole,
            targetType: "appeal",
            targetId: appeal.appeal_id,
            targetUserId: appeal.user_id,
            action: current ? "appeal_taken_over" : "appeal_assigned",
            reason,
            oldValues: {
                assignedAdminId: current ? String(current.admin_id) : null,
                status: appeal.status
            },
            newValues: {
                assignedAdminId: String(req.user.user_id),
                status: nextStatus
            }
        });
        if (appeal.status !== nextStatus) {
            await createNotification(client, {
                userId: appeal.user_id,
                type: "appeal_status",
                category: "account",
                message: `Appeal attempt ${appeal.attempt_no} is under review.`,
                metadata: { appealId: appeal.appeal_id, status: nextStatus }
            });
        }
        await client.query("COMMIT");
        res.json({ message: "Appeal assigned.", status: nextStatus });
    } catch (error) {
        await client.query("ROLLBACK");
        console.error("Assign appeal:", error);
        res.status(500).json({ message: "Could not assign appeal." });
    } finally {
        client.release();
    }
});

router.patch("/admin/:appealId", requireActiveAdmin, rateLimits.admin, async (req, res) => {
    if (!validId(req.params.appealId) ||
        !["accepted", "rejected"].includes(req.body?.status)) {
        return res.status(400).json({ message: "Invalid appeal decision details." });
    }
    const decisionNote = typeof req.body.decision_note === "string"
        ? req.body.decision_note.trim()
        : "";
    const internalReason = typeof req.body.reason === "string"
        ? req.body.reason.trim().slice(0, 1000) || null
        : null;
    if (decisionNote.length > 2000) {
        return res.status(400).json({ message: "Decision note must be no more than 2,000 characters." });
    }

    const client = await pool.connect();
    try {
        await client.query("BEGIN");
        const result = await client.query(
            `SELECT appeal_id, suspension_id, user_id, attempt_no,
                    status, decision_note
             FROM appeals
             WHERE appeal_id = $1
             FOR UPDATE`,
            [req.params.appealId]
        );
        if (!result.rowCount) {
            await client.query("ROLLBACK");
            return res.status(404).json({ message: "Appeal not found." });
        }
        const appeal = result.rows[0];
        if (!ACTIVE_STATUSES.has(appeal.status)) {
            await client.query("ROLLBACK");
            return res.status(409).json({ message: "This appeal has already been decided." });
        }
        const assignment = await client.query(
            `SELECT admin_id
             FROM appeal_assignments
             WHERE appeal_id = $1 AND released_at IS NULL
             FOR UPDATE`,
            [appeal.appeal_id]
        );
        if (!assignment.rowCount ||
            String(assignment.rows[0].admin_id) !== String(req.user.user_id)) {
            await client.query("ROLLBACK");
            return res.status(403).json({
                message: "Only the assigned administrator can decide this appeal."
            });
        }
        const suspension = await client.query(
            `SELECT suspension_id, user_id, restored_at
             FROM account_suspensions
             WHERE suspension_id = $1
             FOR UPDATE`,
            [appeal.suspension_id]
        );
        const account = await client.query(
            `SELECT account_status FROM users WHERE user_id = $1 FOR UPDATE`,
            [appeal.user_id]
        );
        let accountRestored = false;
        if (req.body.status === "accepted" && suspension.rowCount &&
            !suspension.rows[0].restored_at) {
            await client.query(
                `UPDATE account_suspensions
                 SET restored_at = CURRENT_TIMESTAMP
                 WHERE suspension_id = $1`,
                [appeal.suspension_id]
            );
            const stillSuspended = await client.query(
                `SELECT 1
                 FROM account_suspensions
                 WHERE user_id = $1
                   AND restored_at IS NULL
                   AND (suspended_until IS NULL OR suspended_until > CURRENT_TIMESTAMP)
                 LIMIT 1`,
                [appeal.user_id]
            );
            if (!stillSuspended.rowCount &&
                account.rows[0]?.account_status === "suspended") {
                await client.query(
                    `UPDATE users
                     SET account_status = 'active',
                         suspended_until = NULL,
                         status_reason = NULL,
                         updated_at = CURRENT_TIMESTAMP
                     WHERE user_id = $1 AND account_status = 'suspended'`,
                    [appeal.user_id]
                );
                accountRestored = true;
            }
        }
        await client.query(
            `UPDATE appeals
             SET status = $1, decision_note = $2,
                 reviewed_by = $3, reviewed_at = CURRENT_TIMESTAMP,
                 last_progress_at = CURRENT_TIMESTAMP
             WHERE appeal_id = $4`,
            [
                req.body.status,
                decisionNote || null,
                req.user.user_id,
                appeal.appeal_id
            ]
        );
        await client.query(
            `UPDATE appeal_assignments
             SET released_at = CURRENT_TIMESTAMP
             WHERE appeal_id = $1 AND released_at IS NULL`,
            [appeal.appeal_id]
        );
        await logAdminAction(client, {
            actorId: req.user.user_id,
            actorRole: req.adminRole,
            targetType: "appeal",
            targetId: appeal.appeal_id,
            targetUserId: appeal.user_id,
            action: `appeal_${req.body.status}`,
            reason: internalReason,
            oldValues: { status: appeal.status },
            newValues: {
                status: req.body.status,
                accountRestored
            }
        });
        const message = req.body.status === "accepted"
            ? `Appeal attempt ${appeal.attempt_no} was accepted.`
            : `Appeal attempt ${appeal.attempt_no} was rejected.`;
        await createNotification(client, {
            userId: appeal.user_id,
            type: "appeal_status",
            category: "account",
            message: decisionNote ? `${message}: ${decisionNote}` : message,
            metadata: {
                appealId: appeal.appeal_id,
                status: req.body.status,
                accountRestored
            }
        });
        await client.query("COMMIT");
        res.json({
            message: "Appeal decision updated.",
            status: req.body.status,
            accountRestored
        });
    } catch (error) {
        await client.query("ROLLBACK");
        console.error("Review appeal:", error);
        res.status(500).json({ message: "Could not save appeal decision." });
    } finally {
        client.release();
    }
});

module.exports = router;
