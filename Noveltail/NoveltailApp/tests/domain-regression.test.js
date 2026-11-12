const assert = require("node:assert/strict");
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
let sequence = 0;

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
    const unsafe = !["GET", "HEAD", "OPTIONS"].includes(method.toUpperCase());
    if (unsafe) {
        const csrfResponse = await fetch(`${baseUrl}/api/auth/csrf`);
        const token = (await csrfResponse.json()).token;
        headers.Origin = baseUrl;
        headers["X-CSRF-Token"] = token;
        headers.Cookie = `${headers.Cookie ? `${headers.Cookie}; ` : ""}noveltail_csrf=${encodeURIComponent(token)}`;
    }
    if (body !== undefined) headers["Content-Type"] = "application/json";
    const response = await fetch(`${baseUrl}${path}`, {
        method,
        headers,
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

async function createUser(prefix) {
    const name = `${prefix}_${Date.now()}${++sequence}`.slice(0, 30);
    const response = await request("/api/auth/register", {
        method: "POST",
        body: {
            username: name,
            display_name: `Test ${prefix}`,
            email: `${name}@example.test`,
            password: "TestPassword123!"
        }
    });
    assert.equal(response.status, 201, JSON.stringify(response.data));
    const cookie = response.headers.get("set-cookie");
    const user = { ...response.data.user, cookie: cookie.split(";")[0] };
    return user;
}

async function createNovel(author, title, chapterCount = 1) {
    const novelResult = await pool.query(
        `INSERT INTO novels (user_id, title, description)
         VALUES ($1, $2, 'Regression test novel')
         RETURNING novel_id`,
        [author.user_id, `${title}_${Date.now()}_${sequence}`]
    );
    const novelId = novelResult.rows[0].novel_id;
    const chapters = [];
    for (let index = 1; index <= chapterCount; index += 1) {
        const chapterResult = await pool.query(
            `INSERT INTO chapters (
                novel_id, chapter_number, title, content, status, published_at
             )
             VALUES ($1, $2, $3, 'Test chapter content', 'published', CURRENT_TIMESTAMP)
             RETURNING chapter_id`,
            [novelId, index, `Chapter ${index}`]
        );
        chapters.push(chapterResult.rows[0].chapter_id);
    }
    return { novelId, chapters };
}

test("Bookmark, Comment, Review, and Reading History regression workflows", async () => {
    assert.equal((await request("/api/bookmarks")).status, 401);
    assert.equal((await request("/api/history")).status, 401);
    assert.equal((await request("/api/reviews/1", {
        method: "POST",
        body: { rating: 5, review_text: "Unauthenticated" }
    })).status, 401);

    const author = await createUser("domain_author");
    const reader = await createUser("domain_reader");
    const otherReader = await createUser("domain_other");
    const { novelId, chapters } = await createNovel(author, "Domain", 2);
    const unavailableNovel = await pool.query(
        `INSERT INTO novels (user_id, title, description)
         VALUES ($1, $2, 'No published chapters')
         RETURNING novel_id`,
        [author.user_id, `Unavailable_${Date.now()}_${sequence}`]
    );

    const bookmark = await request(`/api/bookmarks/${novelId}`, {
        user: reader,
        method: "POST"
    });
    assert.equal(bookmark.status, 201);
    assert.equal(bookmark.data.bookmarked, true);
    assert.equal((await request(`/api/bookmarks/${novelId}`, {
        user: reader,
        method: "POST"
    })).status, 200);
    assert.equal((await request(`/api/bookmarks/${unavailableNovel.rows[0].novel_id}`, {
        user: reader,
        method: "POST"
    })).status, 404);
    assert.equal((await request("/api/bookmarks", { user: reader })).data.bookmarks.length, 1);
    assert.equal((await request("/api/bookmarks", { user: otherReader })).data.bookmarks.length, 0);
    assert.equal((await request(`/api/bookmarks/${novelId}`, {
        user: reader,
        method: "DELETE"
    })).status, 200);
    assert.equal((await request(`/api/bookmarks/${novelId}/status`, { user: reader })).data.bookmarked, false);

    const firstCommentResponse = await request(`/api/comments/${chapters[0]}`, {
        user: reader,
        method: "POST",
        body: { content: `Main comment @${otherReader.username}` }
    });
    assert.equal(firstCommentResponse.status, 201, JSON.stringify(firstCommentResponse.data));
    const firstCommentId = firstCommentResponse.data.comment.comment_id;
    const deniedEdit = await request(`/api/comments/${firstCommentId}`, {
        user: otherReader,
        method: "PUT",
        body: { content: "Not the owner" }
    });
    assert.equal(deniedEdit.status, 404);
    const editedComment = await request(`/api/comments/${firstCommentId}`, {
        user: reader,
        method: "PUT",
        body: { content: "Edited main comment" }
    });
    assert.equal(editedComment.status, 200);
    assert.equal(editedComment.data.comment.content, "Edited main comment");
    assert.equal((await pool.query(
        "SELECT COUNT(*)::int AS count FROM notifications WHERE user_id = $1 AND type = 'mention' AND comment_id = $2",
        [otherReader.user_id, firstCommentId]
    )).rows[0].count, 1);

    const reply = await request(`/api/comments/${chapters[0]}`, {
        user: otherReader,
        method: "POST",
        body: { content: "Reply", parentCommentId: firstCommentId }
    });
    assert.equal(reply.status, 201, JSON.stringify(reply.data));
    assert.equal((await pool.query(
        "SELECT COUNT(*)::int AS count FROM notifications WHERE user_id = $1 AND type = 'comment_reply' AND comment_id = $2",
        [reader.user_id, reply.data.comment.comment_id]
    )).rows[0].count, 1);
    assert.equal((await request(`/api/reactions/comments/${firstCommentId}`, {
        user: otherReader,
        method: "PUT",
        body: { reaction_type: "like" }
    })).status, 200);
    assert.equal((await request(`/api/reactions/comments/${firstCommentId}`, {
        user: reader,
        method: "PUT",
        body: { reaction_type: "invalid" }
    })).status, 400);
    assert.equal((await request(`/api/reactions/comments/${firstCommentId}`, {
        user: otherReader,
        method: "DELETE"
    })).status, 200);
    assert.equal((await request(`/api/reactions/comments/${firstCommentId}`, {
        user: otherReader,
        method: "DELETE"
    })).status, 404);
    for (let index = 0; index < 5; index += 1) {
        const response = await request(`/api/comments/${chapters[1]}`, {
            user: index % 2 ? otherReader : reader,
            method: "POST",
            body: { content: `Root ${index + 2}` }
        });
        assert.equal(response.status, 201, JSON.stringify(response.data));
    }
    const firstCommentNotices = await pool.query(
        "SELECT COUNT(*)::int AS count FROM notifications WHERE user_id = $1 AND type = 'first_comments'",
        [author.user_id]
    );
    assert.equal(firstCommentNotices.rows[0].count, 5);
    const sixthRoot = await request(`/api/comments/${chapters[1]}`, {
        user: reader,
        method: "POST",
        body: { content: "Root number six" }
    });
    assert.equal(sixthRoot.status, 201);
    assert.equal((await pool.query(
        "SELECT COUNT(*)::int AS count FROM notifications WHERE user_id = $1 AND type = 'first_comments'",
        [author.user_id]
    )).rows[0].count, 5);
    assert.equal((await request(`/api/comments/${firstCommentId}`, {
        user: otherReader,
        method: "DELETE"
    })).status, 404);
    assert.equal((await request(`/api/comments/${reply.data.comment.comment_id}`, {
        user: otherReader,
        method: "DELETE"
    })).status, 200);
    assert.equal((await request(`/api/comments/${firstCommentId}`, {
        user: reader,
        method: "DELETE"
    })).status, 200);

    const review = await request(`/api/reviews/${novelId}`, {
        user: reader,
        method: "POST",
        body: { rating: 5, review_text: "Initial review" }
    });
    assert.equal(review.status, 201, JSON.stringify(review.data));
    const duplicateReview = await request(`/api/reviews/${novelId}`, {
        user: reader,
        method: "POST",
        body: { rating: 4, review_text: "Duplicate" }
    });
    assert.equal(duplicateReview.status, 409);
    assert.equal((await request(`/api/reviews/${novelId}`, {
        user: otherReader,
        method: "PUT",
        body: { rating: 1, review_text: "IDOR attempt" }
    })).status, 404);
    const updatedReview = await request(`/api/reviews/${novelId}`, {
        user: reader,
        method: "PUT",
        body: { rating: 4, review_text: "Updated review" }
    });
    assert.equal(updatedReview.status, 200);
    assert.equal(updatedReview.data.review.review_text, "Updated review");
    assert.equal((await request(`/api/reactions/reviews/${updatedReview.data.review.review_id}`, {
        user: otherReader,
        method: "PUT",
        body: { reaction_type: "like" }
    })).status, 200);
    assert.equal((await request(`/api/reactions/reviews/${updatedReview.data.review.review_id}`, {
        user: otherReader,
        method: "DELETE"
    })).status, 200);
    assert.equal((await request(`/api/reviews/${updatedReview.data.review.review_id}`, {
        user: otherReader,
        method: "DELETE"
    })).status, 404);
    assert.equal((await request(`/api/reviews/${updatedReview.data.review.review_id}`, {
        user: reader,
        method: "DELETE"
    })).status, 200);

    const historyOne = await request(`/api/history/${novelId}`, {
        user: reader,
        method: "POST",
        body: { chapterId: chapters[0] }
    });
    assert.equal(historyOne.status, 200);
    const firstReadAt = new Date(historyOne.data.history.last_read_at);
    const historyUpdate = await request(`/api/history/${novelId}`, {
        user: reader,
        method: "POST",
        body: { chapterId: chapters[1] }
    });
    assert.equal(historyUpdate.status, 200);
    assert.equal(historyUpdate.data.history.last_chapter_id, chapters[1]);
    assert.ok(new Date(historyUpdate.data.history.last_read_at) >= firstReadAt);
    const secondNovel = await createNovel(author, "DomainHistory");
    assert.equal((await request(`/api/history/${secondNovel.novelId}`, {
        user: reader,
        method: "POST",
        body: { chapterId: chapters[0] }
    })).status, 404);
    await request(`/api/history/${secondNovel.novelId}`, {
        user: reader,
        method: "POST",
        body: { chapterId: secondNovel.chapters[0] }
    });
    await pool.query(
        "UPDATE reading_history SET last_read_at = CURRENT_TIMESTAMP - INTERVAL '1 day' WHERE user_id = $1 AND novel_id = $2",
        [reader.user_id, novelId]
    );
    const history = await request("/api/history", { user: reader });
    assert.equal(history.status, 200);
    assert.equal(history.data.history.length, 2);
    assert.equal(String(history.data.history[0].novel_id), String(secondNovel.novelId));
    assert.equal((await request("/api/history", { user: otherReader })).data.history.length, 0);
    assert.equal((await request(`/api/history/${novelId}`, {
        user: otherReader,
        method: "DELETE"
    })).status, 404);
});
