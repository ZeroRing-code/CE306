const jwt = require("jsonwebtoken");
const pool = require("../db");
const { restoreExpiredSuspension } = require("./suspensions");

async function requireAppealAuth(req, res, next) {
    const token = req.cookies?.noveltail_token;
    if (!token) {
        return res.status(401).json({ message: "Please log in." });
    }

    try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        await restoreExpiredSuspension(decoded.sub);
        const result = await pool.query(
            `SELECT user_id, username, display_name, role, is_admin,
                    account_status, suspended_until
             FROM users
             WHERE user_id = $1`,
            [decoded.sub]
        );
        if (!result.rowCount) {
            return res.status(401).json({ message: "User account not found." });
        }
        if (result.rows[0].account_status === "banned") {
            return res.status(403).json({
                message: "This account cannot submit an appeal."
            });
        }
        req.user = result.rows[0];
        next();
    } catch (error) {
        console.error("Appeal authentication error:", error);
        return res.status(401).json({
            message: "Your session has expired or is invalid. Please log in again."
        });
    }
}

module.exports = requireAppealAuth;
