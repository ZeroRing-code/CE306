const app = document.getElementById("app");
const loginRequired = document.getElementById("login-required");
const novelList = document.getElementById("novel-list");
const novelCount = document.getElementById("novel-count");
const message = document.getElementById("message");

async function api(url, options = {}) {
    const response = await fetch(url, {
        credentials: "same-origin",
        ...options
    });

    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
        throw new Error(data.message || "Something went wrong.");
    }

    return data;
}

async function initialize() {
    try {
        const account = await api("/api/auth/me");

        if (!account.authenticated) {
            loginRequired.hidden = false;
            return;
        }

        app.hidden = false;
        await loadNovels();

    } catch {
        loginRequired.hidden = false;
    }
}

async function loadNovels() {
    try {
        const data = await api("/api/writer/novels");

        novelList.replaceChildren();

        novelCount.textContent =
            `${data.novels.length} novels`;

        if (data.novels.length === 0) {
            novelList.textContent =
                "You have no novels yet. Create your first story.";
            return;
        }

        data.novels.forEach(novel => {
            const card = document.createElement("article");
            card.className = "my-novel-card";

            const info = document.createElement("div");

            const title = document.createElement("h3");
            title.textContent = novel.title;

            const description = document.createElement("p");
            description.textContent =
                novel.description || "No description available.";

            const detail = document.createElement("p");
            detail.textContent =
                `${novel.chapter_count} chapters · ${novel.published_count} published`;

            const genres = document.createElement("p");
            genres.textContent = (novel.genres || [])
                .map(g => g.genre_name)
                .join(" / ");

            info.append(title, description, detail, genres);

            const actions = document.createElement("div");
            actions.className = "novel-actions";

            const manage = document.createElement("a");
            manage.href =
                `/write.html?novelId=${encodeURIComponent(novel.novel_id)}`;
            manage.className = "manage-link";
            manage.textContent = "Manage Chapters";

            const remove = document.createElement("button");
            remove.type = "button";
            remove.className = "delete-button";
            remove.textContent = "Delete Novel";
            remove.title = "Delete this novel";

            remove.addEventListener("click", async () => {
                const confirmed = confirm(
                    `Delete the novel "${novel.title}"?\n` +
                    "Its chapters and related data will also be deleted."
                );

                if (!confirmed) return;

                remove.disabled = true;

                try {
                    await api(`/api/writer/novels/${novel.novel_id}`, {
                        method: "DELETE"
                    });

                    message.textContent = "Novel deleted.";
                    await loadNovels();

                } catch (error) {
                    alert(error.message);
                    remove.disabled = false;
                }
            });

            const edit = document.createElement("a");

edit.href = `/edit-novel.html?id=${encodeURIComponent(novel.novel_id)}`;
edit.className = "edit-link";
edit.textContent = "Edit";

actions.append(edit, manage, remove);
            card.append(info, actions);
            novelList.appendChild(card);
        });

    } catch (error) {
        novelList.textContent = error.message;
    }
}

initialize();