const express = require("express");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const pool = require("../db");
const { restoreExpiredSuspension } = require("../middleware/suspensions");
const { getCsrfToken } = require("../middleware/csrf");
const { rateLimits } = require("../middleware/rate-limit");

const router = express.Router();

const COOKIE_NAME = "noveltail_token";

const cookieOptions = {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: 7 * 24 * 60 * 60 * 1000,
    path: "/"
};

router.get("/csrf", (req, res) => {
    res.set("Cache-Control", "no-store");
    res.json({ token: getCsrfToken(req, res) });
});

// Create the token.
function createToken(userId) {
    return jwt.sign(
        { sub: String(userId) },
        process.env.JWT_SECRET,
        { expiresIn: "7d" }
    );
}

// =================================
// REGISTER
// =================================

router.post("/register", rateLimits.authRegister, async (req, res) => {
    try {
        const { username, display_name, email, password } = req.body;

        if (!username || !email || !password) {
            return res.status(400).json({
                message: "Please complete all required fields."
            });
        }

        const cleanUsername = username.trim();
        const cleanEmail = email.trim().toLowerCase();

        if (!/^[a-zA-Z0-9_]{3,30}$/.test(cleanUsername)) {
            return res.status(400).json({
                message: "Username must be 3–30 characters and may contain only letters, numbers, and underscores."
            });
        }

        if (
            typeof password !== "string" ||
            password.length < 8 ||
            Buffer.byteLength(password, "utf8") > 72
        ) {
            return res.status(400).json({
                message: "Password must be at least 8 characters."
            });
        }

        if (
            !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)
        ) {
            return res.status(400).json({
                message: "Invalid email address."
            });
        }

        const passwordHash = await bcrypt.hash(password, 12);

        const result = await pool.query(
            `INSERT INTO users
            (username, display_name, email, password_hash)
            VALUES ($1, $2, $3, $4)
            RETURNING user_id, username, display_name, email`,
            [
                cleanUsername,
                (display_name || cleanUsername).trim(),
                cleanEmail,
                passwordHash
            ]
        );

        const user = result.rows[0];

        res.cookie(
            COOKIE_NAME,
            createToken(user.user_id),
            cookieOptions
        );

        res.status(201).json({
            message: "Registration successful.",
            user
        });

    } catch (error) {
        if (error.code === "23505") {
            return res.status(409).json({
                message: "That username or email is already in use."
            });
        }

        console.error("Register Error:", error);

        res.status(500).json({
            message: "Could not register."
        });
    }
});


// =================================
// LOGIN
// =================================

router.post("/login", rateLimits.authLogin, async (req, res) => {
    try {
        const { identifier, password } = req.body;

        if (
            typeof identifier !== "string" ||
            typeof password !== "string"
        ) {
            return res.status(400).json({
                message: "Enter your username and password."
            });
        }

        const result = await pool.query(
            `SELECT *
             FROM users
             WHERE LOWER(username) = LOWER($1)
                OR LOWER(email) = LOWER($1)
             LIMIT 1`,
            [identifier.trim()]
        );

        let user = result.rows[0];

        if (
            !user ||
            !(await bcrypt.compare(password, user.password_hash))
        ) {
            return res.status(401).json({
                message: "Incorrect username or password."
            });
        }

        await restoreExpiredSuspension(user.user_id);
        const refreshedUser = await pool.query(
            `SELECT * FROM users WHERE user_id = $1`,
            [user.user_id]
        );
        user = refreshedUser.rows[0];

        if (user.account_status !== "active") {
            if (user.account_status === "suspended") {
                res.cookie(
                    COOKIE_NAME,
                    createToken(user.user_id),
                    cookieOptions
                );
                return res.status(403).json({
                    message: "This account has been suspended.",
                    appeals_url: "/appeals.html"
                });
            }
            return res.status(403).json({
                message: "This account has been suspended."
            });
        }

        res.cookie(
            COOKIE_NAME,
            createToken(user.user_id),
            cookieOptions
        );

        res.json({
            message: "Signed in successfully.",
            user: {
                user_id: user.user_id,
                username: user.username,
                display_name: user.display_name,
                email: user.email
            }
        });

    } catch (error) {
        console.error("Login Error:", error);

        res.status(500).json({
            message: "Could not sign in."
        });
    }
});


// =================================
// CHECK LOGIN
// =================================

router.get("/me", async (req, res) => {
    let payload;
    try {
        const token = req.cookies[COOKIE_NAME];

        if (!token) {
            return res.status(401).json({
                message: "Please sign in."
            });
        }

        payload = jwt.verify(
            token,
            process.env.JWT_SECRET
        );
    } catch (error) {
        res.clearCookie(COOKIE_NAME, cookieOptions);
        return res.status(401).json({
            message: "Session expired or is invalid."
        });
    }

    try {
        await restoreExpiredSuspension(payload.sub);
        const result = await pool.query(
            `SELECT user_id, username, display_name,
                    email, bio, avatar_url, role, is_admin, account_status
             FROM users
             WHERE user_id = $1`,
            [payload.sub]
        );

        if (!result.rows.length) {
            res.clearCookie(COOKIE_NAME, cookieOptions);

            return res.status(401).json({
                message: "User account not found."
            });
        }

        if (result.rows[0].account_status !== "active") {
            if (result.rows[0].account_status === "banned") {
                res.clearCookie(COOKIE_NAME, cookieOptions);
            }
            return res.status(403).json({
                message: result.rows[0].account_status === "suspended"
                    ? "This account has been suspended."
                    : "This account is unavailable.",
                appeals_url: result.rows[0].account_status === "suspended"
                    ? "/appeals.html"
                    : undefined
            });
        }

        res.json({
            authenticated: true,
            user: result.rows[0]
        });
    } catch (error) {
        console.error("Load current user:", error);

        res.status(500).json({
            message: "Could not verify account status."
        });
    }
});


// =================================
// LOGOUT
// =================================

router.post("/logout", (req, res) => {
    res.clearCookie(COOKIE_NAME, cookieOptions);

    res.json({
        message: "Signed out successfully."
    });
});


// Export the router.
module.exports = router;