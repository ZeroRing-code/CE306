const express = require("express");
const pool = require("../db");
const optionalAuth = require("../middleware/optional-auth");

const router = express.Router();

function validId(id) {
    return /^\d+$/.test(String(id)) && Number(id) > 0;
}


// =====================================
// GET: GENRES
// =====================================

router.get("/genres", async (req, res) => {
    try {
        const result = await pool.query(
            `SELECT genre_id, genre_name
             FROM genres
             ORDER BY genre_name`
        );

        res.json(result.rows);

    } catch (error) {
        console.error(error.message);
        res.status(500).json({
            message: "Could not load genres."
        });
    }
});


// =====================================
// GET: SEARCH NOVELS
// =====================================

router.get("/", async (req, res) => {
    try {
        const keyword = typeof req.query.q === "string"
            ? req.query.q.trim().slice(0, 100)
            : "";

        const rawGenres = typeof req.query.genres === "string"
            ? req.query.genres.trim()
            : "";

        let genreIds = [];

        if (rawGenres) {
            genreIds = rawGenres.split(",").map(Number);

            if (
                genreIds.length > 13 ||
                genreIds.some(id => !Number.isSafeInteger(id) || id <= 0)
            ) {
                return res.status(400).json({
                    message: "Invalid genre."
                });
            }

            genreIds = [...new Set(genreIds)];
        }

        const sortOptions = {
            latest: "n.created_at DESC",
            popular: "n.view_count DESC, n.created_at DESC",
            rating: "COALESCE(review_data.average_rating, 0) DESC, n.created_at DESC"
        };

        const sort = sortOptions[req.query.sort] || sortOptions.latest;

        const result = await pool.query(
            `
            SELECT
                n.novel_id,
                n.title,
                n.description,
                n.cover_image_url,
                n.status,
                n.view_count,
                n.created_at,

                u.username,
                u.display_name,
                u.avatar_url,

                chapter_data.chapter_count,

                COALESCE(review_data.average_rating, 0)::numeric(3,1)
                    AS average_rating,

                COALESCE(review_data.review_count, 0)::int
                    AS review_count,

                genre_data.genres,

                COUNT(*) OVER()::int AS total_count

            FROM novels n

            JOIN users u
                ON n.user_id = u.user_id

            LEFT JOIN LATERAL (
                SELECT COUNT(*)::int AS chapter_count
                FROM chapters c
                WHERE c.novel_id = n.novel_id
                  AND c.status = 'published'
            ) chapter_data ON TRUE

            LEFT JOIN LATERAL (
                SELECT
                    ROUND(AVG(r.rating)::numeric, 1) AS average_rating,
                    COUNT(*)::int AS review_count
                FROM reviews r
                WHERE r.novel_id = n.novel_id
            ) review_data ON TRUE

            LEFT JOIN LATERAL (
                SELECT COALESCE(
                    JSON_AGG(
                        JSON_BUILD_OBJECT(
                            'genre_id', g.genre_id,
                            'genre_name', g.genre_name
                        ) ORDER BY g.genre_name
                    ),
                    '[]'::json
                ) AS genres

                FROM novel_genres ng
                JOIN genres g ON g.genre_id = ng.genre_id
                WHERE ng.novel_id = n.novel_id
            ) genre_data ON TRUE

            WHERE n.moderation_status = 'active'
              AND EXISTS (
                SELECT 1
                FROM chapters c
                WHERE c.novel_id = n.novel_id
                  AND c.status = 'published'
            )

            AND (
                $1 = ''
                OR n.title ILIKE '%' || $1 || '%'
                OR u.username ILIKE '%' || $1 || '%'
                OR u.display_name ILIKE '%' || $1 || '%'
            )

            AND (
                CARDINALITY($2::bigint[]) = 0
                OR EXISTS (
                    SELECT 1
                    FROM novel_genres ng
                    WHERE ng.novel_id = n.novel_id
                      AND ng.genre_id = ANY($2::bigint[])
                )
            )

            ORDER BY ${sort}
            LIMIT 20
            `,
            [keyword, genreIds]
        );

        res.json({
            novels: result.rows,
            total: result.rows[0]?.total_count || 0
        });

    } catch (error) {
        console.error("Search Novels:", error.message);

        res.status(500).json({
            message: "Could not search novels."
        });
    }
});


// =====================================
// GET: NOVEL DETAIL
// =====================================

router.get("/:novelId", async (req, res) => {
    const { novelId } = req.params;

    if (!validId(novelId)) {
        return res.status(400).json({
            message: "Invalid novel ID."
        });
    }

    try {
        // Increment the view count when the detail page is opened.
        const viewed = await pool.query(
            `UPDATE novels n
             SET view_count = n.view_count + 1
             WHERE n.novel_id = $1
               AND n.moderation_status = 'active'
               AND EXISTS (
                   SELECT 1
                   FROM chapters c
                   WHERE c.novel_id = n.novel_id
                     AND c.status = 'published'
               )
             RETURNING n.novel_id`,
            [novelId]
        );

        if (!viewed.rowCount) {
            return res.status(404).json({
                message: "Novel not found or it has no published chapters."
            });
        }

        const result = await pool.query(
            `
            SELECT
                n.novel_id,
                n.title,
                n.description,
                n.cover_image_url,
                n.status,
                n.view_count,
                n.created_at,

                u.username,
                u.display_name,
                u.avatar_url,

                COALESCE(g.genres, '[]'::json) AS genres,

                COALESCE(c.chapter_count, 0) AS chapter_count,

                COALESCE(r.average_rating, 0)::numeric(3,1)
                    AS average_rating,

                COALESCE(r.review_count, 0) AS review_count

            FROM novels n

            JOIN users u ON u.user_id = n.user_id

            LEFT JOIN LATERAL (
                SELECT JSON_AGG(
                    JSON_BUILD_OBJECT(
                        'genre_id', g.genre_id,
                        'genre_name', g.genre_name
                    ) ORDER BY g.genre_name
                ) AS genres
                FROM novel_genres ng
                JOIN genres g ON g.genre_id = ng.genre_id
                WHERE ng.novel_id = n.novel_id
            ) g ON TRUE

            LEFT JOIN LATERAL (
                SELECT COUNT(*)::int AS chapter_count
                FROM chapters c
                WHERE c.novel_id = n.novel_id
                  AND c.status = 'published'
            ) c ON TRUE

            LEFT JOIN LATERAL (
                SELECT
                    ROUND(AVG(rating)::numeric, 1) AS average_rating,
                    COUNT(*)::int AS review_count
                FROM reviews
                WHERE reviews.novel_id = n.novel_id
            ) r ON TRUE

            WHERE n.novel_id = $1
              AND n.moderation_status = 'active'
            `,
            [novelId]
        );

        res.json({
            novel: result.rows[0]
        });

    } catch (error) {
        console.error("Novel Detail:", error.message);

        res.status(500).json({
            message: "Could not load novel details."
        });
    }
});


// =====================================
// GET: PUBLISHED CHAPTER LIST
// =====================================

router.get("/:novelId/chapters", async (req, res) => {
    const { novelId } = req.params;

    if (!validId(novelId)) {
        return res.status(400).json({
            message: "Invalid novel ID."
        });
    }

    try {
        const novel = await pool.query(
            `SELECT novel_id, title
             FROM novels
             WHERE novel_id = $1
               AND moderation_status = 'active'
               AND EXISTS (
                   SELECT 1
                   FROM chapters
                   WHERE chapters.novel_id = novels.novel_id
                     AND status = 'published'
               )`,
            [novelId]
        );

        if (!novel.rowCount) {
            return res.status(404).json({
                message: "Novel not found or it has no published chapters."
            });
        }

        const chapters = await pool.query(
            `SELECT
                chapter_id,
                chapter_number,
                title,
                published_at,
                is_paid,
                price
             FROM chapters
             WHERE novel_id = $1
               AND status = 'published'
               AND EXISTS (
                   SELECT 1
                   FROM novels n
                   WHERE n.novel_id = chapters.novel_id
                     AND n.moderation_status = 'active'
               )
             ORDER BY chapter_number ASC`,
            [novelId]
        );

        res.json({
            novel: novel.rows[0],
            chapters: chapters.rows
        });

    } catch (error) {
        console.error("Chapter List:", error.message);

        res.status(500).json({
            message: "Could not load chapters."
        });
    }
});


// =====================================
// GET: READ PUBLISHED CHAPTER
// =====================================

router.get("/:novelId/chapters/:chapterId", optionalAuth, async (req, res) => {
    const { novelId, chapterId } = req.params;

    if (!validId(novelId) || !validId(chapterId)) {
        return res.status(400).json({
            message: "Invalid ID."
        });
    }

    try {
        const result = await pool.query(
            `
            SELECT
                c.chapter_id,
                c.novel_id,
                c.chapter_number,
                c.title,
                c.content,
                c.published_at,
                c.is_paid,
                c.price,
                n.user_id AS author_id,

                n.title AS novel_title,
                u.username,
                u.display_name,

                EXISTS (
                    SELECT 1 FROM chapter_unlocks cu
                    WHERE cu.chapter_id = c.chapter_id
                      AND cu.user_id = $3
                ) AS already_unlocked,

                (
                    SELECT previous.chapter_id
                    FROM chapters previous
                    WHERE previous.novel_id = c.novel_id
                      AND previous.status = 'published'
                      AND previous.chapter_number < c.chapter_number
                    ORDER BY previous.chapter_number DESC
                    LIMIT 1
                ) AS previous_chapter_id,

                (
                    SELECT next_chapter.chapter_id
                    FROM chapters next_chapter
                    WHERE next_chapter.novel_id = c.novel_id
                      AND next_chapter.status = 'published'
                      AND next_chapter.chapter_number > c.chapter_number
                    ORDER BY next_chapter.chapter_number ASC
                    LIMIT 1
                ) AS next_chapter_id

            FROM chapters c

            JOIN novels n ON n.novel_id = c.novel_id
            JOIN users u ON u.user_id = n.user_id

            WHERE c.novel_id = $1
              AND c.chapter_id = $2
              AND c.status = 'published'
              AND n.moderation_status = 'active'
            `,
            [novelId, chapterId, req.user?.user_id || null]
        );

        if (!result.rowCount) {
            return res.status(404).json({
                message: "Chapter not found or not published."
            });
        }

        const chapter = result.rows[0];
        const isAuthor = req.user &&
            String(req.user.user_id) === String(chapter.author_id);
        if (chapter.is_paid && !isAuthor && !chapter.already_unlocked) {
            const wallet = req.user
                ? await pool.query(
                    `SELECT balance FROM wallets WHERE user_id = $1`,
                    [req.user.user_id]
                )
                : null;
            return res.status(402).json({
                message: "This chapter must be unlocked.",
                purchase_required: true,
                chapter: {
                    chapter_id: chapter.chapter_id,
                    novel_id: chapter.novel_id,
                    chapter_number: chapter.chapter_number,
                    title: chapter.title,
                    novel_title: chapter.novel_title,
                    author_id: chapter.author_id,
                    is_paid: true,
                    price: chapter.price
                },
                balance: wallet?.rows[0]?.balance ?? null
            });
        }

        res.json({
            chapter
        });

    } catch (error) {
        console.error("Read Chapter:", error.message);

        res.status(500).json({
            message: "Could not load chapter content."
        });
    }
});

module.exports = router;