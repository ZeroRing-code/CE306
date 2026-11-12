const express = require("express");
const pool = require("../db");
const requireAuth = require("../middleware/auth");
const { createNotification } = require("./notification-helper");

const router = express.Router();
router.use(requireAuth);

function validId(id) {
    return /^\d+$/.test(String(id)) && Number(id) > 0;
}

router.get("/novels/:novelId/status", async (req, res) => {
    if (!validId(req.params.novelId)) {
        return res.status(400).json({ message: "Invalid novel ID." });
    }
    try {
        const result = await pool.query(
            `SELECT
                EXISTS (
                    SELECT 1
                    FROM novels n
                    WHERE n.novel_id = $2
                      AND n.moderation_status = 'active'
                      AND EXISTS (
                          SELECT 1 FROM chapters c
                          WHERE c.novel_id = n.novel_id
                            AND c.status = 'published'
                      )
                ) AS available,
                EXISTS (
                    SELECT 1
                    FROM novel_follows
                    WHERE user_id = $1 AND novel_id = $2
                ) AS following`,
            [req.user.user_id, req.params.novelId]
        );
        if (!result.rows[0].available) {
            return res.status(404).json({ message: "Novel to follow was not found." });
        }
        res.json({ following: result.rows[0].following });
    } catch (error) {
        console.error("Get novel follow status:", error);
        res.status(500).json({ message: "Could not load novel follow status." });
    }
});

router.post("/novels/:novelId", async (req, res) => {
    if (!validId(req.params.novelId)) {
        return res.status(400).json({ message: "Invalid novel ID." });
    }
    const client = await pool.connect();
    try {
        await client.query("BEGIN");
        const novel = await client.query(
            `SELECT n.novel_id
             FROM novels n
             WHERE n.novel_id = $1
               AND n.moderation_status = 'active'
               AND EXISTS (
                   SELECT 1 FROM chapters c
                   WHERE c.novel_id = n.novel_id
                     AND c.status = 'published'
               )
             FOR SHARE OF n`,
            [req.params.novelId]
        );
        if (!novel.rowCount) {
            await client.query("ROLLBACK");
            return res.status(404).json({ message: "Novel to follow was not found." });
        }
        const followed = await client.query(
            `INSERT INTO novel_follows (user_id, novel_id)
             VALUES ($1, $2)
             ON CONFLICT (user_id, novel_id) DO NOTHING
             RETURNING novel_id`,
            [req.user.user_id, req.params.novelId]
        );
        await client.query("COMMIT");
        res.json({ following: true, created: followed.rowCount > 0 });
    } catch (error) {
        await client.query("ROLLBACK");
        console.error("Follow novel:", error);
        res.status(500).json({ message: "Could not follow novel." });
    } finally {
        client.release();
    }
});

router.delete("/novels/:novelId", async (req, res) => {
    if (!validId(req.params.novelId)) {
        return res.status(400).json({ message: "Invalid novel ID." });
    }
    try {
        await pool.query(
            `DELETE FROM novel_follows
             WHERE user_id = $1 AND novel_id = $2`,
            [req.user.user_id, req.params.novelId]
        );
        res.json({ following: false });
    } catch (error) {
        console.error("Unfollow novel:", error);
        res.status(500).json({ message: "Could not unfollow novel." });
    }
});

router.get("/:userId/status", async (req, res) => {
    if (!validId(req.params.userId)) {
        return res.status(400).json({ message: "Invalid user ID." });
    }
    try {
        const result = await pool.query(
            `SELECT EXISTS (
                SELECT 1 FROM follows
                WHERE follower_id = $1 AND following_id = $2
             ) AS following`,
            [req.user.user_id, req.params.userId]
        );
        res.json({ following: result.rows[0].following });
    } catch (error) {
        console.error("Get follow status:", error);
        res.status(500).json({ message: "Could not load follow status." });
    }
});

router.post("/:userId", async (req, res) => {
    const targetId = req.params.userId;
    if (!validId(targetId) || String(targetId) === String(req.user.user_id)) {
        return res.status(400).json({ message: "You cannot follow this account." });
    }
    const client = await pool.connect();
    try {
        await client.query("BEGIN");
        const target = await client.query(
            `SELECT user_id, username, display_name
             FROM users
             WHERE user_id = $1 AND account_status = 'active'`,
            [targetId]
        );
        if (!target.rowCount) {
            await client.query("ROLLBACK");
            return res.status(404).json({ message: "User to follow was not found." });
        }
        const result = await client.query(
            `INSERT INTO follows (follower_id, following_id)
             VALUES ($1, $2)
             ON CONFLICT (follower_id, following_id) DO NOTHING
             RETURNING following_id`,
            [req.user.user_id, targetId]
        );
        if (result.rowCount) {
            await createNotification(client, {
                userId: targetId,
                actorId: req.user.user_id,
                type: "follow",
                category: "engagement",
                message: `${req.user.display_name || req.user.username} started following you.`
            });
        }
        await client.query("COMMIT");
        res.json({ following: true, created: result.rowCount > 0 });
    } catch (error) {
        await client.query("ROLLBACK");
        console.error("Follow user:", error);
        res.status(500).json({ message: "Could not follow user." });
    } finally {
        client.release();
    }
});

router.delete("/:userId", async (req, res) => {
    if (!validId(req.params.userId)) {
        return res.status(400).json({ message: "Invalid user ID." });
    }
    try {
        await pool.query(
            `DELETE FROM follows
             WHERE follower_id = $1 AND following_id = $2`,
            [req.user.user_id, req.params.userId]
        );
        res.json({ following: false });
    } catch (error) {
        console.error("Unfollow user:", error);
        res.status(500).json({ message: "Could not unfollow user." });
    }
});

module.exports = router;
