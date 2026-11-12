const crypto = require("node:crypto");

const COOKIE_NAME = "noveltail_csrf";
const HEADER_NAME = "x-csrf-token";
const TOKEN_TTL_MS = 2 * 60 * 60 * 1000;
const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

function csrfSecret() {
    const secret = process.env.JWT_SECRET;
    if (!secret || secret.length < 32) {
        throw new Error("JWT_SECRET must contain at least 32 characters for CSRF protection.");
    }
    return secret;
}

function signature(payload) {
    return crypto
        .createHmac("sha256", csrfSecret())
        .update(payload)
        .digest("base64url");
}

function createToken(now = Date.now()) {
    const payload = `${now}.${crypto.randomBytes(32).toString("base64url")}`;
    return `${payload}.${signature(payload)}`;
}

function isValidToken(token, now = Date.now()) {
    if (typeof token !== "string") return false;
    const parts = token.split(".");
    if (parts.length !== 3 || !/^\d+$/.test(parts[0])) return false;

    const issuedAt = Number(parts[0]);
    if (!Number.isSafeInteger(issuedAt) ||
        issuedAt > now + 60_000 ||
        now - issuedAt > TOKEN_TTL_MS) {
        return false;
    }

    const payload = `${parts[0]}.${parts[1]}`;
    const expected = Buffer.from(signature(payload));
    const actual = Buffer.from(parts[2]);
    return expected.length === actual.length &&
        crypto.timingSafeEqual(expected, actual);
}

function cookieOptions() {
    return {
        httpOnly: false,
        secure: process.env.NODE_ENV === "production",
        sameSite: "lax",
        maxAge: TOKEN_TTL_MS,
        path: "/"
    };
}

function requestOrigin(req) {
    const origin = req.get("origin");
    const referer = req.get("referer");
    if (origin && origin !== "null") {
        try {
            return new URL(origin).origin;
        } catch {
            return null;
        }
    }
    if (referer) {
        try {
            return new URL(referer).origin;
        } catch {
            return null;
        }
    }
    return null;
}

function expectedOrigin(req) {
    const configuredOrigin = process.env.APP_ORIGIN;
    if (configuredOrigin) {
        try {
            return new URL(configuredOrigin).origin;
        } catch {
            throw new Error("APP_ORIGIN must be a valid absolute URL origin.");
        }
    }
    if (process.env.NODE_ENV === "production") return null;
    return `${req.protocol}://${req.get("host")}`;
}

function csrfProtection(req, res, next) {
    if (SAFE_METHODS.has(req.method)) {
        let token = req.cookies?.[COOKIE_NAME];
        if (!isValidToken(token)) {
            token = createToken();
            res.cookie(COOKIE_NAME, token, cookieOptions());
        }
        req.csrfToken = token;
        return next();
    }

    const origin = requestOrigin(req);
    const expected = expectedOrigin(req);
    if (!origin || !expected || origin !== expected) {
        return res.status(403).json({
            message: "Request origin could not be verified. Reload the page and try again."
        });
    }

    const cookieToken = req.cookies?.[COOKIE_NAME];
    const headerToken = req.get(HEADER_NAME);
    if (!isValidToken(cookieToken) ||
        !isValidToken(headerToken) ||
        cookieToken !== headerToken) {
        return res.status(403).json({
            message: "The CSRF token is invalid or expired. Reload the page and try again."
        });
    }

    return next();
}

function getCsrfToken(req, res) {
    let token = req.cookies?.[COOKIE_NAME];
    if (!isValidToken(token)) {
        token = createToken();
        res.cookie(COOKIE_NAME, token, cookieOptions());
    }
    return token;
}

module.exports = {
    COOKIE_NAME,
    createToken,
    csrfProtection,
    getCsrfToken,
    isValidToken
};
