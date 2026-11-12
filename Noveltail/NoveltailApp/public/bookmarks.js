
const bookmarkList = document.getElementById("bookmark-list");
const emptyState = document.getElementById("empty-state");
const feedback = document.getElementById("feedback");

let bookmarks = [];

function escapeHTML(value) {
    return String(value ?? "").replace(/[&<>"']/g, char => ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#039;"
    })[char]);
}

function showFeedback(message, type = "info") {
    feedback.textContent = message;
    feedback.className = "feedback";

    if (type === "error") {
        feedback.classList.add("error");
    }

    feedback.hidden = !message;
}

function getStatusLabel(status) {
    const labels = {
        ongoing: "Ongoing",
        completed: "Completed",
        hiatus: "On hold"
    };

    return labels[status] || "Status not specified";
}

function formatDate(dateValue) {
    if (!dateValue) return "";

    const date = new Date(dateValue);

    if (Number.isNaN(date.getTime())) return "";

    return new Intl.DateTimeFormat("th-TH", {
        year: "numeric",
        month: "short",
        day: "numeric"
    }).format(date);
}

function getSafeImageUrl(value) {
    if (!value) return "";

    try {
        const url = new URL(value, window.location.origin);

        if (url.protocol === "http:" || url.protocol === "https:") {
            return url.href;
        }
    } catch (error) {
        return "";
    }

    return "";
}

function getNovelUrl(novelId) {
    const params = new URLSearchParams({
        id: String(novelId),
        novelId: String(novelId)
    });

    return `novel.html?${params.toString()}`;
}

function createBookmarkCard(novel) {
    const novelId = escapeHTML(novel.novel_id);
    const novelTitle = escapeHTML(novel.title || "Untitled");

    const author = escapeHTML(
        novel.display_name || novel.username || "Unknown writer"
    );

    const description = escapeHTML(
        novel.description || "No description available."
    );

    const status = escapeHTML(getStatusLabel(novel.status));
    const views = Number(novel.view_count) || 0;
    const date = escapeHTML(formatDate(novel.bookmarked_at));

    const novelUrl = getNovelUrl(novel.novel_id);
    const coverUrl = getSafeImageUrl(novel.cover_image_url);

    const coverHTML = `
        <img
            ${coverUrl ? `src="${escapeHTML(coverUrl)}"` : ""}
            alt="Cover for ${novelTitle}"
            data-default-image="cover"
        >
    `;

    return `
        <article class="bookmark-card">

            <a href="${novelUrl}" class="cover-box">
                ${coverHTML}
            </a>

            <div class="book-info">

                <div class="book-status">
                    <span class="status-label">${status}</span>
                    <span>${date}</span>
                </div>

                <h2>
                    <a href="${novelUrl}">${novelTitle}</a>
                </h2>

                <p class="author">by ${author}</p>

                <p class="description">${description}</p>

                <div class="views">
                    ${views.toLocaleString("en-US")} views
                </div>

                <div class="actions">
                    <a href="${novelUrl}" class="read-button">
                        Read Novel
                    </a>

                    <button
                        type="button"
                        class="remove-button"
                        data-remove-id="${novelId}"
                        aria-label="Remove bookmark"
                        title="Remove bookmark"
                    >
                        Remove
                    </button>
                </div>

            </div>
        </article>
    `;
}

function renderBookmarks() {
    bookmarkList.innerHTML = "";

    if (bookmarks.length === 0) {
        emptyState.hidden = false;
        return;
    }

    emptyState.hidden = true;

    bookmarkList.innerHTML = bookmarks
        .map(createBookmarkCard)
        .join("");
}

async function loadBookmarks() {
    showFeedback("Loading bookmarks...");

    try {
        const response = await fetch("/api/bookmarks", {
            method: "GET",
            credentials: "same-origin",
            headers: {
                Accept: "application/json"
            }
        });

        const data = await response.json().catch(() => ({}));

        if (response.status === 401) {
            throw new Error("Sign in to view your bookmarks.");
        }

        if (!response.ok) {
            throw new Error(
                data.message || "Could not load bookmarks."
            );
        }

        bookmarks = Array.isArray(data.bookmarks)
            ? data.bookmarks
            : [];

        renderBookmarks();
        showFeedback("");

    } catch (error) {
        console.error("Load Bookmarks:", error);

        bookmarkList.innerHTML = "";
        emptyState.hidden = true;

        showFeedback(error.message, "error");
    }
}

bookmarkList.addEventListener("click", async event => {
    const button = event.target.closest("[data-remove-id]");

    if (!button) return;

    const novelId = button.dataset.removeId;

    if (!novelId) return;

    button.disabled = true;
    button.textContent = "Removing...";

    try {
        const response = await fetch(
            `/api/bookmarks/${encodeURIComponent(novelId)}`,
            {
                method: "DELETE",
                credentials: "same-origin",
                headers: {
                    Accept: "application/json"
                }
            }
        );

        const data = await response.json().catch(() => ({}));

        if (response.status === 401) {
            throw new Error("Please sign in again.");
        }

        if (!response.ok) {
            throw new Error(
                data.message || "Could not remove bookmark."
            );
        }

        bookmarks = bookmarks.filter(
            novel => String(novel.novel_id) !== String(novelId)
        );

        renderBookmarks();
        showFeedback("Bookmark removed.");

    } catch (error) {
        console.error("Remove Bookmark:", error);

        showFeedback(error.message, "error");

        button.disabled = false;
        button.textContent = "Remove";
    }
});

loadBookmarks();
