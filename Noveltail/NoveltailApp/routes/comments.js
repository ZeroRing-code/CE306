
const express = require("express");
const pool = require("../db");
const requireAuth = require("../middleware/auth");
const { createCommentNotifications } = require("./notification-helper");
const { rateLimits } = require("../middleware/rate-limit");

const router = express.Router();

const validId = id =>
    /^\d+$/.test(String(id)) && Number(id) > 0;

const MAX_COMMENT_LENGTH = 2000;


// =====================================
// GET: load chapter comments.
// =====================================

router.get("/:chapterId", async (req, res) => {
    const { chapterId } = req.params;

    if (!validId(chapterId)) {
        return res.status(400).json({
            message: "Invalid chapter ID."
        });
    }

    try {
        // Verify that the chapter is published.
        const chapter = await pool.query(
            `SELECT chapter_id
             FROM chapters c
             JOIN novels n ON n.novel_id = c.novel_id
             WHERE c.chapter_id = $1
               AND c.status = 'published'
               AND n.moderation_status = 'active'`,
            [chapterId]
        );

        if (!chapter.rowCount) {
            return res.status(404).json({
                message: "Chapter not found or not published."
            });
        }

        // Load comments with like/dislike counts and author status.
        const result = await pool.query(
            `SELECT
                c.comment_id,
                c.parent_comment_id,
                c.chapter_id,
                c.user_id,
                c.content,
                c.created_at,
                c.updated_at,
                u.username,
                u.display_name,
                u.avatar_url,

                -- Like count
                (
                    SELECT COUNT(*)::int
                    FROM comment_reactions cr
                    WHERE cr.comment_id = c.comment_id
                      AND cr.reaction_type = 'like'
                ) AS like_count,

                -- Dislike count
                (
                    SELECT COUNT(*)::int
                    FROM comment_reactions cr
                    WHERE cr.comment_id = c.comment_id
                      AND cr.reaction_type = 'dislike'
                ) AS dislike_count,

                -- Check whether this user owns the novel.
                EXISTS (
                    SELECT 1
                    FROM chapters ch
                    JOIN novels n ON n.novel_id = ch.novel_id
                    WHERE ch.chapter_id = c.chapter_id
                      AND n.user_id = c.user_id
                ) AS is_author

             FROM comments c
             JOIN users u ON u.user_id = c.user_id
             WHERE c.chapter_id = $1
             ORDER BY c.created_at ASC, c.comment_id ASC`,
            [chapterId]
        );

        res.json({
            comments: result.rows
        });

    } catch (error) {
        console.error("Get Comments:", error);

        res.status(500).json({
            message: "Could not load comments."
        });
    }
});


// =====================================
// POST: add a comment or reply.
// =====================================

router.post("/:chapterId", requireAuth, rateLimits.comments, async (req, res) => {
    const { chapterId } = req.params;

    if (!validId(chapterId)) {
        return res.status(400).json({
            message: "Invalid chapter ID."
        });
    }

    const content =
        typeof req.body?.content === "string"
            ? req.body.content.trim()
            : "";

    const parentCommentId = req.body?.parentCommentId ?? null;

    if (!content) {
        return res.status(400).json({
            message: "Enter a comment."
        });
    }

    if (content.length > MAX_COMMENT_LENGTH) {
        return res.status(400).json({
            message: `Comments must be no more than ${MAX_COMMENT_LENGTH} characters.`
        });
    }

    if (
        parentCommentId !== null &&
        !validId(parentCommentId)
    ) {
        return res.status(400).json({
            message: "Invalid reply-to comment ID."
        });
    }

    const client = await pool.connect();
    let transactionOpen = false;
    try {
        await client.query("BEGIN");
        transactionOpen = true;

        const chapter = await client.query(
            `SELECT c.chapter_id
             FROM chapters c
             JOIN novels n ON n.novel_id = c.novel_id
             WHERE c.chapter_id = $1
               AND c.status = 'published'
               AND n.moderation_status = 'active'
             FOR UPDATE OF c, n`,
            [chapterId]
        );

        if (!chapter.rowCount) {
            await client.query("ROLLBACK");
            transactionOpen = false;
            return res.status(404).json({
                message: "Chapter not found or not published."
            });
        }

        // Replies must reference a valid parent comment.
        if (parentCommentId !== null) {
            const parent = await client.query(
                `SELECT comment_id
                 FROM comments
                 WHERE comment_id = $1
                   AND chapter_id = $2
                   AND parent_comment_id IS NULL
                 FOR KEY SHARE`,
                [parentCommentId, chapterId]
            );

            if (!parent.rowCount) {
                await client.query("ROLLBACK");
                transactionOpen = false;
                return res.status(404).json({
                    message: "The parent comment to reply to was not found."
                });
            }
        }

        // Save the comment.
        const result = await client.query(
            `INSERT INTO comments (
                user_id,
                chapter_id,
                content,
                parent_comment_id
             )
             VALUES ($1, $2, $3, $4)
             RETURNING comment_id`,
            [
                req.user.user_id,
                chapterId,
                content,
                parentCommentId
            ]
        );

        // Load the newly created comment with reaction data.
        const comment = await client.query(
            `SELECT
                c.comment_id,
                c.parent_comment_id,
                c.chapter_id,
                c.user_id,
                c.content,
                c.created_at,
                c.updated_at,
                u.username,
                u.display_name,
                u.avatar_url,

                (
                    SELECT COUNT(*)::int
                    FROM comment_reactions cr
                    WHERE cr.comment_id = c.comment_id
                      AND cr.reaction_type = 'like'
                ) AS like_count,

                (
                    SELECT COUNT(*)::int
                    FROM comment_reactions cr
                    WHERE cr.comment_id = c.comment_id
                      AND cr.reaction_type = 'dislike'
                ) AS dislike_count,

                EXISTS (
                    SELECT 1
                    FROM chapters ch
                    JOIN novels n ON n.novel_id = ch.novel_id
                    WHERE ch.chapter_id = c.chapter_id
                      AND n.user_id = c.user_id
                ) AS is_author

             FROM comments c
             JOIN users u ON u.user_id = c.user_id
             WHERE c.comment_id = $1`,
            [result.rows[0].comment_id]
        );

        await createCommentNotifications(client, {
            userId: req.user.user_id,
            username: req.user.username,
            displayName: req.user.display_name,
            chapterId,
            commentId: result.rows[0].comment_id,
            parentCommentId,
            content
        });

        await client.query("COMMIT");
        transactionOpen = false;
        res.status(201).json({
            message: parentCommentId === null
                ? "Comment posted."
                : "Reply posted.",
            comment: comment.rows[0]
        });

    } catch (error) {
        if (transactionOpen) {
            await client.query("ROLLBACK");
        }
        console.error("Add Comment:", error);

        res.status(500).json({
            message: "Could not post comment."
        });
    } finally {
        client.release();
    }
});

router.put("/:commentId", requireAuth, rateLimits.comments, async (req, res) => {
    if (!validId(req.params.commentId)) {
        return res.status(400).json({ message: "Invalid comment ID." });
    }
    const content = typeof req.body?.content === "string"
        ? req.body.content.trim()
        : "";
    if (!content || content.length > MAX_COMMENT_LENGTH) {
        return res.status(400).json({
            message: content
                ? `Comments must be no more than ${MAX_COMMENT_LENGTH} characters.`
                : "Enter a comment."
        });
    }

    try {
        const result = await pool.query(
            `UPDATE comments c
             SET content = $1, updated_at = CURRENT_TIMESTAMP
             FROM chapters ch, novels n
             WHERE c.comment_id = $2
               AND c.user_id = $3
               AND ch.chapter_id = c.chapter_id
               AND ch.status = 'published'
               AND n.novel_id = ch.novel_id
               AND n.moderation_status = 'active'
             RETURNING c.comment_id, c.content, c.updated_at`,
            [content, req.params.commentId, req.user.user_id]
        );
        if (!result.rowCount) {
            return res.status(404).json({
                message: "Comment not found or you do not have permission to edit it."
            });
        }
        res.json({
            message: "Comment updated.",
            comment: result.rows[0]
        });
    } catch (error) {
        console.error("Update Comment:", error);
        res.status(500).json({ message: "Could not update comment." });
    }
});


// =====================================
// DELETE: delete the current user's comment.
// =====================================

router.delete("/:commentId", requireAuth, rateLimits.comments, async (req, res) => {
    const { commentId } = req.params;

    if (!validId(commentId)) {
        return res.status(400).json({
            message: "Invalid comment ID."
        });
    }

    try {
        const result = await pool.query(
            `DELETE FROM comments
             WHERE comment_id = $1
               AND user_id = $2
             RETURNING comment_id`,
            [commentId, req.user.user_id]
        );

        if (!result.rowCount) {
            return res.status(404).json({
                message: "Comment not found or you do not have permission to delete it."
            });
        }

        res.json({
            message: "Comment deleted."
        });

    } catch (error) {
        console.error("Delete Comment:", error);

        res.status(500).json({
            message: "Could not delete comment."
        });
    }
});


module.exports = router;
