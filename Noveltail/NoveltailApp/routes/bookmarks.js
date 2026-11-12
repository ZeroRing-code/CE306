
const express = require("express");
const pool = require("../db");
const requireAuth = require("../middleware/auth");

const router = express.Router();

router.use(requireAuth);

const validId = id =>
    /^\d+$/.test(String(id)) && Number(id) > 0;


// =====================================
// GET: current user's bookmarks.
// =====================================

router.get("/", async (req, res) => {
    try {
        const result = await pool.query(
            `SELECT
                b.bookmark_id,
                b.created_at AS bookmarked_at,
                n.novel_id,
                n.title,
                n.description,
                n.cover_image_url,
                n.status,
                n.view_count,
                u.username,
                u.display_name
             FROM bookmarks b
             JOIN novels n ON n.novel_id = b.novel_id
             JOIN users u ON u.user_id = n.user_id
             WHERE b.user_id = $1
               AND n.moderation_status = 'active'
               AND EXISTS (
                   SELECT 1
                   FROM chapters c
                   WHERE c.novel_id = n.novel_id
                     AND c.status = 'published'
               )
             ORDER BY b.created_at DESC`,
            [req.user.user_id]
        );

        res.json({
            bookmarks: result.rows
        });

    } catch (error) {
        console.error("Get Bookmarks:", error);

        res.status(500).json({
            message: "Could not load bookmarks."
        });
    }
});


// =====================================
// GET: check bookmark status.
// =====================================

router.get("/:novelId/status", async (req, res) => {
    const { novelId } = req.params;

    if (!validId(novelId)) {
        return res.status(400).json({
            message: "Invalid novel ID."
        });
    }

    try {
        const result = await pool.query(
            `SELECT bookmark_id
             FROM bookmarks
             WHERE user_id = $1
               AND novel_id = $2`,
            [req.user.user_id, novelId]
        );

        res.json({
            bookmarked: result.rowCount > 0
        });

    } catch (error) {
        console.error("Check Bookmark:", error);

        res.status(500).json({
            message: "Could not check bookmark status."
        });
    }
});


// =====================================
// POST: add a bookmark.
// =====================================

router.post("/:novelId", async (req, res) => {
    const { novelId } = req.params;

    if (!validId(novelId)) {
        return res.status(400).json({
            message: "Invalid novel ID."
        });
    }

    const client = await pool.connect();
    let started = false;

    try {
        await client.query("BEGIN");
        started = true;

        // Prevent concurrent duplicate bookmarks.
        await client.query(
            `SELECT pg_advisory_xact_lock(
                hashtext($1),
                hashtext($2)
            )`,
            [String(req.user.user_id), String(novelId)]
        );

        // Verify that the novel exists and has published chapters.
        const novel = await client.query(
            `SELECT n.novel_id
             FROM novels n
             WHERE n.novel_id = $1
               AND n.moderation_status = 'active'
               AND EXISTS (
                   SELECT 1
                   FROM chapters c
                   WHERE c.novel_id = n.novel_id
                     AND c.status = 'published'
               )`,
            [novelId]
        );

        if (!novel.rowCount) {
            await client.query("ROLLBACK");
            started = false;

            return res.status(404).json({
                message: "Novel not found or it has no published chapters."
            });
        }

        // Check whether it is already bookmarked.
        const existing = await client.query(
            `SELECT bookmark_id
             FROM bookmarks
             WHERE user_id = $1
               AND novel_id = $2`,
            [req.user.user_id, novelId]
        );

        if (existing.rowCount) {
            await client.query("COMMIT");
            started = false;

            return res.json({
                message: "This novel is already bookmarked.",
                bookmarked: true
            });
        }

        await client.query(
            `INSERT INTO bookmarks (user_id, novel_id)
             VALUES ($1, $2)`,
            [req.user.user_id, novelId]
        );

        await client.query("COMMIT");
        started = false;

        res.status(201).json({
            message: "Novel bookmarked.",
            bookmarked: true
        });

    } catch (error) {
        if (started) await client.query("ROLLBACK");

        console.error("Add Bookmark:", error);

        res.status(500).json({
            message: "Could not bookmark novel."
        });

    } finally {
        client.release();
    }
});


// =====================================
// DELETE: remove a bookmark.
// =====================================

router.delete("/:novelId", async (req, res) => {
    const { novelId } = req.params;

    if (!validId(novelId)) {
        return res.status(400).json({
            message: "Invalid novel ID."
        });
    }

    try {
        const result = await pool.query(
            `DELETE FROM bookmarks
             WHERE user_id = $1
               AND novel_id = $2
             RETURNING bookmark_id`,
            [req.user.user_id, novelId]
        );

        if (!result.rowCount) {
            return res.status(404).json({
                message: "Novel is not bookmarked."
            });
        }

        res.json({
            message: "Bookmark removed.",
            bookmarked: false
        });

    } catch (error) {
        console.error("Delete Bookmark:", error);

        res.status(500).json({
            message: "Could not remove bookmark."
        });
    }
});


module.exports = router;
