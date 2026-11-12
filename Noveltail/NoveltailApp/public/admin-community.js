(() => {
    const status = document.getElementById("admin-status");
    const reportList = document.getElementById("reports-results");
    const reportDetail = document.getElementById("reports-detail");
    const announcementList = document.getElementById("announcements-results");
    const announcementDetail = document.getElementById("announcements-detail");
    const editor = document.getElementById("announcement-editor");
    const announcementActions = document.getElementById("announcement-actions");
    const privateNotificationForm = document.getElementById(
        "private-notification-form"
    );
    let selectedReportId = null;
    let selectedAnnouncementId = null;
    let selectedAnnouncementStatus = null;
    let selectedAnnouncementPinned = false;

    const reportStates = {
        pending: "Pending",
        reviewing: "Under review",
        resolved: "Resolved",
        rejected: "Rejected"
    };
    const announcementStates = {
        draft: "Draft / Scheduled",
        published: "Published",
        cancelled: "Cancelled"
    };
    const reportReasons = {
        inappropriate_content: "Inappropriate content",
        spam: "Spam",
        copyright: "Copyright infringement",
        harassment: "Harassment or bullying",
        other: "Other"
    };
    const reportActions = {
        report_claimed: "Claimed for review",
        report_status_changed: "Report status changed"
    };

    function text(parent, tag, value) {
        const node = document.createElement(tag);
        node.textContent = value == null ? "" : String(value);
        parent.appendChild(node);
        return node;
    }

    function addButton(parent, label, callback) {
        const button = document.createElement("button");
        button.type = "button";
        button.textContent = label;
        button.setAttribute("aria-label", label);
        button.addEventListener("click", callback);
        parent.appendChild(button);
        return button;
    }

    function paramsFromForm(formId, fields) {
        const params = new URLSearchParams();
        for (const [fieldId, key] of fields) {
            const value = document.getElementById(fieldId).value.trim();
            if (value) params.set(key, value);
        }
        return params;
    }

    async function loadReports() {
        const query = paramsFromForm("reports-filter-form", [
            ["reports-query", "q"],
            ["reports-type", "type"],
            ["reports-state", "status"]
        ]);
        const data = await adminRequest(`/api/reports/admin?${query}`);
        reportList.replaceChildren();
        if (!data.reports.length) text(reportList, "p", "No reports found.");
        data.reports.forEach(report => {
            const item = document.createElement("article");
            item.className = "admin-list-item";
            text(item, "strong", report.target_label || report.target_type);
            const assignedAdmin =
                report.reviewed_by_display_name || report.reviewed_by_username || "Unassigned";
            text(
                item,
                "small",
                `Reported by ${report.reporter_display_name || report.reporter_username} · ` +
                    `${reportStates[report.status]} · Assigned to ${assignedAdmin}`
            );
            addButton(item, "View Details", () => loadReportDetail(report.report_id));
            reportList.appendChild(item);
        });
    }

    async function loadReportDetail(reportId) {
        const data = await adminRequest(`/api/reports/admin/${reportId}`);
        selectedReportId = data.report.report_id;
        reportDetail.replaceChildren();
        const report = data.report;
        text(reportDetail, "h3", report.target_label || report.target_type);
        text(reportDetail, "p", `Report ID: ${report.report_id}`);
        text(
            reportDetail,
            "p",
            `Reported by: ${report.reporter_display_name || report.reporter_username}`
        );
        text(reportDetail, "p", `Target type: ${report.target_type}`);
        text(
            reportDetail,
            "p",
            `Assigned admin: ${report.reviewed_by_display_name ||
                report.reviewed_by_username || "Unassigned"}`
        );
        const snapshot = report.target_snapshot;
        if (snapshot?.target_id) {
            text(reportDetail, "p", `Target ID: ${snapshot.target_id}`);
            if (snapshot.novel_title) {
                text(reportDetail, "p", `Novel title: ${snapshot.novel_title}`);
            }
            if (snapshot.chapter_title) {
                text(
                    reportDetail,
                    "p",
                    `Chapter: ${snapshot.chapter_title} / ${snapshot.chapter_number}`
                );
            }
            if (snapshot.comment_author) {
                text(reportDetail, "p", `Comment author: ${snapshot.comment_author}`);
            }
            if (snapshot.comment_content) {
                text(reportDetail, "p", `Reported comment: ${snapshot.comment_content}`);
            }
        }
        text(
            reportDetail,
            "p",
            `Category: ${reportReasons[report.reason] || report.reason}`
        );
        if (report.details) text(reportDetail, "p", report.details);
        text(reportDetail, "p", `Status: ${reportStates[report.status]}`);

        if (["pending", "reviewing"].includes(report.status)) {
            const form = document.createElement("form");
            form.className = "admin-controls";
            const select = document.createElement("select");
            select.id = `report-decision-${reportId}`;
            const allowed = ["resolved", "rejected"];
            allowed.forEach(value => {
                const option = document.createElement("option");
                option.value = value;
                option.textContent = reportStates[value];
                select.appendChild(option);
            });
            const decisionLabel = document.createElement("label");
            decisionLabel.textContent = "Decision";
            decisionLabel.appendChild(select);
            const reason = document.createElement("textarea");
            reason.id = `report-review-note-${reportId}`;
            reason.maxLength = 500;
            reason.minLength = 3;
            reason.required = true;
            reason.placeholder = "Enter a review note (3–500 characters).";
            const reasonLabel = document.createElement("label");
            reasonLabel.textContent = "Review note";
            reasonLabel.appendChild(reason);
            let claimButton = null;
            if (report.status === "pending") {
                claimButton = document.createElement("button");
                claimButton.type = "button";
                claimButton.textContent = "Claim Report";
            }
            const submit = document.createElement("button");
            submit.type = "submit";
            submit.textContent = "Save Decision";
            form.append(reasonLabel);
            if (claimButton) form.appendChild(claimButton);
            form.append(decisionLabel, submit);
            claimButton?.addEventListener("click", async () => {
                if (!form.reportValidity()) return;
                claimButton.disabled = true;
                try {
                    await adminRequest(
                        `/api/reports/admin/${reportId}/claim`,
                        {
                            method: "POST",
                            headers: { "Content-Type": "application/json" },
                            body: JSON.stringify({ reason: reason.value })
                        }
                    );
                    status.textContent = "Report claimed for review.";
                    await Promise.all([loadReports(), loadReportDetail(reportId)]);
                } catch (error) {
                    status.textContent = error.message;
                } finally {
                    claimButton.disabled = false;
                }
            });
            form.addEventListener("submit", async event => {
                event.preventDefault();
                if (!form.reportValidity()) return;
                submit.disabled = true;
                try {
                    await adminRequest(
                        `/api/reports/admin/${selectedReportId}/status`,
                        {
                            method: "PATCH",
                            headers: { "Content-Type": "application/json" },
                            body: JSON.stringify({
                                status: select.value,
                                reason: reason.value
                            })
                        }
                    );
                    status.textContent = "Report decision saved.";
                    await Promise.all([loadReports(), loadReportDetail(reportId)]);
                } catch (error) {
                    status.textContent = error.message;
                } finally {
                    submit.disabled = false;
                }
            });
            reportDetail.appendChild(form);
        }

        const history = document.createElement("section");
        text(history, "h4", "Action history");
        if (!data.history.length) text(history, "p", "No actions recorded.");
        data.history.forEach(entry => {
            const actor = entry.actor_name || entry.actor_role || "Unknown admin";
            const action = reportActions[entry.action] || entry.action;
            text(history, "p",
                `${actor} (${entry.actor_role}): ${action}` +
                    `${entry.reason ? ` — ${entry.reason}` : ""} · ` +
                    new Date(entry.created_at).toLocaleString("en"));
        });
        reportDetail.appendChild(history);
    }

    async function loadAnnouncements() {
        const query = paramsFromForm("announcements-filter-form", [
            ["announcements-query", "q"],
            ["announcements-state", "status"]
        ]);
        const data = await adminRequest(`/api/announcements/admin?${query}`);
        announcementList.replaceChildren();
        if (!data.announcements.length) text(announcementList, "p", "No announcements found.");
        data.announcements.forEach(announcement => {
            const item = document.createElement("article");
            item.className = "admin-list-item";
            text(item, "strong", announcement.title);
            text(item, "small",
                `${announcementStates[announcement.status]} · Website-wide` +
                    `${announcement.is_pinned ? ` · Pinned (${announcement.pin_order})` : ""}`);
            addButton(item, "View / Edit", () =>
                loadAnnouncementDetail(announcement.announcement_id));
            announcementList.appendChild(item);
        });
    }

    function privateNotificationAudience() {
        const type = document.getElementById(
            "private-notification-audience"
        ).value;
        if (type === "group") {
            return {
                type,
                filter: {
                    roles: [...document.querySelectorAll(
                        'input[name="private-notification-role"]:checked'
                    )].map(input => input.value)
                }
            };
        }
        return {
            type,
            filter: {
                userIds: document.getElementById(
                    "private-notification-user-ids"
                )
                    .value.split(",").map(value => value.trim()).filter(Boolean)
            }
        };
    }

    function formatLocalDate(value) {
        if (!value) return "";
        const date = new Date(value);
        const offset = date.getTimezoneOffset() * 60_000;
        return new Date(date.getTime() - offset).toISOString().slice(0, 16);
    }

    async function searchAudienceUsers() {
        const query = document.getElementById(
            "private-notification-user-search"
        )
            .value.trim();
        const results = document.getElementById(
            "private-notification-user-search-results"
        );
        results.replaceChildren();
        if (query.length < 2) {
            status.textContent = "Search with at least 2 characters.";
            return;
        }

        try {
            const data = await adminRequest(
                `/api/admin/users?q=${encodeURIComponent(query)}`
            );
            if (!data.users.length) {
                text(results, "p", "No accounts found.");
                return;
            }
            data.users.forEach(user => {
                const row = document.createElement("div");
                const label = user.display_name || user.username;
                text(row, "span", `${label} (@${user.username}) · ${user.role}`);
                const button = addButton(row, "Add User", () => {
                    const input = document.getElementById(
                        "private-notification-user-ids"
                    );
                    const userIds = new Set(
                        input.value.split(",").map(value => value.trim())
                            .filter(Boolean)
                    );
                    userIds.add(String(user.user_id));
                    input.value = [...userIds].join(", ");
                    button.disabled = true;
                    button.textContent = "Added";
                });
                if (document.getElementById(
                    "private-notification-user-ids"
                ).value
                    .split(",").map(value => value.trim())
                    .includes(String(user.user_id))) {
                    button.disabled = true;
                    button.textContent = "Added";
                }
                results.appendChild(row);
            });
        } catch (error) {
            status.textContent = error.message;
        }
    }

    async function loadAnnouncementDetail(announcementId) {
        const data = await adminRequest(
            `/api/announcements/admin/${announcementId}`
        );
        const announcement = data.announcement;
        selectedAnnouncementId = announcement.announcement_id;
        selectedAnnouncementStatus = announcement.status;
        selectedAnnouncementPinned = announcement.is_pinned;
        document.getElementById("announcement-id").value =
            String(announcement.announcement_id);
        document.getElementById("announcement-title-input").value =
            announcement.title;
        document.getElementById("announcement-content-input").value =
            announcement.content;
        document.getElementById("announcement-link-url").value =
            announcement.link_url || "";
        document.getElementById("announcement-link-label").value =
            announcement.link_label || "";
        document.getElementById("announcement-is-pinned").checked =
            announcement.is_pinned;
        document.getElementById("announcement-pin-order").value =
            String(announcement.pin_order);
        document.getElementById("announcement-expires").value =
            formatLocalDate(announcement.expires_at);
        document.getElementById("announcement-editor-heading").textContent =
            `Edit Announcement (${announcementStates[announcement.status]})`;
        document.getElementById("announcement-save").textContent =
            "Save Changes";
        editor.querySelectorAll(
            "#announcement-title-input, #announcement-content-input, #announcement-expires, #announcement-link-url, #announcement-link-label, #announcement-is-pinned, #announcement-pin-order"
        ).forEach(control => {
            control.disabled = announcement.status === "cancelled" ||
                announcement.status === "published";
        });
        document.getElementById("announcement-save").disabled =
            announcement.status === "cancelled";
        announcementActions.hidden = false;
        document.getElementById("announcement-publish").disabled =
            announcement.status !== "draft";
        document.getElementById("announcement-publish").hidden =
            announcement.status !== "draft";
        document.getElementById("announcement-unpublish").hidden =
            announcement.status !== "published";
        const pinButton = document.getElementById("announcement-pin-toggle");
        pinButton.hidden = announcement.status !== "published";
        pinButton.textContent = announcement.is_pinned
            ? "Unpin from Home"
            : "Pin to Home";
        document.getElementById("announcement-cancel").disabled =
            announcement.status === "cancelled";
        document.getElementById("announcement-cancel").hidden =
            announcement.status === "cancelled";
        document.getElementById("announcement-delete").hidden = false;
        document.getElementById("announcement-schedule").value =
            announcement.status === "draft"
                ? formatLocalDate(announcement.published_at)
                : "";
        announcementDetail.replaceChildren();
        text(announcementDetail, "h3", announcement.title);
        text(announcementDetail, "p", announcementStates[announcement.status]);
        text(announcementDetail, "p", "Visible to everyone on the website.");
        if (announcement.published_at) {
            text(announcementDetail, "p",
                `Published / scheduled: ${new Date(announcement.published_at).toLocaleString("en-US")}`);
        }
        text(announcementDetail, "h4", "Action history");
        if (!data.history.length) text(announcementDetail, "p", "No history available.");
        data.history.forEach(entry => {
            text(announcementDetail, "p",
                `${entry.actor_role}: ${entry.action}${entry.reason ? ` — ${entry.reason}` : ""}`);
        });
        const recipientList = document.createElement("details");
        text(recipientList, "summary", `Announcement recipients (up to ${data.recipients.length})`);
        data.recipients.forEach(recipient => {
            text(recipientList, "p",
                `${recipient.display_name || recipient.username} (${recipient.role}) · ${recipient.is_read ? "Read" : "Unread"}`);
        });
        announcementDetail.appendChild(recipientList);
    }

    function resetAnnouncementEditor() {
        selectedAnnouncementId = null;
        selectedAnnouncementStatus = null;
        selectedAnnouncementPinned = false;
        editor.reset();
        document.getElementById("announcement-id").value = "";
        document.getElementById("announcement-editor-heading").textContent =
            "Create Announcement Draft";
        document.getElementById("announcement-save").textContent =
            "Save Draft";
        editor.querySelectorAll(
            "#announcement-title-input, #announcement-content-input, #announcement-expires, #announcement-link-url, #announcement-link-label, #announcement-is-pinned, #announcement-pin-order"
        ).forEach(control => { control.disabled = false; });
        document.getElementById("announcement-save").disabled = false;
        announcementActions.hidden = true;
        document.getElementById("announcement-preview").hidden = true;
        announcementDetail.replaceChildren();
        text(announcementDetail, "p", "Select an announcement to view its details and history.");
    }

    document.getElementById("reports-filter-form").addEventListener(
        "submit", event => {
            event.preventDefault();
            loadReports().catch(error => { status.textContent = error.message; });
        }
    );
    document.getElementById("announcements-filter-form").addEventListener(
        "submit", event => {
            event.preventDefault();
            loadAnnouncements().catch(error => { status.textContent = error.message; });
        }
    );
    editor.addEventListener("submit", async event => {
        event.preventDefault();
        const body = {
            title: document.getElementById("announcement-title-input").value,
            content: document.getElementById("announcement-content-input").value,
            audience_type: "all",
            audience_filter: {},
            link_url: document.getElementById("announcement-link-url").value.trim(),
            link_label: document.getElementById("announcement-link-label").value.trim(),
            is_pinned: document.getElementById("announcement-is-pinned").checked,
            pin_order: Number(document.getElementById("announcement-pin-order").value),
            expires_at: document.getElementById("announcement-expires").value
                ? new Date(document.getElementById("announcement-expires").value).toISOString()
                : null
        };
        const button = document.getElementById("announcement-save");
        button.disabled = true;
        try {
            const isUpdate = Boolean(selectedAnnouncementId);
            const result = isUpdate
                ? await adminRequest(
                    `/api/announcements/admin/${selectedAnnouncementId}`,
                    {
                        method: "PATCH",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify(body)
                    }
                )
                : await adminRequest("/api/announcements/admin", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify(body)
                });
            selectedAnnouncementId = result.announcement.announcement_id;
                status.textContent = isUpdate
                ? "Announcement saved."
                : "Draft created.";
            await Promise.all([
                loadAnnouncements(),
                loadAnnouncementDetail(selectedAnnouncementId)
            ]);
        } catch (error) {
            status.textContent = error.message;
        } finally {
            button.disabled = false;
        }
    });
    document.getElementById("announcement-clear").addEventListener(
        "click", resetAnnouncementEditor
    );
    document.getElementById(
        "private-notification-user-search-button"
    ).addEventListener(
        "click", searchAudienceUsers
    );
    document.getElementById("private-notification-user-search").addEventListener(
        "keydown", event => {
            if (event.key === "Enter") {
                event.preventDefault();
                searchAudienceUsers();
            }
        }
    );
    document.getElementById("private-notification-audience").addEventListener(
        "change", () => {
            const isIndividual = document.getElementById(
                "private-notification-audience"
            ).value === "individual";
            document.getElementById(
                "private-notification-individual-controls"
            ).hidden = !isIndividual;
            document.getElementById(
                "private-notification-group-controls"
            ).hidden = isIndividual;
        }
    );
    privateNotificationForm.addEventListener("submit", async event => {
        event.preventDefault();
        const audience = privateNotificationAudience();
        const button = privateNotificationForm.querySelector(
            'button[type="submit"]'
        );
        button.disabled = true;
        try {
            const result = await adminRequest(
                "/api/announcements/admin/private-notifications",
                {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                        title: document.getElementById(
                            "private-notification-title"
                        ).value,
                        message: document.getElementById(
                            "private-notification-message"
                        ).value,
                        audience_type: audience.type,
                        audience_filter: audience.filter
                    })
                }
            );
            status.textContent = result.message;
            privateNotificationForm.reset();
            document.getElementById(
                "private-notification-user-search-results"
            ).replaceChildren();
            document.getElementById(
                "private-notification-audience"
            ).dispatchEvent(new Event("change"));
        } catch (error) {
            status.textContent = error.message;
        } finally {
            button.disabled = false;
        }
    });
    document.getElementById("announcement-publish").addEventListener(
        "click", async () => {
            if (!selectedAnnouncementId) return;
            const value = document.getElementById("announcement-schedule").value;
            try {
                const result = await adminRequest(
                    `/api/announcements/admin/${selectedAnnouncementId}/publish`,
                    {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({
                            published_at: value ? new Date(value).toISOString() : null
                        })
                    }
                );
                status.textContent = result.message;
                await Promise.all([
                    loadAnnouncements(),
                    loadAnnouncementDetail(selectedAnnouncementId)
                ]);
            } catch (error) {
                status.textContent = error.message;
            }
        }
    );
    document.getElementById("announcement-cancel").addEventListener(
        "click", async () => {
            if (!selectedAnnouncementId) return;
            try {
                const result = await adminRequest(
                    `/api/announcements/admin/${selectedAnnouncementId}/cancel`,
                    {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({
                            reason: document.getElementById(
                                "announcement-cancel-reason"
                            ).value
                        })
                    }
                );
                status.textContent = result.message;
                await Promise.all([
                    loadAnnouncements(),
                    loadAnnouncementDetail(selectedAnnouncementId)
                ]);
            } catch (error) {
                status.textContent = error.message;
            }
        }
    );
    document.getElementById("announcement-preview-button").addEventListener(
        "click", () => {
            const preview = document.getElementById("announcement-preview");
            preview.replaceChildren();
            const article = document.createElement("article");
            article.className = "announcement-preview__card";
            text(article, "h4",
                document.getElementById("announcement-title-input").value.trim() ||
                "Announcement title");
            text(article, "p",
                document.getElementById("announcement-content-input").value ||
                "Announcement content");
            const rawUrl = document.getElementById("announcement-link-url")
                .value.trim();
            const linkLabel = document.getElementById("announcement-link-label")
                .value.trim();
            if (rawUrl || linkLabel) {
                let safeUrl = null;
                if (!rawUrl.includes("\\") &&
                    !/[\u0000-\u001f\u007f]/.test(rawUrl) &&
                    rawUrl.startsWith("/") && !rawUrl.startsWith("//")) {
                    safeUrl = rawUrl;
                } else if (/^https?:\/\//i.test(rawUrl)) {
                    try {
                        const url = new URL(rawUrl);
                        if (["http:", "https:"].includes(url.protocol) &&
                            url.hostname && !url.username && !url.password) {
                            safeUrl = url.href;
                        }
                    } catch {
                        safeUrl = null;
                    }
                }
                if (!safeUrl || !linkLabel || linkLabel.length > 100) {
                    status.textContent = "Enter a safe HTTP/HTTPS URL or internal path and link text.";
                    return;
                }
                const link = document.createElement("a");
                link.href = safeUrl;
                link.textContent = linkLabel;
                if (!safeUrl.startsWith("/") &&
                    new URL(safeUrl).origin !== window.location.origin) {
                    link.target = "_blank";
                    link.rel = "noopener noreferrer";
                }
                article.appendChild(link);
            }
            preview.appendChild(article);
            preview.hidden = false;
            status.textContent = "Preview updated.";
        }
    );
    document.getElementById("announcement-unpublish").addEventListener(
        "click", async () => {
            if (!selectedAnnouncementId) return;
            try {
                const result = await adminRequest(
                    `/api/announcements/admin/${selectedAnnouncementId}/unpublish`,
                    {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: "{}"
                    }
                );
                status.textContent = result.message;
                await Promise.all([
                    loadAnnouncements(),
                    loadAnnouncementDetail(selectedAnnouncementId)
                ]);
            } catch (error) {
                status.textContent = error.message;
            }
        }
    );
    document.getElementById("announcement-pin-toggle").addEventListener(
        "click", async () => {
            if (!selectedAnnouncementId) return;
            const pinned = !selectedAnnouncementPinned;
            try {
                await adminRequest(
                    `/api/announcements/admin/${selectedAnnouncementId}/pin`,
                    {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({
                            is_pinned: pinned,
                            pin_order: Number(
                                document.getElementById("announcement-pin-order").value
                            )
                        })
                    }
                );
                status.textContent = pinned
                    ? "Announcement pinned to Home."
                    : "Announcement unpinned from Home.";
                await Promise.all([
                    loadAnnouncements(),
                    loadAnnouncementDetail(selectedAnnouncementId)
                ]);
            } catch (error) {
                status.textContent = error.message;
            }
        }
    );
    document.getElementById("announcement-delete").addEventListener(
        "click", async () => {
            if (!selectedAnnouncementId ||
                !window.confirm("Delete this announcement and its recipient notifications?")) {
                return;
            }
            try {
                const result = await adminRequest(
                    `/api/announcements/admin/${selectedAnnouncementId}`,
                    { method: "DELETE" }
                );
                status.textContent = result.message;
                resetAnnouncementEditor();
                await loadAnnouncements();
            } catch (error) {
                status.textContent = error.message;
            }
        }
    );

    (async () => {
        try {
            await Promise.all([loadReports(), loadAnnouncements()]);
        } catch (error) {
            status.textContent = error.message;
        }
    })();
})();
