const adminStatus = document.getElementById("admin-status");
let accountPage = 1;
let accountTotal = 0;

async function adminRequest(url, options = {}) {
    const response = await fetch(url, {
        credentials: "same-origin",
        ...options
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
        const error = new Error(data.message || "Something went wrong.");
        error.status = response.status;
        throw error;
    }
    return data;
}

function appendText(parent, tag, value, className) {
    const element = document.createElement(tag);
    if (className) element.className = className;
    element.textContent = value == null ? "" : String(value);
    parent.appendChild(element);
    return element;
}

function makeButton(label, action, callback) {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = label;
    button.setAttribute("aria-label", label);
    button.dataset.action = action;
    button.addEventListener("click", callback);
    return button;
}

async function loadNovelResults() {
    const query = document.getElementById("novel-query").value.trim();
    const status = document.getElementById("novel-status").value;
    const params = new URLSearchParams();
    if (query) params.set("q", query);
    if (status) params.set("status", status);
    const data = await adminRequest(`/api/admin/novels?${params}`);
    const list = document.getElementById("novel-results");
    list.replaceChildren();
    data.novels.forEach(novel => {
        const item = document.createElement("article");
        item.className = "admin-list-item";
        appendText(item, "strong", novel.title);
        appendText(
            item,
            "small",
            `@${novel.owner_username} · ${novel.chapter_count} chapters · ` +
                (novel.moderation_status === "suspended" ? "Suspended" : "Published")
        );
        item.appendChild(makeButton("View Details", "novel-detail", async () => {
            try {
                await loadNovelDetail(novel.novel_id);
            } catch (error) {
                adminStatus.textContent = error.message;
            }
        }));
        list.appendChild(item);
    });
    if (!data.novels.length) appendText(list, "p", "No novels found.");
}

async function loadNovelDetail(novelId) {
    const data = await adminRequest(`/api/admin/novels/${novelId}`);
    const { novel, chapters, actions } = data;
    const detail = document.getElementById("novel-detail");
    detail.replaceChildren();
    appendText(detail, "h3", novel.title);
    appendText(detail, "p", novel.description || "No description available.");
    appendText(
        detail,
        "p",
        `Writer: ${novel.owner_name} (@${novel.owner_username}) · ` +
            `Status: ${novel.moderation_status}`
    );
    appendText(detail, "h4", "Chapters (read-only)");
    chapters.forEach(chapter => {
        appendText(
            detail,
            "p",
            `${chapter.chapter_number}. ${chapter.title} · ${chapter.status}` +
                (chapter.is_paid ? ` · ${chapter.price} coins` : " · Free")
        );
    });
    const reasonLabel = document.createElement("label");
    reasonLabel.textContent = "Internal reason";
    const reason = document.createElement("textarea");
    reason.maxLength = 1000;
    reason.required = true;
    reasonLabel.appendChild(reason);
    detail.appendChild(reasonLabel);
    const next = novel.moderation_status === "suspended" ? "active" : "suspended";
    detail.appendChild(makeButton(
        next === "active" ? "Restore Novel" : "Suspend Novel",
        "moderate",
        async event => {
            const button = event.currentTarget;
            if (reason.value.trim().length < 3) {
                adminStatus.textContent = "Enter a reason with at least 3 characters.";
                return;
            }
            button.disabled = true;
            try {
                await adminRequest(`/api/admin/novels/${novel.novel_id}/moderation`, {
                    method: "PATCH",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                        moderation_status: next,
                        reason: reason.value
                    })
                });
                adminStatus.textContent = "Novel status updated and action recorded.";
                await loadNovelResults();
                await loadNovelDetail(novel.novel_id);
            } catch (error) {
                adminStatus.textContent = error.message;
            } finally {
                button.disabled = false;
            }
        }
    ));
    appendText(detail, "h4", "Moderation history");
    actions.forEach(action => {
        appendText(
            detail,
            "p",
            `${action.action} · ${action.actor_role} · ` +
                `${new Date(action.created_at).toLocaleString("en-US")} · ${action.reason || ""}`
        );
    });
}

async function loadAppealResults() {
    const params = new URLSearchParams();
    const status = document.getElementById("appeal-status").value;
    if (status) params.set("status", status);
    const data = await adminRequest(`/api/appeals/admin?${params}`);
    const list = document.getElementById("appeal-results");
    list.replaceChildren();
    data.appeals.forEach(appeal => {
        const item = document.createElement("article");
        item.className = "admin-list-item";
        appendText(item, "strong", `${appeal.username} · Attempt ${appeal.attempt_no}`);
        appendText(item, "small", `${appeal.status} · ${new Date(appeal.submitted_at).toLocaleString("en-US")}`);
        item.appendChild(makeButton("View Details", "appeal-detail", async () => {
            try {
                await loadAppealDetail(appeal.appeal_id);
            } catch (error) {
                adminStatus.textContent = error.message;
            }
        }));
        list.appendChild(item);
    });
    if (!data.appeals.length) appendText(list, "p", "No appeals found.");
}

async function loadAppealDetail(appealId) {
    const data = await adminRequest(`/api/appeals/admin/${appealId}`);
    const { appeal } = data;
    const detail = document.getElementById("appeal-detail");
    detail.replaceChildren();
    appendText(detail, "h3", `Appeal attempt ${appeal.attempt_no} · ${appeal.status}`);
    appendText(detail, "p", `User: ${appeal.display_name} (@${appeal.username})`);
    appendText(detail, "p", `Suspension reason: ${appeal.suspension_reason}`);
    appendText(detail, "p", appeal.appeal_text);
    appendText(detail, "h4", "Appeal history");
    data.attempts.forEach(attempt => {
        appendText(detail, "p", `Attempt ${attempt.attempt_no}: ${attempt.status} · ${attempt.appeal_text}`);
        if (attempt.decision_note) appendText(detail, "p", `Decision note: ${attempt.decision_note}`);
    });
    appendText(detail, "h4", "Assignment history");
    data.assignments.forEach(assignment => {
        appendText(
            detail,
            "p",
            `${assignment.username} · ${new Date(assignment.assigned_at).toLocaleString("en-US")}` +
                (assignment.released_at ? ` · Released ${new Date(assignment.released_at).toLocaleString("en-US")}` : " · Active")
        );
    });
    if (!["pending", "reviewing"].includes(appeal.status)) return;

    detail.appendChild(makeButton("Take Case", "assign", async event => {
        const button = event.currentTarget;
        button.disabled = true;
        try {
            const data = await adminRequest(`/api/appeals/admin/${appeal.appeal_id}/assignment`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({})
            });
            adminStatus.textContent = data.message;
            await loadAppealResults();
            await loadAppealDetail(appeal.appeal_id);
        } catch (error) {
            adminStatus.textContent = error.message;
        } finally {
            button.disabled = false;
        }
    }));

    const noteLabel = document.createElement("label");
    noteLabel.textContent = "Decision note for the user (optional)";
    const note = document.createElement("textarea");
    note.maxLength = 2000;
    noteLabel.appendChild(note);
    detail.appendChild(noteLabel);
    const internalLabel = document.createElement("label");
    internalLabel.textContent = "Internal note (not shown to the user)";
    const internalReason = document.createElement("textarea");
    internalReason.maxLength = 1000;
    internalLabel.appendChild(internalReason);
    detail.appendChild(internalLabel);
    for (const [status, label] of [["accepted", "Accept"], ["rejected", "Reject"]]) {
        detail.appendChild(makeButton(label, `appeal-${status}`, async event => {
            const button = event.currentTarget;
            button.disabled = true;
            try {
                await adminRequest(`/api/appeals/admin/${appeal.appeal_id}`, {
                    method: "PATCH",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                        status,
                        decision_note: note.value,
                        reason: internalReason.value
                    })
                });
                adminStatus.textContent = "Appeal decision saved and notification sent.";
                await loadAppealResults();
                await loadAppealDetail(appeal.appeal_id);
            } catch (error) {
                adminStatus.textContent = error.message;
            } finally {
                button.disabled = false;
            }
        }));
    }
}

async function loadAccountResults(page = 1) {
    const query = document.getElementById("account-query").value.trim();
    const role = document.getElementById("account-role").value;
    const params = new URLSearchParams({ page: String(page) });
    if (query) params.set("q", query);
    if (role) params.set("role", role);
    const data = await adminRequest(`/api/admin/users?${params}`);
    accountPage = data.page;
    accountTotal = data.total;
    const list = document.getElementById("account-results");
    list.replaceChildren();
    const first = accountTotal === 0 ? 0 : (accountPage - 1) * data.pageSize + 1;
    const last = Math.min(accountPage * data.pageSize, accountTotal);
    appendText(list, "p", `Showing ${first}–${last} of ${accountTotal} accounts.`);
    data.users.forEach(user => {
        const item = document.createElement("article");
        item.className = "admin-list-item";
        appendText(item, "strong", user.display_name || user.username);
        appendText(
            item,
            "small",
            `@${user.username} · ${user.role} · ${user.account_status}`
        );
        item.appendChild(makeButton("View Details", "account-detail", async () => {
            try {
                await loadAccountDetail(user.user_id);
            } catch (error) {
                adminStatus.textContent = error.message;
            }
        }));
        list.appendChild(item);
    });
    if (!data.users.length) appendText(list, "p", "No user accounts found.");

    const pagination = document.getElementById("account-pagination");
    pagination.hidden = accountTotal <= data.pageSize;
    document.getElementById("account-page-status").textContent =
        `Page ${accountPage} of ${Math.max(1, Math.ceil(accountTotal / data.pageSize))}`;
    document.getElementById("account-previous").disabled = accountPage <= 1;
    document.getElementById("account-next").disabled =
        accountPage * data.pageSize >= accountTotal;
}

async function loadAccountDetail(userId) {
    const data = await adminRequest(`/api/admin/users/${userId}`);
    const { user, suspensions, canManage, canManageRole } = data;
    const detail = document.getElementById("account-detail");
    detail.replaceChildren();
    appendText(detail, "h3", user.display_name || user.username);
    appendText(detail, "p", `@${user.username} · ${user.email}`);
    appendText(detail, "p", `Role: ${user.role} · Status: ${user.account_status}`);
    appendText(
        detail,
        "p",
        `Suspended until: ${user.suspended_until
            ? new Date(user.suspended_until).toLocaleString("en-US")
            : user.account_status === "suspended" ? "Permanent" : "—"}`
    );

    if (canManageRole) {
        const nextRole = user.role === "ADMIN" ? "USER" : "ADMIN";
        const reasonLabel = document.createElement("label");
        reasonLabel.textContent = "Reason for the role-change audit record";
        const roleReason = document.createElement("textarea");
        roleReason.maxLength = 500;
        roleReason.required = true;
        reasonLabel.appendChild(roleReason);
        detail.appendChild(reasonLabel);
        detail.appendChild(makeButton(
            nextRole === "ADMIN" ? "Appoint as ADMIN" : "Remove ADMIN Role",
            "change-role",
            async event => {
                const button = event.currentTarget;
                const reason = roleReason.value.trim();
                if (reason.length < 3) {
                    adminStatus.textContent =
                        "Enter a reason with at least 3 characters.";
                    return;
                }
                const action = nextRole === "ADMIN"
                    ? `appoint ${user.username} as an ADMIN`
                    : `remove the ADMIN role from ${user.username}`;
                if (!window.confirm(`Are you sure you want to ${action}?`)) return;

                button.disabled = true;
                try {
                    const result = await adminRequest(
                        `/api/admin/users/${user.user_id}/role`,
                        {
                            method: "PATCH",
                            headers: { "Content-Type": "application/json" },
                            body: JSON.stringify({ role: nextRole, reason })
                        }
                    );
                    adminStatus.textContent = result.message;
                    await loadAccountResults(accountPage);
                    await loadAccountDetail(user.user_id);
                } catch (error) {
                    adminStatus.textContent = error.message;
                } finally {
                    button.disabled = false;
                }
            }
        ));
    }

    appendText(detail, "h4", "Suspension history");
    if (!suspensions.length) appendText(detail, "p", "No suspension history.");
    suspensions.forEach(suspension => {
        appendText(
            detail,
            "p",
            `#${suspension.suspension_id} · ${suspension.reason} · ` +
                `${new Date(suspension.suspended_at).toLocaleString("en-US")}` +
                (suspension.restored_at
                    ? ` · Restored ${new Date(suspension.restored_at).toLocaleString("en-US")}`
                    : ` · ${suspension.suspended_until
                        ? `Until ${new Date(suspension.suspended_until).toLocaleString("en-US")}`
                        : "Permanent"}`)
        );
    });

    if (!canManage) {
        appendText(detail, "p", "You do not have permission to manage this account.");
        return;
    }

    const activeSuspension = suspensions.find(item =>
        !item.restored_at &&
        (!item.suspended_until || new Date(item.suspended_until) > new Date())
    );
    const reasonLabel = document.createElement("label");
    reasonLabel.textContent = "Reason for the audit record";
    const reason = document.createElement("textarea");
    reason.maxLength = 2000;
    reason.required = true;
    reasonLabel.appendChild(reason);
    detail.appendChild(reasonLabel);

    if (activeSuspension && user.account_status === "suspended") {
        detail.appendChild(makeButton("Restore Account", "restore-account", async event => {
            const button = event.currentTarget;
            if (reason.value.trim().length < 3) {
                adminStatus.textContent = "Enter a reason with at least 3 characters.";
                return;
            }
            button.disabled = true;
            try {
                await adminRequest(
                    `/api/admin/users/${user.user_id}/suspensions/` +
                        `${activeSuspension.suspension_id}/restore`,
                    {
                        method: "PATCH",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ reason: reason.value })
                    }
                );
                adminStatus.textContent = "Account restored and notification sent.";
                await loadAccountDetail(user.user_id);
                await loadAccountResults();
            } catch (error) {
                adminStatus.textContent = error.message;
            } finally {
                button.disabled = false;
            }
        }));
        return;
    }

    if (user.account_status !== "active") {
        appendText(detail, "p", "This account cannot be suspended in its current state.");
        return;
    }
    const durationLabel = document.createElement("label");
    durationLabel.textContent = "Suspension type / duration";
    const duration = document.createElement("select");
    for (const [value, label] of [
        ["1", "Temporary · 1 day"],
        ["7", "Temporary · 7 days"],
        ["30", "Temporary · 30 days"],
        ["permanent", "Permanent"]
    ]) {
        const option = document.createElement("option");
        option.value = value;
        option.textContent = label;
        duration.appendChild(option);
    }
    durationLabel.appendChild(duration);
    detail.appendChild(durationLabel);
    detail.appendChild(makeButton("Suspend Account", "suspend-account", async event => {
        const button = event.currentTarget;
        if (reason.value.trim().length < 3) {
            adminStatus.textContent = "Enter a reason with at least 3 characters.";
            return;
        }
        button.disabled = true;
        try {
            await adminRequest(`/api/admin/users/${user.user_id}/suspensions`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    reason: reason.value,
                    duration: duration.value
                })
            });
            adminStatus.textContent = "Account suspended and notification sent.";
            await loadAccountDetail(user.user_id);
            await loadAccountResults();
        } catch (error) {
            adminStatus.textContent = error.message;
        } finally {
            button.disabled = false;
        }
    }));
}

document.getElementById("account-search").addEventListener("submit", async event => {
    event.preventDefault();
    try {
        await loadAccountResults(1);
    } catch (error) {
        adminStatus.textContent = error.message;
    }
});
document.getElementById("account-previous").addEventListener("click", () => {
    loadAccountResults(accountPage - 1).catch(error => {
        adminStatus.textContent = error.message;
    });
});
document.getElementById("account-next").addEventListener("click", () => {
    loadAccountResults(accountPage + 1).catch(error => {
        adminStatus.textContent = error.message;
    });
});

document.getElementById("novel-search").addEventListener("submit", async event => {
    event.preventDefault();
    try {
        await loadNovelResults();
    } catch (error) {
        adminStatus.textContent = error.message;
    }
});
document.getElementById("novel-status").addEventListener("change", () => {
    loadNovelResults().catch(error => { adminStatus.textContent = error.message; });
});
document.getElementById("appeal-refresh").addEventListener("click", () => {
    loadAppealResults().catch(error => { adminStatus.textContent = error.message; });
});
document.getElementById("appeal-status").addEventListener("change", () => {
    loadAppealResults().catch(error => { adminStatus.textContent = error.message; });
});

document.getElementById("reversal-form").addEventListener("submit", async event => {
    event.preventDefault();
    const button = event.submitter;
    const operation = button.dataset.operation;
    const status = document.getElementById("reversal-status");
    button.disabled = true;
    try {
        const data = await adminRequest(
            `/api/wallet/admin/${operation === "refund" ? "refunds" : "cancellations"}`,
            {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    "Idempotency-Key": crypto.randomUUID()
                },
                body: JSON.stringify({
                    transaction_id: document.getElementById("reversal-transaction-id").value,
                    reason: document.getElementById("reversal-reason").value
                })
            }
        );
        status.textContent = data.message;
    } catch (error) {
        status.textContent = error.message;
    } finally {
        button.disabled = false;
    }
});

(async () => {
    try {
        const data = await adminRequest("/api/auth/me");
        const user = data.user;
        if (!user.is_admin && !["ADMIN", "SUPER_ADMIN"].includes(user.role)) {
            throw new Error("You do not have permission to access admin tools.");
        }
        await Promise.all([loadNovelResults(), loadAppealResults()]);
    } catch (error) {
        adminStatus.textContent = error.message;
        if (error.status === 401) window.location.href = "/auth.html";
    }
})();
