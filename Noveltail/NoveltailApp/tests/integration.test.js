const assert = require("node:assert/strict");
const { randomUUID } = require("node:crypto");
const { after, before, test } = require("node:test");
const pool = require("../db");
const app = require("../server");

assert.match(
    process.env.NOVELTAIL_TEST_DB || "",
    /^noveltail_test_\d+_\d+$/,
    "Tests must run against the disposable cloned database created by npm test."
);

let server;
let baseUrl;
let userSequence = 0;

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
            server.close((error) => error ? reject(error) : resolve());
        });
    }
    await pool.end();
});

async function request(path, {
    user,
    method = "GET",
    body,
    headers = {},
    csrf = "valid",
    origin = baseUrl
} = {}) {
    const requestHeaders = { ...headers };
    const unsafe = !["GET", "HEAD", "OPTIONS"].includes(method.toUpperCase());
    let csrfToken;
    if (unsafe && csrf !== "none") {
        const csrfResponse = await fetch(`${baseUrl}/api/auth/csrf`);
        csrfToken = (await csrfResponse.json()).token;
        if (csrf === "invalid") csrfToken = "invalid";
    }
    if (user?.cookie) {
        requestHeaders.Cookie = user.cookie;
    }
    if (unsafe) {
        requestHeaders.Origin = origin;
        if (csrfToken && csrf !== "none") {
            requestHeaders["X-CSRF-Token"] = csrfToken;
            const cookie = requestHeaders.Cookie
                ? `${requestHeaders.Cookie}; `
                : "";
            requestHeaders.Cookie = `${cookie}noveltail_csrf=${encodeURIComponent(csrfToken)}`;
        }
    }
    if (body !== undefined) {
        requestHeaders["Content-Type"] = "application/json";
    }

    const response = await fetch(`${baseUrl}${path}`, {
        method,
        headers: requestHeaders,
        body: body === undefined ? undefined : JSON.stringify(body)
    });
    const text = await response.text();
    let data;
    try {
        data = text ? JSON.parse(text) : null;
    } catch {
        data = text;
    }
    return { status: response.status, data, headers: response.headers };
}

async function createUser(prefix, role = "USER") {
    const suffix = `${Date.now()}${++userSequence}`;
    const username = `${prefix}_${suffix}`.slice(0, 30);
    const response = await request("/api/auth/register", {
        method: "POST",
        body: {
            username,
            display_name: `Test ${prefix}`,
            email: `${username}@example.test`,
            password: "TestPassword123!"
        }
    });
    assert.equal(response.status, 201, JSON.stringify(response.data));

    const cookieHeader = response.headers.get("set-cookie");
    assert.ok(cookieHeader, "Registration should issue the existing auth cookie.");
    const user = { ...response.data.user, cookie: cookieHeader.split(";")[0] };
    await pool.query(
        `UPDATE users SET role = $1, is_admin = $2 WHERE user_id = $3`,
        [role, role !== "USER", user.user_id]
    );
    await pool.query(
        `INSERT INTO wallets (user_id, balance)
         VALUES ($1, 0)
         ON CONFLICT (user_id) DO NOTHING`,
        [user.user_id]
    );
    return user;
}

async function createSuspension(user, admin, reason = "Test suspension") {
    await pool.query(
        `UPDATE users SET account_status = 'suspended' WHERE user_id = $1`,
        [user.user_id]
    );
    const result = await pool.query(
        `INSERT INTO account_suspensions (user_id, issued_by, reason)
         VALUES ($1, $2, $3)
         RETURNING suspension_id`,
        [user.user_id, admin.user_id, reason]
    );
    return result.rows[0].suspension_id;
}

async function balance(user) {
    const result = await pool.query(
        `SELECT balance FROM wallets WHERE user_id = $1`,
        [user.user_id]
    );
    return Number(result.rows[0].balance);
}

test("isolated integration coverage for Wallet, moderation, and Appeals", async () => {
    assert.equal((await request("/api/wallet")).status, 401);
    assert.equal((await request("/api/auth/logout", {
        method: "POST",
        csrf: "none"
    })).status, 403);
    assert.equal((await request("/api/auth/logout", {
        method: "POST",
        csrf: "invalid"
    })).status, 403);
    assert.equal((await request("/api/auth/logout", {
        method: "POST",
        origin: "https://attacker.example"
    })).status, 403);
    assert.equal((await request("/api/auth/logout", {
        method: "POST"
    })).status, 200);

    const reader = await createUser("reader");
    const author = await createUser("author");
    const admin = await createUser("admin", "ADMIN");
    const superAdmin = await createUser("super", "SUPER_ADMIN");
    const nonAdmin = await createUser("member");
    const forgedUsername = `forged_${Date.now()}_${++userSequence}`.slice(0, 30);
    const forgedRegistration = await request("/api/auth/register", {
        method: "POST",
        body: {
            username: forgedUsername,
            display_name: "Forged Role",
            email: `${forgedUsername}@example.test`,
            password: "TestPassword123!",
            role: "SUPER_ADMIN",
            is_admin: true
        }
    });
    assert.equal(forgedRegistration.status, 201);
    const forgedAccount = await pool.query(
        "SELECT role, is_admin FROM users WHERE username = $1",
        [forgedUsername]
    );
    assert.deepEqual(forgedAccount.rows[0], { role: "USER", is_admin: false });
    const profileRoleEscalation = await request("/api/profile/me", {
        user: nonAdmin,
        method: "PUT",
        body: {
            display_name: "Profile Role Test",
            role: "SUPER_ADMIN",
            is_admin: true
        }
    });
    assert.equal(profileRoleEscalation.status, 200);
    const protectedProfileRole = await pool.query(
        "SELECT role, is_admin FROM users WHERE user_id = $1",
        [nonAdmin.user_id]
    );
    assert.deepEqual(
        protectedProfileRole.rows[0],
        { role: "USER", is_admin: false }
    );
    const selfSuspension = await request(
        `/api/admin/users/${admin.user_id}/suspensions`,
        {
            user: admin,
            method: "POST",
            body: { reason: "Self suspension attempt", duration: "1" }
        }
    );
    assert.equal(selfSuspension.status, 403);
    const userSearchDenied = await request(
        `/api/admin/users?q=${encodeURIComponent(reader.username)}`,
        { user: nonAdmin }
    );
    assert.equal(userSearchDenied.status, 403);

    const accountSearch = await request(
        `/api/admin/users?q=${encodeURIComponent(reader.username)}`,
        { user: admin }
    );
    assert.equal(accountSearch.status, 200);
    assert.equal(accountSearch.data.users.length, 1);
    const allAccounts = await request(
        "/api/admin/users?role=USER",
        { user: superAdmin }
    );
    assert.equal(allAccounts.status, 200);
    assert.equal(allAccounts.data.canManageRoles, true);
    assert.ok(allAccounts.data.total >= 1);

    const roleTarget = await createUser("role_target");
    const deniedRoleChange = await request(
        `/api/admin/users/${roleTarget.user_id}/role`,
        {
            user: admin,
            method: "PATCH",
            body: { role: "ADMIN", reason: "Unauthorized role change" }
        }
    );
    assert.equal(deniedRoleChange.status, 403);
    const deniedUserRoleChange = await request(
        `/api/admin/users/${roleTarget.user_id}/role`,
        {
            user: nonAdmin,
            method: "PATCH",
            body: { role: "ADMIN", reason: "Unauthorized role change" }
        }
    );
    assert.equal(deniedUserRoleChange.status, 403);

    const superAdminPromotion = await request(
        `/api/admin/users/${roleTarget.user_id}/role`,
        {
            user: superAdmin,
            method: "PATCH",
            body: { role: "SUPER_ADMIN", reason: "Attempt a second super admin" }
        }
    );
    assert.equal(superAdminPromotion.status, 400);
    const protectedSuperAdminDemotion = await request(
        `/api/admin/users/${superAdmin.user_id}/role`,
        {
            user: superAdmin,
            method: "PATCH",
            body: { role: "USER", reason: "Attempt to demote super admin" }
        }
    );
    assert.equal(protectedSuperAdminDemotion.status, 409);

    const promotion = await request(
        `/api/admin/users/${roleTarget.user_id}/role`,
        {
            user: superAdmin,
            method: "PATCH",
            body: { role: "ADMIN", reason: "Integration role assignment" }
        }
    );
    assert.equal(promotion.status, 200, JSON.stringify(promotion.data));
    assert.equal(promotion.data.changed, true);
    assert.equal(promotion.data.user.role, "ADMIN");
    const repeatedPromotion = await request(
        `/api/admin/users/${roleTarget.user_id}/role`,
        {
            user: superAdmin,
            method: "PATCH",
            body: { role: "ADMIN", reason: "Repeated integration assignment" }
        }
    );
    assert.equal(repeatedPromotion.status, 200);
    assert.equal(repeatedPromotion.data.changed, false);

    const demotion = await request(
        `/api/admin/users/${roleTarget.user_id}/role`,
        {
            user: superAdmin,
            method: "PATCH",
            body: { role: "USER", reason: "Integration role removal" }
        }
    );
    assert.equal(demotion.status, 200, JSON.stringify(demotion.data));
    assert.equal(demotion.data.changed, true);
    const roleState = await pool.query(
        "SELECT role, is_admin FROM users WHERE user_id = $1",
        [roleTarget.user_id]
    );
    assert.deepEqual(roleState.rows[0], { role: "USER", is_admin: false });
    const roleAudit = await pool.query(
        `SELECT actor_role, action, old_values, new_values
         FROM admin_action_logs
         WHERE target_user_id = $1
           AND action IN ('admin_role_granted', 'admin_role_revoked')
         ORDER BY log_id`,
        [roleTarget.user_id]
    );
    assert.equal(roleAudit.rowCount, 2);
    assert.deepEqual(
        roleAudit.rows.map(row => [row.actor_role, row.action]),
        [
            ["SUPER_ADMIN", "admin_role_granted"],
            ["SUPER_ADMIN", "admin_role_revoked"]
        ]
    );
    assert.equal(roleAudit.rows[0].old_values.role, "USER");
    assert.equal(roleAudit.rows[0].new_values.role, "ADMIN");
    assert.equal(roleAudit.rows[1].old_values.role, "ADMIN");
    assert.equal(roleAudit.rows[1].new_values.role, "USER");

    const concurrentRoleTarget = await createUser("role_race");
    const concurrentPromotions = await Promise.all([
        request(`/api/admin/users/${concurrentRoleTarget.user_id}/role`, {
            user: superAdmin,
            method: "PATCH",
            body: { role: "ADMIN", reason: "Concurrent role assignment" }
        }),
        request(`/api/admin/users/${concurrentRoleTarget.user_id}/role`, {
            user: superAdmin,
            method: "PATCH",
            body: { role: "ADMIN", reason: "Concurrent role assignment" }
        })
    ]);
    assert.deepEqual(
        concurrentPromotions.map(result => result.status),
        [200, 200]
    );
    assert.equal(
        concurrentPromotions.filter(result => result.data.changed).length,
        1
    );
    const concurrentRoleAudit = await pool.query(
        `SELECT COUNT(*)::int AS count
         FROM admin_action_logs
         WHERE target_user_id = $1
           AND action = 'admin_role_granted'`,
        [concurrentRoleTarget.user_id]
    );
    assert.equal(concurrentRoleAudit.rows[0].count, 1);

    const permanentSuspension = await request(
        `/api/admin/users/${reader.user_id}/suspensions`,
        {
            user: admin,
            method: "POST",
            body: { reason: "Permanent test suspension", duration: "permanent" }
        }
    );
    assert.equal(permanentSuspension.status, 201, JSON.stringify(permanentSuspension.data));
    const permanentSuspensionId = permanentSuspension.data.suspension.suspension_id;
    assert.equal(permanentSuspension.data.suspension.suspended_until, null);
    assert.equal(
        (await request("/api/wallet", { user: reader })).status,
        403
    );
    const suspendedAuthCheck = await request("/api/auth/me", { user: reader });
    assert.equal(suspendedAuthCheck.status, 403);
    assert.doesNotMatch(
        suspendedAuthCheck.headers.get("set-cookie") || "",
        /noveltail_token=/
    );
    assert.equal(
        (await request("/api/appeals/me/suspensions", { user: reader })).status,
        200
    );
    const repeatedSuspension = await request(
        `/api/admin/users/${reader.user_id}/suspensions`,
        {
            user: admin,
            method: "POST",
            body: { reason: "Duplicate test suspension", duration: "7" }
        }
    );
    assert.equal(repeatedSuspension.status, 409);

    const adminCannotSuspendAdmin = await request(
        `/api/admin/users/${superAdmin.user_id}/suspensions`,
        {
            user: admin,
            method: "POST",
            body: { reason: "Role boundary test", duration: "7" }
        }
    );
    assert.equal(adminCannotSuspendAdmin.status, 403);

    const suspendedAdmin = await createUser("suspendedadmin", "ADMIN");
    const controlledAppealUser = await createUser("controlledappeal");
    const controlledSuspensionId = await createSuspension(controlledAppealUser, superAdmin);
    const controlledAppeal = await request(
        `/api/appeals/suspensions/${controlledSuspensionId}/appeals`,
        {
            user: controlledAppealUser,
            method: "POST",
            body: { appeal_text: "Appeal requiring active-admin review." }
        }
    );
    assert.equal(controlledAppeal.status, 201);
    const controlledAppealId = controlledAppeal.data.appeal.appeal_id;
    const controlledAssignment = await request(
        `/api/appeals/admin/${controlledAppealId}/assignment`,
        { user: suspendedAdmin, method: "POST", body: { reason: "Assign before suspension" } }
    );
    assert.equal(controlledAssignment.status, 200);
    const suspendAdmin = await request(
        `/api/admin/users/${suspendedAdmin.user_id}/suspensions`,
        {
            user: superAdmin,
            method: "POST",
            body: { reason: "Suspend appeal administrator", duration: "7" }
        }
    );
    assert.equal(suspendAdmin.status, 201, JSON.stringify(suspendAdmin.data));
    assert.equal((await request("/api/appeals/admin", { user: suspendedAdmin })).status, 403);
    assert.equal((await request(`/api/appeals/admin/${controlledAppealId}`, {
        user: suspendedAdmin
    })).status, 403);
    assert.equal((await request(`/api/appeals/admin/${controlledAppealId}/assignment`, {
        user: suspendedAdmin,
        method: "POST",
        body: { reason: "Suspended administrator must be denied" }
    })).status, 403);
    assert.equal((await request(`/api/appeals/admin/${controlledAppealId}`, {
        user: suspendedAdmin,
        method: "PATCH",
        body: { status: "accepted", decision_note: "Unauthorized decision" }
    })).status, 403);
    assert.equal((await request(
        `/api/admin/users/${suspendedAdmin.user_id}/suspensions/` +
            `${suspendAdmin.data.suspension.suspension_id}/restore`,
        {
            user: superAdmin,
            method: "PATCH",
            body: { reason: "Restore admin after access-control test" }
        }
    )).status, 200);

    const accountDetail = await request(`/api/admin/users/${reader.user_id}`, {
        user: admin
    });
    assert.equal(accountDetail.status, 200);
    assert.equal(accountDetail.data.user.account_status, "suspended");
    assert.equal(String(accountDetail.data.suspensions[0].suspension_id), String(permanentSuspensionId));

    const restored = await request(
        `/api/admin/users/${reader.user_id}/suspensions/${permanentSuspensionId}/restore`,
        {
            user: admin,
            method: "PATCH",
            body: { reason: "Permanent suspension cancelled for test." }
        }
    );
    assert.equal(restored.status, 200, JSON.stringify(restored.data));
    assert.equal((await request("/api/wallet", { user: reader })).status, 200);
    const repeatedRestore = await request(
        `/api/admin/users/${reader.user_id}/suspensions/${permanentSuspensionId}/restore`,
        {
            user: admin,
            method: "PATCH",
            body: { reason: "Duplicate restore attempt." }
        }
    );
    assert.equal(repeatedRestore.status, 409);

    const expirySuspension = await request(
        `/api/admin/users/${author.user_id}/suspensions`,
        {
            user: superAdmin,
            method: "POST",
            body: { reason: "Expiry workflow test", duration: "1" }
        }
    );
    assert.equal(expirySuspension.status, 201, JSON.stringify(expirySuspension.data));
    const expirySuspensionId = expirySuspension.data.suspension.suspension_id;
    await pool.query(
        `UPDATE users
         SET suspended_until = CURRENT_TIMESTAMP - INTERVAL '1 second'
         WHERE user_id = $1`,
        [author.user_id]
    );
    await pool.query(
        `UPDATE account_suspensions
         SET suspended_at = CURRENT_TIMESTAMP - INTERVAL '2 days',
             suspended_until = CURRENT_TIMESTAMP - INTERVAL '1 second'
         WHERE suspension_id = $1`,
        [expirySuspensionId]
    );
    const expiredAuthChecks = await Promise.all(
        Array.from({ length: 10 }, () => request("/api/auth/me", { user: author }))
    );
    assert.ok(expiredAuthChecks.every(response => response.status === 200));
    const expiredStatus = await pool.query(
        `SELECT account_status, suspended_until FROM users WHERE user_id = $1`,
        [author.user_id]
    );
    assert.equal(expiredStatus.rows[0].account_status, "active");
    assert.equal(expiredStatus.rows[0].suspended_until, null);
    const expiryLog = await pool.query(
        `SELECT actor_role, action FROM admin_action_logs
         WHERE target_user_id = $1 AND action = 'account_suspension_expired'`,
        [author.user_id]
    );
    assert.equal(expiryLog.rowCount, 1);
    assert.equal(expiryLog.rows[0].actor_role, "SYSTEM");
    const expiryNotification = await pool.query(
        `SELECT 1 FROM notifications
         WHERE user_id = $1 AND metadata->>'event' = 'account_suspension_expired'`,
        [author.user_id]
    );
    assert.equal(expiryNotification.rowCount, 1);

    const login = await request("/api/auth/login", {
        method: "POST",
        body: { identifier: reader.username, password: "TestPassword123!" }
    });
    assert.equal(login.status, 200, JSON.stringify(login.data));
    const authCookie = login.headers.get("set-cookie") || "";
    assert.match(authCookie, /HttpOnly/i);
    assert.match(authCookie, /SameSite=Lax/i);

    const invalidTopUp = await request("/api/wallet/top-up", {
        user: reader,
        method: "POST",
        body: { amount: 25, request_key: randomUUID() }
    });
    assert.equal(invalidTopUp.status, 400);
    assert.equal(await balance(reader), 0);

    // Wallet purchase and reversal use the existing endpoints and ledger.
    const topUpKey = randomUUID();
    const topUp = await request("/api/wallet/top-up", {
        user: reader,
        method: "POST",
        body: { amount: 50, request_key: topUpKey }
    });
    assert.equal(topUp.status, 200, JSON.stringify(topUp.data));
    assert.equal(await balance(reader), 50);
    const repeatedTopUps = await Promise.all([
        request("/api/wallet/top-up", {
            user: reader,
            method: "POST",
            body: { amount: 50, request_key: topUpKey }
        }),
        request("/api/wallet/top-up", {
            user: reader,
            method: "POST",
            body: { amount: 50, request_key: topUpKey }
        })
    ]);
    assert.deepEqual(repeatedTopUps.map(result => result.status), [200, 200]);
    assert.equal(await balance(reader), 50);

    const novelInsert = await pool.query(
        `INSERT INTO novels (user_id, title, status)
         VALUES ($1, $2, 'ongoing')
         RETURNING novel_id`,
        [author.user_id, `Integration novel ${Date.now()}`]
    );
    const novelId = novelInsert.rows[0].novel_id;
    const chapterInsert = await pool.query(
        `INSERT INTO chapters
            (novel_id, chapter_number, title, content, status,
             published_at, is_paid, price)
         VALUES ($1, 1, 'Paid test chapter', 'test content', 'published',
                 CURRENT_TIMESTAMP, TRUE, 5)
         RETURNING chapter_id`,
        [novelId]
    );
    const chapterId = chapterInsert.rows[0].chapter_id;

    const lockedReader = await request(
        `/api/novels/${novelId}/chapters/${chapterId}`
    );
    assert.equal(lockedReader.status, 402);

    const concurrentUnlocks = await Promise.all([
        request(`/api/wallet/chapters/${chapterId}/unlock`, {
            user: reader,
            method: "POST",
            body: { request_key: randomUUID() }
        }),
        request(`/api/wallet/chapters/${chapterId}/unlock`, {
            user: reader,
            method: "POST",
            body: { request_key: randomUUID() }
        })
    ]);
    assert.deepEqual(
        concurrentUnlocks.map(result => result.status),
        [200, 200]
    );
    assert.equal(await balance(reader), 45);
    assert.equal(await balance(author), 4, "Creator share should preserve the existing 90/10 split.");
    const unlockCount = await pool.query(
        `SELECT COUNT(*)::int AS count
         FROM chapter_unlocks
         WHERE user_id = $1 AND chapter_id = $2`,
        [reader.user_id, chapterId]
    );
    assert.equal(unlockCount.rows[0].count, 1);

    const purchase = await pool.query(
        `SELECT transaction_id, reference_key
         FROM wallet_transactions
         WHERE user_id = $1 AND type = 'purchase'
         ORDER BY created_at DESC LIMIT 1`,
        [reader.user_id]
    );
    assert.equal(purchase.rowCount, 1);
    const allocations = await pool.query(
        `SELECT type, amount
         FROM wallet_transactions
         WHERE reference_key = $1
           AND type IN ('creator_earning', 'platform_fee')
         ORDER BY type`,
        [purchase.rows[0].reference_key]
    );
    assert.deepEqual(
        allocations.rows.map((row) => [row.type, Number(row.amount)]),
        [["creator_earning", 4], ["platform_fee", 1]]
    );

    const unauthorizedRefund = await request("/api/wallet/admin/refunds", {
        user: nonAdmin,
        method: "POST",
        body: {
            transaction_id: purchase.rows[0].transaction_id,
            request_key: randomUUID()
        }
    });
    assert.equal(unauthorizedRefund.status, 403);

    await pool.query(
        `UPDATE wallets SET balance = 0 WHERE user_id = $1`,
        [author.user_id]
    );
    const insufficientRefund = await request("/api/wallet/admin/refunds", {
        user: admin,
        method: "POST",
        body: {
            transaction_id: purchase.rows[0].transaction_id,
            request_key: randomUUID(),
            reason: "Integration test"
        }
    });
    assert.equal(insufficientRefund.status, 409);
    assert.equal(await balance(reader), 45, "Failed reversal must leave the buyer balance unchanged.");
    await pool.query(
        `UPDATE wallets SET balance = 4 WHERE user_id = $1`,
        [author.user_id]
    );

    const concurrentRefundKeys = [randomUUID(), randomUUID()];
    const concurrentRefunds = await Promise.all(
        concurrentRefundKeys.map(requestKey =>
            request("/api/wallet/admin/refunds", {
                user: admin,
                method: "POST",
                body: {
                    transaction_id: purchase.rows[0].transaction_id,
                    request_key: requestKey,
                    reason: "Concurrent integration test refund"
                }
            })
        )
    );
    const successfulRefundIndex = concurrentRefunds.findIndex(
        result => [200, 201].includes(result.status)
    );
    assert.equal(
        successfulRefundIndex >= 0,
        true,
        JSON.stringify(concurrentRefunds.map(result => result.data))
    );
    assert.equal(
        concurrentRefunds.filter(result => result.status === 409).length,
        1,
        JSON.stringify(concurrentRefunds.map(result => result.data))
    );
    const refundKey = concurrentRefundKeys[successfulRefundIndex];
    assert.equal(await balance(reader), 50);
    assert.equal(await balance(author), 0);
    const refundCount = await pool.query(
        `SELECT COUNT(*)::int AS count
         FROM wallet_transactions
         WHERE reversal_of_transaction_id = $1`,
        [purchase.rows[0].transaction_id]
    );
    assert.equal(refundCount.rows[0].count, 1);
    const reversedAllocations = await pool.query(
        `SELECT type, SUM(amount)::int AS total
         FROM wallet_transactions
         WHERE metadata->>'reversalOfTransactionId' = $1
           AND type IN ('creator_earning', 'platform_fee')
         GROUP BY type`,
        [String(purchase.rows[0].transaction_id)]
    );
    assert.deepEqual(
        reversedAllocations.rows
            .map((row) => [row.type, Number(row.total)])
            .sort((left, right) => left[0].localeCompare(right[0])),
        [["creator_earning", -4], ["platform_fee", -1]]
    );
    const unlockRecord = await pool.query(
        `SELECT 1 FROM chapter_unlocks
         WHERE user_id = $1 AND chapter_id = $2`,
        [reader.user_id, chapterId]
    );
    assert.equal(unlockRecord.rowCount, 0, "Refund must revoke the chapter unlock.");

    const repeatedRefund = await request("/api/wallet/admin/refunds", {
        user: admin,
        method: "POST",
        body: {
            transaction_id: purchase.rows[0].transaction_id,
            request_key: refundKey,
            reason: "Integration test refund"
        }
    });
    assert.ok([200, 201].includes(repeatedRefund.status));
    assert.equal(await balance(reader), 50, "Retrying an identical refund must not duplicate credit.");

    const topUpTransaction = await pool.query(
        `SELECT transaction_id FROM wallet_transactions
         WHERE user_id = $1 AND type = 'top_up'
         ORDER BY created_at DESC LIMIT 1`,
        [reader.user_id]
    );
    const cancelKey = randomUUID();
    await pool.query(
        `UPDATE wallets SET balance = 0 WHERE user_id = $1`,
        [reader.user_id]
    );
    const insufficientCancellation = await request("/api/wallet/admin/cancellations", {
        user: admin,
        method: "POST",
        body: {
            transaction_id: topUpTransaction.rows[0].transaction_id,
            request_key: randomUUID(),
            reason: "Insufficient balance test"
        }
    });
    assert.equal(insufficientCancellation.status, 409);
    assert.equal(await balance(reader), 0);
    await pool.query(
        `UPDATE wallets SET balance = 50 WHERE user_id = $1`,
        [reader.user_id]
    );
    const cancellation = await request("/api/wallet/admin/cancellations", {
        user: admin,
        method: "POST",
        body: {
            transaction_id: topUpTransaction.rows[0].transaction_id,
            request_key: cancelKey,
            reason: "Integration test cancellation"
        }
    });
    assert.ok([200, 201].includes(cancellation.status), JSON.stringify(cancellation.data));
    assert.equal(await balance(reader), 0);
    const repeatedCancellation = await request("/api/wallet/admin/cancellations", {
        user: admin,
        method: "POST",
        body: {
            transaction_id: topUpTransaction.rows[0].transaction_id,
            request_key: cancelKey,
            reason: "Integration test cancellation"
        }
    });
    assert.ok([200, 201].includes(repeatedCancellation.status));
    assert.equal(await balance(reader), 0);
    const duplicateCancellation = await request("/api/wallet/admin/cancellations", {
        user: admin,
        method: "POST",
        body: {
            transaction_id: topUpTransaction.rows[0].transaction_id,
            request_key: randomUUID(),
            reason: "Second cancellation attempt"
        }
    });
    assert.equal(duplicateCancellation.status, 409);

    const deniedAdjustment = await request("/api/wallet/admin/adjust", {
        user: nonAdmin,
        method: "POST",
        body: {
            user_id: reader.user_id,
            operation: "credit",
            amount: 5,
            request_key: randomUUID()
        }
    });
    assert.equal(deniedAdjustment.status, 403);
    const adjustmentKey = randomUUID();
    const adjustment = await request("/api/wallet/admin/adjust", {
        user: admin,
        method: "POST",
        body: {
            user_id: reader.user_id,
            operation: "credit",
            amount: 5,
            request_key: adjustmentKey,
            reason: "Integration test"
        }
    });
    assert.equal(adjustment.status, 200, JSON.stringify(adjustment.data));
    assert.equal(await balance(reader), 5);
    const repeatedAdjustment = await request("/api/wallet/admin/adjust", {
        user: admin,
        method: "POST",
        body: {
            user_id: reader.user_id,
            operation: "credit",
            amount: 5,
            request_key: adjustmentKey,
            reason: "Integration test"
        }
    });
    assert.equal(repeatedAdjustment.status, 200);
    assert.equal(await balance(reader), 5);
    const walletNotifications = await pool.query(
        `SELECT message FROM notifications
         WHERE user_id = $1 AND category = 'transaction'`,
        [reader.user_id]
    );
    const walletMessages = walletNotifications.rows.map((row) => row.message);
    assert.ok(walletMessages.some((message) => message.includes("Coin wallet operation failed.")));
    assert.ok(walletMessages.some((message) => message.includes("Refunded 5 coins")));
    assert.ok(walletMessages.some((message) => message.includes("Cancelled a")));
    assert.ok(walletMessages.some((message) => message.includes("Noveltail Team credited")));

    // Novel moderation must be role-gated, logged, and reflected in public APIs.
    const publicNovel = await request(`/api/novels/${novelId}`);
    assert.equal(publicNovel.status, 200);
    const deniedModeration = await request(`/api/admin/novels/${novelId}/moderation`, {
        user: nonAdmin,
        method: "PATCH",
        body: { moderation_status: "suspended", reason: "Test reason" }
    });
    assert.equal(deniedModeration.status, 403);

    const suspend = await request(`/api/admin/novels/${novelId}/moderation`, {
        user: admin,
        method: "PATCH",
        body: { moderation_status: "suspended", reason: "Internal test reason" }
    });
    assert.equal(suspend.status, 200, JSON.stringify(suspend.data));
    assert.equal((await request(`/api/novels/${novelId}`)).status, 404);

    const repeatedSuspend = await request(`/api/admin/novels/${novelId}/moderation`, {
        user: admin,
        method: "PATCH",
        body: { moderation_status: "suspended", reason: "Internal test reason" }
    });
    assert.equal(repeatedSuspend.status, 200);
    assert.equal(repeatedSuspend.data.changed, false);

    const restore = await request(`/api/admin/novels/${novelId}/moderation`, {
        user: superAdmin,
        method: "PATCH",
        body: { moderation_status: "active", reason: "Restore test novel" }
    });
    assert.equal(restore.status, 200, JSON.stringify(restore.data));
    assert.equal((await request(`/api/novels/${novelId}`)).status, 200);
    const injectionSearch = await request(
        `/api/admin/novels?q=${encodeURIComponent("' OR 1=1 --")}`,
        { user: admin }
    );
    assert.equal(injectionSearch.status, 200);
    assert.equal(injectionSearch.data.novels.length, 0);

    const novelActions = await pool.query(
        `SELECT action, reason FROM admin_action_logs
         WHERE target_type = 'novel' AND target_id = $1
         ORDER BY created_at`,
        [novelId]
    );
    assert.deepEqual(
        novelActions.rows.map((row) => row.action),
        ["novel_suspended", "novel_restored"]
    );
    assert.match(novelActions.rows[0].reason, /Internal test reason/);
    const moderationNotifications = await pool.query(
        `SELECT message, metadata::text AS metadata
         FROM notifications
         WHERE user_id = $1 AND type = 'novel_status'`,
        [author.user_id]
    );
    assert.equal(moderationNotifications.rowCount, 2);
    assert.doesNotMatch(
        `${moderationNotifications.rows[0].message} ${moderationNotifications.rows[0].metadata}`,
        /Internal test reason/
    );

    // Appeals validate ownership, limits, assignment takeover, decision logging,
    // and account restoration without exposing internal notes.
    const appealUser = await createUser("appealuser");
    const appealSuspensionId = await createSuspension(appealUser, superAdmin);
    const appeal = await request(`/api/appeals/suspensions/${appealSuspensionId}/appeals`, {
        user: appealUser,
        method: "POST",
        body: { appeal_text: "Please review this test suspension." }
    });
    assert.equal(appeal.status, 201, JSON.stringify(appeal.data));
    assert.equal(appeal.data.appeal.attempt_no, 1);
    const appealId = appeal.data.appeal.appeal_id;

    const repeatedPendingAppeal = await request(
        `/api/appeals/suspensions/${appealSuspensionId}/appeals`,
        {
            user: appealUser,
            method: "POST",
            body: { appeal_text: "Duplicate pending request." }
        }
    );
    assert.equal(repeatedPendingAppeal.status, 409);
    assert.equal(
        (await request("/api/wallet", { user: appealUser })).status,
        403,
        "Suspended users may use appeals but remain blocked from ordinary authenticated APIs."
    );
    assert.equal(
        (await request("/api/appeals/admin", { user: nonAdmin })).status,
        403
    );

    const firstAssignment = await request(`/api/appeals/admin/${appealId}/assignment`, {
        user: admin,
        method: "POST",
        body: { reason: "Integration assignment" }
    });
    assert.equal(firstAssignment.status, 200, JSON.stringify(firstAssignment.data));
    const prematureTakeover = await request(`/api/appeals/admin/${appealId}/assignment`, {
        user: superAdmin,
        method: "POST",
        body: { reason: "Should not take over yet" }
    });
    assert.equal(prematureTakeover.status, 409);

    await pool.query(
        `UPDATE appeals
         SET last_progress_at = CURRENT_TIMESTAMP - INTERVAL '8 days'
         WHERE appeal_id = $1`,
        [appealId]
    );
    const takeover = await request(`/api/appeals/admin/${appealId}/assignment`, {
        user: superAdmin,
        method: "POST",
        body: { reason: "Takeover after inactivity" }
    });
    assert.equal(takeover.status, 200, JSON.stringify(takeover.data));

    const rejectedOldOwner = await request(`/api/appeals/admin/${appealId}`, {
        user: admin,
        method: "PATCH",
        body: { status: "accepted", decision_note: "Old owner cannot decide." }
    });
    assert.equal(rejectedOldOwner.status, 403);

    const accepted = await request(`/api/appeals/admin/${appealId}`, {
        user: superAdmin,
        method: "PATCH",
        body: {
            status: "accepted",
            decision_note: "Your appeal is accepted.",
            reason: "Private internal decision note"
        }
    });
    assert.equal(accepted.status, 200, JSON.stringify(accepted.data));
    assert.equal(accepted.data.accountRestored, true);
    const userStatus = await pool.query(
        `SELECT account_status FROM users WHERE user_id = $1`,
        [appealUser.user_id]
    );
    assert.equal(userStatus.rows[0].account_status, "active");
    const appealNotifications = await pool.query(
        `SELECT message, metadata::text AS metadata
         FROM notifications
         WHERE user_id = $1 AND type = 'appeal_status'`,
        [appealUser.user_id]
    );
    assert.ok(appealNotifications.rowCount >= 1);
    assert.doesNotMatch(
        appealNotifications.rows.map((row) => `${row.message} ${row.metadata}`).join(" "),
        /Private internal decision note/
    );

    const limitUser = await createUser("appeallimit");
    const limitSuspensionId = await createSuspension(limitUser, admin);
    const crossAccountAppeal = await request(
        `/api/appeals/suspensions/${limitSuspensionId}/appeals`,
        {
            user: appealUser,
            method: "POST",
            body: { appeal_text: "Attempt to submit for another account." }
        }
    );
    assert.equal(crossAccountAppeal.status, 404);
    for (let attempt = 1; attempt <= 4; attempt += 1) {
        const submission = await request(
            `/api/appeals/suspensions/${limitSuspensionId}/appeals`,
            {
                user: limitUser,
                method: "POST",
                body: { appeal_text: `Appeal attempt ${attempt}` }
            }
        );
        assert.equal(submission.status, 201, JSON.stringify(submission.data));
        assert.equal(submission.data.appeal.attempt_no, attempt);
        const currentAppealId = submission.data.appeal.appeal_id;
        const assigned = await request(
            `/api/appeals/admin/${currentAppealId}/assignment`,
            { user: admin, method: "POST", body: {} }
        );
        assert.equal(assigned.status, 200, JSON.stringify(assigned.data));
        const decision = await request(`/api/appeals/admin/${currentAppealId}`, {
            user: admin,
            method: "PATCH",
            body: {
                status: "rejected",
                decision_note: `Test rejection ${attempt}`
            }
        });
        assert.equal(decision.status, 200, JSON.stringify(decision.data));
    }
    const fifthAttempt = await request(
        `/api/appeals/suspensions/${limitSuspensionId}/appeals`,
        {
            user: limitUser,
            method: "POST",
            body: { appeal_text: "This fifth attempt must be rejected." }
        }
    );
    assert.equal(fifthAttempt.status, 409);

    const appealHistory = await request("/api/appeals/me", { user: limitUser });
    assert.equal(appealHistory.status, 200);
    assert.equal(
        appealHistory.data.appeals.filter(
            (item) => String(item.suspension_id) === String(limitSuspensionId)
        ).length,
        4
    );

    const concurrentUser = await createUser("appealrace");
    const concurrentSuspension = await createSuspension(concurrentUser, admin);
    const concurrentSubmissions = await Promise.all([
        request(`/api/appeals/suspensions/${concurrentSuspension}/appeals`, {
            user: concurrentUser,
            method: "POST",
            body: { appeal_text: "Concurrent appeal submission A." }
        }),
        request(`/api/appeals/suspensions/${concurrentSuspension}/appeals`, {
            user: concurrentUser,
            method: "POST",
            body: { appeal_text: "Concurrent appeal submission B." }
        })
    ]);
    assert.deepEqual(
        concurrentSubmissions.map((result) => result.status).sort(),
        [201, 409]
    );
    const concurrentAppealCount = await pool.query(
        `SELECT COUNT(*)::int AS count
         FROM appeals WHERE suspension_id = $1`,
        [concurrentSuspension]
    );
    assert.equal(concurrentAppealCount.rows[0].count, 1);
});
