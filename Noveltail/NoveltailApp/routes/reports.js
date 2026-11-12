const express = require("express");
const crypto = require("node:crypto");
const pool = require("../db");
const requireAuth = require("../middleware/auth");
const { requireAdmin } = require("../middleware/admin");
const { logAdminAction } = require("./admin-helper");
const { rateLimits } = require("../middleware/rate-limit");

const router = express.Router();
const REASONS = new Set([
    "inappropriate_content", "spam", "copyright", "harassment", "other"
]);
const OPEN_STATUSES = new Set(["pending", "reviewing"]);
const STATUSES = new Set(["pending", "reviewing", "resolved", "rejected"]);
const TARGETS = new Set(["novel", "chapter", "comment"]);
const TARGET_TOKEN_TTL_MS = 15 * 60 * 1000;
const MIN_DETAILS_LENGTH = 10;
const MAX_DETAILS_LENGTH = 2000;

router.use(requireAuth);

function parseId(value) {
    return typeof value === "string" && /^\d+$/.test(value) &&
        Number.isSafeInteger(Number(value)) && Number(value) > 0
        ? value
        : null;
}

function targetTokenSignature(payload) {
    return crypto
        .createHmac("sha256", process.env.JWT_SECRET)
        .update(payload)
        .digest("base64url");
}

function createTargetToken(userId, type, id, now = Date.now()) {
    const payload = Buffer.from(JSON.stringify({
        userId: String(userId),
        type,
        id: String(id),
        expiresAt: now + TARGET_TOKEN_TTL_MS
    })).toString("base64url");
    return `${payload}.${targetTokenSignature(payload)}`;
}

function readTargetToken(token, userId, now = Date.now()) {
    if (typeof token !== "string") return null;
    const [payload, signature, extra] = token.split(".");
    if (!payload || !signature || extra !== undefined) return null;

    const expected = Buffer.from(targetTokenSignature(payload));
    const actual = Buffer.from(signature);
    if (expected.length !== actual.length ||
        !crypto.timingSafeEqual(expected, actual)) {
        return null;
    }

    try {
        const claims = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
        if (String(claims.userId) !== String(userId) ||
            !TARGETS.has(claims.type) ||
            !parseId(claims.id) ||
            !Number.isSafeInteger(claims.expiresAt) ||
            claims.expiresAt <= now ||
            claims.expiresAt > now + TARGET_TOKEN_TTL_MS + 60_000) {
            return null;
        }
        return { type: claims.type, id: claims.id };
    } catch {
        return null;
    }
}

async function loadReportTarget(database, type, id) {
    const queries = {
        novel: `
            SELECT n.novel_id::text AS target_id,
                   n.title AS novel_title
            FROM novels n
            WHERE n.novel_id = $1
              AND n.moderation_status = 'active'
              AND EXISTS (
                  SELECT 1 FROM chapters c
                  WHERE c.novel_id = n.novel_id AND c.status = 'published'
              )
            FOR KEY SHARE OF n`,
        chapter: `
            SELECT c.chapter_id::text AS target_id,
                   n.title AS novel_title,
                   c.title AS chapter_title,
                   c.chapter_number
            FROM chapters c
            JOIN novels n ON n.novel_id = c.novel_id
            WHERE c.chapter_id = $1
              AND c.status = 'published'
              AND n.moderation_status = 'active'
            FOR KEY SHARE OF c, n`,
        comment: `
            SELECT c.comment_id::text AS target_id,
                   n.title AS novel_title,
                   ch.title AS chapter_title,
                   ch.chapter_number,
                   c.content AS comment_content,
                   COALESCE(NULLIF(u.display_name, ''), u.username)
                       AS comment_author
            FROM comments c
            JOIN users u ON u.user_id = c.user_id
            JOIN chapters ch ON ch.chapter_id = c.chapter_id
            JOIN novels n ON n.novel_id = ch.novel_id
            WHERE c.comment_id = $1
              AND ch.status = 'published'
              AND n.moderation_status = 'active'
            FOR KEY SHARE OF c`
    };
    const result = await database.query(queries[type], [id]);
    return result.rows[0] || null;
}

function createTargetSnapshot(type, id, target) {
    const snapshot = {
        target_type: type,
        target_id: String(id)
    };
    if (type === "novel") {
        snapshot.novel_title = target.novel_title;
    } else if (type === "chapter") {
        snapshot.novel_title = target.novel_title;
        snapshot.chapter_title = target.chapter_title;
        snapshot.chapter_number = target.chapter_number;
    } else {
        snapshot.novel_title = target.novel_title;
        snapshot.chapter_title = target.chapter_title;
        snapshot.chapter_number = target.chapter_number;
        snapshot.comment_content = target.comment_content;
        snapshot.comment_author = target.comment_author;
    }
    return snapshot;
}

router.get("/target", async (req, res) => {
    const type = req.query.type;
    const id = parseId(String(req.query.id ?? ""));
    if (!TARGETS.has(type) || !id) {
        return res.status(400).json({ message: "Invalid report target." });
    }
    try {
        const target = await loadReportTarget(pool, type, id);
        if (!target) {
            return res.status(404).json({
                message: "The published content was not found or cannot be reported."
            });
        }
        res.json({
            target: createTargetSnapshot(type, id, target),
            target_token: createTargetToken(req.user.user_id, type, id)
        });
    } catch (error) {
        console.error("Load report target:", error);
        res.status(500).json({ message: "Could not load report target." });
    }
});

const reportSelect = `
    SELECT r.report_id, r.reporter_id, r.target_novel_id, r.target_chapter_id,
           r.target_comment_id, r.target_review_id, r.reason, r.details,
           r.target_snapshot,
           r.status, r.reviewed_by, r.reviewed_at, r.created_at,
           reporter.username AS reporter_username,
           reporter.display_name AS reporter_display_name,
           reviewer.username AS reviewed_by_username,
           reviewer.display_name AS reviewed_by_display_name,
           n.title AS novel_title,
           ch.title AS chapter_title,
           cn.title AS chapter_novel_title,
           c.content AS comment_content,
           COALESCE(n.user_id, cn.user_id, c.user_id) AS target_owner_id,
           CASE
             WHEN r.target_novel_id IS NOT NULL THEN 'novel'
             WHEN r.target_chapter_id IS NOT NULL THEN 'chapter'
             WHEN r.target_comment_id IS NOT NULL THEN 'comment'
             WHEN r.target_review_id IS NOT NULL THEN 'review'
           END AS target_type
    FROM reports r
    JOIN users reporter ON reporter.user_id = r.reporter_id
    LEFT JOIN users reviewer ON reviewer.user_id = r.reviewed_by
    LEFT JOIN novels n ON n.novel_id = r.target_novel_id
    LEFT JOIN chapters ch ON ch.chapter_id = r.target_chapter_id
    LEFT JOIN novels cn ON cn.novel_id = ch.novel_id
    LEFT JOIN comments c ON c.comment_id = r.target_comment_id
`;

function targetLabel(report) {
    const snapshot = report.target_snapshot;
    const type = snapshot?.target_type ||
        (report.target_novel_id ? "novel" :
            report.target_chapter_id ? "chapter" :
                report.target_comment_id ? "comment" :
                    report.target_review_id ? "review" : null);
    if (type === "novel") {
        return report.novel_title || snapshot?.novel_title || "Novel";
    }
    if (type === "chapter") {
        return [
            report.chapter_novel_title || snapshot?.novel_title,
            report.chapter_title || snapshot?.chapter_title
        ]
            .filter(Boolean).join(" — ") || "Chapter";
    }
    if (type === "comment") {
        return report.comment_content || snapshot?.comment_content || "Comment";
    }
    return type === "review" ? "Review" : "Reported content is unavailable";
}

function reportView(row, includeReporter = false) {
    const report = { ...row, target_label: targetLabel(row) };
    if (!includeReporter) {
        delete report.reporter_id;
        delete report.reviewed_by;
        delete report.reviewed_by_username;
        delete report.reviewed_by_display_name;
        delete report.target_owner_id;
    }
    return report;
}

router.get("/mine", async (req, res) => {
    try {
        const result = await pool.query(
            `${reportSelect}
             WHERE r.reporter_id = $1
             ORDER BY r.created_at DESC, r.report_id DESC
             LIMIT 100`,
            [req.user.user_id]
        );
        res.json({ reports: result.rows.map(row => reportView(row)) });
    } catch (error) {
        console.error("List own reports:", error);
        res.status(500).json({ message: "Could not load your reports." });
    }
});

router.post("/", rateLimits.reports, async (req, res) => {
    const target = readTargetToken(
        req.body?.target_token,
        req.user.user_id
    );
    const reason = typeof req.body?.reason === "string" ? req.body.reason : "";
    const details = typeof req.body?.details === "string"
        ? req.body.details.trim()
        : "";
    if (!target || !REASONS.has(reason) ||
        details.length < MIN_DETAILS_LENGTH ||
        details.length > MAX_DETAILS_LENGTH) {
        return res.status(400).json({ message: "Invalid report details." });
    }

    const client = await pool.connect();
    try {
        await client.query("BEGIN");
        const targetData = await loadReportTarget(client, target.type, target.id);
        if (!targetData) {
            await client.query("ROLLBACK");
            return res.status(404).json({
                message: "The published content was not found or cannot be reported."
            });
        }
        const snapshot = createTargetSnapshot(
            target.type,
            target.id,
            targetData
        );
        const targetColumn = `target_${target.type}_id`;
        await client.query(
            "SELECT pg_advisory_xact_lock(hashtextextended($1, 0))",
            [`report:${req.user.user_id}:${target.type}:${target.id}`]
        );
        const duplicate = await client.query(
            `SELECT report_id FROM reports
             WHERE reporter_id = $1 AND ${targetColumn} = $2
               AND status = ANY($3::varchar[])
             LIMIT 1`,
            [req.user.user_id, target.id, [...OPEN_STATUSES]]
        );
        if (duplicate.rowCount) {
            await client.query("ROLLBACK");
            return res.status(409).json({
                message: "You already have an open report for this content."
            });
        }
        const inserted = await client.query(
            `INSERT INTO reports (
                reporter_id, ${targetColumn}, reason, details,
                target_snapshot
             )
             VALUES ($1, $2, $3, $4, $5::jsonb)
             RETURNING report_id, reason, details, target_snapshot,
                       status, created_at`,
            [
                req.user.user_id,
                target.id,
                reason,
                details,
                JSON.stringify(snapshot)
            ]
        );
        await client.query("COMMIT");
        res.status(201).json({
            report: {
                ...inserted.rows[0],
                target_type: target.type,
                target_label: targetLabel({
                    ...inserted.rows[0],
                    target_snapshot: snapshot
                })
            }
        });
    } catch (error) {
        await client.query("ROLLBACK");
        if (error.code === "23505" &&
            /^reports_one_open_(novel|chapter|comment)_per_reporter$/.test(error.constraint || "")) {
            return res.status(409).json({
                message: "You already have an open report for this content."
            });
        }
        console.error("Create report:", error);
        res.status(500).json({ message: "Could not submit report." });
    } finally {
        client.release();
    }
});

router.use("/admin", requireAdmin, rateLimits.admin);

router.get("/admin", async (req, res) => {
    const { q = "", status = "", type = "", page = "1" } = req.query;
    if ((status && !STATUSES.has(status)) ||
        (type && !["novel", "chapter", "comment", "review"].includes(type)) ||
        typeof q !== "string" || q.length > 100) {
        return res.status(400).json({ message: "Invalid report filter." });
    }
    const pageNumber = /^\d+$/.test(String(page))
        ? Math.max(1, Math.min(10000, Number(page)))
        : 1;
    const values = [];
    const clauses = [];
    if (status) {
        values.push(status);
        clauses.push(`r.status = $${values.length}`);
    }
    if (type) {
        const columns = {
            novel: "r.target_novel_id",
            chapter: "r.target_chapter_id",
            comment: "r.target_comment_id",
            review: "r.target_review_id"
        };
        clauses.push(`${columns[type]} IS NOT NULL`);
    }
    if (q.trim()) {
        values.push(`%${q.trim()}%`);
        clauses.push(
            `(reporter.username ILIKE $${values.length}
              OR reporter.display_name ILIKE $${values.length}
              OR r.details ILIKE $${values.length}
              OR n.title ILIKE $${values.length}
              OR ch.title ILIKE $${values.length}
              OR c.content ILIKE $${values.length})`
        );
    }
    values.push(50, (pageNumber - 1) * 50);
    try {
        const result = await pool.query(
            `${reportSelect}
             WHERE ${clauses.length ? clauses.join(" AND ") : "TRUE"}
             ORDER BY r.created_at DESC, r.report_id DESC
             LIMIT $${values.length - 1} OFFSET $${values.length}`,
            values
        );
        res.json({
            reports: result.rows.map(row => reportView(row, true)),
            page: pageNumber
        });
    } catch (error) {
        console.error("Admin list reports:", error);
        res.status(500).json({ message: "Could not load reports." });
    }
});

router.get("/admin/:reportId", async (req, res) => {
    const reportId = parseId(req.params.reportId);
    if (!reportId) return res.status(400).json({ message: "Invalid report ID." });
    try {
        const [reportResult, historyResult] = await Promise.all([
            pool.query(`${reportSelect} WHERE r.report_id = $1`, [reportId]),
            pool.query(
                `SELECT log.log_id, log.actor_id, log.actor_role, log.action,
                        log.reason, log.old_values, log.new_values, log.created_at,
                        COALESCE(NULLIF(actor.display_name, ''), actor.username)
                            AS actor_name
                 FROM admin_action_logs log
                 LEFT JOIN users actor ON actor.user_id = log.actor_id
                 WHERE log.target_type = 'report' AND log.target_id = $1
                 ORDER BY log.created_at DESC, log.log_id DESC`,
                [reportId]
            )
        ]);
        if (!reportResult.rowCount) {
            return res.status(404).json({ message: "Report not found." });
        }
        res.json({
            report: reportView(reportResult.rows[0], true),
            history: historyResult.rows
        });
    } catch (error) {
        console.error("Admin get report:", error);
        res.status(500).json({ message: "Could not load report details." });
    }
});

router.post("/admin/:reportId/claim", async (req, res) => {
    const reportId = parseId(req.params.reportId);
    const reason = typeof req.body?.reason === "string"
        ? req.body.reason.trim()
        : "";
    if (!reportId || reason.length < 3 || reason.length > 500) {
        return res.status(400).json({
            message: "A valid report ID and a 3–500 character review note are required."
        });
    }

    const client = await pool.connect();
    try {
        await client.query("BEGIN");
        const current = await client.query(
            "SELECT status, reviewed_by FROM reports WHERE report_id = $1 FOR UPDATE",
            [reportId]
        );
        if (!current.rowCount) {
            await client.query("ROLLBACK");
            return res.status(404).json({ message: "Report not found." });
        }
        if (current.rows[0].status !== "pending") {
            await client.query("ROLLBACK");
            return res.status(409).json({
                message: "This report has already been claimed or closed."
            });
        }

        await client.query(
            `UPDATE reports
             SET status = 'reviewing', reviewed_by = $2,
                 reviewed_at = CURRENT_TIMESTAMP
             WHERE report_id = $1`,
            [reportId, req.user.user_id]
        );
        await logAdminAction(client, {
            actorId: req.user.user_id,
            actorRole: req.adminRole,
            targetType: "report",
            targetId: reportId,
            action: "report_claimed",
            reason,
            oldValues: {
                status: "pending",
                reviewed_by: current.rows[0].reviewed_by
            },
            newValues: {
                status: "reviewing",
                reviewed_by: req.user.user_id
            }
        });
        await client.query("COMMIT");
        res.json({
            message: "Report claimed for review.",
            status: "reviewing",
            reviewed_by: req.user.user_id
        });
    } catch (error) {
        await client.query("ROLLBACK");
        console.error("Claim report:", error);
        res.status(500).json({ message: "Could not claim report." });
    } finally {
        client.release();
    }
});

router.patch("/admin/:reportId/status", async (req, res) => {
    const reportId = parseId(req.params.reportId);
    const status = req.body?.status;
    const reason = typeof req.body?.reason === "string"
        ? req.body.reason.trim()
        : "";
    if (!reportId || !STATUSES.has(status) || reason.length < 3 || reason.length > 500) {
        return res.status(400).json({
            message: "Invalid report status or review note."
        });
    }

    const client = await pool.connect();
    try {
        await client.query("BEGIN");
        const current = await client.query(
            "SELECT status, reviewed_by FROM reports WHERE report_id = $1 FOR UPDATE",
            [reportId]
        );
        if (!current.rowCount) {
            await client.query("ROLLBACK");
            return res.status(404).json({ message: "Report not found." });
        }
        const oldStatus = current.rows[0].status;
        const allowed = oldStatus === "pending"
            ? ["reviewing", "resolved", "rejected"]
            : oldStatus === "reviewing"
                ? ["resolved", "rejected"]
                : [];
        if (!allowed.includes(status)) {
            await client.query("ROLLBACK");
            return res.status(409).json({
                message: "This report cannot transition to the requested status."
            });
        }
        const reviewerId = current.rows[0].reviewed_by || req.user.user_id;
        await client.query(
            `UPDATE reports
             SET status = $2, reviewed_by = $3, reviewed_at = CURRENT_TIMESTAMP
             WHERE report_id = $1`,
            [reportId, status, reviewerId]
        );
        await logAdminAction(client, {
            actorId: req.user.user_id,
            actorRole: req.adminRole,
            targetType: "report",
            targetId: reportId,
            action: "report_status_changed",
            reason,
            oldValues: { status: oldStatus },
            newValues: { status }
        });
        await client.query("COMMIT");
        res.json({ message: "Report status updated.", status });
    } catch (error) {
        await client.query("ROLLBACK");
        console.error("Update report status:", error);
        res.status(500).json({ message: "Could not update report status." });
    } finally {
        client.release();
    }
});

module.exports = router;
