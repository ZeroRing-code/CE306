const { test, expect } = require("@playwright/test");
const { randomUUID } = require("node:crypto");
const AxeBuilder = require("@axe-core/playwright").default;
const pool = require("../../db");

const publicPages = [
    "/",
    "/auth.html",
    "/create-novel.html",
    "/edit-novel.html",
    "/my-novels.html",
    "/edit-profile.html",
    "/bookmarks.html",
    "/history.html",
    "/wallet.html",
    "/notifications.html",
    "/reports.html",
    "/announcements.html",
    "/appeals.html",
    "/admin.html"
];

test("WCAG automated scan of all rendered pages", async ({ page }) => {
    test.setTimeout(120_000);
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto("/auth.html");
    const csrfResponse = await page.request.get("/api/auth/csrf");
    const csrf = (await csrfResponse.json()).token;
    const username = `a11y_${Date.now()}_${randomUUID().slice(0, 6)}`.slice(0, 30);
    const registration = await page.request.post("/api/auth/register", {
        headers: {
            Origin: new URL(page.url()).origin,
            "X-CSRF-Token": csrf
        },
        data: {
            username,
            display_name: "Accessibility Tester",
            email: `${username}@example.test`,
            password: "A11yTestPassword123!"
        }
    });
    expect(registration.status()).toBe(201);
    const user = (await registration.json()).user;
    await pool.query(
        "UPDATE users SET role = 'SUPER_ADMIN', is_admin = TRUE WHERE user_id = $1",
        [user.user_id]
    );
    const loginCsrfResponse = await page.request.get("/api/auth/csrf");
    const loginCsrf = (await loginCsrfResponse.json()).token;
    const login = await page.request.post("/api/auth/login", {
        headers: {
            Origin: new URL(page.url()).origin,
            "X-CSRF-Token": loginCsrf
        },
        data: { identifier: username, password: "A11yTestPassword123!" }
    });
    expect(login.status()).toBe(200);

    const novelInsert = await pool.query(
        `INSERT INTO novels (user_id, title, description)
         VALUES ($1, 'A11y test novel', 'Accessibility scan fixture')
         RETURNING novel_id`,
        [user.user_id]
    );
    const novelId = novelInsert.rows[0].novel_id;
    const chapterInsert = await pool.query(
        `INSERT INTO chapters (
            novel_id, chapter_number, title, content, status, published_at,
            is_paid, price
         )
         VALUES ($1, 1, 'A11y test chapter', 'Accessible test content',
                 'published', CURRENT_TIMESTAMP, FALSE, 0)
         RETURNING chapter_id`,
        [novelId]
    );
    const chapterId = chapterInsert.rows[0].chapter_id;
    const pages = [
        ...publicPages.slice(0, 2),
        `/novel.html?id=${novelId}`,
        `/reader.html?novelId=${novelId}&chapterId=${chapterId}`,
        `/write.html?novelId=${novelId}`,
        ...publicPages.slice(2, 4),
        `/profile.html?username=${encodeURIComponent(username)}`,
        ...publicPages.slice(4)
    ];
    const violationsFound = [];
    const observed = [];

    for (const route of pages) {
        await page.goto(route);
        await expect(page.locator("body")).toBeVisible();
        if (route.startsWith("/novel.html")) {
            await expect(page.locator("#novel-title")).toHaveText("A11y test novel");
            await expect(page.locator("#novel-detail")).toBeVisible();
        }
        if (route.startsWith("/reader.html")) {
            await expect(page.locator("#reader-novel-title"))
                .toHaveText("A11y test novel");
        }
        if (route.startsWith("/profile.html")) {
            await expect(page.locator("#profile-name")).not.toBeEmpty();
        }
        const results = await new AxeBuilder({ page })
            .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "best-practice"])
            .analyze();

        observed.push({
            route,
            violations: results.violations.map(({ id, impact, nodes }) => ({
                id,
                impact,
                count: nodes.length
            }))
        });
        for (const violation of results.violations) {
            violationsFound.push({
                route,
                id: violation.id,
                impact: violation.impact,
                nodes: violation.nodes.map(node => ({
                    target: node.target,
                    summary: node.failureSummary
                }))
            });
        }
    }

    console.log("Accessibility scan summary:", JSON.stringify(observed));
    expect(violationsFound).toEqual([]);
});

test("auth tabs and forms are operable by keyboard", async ({ page }) => {
    await page.context().clearCookies();
    await page.goto("/auth.html");
    let activeId = "";
    for (let index = 0; index < 30 && activeId !== "register-tab"; index += 1) {
        await page.keyboard.press("Tab");
        activeId = await page.evaluate(() => document.activeElement?.id || "");
    }

    expect(activeId).toBe("register-tab");
    await page.keyboard.press("Enter");
    await expect(page.locator("#register-form")).toBeVisible();
});

test.afterAll(async () => {
    await pool.end();
});
