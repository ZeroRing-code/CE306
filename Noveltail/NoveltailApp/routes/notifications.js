const express = require("express");
const pool = require("../db");
const requireAuth = require("../middleware/auth");

const router = express.Router();
const PAGE_SIZE = 20;
const CATEGORIES = new Set([
    "system", "account", "novel", "engagement", "transaction"
]);

router.use(requireAuth);

function parseFilters(query) {
    const category = typeof query.category === "string" &&
        CATEGORIES.has(query.category) ? query.category : null;
    const status = ["all", "read", "unread"].includes(query.status)
        ? query.status
        : "all";
    const searchLogic = query.searchLogic === "OR" ? "OR" : "AND";
    const terms = typeof query.q === "string"
        ? query.q.trim().split(/\s+/).filter(Boolean).slice(0, 8)
        : [];
    return { category, status, searchLogic, terms };
}

function whereClause(userId, filters, snapshotId, values = []) {
    values.push(userId);
    const clauses = ["user_id = $1"];
    if (filters.category) {
        values.push(filters.category);
        clauses.push(`category = $${values.length}`);
    }
    if (filters.status === "read") clauses.push("is_read = TRUE");
    if (filters.status === "unread") clauses.push("is_read = FALSE");
    if (snapshotId !== undefined) {
        values.push(snapshotId);
        clauses.push(`notification_id <= $${values.length}`);
    }
    if (filters.terms.length) {
        const searchParts = filters.terms.map(term => {
            values.push(`%${term.replace(/[\\%_]/g, "\\$&")}%`);
            return `message ILIKE $${values.length} ESCAPE E'\\\\'`;
        });
        clauses.push(`(${searchParts.join(` ${filters.searchLogic} `)})`);
    }
    return `WHERE ${clauses.join(" AND ")}`;
}

async function getCategoryCounts(client, userId, filters, snapshotId) {
    const values = [];
    const where = whereClause(userId, filters, snapshotId, values);
    const result = await client.query(
        `SELECT category, COUNT(*)::int AS count
         FROM notifications ${where}
         GROUP BY category
         ORDER BY category`,
        values
    );
    const counts = Object.fromEntries(
        ["system", "account", "novel", "engagement", "transaction"]
            .map(category => [category, 0])
    );
    result.rows.forEach(row => {
        counts[row.category] = row.count;
    });
    return counts;
}

router.get("/", async (req, res) => {
    const filters = parseFilters(req.query);
    const page = Math.max(1, Number.parseInt(req.query.page, 10) || 1);
    const values = [];
    const where = whereClause(req.user.user_id, filters, undefined, values);
    try {
        const list = await pool.query(
            `SELECT notification_id, type, category, message, metadata,
                    is_read, created_at, actor_id, novel_id, chapter_id,
                    comment_id, review_id
             FROM notifications
             ${where}
             ORDER BY created_at DESC, notification_id DESC
             LIMIT ${PAGE_SIZE} OFFSET ${(page - 1) * PAGE_SIZE}`,
            values
        );
        const count = await pool.query(
            `SELECT COUNT(*)::int AS total,
                    COUNT(*) FILTER (WHERE is_read = FALSE)::int AS unread,
                    (SELECT COUNT(*)::int
                     FROM notifications
                     WHERE user_id = $1 AND is_read = FALSE) AS global_unread
             FROM notifications ${where}`,
            values
        );
        res.json({
            notifications: list.rows,
            page,
            pageSize: PAGE_SIZE,
            total: count.rows[0].total,
            unread: count.rows[0].unread,
            globalUnread: count.rows[0].global_unread
        });
    } catch (error) {
        console.error("List notifications:", error);
        res.status(500).json({ message: "Could not load notifications." });
    }
});

router.get("/unread-count", async (req, res) => {
    try {
        const result = await pool.query(
            `SELECT COUNT(*)::int AS unread
             FROM notifications WHERE user_id = $1 AND is_read = FALSE`,
            [req.user.user_id]
        );
        res.json({ unread: result.rows[0].unread });
    } catch (error) {
        console.error("Get unread notification count:", error);
        res.status(500).json({ message: "Could not load unread notification count." });
    }
});

router.patch("/:notificationId/read", async (req, res) => {
    if (!/^\d+$/.test(req.params.notificationId)) {
        return res.status(400).json({ message: "Invalid notification ID." });
    }
    try {
        const result = await pool.query(
            `UPDATE notifications SET is_read = TRUE
             WHERE notification_id = $1 AND user_id = $2
             RETURNING notification_id`,
            [req.params.notificationId, req.user.user_id]
        );
        if (!result.rowCount) {
            return res.status(404).json({ message: "Notification not found." });
        }
        res.json({ message: "Notification marked as read." });
    } catch (error) {
        console.error("Mark notification read:", error);
        res.status(500).json({ message: "Could not update notification." });
    }
});

router.post("/read-all", async (req, res) => {
    try {
        const result = await pool.query(
            `UPDATE notifications SET is_read = TRUE
             WHERE user_id = $1 AND is_read = FALSE`,
            [req.user.user_id]
        );
        res.json({ updated: result.rowCount });
    } catch (error) {
        console.error("Mark all notifications read:", error);
        res.status(500).json({ message: "Could not mark all notifications as read." });
    }
});

router.get("/bulk-preview", async (req, res) => {
    const filters = parseFilters(req.query);
    const client = await pool.connect();
    try {
        await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
        const maximum = await client.query(
            `SELECT COALESCE(MAX(notification_id), 0)::bigint AS snapshot_id
             FROM notifications WHERE user_id = $1`,
            [req.user.user_id]
        );
        const snapshotId = maximum.rows[0].snapshot_id;
        const counts = await getCategoryCounts(
            client,
            req.user.user_id,
            filters,
            snapshotId
        );
        await client.query("COMMIT");
        res.json({
            snapshotId,
            counts,
            total: Object.values(counts).reduce((sum, count) => sum + count, 0)
        });
    } catch (error) {
        await client.query("ROLLBACK");
        console.error("Preview notification deletion:", error);
        res.status(500).json({ message: "Could not validate notification selection." });
    } finally {
        client.release();
    }
});

router.delete("/bulk", async (req, res) => {
    const filters = parseFilters(req.body || {});
    const { snapshotId, expectedCounts } = req.body || {};
    if (!/^\d+$/.test(String(snapshotId)) ||
        !expectedCounts ||
        typeof expectedCounts !== "object" ||
        Array.isArray(expectedCounts) ||
        [...CATEGORIES].some(category =>
            !Number.isSafeInteger(Number(expectedCounts[category])) ||
            Number(expectedCounts[category]) < 0
        )) {
        return res.status(400).json({ message: "Invalid deletion confirmation." });
    }

    const client = await pool.connect();
    try {
        await client.query("BEGIN");
        const values = [];
        const where = whereClause(
            req.user.user_id,
            filters,
            snapshotId,
            values
        );
        await client.query(
            `SELECT notification_id FROM notifications ${where}
             FOR UPDATE`,
            values
        );
        const counts = await getCategoryCounts(
            client,
            req.user.user_id,
            filters,
            snapshotId
        );
        const total = Object.values(counts).reduce((sum, count) => sum + count, 0);
        const changed = Object.keys(counts).some(
            category => Number(expectedCounts[category]) !== counts[category]
        );
        if (changed) {
            await client.query("COMMIT");
            return res.status(409).json({
                message: "Notifications have changed. Review the updated selection and confirm again.",
                counts,
                total
            });
        }
        if (total) {
            await client.query(
                `DELETE FROM notifications ${where}`,
                values
            );
        }
        await client.query("COMMIT");
        res.json({ message: "Notifications deleted.", counts, total });
    } catch (error) {
        await client.query("ROLLBACK");
        console.error("Delete filtered notifications:", error);
        res.status(500).json({ message: "Could not delete notifications." });
    } finally {
        client.release();
    }
});

router.delete("/:notificationId", async (req, res) => {
    if (!/^\d+$/.test(req.params.notificationId)) {
        return res.status(400).json({ message: "Invalid notification ID." });
    }
    try {
        const result = await pool.query(
            `DELETE FROM notifications
             WHERE notification_id = $1 AND user_id = $2`,
            [req.params.notificationId, req.user.user_id]
        );
        if (!result.rowCount) {
            return res.status(404).json({ message: "Notification not found." });
        }
        res.json({ message: "Notification deleted." });
    } catch (error) {
        console.error("Delete notification:", error);
        res.status(500).json({ message: "Could not delete notification." });
    }
});

module.exports = router;
