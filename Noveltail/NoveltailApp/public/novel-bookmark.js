
(() => {
    const params = new URLSearchParams(window.location.search);
    const currentNovelId = params.get("novelId") || params.get("id");

    if (!/^\d+$/.test(String(currentNovelId)) || Number(currentNovelId) <= 0) {
        console.error("Bookmark: novel ID not found.");
        return;
    }

    const titleElement = document.getElementById("novel-title");

    if (!titleElement) {
        console.error("Bookmark: element #novel-title not found.");
        return;
    }

    // =====================================
    // CSS
    // =====================================

    const style = document.createElement("style");

    style.textContent = `
        .nt-bookmark-wrapper {
            margin: 15px 0;
        }

        .nt-bookmark-button {
            padding: 11px 20px;
            border: none;
            border-radius: 9px;
            background: #7656d8;
            color: white;
            font-size: 14px;
            font-weight: 600;
            cursor: pointer;
        }

        .nt-bookmark-button.saved {
            background: #f1edff;
            color: #7656d8;
            border: 1px solid #d8cdfa;
        }

        .nt-bookmark-button:disabled {
            opacity: 0.6;
            cursor: not-allowed;
        }

        .nt-bookmark-message {
            margin-top: 8px;
            font-size: 13px;
            color: #5f5c6a;
        }

        .nt-bookmark-message.error {
            color: #d34d4d;
        }
    `;

    document.head.appendChild(style);

    // =====================================
    // Create the button.
    // =====================================

    const wrapper = document.createElement("div");
    wrapper.className = "nt-bookmark-wrapper";

    const button = document.createElement("button");
    button.type = "button";
    button.className = "nt-bookmark-button";
    button.textContent = "Checking bookmark...";

    const message = document.createElement("p");
    message.className = "nt-bookmark-message";
    message.setAttribute("role", "status");

    wrapper.append(button, message);

    // Insert the button below the title.
    titleElement.insertAdjacentElement("afterend", wrapper);

    let bookmarked = false;
    let loggedIn = false;
    let busy = false;

    // =====================================
    // Update the button appearance.
    // =====================================

    function updateButton() {
        button.classList.toggle("saved", bookmarked);
        button.setAttribute("aria-pressed", String(bookmarked));

        button.disabled = busy || !loggedIn;

        if (busy) {
            button.textContent = "Saving...";
        } else if (!loggedIn) {
            button.textContent = "Log in to bookmark";
        } else if (bookmarked) {
            button.textContent = "Bookmarked · Remove";
        } else {
            button.textContent = "Bookmark";
        }
        button.title = bookmarked ? "Remove bookmark" : "Bookmark this novel";
        button.setAttribute(
            "aria-label",
            bookmarked ? "Remove bookmark" : "Bookmark this novel"
        );
    }

    // =====================================
    // Check bookmark status.
    // =====================================

    async function loadStatus() {
        try {
            const response = await fetch(
                `/api/bookmarks/${encodeURIComponent(currentNovelId)}/status`,
                {
                    credentials: "same-origin"
                }
            );

            const data = await response.json();

            if (response.status === 401) {
                loggedIn = false;
                updateButton();

                message.textContent =
                    "Sign in to bookmark this novel.";

                return;
            }

            if (!response.ok) {
                throw new Error(data.message || "Could not check bookmark status.");
            }

            loggedIn = true;
            bookmarked = Boolean(data.bookmarked);

            updateButton();

        } catch (error) {
            console.error("Bookmark Status:", error);

            button.disabled = true;
            button.textContent = "Unable to load bookmark";
            button.setAttribute("aria-label", "Unable to load bookmark");
            button.title = "Unable to load bookmark";

            message.classList.add("error");
            message.textContent = error.message;
        }
    }

    // =====================================
    // Add or remove a bookmark.
    // =====================================

    button.addEventListener("click", async () => {
        if (!loggedIn || busy) return;

        busy = true;
        updateButton();

        const method = bookmarked ? "DELETE" : "POST";

        try {
            const response = await fetch(
                `/api/bookmarks/${encodeURIComponent(currentNovelId)}`,
                {
                    method,
                    credentials: "same-origin"
                }
            );

            const data = await response.json();

            if (response.status === 401) {
                loggedIn = false;
                throw new Error("Please sign in again.");
            }

            if (!response.ok) {
                throw new Error(data.message || "The action could not be completed.");
            }

            bookmarked = Boolean(data.bookmarked);

            message.classList.remove("error");
            message.textContent = data.message || "Done.";

        } catch (error) {
            console.error("Bookmark Action:", error);

            message.classList.add("error");
            message.textContent = error.message;

        } finally {
            busy = false;
            updateButton();
        }
    });

    // Initialize and check the status.
    updateButton();
    loadStatus();

    console.log("Noveltail Bookmark loaded:", currentNovelId);
})();
