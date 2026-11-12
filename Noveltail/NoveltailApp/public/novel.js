const params = new URLSearchParams(location.search);
const novelId = params.get("id");

const detail = document.getElementById("novel-detail");
const message = document.getElementById("page-message");
const chapterList = document.getElementById("chapter-list");

async function getData(url, options = {}) {
    const response = await fetch(url, {
        credentials: "same-origin",
        ...options
    });

    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
        throw new Error(data.message || "Could not load data.");
    }

    return data;
}

const followButton = document.getElementById("novel-follow-button");
const followMessage = document.getElementById("novel-follow-message");

async function loadNovelFollowStatus() {
    followButton.hidden = false;
    followButton.disabled = true;
    followButton.textContent = "Checking follow status...";
    followButton.setAttribute("aria-label", "Checking follow status");
    followButton.title = "Checking follow status";
    try {
        const account = await getData("/api/auth/me");
        if (!account.authenticated) {
            followButton.textContent = "Log in to follow";
            followButton.setAttribute("aria-label", "Log in to follow");
            followButton.title = "Log in to follow this novel";
            followMessage.textContent = "Sign in to follow this novel.";
            return;
        }
        const status = await getData(
            `/api/follows/novels/${encodeURIComponent(novelId)}/status`
        );
        followButton.dataset.following = String(status.following);
        followButton.setAttribute("aria-pressed", String(status.following));
        followButton.textContent = status.following
            ? "Unfollow Novel"
            : "Follow Novel";
        followButton.setAttribute("aria-label", followButton.textContent);
        followButton.title = status.following
            ? "Unfollow this novel"
            : "Follow this novel";
        followButton.disabled = false;
    } catch (error) {
        followButton.textContent = "Unable to load follow status";
        followButton.setAttribute("aria-label", "Unable to load follow status");
        followButton.title = "Unable to load follow status";
        followMessage.textContent = error.message;
    }
}

followButton.addEventListener("click", async () => {
    const following = followButton.dataset.following === "true";
    followButton.disabled = true;
    followMessage.textContent = "Updating...";
    try {
        const result = await getData(
            `/api/follows/novels/${encodeURIComponent(novelId)}`,
            { method: following ? "DELETE" : "POST" }
        );
        followButton.dataset.following = String(result.following);
        followButton.setAttribute("aria-pressed", String(result.following));
        followButton.textContent = result.following
            ? "Unfollow Novel"
            : "Follow Novel";
        followButton.setAttribute("aria-label", followButton.textContent);
        followButton.title = result.following
            ? "Unfollow this novel"
            : "Follow this novel";
        followMessage.textContent = result.following
            ? "Following novel."
            : "Unfollowed novel.";
    } catch (error) {
        followMessage.textContent = error.message;
    } finally {
        followButton.disabled = false;
    }
});


// Load novel details.
async function loadNovel() {
    if (!/^\d+$/.test(novelId || "") || Number(novelId) <= 0) {
        message.textContent = "Novel ID not found.";
        return;
    }

    try {
        const data = await getData(`/api/novels/${novelId}`);
        const novel = data.novel;
        const reportButton = document.getElementById("report-novel-button");
        reportButton.dataset.reportId = String(novel.novel_id || novelId);
        reportButton.hidden = false;

        document.title = `${novel.title} | Noveltail`;

        document.getElementById("novel-title").textContent =
            novel.title;

        document.getElementById("novel-author").textContent =
            `by ${novel.display_name || novel.username}`;

        document.getElementById("novel-description").textContent =
            novel.description || "No description available.";

        const cover = document.getElementById("novel-cover");

        if (novel.cover_image_url) {
            cover.src = novel.cover_image_url;
            cover.hidden = false;
        } else {
            cover.hidden = true;
        }

        // Genres
        const genreContainer =
            document.getElementById("novel-genres");

        genreContainer.replaceChildren();

        novel.genres.forEach(genre => {
            const tag = document.createElement("span");
            tag.className = "genre-tag";
            tag.textContent = genre.genre_name;

            genreContainer.appendChild(tag);
        });

        // Stats
        const stats = document.getElementById("novel-stats");

        stats.textContent =
            `${Number(novel.view_count).toLocaleString("en-US")} views · ` +
            `⭐ ${novel.average_rating} (${novel.review_count} reviews) · ` +
            `${novel.chapter_count} chapters`;

        // Chapters
        await loadChapters(novel);
        await loadNovelFollowStatus();

        detail.hidden = false;
        message.hidden = true;

    } catch (error) {
        message.textContent = error.message;
    }
}


// Load the chapter list.
async function loadChapters(novel) {
    try {
        const data = await getData(
            `/api/novels/${novelId}/chapters`
        );

        const chapters = data.chapters;

        document.getElementById("chapter-count").textContent =
            `${chapters.length} published chapters`;

        chapterList.replaceChildren();

        if (chapters.length === 0) {
            chapterList.textContent = "No published chapters yet.";
            return;
        }

        chapters.forEach(chapter => {
            const link = document.createElement("a");

            link.className = "chapter-link";

            link.href =
                `/reader.html?novelId=${novelId}&chapterId=${chapter.chapter_id}`;

            const title = document.createElement("span");

            title.textContent =
                `Chapter ${chapter.chapter_number}: ${chapter.title}`;

            const arrow = document.createElement("span");
            arrow.textContent = chapter.is_paid
                ? `Unlock · ${Number(chapter.price).toLocaleString("en-US")} coins`
                : "Read →";

            link.append(title, arrow);
            chapterList.appendChild(link);
        });

    } catch (error) {
        chapterList.textContent = error.message;
    }
}

loadNovel();