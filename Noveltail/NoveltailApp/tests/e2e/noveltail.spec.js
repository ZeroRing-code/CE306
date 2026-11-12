const { test, expect } = require("@playwright/test");
const { randomUUID } = require("node:crypto");
const pool = require("../../db");

test.afterAll(async () => {
    await pool.end();
});

async function register(page, prefix) {
    await page.goto("/auth.html");
    const username = `${prefix}_${Date.now()}_${randomUUID().slice(0, 6)}`.slice(0, 30);
    const csrf = await page.request.get("/api/auth/csrf");
    const csrfData = await csrf.json();
    const response = await page.request.post("/api/auth/register", {
        headers: {
            Origin: new URL(page.url()).origin,
            "X-CSRF-Token": csrfData.token
        },
        data: {
            username,
            display_name: `Test ${prefix}`,
            email: `${username}@example.test`,
            password: "TestPassword123!"
        }
    });
    expect(response.status()).toBe(201);
    return { ...((await response.json()).user), username };
}

async function createPublishedNovel(author, title) {
    const novel = await pool.query(
        `INSERT INTO novels (user_id, title, description)
         VALUES ($1, $2, 'Playwright test novel')
         RETURNING novel_id`,
        [author.user_id, title]
    );
    const novelId = novel.rows[0].novel_id;
    const chapters = [];
    for (const [number, paid] of [[1, false], [2, true]]) {
        const chapter = await pool.query(
            `INSERT INTO chapters (
                novel_id, chapter_number, title, content, status,
                published_at, is_paid, price
             )
             VALUES ($1, $2, $3, $4, 'published', CURRENT_TIMESTAMP, $5, $6)
             RETURNING chapter_id`,
            [
                novelId,
                number,
                `Test chapter ${number}`,
                `Visible browser content ${number}`,
                paid,
                paid ? 10 : 0
            ]
        );
        chapters.push(chapter.rows[0].chapter_id);
    }
    return { novelId, chapters };
}

test("unauthenticated writers are redirected to the existing auth page", async ({ page }) => {
    await page.goto("/create-novel.html");
    await expect(page).toHaveURL(/\/auth\.html$/);
    await expect(page.locator("#login-form")).toBeVisible();
});

test("writers can create a novel and publish, edit, and read a chapter", async ({ page }) => {
    const author = await register(page, "writer_flow");
    const followerContext = await page.context().browser().newContext();
    const followerPage = await followerContext.newPage();
    const follower = await register(followerPage, "writer_follower");
    const genre = await pool.query(
        "INSERT INTO genres (genre_name) VALUES ($1) RETURNING genre_id",
        [`Browser genre ${randomUUID()}`]
    );
    const novelTitle = `Writer flow ${randomUUID().slice(0, 8)}`;
    await page.goto("/create-novel.html");
    await page.locator("#title").fill(novelTitle);
    await page.locator("#description").fill("Created through the writer form");
    await page.locator(
        `#genre-list input[value="${genre.rows[0].genre_id}"]`
    ).check();
    await page.locator("#submit-button").click();
    await expect(page).toHaveURL(/\/my-novels\.html$/);
    await expect(page.locator("#novel-list")).toContainText(novelTitle);

    const novelCard = page.locator(".my-novel-card")
        .filter({ hasText: novelTitle });
    await novelCard.getByRole("link", { name: "Manage Chapters" }).click();
    const novelId = new URL(page.url()).searchParams.get("novelId");
    await expect(page.locator("#writer-app")).toBeVisible();
    await page.locator("#new-chapter-button").click();
    await page.locator("#chapter-number").fill("1");
    await page.locator("#chapter-title").fill("First version");
    await page.locator("#chapter-content").fill("First published chapter");
    await page.locator("#publish-button").click();
    await expect(page.locator("#chapter-message")).toContainText("Chapter added.");

    const firstChapter = await pool.query(
        `SELECT chapter_id, status
         FROM chapters
         WHERE novel_id = $1 AND chapter_number = 1`,
        [novelId]
    );
    expect(firstChapter.rows[0].status).toBe("published");

    await followerPage.goto(`/profile.html?username=${author.username}`);
    await expect(followerPage.locator("#follow-profile-button")).toBeVisible();
    await followerPage.locator("#follow-profile-button").click();
    await expect(followerPage.locator("#follow-profile-message"))
        .toContainText("Following writer.");
    await followerPage.goto(`/novel.html?id=${novelId}`);
    await expect(followerPage.locator("#novel-follow-button"))
        .toHaveText("Follow Novel");
    await followerPage.locator("#novel-follow-button").click();
    await expect(followerPage.locator("#novel-follow-message"))
        .toContainText("Following novel.");
    await followerPage.reload();
    await expect(followerPage.locator("#novel-follow-button"))
        .toHaveText("Unfollow Novel");
    const novelFollow = await pool.query(
        "SELECT 1 FROM novel_follows WHERE user_id = $1 AND novel_id = $2",
        [follower.user_id, novelId]
    );
    expect(novelFollow.rowCount).toBe(1);
    await followerPage.locator("#novel-follow-button").click();
    await expect(followerPage.locator("#novel-follow-message"))
        .toContainText("Unfollowed novel.");
    const removedFollow = await pool.query(
        "SELECT 1 FROM novel_follows WHERE user_id = $1 AND novel_id = $2",
        [follower.user_id, novelId]
    );
    expect(removedFollow.rowCount).toBe(0);
    await followerPage.locator("#novel-follow-button").click();
    await expect(followerPage.locator("#novel-follow-message"))
        .toContainText("Following novel.");

    await page.locator("#new-chapter-button").click();
    await page.locator("#chapter-number").fill("2");
    await page.locator("#chapter-title").fill("Draft version");
    await page.locator("#chapter-content").fill("Saved as a draft from the writer form");
    await page.locator('button[data-status="draft"]').click();
    await expect(page.locator("#chapter-message")).toContainText("Chapter added.");
    const draftChapter = await pool.query(
        "SELECT chapter_id FROM chapters WHERE novel_id = $1 AND chapter_number = 2",
        [novelId]
    );
    const draftLoad = page.waitForResponse(response =>
        response.request().method() === "GET" &&
        response.url().endsWith(
            `/api/writer/novels/${novelId}/chapters/${draftChapter.rows[0].chapter_id}`
        )
    );
    await page.locator(".chapter-item")
        .filter({ hasText: "Draft version" })
        .click();
    await draftLoad;
    await expect(page.locator("#chapter-title")).toHaveValue("Draft version");
    await page.locator("#chapter-title").fill("Edited version");
    await page.locator("#chapter-content").fill("Edited and read from PostgreSQL");
    const chapterUpdate = page.waitForResponse(response =>
        response.request().method() === "PUT" &&
        response.url().endsWith(
            `/api/writer/novels/${novelId}/chapters/${draftChapter.rows[0].chapter_id}`
        )
    );
    await page.locator("#publish-button").click();
    const updatedChapter = await (await chapterUpdate).json();
    expect(updatedChapter.chapter.title).toBe("Edited version");
    await expect(page.locator("#chapter-message")).toContainText("Chapter updated.");
    await expect(page.locator(".chapter-item")
        .filter({ hasText: "Edited version" })).toBeVisible();

    await page.locator("#new-chapter-button").click();
    await page.locator("#chapter-number").fill("3");
    await page.locator("#chapter-title").fill("Published directly");
    await page.locator("#chapter-content").fill("Created and published from the writer form");
    await page.locator("#publish-button").click();
    await expect(page.locator("#chapter-message")).toContainText("Chapter added.");

    const persisted = await pool.query(
        `SELECT c.chapter_id, c.status, c.title, c.content,
                n.message, n.metadata
         FROM chapters c
         JOIN notifications n ON n.chapter_id = c.chapter_id
         WHERE c.novel_id = $1 AND n.user_id = $2
         ORDER BY c.chapter_number`,
        [novelId, follower.user_id]
    );
    expect(persisted.rows).toHaveLength(2);
    expect(persisted.rows.map(row => row.status)).toEqual([
        "published",
        "published"
    ]);
    expect(persisted.rows[0].title).toBe("Edited version");
    expect(new Set(persisted.rows.map(row => row.chapter_id)).size).toBe(2);
    expect(persisted.rows[0].content).toBe("Edited and read from PostgreSQL");
    expect(persisted.rows[0].message).toContain("Edited version");
    expect(persisted.rows.every(row =>
        Number(row.metadata.novelId) === Number(novelId)
    )).toBe(true);

    await followerPage.goto("/notifications.html");
    const chapterNotification = followerPage.locator(".notification-card")
        .filter({ hasText: "Edited version" });
    await expect(chapterNotification).toContainText("Edited version");
    await chapterNotification.getByRole("button", { name: "Mark as Read" }).click();
    await expect(chapterNotification).not.toHaveClass(/is-unread/);
    const readNotification = await pool.query(
        `SELECT is_read FROM notifications
         WHERE user_id = $1 AND chapter_id = $2`,
        [follower.user_id, persisted.rows[0].chapter_id]
    );
    expect(readNotification.rows[0].is_read).toBe(true);

    await page.goto(
        `/reader.html?novelId=${novelId}&chapterId=${persisted.rows[0].chapter_id}`
    );
    await expect(page.locator("#chapter-content"))
        .toHaveText("Edited and read from PostgreSQL");
    await followerContext.close();
});

test("signup, login, logout, wallet, and responsive account pages", async ({ page }) => {
    const browserErrors = [];
    const failedRequests = [];
    page.on("pageerror", error => browserErrors.push(error.message));
    page.on("requestfailed", request => {
        const reason = request.failure()?.errorText;
        if (reason !== "net::ERR_ABORTED") {
            failedRequests.push(`${request.method()} ${request.url()}: ${reason}`);
        }
    });

    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/auth.html");
    await page.locator("#register-tab").click();
    const username = `browser_${Date.now()}_${randomUUID().slice(0, 5)}`.slice(0, 30);
    await page.locator('#register-form [name="username"]').fill(username);
    await page.locator('#register-form [name="display_name"]').fill("Browser Reader");
    await page.locator('#register-form [name="email"]').fill(`${username}@example.test`);
    await page.locator('#register-form [name="password"]').fill("BrowserPass123!");
    await page.locator('#register-form button[type="submit"]').click();
    await expect(page.locator("#account-panel")).toBeVisible();
    await expect(page.locator("#account-info")).toContainText(username);

    await page.locator("#logout-button").click();
    await expect(page.locator("#login-form")).toBeVisible();
    await page.locator('#login-form [name="identifier"]').fill(username);
    await page.locator('#login-form [name="password"]').fill("BrowserPass123!");
    await page.locator('#login-form button[type="submit"]').click();
    await expect(page.locator("#account-panel")).toBeVisible();

    await page.goto("/wallet.html");
    await expect(page.locator("#wallet-balance")).toHaveText("0");
    await page.getByRole("button", { name: "Top up 50 coins", exact: true }).click();
    await expect(page.locator("#wallet-balance")).toHaveText("50");
    await expect(page.locator("#wallet-transactions")).toContainText("Coin top-up");

    for (const [width, height] of [
        [360, 800], [390, 844], [430, 932], [768, 1024],
        [1024, 768], [1280, 800], [1440, 900], [1920, 1080]
    ]) {
        await page.setViewportSize({ width, height });
        for (const route of [
            "/",
            "/wallet.html",
            "/bookmarks.html",
            "/history.html",
            "/notifications.html",
            "/my-novels.html",
            "/profile.html?username=" + encodeURIComponent(username),
            "/edit-profile.html",
            "/auth.html"
        ]) {
            await page.goto(route);
            await page.waitForLoadState("domcontentloaded");
            const dimensions = await page.evaluate(() => ({
                viewport: document.documentElement.clientWidth,
                page: document.documentElement.scrollWidth,
                overflowingElements: [...document.querySelectorAll("body *")]
                    .filter(element =>
                        element.getBoundingClientRect().right >
                        document.documentElement.clientWidth + 1
                    )
                    .slice(0, 10)
                    .map(element => ({
                        tag: element.tagName,
                        className: typeof element.className === "string"
                            ? element.className
                            : "",
                        id: element.id,
                        right: Math.round(element.getBoundingClientRect().right)
                    }))
            }));
            expect(
                dimensions.page,
                `${route} overflows at ${width}px: ${
                    JSON.stringify(dimensions.overflowingElements)
                }`
            ).toBeLessThanOrEqual(dimensions.viewport + 1);
        }
    }
    expect(browserErrors).toEqual([]);
    expect(failedRequests).toEqual([]);

    const csrfToken = await page.evaluate(() => {
        const cookie = document.cookie.split("; ")
            .find(item => item.startsWith("noveltail_csrf="));
        return cookie ? decodeURIComponent(cookie.slice("noveltail_csrf=".length)) : "";
    });
    expect(csrfToken).not.toBe("");
    const csrfEndpoint = `${new URL(page.url()).origin}/api/auth/logout`;
    expect((await page.request.post(csrfEndpoint, {
        headers: { Origin: new URL(page.url()).origin }
    })).status()).toBe(403);
    expect((await page.request.post(csrfEndpoint, {
        headers: {
            Origin: new URL(page.url()).origin,
            "X-CSRF-Token": "invalid"
        }
    })).status()).toBe(403);
    expect((await page.request.post(csrfEndpoint, {
        headers: {
            Origin: "https://attacker.example",
            "X-CSRF-Token": csrfToken
        }
    })).status()).toBe(403);
    expect((await page.request.post(csrfEndpoint, {
        headers: {
            Origin: new URL(page.url()).origin,
            "X-CSRF-Token": csrfToken
        }
    })).status()).toBe(200);

    for (let attempt = 0; attempt < 10; attempt += 1) {
        expect((await page.request.post("/api/auth/login", {
            headers: {
                Origin: new URL(page.url()).origin,
                "X-CSRF-Token": csrfToken,
                "X-Forwarded-For": "198.51.100.55"
            },
            data: {
                identifier: `browser_rate_${attempt}`,
                password: "IncorrectPassword123!"
            }
        })).status()).toBe(401);
    }
    const rateLimited = await page.request.post("/api/auth/login", {
        headers: {
            Origin: new URL(page.url()).origin,
            "X-CSRF-Token": csrfToken,
            "X-Forwarded-For": "198.51.100.55"
        },
        data: {
            identifier: "browser_rate_limit",
            password: "IncorrectPassword123!"
        }
    });
    expect(rateLimited.status()).toBe(429);
    expect(Number(rateLimited.headers()["retry-after"])).toBeGreaterThan(0);
});

test("novel reading, unlock, bookmark, comment, review, follow, and history browser flows", async ({ page }) => {
    const reader = await register(page, "e2e_reader");
    const authorContext = await page.context().browser().newContext();
    const authorPage = await authorContext.newPage();
    const author = await register(authorPage, "e2e_author");
    await authorContext.close();
    const title = `Browser Novel ${randomUUID().slice(0, 8)}`;
    const { novelId, chapters } = await createPublishedNovel(author, title);

    await page.goto(`/novel.html?id=${novelId}`);
    await expect(page.locator("#novel-title")).toHaveText(title);
    const bookmarkButton = page.locator(".nt-bookmark-button");
    await expect(bookmarkButton).toContainText("Bookmark");
    await bookmarkButton.click();
    await expect(bookmarkButton).toContainText("Bookmarked · Remove");
    await page.goto("/bookmarks.html");
    await expect(page.locator("#bookmark-list")).toContainText(title);
    await expect(page.getByRole("link", { name: "Reading History" }))
        .toHaveAttribute("href", "history.html");

    await page.goto(`/reader.html?novelId=${novelId}&chapterId=${chapters[0]}`);
    await expect(page.locator("#chapter-content")).toContainText("Visible browser content 1");
    await page.locator("#comment-input").fill("Browser main comment");
    await page.locator("#comment-submit").click();
    await expect(page.locator("#comments-list")).toContainText("Browser main comment");
    await page.locator(".comment-reply-button").first().click();
    await page.locator(".reply-form textarea").fill("Browser reply");
    await page.locator(".reply-send").click();
    await expect(page.locator("#comments-list")).toContainText("Browser reply");
    await page.locator(".comment-actions [data-edit-comment]").first().click();
    await page.locator(".comment-edit-form textarea").fill("Edited browser comment");
    await page.locator(".comment-edit-form [type=submit]").click();
    await expect(page.locator("#comments-list")).toContainText("Edited browser comment");
    await page.locator("#comment-input").fill("<img src=x onerror=alert(1)>");
    await page.locator("#comment-submit").click();
    await expect(page.locator("#comments-list")).toContainText("<img src=x onerror=alert(1)>");
    await expect(page.locator("#comments-list img")).toHaveCount(0);

    await page.goto(`/novel.html?id=${novelId}`);
    await page.locator("#review-open-button").click();
    await page.locator('#review-rating-picker [data-rating="5"]').click();
    await page.locator("#review-text").fill("Browser review");
    await page.locator("#review-submit").click();
    await expect(page.locator("#review-list")).toContainText("Browser review");

    await page.goto(`/profile.html?username=${encodeURIComponent(author.username)}`);
    await page.locator("#follow-profile-button").click();
    await expect(page.locator("#follow-profile-button")).toContainText("Unfollow");

    await page.goto("/history.html");
    await expect(page.locator("#history-list")).toContainText(title);
    await page.goto("/notifications.html");
    await expect(page.locator("#notification-empty")).toBeVisible();

    await page.goto(`/reader.html?novelId=${novelId}&chapterId=${chapters[1]}`);
    await expect(page.locator("#purchase-panel")).toBeVisible();
    await page.goto("/wallet.html");
    await page.getByRole("button", { name: "Top up 50 coins", exact: true }).click();
    await page.goto(`/reader.html?novelId=${novelId}&chapterId=${chapters[1]}`);
    await page.locator("#unlock-chapter-button").click();
    await expect(page.locator("#chapter-content")).toContainText("Visible browser content 2");

    for (const [width, height] of [
        [360, 800], [390, 844], [430, 932], [768, 1024],
        [1024, 768], [1280, 800], [1440, 900], [1920, 1080]
    ]) {
        await page.setViewportSize({ width, height });
        for (const route of [
            `/novel.html?id=${novelId}`,
            `/reader.html?novelId=${novelId}&chapterId=${chapters[0]}`,
            "/create-novel.html",
            `/edit-novel.html?id=${novelId}`,
            "/write.html"
        ]) {
            await page.goto(route);
            await page.waitForLoadState("domcontentloaded");
            const dimensions = await page.evaluate(() => ({
                viewport: document.documentElement.clientWidth,
                page: document.documentElement.scrollWidth
            }));
            expect(dimensions.page, `${route} overflows at ${width}px`)
                .toBeLessThanOrEqual(dimensions.viewport + 1);
        }
    }
});

test("admin suspension and user appeal flow across responsive viewports", async ({ page }) => {
    const admin = await register(page, "e2e_admin");
    await pool.query(
        "UPDATE users SET role = 'ADMIN', is_admin = TRUE WHERE user_id = $1",
        [admin.user_id]
    );
    const targetContext = await page.context().browser().newContext();
    const targetPage = await targetContext.newPage();
    const target = await register(targetPage, "e2e_target");
    const targetNovelTitle = `Moderation ${randomUUID().slice(0, 8)}`;
    await createPublishedNovel(target, targetNovelTitle);

    await page.goto("/admin.html");
    await page.locator("#novel-query").fill(targetNovelTitle);
    await page.locator("#novel-search button[type=submit]").click();
    const novelDetailButton = page.locator('#novel-results [data-action="novel-detail"]').first();
    await expect(novelDetailButton).toBeVisible();
    await novelDetailButton.click();
    await page.locator("#novel-detail textarea").fill("Playwright moderation reason");
    await page.locator('#novel-detail [data-action="moderate"]').click();
    await expect(page.locator("#admin-status"))
        .toContainText("Novel status updated and action recorded.");

    await page.locator("#account-query").fill(target.username);
    await page.locator("#account-search button[type=submit]").click();
    const detailButton = page.locator('#account-results [data-action="account-detail"]');
    await expect(detailButton).toHaveCount(1);
    await detailButton.click();
    await expect(page.locator('#account-detail [data-action="change-role"]'))
        .toHaveCount(0);
    await page.locator("#account-detail textarea").fill("Playwright suspension reason");
    await page.locator("#account-detail select").selectOption("7");
    await page.locator('#account-detail [data-action="suspend-account"]').click();
    await expect(page.locator("#admin-status"))
        .toContainText("Account suspended and notification sent.");

    const deniedWallet = await targetPage.request.get("/api/wallet");
    expect(deniedWallet.status()).toBe(403);
    await targetPage.goto("/appeals.html");
    await expect(targetPage.locator("#suspension-list")).toBeVisible();
    await expect(targetPage.locator("#suspension-list")).toContainText("Playwright suspension reason");
    await targetPage.locator("#suspension-list textarea").fill("Please review this suspension");
    await targetPage.locator("#suspension-list button[type=submit]").click();
    await expect(targetPage.locator("#appeal-status")).toContainText("Appeal submitted.");

    await page.locator("#appeal-refresh").click();
    await expect(page.locator("#appeal-results")).toContainText(target.username);
    const deniedAdmin = await targetPage.request.get("/api/admin/users?q=target");
    expect(deniedAdmin.status()).toBe(403);

    for (const [width, height] of [
        [360, 800], [390, 844], [430, 932], [768, 1024],
        [1024, 768], [1280, 800], [1440, 900], [1920, 1080]
    ]) {
        await page.setViewportSize({ width, height });
        for (const route of ["/admin.html", "/appeals.html"]) {
            await page.goto(route);
            await page.waitForLoadState("domcontentloaded");
            const dimensions = await page.evaluate(() => ({
                viewport: document.documentElement.clientWidth,
                page: document.documentElement.scrollWidth
            }));
            expect(dimensions.page, `${route} overflows at ${width}px`)
                .toBeLessThanOrEqual(dimensions.viewport + 1);
        }
    }
    await targetContext.close();
});

test("user reports content and ADMIN/SUPER_ADMIN manage reports and announcements", async ({
    page,
    browser
}) => {
    test.setTimeout(60_000);
    page.setDefaultTimeout(8_000);
    page.setDefaultNavigationTimeout(12_000);
    const reporter = await register(page, "community_user");
    const novelTitle = `Community report ${Date.now()}`;
    const novel = await createPublishedNovel(reporter, novelTitle);
    const reportDialog = page.locator(".report-dialog");
    const expectDialogCentered = async dialog => {
        const box = await dialog.boundingBox();
        const viewport = page.viewportSize();
        expect(box).not.toBeNull();
        expect(Math.abs(box.x + box.width / 2 - viewport.width / 2))
            .toBeLessThanOrEqual(2);
        expect(Math.abs(box.y + box.height / 2 - viewport.height / 2))
            .toBeLessThanOrEqual(2);
    };
    const expectStaticTargets = async () => {
        const areStatic = await reportDialog.locator("[data-readonly-target]")
            .evaluateAll(elements => elements.every(element =>
                element.tagName === "DD" && !element.isContentEditable
            ));
        expect(areStatic).toBe(true);
    };
    await page.goto(`/novel.html?id=${novel.novelId}`);
    await page.locator("#report-novel-button").click();
    await expect(reportDialog).toBeVisible();
    await expectDialogCentered(reportDialog);
    await expect(reportDialog.locator("[data-readonly-target]").nth(0))
        .toHaveText("Novel");
    await expect(reportDialog.locator("[data-readonly-target]").nth(1))
        .toHaveText(novelTitle);
    await expect(reportDialog.locator("[data-readonly-target]").nth(2))
        .toHaveText(String(novel.novelId));
    await expectStaticTargets();
    await expect(reportDialog.locator('input[name="target_id"], select[name="target_type"]'))
        .toHaveCount(0);
    await reportDialog.locator('[name="reason"]').selectOption("spam");
    const reportDetails = reportDialog.locator('[name="details"]');
    await reportDetails.fill("short");
    await reportDialog.getByRole("button", { name: "Submit report" }).click();
    await expect(reportDetails).toHaveAttribute("aria-invalid", "true");
    await reportDetails.fill("Automated test report explanation");
    await reportDialog.getByRole("button", { name: "Submit report" }).click();
    await expect(reportDialog.locator(".report-dialog-success")).toBeVisible();
    const reportIdElement = reportDialog.locator("#report-id");
    await expect(reportIdElement).toHaveAttribute("aria-readonly", "true");
    expect(await reportIdElement.evaluate(element => element.tagName)).toBe("OUTPUT");
    await expect(reportDialog.locator("input#report-id, textarea#report-id"))
        .toHaveCount(0);
    const novelReportId = (await reportIdElement.textContent()).trim();
    expect(novelReportId).toMatch(/^\d+$/);
    const novelReportSnapshot = await pool.query(
        `SELECT r.target_novel_id, r.target_snapshot, r.details
         FROM reports r WHERE r.report_id = $1`,
        [novelReportId]
    );
    expect(String(novelReportSnapshot.rows[0].target_novel_id))
        .toBe(String(novel.novelId));
    expect(novelReportSnapshot.rows[0].target_snapshot.novel_title)
        .toBe(novelTitle);
    expect(novelReportSnapshot.rows[0].details)
        .toBe("Automated test report explanation");

    await page.goto(
        `/reader.html?novelId=${novel.novelId}&chapterId=${novel.chapters[0]}`
    );
    await page.locator("#report-chapter-button").click();
    await expect(reportDialog.locator("[data-readonly-target]").nth(0))
        .toHaveText("Chapter");
    await expect(reportDialog.locator("[data-readonly-target]").nth(1))
        .toHaveText(novelTitle);
    await expect(reportDialog.locator("[data-readonly-target]")
        .filter({ hasText: "Test chapter 1" }))
        .toHaveText("Test chapter 1 / 1");
    await expect(reportDialog.locator("[data-readonly-target]").nth(3))
        .toHaveText(String(novel.chapters[0]));
    await expectStaticTargets();
    await reportDialog.locator('[name="reason"]').selectOption("copyright");
    await reportDialog.locator('[name="details"]')
        .fill("The reported chapter appears to copy protected work.");
    await reportDialog.getByRole("button", { name: "Submit report" }).click();
    await expect(reportDialog.locator(".report-dialog-success")).toBeVisible();
    await reportDialog.getByRole("button", { name: "Cancel" }).click();

    const commentContent = `Reportable comment ${Date.now()}`;
    await page.locator("#comment-input").fill(commentContent);
    await page.locator("#comment-submit").click();
    const comment = page.locator(".comment-item").filter({ hasText: commentContent });
    await expect(comment).toBeVisible();
    await comment.getByRole("button", { name: "Report comment" }).click();
    await expect(reportDialog.locator("[data-readonly-target]").nth(0))
        .toHaveText("Comment");
    await expect(reportDialog.locator("[data-readonly-target]")
        .filter({ hasText: commentContent }))
        .toHaveText(commentContent);
    await expect(reportDialog.locator("[data-readonly-target]")
        .filter({ hasText: "Test community_user" }))
        .toHaveText(`Test community_user`);
    const reportedComment = await pool.query(
        "SELECT comment_id FROM comments WHERE user_id = $1 AND chapter_id = $2 AND content = $3",
        [reporter.user_id, novel.chapters[0], commentContent]
    );
    expect(reportedComment.rowCount).toBe(1);
    await expect(reportDialog.locator("[data-readonly-target]").nth(3))
        .toHaveText(String(reportedComment.rows[0].comment_id));
    await expectStaticTargets();
    await reportDialog.locator('[name="reason"]').selectOption("harassment");
    await reportDialog.locator('[name="details"]')
        .fill("This comment contains targeted harassment.");
    await reportDialog.getByRole("button", { name: "Submit report" }).click();
    await expect(reportDialog.locator(".report-dialog-success")).toBeVisible();

    await page.goto("/reports.html");
    await expect(page.locator("#my-reports")).toContainText("Report ID:");
    await expect(page.locator("#my-reports")).toContainText("Pending");

    const deniedAdminPage = await page.request.get("/api/reports/admin");
    expect(deniedAdminPage.status()).toBe(403);
    const deniedAnnouncementAdmin = await page.request.get("/api/announcements/admin");
    expect(deniedAnnouncementAdmin.status()).toBe(403);

    const baseURL = new URL(page.url()).origin;
    const adminContext = await browser.newContext({ baseURL });
    const adminPage = await adminContext.newPage();
    const admin = await register(adminPage, "community_admin");
    await pool.query(
        "UPDATE users SET role = 'ADMIN', is_admin = TRUE WHERE user_id = $1",
        [admin.user_id]
    );
    await adminPage.goto("/admin.html");
    await expect(adminPage.locator("#reports-admin-panel")).toBeVisible();
    await adminPage.locator("#admin-reports-link").click();
    await expect(adminPage).toHaveURL(/#reports-admin-panel$/);
    await adminPage.locator("#reports-query").fill("Automated test report");
    await adminPage.locator("#reports-filter-form button[type=submit]").click();
    await adminPage.locator("#reports-results button").first().click();
    await expect(adminPage.locator("#reports-detail"))
        .toContainText(`Test community_user`);
    await expect(adminPage.locator("#reports-detail"))
        .toContainText("Assigned admin: Unassigned");
    await adminPage.locator("#report-review-note-" + novelReportId)
        .fill("Claiming this report for review");
    await adminPage.getByRole("button", { name: "Claim Report" }).click();
    await expect(adminPage.locator("#admin-status"))
        .toContainText("Report claimed for review.");
    await expect(adminPage.locator("#reports-detail"))
        .toContainText(`Assigned admin: ${admin.display_name}`);
    await adminPage.locator("#reports-detail form select").selectOption("resolved");
    await adminPage.locator("#report-review-note-" + novelReportId)
        .fill("The report was reviewed and resolved.");
    await adminPage.locator("#reports-detail form button[type=submit]").click();
    await expect(adminPage.locator("#admin-status")).toContainText("Report decision saved.");
    await expect(adminPage.locator("#reports-detail"))
        .toContainText("Claimed for review");
    await expect(adminPage.locator("#reports-detail"))
        .toContainText(admin.display_name);

    const announcementTitle = `Browser announcement ${Date.now()}`;
    await adminPage.locator("#announcement-title-input").fill(announcementTitle);
    await adminPage.locator("#announcement-content-input")
        .fill("Announcement visible to intended users");
    await adminPage.locator("#announcement-link-url")
        .fill("/announcements.html");
    await adminPage.locator("#announcement-link-label").fill("Read more");
    await adminPage.locator("#announcement-is-pinned").check();
    await adminPage.locator("#announcement-pin-order").fill("2");
    await adminPage.locator("#announcement-preview-button").click();
    await expect(adminPage.locator("#announcement-preview"))
        .toContainText("Read more");
    await expect(adminPage.locator("#announcement-preview a"))
        .toHaveAttribute("href", "/announcements.html");
    await adminPage.locator("#announcement-save").click();
    await expect(adminPage.locator("#admin-status")).toContainText("Draft created.");
    await expect(adminPage.locator("#announcements-results"))
        .toContainText(announcementTitle);
    await adminPage.locator("#announcements-results button").first().click();
    await adminPage.locator("#announcement-publish").click();
    await expect(adminPage.locator("#admin-status")).toContainText("Announcement published.");

    await adminPage.locator("#announcement-clear").click();
    const secondAnnouncementTitle = `Second website announcement ${Date.now()}`;
    await adminPage.locator("#announcement-title-input")
        .fill(secondAnnouncementTitle);
    await adminPage.locator("#announcement-content-input")
        .fill("A second public website announcement");
    await adminPage.locator("#announcement-link-url")
        .fill("https://example.test/announcement");
    await adminPage.locator("#announcement-link-label").fill("External details");
    await adminPage.locator("#announcement-is-pinned").check();
    await adminPage.locator("#announcement-pin-order").fill("1");
    await adminPage.locator("#announcement-save").click();
    await expect(adminPage.locator("#announcements-results"))
        .toContainText(secondAnnouncementTitle);
    await adminPage.locator("#announcements-results button").first().click();
    await adminPage.locator("#announcement-publish").click();
    await expect(adminPage.locator("#admin-status"))
        .toContainText("Announcement published.");

    const privateTitle = `Private notification ${Date.now()}`;
    const privateMessage = "Message for the selected account only";
    await adminPage.locator("#private-notification-title").fill(privateTitle);
    await adminPage.locator("#private-notification-message").fill(privateMessage);
    await adminPage.locator("#private-notification-user-search")
        .fill("community_user");
    await adminPage.locator("#private-notification-user-search-button").click();
    await expect(adminPage.locator("#private-notification-user-search-results"))
        .toContainText("community_user");
    await adminPage.locator("#private-notification-user-search-results button")
        .first().click();
    await expect(adminPage.locator("#private-notification-user-ids"))
        .toHaveValue(new RegExp(String(reporter.user_id)));
    await adminPage.locator("#private-notification-form button[type=submit]")
        .click();
    await expect(adminPage.locator("#admin-status"))
        .toContainText("Private notification sent to 1 recipient");

    await page.goto("/announcements.html");
    await expect(page.locator("#announcements-list")).toContainText(announcementTitle);
    await expect(page.locator("#announcements-list"))
        .toContainText(secondAnnouncementTitle);
    await expect(page.locator("#announcements-list"))
        .not.toContainText(privateTitle);
    await page.locator("#announcements-list article")
        .filter({ hasText: announcementTitle })
        .getByRole("button").click();
    await expect(page.locator("#announcement-dialog")).toBeVisible();
    await expectDialogCentered(page.locator("#announcement-dialog"));
    await expect(page.locator("#announcement-content"))
        .toContainText("Announcement visible to intended users");

    await page.goto("/notifications.html");
    const privateNotificationCard = page.locator("#notification-list article")
        .filter({ hasText: privateMessage });
    await expect(privateNotificationCard).toContainText(privateTitle);
    await expect(privateNotificationCard).toContainText(privateMessage);

    await page.goto("/");
    const carousel = page.locator("#home-announcements");
    await expect(carousel).toBeVisible();
    await expect(carousel).toContainText(secondAnnouncementTitle);
    await expect(carousel.locator(".announcement-carousel__indicator"))
        .toHaveCount(2);
    await expect(carousel.locator(".announcement-carousel__link"))
        .toHaveAttribute("href", "https://example.test/announcement");
    await expect(carousel.locator(".announcement-carousel__link"))
        .toHaveAttribute("target", "_blank");
    await expect(carousel.locator(".announcement-carousel__link"))
        .toHaveAttribute("rel", "noopener noreferrer");
    await carousel.getByRole("button", { name: "Next announcement" }).click();
    await expect(carousel).toContainText(announcementTitle);
    await expect(carousel.locator(".announcement-carousel__link"))
        .toHaveAttribute("href", "/announcements.html");
    await carousel.locator(".announcement-carousel__indicator").nth(0).click();
    await expect(carousel.locator(".announcement-carousel__indicator").nth(0))
        .toHaveAttribute("aria-current", "true");
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.reload();
    await expect(page.locator("#announcement-autoplay"))
        .toBeDisabled();
    await expect(page.locator("#announcement-autoplay"))
        .toHaveAttribute(
            "aria-label",
            "Automatic announcements are disabled by reduced motion preference"
        );
    await page.emulateMedia({ reducedMotion: "no-preference" });

    const superContext = await browser.newContext({ baseURL });
    const superPage = await superContext.newPage();
    const superAdmin = await register(superPage, "community_super");
    await pool.query(
        "UPDATE users SET role = 'SUPER_ADMIN', is_admin = TRUE WHERE user_id = $1",
        [superAdmin.user_id]
    );
    await superPage.goto("/admin.html");
    await expect(superPage.locator("#announcements-admin-panel")).toBeVisible();
    expect((await superPage.request.get("/api/reports/admin")).status()).toBe(200);
    expect((await superPage.request.get("/api/announcements/admin")).status()).toBe(200);

    await superPage.locator("#account-query").fill(reporter.username);
    await superPage.locator("#account-search button[type=submit]").click();
    const reporterDetails = superPage.locator(
        '#account-results [data-action="account-detail"]'
    );
    await expect(reporterDetails).toHaveCount(1);
    await reporterDetails.click();
    await superPage.locator("#account-detail textarea").first()
        .fill("Playwright administrator assignment");
    superPage.once("dialog", dialog => dialog.accept());
    await superPage.getByRole("button", { name: "Appoint as ADMIN" }).click();
    await expect(superPage.locator("#admin-status"))
        .toContainText("Administrator role assigned.");
    await expect(superPage.locator("#account-detail"))
        .toContainText("Role: ADMIN");

    await superPage.locator("#account-detail textarea").first()
        .fill("Playwright administrator removal");
    superPage.once("dialog", dialog => dialog.accept());
    await superPage.getByRole("button", { name: "Remove ADMIN Role" }).click();
    await expect(superPage.locator("#admin-status"))
        .toContainText("Administrator role removed.");
    await expect(superPage.locator("#account-detail"))
        .toContainText("Role: USER");
    const roleAudit = await pool.query(
        `SELECT actor_role, action
         FROM admin_action_logs
         WHERE target_user_id = $1
           AND action IN ('admin_role_granted', 'admin_role_revoked')
         ORDER BY log_id`,
        [reporter.user_id]
    );
    expect(roleAudit.rows.map(row => [row.actor_role, row.action])).toEqual([
        ["SUPER_ADMIN", "admin_role_granted"],
        ["SUPER_ADMIN", "admin_role_revoked"]
    ]);

    await superContext.close();
    await adminContext.close();
});

test("theme preferences, English button labels, and responsive pages", async ({ page, browser }) => {
    test.setTimeout(240_000);
    const account = await register(page, "theme_ui");
    await pool.query(
        "UPDATE users SET role = 'ADMIN', is_admin = TRUE WHERE user_id = $1",
        [account.user_id]
    );
    const { novelId, chapters } = await createPublishedNovel(
        account,
        `Theme novel ${randomUUID().slice(0, 8)}`
    );
    const commentContent = "ความคิดเห็นที่ผู้ใช้เขียนไว้";
    await pool.query(
        `INSERT INTO comments (user_id, chapter_id, content)
         VALUES ($1, $2, $3)`,
        [account.user_id, chapters[0], commentContent]
    );

    await page.goto("/");
    await page.evaluate(() => localStorage.removeItem("noveltail-theme"));
    await page.emulateMedia({ colorScheme: "dark" });
    await page.reload();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
    const darkBackground = await page.locator("html").evaluate(element =>
        getComputedStyle(element).getPropertyValue("--nt-bg").trim()
    );
    const themeToggle = page.locator(".theme-toggle");
    await expect(themeToggle).toHaveText(/Light mode/);
    await themeToggle.click();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
    const lightBackground = await page.locator("html").evaluate(element =>
        getComputedStyle(element).getPropertyValue("--nt-bg").trim()
    );
    expect(lightBackground).not.toBe(darkBackground);
    await expect.poll(() =>
        page.evaluate(() => localStorage.getItem("noveltail-theme"))
    ).toBe("light");
    await page.reload();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "light");

    await page.evaluate(() => localStorage.removeItem("noveltail-theme"));
    await page.emulateMedia({ colorScheme: "dark" });
    await page.reload();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
    await page.emulateMedia({ colorScheme: "light" });
    await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
    await page.locator(".theme-toggle").click();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");

    const cssResponse = await page.request.get("/tailwind.css");
    expect(cssResponse.status()).toBe(200);
    expect(await cssResponse.text()).toContain("--nt-bg");

    const guestContext = await browser.newContext();
    const guestPage = await guestContext.newPage();
    await guestPage.emulateMedia({ colorScheme: "dark" });
    await guestPage.goto(new URL("/auth.html", page.url()).toString());
    await expect(guestPage.locator(".theme-toggle")).toBeVisible();
    await expect(guestPage.locator("[data-report-type]")).toHaveCount(0);
    await expect(guestPage.locator("#login-tab")).toHaveText("Login");
    await expect(guestPage.locator("#register-tab")).toHaveText("Register");
    await expect(guestPage.locator("nav")).toHaveCount(0);
    await expect(guestPage.locator("html")).toHaveAttribute("data-theme", "dark");
    const darkLoginSurface = await guestPage.locator(".auth-card")
        .evaluate(element => getComputedStyle(element).backgroundColor);
    expect(darkLoginSurface).not.toBe("rgb(255, 255, 255)");
    const darkLoginHeader = await guestPage.locator(".auth-header")
        .evaluate(element => getComputedStyle(element).backgroundColor);
    expect(darkLoginHeader).not.toBe("rgb(255, 255, 255)");
    await guestPage.locator(".theme-toggle").click();
    await expect(guestPage.locator("html")).toHaveAttribute("data-theme", "light");
    await expect.poll(() =>
        guestPage.locator(".auth-card")
            .evaluate(element => getComputedStyle(element).backgroundColor)
    ).toBe("rgb(255, 255, 255)");
    await guestContext.close();

    const routes = [
        "/",
        `/novel.html?id=${novelId}`,
        `/reader.html?novelId=${novelId}&chapterId=${chapters[0]}`,
        "/create-novel.html",
        `/edit-novel.html?id=${novelId}`,
        "/edit-profile.html",
        "/my-novels.html",
        `/write.html?novelId=${novelId}`,
        "/wallet.html",
        "/notifications.html",
        "/bookmarks.html",
        "/history.html",
        `/profile.html?username=${encodeURIComponent(account.username)}`,
        "/admin.html",
        "/reports.html",
        "/appeals.html",
        "/announcements.html"
    ];

    const surfaceSelectors = [
        ".admin-panel", ".admin-list", ".admin-detail", ".appeal-header",
        ".appeal-page section", ".community-panel", ".community-card",
        ".notification-filters", ".notification-actions", ".notification-card",
        ".notification-dialog", ".wallet-card", ".wallet-section", ".panel",
        ".chapter-sidebar", ".chapter-sidebar-heading", ".novel-item",
        ".editor-placeholder", ".chapter-navigation a", ".reader-toolbar button",
        ".comment-reply-item", ".profile-nav", ".profile-nav-shortcut",
        ".image-crop-dialog", ".image-crop-preview-panel",
        ".image-crop-actions", ".report-dialog", ".bookmark-card",
        ".history-card", ".empty-state", ".feedback:not(.error)",
        ".history-feedback:not(.error)", ".container:has(#create-form)",
        ".container:has(#edit-form)", ".container:has(#profile-form)",
        ".chapter-content", ".profile-message", ".auth-card",
        "header.auth-header"
    ];

    for (const width of [390, 1440]) {
        await page.setViewportSize({ width, height: 900 });
        for (const route of routes) {
            for (const theme of ["light", "dark"]) {
                await page.evaluate(
                    value => localStorage.setItem("noveltail-theme", value),
                    theme
                );
                await page.goto(route);
                await page.waitForLoadState("networkidle");
                await expect(page.locator(".theme-toggle")).toBeVisible();
                await expect(page.locator("html"))
                    .toHaveAttribute("data-theme", theme);

                if (route.startsWith("/reader.html")) {
                    await expect(page.locator("#comments-list"))
                        .toContainText(commentContent);
                }

                const dimensions = await page.evaluate(() => ({
                    viewport: document.documentElement.clientWidth,
                    page: document.documentElement.scrollWidth
                }));
                expect(dimensions.page, `${route} overflows at ${width}px`)
                    .toBeLessThanOrEqual(dimensions.viewport + 1);

                const labels = await page.locator("button").evaluateAll(buttons =>
                    buttons.map(button => ({
                        name: button.getAttribute("aria-label") ||
                            button.innerText.trim(),
                        title: button.title,
                        containsChapterTitle: button.classList.contains("chapter-item"),
                        text: button.innerText.trim()
                    }))
                );
                for (const label of labels) {
                    expect(label.name, `${route}: accessible button label`)
                        .not.toMatch(/[\u0E00-\u0E7F]/);
                    expect(label.title, `${route}: button tooltip`)
                        .not.toMatch(/[\u0E00-\u0E7F]/);
                    if (!label.containsChapterTitle) {
                        expect(label.text, `${route}: button text`)
                            .not.toMatch(/[\u0E00-\u0E7F]/);
                    }
                }

                if (theme === "dark") {
                    const whiteSurfaces = await page.evaluate(selectors =>
                        selectors.flatMap(selector =>
                            [...document.querySelectorAll(selector)]
                                .filter(element => {
                                    const style = getComputedStyle(element);
                                    return style.display !== "none" &&
                                        style.backgroundColor === "rgb(255, 255, 255)";
                                })
                                .map(() => selector)
                        ),
                        surfaceSelectors
                    );
                    expect(whiteSurfaces, `${route}: unintended white dark-mode surfaces`)
                        .toEqual([]);
                }
            }
        }
    }
});
