const express = require("express");
const pool = require("../db");
const requireAuth = require("../middleware/auth");
const { requireAdmin } = require("../middleware/admin");
const { logAdminAction } = require("./admin-helper");
const { rateLimits } = require("../middleware/rate-limit");
const { processDueAnnouncements } =
    require("../services/announcement-service");

const router = express.Router();
const AUDIENCES = new Set(["all", "individual", "group"]);
const ROLES = new Set(["USER", "ADMIN", "SUPER_ADMIN"]);
const STATUSES = new Set(["draft", "published", "cancelled"]);

function parseId(value) {
    return typeof value === "string" && /^\d+$/.test(value) &&
        Number.isSafeInteger(Number(value)) && Number(value) > 0
        ? value
        : null;
}

function normalizeAudience(type, input) {
    if (!AUDIENCES.has(type)) return null;
    if (type === "all") return {};
    if (type === "group") {
        if (!Array.isArray(input?.roles)) return null;
        const roles = [...new Set(input.roles)];
        if (!roles.length || roles.length !== input.roles.length ||
            roles.some(role => !ROLES.has(role))) {
            return null;
        }
        return { roles };
    }

    if (!Array.isArray(input?.userIds) ||
        !input.userIds.length || input.userIds.length > 500) {
        return null;
    }
    const userIds = [...new Set(input.userIds.map(value => String(value)))];
    if (userIds.length !== input.userIds.length ||
        userIds.some(value => !/^\d+$/.test(value) ||
            !Number.isSafeInteger(Number(value)) || Number(value) < 1)) {
        return null;
    }
    return { userIds };
}

function parseDate(value, field) {
    if (value === null || value === undefined || value === "") return null;
    if (typeof value !== "string") throw new Error(`${field} must be a date string`);
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) throw new Error(`${field} must be a valid date`);
    return date;
}

async function validateAudience(client, type, filter) {
    if (type === "individual") {
        const result = await client.query(
            "SELECT COUNT(*)::int AS count FROM users WHERE user_id = ANY($1::bigint[])",
            [filter.userIds]
        );
        return result.rows[0].count === filter.userIds.length;
    }
    if (type === "group") return true;
    return true;
}

function validateText(title, content) {
    return typeof title === "string" && title.trim().length > 0 &&
        title.trim().length <= 200 &&
        typeof content === "string" && content.trim().length > 0 &&
        content.trim().length <= 10000;
}

function parsePinOrder(value) {
    return typeof value === "number" && Number.isInteger(value) &&
        value >= 0 && value <= 9999
        ? value
        : null;
}

function normalizeAnnouncementLink(url, label) {
    if ((url === undefined || url === null || url === "") &&
        (label === undefined || label === null || label === "")) {
        return { url: null, label: null };
    }
    if (typeof url !== "string" || typeof label !== "string") return null;

    const cleanUrl = url.trim();
    const cleanLabel = label.trim();
    if (!cleanUrl || cleanUrl.length > 2048 ||
        !cleanLabel || cleanLabel.length > 100 ||
        /[\u0000-\u001f\u007f\\]/.test(cleanUrl)) {
        return null;
    }

    if (cleanUrl.startsWith("/")) {
        if (cleanUrl.startsWith("//")) return null;
        try {
            if (new URL(cleanUrl, "https://noveltail.invalid").origin !==
                "https://noveltail.invalid") {
                return null;
            }
        } catch {
            return null;
        }
    } else {
        if (!/^https?:\/\//i.test(cleanUrl)) return null;
        try {
            const parsed = new URL(cleanUrl);
            if (!["http:", "https:"].includes(parsed.protocol) ||
                !parsed.hostname || parsed.username || parsed.password) {
                return null;
            }
        } catch {
            return null;
        }
    }

    return { url: cleanUrl, label: cleanLabel };
}

router.get("/home-pinned", async (req, res) => {
    try {
        const result = await pool.query(
            `SELECT a.announcement_id, a.title, a.content, a.link_url,
                    a.link_label, a.pin_order, a.published_at, a.expires_at
             FROM announcements a
             WHERE a.is_pinned = TRUE
               AND a.status = 'published'
               AND a.published_at <= CURRENT_TIMESTAMP
               AND (a.expires_at IS NULL OR a.expires_at > CURRENT_TIMESTAMP)
               AND a.audience_type = 'all'
             ORDER BY a.pin_order, a.published_at DESC, a.announcement_id DESC
             LIMIT 20`,
            []
        );
        res.set("Cache-Control", "public, max-age=60");
        res.json({ announcements: result.rows });
    } catch (error) {
        console.error("List pinned home announcements:", error);
        res.status(500).json({ message: "Could not load announcements." });
    }
});

router.get("/public", async (req, res) => {
    try {
        await processDueAnnouncements();
        const result = await pool.query(
            `SELECT announcement_id, title, content, link_url, link_label,
                    published_at, expires_at
             FROM announcements
             WHERE audience_type = 'all'
               AND status = 'published'
               AND published_at <= CURRENT_TIMESTAMP
               AND (expires_at IS NULL OR expires_at > CURRENT_TIMESTAMP)
             ORDER BY published_at DESC, announcement_id DESC
             LIMIT 100`
        );
        res.set("Cache-Control", "public, max-age=60");
        res.json({ announcements: result.rows });
    } catch (error) {
        console.error("List public announcements:", error);
        res.status(500).json({ message: "Could not load announcements." });
    }
});

router.use(requireAuth);

router.use("/admin", requireAdmin, rateLimits.admin);

router.post("/admin/private-notifications", async (req, res) => {
    const body = req.body || {};
    const audienceType = body.audience_type;
    const audienceFilter = normalizeAudience(
        audienceType,
        body.audience_filter
    );
    if (!validateText(body.title, body.message) ||
        !["individual", "group"].includes(audienceType) ||
        !audienceFilter) {
        return res.status(400).json({
            message: "Provide a title, message, and private recipient selection."
        });
    }

    const client = await pool.connect();
    try {
        await client.query("BEGIN");
        if (!await validateAudience(client, audienceType, audienceFilter)) {
            await client.query("ROLLBACK");
            return res.status(400).json({
                message: "One or more recipient accounts were not found."
            });
        }

        const recipientCondition = audienceType === "individual"
            ? "u.user_id = ANY($4::bigint[])"
            : "u.role = ANY($4::varchar[])";
        const recipients = audienceType === "individual"
            ? audienceFilter.userIds
            : audienceFilter.roles;
        const inserted = await client.query(
            `INSERT INTO notifications (
                user_id, actor_id, type, category, message, metadata
             )
             SELECT u.user_id, $1, 'system', 'system', $2, $3::jsonb
             FROM users u
             WHERE ${recipientCondition}
             RETURNING notification_id`,
            [
                req.user.user_id,
                body.message.trim(),
                JSON.stringify({
                    source: "admin_private_notification",
                    title: body.title.trim()
                }),
                recipients
            ]
        );
        if (!inserted.rowCount) {
            await client.query("ROLLBACK");
            return res.status(400).json({
                message: "The selected recipients were not found."
            });
        }

        await logAdminAction(client, {
            actorId: req.user.user_id,
            actorRole: req.adminRole,
            targetType: "system",
            targetId: null,
            action: "private_notification_sent",
            newValues: {
                audience_type: audienceType,
                recipient_count: inserted.rowCount
            }
        });
        await client.query("COMMIT");
        res.status(201).json({
            message: `Private notification sent to ${inserted.rowCount} recipient(s).`,
            sent: inserted.rowCount
        });
    } catch (error) {
        await client.query("ROLLBACK");
        console.error("Send private notification:", error);
        res.status(500).json({ message: "Could not send private notification." });
    } finally {
        client.release();
    }
});

router.get("/admin", async (req, res) => {
    const status = typeof req.query.status === "string" ? req.query.status : "";
    const q = typeof req.query.q === "string" ? req.query.q.trim() : "";
    if ((status && !STATUSES.has(status)) || q.length > 100) {
        return res.status(400).json({ message: "Invalid announcement filter." });
    }
    try {
        await processDueAnnouncements();
        const values = [];
        const clauses = ["a.audience_type = 'all'"];
        if (status) {
            values.push(status);
            clauses.push(`a.status = $${values.length}`);
        }
        if (q) {
            values.push(`%${q}%`);
            clauses.push(
                `(a.title ILIKE $${values.length} OR a.content ILIKE $${values.length})`
            );
        }
        const result = await pool.query(
            `SELECT a.announcement_id, a.title, a.content, a.audience_type,
                    a.audience_filter, a.status, a.published_at, a.expires_at,
                    a.is_pinned, a.pin_order, a.link_url, a.link_label,
                    a.created_at, a.updated_at, u.username AS creator_username,
                    COUNT(ar.user_id)::int AS recipient_count,
                    COUNT(ar.user_id) FILTER (WHERE ar.is_read)::int AS read_count
             FROM announcements a
             LEFT JOIN users u ON u.user_id = a.created_by
             LEFT JOIN announcement_recipients ar
               ON ar.announcement_id = a.announcement_id
             WHERE ${clauses.length ? clauses.join(" AND ") : "TRUE"}
             GROUP BY a.announcement_id, u.username
             ORDER BY a.created_at DESC, a.announcement_id DESC
             LIMIT 100`,
            values
        );
        res.json({ announcements: result.rows });
    } catch (error) {
        console.error("Admin list announcements:", error);
        res.status(500).json({ message: "Could not load announcements." });
    }
});

router.get("/admin/:announcementId", async (req, res) => {
    const announcementId = parseId(req.params.announcementId);
    if (!announcementId) {
        return res.status(400).json({ message: "Invalid announcement ID." });
    }
    try {
        await processDueAnnouncements();
        const [announcementResult, historyResult] = await Promise.all([
            pool.query(
                `SELECT a.*, u.username AS creator_username,
                        COUNT(ar.user_id)::int AS recipient_count,
                        COUNT(ar.user_id) FILTER (WHERE ar.is_read)::int AS read_count
                 FROM announcements a
                 LEFT JOIN users u ON u.user_id = a.created_by
                 LEFT JOIN announcement_recipients ar
                   ON ar.announcement_id = a.announcement_id
                 WHERE a.announcement_id = $1
                 GROUP BY a.announcement_id, u.username`,
                [announcementId]
            ),
            pool.query(
                `SELECT log_id, actor_role, action, reason, old_values,
                        new_values, created_at
                 FROM admin_action_logs
                 WHERE target_type = 'announcement' AND target_id = $1
                 ORDER BY created_at DESC, log_id DESC`,
                [announcementId]
            )
        ]);
        if (!announcementResult.rowCount) {
            return res.status(404).json({ message: "Announcement not found." });
        }
        const recipients = await pool.query(
            `SELECT u.user_id, u.username, u.display_name, u.role,
                    ar.is_read, ar.delivered_at, ar.read_at
             FROM announcement_recipients ar
             JOIN users u ON u.user_id = ar.user_id
             WHERE ar.announcement_id = $1
             ORDER BY ar.delivered_at DESC, ar.user_id
             LIMIT 200`,
            [announcementId]
        );
        res.json({
            announcement: announcementResult.rows[0],
            recipients: recipients.rows,
            history: historyResult.rows
        });
    } catch (error) {
        console.error("Admin get announcement:", error);
        res.status(500).json({ message: "Could not load announcement details." });
    }
});

router.post("/admin", async (req, res) => {
    const { title, content, audience_type: audienceType } = req.body || {};
    const audienceFilter = normalizeAudience(audienceType, req.body?.audience_filter);
    const link = normalizeAnnouncementLink(
        req.body?.link_url,
        req.body?.link_label
    );
    const pinned = req.body?.is_pinned === undefined
        ? false
        : req.body.is_pinned;
    const pinOrder = req.body?.pin_order === undefined
        ? 0
        : parsePinOrder(req.body.pin_order);
    let expiresAt;
    try {
        expiresAt = parseDate(req.body?.expires_at, "expires_at");
    } catch (error) {
        return res.status(400).json({ message: error.message });
    }
    if (audienceType !== "all" || !validateText(title, content) ||
        !audienceFilter || !link ||
        typeof pinned !== "boolean" || pinOrder === null) {
        return res.status(400).json({
            message: "Website announcements must be addressed to everyone."
        });
    }

    const client = await pool.connect();
    try {
        await client.query("BEGIN");
        if (!await validateAudience(client, audienceType, audienceFilter)) {
            await client.query("ROLLBACK");
            return res.status(400).json({ message: "One or more audience users or roles were not found." });
        }
        const result = await client.query(
            `INSERT INTO announcements (
                created_by, title, content, audience_type, audience_filter,
                expires_at, status, is_pinned, pin_order, link_url, link_label
             )
             VALUES ($1, $2, $3, $4, $5::jsonb, $6, 'draft', $7, $8, $9, $10)
             RETURNING *`,
            [
                req.user.user_id, title.trim(), content.trim(), audienceType,
                JSON.stringify(audienceFilter), expiresAt, pinned, pinOrder,
                link.url, link.label
            ]
        );
        const announcement = result.rows[0];
        await logAdminAction(client, {
            actorId: req.user.user_id,
            actorRole: req.adminRole,
            targetType: "announcement",
            targetId: announcement.announcement_id,
            action: "announcement_created",
            newValues: { status: "draft", audience_type: audienceType }
        });
        await client.query("COMMIT");
        res.status(201).json({ announcement });
    } catch (error) {
        await client.query("ROLLBACK");
        console.error("Create announcement:", error);
        res.status(500).json({ message: "Could not create announcement." });
    } finally {
        client.release();
    }
});

router.patch("/admin/:announcementId", async (req, res) => {
    const announcementId = parseId(req.params.announcementId);
    const body = req.body || {};
    if (!announcementId || !validateText(body.title, body.content)) {
        return res.status(400).json({ message: "Invalid announcement details." });
    }
    const hasLink = Object.hasOwn(body, "link_url") ||
        Object.hasOwn(body, "link_label");
    const link = hasLink
        ? normalizeAnnouncementLink(body.link_url, body.link_label)
        : null;
    const hasPinned = Object.hasOwn(body, "is_pinned");
    const hasPinOrder = Object.hasOwn(body, "pin_order");
    const pinned = hasPinned ? body.is_pinned : null;
    const pinOrder = hasPinOrder ? parsePinOrder(body.pin_order) : null;
    if ((hasLink && !link) ||
        (hasPinned && typeof pinned !== "boolean") ||
        (hasPinOrder && pinOrder === null)) {
        return res.status(400).json({ message: "Invalid announcement link or pin settings." });
    }
    let expiresAt;
    try {
        expiresAt = parseDate(body.expires_at, "expires_at");
    } catch (error) {
        return res.status(400).json({ message: error.message });
    }
    const hasAudience = Object.hasOwn(body, "audience_type") ||
        Object.hasOwn(body, "audience_filter");
    const audienceType = body.audience_type;
    const audienceFilter = hasAudience
        ? normalizeAudience(audienceType, body.audience_filter)
        : null;
    if (hasAudience && (audienceType !== "all" || !audienceFilter)) {
        return res.status(400).json({
            message: "Website announcements must be addressed to everyone."
        });
    }

    const client = await pool.connect();
    try {
        await client.query("BEGIN");
        const currentResult = await client.query(
            "SELECT * FROM announcements WHERE announcement_id = $1 FOR UPDATE",
            [announcementId]
        );
        if (!currentResult.rowCount) {
            await client.query("ROLLBACK");
            return res.status(404).json({ message: "Announcement not found." });
        }
        const current = currentResult.rows[0];
        if (current.audience_type !== "all") {
            await client.query("ROLLBACK");
            return res.status(409).json({
                message: "Targeted messages must use private notifications."
            });
        }
        if (current.status === "cancelled" ||
            (current.status === "published" && hasAudience)) {
            await client.query("ROLLBACK");
            return res.status(409).json({
                message: "Cancelled announcements cannot be edited, and published announcements cannot change audience."
            });
        }
        if (current.status === "draft" && hasAudience &&
            !await validateAudience(client, audienceType, audienceFilter)) {
            await client.query("ROLLBACK");
            return res.status(400).json({ message: "One or more audience users or roles were not found." });
        }
        if (expiresAt && current.published_at &&
            expiresAt < new Date(current.published_at)) {
            await client.query("ROLLBACK");
            return res.status(400).json({ message: "Expiration date cannot precede the publication date." });
        }
        const nextType = hasAudience ? audienceType : current.audience_type;
        const nextFilter = hasAudience ? audienceFilter : current.audience_filter;
        const nextPinned = hasPinned ? pinned : current.is_pinned;
        const nextPinOrder = hasPinOrder ? pinOrder : current.pin_order;
        const nextLink = hasLink
            ? link
            : { url: current.link_url, label: current.link_label };
        const updated = await client.query(
            `UPDATE announcements
             SET title = $2, content = $3, audience_type = $4,
                 audience_filter = $5::jsonb, expires_at = $6,
                 is_pinned = $7, pin_order = $8, link_url = $9,
                 link_label = $10,
                 updated_at = CURRENT_TIMESTAMP
             WHERE announcement_id = $1
             RETURNING *`,
            [
                announcementId, body.title.trim(), body.content.trim(),
                nextType, JSON.stringify(nextFilter), expiresAt, nextPinned,
                nextPinOrder, nextLink.url, nextLink.label
            ]
        );
        await logAdminAction(client, {
            actorId: req.user.user_id,
            actorRole: req.adminRole,
            targetType: "announcement",
            targetId: announcementId,
            action: "announcement_updated",
            oldValues: {
                title: current.title,
                status: current.status,
                audience_type: current.audience_type,
                is_pinned: current.is_pinned,
                pin_order: current.pin_order,
                link_url: current.link_url,
                link_label: current.link_label
            },
            newValues: {
                title: updated.rows[0].title,
                status: current.status,
                audience_type: nextType,
                is_pinned: nextPinned,
                pin_order: nextPinOrder,
                link_url: nextLink.url,
                link_label: nextLink.label
            }
        });
        await client.query("COMMIT");
        res.json({ announcement: updated.rows[0] });
    } catch (error) {
        await client.query("ROLLBACK");
        console.error("Update announcement:", error);
        res.status(500).json({ message: "Could not update announcement." });
    } finally {
        client.release();
    }
});

router.post("/admin/:announcementId/publish", async (req, res) => {
    const announcementId = parseId(req.params.announcementId);
    let publishAt;
    try {
        publishAt = parseDate(req.body?.published_at, "published_at");
    } catch (error) {
        return res.status(400).json({ message: error.message });
    }
    if (!announcementId) {
        return res.status(400).json({ message: "Invalid announcement ID." });
    }
    const client = await pool.connect();
    try {
        await client.query("BEGIN");
        const currentResult = await client.query(
            "SELECT * FROM announcements WHERE announcement_id = $1 FOR UPDATE",
            [announcementId]
        );
        if (!currentResult.rowCount) {
            await client.query("ROLLBACK");
            return res.status(404).json({ message: "Announcement not found." });
        }
        const current = currentResult.rows[0];
        if (current.status !== "draft") {
            await client.query("ROLLBACK");
            return res.status(409).json({ message: "This announcement is not a draft." });
        }
        if (current.audience_type !== "all") {
            await client.query("ROLLBACK");
            return res.status(409).json({
                message: "Targeted messages must use private notifications."
            });
        }
        const scheduledAt = publishAt && publishAt > new Date()
            ? publishAt
            : null;
        if (current.expires_at &&
            new Date(current.expires_at) <= (scheduledAt || new Date())) {
            await client.query("ROLLBACK");
            return res.status(400).json({ message: "Expiration date must be after the publication date." });
        }
        const result = await client.query(
            `UPDATE announcements
             SET published_at = COALESCE($2, CURRENT_TIMESTAMP),
                 status = CASE WHEN $2::timestamptz IS NULL
                               THEN 'published' ELSE 'draft' END,
                 updated_at = CURRENT_TIMESTAMP
             WHERE announcement_id = $1
             RETURNING *`,
            [announcementId, scheduledAt]
        );
        await logAdminAction(client, {
            actorId: req.user.user_id,
            actorRole: req.adminRole,
            targetType: "announcement",
            targetId: announcementId,
            action: scheduledAt ? "announcement_scheduled" : "announcement_published",
            newValues: {
                status: scheduledAt ? "scheduled" : "published",
                published_at: scheduledAt || result.rows[0].published_at
            }
        });
        await client.query("COMMIT");
        res.json({
            message: scheduledAt ? "Announcement scheduled." : "Announcement published.",
            announcement: result.rows[0]
        });
    } catch (error) {
        await client.query("ROLLBACK");
        console.error("Publish announcement:", error);
        res.status(500).json({ message: "Could not publish announcement." });
    } finally {
        client.release();
    }
});

router.post("/admin/:announcementId/cancel", async (req, res) => {
    const announcementId = parseId(req.params.announcementId);
    const reason = typeof req.body?.reason === "string"
        ? req.body.reason.trim().slice(0, 500)
        : "";
    if (!announcementId) {
        return res.status(400).json({ message: "Invalid announcement ID." });
    }
    const client = await pool.connect();
    try {
        await client.query("BEGIN");
        const current = await client.query(
            "SELECT status FROM announcements WHERE announcement_id = $1 FOR UPDATE",
            [announcementId]
        );
        if (!current.rowCount) {
            await client.query("ROLLBACK");
            return res.status(404).json({ message: "Announcement not found." });
        }
        if (current.rows[0].status === "cancelled") {
            await client.query("ROLLBACK");
            return res.status(409).json({ message: "This announcement has already been cancelled." });
        }
        await client.query(
            `UPDATE announcements
             SET status = 'cancelled', updated_at = CURRENT_TIMESTAMP
             WHERE announcement_id = $1`,
            [announcementId]
        );
        await logAdminAction(client, {
            actorId: req.user.user_id,
            actorRole: req.adminRole,
            targetType: "announcement",
            targetId: announcementId,
            action: "announcement_cancelled",
            reason: reason || null,
            oldValues: { status: current.rows[0].status },
            newValues: { status: "cancelled" }
        });
        await client.query("COMMIT");
        res.json({ message: "Announcement cancelled." });
    } catch (error) {
        await client.query("ROLLBACK");
        console.error("Cancel announcement:", error);
        res.status(500).json({ message: "Could not cancel announcement." });
    } finally {
        client.release();
    }
});

router.post("/admin/:announcementId/unpublish", async (req, res) => {
    const announcementId = parseId(req.params.announcementId);
    if (!announcementId) {
        return res.status(400).json({ message: "Invalid announcement ID." });
    }
    const client = await pool.connect();
    try {
        await client.query("BEGIN");
        const current = await client.query(
            "SELECT status, is_pinned FROM announcements WHERE announcement_id = $1 FOR UPDATE",
            [announcementId]
        );
        if (!current.rowCount) {
            await client.query("ROLLBACK");
            return res.status(404).json({ message: "Announcement not found." });
        }
        if (current.rows[0].status !== "published") {
            await client.query("ROLLBACK");
            return res.status(409).json({ message: "Only published announcements can be unpublished." });
        }
        const updated = await client.query(
            `UPDATE announcements
             SET status = 'draft', published_at = NULL, is_pinned = FALSE,
                 updated_at = CURRENT_TIMESTAMP
             WHERE announcement_id = $1
             RETURNING *`,
            [announcementId]
        );
        await logAdminAction(client, {
            actorId: req.user.user_id,
            actorRole: req.adminRole,
            targetType: "announcement",
            targetId: announcementId,
            action: "announcement_unpublished",
            oldValues: {
                status: "published",
                is_pinned: current.rows[0].is_pinned
            },
            newValues: { status: "draft", is_pinned: false }
        });
        await client.query("COMMIT");
        res.json({
            message: "Announcement unpublished.",
            announcement: updated.rows[0]
        });
    } catch (error) {
        await client.query("ROLLBACK");
        console.error("Unpublish announcement:", error);
        res.status(500).json({ message: "Could not unpublish announcement." });
    } finally {
        client.release();
    }
});

router.post("/admin/:announcementId/pin", async (req, res) => {
    const announcementId = parseId(req.params.announcementId);
    const { is_pinned: pinned } = req.body || {};
    const pinOrder = parsePinOrder(req.body?.pin_order);
    if (!announcementId || typeof pinned !== "boolean" || pinOrder === null) {
        return res.status(400).json({ message: "Invalid announcement pin settings." });
    }
    const client = await pool.connect();
    try {
        await client.query("BEGIN");
        const current = await client.query(
            `SELECT status, is_pinned, pin_order
             FROM announcements
             WHERE announcement_id = $1
             FOR UPDATE`,
            [announcementId]
        );
        if (!current.rowCount) {
            await client.query("ROLLBACK");
            return res.status(404).json({ message: "Announcement not found." });
        }
        if (pinned && current.rows[0].status !== "published") {
            await client.query("ROLLBACK");
            return res.status(409).json({ message: "Only published announcements can be pinned." });
        }
        const updated = await client.query(
            `UPDATE announcements
             SET is_pinned = $2, pin_order = $3,
                 updated_at = CURRENT_TIMESTAMP
             WHERE announcement_id = $1
             RETURNING *`,
            [announcementId, pinned, pinOrder]
        );
        await logAdminAction(client, {
            actorId: req.user.user_id,
            actorRole: req.adminRole,
            targetType: "announcement",
            targetId: announcementId,
            action: pinned ? "announcement_pinned" : "announcement_unpinned",
            oldValues: {
                is_pinned: current.rows[0].is_pinned,
                pin_order: current.rows[0].pin_order
            },
            newValues: { is_pinned: pinned, pin_order: pinOrder }
        });
        await client.query("COMMIT");
        res.json({ announcement: updated.rows[0] });
    } catch (error) {
        await client.query("ROLLBACK");
        console.error("Update announcement pin:", error);
        res.status(500).json({ message: "Could not update announcement pin." });
    } finally {
        client.release();
    }
});

router.delete("/admin/:announcementId", async (req, res) => {
    const announcementId = parseId(req.params.announcementId);
    if (!announcementId) {
        return res.status(400).json({ message: "Invalid announcement ID." });
    }
    const client = await pool.connect();
    try {
        await client.query("BEGIN");
        const current = await client.query(
            `SELECT title, status
             FROM announcements
             WHERE announcement_id = $1
             FOR UPDATE`,
            [announcementId]
        );
        if (!current.rowCount) {
            await client.query("ROLLBACK");
            return res.status(404).json({ message: "Announcement not found." });
        }
        await client.query(
            "DELETE FROM notifications WHERE metadata->>'announcementId' = $1",
            [String(announcementId)]
        );
        await logAdminAction(client, {
            actorId: req.user.user_id,
            actorRole: req.adminRole,
            targetType: "announcement",
            targetId: announcementId,
            action: "announcement_deleted",
            oldValues: {
                title: current.rows[0].title,
                status: current.rows[0].status
            }
        });
        await client.query(
            "DELETE FROM announcements WHERE announcement_id = $1",
            [announcementId]
        );
        await client.query("COMMIT");
        res.json({ message: "Announcement deleted." });
    } catch (error) {
        await client.query("ROLLBACK");
        console.error("Delete announcement:", error);
        res.status(500).json({ message: "Could not delete announcement." });
    } finally {
        client.release();
    }
});

router.get("/", async (req, res) => {
    try {
        await processDueAnnouncements();
        const result = await pool.query(
            `SELECT a.announcement_id, a.title, a.content, a.published_at,
                    a.expires_at, ar.is_read, ar.delivered_at, ar.read_at
             FROM announcement_recipients ar
             JOIN announcements a ON a.announcement_id = ar.announcement_id
             WHERE ar.user_id = $1 AND a.status = 'published'
               AND (a.expires_at IS NULL OR a.expires_at > CURRENT_TIMESTAMP)
             ORDER BY a.published_at DESC, a.announcement_id DESC
             LIMIT 100`,
            [req.user.user_id]
        );
        res.json({ announcements: result.rows });
    } catch (error) {
        console.error("List user announcements:", error);
        res.status(500).json({ message: "Could not load announcements." });
    }
});

router.get("/:announcementId", async (req, res) => {
    const announcementId = parseId(req.params.announcementId);
    if (!announcementId) {
        return res.status(400).json({ message: "Invalid announcement ID." });
    }
    try {
        await processDueAnnouncements();
        const result = await pool.query(
            `SELECT a.announcement_id, a.title, a.content, a.published_at,
                    a.expires_at, ar.is_read, ar.delivered_at, ar.read_at
             FROM announcement_recipients ar
             JOIN announcements a ON a.announcement_id = ar.announcement_id
             WHERE a.announcement_id = $1 AND ar.user_id = $2
               AND a.status = 'published'
               AND (a.expires_at IS NULL OR a.expires_at > CURRENT_TIMESTAMP)`,
            [announcementId, req.user.user_id]
        );
        if (!result.rowCount) {
            return res.status(404).json({ message: "Announcement not found or you do not have permission to read it." });
        }
        res.json({ announcement: result.rows[0] });
    } catch (error) {
        console.error("Get user announcement:", error);
        res.status(500).json({ message: "Could not load announcement details." });
    }
});

router.patch("/:announcementId/read", async (req, res) => {
    const announcementId = parseId(req.params.announcementId);
    if (!announcementId) {
        return res.status(400).json({ message: "Invalid announcement ID." });
    }
    try {
        const result = await pool.query(
            `UPDATE announcement_recipients ar
             SET is_read = TRUE, read_at = COALESCE(read_at, CURRENT_TIMESTAMP)
             FROM announcements a
             WHERE ar.announcement_id = $1 AND ar.user_id = $2
               AND a.announcement_id = ar.announcement_id
               AND a.status = 'published'
             RETURNING ar.announcement_id, ar.is_read, ar.read_at`,
            [announcementId, req.user.user_id]
        );
        if (!result.rowCount) {
            return res.status(404).json({ message: "Announcement not found or you do not have permission to read it." });
        }
        res.json({ recipient: result.rows[0] });
    } catch (error) {
        console.error("Mark announcement read:", error);
        res.status(500).json({ message: "Could not update announcement read status." });
    }
});

module.exports = router;
