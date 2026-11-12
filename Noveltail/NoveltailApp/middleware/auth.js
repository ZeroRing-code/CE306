
const jwt = require("jsonwebtoken");
const pool = require("../db");
const { restoreExpiredSuspension } = require("./suspensions");

async function requireAuth(req, res, next) {
    let decoded;
    try {
        const token = req.cookies?.noveltail_token;

        if (!token) {
            return res.status(401).json({
                message: "Please log in."
            });
        }

        decoded = jwt.verify(
            token,
            process.env.JWT_SECRET
        );
    } catch (error) {
        console.error("Authentication token error:", error);
        return res.status(401).json({
            message: "Your session has expired or is invalid. Please log in again."
        });
    }

    try {
        await restoreExpiredSuspension(decoded.sub);
        const result = await pool.query(
            `SELECT user_id, username, display_name, email,
                    is_admin, role, account_status, suspended_until
             FROM users
             WHERE user_id = $1`,
            [decoded.sub]
        );

        if (result.rows.length === 0) {
            return res.status(401).json({
                message: "User account not found."
            });
        }

        const user = result.rows[0];

        if (user.account_status !== "active") {
            return res.status(403).json({
                message: "This account is unavailable."
            });
        }

        req.user = user;
        next();

    } catch (error) {
        console.error("Authentication account lookup error:", error);
        return res.status(500).json({
            message: "Could not verify account status."
        });
    }
}

module.exports = requireAuth;
