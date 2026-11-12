const notificationList = document.getElementById("notification-list");
const statusMessage = document.getElementById("notification-status");
const emptyMessage = document.getElementById("notification-empty");
const confirmDialog = document.getElementById("confirm-dialog");
const summaryDialog = document.getElementById("summary-dialog");
const categoryLabels = {
    system: "System",
    account: "Account",
    novel: "Novel",
    engagement: "Engagement",
    transaction: "Transaction"
};
let currentPage = 1;
let currentTotal = 0;
let currentUnread = 0;
let globalUnread = 0;
let pendingBulk = null;
let reloadTimer;

async function request(url, options = {}) {
    const response = await fetch(url, {
        credentials: "same-origin",
        ...options
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
        const error = new Error(data.message || "Something went wrong.");
        error.status = response.status;
        error.data = data;
        throw error;
    }
    return data;
}

function currentFilters(statusOverride) {
    return {
        category: document.getElementById("filter-category").value,
        status: statusOverride ||
            document.getElementById("filter-status").value,
        q: document.getElementById("filter-search").value.trim(),
        searchLogic: document.getElementById("filter-logic").value
    };
}

function queryString(filters, page) {
    const query = new URLSearchParams({ page: String(page) });
    Object.entries(filters).forEach(([key, value]) => {
        if (value) query.set(key, value);
    });
    return query.toString();
}

function formatDate(value) {
    return new Intl.DateTimeFormat("th-TH", {
        dateStyle: "medium",
        timeStyle: "short"
    }).format(new Date(value));
}

function createNotificationCard(notification) {
    const card = document.createElement("article");
    card.className = `notification-card${notification.is_read ? "" : " is-unread"}`;
    const content = document.createElement("div");
    const title = document.createElement("h2");
    title.textContent = notification.metadata?.source ===
        "admin_private_notification" &&
        typeof notification.metadata.title === "string"
        ? notification.metadata.title
        : categoryLabels[notification.category] || "Notification";
    const message = document.createElement("p");
    message.textContent = notification.message;
    const date = document.createElement("time");
    date.dateTime = notification.created_at;
    date.textContent = formatDate(notification.created_at);
    content.append(title, message, date);
    const actions = document.createElement("div");
    actions.className = "notification-card-actions";
    const announcementId = notification.metadata?.announcementId;
    if (notification.type === "system" &&
        /^\d+$/.test(String(announcementId || ""))) {
        const announcementLink = document.createElement("a");
        announcementLink.href =
            `/announcements.html?id=${encodeURIComponent(announcementId)}`;
        announcementLink.textContent = "Open Announcement";
        actions.appendChild(announcementLink);
    }
    if (!notification.is_read) {
        const readButton = document.createElement("button");
        readButton.type = "button";
        readButton.textContent = "Mark as Read";
        readButton.title = "Mark notification as read";
        readButton.addEventListener("click", async () => {
            try {
                await request(`/api/notifications/${notification.notification_id}/read`, {
                    method: "PATCH"
                });
                await loadNotifications();
                document.dispatchEvent(new Event("noveltail:notifications-changed"));
            } catch (error) {
                statusMessage.textContent = error.message;
            }
        });
        actions.appendChild(readButton);
    }
    const deleteButton = document.createElement("button");
    deleteButton.type = "button";
    deleteButton.textContent = "Delete";
    deleteButton.title = "Delete notification";
    deleteButton.addEventListener("click", async () => {
        try {
            await request(`/api/notifications/${notification.notification_id}`, {
                method: "DELETE"
            });
            await loadNotifications();
            document.dispatchEvent(new Event("noveltail:notifications-changed"));
        } catch (error) {
            statusMessage.textContent = error.message;
        }
    });
    actions.appendChild(deleteButton);
    card.append(content, actions);
    return card;
}

async function loadNotifications() {
    statusMessage.textContent = "Loading...";
    try {
        const filters = currentFilters();
        const data = await request(
            `/api/notifications?${queryString(filters, currentPage)}`
        );
        currentTotal = data.total;
        currentUnread = data.unread;
        globalUnread = data.globalUnread;
        notificationList.replaceChildren(
            ...data.notifications.map(createNotificationCard)
        );
        emptyMessage.hidden = data.total !== 0;
        const pages = Math.max(1, Math.ceil(data.total / data.pageSize));
        if (currentPage > pages) {
            currentPage = 1;
            return loadNotifications();
        }
        document.getElementById("page-label").textContent =
            `Page ${data.page} / ${pages}`;
        document.getElementById("previous-page").disabled = currentPage <= 1;
        document.getElementById("next-page").disabled = currentPage >= pages;
        updateActions();
        statusMessage.textContent = `${data.unread} unread`;
    } catch (error) {
        statusMessage.textContent = error.message;
        if (error.status === 401) window.location.href = "/auth.html";
    }
}

function updateActions() {
    const readAll = document.getElementById("read-all");
    readAll.disabled = globalUnread === 0;
    document.getElementById("read-all-reason").textContent =
        globalUnread ? "" : "No unread notifications.";
    const clearRead = document.getElementById("clear-read");
    const clearAll = document.getElementById("clear-all");
    const activeStatus = currentFilters().status;
    const hasReadItems = activeStatus === "unread"
        ? false
        : activeStatus === "read"
            ? currentTotal > 0
            : currentTotal > currentUnread;
    clearRead.disabled = !hasReadItems;
    clearAll.disabled = currentTotal === 0;
    document.getElementById("clear-read-reason").textContent =
        clearRead.disabled ? "No notifications match these filters." : "";
    document.getElementById("clear-all-reason").textContent =
        clearAll.disabled ? "No notifications match these filters." : "";
}

async function previewBulk(statusOverride) {
    const filters = currentFilters(statusOverride);
    try {
        const data = await request(
            `/api/notifications/bulk-preview?${queryString(filters, 1)}`
        );
        pendingBulk = { filters, ...data };
        renderConfirmation(
            data.counts,
            statusOverride === "read"
                ? "Matching read notifications will be deleted from all pages."
                : "Matching notifications will be deleted from all pages."
        );
        confirmDialog.showModal();
    } catch (error) {
        statusMessage.textContent = error.message;
    }
}

function renderCounts(list, counts) {
    list.replaceChildren();
    Object.entries(counts).forEach(([category, count]) => {
        if (!count) return;
        const item = document.createElement("li");
        item.textContent = `${categoryLabels[category]}: ${count}`;
        list.appendChild(item);
    });
}

function renderConfirmation(counts, message) {
    document.getElementById("confirm-message").textContent =
        `${message} Total: ${Object.values(counts).reduce((sum, n) => sum + n, 0)}.`;
    renderCounts(document.getElementById("confirm-counts"), counts);
}

document.getElementById("read-all").addEventListener("click", async () => {
    try {
        const data = await request("/api/notifications/read-all", { method: "POST" });
        statusMessage.textContent = `Marked ${data.updated} as read.`;
        await loadNotifications();
        document.dispatchEvent(new Event("noveltail:notifications-changed"));
    } catch (error) {
        statusMessage.textContent = error.message;
    }
});

document.getElementById("clear-read").addEventListener("click", () => previewBulk("read"));
document.getElementById("clear-all").addEventListener("click", () =>
    previewBulk(currentFilters().status)
);

confirmDialog.querySelector("[data-cancel]").addEventListener("click", () =>
    confirmDialog.close()
);
confirmDialog.querySelector("[data-confirm]").addEventListener("click", async event => {
    if (!pendingBulk) return;
    const button = event.currentTarget;
    button.disabled = true;
    try {
        const data = await request("/api/notifications/bulk", {
            method: "DELETE",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                ...pendingBulk.filters,
                snapshotId: pendingBulk.snapshotId,
                expectedCounts: pendingBulk.counts
            })
        });
        if (data.counts) {
            confirmDialog.close();
            document.getElementById("summary-message").textContent =
                `Deleted ${data.total} notifications.`;
            renderCounts(document.getElementById("summary-counts"), data.counts);
            summaryDialog.showModal();
            await loadNotifications();
            document.dispatchEvent(new Event("noveltail:notifications-changed"));
            pendingBulk = null;
            return;
        }
    } catch (error) {
        if (error.status === 409 && error.data?.counts) {
            pendingBulk = { ...pendingBulk, counts: error.data.counts };
            renderConfirmation(
                error.data.counts,
                "The data has changed. Review the updated count and confirm again."
            );
        } else {
            document.getElementById("confirm-message").textContent = error.message;
        }
    } finally {
        button.disabled = false;
    }
});

summaryDialog.querySelector("[data-close]").addEventListener("click", () =>
    summaryDialog.close()
);

document.getElementById("previous-page").addEventListener("click", async () => {
    if (currentPage > 1) {
        currentPage -= 1;
        await loadNotifications();
    }
});
document.getElementById("next-page").addEventListener("click", async () => {
    currentPage += 1;
    await loadNotifications();
});

["filter-category", "filter-status", "filter-logic"].forEach(id => {
    document.getElementById(id).addEventListener("change", () => {
        currentPage = 1;
        loadNotifications();
    });
});
document.getElementById("filter-search").addEventListener("input", () => {
    clearTimeout(reloadTimer);
    reloadTimer = setTimeout(() => {
        currentPage = 1;
        loadNotifications();
    }, 250);
});

loadNotifications();
