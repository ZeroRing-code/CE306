function validateRuntimeConfig(env = process.env) {
    if (env.NODE_ENV !== "production") return true;

    const problems = [];
    const required = [
        "DB_HOST",
        "DB_NAME",
        "DB_PORT",
        "DB_USER",
        "DB_PASSWORD",
        "DB_SSL",
        "JWT_SECRET",
        "APP_ORIGIN",
        "TRUST_PROXY_HOPS"
    ];

    for (const name of required) {
        if (!env[name]?.trim()) problems.push(`${name} is required`);
    }

    if (env.DB_PORT && !isPort(env.DB_PORT)) {
        problems.push("DB_PORT must be an integer between 1 and 65535");
    }
    if (env.PORT && !isPort(env.PORT)) {
        problems.push("PORT must be an integer between 1 and 65535");
    }
    if (env.DB_POOL_MAX && !isIntegerInRange(env.DB_POOL_MAX, 1, 100)) {
        problems.push("DB_POOL_MAX must be an integer between 1 and 100");
    }
    if (env.TRUST_PROXY_HOPS &&
        !isIntegerInRange(env.TRUST_PROXY_HOPS, 0, 10)) {
        problems.push("TRUST_PROXY_HOPS must be an integer between 0 and 10");
    }
    if (env.JWT_SECRET &&
        (Buffer.byteLength(env.JWT_SECRET, "utf8") < 32 ||
            /replace|change.?me|your.?secret|default|example/i.test(env.JWT_SECRET))) {
        problems.push("JWT_SECRET must be a non-placeholder secret of at least 32 bytes");
    }
    if (env.DB_PASSWORD &&
        /replace-with|change.?me|your.?password|default|example/i.test(env.DB_PASSWORD)) {
        problems.push("DB_PASSWORD must not be a placeholder value");
    }
    if (env.DB_USER &&
        /replace-with|your.?user|example/i.test(env.DB_USER)) {
        problems.push("DB_USER must not be a placeholder value");
    }
    if (env.DB_SSL !== "true") {
        problems.push("DB_SSL must be true in production");
    }
    if (env.RATE_LIMIT_STORE !== "postgres") {
        problems.push("RATE_LIMIT_STORE must be postgres in production");
    }

    if (env.APP_ORIGIN) {
        try {
            const origin = new URL(env.APP_ORIGIN);
            if (origin.protocol !== "https:" ||
                origin.origin !== env.APP_ORIGIN.replace(/\/$/, "") ||
                origin.username ||
                origin.password) {
                problems.push("APP_ORIGIN must be an exact HTTPS origin without credentials or a path");
            }
        } catch {
            problems.push("APP_ORIGIN must be a valid absolute HTTPS origin");
        }
    }

    if (problems.length) {
        throw new Error(`Invalid production configuration: ${problems.join("; ")}`);
    }
    return true;
}

function isPort(value) {
    return isIntegerInRange(value, 1, 65_535);
}

function isIntegerInRange(value, min, max) {
    if (!/^\d+$/.test(String(value))) return false;
    const number = Number(value);
    return Number.isSafeInteger(number) && number >= min && number <= max;
}

module.exports = { validateRuntimeConfig };
