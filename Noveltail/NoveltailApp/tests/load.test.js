const assert = require("node:assert/strict");
const { randomUUID } = require("node:crypto");
const { after, before, test } = require("node:test");
const { performance } = require("node:perf_hooks");
const pool = require("../db");
const app = require("../server");

assert.match(
    process.env.NOVELTAIL_TEST_DB || "",
    /^noveltail_test_\d+_\d+$/,
    "Load tests must run against the disposable database created by npm test."
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

async function request(path, { user, method = "GET", body } = {}) {
    const headers = {};
    if (user?.cookie) headers.Cookie = user.cookie;
    const unsafe = !["GET", "HEAD", "OPTIONS"].includes(method);
    if (unsafe) {
        const csrfResponse = await fetch(`${baseUrl}/api/auth/csrf`);
        const csrf = (await csrfResponse.json()).token;
        const authCookie = user?.cookie ? `${user.cookie}; ` : "";
        headers.Cookie = `${authCookie}noveltail_csrf=${encodeURIComponent(csrf)}`;
        headers.Origin = baseUrl;
        headers["X-CSRF-Token"] = csrf;
        headers["Content-Type"] = "application/json";
    }

    const response = await fetch(`${baseUrl}${path}`, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body)
    });
    const text = await response.text();
    let data = null;
    try {
        data = text ? JSON.parse(text) : null;
    } catch {
        data = text;
    }
    return { status: response.status, data, headers: response.headers };
}

async function createUser(prefix, role = "USER") {
    const username = `${prefix}_${Date.now()}_${randomUUID().slice(0, 6)}`.slice(0, 30);
    const response = await request("/api/auth/register", {
        method: "POST",
        body: {
            username,
            display_name: prefix,
            email: `${username}@example.test`,
            password: "LoadTestPassword123!"
        }
    });
    assert.equal(response.status, 201, JSON.stringify(response.data));
    const user = response.data.user;
    const cookie = response.headers.get("set-cookie");
    assert.ok(cookie);
    user.cookie = cookie.split(";")[0];
    await pool.query(
        "UPDATE users SET role = $1, is_admin = $2 WHERE user_id = $3",
        [role, role !== "USER", user.user_id]
    );
    await pool.query(
        `INSERT INTO wallets (user_id, balance) VALUES ($1, 0)
         ON CONFLICT (user_id) DO NOTHING`,
        [user.user_id]
    );
    return user;
}

function percentile(values, ratio) {
    const ordered = [...values].sort((a, b) => a - b);
    return Number(ordered[Math.ceil(ordered.length * ratio) - 1].toFixed(2));
}

async function benchmark(endpoints, concurrency, requestsPerEndpoint) {
    const requests = endpoints.length * requestsPerEndpoint;
    const latencies = [];
    const statuses = {};
    let nextRequest = 0;
    let peakPoolTotal = 0;
    let peakPoolWaiting = 0;
    const start = performance.now();
    const memoryBefore = process.memoryUsage().heapUsed;
    const cpuBefore = process.cpuUsage();
    const sampler = setInterval(() => {
        peakPoolTotal = Math.max(peakPoolTotal, pool.totalCount);
        peakPoolWaiting = Math.max(peakPoolWaiting, pool.waitingCount);
    }, 5);

    try {
        await Promise.all(Array.from({ length: concurrency }, async () => {
            while (true) {
                const index = nextRequest;
                nextRequest += 1;
                if (index >= requests) return;
                const endpoint = endpoints[index % endpoints.length];
                const requestStart = performance.now();
                const response = await request(endpoint.path, { user: endpoint.user });
                const elapsed = performance.now() - requestStart;
                latencies.push(elapsed);
                statuses[response.status] = (statuses[response.status] || 0) + 1;
            }
        }));
    } finally {
        clearInterval(sampler);
    }

    const elapsedMs = performance.now() - start;
    const cpu = process.cpuUsage(cpuBefore);
    const cpuMicros = cpu.user + cpu.system;
    return {
        concurrency,
        requests,
        elapsedMs: Number(elapsedMs.toFixed(2)),
        throughputPerSecond: Number((requests / (elapsedMs / 1000)).toFixed(2)),
        latencyMs: {
            p50: percentile(latencies, 0.50),
            p95: percentile(latencies, 0.95),
            max: Number(Math.max(...latencies).toFixed(2))
        },
        statuses,
        cpuPercent: Number((cpuMicros / (elapsedMs * 1000) * 100).toFixed(2)),
        heapDeltaBytes: process.memoryUsage().heapUsed - memoryBefore,
        pool: {
            peakTotal: peakPoolTotal,
            peakWaiting: peakPoolWaiting,
            totalAfter: pool.totalCount,
            idleAfter: pool.idleCount,
            waitingAfter: pool.waitingCount
        }
    };
}

test("bounded load profiles and concurrent Wallet integrity", async () => {
    const author = await createUser("load_author");
    const reader = await createUser("load_reader");
    const admin = await createUser("load_admin", "ADMIN");
    const novelInsert = await pool.query(
        `INSERT INTO novels (user_id, title, description)
         VALUES ($1, 'Load test novel', 'Disposable load fixture')
         RETURNING novel_id`,
        [author.user_id]
    );
    const novelId = novelInsert.rows[0].novel_id;
    const chapterInsert = await pool.query(
        `INSERT INTO chapters (
            novel_id, chapter_number, title, content, status, published_at,
            is_paid, price
         )
         VALUES ($1, 1, 'Load test chapter', 'Load test content',
                 'published', CURRENT_TIMESTAMP, TRUE, 5)
         RETURNING chapter_id`,
        [novelId]
    );
    const chapterId = chapterInsert.rows[0].chapter_id;

    const endpoints = [
        { path: "/", user: null },
        { path: "/api/novels", user: null },
        { path: `/api/novels/${novelId}`, user: null },
        { path: `/api/novels/${novelId}/chapters`, user: null },
        { path: `/api/comments/${chapterId}`, user: null },
        { path: `/api/reviews/${novelId}`, user: null },
        { path: `/api/wallet`, user: reader },
        { path: `/api/notifications/unread-count`, user: reader },
        { path: `/api/admin/users?q=load`, user: admin }
    ];
    const profiles = [];
    for (const concurrency of [1, 5, 10]) {
        const result = await benchmark(endpoints, concurrency, 8);
        assert.equal(
            Object.entries(result.statuses)
                .filter(([status]) => status !== "200")
                .reduce((count, [, value]) => count + value, 0),
            0,
            JSON.stringify(result.statuses)
        );
        profiles.push(result);
    }
    console.log("LOAD_PROFILE_RESULTS", JSON.stringify(profiles));

    const topUpKey = randomUUID();
    const topUps = await Promise.all(
        Array.from({ length: 10 }, () =>
            request("/api/wallet/top-up", {
                user: reader,
                method: "POST",
                body: { amount: 50, request_key: topUpKey }
            })
        )
    );
    assert.ok(topUps.every(result => result.status === 200));

    const unlocks = await Promise.all(
        Array.from({ length: 10 }, () =>
            request(`/api/wallet/chapters/${chapterId}/unlock`, {
                user: reader,
                method: "POST",
                body: { request_key: randomUUID() }
            })
        )
    );
    assert.ok(unlocks.every(result => result.status === 200));

    const purchase = await pool.query(
        `SELECT transaction_id FROM wallet_transactions
         WHERE user_id = $1 AND type = 'purchase'`,
        [reader.user_id]
    );
    assert.equal(purchase.rowCount, 1);
    const refundResults = await Promise.all(
        Array.from({ length: 2 }, () =>
            request("/api/wallet/admin/refunds", {
                user: admin,
                method: "POST",
                body: {
                    transaction_id: purchase.rows[0].transaction_id,
                    request_key: randomUUID(),
                    reason: "Disposable concurrent load test"
                }
            })
        )
    );
    assert.equal(
        refundResults.filter(result => [200, 201].includes(result.status)).length,
        1
    );
    assert.equal(refundResults.filter(result => result.status === 409).length, 1);

    const integrity = await pool.query(
        `SELECT
            (SELECT balance FROM wallets WHERE user_id = $1) AS reader_balance,
            (SELECT balance FROM wallets WHERE user_id = $2) AS author_balance,
            (SELECT COUNT(*)::int FROM wallet_transactions
             WHERE user_id = $1 AND type = 'top_up') AS top_up_count,
            (SELECT COUNT(*)::int FROM wallet_transactions
             WHERE user_id = $1 AND type = 'purchase') AS purchase_count,
            (SELECT COUNT(*)::int FROM wallet_transactions
             WHERE reversal_of_transaction_id = $3) AS refund_count,
            (SELECT COUNT(*)::int FROM chapter_unlocks
             WHERE user_id = $1 AND chapter_id = $4) AS unlock_count,
            (SELECT COUNT(*)::int FROM wallets WHERE balance < 0) AS negative_wallets`,
        [reader.user_id, author.user_id, purchase.rows[0].transaction_id, chapterId]
    );
    assert.deepEqual(
        Object.values(integrity.rows[0]).map(Number),
        [50, 0, 1, 1, 1, 0, 0]
    );
    const allocation = await pool.query(
        `SELECT type, amount FROM wallet_transactions
         WHERE reference_key = (
             SELECT reference_key FROM wallet_transactions
             WHERE transaction_id = $1
         ) AND type IN ('creator_earning', 'platform_fee')
         ORDER BY type`,
        [purchase.rows[0].transaction_id]
    );
    assert.deepEqual(
        allocation.rows.map(row => [row.type, Number(row.amount)]),
        [["creator_earning", 4], ["platform_fee", 1]]
    );
});
