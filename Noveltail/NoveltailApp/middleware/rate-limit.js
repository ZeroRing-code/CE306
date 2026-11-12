const crypto = require("node:crypto");
const pool = require("../db");

function createMemoryRateLimitStore({ maxBuckets = 10_000 } = {}) {
    const buckets = new Map();

    return {
        async consume(bucketKey, windowMs) {
            const now = Date.now();
            let bucket = buckets.get(bucketKey);
            if (!bucket || bucket.resetAt <= now) {
                if (buckets.size >= maxBuckets) {
                    const oldestKey = buckets.keys().next().value;
                    if (oldestKey !== undefined) buckets.delete(oldestKey);
                }
                bucket = { count: 0, resetAt: now + windowMs };
                buckets.set(bucketKey, bucket);
            }

            bucket.count += 1;
            return {
                hits: bucket.count,
                retryAfter: Math.max(1, Math.ceil((bucket.resetAt - now) / 1000))
            };
        }
    };
}

function createPostgresRateLimitStore({
    database = pool,
    secret = process.env.JWT_SECRET,
    namespace = process.env.RATE_LIMIT_NAMESPACE ||
        (process.env.NOVELTAIL_TEST_DB
            ? `${process.env.NOVELTAIL_TEST_DB}:${process.pid}`
            : process.env.DB_NAME || "noveltail"),
    cleanupIntervalMs = 60_000
} = {}) {
    if (!secret || Buffer.byteLength(secret, "utf8") < 32) {
        throw new Error("A 32-byte secret is required for the PostgreSQL rate-limit store.");
    }

    const cleanupTimer = setInterval(async () => {
        try {
            await database.query(
                "DELETE FROM public.rate_limit_buckets WHERE expires_at <= now()"
            );
        } catch (error) {
            console.error("Rate-limit bucket cleanup failed", {
                code: error.code || "UNKNOWN"
            });
        }
    }, cleanupIntervalMs);
    cleanupTimer.unref();

    return {
        async consume(bucketKey, windowMs) {
            const hashedKey = crypto
                .createHmac("sha256", secret)
                .update(`${namespace}\u0000${bucketKey}`)
                .digest("hex");
            const result = await database.query(
                `INSERT INTO public.rate_limit_buckets
                    (bucket_key, hits, expires_at)
                 VALUES (
                    $1,
                    1,
                    now() + ($2 * interval '1 millisecond')
                 )
                 ON CONFLICT (bucket_key) DO UPDATE
                 SET hits = CASE
                        WHEN rate_limit_buckets.expires_at <= now() THEN 1
                        ELSE rate_limit_buckets.hits + 1
                     END,
                     expires_at = CASE
                        WHEN rate_limit_buckets.expires_at <= now()
                            THEN now() + ($2 * interval '1 millisecond')
                        ELSE rate_limit_buckets.expires_at
                     END
                 RETURNING
                    hits,
                    GREATEST(
                        1,
                        CEIL(EXTRACT(EPOCH FROM (expires_at - now())))::integer
                    ) AS retry_after`,
                [hashedKey, windowMs]
            );
            return {
                hits: result.rows[0].hits,
                retryAfter: result.rows[0].retry_after
            };
        },
        async close() {
            clearInterval(cleanupTimer);
        }
    };
}

function createRateLimiter({
    name,
    limit,
    windowMs,
    key = req => req.ip,
    store = defaultStore
}) {
    if (!name || !Number.isInteger(limit) || limit < 1 ||
        !Number.isInteger(windowMs) || windowMs < 1 ||
        !store || typeof store.consume !== "function") {
        throw new TypeError("Rate limiter requires a name, positive limits, and a store.");
    }

    return async function rateLimit(req, res, next) {
        const bucketKey = `${name}:${key(req) || "unknown"}`;
        try {
            const bucket = await store.consume(bucketKey, windowMs);
            if (bucket.hits > limit) {
                res.set("Retry-After", String(bucket.retryAfter));
                return res.status(429).json({
                    message: "Too many requests. Please try again later."
                });
            }
            return next();
        } catch (error) {
            console.error("Rate-limit store unavailable", {
                code: error.code || "UNKNOWN"
            });
            return res.status(503).json({
                message: "Service temporarily unavailable."
            });
        }
    };
}

const isProduction = process.env.NODE_ENV === "production";
const usePostgresStore = process.env.RATE_LIMIT_STORE === "postgres";
const defaultStore = usePostgresStore
    ? createPostgresRateLimitStore()
    : isProduction
        ? createPostgresRateLimitStore()
        : createMemoryRateLimitStore();

const rateLimits = {
    authLogin: createRateLimiter({
        name: "auth-login",
        limit: 10,
        windowMs: 15 * 60 * 1000
    }),
    authRegister: createRateLimiter({
        name: "auth-register",
        limit: 20,
        windowMs: 60 * 60 * 1000
    }),
    comments: createRateLimiter({
        name: "comments",
        limit: 30,
        windowMs: 10 * 60 * 1000,
        key: req => req.user?.user_id || req.ip
    }),
    reviews: createRateLimiter({
        name: "reviews",
        limit: 10,
        windowMs: 60 * 60 * 1000,
        key: req => req.user?.user_id || req.ip
    }),
    appeals: createRateLimiter({
        name: "appeals",
        limit: 5,
        windowMs: 60 * 60 * 1000,
        key: req => req.user?.user_id || req.ip
    }),
    reports: createRateLimiter({
        name: "reports",
        limit: 5,
        windowMs: 60 * 60 * 1000,
        key: req => req.user?.user_id || req.ip
    }),
    admin: createRateLimiter({
        name: "admin-actions",
        limit: 120,
        windowMs: 60 * 1000,
        key: req => req.user?.user_id || req.ip
    }),
    wallet: createRateLimiter({
        name: "wallet-transactions",
        limit: 20,
        windowMs: 60 * 1000,
        key: req => req.user?.user_id || req.ip
    })
};

module.exports = {
    createMemoryRateLimitStore,
    createPostgresRateLimitStore,
    createRateLimiter,
    rateLimits
};
