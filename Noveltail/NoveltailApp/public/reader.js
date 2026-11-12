
const params = new URLSearchParams(location.search);

const novelId = params.get("novelId");
const chapterId = params.get("chapterId");

const reader = document.getElementById("reader");
const message = document.getElementById("reader-message");
const content = document.getElementById("chapter-content");
const purchasePanel = document.getElementById("purchase-panel");
const purchaseMessage = document.getElementById("purchase-message");
const unlockButton = document.getElementById("unlock-chapter-button");
const purchaseLoginLink = document.getElementById("purchase-login-link");

let fontSize = 18;


// =====================================
// API HELPER
// =====================================

async function getData(url) {
    const response = await fetch(url, {
        credentials: "same-origin"
    });

    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
        const error = new Error(data.message || "Could not load chapter content.");
        error.status = response.status;
        error.data = data;
        throw error;
    }

    return data;
}


// =====================================
// SAVE READING HISTORY
// =====================================

async function saveReadingHistory() {
    try {
        // Check whether the user is signed in.
        const authResponse = await fetch("/api/auth/me", {
            credentials: "same-origin"
        });

        const authData = await authResponse.json().catch(() => ({}));

        // Do not save history for guests.
        if (!authResponse.ok || !authData.authenticated) {
            return;
        }

        // Save the most recently opened chapter.
        const response = await fetch(
            `/api/history/${encodeURIComponent(novelId)}`,
            {
                method: "POST",
                credentials: "same-origin",
                headers: {
                    "Content-Type": "application/json",
                    "Accept": "application/json"
                },
                body: JSON.stringify({
                    chapterId
                })
            }
        );

        const data = await response.json().catch(() => ({}));

        if (!response.ok) {
            console.error(
                "Save Reading History:",
                data.message || "Could not save reading history."
            );
            return;
        }

        console.log("Reading history saved:", data.history);

    } catch (error) {
        // History failures should not break the reader.
        console.error("Reading History Error:", error);
    }
}


// =====================================
// LOAD CHAPTER
// =====================================

async function loadChapter() {
    if (
        !/^\d+$/.test(novelId || "") ||
        !/^\d+$/.test(chapterId || "") ||
        Number(novelId) <= 0 ||
        Number(chapterId) <= 0
    ) {
        message.textContent = "Novel or chapter ID not found.";
        return;
    }

    try {
        purchasePanel.hidden = true;
        const data = await getData(
            `/api/novels/${novelId}/chapters/${chapterId}`
        );

        const chapter = data.chapter;
        const reportButton = document.getElementById("report-chapter-button");
        reportButton.dataset.reportId = String(chapter.chapter_id);
        reportButton.hidden = false;

        document.title =
            `${chapter.title} | ${chapter.novel_title}`;

        document.getElementById("reader-novel-title").textContent =
            chapter.novel_title;

        document.getElementById("reader-author").textContent =
            `by ${chapter.display_name || chapter.username}`;

        document.getElementById("chapter-number").textContent =
            `Chapter ${chapter.chapter_number}`;

        document.getElementById("chapter-title").textContent =
            chapter.title;

        // Render content as text to prevent unsafe HTML.
        content.textContent = chapter.content;

        document.getElementById("novel-link").href =
            `/novel.html?id=${novelId}`;

        document.getElementById("chapter-list-link").href =
            `/novel.html?id=${novelId}`;

        document.getElementById("back-to-novel").href =
            `/novel.html?id=${novelId}`;

        // Previous chapter.
        const previous = document.getElementById("previous-chapter");

        if (chapter.previous_chapter_id) {
            previous.href =
                `/reader.html?novelId=${novelId}&chapterId=${chapter.previous_chapter_id}`;

            previous.hidden = false;
        } else {
            previous.hidden = true;
        }

        // Next chapter.
        const next = document.getElementById("next-chapter");

        if (chapter.next_chapter_id) {
            next.href =
                `/reader.html?novelId=${novelId}&chapterId=${chapter.next_chapter_id}`;

            next.hidden = false;
        } else {
            next.hidden = true;
        }

        reader.hidden = false;
        message.hidden = true;

        // Save history after successfully loading the chapter.
        saveReadingHistory();

    } catch (error) {
        if (error.status === 402 && error.data?.purchase_required) {
            const chapter = error.data.chapter;
            const reportButton = document.getElementById("report-chapter-button");
            reportButton.dataset.reportId = String(chapter.chapter_id);
            reportButton.hidden = false;
            message.hidden = true;
            purchasePanel.hidden = false;
            document.getElementById("purchase-title").textContent =
                `${chapter.title} · ${Number(chapter.price).toLocaleString("en-US")} coins`;
            document.getElementById("purchase-description").textContent =
                "Unlock this chapter to read the full content. Previous purchasers can read it again at no cost.";
            document.getElementById("purchase-balance").textContent =
                error.data.balance === null
                    ? "Sign in to view your coin balance and unlock this chapter."
                    : `Current balance: ${Number(error.data.balance).toLocaleString("en-US")} coins`;
            unlockButton.hidden = error.data.balance === null;
            purchaseLoginLink.hidden = error.data.balance !== null;
            purchaseLoginLink.href =
                "/auth.html";
            return;
        }
        message.textContent = error.message;
    }
}

unlockButton.addEventListener("click", async () => {
    unlockButton.disabled = true;
    purchaseMessage.textContent = "Unlocking chapter...";
    try {
        const response = await fetch(
            `/api/wallet/chapters/${encodeURIComponent(chapterId)}/unlock`,
            {
                method: "POST",
                credentials: "same-origin",
                headers: {
                    "Content-Type": "application/json",
                    "Idempotency-Key": crypto.randomUUID()
                },
                body: JSON.stringify({})
            }
        );
        const data = await response.json().catch(() => ({}));
        if (!response.ok) {
            throw new Error(data.message || "Could not unlock chapter.");
        }
        await loadChapter();
    } catch (error) {
        purchaseMessage.textContent = error.message;
    } finally {
        unlockButton.disabled = false;
    }
});


// =====================================
// FONT SIZE
// =====================================

document.getElementById("increase-font")
    .addEventListener("click", () => {
        fontSize = Math.min(fontSize + 2, 30);
        content.style.fontSize = `${fontSize}px`;
    });

document.getElementById("decrease-font")
    .addEventListener("click", () => {
        fontSize = Math.max(fontSize - 2, 14);
        content.style.fontSize = `${fontSize}px`;
    });


// =====================================
// START
// =====================================

loadChapter();
