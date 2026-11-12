const assert = require("node:assert/strict");
const { randomUUID } = require("node:crypto");
const { after, test } = require("node:test");
const express = require("express");
const pool = require("../db");
const {
    createPostgresRateLimitStore,
    createRateLimiter
} = require("../middleware/rate-limit");

assert.match(
    process.env.NOVELTAIL_TEST_DB || "",
    /^noveltail_test_\d+_\d+$/,
    "Shared-store tests must use the disposable clone created by npm test."
);

const namespace = `shared-store-test:${process.pid}:${randomUUID()}`;
const storeA = createPostgresRateLimitStore({ namespace });
const storeB = createPostgresRateLimitStore({ namespace });

after(async () => {
    await Promise.all([storeA.close(), storeB.close()]);
    await pool.end();
});

test("independent limiter instances share atomic counters and enforce 429", async () => {
    const bucket = `concurrent:${randomUUID()}`;
    const results = await Promise.all(
        Array.from({ length: 24 }, (_, index) =>
            (index % 2 ? storeA : storeB).consume(bucket, 60_000)
        )
    );
    assert.deepEqual(
        results.map(result => result.hits).sort((a, b) => a - b),
        Array.from({ length: 24 }, (_, index) => index + 1)
    );

    const app = express();
    app.get(
        "/limited",
        createRateLimiter({
            name: "cross-instance",
            limit: 5,
            windowMs: 60_000,
            key: () => bucket,
            store: storeA
        }),
        (req, res) => res.status(200).end()
    );
    app.get(
        "/limited-on-second-instance",
        createRateLimiter({
            name: "cross-instance",
            limit: 5,
            windowMs: 60_000,
            key: () => bucket,
            store: storeB
        }),
        (req, res) => res.status(200).end()
    );
    const server = app.listen(0);
    await new Promise((resolve, reject) => {
        server.once("listening", resolve);
        server.once("error", reject);
    });

    try {
        const origin = `http://127.0.0.1:${server.address().port}`;
        const responses = await Promise.all(
            Array.from({ length: 8 }, (_, index) =>
                fetch(`${origin}${index % 2
                    ? "/limited"
                    : "/limited-on-second-instance"}`)
            )
        );
        assert.equal(responses.filter(response => response.status === 200).length, 5);
        const limited = responses.filter(response => response.status === 429);
        assert.equal(limited.length, 3);
        for (const response of limited) {
            assert.ok(Number(response.headers.get("retry-after")) > 0);
        }
    } finally {
        server.closeAllConnections();
        await new Promise((resolve, reject) => {
            server.close(error => error ? reject(error) : resolve());
        });
    }
});

test("unavailable shared store fails closed without exposing internals", async () => {
    const app = express();
    app.get(
        "/limited",
        createRateLimiter({
            name: "unavailable",
            limit: 1,
            windowMs: 60_000,
            store: { consume: async () => { throw new Error("db details"); } }
        }),
        (req, res) => res.status(200).end()
    );
    const server = app.listen(0);
    await new Promise((resolve, reject) => {
        server.once("listening", resolve);
        server.once("error", reject);
    });
    const origin = `http://127.0.0.1:${server.address().port}`;
    try {
        const response = await fetch(`${origin}/limited`);
        assert.equal(response.status, 503);
        assert.deepEqual(await response.json(), {
            message: "Service temporarily unavailable."
        });
    } finally {
        server.closeAllConnections();
        await new Promise((resolve, reject) => {
            server.close(error => error ? reject(error) : resolve());
        });
    }
});
