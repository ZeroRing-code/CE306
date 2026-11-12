
const express = require("express");
const pool = require("../db");
const requireAuth = require("../middleware/auth");

const router = express.Router();

const MAX_BIO_LENGTH = 500;
const MAX_AVATAR_URL_LENGTH = 2048;


// =====================================
// HELPER: validate avatar URL.
// =====================================

function validateAvatarUrl(value) {
    if (value === null || value === undefined || value === "") {
        return {
            valid: true,
            value: null
        };
    }

    if (typeof value !== "string") {
        return {
            valid: false,
            value: null
        };
    }

    const avatarUrl = value.trim();

    if (!avatarUrl) {
        return {
            valid: true,
            value: null
        };
    }

    if (avatarUrl.length > MAX_AVATAR_URL_LENGTH) {
        return {
            valid: false,
            value: null
        };
    }

    // Allow same-site paths such as /uploads/avatar.png.
    if (
        avatarUrl.startsWith("/") &&
        !avatarUrl.startsWith("//") &&
        !avatarUrl.includes("\\")
    ) {
        return {
            valid: true,
            value: avatarUrl
        };
    }

    try {
        const url = new URL(avatarUrl);

        if (
            url.protocol !== "http:" &&
            url.protocol !== "https:"
        ) {
            return {
                valid: false,
                value: null
            };
        }

        return {
            valid: true,
            value: avatarUrl
        };

    } catch (error) {
        return {
            valid: false,
            value: null
        };
    }
}


// =====================================
// GET: current user's profile.
// =====================================

router.get("/me", requireAuth, async (req, res) => {
    try {
        const result = await pool.query(
            `SELECT
                user_id,
                username,
                display_name,
                bio,
                avatar_url,
                created_at,
                updated_at
             FROM users
             WHERE user_id = $1`,
            [req.user.user_id]
        );

        if (!result.rowCount) {
            return res.status(404).json({
                message: "User data not found."
            });
        }

        res.json({
            profile: result.rows[0]
        });

    } catch (error) {
        console.error("Get My Profile:", error);

        res.status(500).json({
            message: "Could not load profile."
        });
    }
});


// =====================================
// PUT: update current user's profile.
// =====================================

router.put("/me", requireAuth, async (req, res) => {
    try {
        // Load existing values so omitted fields are preserved.
        const current = await pool.query(
            `SELECT
                display_name,
                bio,
                avatar_url
             FROM users
             WHERE user_id = $1`,
            [req.user.user_id]
        );

        if (!current.rowCount) {
            return res.status(404).json({
                message: "User data not found."
            });
        }

        const oldProfile = current.rows[0];

        const displayName =
            req.body.display_name === undefined
                ? oldProfile.display_name
                : typeof req.body.display_name === "string"
                    ? req.body.display_name.trim()
                    : null;

        const bio =
            req.body.bio === undefined
                ? oldProfile.bio
                : typeof req.body.bio === "string"
                    ? req.body.bio.trim() || null
                    : req.body.bio === null
                        ? null
                        : undefined;

        const rawAvatar =
            req.body.avatar_url === undefined
                ? oldProfile.avatar_url
                : req.body.avatar_url;

        // Validate display name.
        if (
            typeof displayName !== "string" ||
            displayName.length < 1 ||
            displayName.length > 50
        ) {
            return res.status(400).json({
                message: "Display name must be 1–50 characters."
            });
        }

        // Validate bio.
        if (
            bio !== null &&
            (
                typeof bio !== "string" ||
                bio.length > MAX_BIO_LENGTH
            )
        ) {
            return res.status(400).json({
                message: `Bio must be no more than ${MAX_BIO_LENGTH} characters.`
            });
        }

        // Validate avatar URL.
        const avatar = validateAvatarUrl(rawAvatar);

        if (!avatar.valid) {
            return res.status(400).json({
                message: "Invalid profile image URL."
            });
        }

        // Save profile details.
        const result = await pool.query(
            `UPDATE users
             SET
                display_name = $1,
                bio = $2,
                avatar_url = $3,
                updated_at = CURRENT_TIMESTAMP
             WHERE user_id = $4
             RETURNING
                user_id,
                username,
                display_name,
                bio,
                avatar_url,
                created_at,
                updated_at`,
            [
                displayName,
                bio,
                avatar.value,
                req.user.user_id
            ]
        );

        res.json({
            message: "Profile updated.",
            profile: result.rows[0]
        });

    } catch (error) {
        console.error("Update Profile:", error);

        res.status(500).json({
            message: "Could not update profile."
        });
    }
});


// =====================================
// GET: another user's public profile.
// =====================================

router.get("/:username", async (req, res) => {
    const { username } = req.params;

    if (
        typeof username !== "string" ||
        username.length < 1 ||
        username.length > 30
    ) {
        return res.status(400).json({
            message: "Invalid username."
        });
    }

    try {
        // Load public profile data without exposing email or password.
        const userResult = await pool.query(
            `SELECT
                user_id,
                username,
                display_name,
                bio,
                avatar_url,
                created_at
             FROM users
             WHERE username = $1
               AND account_status = 'active'`,
            [username]
        );

        if (!userResult.rowCount) {
            return res.status(404).json({
                message: "User not found."
            });
        }

        const user = userResult.rows[0];

        // Load only novels with published chapters.
        const novelsResult = await pool.query(
            `SELECT
                n.novel_id,
                n.title,
                n.description,
                n.cover_image_url,
                n.status,
                n.view_count,
                COUNT(c.chapter_id)::int AS chapter_count,
                MAX(c.published_at) AS last_published_at
             FROM novels n

             JOIN chapters c
                ON c.novel_id = n.novel_id
               AND c.status = 'published'

             WHERE n.user_id = $1
               AND n.moderation_status = 'active'

             GROUP BY
                n.novel_id,
                n.title,
                n.description,
                n.cover_image_url,
                n.status,
                n.view_count,
                n.updated_at

             ORDER BY
                MAX(c.published_at) DESC NULLS LAST,
                n.updated_at DESC`,
            [user.user_id]
        );

        res.json({
            profile: {
                ...user,
                novel_count: novelsResult.rowCount
            },
            novels: novelsResult.rows
        });

    } catch (error) {
        console.error("Get Public Profile:", error);

        res.status(500).json({
            message: "Could not load profile."
        });
    }
});


module.exports = router;
