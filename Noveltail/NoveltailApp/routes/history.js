
const express = require("express");
const pool = require("../db");
const requireAuth = require("../middleware/auth");

const router = express.Router();

router.use(requireAuth);

const validId = id =>
    /^\d+$/.test(String(id)) && Number(id) > 0;


// =====================================
// GET: current user's reading history.
// =====================================

router.get("/", async (req, res) => {
    try {
        const result = await pool.query(
            `SELECT
                rh.history_id,
                rh.user_id,
                rh.novel_id,
                rh.last_chapter_id,
                rh.last_read_at,

                n.title,
                n.description,
                n.cover_image_url,
                n.status AS novel_status,
                n.view_count,

                u.username,
                u.display_name,

                c.chapter_number,
                c.title AS last_chapter_title,

                (
                    SELECT COUNT(*)::int
                    FROM chapters ch
                    WHERE ch.novel_id = n.novel_id
                      AND ch.status = 'published'
                ) AS published_chapter_count

             FROM reading_history rh

             JOIN novels n
                ON n.novel_id = rh.novel_id

             JOIN users u
                ON u.user_id = n.user_id

             LEFT JOIN chapters c
                ON c.chapter_id = rh.last_chapter_id
               AND c.novel_id = rh.novel_id

             WHERE rh.user_id = $1
               AND n.moderation_status = 'active'

             ORDER BY
                rh.last_read_at DESC,
                rh.history_id DESC`,
            [req.user.user_id]
        );

        res.json({
            history: result.rows
        });

    } catch (error) {
        console.error("Get Reading History:", error);

        res.status(500).json({
            message: "Could not load reading history."
        });
    }
});


// =====================================
// POST: save reading history.
// =====================================

router.post("/:novelId", async (req, res) => {
    const { novelId } = req.params;
    const chapterId = req.body?.chapterId;

    if (!validId(novelId)) {
        return res.status(400).json({
            message: "Invalid novel ID."
        });
    }

    if (!validId(chapterId)) {
        return res.status(400).json({
            message: "Invalid chapter ID."
        });
    }

    try {
        // Verify that the chapter belongs to this novel and is published.
        const chapter = await pool.query(
            `SELECT c.chapter_id
             FROM chapters c
             JOIN novels n ON n.novel_id = c.novel_id
             WHERE c.chapter_id = $1
               AND c.novel_id = $2
               AND c.status = 'published'
               AND n.moderation_status = 'active'`,
            [chapterId, novelId]
        );

        if (!chapter.rowCount) {
            return res.status(404).json({
                message: "Chapter not found or not published."
            });
        }

        // Insert new history or update existing history.
        const result = await pool.query(
            `INSERT INTO reading_history (
                user_id,
                novel_id,
                last_chapter_id,
                last_read_at
             )
             VALUES ($1, $2, $3, CURRENT_TIMESTAMP)

             ON CONFLICT (user_id, novel_id)

             DO UPDATE SET
                last_chapter_id = EXCLUDED.last_chapter_id,
                last_read_at = CURRENT_TIMESTAMP

             RETURNING
                history_id,
                novel_id,
                last_chapter_id,
                last_read_at`,
            [
                req.user.user_id,
                novelId,
                chapterId
            ]
        );

        res.json({
            message: "Reading history saved.",
            history: result.rows[0]
        });

    } catch (error) {
        console.error("Save Reading History:", error);

        res.status(500).json({
            message: "Could not save reading history."
        });
    }
});


// =====================================
// DELETE: remove history for one novel.
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
            `DELETE FROM reading_history
             WHERE user_id = $1
               AND novel_id = $2
             RETURNING history_id`,
            [
                req.user.user_id,
                novelId
            ]
        );

        if (!result.rowCount) {
            return res.status(404).json({
                message: "Reading history for this novel was not found."
            });
        }

        res.json({
            message: "Reading history deleted."
        });

    } catch (error) {
        console.error("Delete Reading History:", error);

        res.status(500).json({
            message: "Could not delete reading history."
        });
    }
});


module.exports = router;
