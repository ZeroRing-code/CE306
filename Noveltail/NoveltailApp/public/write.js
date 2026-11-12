const app = document.getElementById("writer-app");
const loginRequired = document.getElementById("login-required");

const chapterList = document.getElementById("chapter-list");
const chapterForm = document.getElementById("chapter-form");

const chapterEditor = document.getElementById("chapter-editor");
const placeholder = document.getElementById("editor-placeholder");

const chapterMessage = document.getElementById("chapter-message");
const pageMessage = document.getElementById("page-message");
const paidCheckbox = document.getElementById("chapter-is-paid");
const priceField = document.getElementById("chapter-price-field");
const priceInput = document.getElementById("chapter-price");

const deleteButton = document.getElementById("delete-chapter-button");

const params = new URLSearchParams(window.location.search);
const novelId = Number(params.get("novelId"));

let currentNovel = null;
let currentChapterId = null;
let chapters = [];


// =====================================
// API HELPER
// =====================================

async function api(url, options = {}) {
    const response = await fetch(url, {
        credentials: "same-origin",
        ...options
    });

    const data = await response.json().catch(() => ({
        message: "The server returned an invalid response."
    }));

    if (!response.ok) {
        throw new Error(data.message || "Something went wrong.");
    }

    return data;
}


// =====================================
// INITIALIZE
// =====================================

async function initialize() {
    if (!Number.isSafeInteger(novelId) || novelId <= 0) {
        pageMessage.textContent = "Select a novel from My Novels.";
        return;
    }

    try {
        const account = await api("/api/auth/me");

        if (!account.authenticated) {
            loginRequired.hidden = false;
            return;
        }

        const data = await api("/api/writer/novels");

        currentNovel = data.novels.find(
            novel => Number(novel.novel_id) === novelId
        );

        if (!currentNovel) {
            pageMessage.textContent =
                "Novel not found or you do not have permission to access it.";
            return;
        }

        app.hidden = false;

        document.getElementById("novel-title").textContent =
            currentNovel.title;

        document.getElementById("novel-description").textContent =
            currentNovel.description || "";

        await loadChapters();

    } catch (error) {
        pageMessage.textContent = error.message;
    }
}


// =====================================
// LOAD CHAPTERS
// =====================================

async function loadChapters(selectId = null) {
    try {
        const data = await api(
            `/api/writer/novels/${novelId}/chapters`
        );

        // Load the chapter list from the API before using forEach.
        if (!Array.isArray(data.chapters)) {
            throw new Error("Invalid chapter list response.");
        }

        chapters = data.chapters;

        chapterList.replaceChildren();

        document.getElementById("chapter-count").textContent =
            chapters.length;

        if (chapters.length === 0) {
            const empty = document.createElement("p");
            empty.textContent = "No chapters yet.";
            empty.style.padding = "15px";

            chapterList.appendChild(empty);
        }

        chapters.forEach(chapter => {
            const button = document.createElement("button");

            button.type = "button";
            button.className = "chapter-item";
            button.dataset.id = chapter.chapter_id;
            button.title = `Edit chapter ${chapter.chapter_number}`;

            const title = document.createElement("strong");

            title.textContent =
                `Chapter ${chapter.chapter_number}: ${chapter.title}`;

            const status = document.createElement("small");

            status.textContent =
                chapter.status === "published"
                    ? "Published"
                    : "Draft";

            button.append(title, status);
            const actionHint = document.createElement("span");
            actionHint.className = "sr-only";
            actionHint.textContent = "Edit chapter";
            button.appendChild(actionHint);

            button.addEventListener("click", () => {
                loadChapter(chapter.chapter_id);
            });

            chapterList.appendChild(button);
        });

        if (selectId !== null) {
            await loadChapter(selectId);
        } else {
            resetEditor();
        }

    } catch (error) {
        chapterList.textContent = error.message;
        console.error("Load Chapters:", error);
    }
}


// =====================================
// LOAD EXISTING CHAPTER
// =====================================

async function loadChapter(chapterId) {
    try {
        const data = await api(
            `/api/writer/novels/${novelId}/chapters/${chapterId}`
        );

        const chapter = data.chapter;

        currentChapterId = Number(chapter.chapter_id);

        chapterForm.elements.chapter_number.value =
            chapter.chapter_number;

        chapterForm.elements.title.value =
            chapter.title;

        chapterForm.elements.content.value =
            chapter.content;
        paidCheckbox.checked = chapter.is_paid === true;
        priceInput.value = chapter.is_paid ? chapter.price : "";
        priceField.hidden = !paidCheckbox.checked;
        priceInput.required = paidCheckbox.checked;

        document.getElementById("editor-mode").textContent =
            "EDIT CHAPTER";

        document.getElementById("editor-title").textContent =
            `Edit Chapter ${chapter.chapter_number}`;

        document.getElementById("chapter-status-label").textContent =
            chapter.status === "published" ? "Published" : "Draft";

        chapterMessage.textContent = "";
        chapterMessage.className = "message";

        chapterEditor.hidden = false;
        placeholder.hidden = true;
        deleteButton.hidden = false;

        document.querySelectorAll(".chapter-item").forEach(button => {
            button.classList.toggle(
                "active",
                Number(button.dataset.id) === currentChapterId
            );
        });

    } catch (error) {
        chapterMessage.textContent = error.message;
        chapterMessage.className = "message error";
    }
}


// =====================================
// RESET FOR NEW CHAPTER
// =====================================

function resetEditor() {
    currentChapterId = null;

    chapterForm.reset();
    paidCheckbox.checked = false;
    priceInput.value = "";
    priceInput.required = false;
    priceField.hidden = true;

    document.getElementById("editor-mode").textContent =
        "NEW CHAPTER";

    document.getElementById("editor-title").textContent =
        "Write a New Chapter";

    document.getElementById("chapter-status-label").textContent =
        "Draft";

    chapterMessage.textContent = "";
    chapterMessage.className = "message";

    chapterEditor.hidden = false;
    placeholder.hidden = true;
    deleteButton.hidden = true;

    document.querySelectorAll(".chapter-item").forEach(button => {
        button.classList.remove("active");
    });

    chapterForm.elements.title.focus();
}

paidCheckbox.addEventListener("change", () => {
    priceField.hidden = !paidCheckbox.checked;
    priceInput.required = paidCheckbox.checked;
    if (!paidCheckbox.checked) {
        priceInput.value = "";
    }
});


// Add a new chapter.

document.getElementById("new-chapter-button")
    .addEventListener("click", resetEditor);


// =====================================
// SAVE NEW / UPDATE EXISTING CHAPTER
// =====================================

chapterForm.addEventListener("submit", async event => {
    event.preventDefault();

    const submitButton = event.submitter;

    const status = submitButton?.dataset.status || "draft";

    // Read values from the actual form.
    const chapterNumber = Number(
        chapterForm.elements.chapter_number.value
    );

    const title = chapterForm.elements.title.value.trim();
    const content = chapterForm.elements.content.value;
    const paid = paidCheckbox.checked;
    const price = paid ? Number(priceInput.value) : 0;

    if (
        paid &&
        (!Number.isSafeInteger(price) || price < 1 || price > 2147483647)
    ) {
        chapterMessage.textContent =
            "Set a price from 1 to 2,147,483,647 coins.";
        chapterMessage.className = "message error";
        return;
    }

    // Validate the chapter number.
    if (
        !Number.isSafeInteger(chapterNumber) ||
        chapterNumber < 0
    ) {
        chapterMessage.textContent =
            "Chapter number must be a whole number greater than or equal to 0.";

        chapterMessage.className = "message error";
        return;
    }

    // Validate the title and content.
    if (!title || !content.trim()) {
        chapterMessage.textContent =
            "Enter a chapter title and content.";

        chapterMessage.className = "message error";
        return;
    }

    // Check for a duplicate chapter number.
    const duplicate = chapters.some(chapter =>
        Number(chapter.chapter_number) === chapterNumber &&
        Number(chapter.chapter_id) !== Number(currentChapterId)
    );

    if (duplicate) {
        chapterMessage.textContent =
            `Chapter number ${chapterNumber} is already in use for this novel.`;

        chapterMessage.className = "message error";
        return;
    }

    const body = {
        chapter_number: chapterNumber,
        title,
        content,
        status,
        is_paid: paid,
        price
    };

    const editing = currentChapterId !== null;

    const url = editing
        ? `/api/writer/novels/${novelId}/chapters/${currentChapterId}`
        : `/api/writer/novels/${novelId}/chapters`;

    if (submitButton) submitButton.disabled = true;

    chapterMessage.textContent = "Saving...";
    chapterMessage.className = "message";

    try {
        const data = await api(url, {
            method: editing ? "PUT" : "POST",
            headers: {
                "Content-Type": "application/json"
            },
            body: JSON.stringify(body)
        });

        chapterMessage.textContent = data.message;
        chapterMessage.className = "message success";

        // Reload the chapter list.
        await loadChapters(data.chapter.chapter_id);
        chapterMessage.textContent = data.message;
        chapterMessage.className = "message success";

        // Update the chapter count in the novel list.
        const novels = await api("/api/writer/novels");

        currentNovel = novels.novels.find(
            novel => Number(novel.novel_id) === novelId
        );

    } catch (error) {
        chapterMessage.textContent = error.message;
        chapterMessage.className = "message error";

    } finally {
        if (submitButton) submitButton.disabled = false;
    }
});


// =====================================
// DELETE CHAPTER
// =====================================

deleteButton.addEventListener("click", async () => {
    if (currentChapterId === null) return;

    const confirmed = confirm(
        "Delete this chapter?\n" +
        "Comments and reading history linked to this chapter will also be deleted."
    );

    if (!confirmed) return;

    deleteButton.disabled = true;

    try {
        const data = await api(
            `/api/writer/novels/${novelId}/chapters/${currentChapterId}`,
            { method: "DELETE" }
        );

        chapterMessage.textContent = data.message;
        chapterMessage.className = "message success";

        await loadChapters();

    } catch (error) {
        chapterMessage.textContent = error.message;
        chapterMessage.className = "message error";

    } finally {
        deleteButton.disabled = false;
    }
});


// =====================================
// START
// =====================================

initialize();