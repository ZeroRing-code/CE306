
const historyList = document.getElementById("history-list");
const emptyState = document.getElementById("empty-state");
const feedback = document.getElementById("history-feedback");

let readingHistory = [];

function escapeHTML(value) {
    return String(value ?? "").replace(/[&<>"']/g, char => ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#039;"
    })[char]);
}

function showFeedback(text, isError = false) {
    feedback.textContent = text;
    feedback.className = "history-feedback";
    feedback.classList.toggle("error", isError);
    feedback.hidden = !text;
}

function formatDate(value) {
    if (!value) return "";

    const date = new Date(value);

    if (Number.isNaN(date.getTime())) return "";

    return new Intl.DateTimeFormat("th-TH", {
        year: "numeric",
        month: "short",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit"
    }).format(date);
}

function getSafeImageUrl(value) {
    if (!value) return "";

    try {
        const url = new URL(value, window.location.origin);

        if (
            url.protocol === "http:" ||
            url.protocol === "https:"
        ) {
            return url.href;
        }
    } catch (error) {
        return "";
    }

    return "";
}

function createHistoryCard(item) {
    const novelId = String(item.novel_id);

    const card = document.createElement("article");
    card.className = "history-card";

    // Cover
    const cover = document.createElement("a");
    cover.className = "history-cover";
    cover.href = `/novel.html?id=${encodeURIComponent(novelId)}`;

    const imageUrl = getSafeImageUrl(item.cover_image_url);

    const image = document.createElement("img");

    image.alt = item.title || "Novel cover";
    image.dataset.defaultImage = "cover";

    if (imageUrl) {
        image.src = imageUrl;
    }

    cover.appendChild(image);

    // Information
    const info = document.createElement("div");
    info.className = "history-info";

    const title = document.createElement("h2");
    const titleLink = document.createElement("a");

    titleLink.href =
        `/novel.html?id=${encodeURIComponent(novelId)}`;

    titleLink.textContent = item.title || "Untitled";
    title.appendChild(titleLink);

    const author = document.createElement("p");
    author.className = "author";
    author.textContent =
        `by ${item.display_name || item.username || "Unknown writer"}`;

    const chapter = document.createElement("p");
    chapter.className = "last-chapter";

    if (item.last_chapter_id) {
        chapter.textContent = item.chapter_number !== null
            ? `Last read: Chapter ${item.chapter_number} - ${item.last_chapter_title || ""}`
            : `Last read: ${item.last_chapter_title || "Most recent chapter"}`;
    } else {
        chapter.textContent = "No chapters read yet.";
    }

    const date = document.createElement("p");
    date.className = "last-read";
    date.textContent = `Last read ${formatDate(item.last_read_at)}`;

    // Buttons
    const actions = document.createElement("div");
    actions.className = "history-actions";

    const continueButton = document.createElement("button");

    continueButton.type = "button";
    continueButton.className = "continue-button";
    continueButton.textContent = "Continue Reading";
    continueButton.title = "Continue reading this novel";

    if (item.last_chapter_id) {
        continueButton.addEventListener("click", () => {
            window.location.href =
                `/reader.html?novelId=${encodeURIComponent(novelId)}&chapterId=${encodeURIComponent(item.last_chapter_id)}`;
        });
    } else {
        continueButton.disabled = true;
    }

    const removeButton = document.createElement("button");

    removeButton.type = "button";
    removeButton.className = "remove-button";
    removeButton.textContent = "Delete History";
    removeButton.title = "Delete this reading history";
    removeButton.dataset.removeNovel = novelId;

    actions.append(continueButton, removeButton);

    info.append(
        title,
        author,
        chapter,
        date,
        actions
    );

    card.append(cover, info);

    return card;
}

function renderHistory() {
    historyList.innerHTML = "";

    if (readingHistory.length === 0) {
        emptyState.hidden = false;
        return;
    }

    emptyState.hidden = true;

    readingHistory.forEach(item => {
        historyList.appendChild(createHistoryCard(item));
    });
}

async function loadHistory() {
    showFeedback("Loading reading history...");

    try {
        const response = await fetch("/api/history", {
            credentials: "same-origin",
            headers: {
                Accept: "application/json"
            }
        });

        const data = await response.json().catch(() => ({}));

        if (response.status === 401) {
            throw new Error("Sign in to view your reading history.");
        }

        if (!response.ok) {
            throw new Error(
                data.message || "Could not load reading history."
            );
        }

        readingHistory = Array.isArray(data.history)
            ? data.history
            : [];

        renderHistory();
        showFeedback("");

    } catch (error) {
        console.error("Load History:", error);

        readingHistory = [];
        historyList.innerHTML = "";
        emptyState.hidden = true;

        showFeedback(error.message, true);
    }
}

historyList.addEventListener("click", async event => {
    const button = event.target.closest("[data-remove-novel]");

    if (!button) return;

    const novelId = button.dataset.removeNovel;

    if (!novelId) return;

    const confirmed = window.confirm(
        "Delete the reading history for this novel?"
    );

    if (!confirmed) return;

    button.disabled = true;
    button.textContent = "Deleting...";

    try {
        const response = await fetch(
            `/api/history/${encodeURIComponent(novelId)}`,
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
                data.message || "Could not delete reading history."
            );
        }

        readingHistory = readingHistory.filter(
            item => String(item.novel_id) !== String(novelId)
        );

        renderHistory();
        showFeedback("Reading history deleted.");

    } catch (error) {
        console.error("Delete History:", error);

        showFeedback(error.message, true);

        button.disabled = false;
        button.textContent = "Delete History";
    }
});

loadHistory();
