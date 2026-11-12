
const express = require("express");
const pool = require("../db");
const requireAuth = require("../middleware/auth");

const router = express.Router();
const MAX_CHAPTER_PRICE = 2147483647;

router.use(requireAuth);

// Validate ID.
const validId = id =>
    /^\d+$/.test(String(id)) && Number(id) > 0;

// Validate genre.
async function validateGenres(client, genres) {
    if (
        !Array.isArray(genres) ||
        genres.length === 0 ||
        genres.length > 13 ||
        genres.some(id => !Number.isSafeInteger(id) || id <= 0)
    ) {
        return false;
    }

    const uniqueIds = [...new Set(genres)];

    const result = await client.query(
        `SELECT genre_id
         FROM genres
         WHERE genre_id = ANY($1::bigint[])`,
        [uniqueIds]
    );

    return result.rowCount === uniqueIds.length;
}

// Validate cover image URL.
function validateCoverUrl(value) {
    if (!value) return null;

    // Allow covers uploaded to this server.
    if (
        typeof value === "string" &&
        /^\/uploads\/covers\/[a-zA-Z0-9-]+\.(jpg|png|webp)$/i.test(value)
    ) {
        return value;
    }

    // Allow external HTTP and HTTPS URLs.
    try {
        const url = new URL(value);

        if (!["http:", "https:"].includes(url.protocol)) {
            return false;
        }

        return url.toString();

    } catch {
        return false;
    }
}


// =====================================
// GET: current user's novels.
// =====================================

router.get("/novels", async (req, res) => {
    try {
        const result = await pool.query(
            `SELECT
                n.*,
                COALESCE(g.genres, '[]'::json) AS genres,
                COALESCE(c.chapter_count, 0) AS chapter_count,
                COALESCE(c.published_count, 0) AS published_count
             FROM novels n

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
                SELECT
                    COUNT(*)::int AS chapter_count,
                    COUNT(*) FILTER (
                        WHERE status = 'published'
                    )::int AS published_count
                FROM chapters
                WHERE novel_id = n.novel_id
             ) c ON TRUE

             WHERE n.user_id = $1
             ORDER BY n.updated_at DESC`,
            [req.user.user_id]
        );

        res.json({
            novels: result.rows
        });

    } catch (error) {
        console.error("Get Novels:", error);

        res.status(500).json({
            message: "Could not load novels."
        });
    }
});


// =====================================
// POST: create a novel.
// =====================================

router.post("/novels", async (req, res) => {
    const {
        title,
        description,
        cover_image_url,
        status = "ongoing",
        genres
    } = req.body;

    if (
        typeof title !== "string" ||
        !title.trim() ||
        title.trim().length > 200
    ) {
        return res.status(400).json({
            message: "Enter a novel title of no more than 200 characters."
        });
    }

    if (
        description != null &&
        (typeof description !== "string" || description.length > 5000)
    ) {
        return res.status(400).json({
            message: "Invalid description."
        });
    }

    if (!["ongoing", "completed", "hiatus"].includes(status)) {
        return res.status(400).json({
            message: "Invalid novel status."
        });
    }

    const coverUrl = validateCoverUrl(cover_image_url);

    if (coverUrl === false) {
        return res.status(400).json({
            message: "Invalid cover image URL."
        });
    }

    const genreIds = [...new Set(Array.isArray(genres) ? genres : [])];

    const client = await pool.connect();
    let started = false;

    try {
        await client.query("BEGIN");
        started = true;

        const valid = await validateGenres(client, genreIds);

        if (!valid) {
            const error = new Error("Select at least one valid genre.");
            error.status = 400;
            throw error;
        }

        const result = await client.query(
            `INSERT INTO novels
                (user_id, title, description, cover_image_url, status)
             VALUES ($1, $2, $3, $4, $5)
             RETURNING *`,
            [
                req.user.user_id,
                title.trim(),
                description?.trim() || null,
                coverUrl,
                status
            ]
        );

        const novel = result.rows[0];

        await client.query(
            `INSERT INTO novel_genres (novel_id, genre_id)
             SELECT $1, UNNEST($2::bigint[])`,
            [novel.novel_id, genreIds]
        );

        await client.query("COMMIT");
        started = false;

        res.status(201).json({
            message: "Novel created.",
            novel
        });

    } catch (error) {
        if (started) await client.query("ROLLBACK");

        console.error("Create Novel:", error);

        res.status(error.status || 500).json({
            message: error.message || "Could not create novel."
        });

    } finally {
        client.release();
    }
});


// =====================================
// GET: details for the current user's novel.
// =====================================

router.get("/novels/:novelId", async (req, res) => {
    const { novelId } = req.params;

    if (!validId(novelId)) {
        return res.status(400).json({
            message: "Invalid novel ID."
        });
    }

    try {
        const result = await pool.query(
            `SELECT
                n.*,
                COALESCE(g.genres, '[]'::json) AS genres
             FROM novels n

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

             WHERE n.novel_id = $1
               AND n.user_id = $2`,
            [novelId, req.user.user_id]
        );

        if (!result.rowCount) {
            return res.status(404).json({
                message: "Novel not found or you do not have permission to edit it."
            });
        }

        res.json({
            novel: result.rows[0]
        });

    } catch (error) {
        console.error("Get Novel:", error);

        res.status(500).json({
            message: "Could not load novel details."
        });
    }
});


// =====================================
// PUT: update novel details.
// =====================================

router.put("/novels/:novelId", async (req, res) => {
    const { novelId } = req.params;

    const {
        title,
        description,
        cover_image_url,
        genres,
        status
    } = req.body;

    if (!validId(novelId)) {
        return res.status(400).json({
            message: "Invalid novel ID."
        });
    }

    if (
        typeof title !== "string" ||
        !title.trim() ||
        title.trim().length > 200
    ) {
        return res.status(400).json({
            message: "Enter a novel title of no more than 200 characters."
        });
    }

    if (
        description != null &&
        (typeof description !== "string" || description.length > 5000)
    ) {
        return res.status(400).json({
            message: "Invalid description."
        });
    }

    if (!["ongoing", "completed", "hiatus"].includes(status)) {
        return res.status(400).json({
            message: "Invalid novel status."
        });
    }

    const coverUrl = validateCoverUrl(cover_image_url);

    if (coverUrl === false) {
        return res.status(400).json({
            message: "Invalid cover image URL."
        });
    }

    const genreIds = [...new Set(Array.isArray(genres) ? genres : [])];

    const client = await pool.connect();
    let started = false;

    try {
        await client.query("BEGIN");
        started = true;

        const owner = await client.query(
            `SELECT novel_id
             FROM novels
             WHERE novel_id = $1 AND user_id = $2
             FOR UPDATE`,
            [novelId, req.user.user_id]
        );

        if (!owner.rowCount) {
            const error = new Error("Novel not found or you do not have permission to edit it.");
            error.status = 404;
            throw error;
        }

        const valid = await validateGenres(client, genreIds);

        if (!valid) {
            const error = new Error("Select at least one valid genre.");
            error.status = 400;
            throw error;
        }

        const result = await client.query(
            `UPDATE novels
             SET title = $1,
                 description = $2,
                 cover_image_url = $3,
                 status = $4,
                 updated_at = CURRENT_TIMESTAMP
             WHERE novel_id = $5
             RETURNING *`,
            [
                title.trim(),
                description?.trim() || null,
                coverUrl,
                status,
                novelId
            ]
        );

        await client.query(
            `DELETE FROM novel_genres
             WHERE novel_id = $1`,
            [novelId]
        );

        await client.query(
            `INSERT INTO novel_genres (novel_id, genre_id)
             SELECT $1, UNNEST($2::bigint[])`,
            [novelId, genreIds]
        );

        await client.query("COMMIT");
        started = false;

        res.json({
            message: "Novel details updated.",
            novel: result.rows[0]
        });

    } catch (error) {
        if (started) await client.query("ROLLBACK");

        console.error("Update Novel:", error);

        res.status(error.status || 500).json({
            message: error.message || "Could not update novel."
        });

    } finally {
        client.release();
    }
});


// =====================================
// DELETE: delete a novel.
// =====================================

router.delete("/novels/:novelId", async (req, res) => {
    const { novelId } = req.params;

    if (!validId(novelId)) {
        return res.status(400).json({
            message: "Invalid novel ID."
        });
    }

    try {
        const result = await pool.query(
            `DELETE FROM novels
             WHERE novel_id = $1
               AND user_id = $2
             RETURNING novel_id, title`,
            [novelId, req.user.user_id]
        );

        if (!result.rowCount) {
            return res.status(404).json({
                message: "Novel not found or you do not have permission to delete it."
            });
        }

        res.json({
            message: "Novel deleted.",
            novel: result.rows[0]
        });

    } catch (error) {
        console.error("Delete Novel:", error);

        res.status(500).json({
            message: "Could not delete novel."
        });
    }
});


// =====================================
// GET: list a novel's chapters.
// =====================================

router.get("/novels/:novelId/chapters", async (req, res) => {
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
             WHERE novel_id = $1 AND user_id = $2`,
            [novelId, req.user.user_id]
        );

        if (!novel.rowCount) {
            return res.status(404).json({
                message: "Novel not found or you do not have permission to access it."
            });
        }

        const result = await pool.query(
            `SELECT
                chapter_id,
                novel_id,
                chapter_number,
                title,
                status,
                is_paid,
                price,
                created_at,
                updated_at,
                published_at
             FROM chapters
             WHERE novel_id = $1
             ORDER BY chapter_number ASC`,
            [novelId]
        );

        res.json({
            novel: novel.rows[0],
            chapters: result.rows
        });

    } catch (error) {
        console.error("Get Chapters:", error);

        res.status(500).json({
            message: "Could not load chapter list."
        });
    }
});


// =====================================
// GET: load chapter content for editing.
// =====================================

router.get(
    "/novels/:novelId/chapters/:chapterId",
    async (req, res) => {
        const { novelId, chapterId } = req.params;

        if (!validId(novelId) || !validId(chapterId)) {
            return res.status(400).json({
                message: "Invalid ID."
            });
        }

        try {
            const result = await pool.query(
                `SELECT c.*
                 FROM chapters c
                 JOIN novels n ON n.novel_id = c.novel_id
                 WHERE c.novel_id = $1
                   AND c.chapter_id = $2
                   AND n.user_id = $3`,
                [novelId, chapterId, req.user.user_id]
            );

            if (!result.rowCount) {
                return res.status(404).json({
                    message: "Chapter not found or you do not have permission to access it."
                });
            }

            res.json({
                chapter: result.rows[0]
            });

        } catch (error) {
            console.error("Get Chapter:", error);

            res.status(500).json({
                message: "Could not load chapter content."
            });
        }
    }
);


// =====================================
// POST: add a chapter.
// The writer chooses the chapter number.
// =====================================

router.post("/novels/:novelId/chapters", async (req, res) => {
    const { novelId } = req.params;

    const {
        chapter_number,
        title,
        content,
        status = "draft",
        is_paid = false,
        price
    } = req.body;

    if (!validId(novelId)) {
        return res.status(400).json({
            message: "Invalid novel ID."
        });
    }

    if (
        !Number.isSafeInteger(chapter_number) ||
        chapter_number < 0
    ) {
        return res.status(400).json({
            message: "Chapter number must be a whole number greater than or equal to 0."
        });
    }

    if (
        typeof title !== "string" ||
        !title.trim() ||
        title.trim().length > 200
    ) {
        return res.status(400).json({
            message: "Enter a chapter title of no more than 200 characters."
        });
    }

    if (typeof content !== "string" || !content.trim()) {
        return res.status(400).json({
            message: "Enter chapter content."
        });
    }

    if (!["draft", "published"].includes(status)) {
        return res.status(400).json({
            message: "Invalid chapter status."
        });
    }

    const paid = is_paid === true;
    const chapterPrice = paid ? Number(price) : 0;
    if (
        (is_paid !== undefined && typeof is_paid !== "boolean") ||
        (paid && (
            !Number.isSafeInteger(chapterPrice) ||
            chapterPrice < 1 ||
            chapterPrice > MAX_CHAPTER_PRICE
        ))
    ) {
        return res.status(400).json({
            message: `Paid chapters must be priced from 1 to ${MAX_CHAPTER_PRICE} coins.`
        });
    }

    const client = await pool.connect();
    let started = false;

    try {
        await client.query("BEGIN");
        started = true;

        const novel = await client.query(
            `SELECT novel_id
             FROM novels
             WHERE novel_id = $1 AND user_id = $2
             FOR UPDATE`,
            [novelId, req.user.user_id]
        );

        if (!novel.rowCount) {
            const error = new Error("Novel not found or you do not have permission to write.");
            error.status = 404;
            throw error;
        }

        const publishedAt = status === "published"
            ? new Date()
            : null;

        const result = await client.query(
            `INSERT INTO chapters
                (novel_id, chapter_number, title, content,
                 status, published_at, is_paid, price)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
             RETURNING *`,
            [
                novelId,
                chapter_number,
                title.trim(),
                content,
                status,
                publishedAt,
                paid,
                chapterPrice
            ]
        );

        if (status === "published") {
            await client.query(
                `INSERT INTO notifications (
                    user_id, type, category, message, chapter_id, metadata
                 )
                 SELECT followers.user_id, 'new_chapter', 'novel',
                        $1, $2, jsonb_build_object('novelId', $3::bigint)
                 FROM (
                    SELECT f.follower_id AS user_id
                    FROM follows f
                    WHERE f.following_id = $4
                      AND f.follower_id <> $4
                    UNION
                    SELECT nf.user_id
                    FROM novel_follows nf
                    WHERE nf.novel_id = $3::bigint
                      AND nf.user_id <> $4
                 ) followers`,
                [
                    `New chapter "${title.trim()}" is available in a novel you follow.`,
                    result.rows[0].chapter_id,
                    novelId,
                    req.user.user_id
                ]
            );
        }

        await client.query(
            `UPDATE novels
             SET updated_at = CURRENT_TIMESTAMP
             WHERE novel_id = $1`,
            [novelId]
        );

        await client.query("COMMIT");
        started = false;

        res.status(201).json({
            message: "Chapter added.",
            chapter: result.rows[0]
        });

    } catch (error) {
        if (started) await client.query("ROLLBACK");

        if (error.code === "23505") {
            return res.status(409).json({
                message: "This chapter number is already in use for this novel."
            });
        }

        console.error("Create Chapter:", error);

        res.status(error.status || 500).json({
            message: error.message || "Could not add chapter."
        });

    } finally {
        client.release();
    }
});


// =====================================
// PUT: update a chapter.
// =====================================

router.put(
    "/novels/:novelId/chapters/:chapterId",
    async (req, res) => {
        const { novelId, chapterId } = req.params;

        const {
            chapter_number,
            title,
            content,
            status,
            is_paid = false,
            price
        } = req.body;

        if (!validId(novelId) || !validId(chapterId)) {
            return res.status(400).json({
                message: "Invalid ID."
            });
        }

        if (
            !Number.isSafeInteger(chapter_number) ||
            chapter_number < 0
        ) {
            return res.status(400).json({
                message: "Chapter number must be a whole number greater than or equal to 0."
            });
        }

        if (
            typeof title !== "string" ||
            !title.trim() ||
            title.trim().length > 200 ||
            typeof content !== "string" ||
            !content.trim() ||
            !["draft", "published"].includes(status)
        ) {
            return res.status(400).json({
                message: "Check the chapter details."
            });
        }

        const paid = is_paid === true;
        const chapterPrice = paid ? Number(price) : 0;
        if (
            (is_paid !== undefined && typeof is_paid !== "boolean") ||
            (paid && (
                !Number.isSafeInteger(chapterPrice) ||
                chapterPrice < 1 ||
                chapterPrice > MAX_CHAPTER_PRICE
            ))
        ) {
            return res.status(400).json({
                message: `Paid chapters must be priced from 1 to ${MAX_CHAPTER_PRICE} coins.`
            });
        }

        const client = await pool.connect();
        let started = false;
        try {
            await client.query("BEGIN");
            started = true;
            const previous = await client.query(
                `SELECT c.status
                 FROM chapters c
                 JOIN novels n ON n.novel_id = c.novel_id
                 WHERE c.novel_id = $1
                   AND c.chapter_id = $2
                   AND n.user_id = $3
                 FOR UPDATE OF c`,
                [novelId, chapterId, req.user.user_id]
            );
            if (!previous.rowCount) {
                await client.query("ROLLBACK");
                started = false;
                return res.status(404).json({
                    message: "Chapter not found or you do not have permission to edit it."
                });
            }

            const result = await client.query(
                `UPDATE chapters
                 SET chapter_number = $1,
                     title = $2,
                     content = $3,
                     is_paid = $4,
                     price = $5,
                     status = $6,
                     published_at = CASE
                         WHEN $6::varchar = 'published'
                         THEN COALESCE(published_at, CURRENT_TIMESTAMP)
                         ELSE NULL
                     END,
                     updated_at = CURRENT_TIMESTAMP
                 WHERE chapter_id = $7
                   AND novel_id = $8
                 RETURNING *`,
                [
                    chapter_number,
                    title.trim(),
                    content,
                    paid,
                    chapterPrice,
                    status,
                    chapterId,
                    novelId
                ]
            );

            if (previous.rows[0].status !== "published" && status === "published") {
                await client.query(
                    `INSERT INTO notifications (
                        user_id, type, category, message, chapter_id, metadata
                     )
                     SELECT followers.user_id, 'new_chapter', 'novel',
                            $1, $2, jsonb_build_object('novelId', $3::bigint)
                     FROM (
                        SELECT f.follower_id AS user_id
                        FROM follows f
                        WHERE f.following_id = $4
                          AND f.follower_id <> $4
                        UNION
                        SELECT nf.user_id
                        FROM novel_follows nf
                        WHERE nf.novel_id = $3::bigint
                          AND nf.user_id <> $4
                     ) followers`,
                    [
                        `New chapter "${title.trim()}" is available in a novel you follow.`,
                        chapterId,
                        novelId,
                        req.user.user_id
                    ]
                );
            }

            await client.query(
                `UPDATE novels
                 SET updated_at = CURRENT_TIMESTAMP
                 WHERE novel_id = $1`,
                [novelId]
            );
            await client.query("COMMIT");
            started = false;

            res.json({
                message: "Chapter updated.",
                chapter: result.rows[0]
            });

        } catch (error) {
            if (started) await client.query("ROLLBACK");
            if (error.code === "23505") {
                return res.status(409).json({
                    message: "This chapter number is already in use for this novel."
                });
            }

            console.error("Update Chapter:", error);

            res.status(500).json({
                message: "Could not update chapter."
            });
        } finally {
            client.release();
        }
    }
);


// =====================================
// DELETE: delete a chapter.
// =====================================

router.delete(
    "/novels/:novelId/chapters/:chapterId",
    async (req, res) => {
        const { novelId, chapterId } = req.params;

        if (!validId(novelId) || !validId(chapterId)) {
            return res.status(400).json({
                message: "Invalid ID."
            });
        }

        try {
            const result = await pool.query(
                `DELETE FROM chapters c
                 USING novels n
                 WHERE c.chapter_id = $1
                   AND c.novel_id = $2
                   AND n.novel_id = c.novel_id
                   AND n.user_id = $3
                 RETURNING c.chapter_id, c.chapter_number, c.title`,
                [chapterId, novelId, req.user.user_id]
            );

            if (!result.rowCount) {
                return res.status(404).json({
                    message: "Chapter not found or you do not have permission to delete it."
                });
            }

            await pool.query(
                `UPDATE novels
                 SET updated_at = CURRENT_TIMESTAMP
                 WHERE novel_id = $1`,
                [novelId]
            );

            res.json({
                message: "Chapter deleted.",
                chapter: result.rows[0]
            });

        } catch (error) {
            console.error("Delete Chapter:", error);

            res.status(500).json({
                message: "Could not delete chapter."
            });
        }
    }
);


module.exports = router;
