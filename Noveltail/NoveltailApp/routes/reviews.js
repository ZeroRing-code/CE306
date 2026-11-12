
const express = require("express");
const pool = require("../db");
const requireAuth = require("../middleware/auth");
const { rateLimits } = require("../middleware/rate-limit");

const router = express.Router();

const validId = id =>
    /^\d+$/.test(String(id)) && Number(id) > 0;

const MAX_REVIEW_LENGTH = 5000;


// =====================================
// HELPER: validate novel.
// =====================================

async function findPublishedNovel(novelId) {
    const result = await pool.query(
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

    return result.rowCount > 0;
}


// =====================================
// HELPER: load one review.
// =====================================

async function getReview(reviewId) {
    const result = await pool.query(
        `SELECT
            r.review_id,
            r.user_id,
            r.novel_id,
            r.rating,
            r.review_text,
            r.created_at,
            r.updated_at,
            u.username,
            u.display_name,
            u.avatar_url
         FROM reviews r
         JOIN users u ON u.user_id = r.user_id
         WHERE r.review_id = $1`,
        [reviewId]
    );

    return result.rows[0];
}


// =====================================
// GET: load reviews for a novel.
// =====================================

router.get("/:novelId", async (req, res) => {
    const { novelId } = req.params;

    if (!validId(novelId)) {
        return res.status(400).json({
            message: "Invalid novel ID."
        });
    }

    try {
        const novelExists = await findPublishedNovel(novelId);

        if (!novelExists) {
            return res.status(404).json({
                message: "Novel not found or it has no published chapters."
            });
        }

        // Calculate the average rating and review count.
        const summary = await pool.query(
            `SELECT
                COUNT(*)::int AS total_reviews,
                COALESCE(
                    ROUND(AVG(rating)::numeric, 1),
                    0
                ) AS average_rating
             FROM reviews
             WHERE novel_id = $1`,
            [novelId]
        );

        // Load review list.
        const result = await pool.query(
            `SELECT
                r.review_id,
                r.user_id,
                r.novel_id,
                r.rating,
                r.review_text,
                r.created_at,
                r.updated_at,
                u.username,
                u.display_name,
                u.avatar_url,
                (
    SELECT COUNT(*)::int
    FROM review_reactions rr
    WHERE rr.review_id = r.review_id
      AND rr.reaction_type = 'like'
) AS like_count,

(
    SELECT COUNT(*)::int
    FROM review_reactions rr
    WHERE rr.review_id = r.review_id
      AND rr.reaction_type = 'dislike'
) AS dislike_count
             FROM reviews r
             JOIN users u ON u.user_id = r.user_id
             WHERE r.novel_id = $1
             ORDER BY r.created_at DESC, r.review_id DESC`,
            [novelId]
        );

        res.json({
            summary: {
                totalReviews: summary.rows[0].total_reviews,
                averageRating: Number(
                    summary.rows[0].average_rating
                )
            },
            reviews: result.rows
        });

    } catch (error) {
        console.error("Get Reviews:", error);

        res.status(500).json({
            message: "Could not load reviews."
        });
    }
});


// =====================================
// POST: add a new review.
// =====================================

router.post("/:novelId", requireAuth, rateLimits.reviews, async (req, res) => {
    const { novelId } = req.params;

    if (!validId(novelId)) {
        return res.status(400).json({
            message: "Invalid novel ID."
        });
    }

    const rating = Number(req.body?.rating);

    const reviewText =
        typeof req.body?.review_text === "string"
            ? req.body.review_text.trim()
            : "";

    if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
        return res.status(400).json({
            message: "Rating must be between 1 and 5 stars."
        });
    }

    if (!reviewText) {
        return res.status(400).json({
            message: "Enter a review."
        });
    }

    if (reviewText.length > MAX_REVIEW_LENGTH) {
        return res.status(400).json({
            message: `Reviews must be no more than ${MAX_REVIEW_LENGTH} characters.`
        });
    }

    try {
        const novelExists = await findPublishedNovel(novelId);

        if (!novelExists) {
            return res.status(404).json({
                message: "Novel not found or it has no published chapters."
            });
        }

        const result = await pool.query(
            `INSERT INTO reviews (
                user_id,
                novel_id,
                rating,
                review_text
             )
             VALUES ($1, $2, $3, $4)
             RETURNING review_id`,
            [
                req.user.user_id,
                novelId,
                rating,
                reviewText
            ]
        );

        const review = await getReview(
            result.rows[0].review_id
        );

        res.status(201).json({
            message: "Review added.",
            review
        });

    } catch (error) {
        // The user has already reviewed this novel.
        if (error.code === "23505") {
            return res.status(409).json({
                message: "You have already reviewed this novel. You can edit your existing review."
            });
        }

        console.error("Add Review:", error);

        res.status(500).json({
            message: "Could not add review."
        });
    }
});


// =====================================
// PUT: update the current user's review.
// =====================================

router.put("/:novelId", requireAuth, rateLimits.reviews, async (req, res) => {
    const { novelId } = req.params;

    if (!validId(novelId)) {
        return res.status(400).json({
            message: "Invalid novel ID."
        });
    }

    const rating = Number(req.body?.rating);

    const reviewText =
        typeof req.body?.review_text === "string"
            ? req.body.review_text.trim()
            : "";

    if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
        return res.status(400).json({
            message: "Rating must be between 1 and 5 stars."
        });
    }

    if (!reviewText) {
        return res.status(400).json({
            message: "Enter a review."
        });
    }

    if (reviewText.length > MAX_REVIEW_LENGTH) {
        return res.status(400).json({
            message: `Reviews must be no more than ${MAX_REVIEW_LENGTH} characters.`
        });
    }

    try {
        const novelExists = await findPublishedNovel(novelId);

        if (!novelExists) {
            return res.status(404).json({
                message: "Novel not found or it has no published chapters."
            });
        }

        const result = await pool.query(
            `UPDATE reviews
             SET
                rating = $1,
                review_text = $2,
                updated_at = CURRENT_TIMESTAMP
             WHERE novel_id = $3
               AND user_id = $4
             RETURNING review_id`,
            [
                rating,
                reviewText,
                novelId,
                req.user.user_id
            ]
        );

        if (!result.rowCount) {
            return res.status(404).json({
                message: "You have not reviewed this novel yet."
            });
        }

        const review = await getReview(
            result.rows[0].review_id
        );

        res.json({
            message: "Review updated.",
            review
        });

    } catch (error) {
        console.error("Update Review:", error);

        res.status(500).json({
            message: "Could not update review."
        });
    }
});


// =====================================
// DELETE: delete the current user's review.
// =====================================

router.delete("/:reviewId", requireAuth, rateLimits.reviews, async (req, res) => {
    const { reviewId } = req.params;

    if (!validId(reviewId)) {
        return res.status(400).json({
            message: "Invalid review ID."
        });
    }

    try {
        const result = await pool.query(
            `DELETE FROM reviews
             WHERE review_id = $1
               AND user_id = $2
             RETURNING review_id`,
            [reviewId, req.user.user_id]
        );

        if (!result.rowCount) {
            return res.status(404).json({
                message: "Review not found or you do not have permission to delete it."
            });
        }

        res.json({
            message: "Review deleted."
        });

    } catch (error) {
        console.error("Delete Review:", error);

        res.status(500).json({
            message: "Could not delete review."
        });
    }
});


module.exports = router;
