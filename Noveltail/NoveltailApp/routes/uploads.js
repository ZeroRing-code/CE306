
const express = require("express");
const multer = require("multer");
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");

const pool = require("../db");
const requireAuth = require("../middleware/auth");

const router = express.Router();

router.use(requireAuth);

const MAX_FILE_SIZE = 10 * 1024 * 1024;

const uploadRoot = path.join(__dirname, "..", "uploads");
const avatarDir = path.join(uploadRoot, "avatars");
const coverDir = path.join(uploadRoot, "covers");

fs.mkdirSync(avatarDir, { recursive: true });
fs.mkdirSync(coverDir, { recursive: true });

const allowedTypes = {
    "image/jpeg": ".jpg",
    "image/png": ".png",
    "image/webp": ".webp"
};

function createUploader(destination) {
    const storage = multer.diskStorage({
        destination: (req, file, callback) => {
            callback(null, destination);
        },

        filename: (req, file, callback) => {
            const extension = allowedTypes[file.mimetype];

            callback(
                null,
                `${crypto.randomUUID()}${extension}`
            );
        }
    });

    return multer({
        storage,
        limits: {
            fileSize: MAX_FILE_SIZE,
            files: 1
        },
        fileFilter: (req, file, callback) => {
            if (!allowedTypes[file.mimetype]) {
                return callback(
                    new Error("Only JPG, PNG, and WebP files are supported.")
                );
            }

            callback(null, true);
        }
    });
}

const uploadAvatar = createUploader(avatarDir);
const uploadCover = createUploader(coverDir);

async function deleteFile(filePath) {
    try {
        await fs.promises.unlink(filePath);
    } catch (error) {
        if (error.code !== "ENOENT") {
            console.error("Delete uploaded image:", error);
        }
    }
}

async function getImageMimeType(filePath) {
    const handle = await fs.promises.open(filePath, "r");

    try {
        const header = Buffer.alloc(12);
        const { bytesRead } = await handle.read(
            header,
            0,
            header.length,
            0
        );

        if (
            bytesRead >= 8 &&
            header.subarray(0, 8).equals(
                Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
            )
        ) {
            return "image/png";
        }

        if (
            bytesRead >= 3 &&
            header[0] === 0xff &&
            header[1] === 0xd8 &&
            header[2] === 0xff
        ) {
            return "image/jpeg";
        }

        if (
            bytesRead >= 12 &&
            header.toString("ascii", 0, 4) === "RIFF" &&
            header.toString("ascii", 8, 12) === "WEBP"
        ) {
            return "image/webp";
        }

        return null;

    } finally {
        await handle.close();
    }
}

async function deleteIfUnused(imageUrl) {
    const match = /^\/uploads\/(avatars|covers)\/([a-f0-9-]{36})\.(jpg|png|webp)$/i
        .exec(imageUrl || "");

    if (!match) {
        return;
    }

    try {
        const references = await pool.query(
            `SELECT EXISTS (
                SELECT 1 FROM users WHERE avatar_url = $1
                UNION ALL
                SELECT 1 FROM novels WHERE cover_image_url = $1
             ) AS in_use`,
            [imageUrl]
        );

        if (references.rows[0].in_use) {
            return;
        }

        await deleteFile(path.join(uploadRoot, match[1], path.basename(imageUrl)));

    } catch (error) {
        console.error("Remove unused image:", error);
    }
}

async function validateUploadedImage(req, res) {
    const actualType = await getImageMimeType(req.file.path);

    if (actualType !== req.file.mimetype) {
        await deleteFile(req.file.path);
        res.status(400).json({
            message: "File must be a supported JPG, PNG, or WebP image."
        });
        return false;
    }

    return true;
}


// =====================================
// POST: upload profile image.
// =====================================

router.post(
    "/avatar",
    uploadAvatar.single("image"),
    async (req, res) => {
        if (!req.file) {
            return res.status(400).json({
                message: "Select a profile image."
            });
        }

        try {
            if (!(await validateUploadedImage(req, res))) {
                return;
            }

            const previous = await pool.query(
                `SELECT avatar_url
                 FROM users
                 WHERE user_id = $1`,
                [req.user.user_id]
            );

            if (!previous.rowCount) {
                await deleteFile(req.file.path);
                return res.status(404).json({
                    message: "User data not found."
                });
            }

            const imageUrl = `/uploads/avatars/${req.file.filename}`;

            const result = await pool.query(
                `UPDATE users
                 SET avatar_url = $1,
                     updated_at = CURRENT_TIMESTAMP
                 WHERE user_id = $2
                 RETURNING avatar_url`,
                [imageUrl, req.user.user_id]
            );

            if (!result.rowCount) {
                await deleteFile(req.file.path);

                return res.status(404).json({
                    message: "User data not found."
                });
            }

            await deleteIfUnused(previous.rows[0].avatar_url);

            res.json({
                message: "Profile image uploaded.",
                avatar_url: result.rows[0].avatar_url
            });

        } catch (error) {
            await deleteFile(req.file.path);

            console.error("Upload Avatar:", error);

            res.status(500).json({
                message: "Could not upload profile image."
            });
        }
    }
);


// =====================================
// POST: upload novel cover.
// =====================================

router.post(
    "/cover/:novelId",
    (req, res, next) => {
        if (!/^\d+$/.test(String(req.params.novelId))) {
            return res.status(400).json({
                message: "Invalid novel ID."
            });
        }

        next();
    },
    uploadCover.single("image"),
    async (req, res) => {
        if (!req.file) {
            return res.status(400).json({
                message: "Select a novel cover image."
            });
        }

        try {
            if (!(await validateUploadedImage(req, res))) {
                return;
            }

            const previous = await pool.query(
                `SELECT cover_image_url
                 FROM novels
                 WHERE novel_id = $1
                   AND user_id = $2`,
                [
                    req.params.novelId,
                    req.user.user_id
                ]
            );

            if (!previous.rowCount) {
                await deleteFile(req.file.path);
                return res.status(404).json({
                    message: "Novel not found or you do not have permission to edit it."
                });
            }

            const imageUrl = `/uploads/covers/${req.file.filename}`;

            const result = await pool.query(
                `UPDATE novels
                 SET cover_image_url = $1,
                     updated_at = CURRENT_TIMESTAMP
                 WHERE novel_id = $2
                   AND user_id = $3
                 RETURNING novel_id, cover_image_url`,
                [
                    imageUrl,
                    req.params.novelId,
                    req.user.user_id
                ]
            );

            if (!result.rowCount) {
                await deleteFile(req.file.path);

                return res.status(404).json({
                    message: "Novel not found or you do not have permission to edit it."
                });
            }

            await deleteIfUnused(previous.rows[0].cover_image_url);

            res.json({
                message: "Novel cover uploaded.",
                novel: result.rows[0]
            });

        } catch (error) {
            await deleteFile(req.file.path);

            console.error("Upload Cover:", error);

            res.status(500).json({
                message: "Could not upload novel cover."
            });
        }
    }
);


// =====================================
// MULTER ERROR HANDLER
// =====================================

router.use((error, req, res, next) => {
    if (error instanceof multer.MulterError) {
        if (error.code === "LIMIT_FILE_SIZE") {
            return res.status(400).json({
                message: "Image file must be no larger than 10 MB."
            });
        }

        return res.status(400).json({
            message: "This file cannot be uploaded."
        });
    }

    if (error) {
        return res.status(400).json({
            message: error.message || "Invalid image file."
        });
    }

    next();
});

module.exports = router;
