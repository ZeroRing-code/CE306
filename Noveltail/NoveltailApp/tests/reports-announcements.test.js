const assert = require("node:assert/strict");
const { before, after, test } = require("node:test");
const pool = require("../db");
const app = require("../server");

assert.match(
    process.env.NOVELTAIL_TEST_DB || "",
    /^noveltail_test_\d+_\d+$/,
    "Tests must run against the disposable database created by npm test."
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
            server.close(error => error ? reject(error) : resolve());
        });
    }
    await pool.end();
});

async function request(path, { user, method = "GET", body } = {}) {
    const headers = {};
    if (user?.cookie) headers.Cookie = user.cookie;
    if (!["GET", "HEAD", "OPTIONS"].includes(method)) {
        const csrfResponse = await fetch(`${baseUrl}/api/auth/csrf`);
        const { token } = await csrfResponse.json();
        headers.Origin = baseUrl;
        headers["X-CSRF-Token"] = token;
        headers.Cookie = [headers.Cookie, `noveltail_csrf=${encodeURIComponent(token)}`]
            .filter(Boolean).join("; ");
    }
    if (body !== undefined) headers["Content-Type"] = "application/json";
    const response = await fetch(`${baseUrl}${path}`, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body)
    });
    const text = await response.text();
    return {
        status: response.status,
        data: text ? JSON.parse(text) : null,
        headers: response.headers
    };
}

async function createUser(prefix, role = "USER") {
    const suffix = `${Date.now()}_${++userSequence}`;
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
    const cookie = response.headers.get("set-cookie").split(";")[0];
    const user = { ...response.data.user, cookie };
    await pool.query(
        "UPDATE users SET role = $1, is_admin = $2 WHERE user_id = $3",
        [role, role !== "USER", user.user_id]
    );
    return user;
}

async function createContent(owner) {
    const novel = await pool.query(
        `INSERT INTO novels (user_id, title, description)
         VALUES ($1, $2, 'Report target')
         RETURNING novel_id`,
        [owner.user_id, `Report target ${Date.now()}_${userSequence}`]
    );
    const chapter = await pool.query(
        `INSERT INTO chapters (
             novel_id, chapter_number, title, content, status, published_at
         )
         VALUES ($1, 1, 'Target chapter', 'Chapter content', 'published', CURRENT_TIMESTAMP)
         RETURNING chapter_id`,
        [novel.rows[0].novel_id]
    );
    const comment = await pool.query(
        `INSERT INTO comments (user_id, chapter_id, content)
         VALUES ($1, $2, 'Report target comment')
         RETURNING comment_id`,
        [owner.user_id, chapter.rows[0].chapter_id]
    );
    return {
        novelId: String(novel.rows[0].novel_id),
        chapterId: String(chapter.rows[0].chapter_id),
        commentId: String(comment.rows[0].comment_id)
    };
}

test("Reports enforce ownership, target validation, duplicate prevention, and audited admin decisions", async () => {
    const reporter = await createUser("reporter");
    const otherUser = await createUser("reportother");
    const owner = await createUser("reportowner");
    const admin = await createUser("reportadmin", "ADMIN");
    const superAdmin = await createUser("reportsuper", "SUPER_ADMIN");
    const targets = await createContent(owner);

    assert.equal(
        (await request(`/api/reports/target?type=novel&id=${targets.novelId}`)).status,
        401
    );
    const novelTarget = await request(
        `/api/reports/target?type=novel&id=${targets.novelId}`,
        { user: reporter }
    );
    assert.equal(novelTarget.status, 200);
    assert.equal(novelTarget.data.target.novel_title.startsWith("Report target"), true);

    const novelReport = await request("/api/reports", {
        user: reporter,
        method: "POST",
        body: {
            target_token: novelTarget.data.target_token,
            target_type: "comment",
            target_id: "99999999",
            report_id: "99999999",
            target_snapshot: { target_type: "comment", comment_content: "forged" },
            reason: "spam",
            details: "Repeated promotional content"
        }
    });
    assert.equal(novelReport.status, 201, JSON.stringify(novelReport.data));
    const reportId = String(novelReport.data.report.report_id);
    assert.notEqual(reportId, "99999999");
    assert.equal(novelReport.data.report.target_type, "novel");
    assert.equal(
        novelReport.data.report.target_snapshot.novel_title,
        novelTarget.data.target.novel_title
    );
    assert.notEqual(
        JSON.stringify(novelReport.data.report.target_snapshot),
        JSON.stringify({ target_type: "comment", comment_content: "forged" })
    );
    const storedReport = await pool.query(
        "SELECT target_novel_id, target_comment_id, target_snapshot FROM reports WHERE report_id = $1",
        [reportId]
    );
    assert.equal(String(storedReport.rows[0].target_novel_id), targets.novelId);
    assert.equal(storedReport.rows[0].target_comment_id, null);
    assert.equal(
        storedReport.rows[0].target_snapshot.novel_title,
        novelTarget.data.target.novel_title
    );

    const duplicate = await request("/api/reports", {
        user: reporter,
        method: "POST",
        body: {
            target_token: novelTarget.data.target_token,
            reason: "other",
            details: "A second report for this novel"
        }
    });
    assert.equal(duplicate.status, 409);

    const chapterTarget = await request(
        `/api/reports/target?type=chapter&id=${targets.chapterId}`,
        { user: reporter }
    );
    assert.equal(chapterTarget.status, 200);
    assert.equal(chapterTarget.data.target.chapter_title, "Target chapter");
    const chapterReport = await request("/api/reports", {
        user: reporter,
        method: "POST",
        body: {
            target_token: chapterTarget.data.target_token,
            reason: "copyright",
            details: "This chapter appears to reproduce protected text."
        }
    });
    assert.equal(chapterReport.status, 201, JSON.stringify(chapterReport.data));
    assert.equal(chapterReport.data.report.target_snapshot.chapter_number, 1);
    const commentTarget = await request(
        `/api/reports/target?type=comment&id=${targets.commentId}`,
        { user: reporter }
    );
    assert.equal(commentTarget.status, 200);
    assert.equal(commentTarget.data.target.comment_content, "Report target comment");
    assert.equal(commentTarget.data.target.comment_author, owner.display_name);
    const commentReport = await request("/api/reports", {
        user: reporter,
        method: "POST",
        body: {
            target_token: commentTarget.data.target_token,
            reason: "harassment",
            details: "This comment appears to target another user."
        }
    });
    assert.equal(commentReport.status, 201, JSON.stringify(commentReport.data));

    const missingNovel = await request(
        "/api/reports/target?type=novel&id=99999999",
        { user: reporter }
    );
    assert.equal(missingNovel.status, 404);
    const invalidType = await request("/api/reports", {
        user: otherUser,
        method: "POST",
        body: {
            target_token: "invalid-token",
            reason: "other",
            details: "A sufficiently long reason."
        }
    });
    assert.equal(invalidType.status, 400);
    const reporterBoundToken = novelTarget.data.target_token;
    const tamperedToken = `${reporterBoundToken[0] === "A" ? "B" : "A"}${
        reporterBoundToken.slice(1)
    }`;
    const tamperedReport = await request("/api/reports", {
        user: reporter,
        method: "POST",
        body: {
            target_token: tamperedToken,
            reason: "other",
            details: "A tampered target token must be rejected."
        }
    });
    assert.equal(tamperedReport.status, 400);
    const userMismatch = await request("/api/reports", {
        user: otherUser,
        method: "POST",
        body: {
            target_token: reporterBoundToken,
            reason: "other",
            details: "A target token cannot be used by another account."
        }
    });
    assert.equal(userMismatch.status, 400);
    const otherNovelTarget = await request(
        `/api/reports/target?type=novel&id=${targets.novelId}`,
        { user: otherUser }
    );
    const shortReason = await request("/api/reports", {
        user: otherUser,
        method: "POST",
        body: {
            target_token: otherNovelTarget.data.target_token,
            reason: "other",
            details: "short"
        }
    });
    assert.equal(shortReason.status, 400);
    const concurrentReporter = await createUser("reportrace");
    const concurrentTarget = await request(
        `/api/reports/target?type=novel&id=${targets.novelId}`,
        { user: concurrentReporter }
    );
    const concurrent = await Promise.all([
        request("/api/reports", {
            user: concurrentReporter,
            method: "POST",
            body: {
                target_token: concurrentTarget.data.target_token,
                reason: "other",
                details: "First concurrent report"
            }
        }),
        request("/api/reports", {
            user: concurrentReporter,
            method: "POST",
            body: {
                target_token: concurrentTarget.data.target_token,
                reason: "spam",
                details: "Second concurrent report"
            }
        })
    ]);
    assert.deepEqual(concurrent.map(result => result.status).sort(), [201, 409]);

    const ownReports = await request("/api/reports/mine", { user: reporter });
    assert.equal(ownReports.status, 200);
    assert.equal(ownReports.data.reports.length, 3);
    assert.ok(ownReports.data.reports.some(report => report.report_id === reportId));
    assert.equal(ownReports.data.reports[0].reporter_id, undefined);
    const otherReports = await request("/api/reports/mine", { user: otherUser });
    assert.equal(otherReports.status, 200);
    assert.deepEqual(otherReports.data.reports, []);

    assert.equal((await request("/api/reports/admin", { user: reporter })).status, 403);
    assert.equal((await request("/api/reports/admin", { user: admin })).status, 200);
    assert.equal((await request("/api/reports/admin", { user: superAdmin })).status, 200);
    const injectionSearch = await request(
        "/api/reports/admin?q=%25%27%20OR%201%3D1%20--",
        { user: admin }
    );
    assert.equal(injectionSearch.status, 200);

    const detail = await request(`/api/reports/admin/${reportId}`, { user: admin });
    assert.equal(detail.status, 200);
    assert.equal(detail.data.report.reporter_id, reporter.user_id);
    assert.equal(detail.data.report.target_owner_id, owner.user_id);
    assert.equal(detail.data.report.reviewed_by, null);
    const deniedClaim = await request(`/api/reports/admin/${reportId}/claim`, {
        user: reporter,
        method: "POST",
        body: { reason: "User cannot claim reports" }
    });
    assert.equal(deniedClaim.status, 403);
    const claimed = await request(`/api/reports/admin/${reportId}/claim`, {
        user: admin,
        method: "POST",
        body: { reason: "Reviewing submitted evidence" }
    });
    assert.equal(claimed.status, 200, JSON.stringify(claimed.data));
    assert.equal(claimed.data.status, "reviewing");
    const duplicateClaim = await request(`/api/reports/admin/${reportId}/claim`, {
        user: superAdmin,
        method: "POST",
        body: { reason: "Attempt to claim an assigned report" }
    });
    assert.equal(duplicateClaim.status, 409);
    const resolved = await request(`/api/reports/admin/${reportId}/status`, {
        user: superAdmin,
        method: "PATCH",
        body: { status: "resolved", reason: "Confirmed and handled" }
    });
    assert.equal(resolved.status, 200, JSON.stringify(resolved.data));
    const assignment = await pool.query(
        "SELECT status, reviewed_by FROM reports WHERE report_id = $1",
        [reportId]
    );
    assert.equal(assignment.rows[0].status, "resolved");
    assert.equal(String(assignment.rows[0].reviewed_by), String(admin.user_id));
    const repeatedDecision = await request(`/api/reports/admin/${reportId}/status`, {
        user: admin,
        method: "PATCH",
        body: { status: "rejected", reason: "Attempt to override closed report" }
    });
    assert.equal(repeatedDecision.status, 409);

    const updatedOwnReports = await request("/api/reports/mine", { user: reporter });
    assert.equal(
        updatedOwnReports.data.reports.find(report => report.report_id === reportId).status,
        "resolved"
    );
    const logs = await pool.query(
        `SELECT actor_id, actor_role, action FROM admin_action_logs
         WHERE target_type = 'report' AND target_id = $1 ORDER BY log_id`,
        [reportId]
    );
    assert.deepEqual(logs.rows.map(row => row.actor_role), ["ADMIN", "SUPER_ADMIN"]);
    assert.deepEqual(logs.rows.map(row => row.action), [
        "report_claimed",
        "report_status_changed"
    ]);
    assert.deepEqual(logs.rows.map(row => String(row.actor_id)), [
        String(admin.user_id),
        String(superAdmin.user_id)
    ]);
    const finalDetail = await request(
        `/api/reports/admin/${reportId}`,
        { user: admin }
    );
    assert.equal(
        String(finalDetail.data.report.reviewed_by),
        String(admin.user_id)
    );
    assert.equal(finalDetail.data.history[0].actor_name, superAdmin.display_name);
});

test("public announcements and private notifications remain separate", async () => {
    const admin = await createUser("announceadmin", "ADMIN");
    const superAdmin = await createUser("announcesuper", "SUPER_ADMIN");
    const recipient = await createUser("announcerecipient");
    const otherRecipient = await createUser("announceother");

    assert.equal((await request("/api/announcements/admin", { user: recipient })).status, 403);
    const create = (user, title, audienceType, audienceFilter = {}) =>
        request("/api/announcements/admin", {
            user,
            method: "POST",
            body: {
                title,
                content: `<img src=x onerror=alert(1)> ${title}`,
                audience_type: audienceType,
                audience_filter: audienceFilter
            }
        });
    const publish = (user, id, publishedAt = null) =>
        request(`/api/announcements/admin/${id}/publish`, {
            user,
            method: "POST",
            body: { published_at: publishedAt }
        });

    let allTitle = `All announcement ${Date.now()}`;
    const draftAll = await create(admin, allTitle, "all");
    assert.equal(draftAll.status, 201, JSON.stringify(draftAll.data));
    const allId = String(draftAll.data.announcement.announcement_id);
    const revisedTitle = `${allTitle} updated`;
    const editDraft = await request(`/api/announcements/admin/${allId}`, {
        user: admin,
        method: "PATCH",
        body: {
            title: revisedTitle,
            content: "Updated content",
            audience_type: "all",
            audience_filter: {},
            expires_at: null
        }
    });
    assert.equal(editDraft.status, 200, JSON.stringify(editDraft.data));
    allTitle = revisedTitle;
    let publicFeed = await request("/api/announcements/public");
    assert.equal(publicFeed.status, 200);
    assert.ok(!publicFeed.data.announcements.some(item =>
        String(item.announcement_id) === allId
    ));
    let visible = await request("/api/announcements", { user: recipient });
    assert.equal(visible.status, 200);
    assert.ok(!visible.data.announcements.some(item => String(item.announcement_id) === allId));
    assert.equal((await request(`/api/announcements/${allId}`, {
        user: recipient
    })).status, 404);

    const allNotificationsBefore = await pool.query(
        `SELECT COUNT(*)::int AS count FROM notifications
         WHERE user_id = $1 AND metadata->>'announcementId' = $2`,
        [recipient.user_id, allId]
    );
    assert.equal(allNotificationsBefore.rows[0].count, 0);
    const publishedAll = await publish(admin, allId);
    assert.equal(publishedAll.status, 200, JSON.stringify(publishedAll.data));
    const replayPublish = await publish(admin, allId);
    assert.equal(replayPublish.status, 409);
    publicFeed = await request("/api/announcements/public");
    const publicAnnouncement = publicFeed.data.announcements.find(item =>
        String(item.announcement_id) === allId
    );
    assert.ok(publicAnnouncement);
    assert.equal(publicAnnouncement.title, allTitle);
    assert.equal(publicAnnouncement.content, "Updated content");
    visible = await request("/api/announcements", { user: recipient });
    assert.ok(!visible.data.announcements.some(item =>
        String(item.announcement_id) === allId
    ));
    const openAll = await request(`/api/announcements/${allId}`, { user: recipient });
    assert.equal(openAll.status, 404);
    const markRead = await request(`/api/announcements/${allId}/read`, {
        user: recipient,
        method: "PATCH"
    });
    assert.equal(markRead.status, 404);
    const allNotificationsAfter = await pool.query(
        `SELECT COUNT(*)::int AS count FROM notifications
         WHERE user_id = $1 AND metadata->>'announcementId' = $2`,
        [recipient.user_id, allId]
    );
    assert.equal(allNotificationsAfter.rows[0].count, 0);
    const publicRecipients = await pool.query(
        "SELECT COUNT(*)::int AS count FROM announcement_recipients WHERE announcement_id = $1",
        [allId]
    );
    assert.equal(publicRecipients.rows[0].count, 0);
    const editPublished = await request(`/api/announcements/admin/${allId}`, {
        user: admin,
        method: "PATCH",
        body: {
            title: `${allTitle} revised`,
            content: "Updated after publication",
            expires_at: null
        }
    });
    assert.equal(editPublished.status, 200, JSON.stringify(editPublished.data));
    const updatedPublished = await request(`/api/announcements/admin/${allId}`, {
        user: admin
    });
    assert.equal(updatedPublished.data.announcement.title, `${allTitle} revised`);
    assert.equal(updatedPublished.data.announcement.content, "Updated after publication");

    const individualAnnouncement = await create(
        admin,
        `Individual ${Date.now()}`,
        "individual",
        { userIds: [String(recipient.user_id)] }
    );
    assert.equal(individualAnnouncement.status, 400);
    const privateNotification = (user, audienceType, audienceFilter, title) =>
        request("/api/announcements/admin/private-notifications", {
            user,
            method: "POST",
            body: {
                title,
                message: `Private message ${title}`,
                audience_type: audienceType,
                audience_filter: audienceFilter
            }
        });
    const privateTitle = `Private ${Date.now()}`;
    const individualNotification = await privateNotification(
        admin,
        "individual",
        { userIds: [String(recipient.user_id)] },
        privateTitle
    );
    assert.equal(individualNotification.status, 201);
    assert.equal(individualNotification.data.sent, 1);
    const recipientNotifications = await request("/api/notifications", {
        user: recipient
    });
    assert.ok(recipientNotifications.data.notifications.some(notification =>
        notification.message === `Private message ${privateTitle}` &&
        notification.metadata.title === privateTitle
    ));
    const otherNotifications = await request("/api/notifications", {
        user: otherRecipient
    });
    assert.ok(!otherNotifications.data.notifications.some(notification =>
        notification.message === `Private message ${privateTitle}`
    ));
    publicFeed = await request("/api/announcements/public");
    assert.ok(!publicFeed.data.announcements.some(item =>
        item.title === privateTitle
    ));
    const groupTitle = `Group ${Date.now()}`;
    const groupNotification = await privateNotification(
        superAdmin,
        "group",
        { roles: ["USER"] },
        groupTitle
    );
    assert.equal(groupNotification.status, 201);
    assert.ok(groupNotification.data.sent >= 2);
    for (const user of [recipient, otherRecipient]) {
        const notifications = await request("/api/notifications", { user });
        assert.ok(notifications.data.notifications.some(notification =>
            notification.message === `Private message ${groupTitle}`
        ));
    }
    assert.equal((await privateNotification(
        superAdmin,
        "all",
        {},
        "Invalid public notification"
    )).status, 400);

    const scheduledDraft = await create(admin, `Scheduled ${Date.now()}`, "all");
    assert.equal(scheduledDraft.status, 201);
    const scheduledId = String(scheduledDraft.data.announcement.announcement_id);
    const future = new Date(Date.now() + 60_000).toISOString();
    const scheduled = await publish(admin, scheduledId, future);
    assert.equal(scheduled.status, 200, JSON.stringify(scheduled.data));
    assert.equal(scheduled.data.announcement.status, "draft");
    const scheduledRecipient = await pool.query(
        "SELECT COUNT(*)::int AS count FROM announcement_recipients WHERE announcement_id = $1",
        [scheduledId]
    );
    assert.equal(scheduledRecipient.rows[0].count, 0);
    await pool.query(
        "UPDATE announcements SET published_at = CURRENT_TIMESTAMP - INTERVAL '1 minute' WHERE announcement_id = $1",
        [scheduledId]
    );
    publicFeed = await request("/api/announcements/public");
    assert.ok(publicFeed.data.announcements.some(item =>
        String(item.announcement_id) === scheduledId
    ));
    const scheduledNotificationCount = await pool.query(
        `SELECT COUNT(*)::int AS count FROM notifications
         WHERE user_id = $1 AND metadata->>'announcementId' = $2`,
        [recipient.user_id, scheduledId]
    );
    assert.equal(scheduledNotificationCount.rows[0].count, 0);
    const scheduledRecipients = await pool.query(
        "SELECT COUNT(*)::int AS count FROM announcement_recipients WHERE announcement_id = $1",
        [scheduledId]
    );
    assert.equal(scheduledRecipients.rows[0].count, 0);
    const dueState = await pool.query(
        "SELECT status FROM announcements WHERE announcement_id = $1",
        [scheduledId]
    );
    assert.equal(dueState.rows[0].status, "published");

    const cancelDraft = await create(admin, `Cancel ${Date.now()}`, "all");
    assert.equal(cancelDraft.status, 201);
    const cancelId = String(cancelDraft.data.announcement.announcement_id);
    const cancelled = await request(`/api/announcements/admin/${cancelId}/cancel`, {
        user: admin,
        method: "POST",
        body: { reason: "No longer needed" }
    });
    assert.equal(cancelled.status, 200);
    assert.equal((await request(`/api/announcements/admin/${cancelId}/cancel`, {
        user: admin,
        method: "POST",
        body: {}
    })).status, 409);
    assert.equal((await request(`/api/announcements/${cancelId}`, {
        user: recipient
    })).status, 404);
    const cancelledNotifications = await pool.query(
        `SELECT COUNT(*)::int AS count FROM notifications
         WHERE user_id = $1 AND metadata->>'announcementId' = $2`,
        [recipient.user_id, cancelId]
    );
    assert.equal(cancelledNotifications.rows[0].count, 0);
});

test("pinned announcements enforce safe links and public lifecycle behavior", async () => {
    const admin = await createUser("pinnedadmin", "ADMIN");
    const superAdmin = await createUser("pinnedsuper", "SUPER_ADMIN");
    const recipient = await createUser("pinnedrecipient");
    const outsider = await createUser("pinnedoutsider");
    const create = (user, body) => request("/api/announcements/admin", {
        user,
        method: "POST",
        body: {
            title: `Pinned ${Date.now()}`,
            content: "Pinned announcement content",
            audience_type: "all",
            audience_filter: {},
            ...body
        }
    });
    const publish = (user, id) => request(
        `/api/announcements/admin/${id}/publish`,
        { user, method: "POST", body: { published_at: null } }
    );

    assert.equal((await create(recipient, {})).status, 403);
    for (const unsafeUrl of ["javascript:alert(1)", "//example.test/path"]) {
        const invalid = await create(admin, {
            link_url: unsafeUrl,
            link_label: "Unsafe link"
        });
        assert.equal(invalid.status, 400);
    }

    const publicDraft = await create(admin, {
        link_url: "/announcements.html",
        link_label: "Read more",
        is_pinned: true,
        pin_order: 2
    });
    assert.equal(publicDraft.status, 201, JSON.stringify(publicDraft.data));
    const publicId = String(publicDraft.data.announcement.announcement_id);
    assert.equal((await request("/api/announcements/home-pinned")).data.announcements
        .some(item => String(item.announcement_id) === publicId), false);
    assert.equal((await publish(admin, publicId)).status, 200);

    const targetedDraft = await create(superAdmin, {
        audience_type: "individual",
        audience_filter: { userIds: [String(recipient.user_id)] },
        link_url: "https://example.test/announcement",
        link_label: "External details",
        is_pinned: true,
        pin_order: 1
    });
    assert.equal(targetedDraft.status, 400);

    const guestPins = await request("/api/announcements/home-pinned");
    assert.deepEqual(
        guestPins.data.announcements.map(item => String(item.announcement_id)),
        [publicId]
    );
    const recipientPins = await request("/api/announcements/home-pinned", {
        user: recipient
    });
    assert.deepEqual(
        recipientPins.data.announcements.map(item => String(item.announcement_id)),
        [publicId]
    );
    const outsiderPins = await request("/api/announcements/home-pinned", {
        user: outsider
    });
    assert.deepEqual(
        outsiderPins.data.announcements.map(item => String(item.announcement_id)),
        [publicId]
    );
    assert.equal(recipientPins.data.announcements[0].link_url,
        "/announcements.html");

    assert.equal((await request(`/api/announcements/admin/${publicId}/pin`, {
        user: recipient,
        method: "POST",
        body: { is_pinned: false, pin_order: 2 }
    })).status, 403);
    const unpinned = await request(`/api/announcements/admin/${publicId}/pin`, {
        user: admin,
        method: "POST",
        body: { is_pinned: false, pin_order: 2 }
    });
    assert.equal(unpinned.status, 200);
    assert.equal((await request("/api/announcements/home-pinned")).data.announcements
        .some(item => String(item.announcement_id) === publicId), false);
    assert.equal((await request(`/api/announcements/admin/${publicId}/pin`, {
        user: admin,
        method: "POST",
        body: { is_pinned: true, pin_order: -1 }
    })).status, 400);

    const unpublished = await request(
        `/api/announcements/admin/${publicId}/unpublish`,
        { user: superAdmin, method: "POST", body: {} }
    );
    assert.equal(unpublished.status, 200);
    assert.equal(unpublished.data.announcement.status, "draft");
    assert.equal((await request("/api/announcements/home-pinned")).data.announcements
        .some(item => String(item.announcement_id) === publicId), false);
    assert.equal((await request(`/api/announcements/admin/${publicId}/unpublish`, {
        user: superAdmin,
        method: "POST",
        body: {}
    })).status, 409);

    assert.equal((await publish(superAdmin, publicId)).status, 200);
    const deleted = await request(`/api/announcements/admin/${publicId}`, {
        user: superAdmin,
        method: "DELETE"
    });
    assert.equal(deleted.status, 200);
    assert.equal((await request("/api/announcements/home-pinned")).data.announcements
        .some(item => String(item.announcement_id) === publicId), false);
    const notifications = await pool.query(
        `SELECT COUNT(*)::int AS count
         FROM notifications
         WHERE metadata->>'announcementId' = $1`,
        [publicId]
    );
    assert.equal(notifications.rows[0].count, 0);
    const audit = await pool.query(
        `SELECT COUNT(*)::int AS count
         FROM admin_action_logs
         WHERE target_type = 'announcement'
           AND target_id = $1
           AND action = 'announcement_deleted'`,
        [Number(publicId)]
    );
    assert.equal(audit.rows[0].count, 1);
});
