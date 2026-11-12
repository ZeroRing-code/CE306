
const express = require("express");
const pool = require("../db");
const requireAuth = require("../middleware/auth");

const router = express.Router();

const validId = id =>
    /^\d+$/.test(String(id)) && Number(id) > 0;

const validReaction = type =>
    type === "like" || type === "dislike";


// =====================================
// GET: current user's reactions to comments.
// =====================================

router.get("/comments/:chapterId/mine", requireAuth, async (req, res) => {
    const { chapterId } = req.params;

    if (!validId(chapterId)) {
        return res.status(400).json({
            message: "Invalid chapter ID."
        });
    }

    try {
        const result = await pool.query(
            `SELECT
                cr.comment_id,
                cr.reaction_type
             FROM comment_reactions cr
             JOIN comments c ON c.comment_id = cr.comment_id
             JOIN chapters ch ON ch.chapter_id = c.chapter_id
             JOIN novels n ON n.novel_id = ch.novel_id
             WHERE c.chapter_id = $1
               AND cr.user_id = $2
               AND ch.status = 'published'
               AND n.moderation_status = 'active'`,
            [chapterId, req.user.user_id]
        );

        res.json({
            reactions: result.rows
        });

    } catch (error) {
        console.error("Get My Comment Reactions:", error);

        res.status(500).json({
            message: "Could not load comment reaction status."
        });
    }
});


// =====================================
// GET: current user's reactions to reviews.
// =====================================

router.get("/reviews/:novelId/mine", requireAuth, async (req, res) => {
    const { novelId } = req.params;

    if (!validId(novelId)) {
        return res.status(400).json({
            message: "Invalid novel ID."
        });
    }

    try {
        const result = await pool.query(
            `SELECT
                rr.review_id,
                rr.reaction_type
             FROM review_reactions rr
             JOIN reviews r ON r.review_id = rr.review_id
             JOIN novels n ON n.novel_id = r.novel_id
             WHERE r.novel_id = $1
               AND rr.user_id = $2
               AND n.moderation_status = 'active'`,
            [novelId, req.user.user_id]
        );

        res.json({
            reactions: result.rows
        });

    } catch (error) {
        console.error("Get My Review Reactions:", error);

        res.status(500).json({
            message: "Could not load review reaction status."
        });
    }
});


// =====================================
// PUT: LIKE / DISLIKE COMMENT
// =====================================

router.put("/comments/:commentId", requireAuth, async (req, res) => {
    const { commentId } = req.params;
    const { reaction_type } = req.body || {};

    if (!validId(commentId)) {
        return res.status(400).json({
            message: "Invalid comment ID."
        });
    }

    if (!validReaction(reaction_type)) {
        return res.status(400).json({
            message: "Invalid reaction type."
        });
    }

    try {
        const target = await pool.query(
            `SELECT c.comment_id
             FROM comments c
             JOIN chapters ch ON ch.chapter_id = c.chapter_id
             JOIN novels n ON n.novel_id = ch.novel_id
             WHERE c.comment_id = $1
               AND ch.status = 'published'
               AND n.moderation_status = 'active'`,
            [commentId]
        );

        if (!target.rowCount) {
            return res.status(404).json({
                message: "Comment not found."
            });
        }

        await pool.query(
            `INSERT INTO comment_reactions (
                user_id,
                comment_id,
                reaction_type
             )
             VALUES ($1, $2, $3)
             ON CONFLICT (user_id, comment_id)
             DO UPDATE SET
                reaction_type = EXCLUDED.reaction_type,
                updated_at = CURRENT_TIMESTAMP`,
            [
                req.user.user_id,
                commentId,
                reaction_type
            ]
        );

        res.json({
            message: reaction_type === "like"
                ? "Comment liked."
                : "Comment disliked.",
            reaction_type
        });

    } catch (error) {
        console.error("React to Comment:", error);

        res.status(500).json({
            message: "Could not save reaction."
        });
    }
});


// =====================================
// DELETE: remove a comment reaction.
// =====================================

router.delete("/comments/:commentId", requireAuth, async (req, res) => {
    const { commentId } = req.params;

    if (!validId(commentId)) {
        return res.status(400).json({
            message: "Invalid comment ID."
        });
    }

    try {
        const result = await pool.query(
            `DELETE FROM comment_reactions
             WHERE comment_id = $1
               AND user_id = $2
             RETURNING comment_id`,
            [commentId, req.user.user_id]
        );

        if (!result.rowCount) {
            return res.status(404).json({
                message: "Your reaction was not found."
            });
        }

        res.json({
            message: "Reaction removed."
        });

    } catch (error) {
        console.error("Remove Comment Reaction:", error);

        res.status(500).json({
            message: "Could not remove reaction."
        });
    }
});


// =====================================
// PUT: LIKE / DISLIKE REVIEW
// =====================================

router.put("/reviews/:reviewId", requireAuth, async (req, res) => {
    const { reviewId } = req.params;
    const { reaction_type } = req.body || {};

    if (!validId(reviewId)) {
        return res.status(400).json({
            message: "Invalid review ID."
        });
    }

    if (!validReaction(reaction_type)) {
        return res.status(400).json({
            message: "Invalid reaction type."
        });
    }

    try {
        const target = await pool.query(
            `SELECT r.review_id
             FROM reviews r
             WHERE r.review_id = $1
               AND EXISTS (
                   SELECT 1
                   FROM chapters c
                   WHERE c.novel_id = r.novel_id
                     AND c.status = 'published'
                     AND EXISTS (
                         SELECT 1
                         FROM novels n
                         WHERE n.novel_id = c.novel_id
                           AND n.moderation_status = 'active'
                     )
               )`,
            [reviewId]
        );

        if (!target.rowCount) {
            return res.status(404).json({
                message: "Review not found."
            });
        }

        await pool.query(
            `INSERT INTO review_reactions (
                user_id,
                review_id,
                reaction_type
             )
             VALUES ($1, $2, $3)
             ON CONFLICT (user_id, review_id)
             DO UPDATE SET
                reaction_type = EXCLUDED.reaction_type,
                updated_at = CURRENT_TIMESTAMP`,
            [
                req.user.user_id,
                reviewId,
                reaction_type
            ]
        );

        res.json({
            message: reaction_type === "like"
                ? "Review liked."
                : "Review disliked.",
            reaction_type
        });

    } catch (error) {
        console.error("React to Review:", error);

        res.status(500).json({
            message: "Could not save reaction."
        });
    }
});


// =====================================
// DELETE: remove a review reaction.
// =====================================

router.delete("/reviews/:reviewId", requireAuth, async (req, res) => {
    const { reviewId } = req.params;

    if (!validId(reviewId)) {
        return res.status(400).json({
            message: "Invalid review ID."
        });
    }

    try {
        const result = await pool.query(
            `DELETE FROM review_reactions
             WHERE review_id = $1
               AND user_id = $2
             RETURNING review_id`,
            [reviewId, req.user.user_id]
        );

        if (!result.rowCount) {
            return res.status(404).json({
                message: "Your reaction was not found."
            });
        }

        res.json({
            message: "Reaction removed."
        });

    } catch (error) {
        console.error("Remove Review Reaction:", error);

        res.status(500).json({
            message: "Could not remove reaction."
        });
    }
});


module.exports = router;
