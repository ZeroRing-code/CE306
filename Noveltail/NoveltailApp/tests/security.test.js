const assert = require("node:assert/strict");
const { after, before, test } = require("node:test");
const { createToken, isValidToken } = require("../middleware/csrf");
const pool = require("../db");
const app = require("../server");

assert.match(
    process.env.NOVELTAIL_TEST_DB || "",
    /^noveltail_test_\d+_\d+$/,
    "Tests must run against the disposable cloned database created by npm test."
);

let server;
let baseUrl;

before(async () => {
    server = app.listen(0);
    await new Promise((resolve, reject) => {
        server.once("listening", resolve);
        server.once("error", reject);
    });
    baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
    if (server) {
        server.closeAllConnections();
        await new Promise((resolve, reject) => {
            server.close(error => error ? reject(error) : resolve());
        });
    }
    await pool.end();
});

async function csrfToken() {
    const response = await fetch(`${baseUrl}/api/auth/csrf`);
    assert.equal(response.status, 200);
    return (await response.json()).token;
}

async function mutate(path, { token, origin = baseUrl } = {}) {
    const headers = { Origin: origin };
    if (token) {
        headers.Cookie = `noveltail_csrf=${encodeURIComponent(token)}`;
        headers["X-CSRF-Token"] = token;
    }
    const response = await fetch(`${baseUrl}${path}`, {
        method: "POST",
        headers
    });
    return { status: response.status, headers: response.headers };
}

test("CSRF origin, token presence, validity, and expiry are enforced", async () => {
    assert.equal((await mutate("/api/auth/logout")).status, 403);
    assert.equal((await mutate("/api/auth/logout", {
        origin: baseUrl
    })).status, 403);

    const token = await csrfToken();
    assert.equal((await mutate("/api/auth/logout", {
        token: "invalid-token"
    })).status, 403);
    assert.equal((await mutate("/api/auth/logout", {
        token,
        origin: "https://attacker.example"
    })).status, 403);
    assert.equal((await mutate("/api/auth/logout", { token })).status, 200);
    assert.equal(isValidToken(token), true);
    const expiredToken = createToken(Date.now() - (2 * 60 * 60 * 1000) - 1);
    assert.equal((await mutate("/api/auth/logout", {
        token: expiredToken
    })).status, 403);
    assert.equal(
        isValidToken(token, Date.now() + (2 * 60 * 60 * 1000) + 1),
        false
    );
});

test("security headers are applied to API responses", async () => {
    const response = await fetch(`${baseUrl}/api/auth/csrf`);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("x-powered-by"), null);
    assert.equal(response.headers.get("x-content-type-options"), "nosniff");
    assert.equal(response.headers.get("x-frame-options"), "DENY");
    assert.equal(
        response.headers.get("referrer-policy"),
        "strict-origin-when-cross-origin"
    );
    assert.equal(
        response.headers.get("permissions-policy"),
        "camera=(), microphone=(), geolocation=()"
    );
});

test("login rate limiter returns 429 and Retry-After after the configured threshold", async () => {
    const token = await csrfToken();
    const responses = await Promise.all(
        Array.from({ length: 12 }, (_, attempt) => fetch(`${baseUrl}/api/auth/login`, {
            method: "POST",
            headers: {
                Origin: baseUrl,
                Cookie: `noveltail_csrf=${encodeURIComponent(token)}`,
                "X-CSRF-Token": token,
                "Content-Type": "application/json"
            },
            body: JSON.stringify({
                identifier: `missing_${attempt}`,
                password: "IncorrectPassword123!"
            })
        }))
    );
    const statuses = responses.map(response => response.status);
    assert.equal(statuses.filter(status => status === 401).length, 10);
    assert.equal(statuses.filter(status => status === 429).length, 2);
    for (const response of responses.filter(item => item.status === 429)) {
        assert.ok(Number(response.headers.get("retry-after")) > 0);
        assert.deepEqual(await response.json(), {
            message: "Too many requests. Please try again later."
        });
    }
});
