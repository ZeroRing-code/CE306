(() => {
    const status = document.getElementById("announcements-status");
    const list = document.getElementById("announcements-list");
    const dialog = document.getElementById("announcement-dialog");

    async function request(url, options = {}) {
        const response = await fetch(url, {
            credentials: "same-origin",
            ...options
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(data.message || "The action could not be completed.");
        return data;
    }

    function appendText(parent, tag, text) {
        const node = document.createElement(tag);
        node.textContent = text == null ? "" : String(text);
        parent.appendChild(node);
        return node;
    }

    function safeHref(value) {
        if (typeof value !== "string" ||
            /[\u0000-\u001f\u007f\\]/.test(value)) {
            return null;
        }
        if (value.startsWith("/") && !value.startsWith("//")) return value;
        if (!/^https?:\/\//i.test(value)) return null;
        try {
            const url = new URL(value);
            return ["http:", "https:"].includes(url.protocol) &&
                url.hostname && !url.username && !url.password
                ? url.href
                : null;
        } catch {
            return null;
        }
    }

    async function openAnnouncement(announcement, card, privateDelivery = false) {
        try {
            let details = announcement;
            if (privateDelivery) {
                const data = await request(
                    `/api/announcements/${announcement.announcement_id}`
                );
                details = data.announcement;
            }
            document.getElementById("announcement-title").textContent = details.title;
            document.getElementById("announcement-date").textContent =
                new Date(details.published_at).toLocaleString("en-US");
            const content = document.getElementById("announcement-content");
            content.replaceChildren();
            appendText(content, "p", details.content);
            const href = safeHref(details.link_url);
            if (href && details.link_label) {
                const link = appendText(content, "a", details.link_label);
                link.href = href;
                if (!href.startsWith("/") &&
                    new URL(href).origin !== window.location.origin) {
                    link.target = "_blank";
                    link.rel = "noopener noreferrer";
                }
            }
            if (privateDelivery && !details.is_read) {
                await request(
                    `/api/announcements/${announcement.announcement_id}/read`,
                    { method: "PATCH" }
                );
                announcement.is_read = true;
                if (card) {
                    card.classList.remove("is-unread");
                    const readStatus = card.querySelector("[data-read-status]");
                    if (readStatus) readStatus.textContent = "Read";
                }
            }
            dialog.showModal();
        } catch (error) {
            status.textContent = error.message;
        }
    }

    async function load() {
        list.replaceChildren();
        try {
            const data = await request("/api/announcements/public");
            if (!data.announcements.length) {
                appendText(list, "p", "No website announcements yet.");
            }
            data.announcements.forEach(announcement => {
                const card = document.createElement("article");
                card.dataset.announcementId = String(announcement.announcement_id);
                card._announcement = announcement;
                card.className = "community-card";
                appendText(card, "h2", announcement.title);
                appendText(card, "small",
                    new Date(announcement.published_at).toLocaleString("en-US"));
                const preview = announcement.content.length > 240
                    ? `${announcement.content.slice(0, 240).trimEnd()}…`
                    : announcement.content;
                appendText(card, "p", preview);
                const button = document.createElement("button");
                button.type = "button";
                button.textContent = "View Details";
                button.setAttribute("aria-label", "View announcement details");
                button.title = "View announcement details";
                button.addEventListener("click", () =>
                    openAnnouncement(announcement, card));
                const actions = document.createElement("div");
                actions.className = "community-card-actions";
                actions.appendChild(button);
                card.appendChild(actions);
                list.appendChild(card);
            });
        } catch (error) {
            status.textContent = error.message;
        }
    }

    document.getElementById("announcement-close").addEventListener(
        "click",
        () => dialog.close()
    );
    dialog.addEventListener("click", event => {
        if (event.target === dialog) dialog.close();
    });
    const announcementId = new URLSearchParams(location.search).get("id");
    load().then(async () => {
        if (!/^\d+$/.test(announcementId || "")) return;
        const card = [...list.querySelectorAll(".community-card")]
            .find(item => item.dataset.announcementId === announcementId);
        const announcement = card?._announcement;
        if (announcement) {
            await openAnnouncement(announcement, card);
            return;
        }
        await openAnnouncement(
            { announcement_id: announcementId },
            null,
            true
        );
    }).catch(error => {
        status.textContent = error.message;
    });
})();
