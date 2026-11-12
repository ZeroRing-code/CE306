const jwt = require("jsonwebtoken");
const pool = require("../db");
const { restoreExpiredSuspension } = require("./suspensions");

async function optionalAuth(req, res, next) {
    const token = req.cookies?.noveltail_token;
    if (!token) {
        return next();
    }

    let payload;
    try {
        payload = jwt.verify(token, process.env.JWT_SECRET);
    } catch {
        return next();
    }

    try {
        await restoreExpiredSuspension(payload.sub);
        const result = await pool.query(
            `SELECT user_id, username, is_admin, account_status
             FROM users
             WHERE user_id = $1`,
            [payload.sub]
        );
        if (result.rowCount && result.rows[0].account_status === "active") {
            req.user = result.rows[0];
        }
        return next();
    } catch (error) {
        return next(error);
    }
}

module.exports = optionalAuth;
