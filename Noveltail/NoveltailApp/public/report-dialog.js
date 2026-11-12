(() => {
    const root = document.getElementById("report-dialog-root") ||
        document.body;
    const labels = {
        novel: "Novel",
        chapter: "Chapter",
        comment: "Comment"
    };
    const reasonOptions = [
        ["inappropriate_content", "Inappropriate content"],
        ["spam", "Spam"],
        ["copyright", "Copyright infringement"],
        ["harassment", "Harassment or bullying"],
        ["other", "Other"]
    ];

    function element(tag, className, text) {
        const node = document.createElement(tag);
        if (className) node.className = className;
        if (text !== undefined) node.textContent = text;
        return node;
    }

    const dialog = element("dialog", "report-dialog");
    dialog.setAttribute("aria-labelledby", "report-dialog-title");
    const form = element("form", "report-form");
    form.id = "report-form";
    form.noValidate = false;

    const heading = element("h2", "", "Report content");
    heading.id = "report-dialog-title";
    const targetHeading = element("h3", "", "Read-only target information");
    const targetDetails = element("dl", "report-target-details");
    const targetStatus = element("p", "report-dialog-status");
    targetStatus.setAttribute("role", "status");
    targetStatus.setAttribute("aria-live", "polite");

    const reasonLabel = element("label", "", "Category");
    const reasonSelect = element("select");
    reasonSelect.name = "reason";
    reasonSelect.required = true;
    const reasonPlaceholder = element("option", "", "Select a category");
    reasonPlaceholder.value = "";
    reasonPlaceholder.disabled = true;
    reasonPlaceholder.selected = true;
    reasonSelect.appendChild(reasonPlaceholder);
    reasonOptions.forEach(([value, label]) => {
        const option = element("option", "", label);
        option.value = value;
        reasonSelect.appendChild(option);
    });
    reasonLabel.appendChild(reasonSelect);

    const detailsLabel = element("label", "", "Reason details");
    const detailsInput = element("textarea");
    detailsInput.name = "details";
    detailsInput.required = true;
    detailsInput.minLength = 10;
    detailsInput.maxLength = 2000;
    detailsInput.rows = 5;
    detailsInput.placeholder = "Describe why you are reporting this content.";
    detailsInput.setAttribute("aria-describedby", "report-reason-help");
    detailsLabel.appendChild(detailsInput);
    const reasonHelp = element(
        "small",
        "report-reason-help",
        "Enter between 10 and 2,000 characters."
    );
    reasonHelp.id = "report-reason-help";

    const success = element("p", "report-dialog-success");
    success.setAttribute("role", "status");
    success.hidden = true;
    const reportIdLabel = element("span", "", "Report ID: ");
    const reportId = element("output", "report-id");
    reportId.id = "report-id";
    reportId.setAttribute("aria-readonly", "true");
    success.append(reportIdLabel, reportId);

    const actions = element("div", "report-dialog-actions");
    const cancelButton = element("button", "", "Cancel");
    cancelButton.type = "button";
    cancelButton.addEventListener("click", () => dialog.close());
    const submitButton = element("button", "", "Submit report");
    submitButton.type = "submit";
    actions.append(cancelButton, submitButton);

    form.append(
        heading,
        targetHeading,
        targetDetails,
        reasonLabel,
        detailsLabel,
        reasonHelp,
        targetStatus,
        success,
        actions
    );
    dialog.appendChild(form);
    root.appendChild(dialog);

    let targetToken = "";

    function displayTarget(target) {
        targetDetails.replaceChildren();
        const fields = [
            ["Target Type", labels[target.target_type]],
            ["Target ID", target.target_id]
        ];
        if (target.target_type === "novel") {
            fields.splice(1, 0, ["Novel Title", target.novel_title]);
        } else if (target.target_type === "chapter") {
            fields.splice(1, 0, ["Novel Title", target.novel_title]);
            fields.splice(2, 0, [
                "Chapter Title / Number",
                `${target.chapter_title} / ${target.chapter_number}`
            ]);
        } else {
            fields.splice(1, 0, ["Comment Content", target.comment_content]);
            fields.splice(2, 0, ["Comment Author", target.comment_author]);
        }

        fields.forEach(([label, value]) => {
            const term = element("dt", "", label);
            const description = element("dd", "", value);
            description.dataset.readonlyTarget = "";
            targetDetails.append(term, description);
        });
        heading.textContent = `Report ${labels[target.target_type]}`;
        dialog.dataset.targetType = target.target_type;
    }

    async function request(url, options = {}) {
        const response = await fetch(url, {
            credentials: "same-origin",
            ...options
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok) {
            const error = new Error(data.message || "The request failed.");
            error.status = response.status;
            throw error;
        }
        return data;
    }

    async function openReport(type, id) {
        if (!labels[type] || !/^\d+$/.test(String(id)) || Number(id) < 1) {
            return;
        }
        form.reset();
        targetDetails.replaceChildren();
        targetStatus.textContent = "Loading target information...";
        success.hidden = true;
        reportId.textContent = "";
        submitButton.textContent = "Submit report";
        submitButton.disabled = true;
        targetToken = "";
        detailsInput.setCustomValidity("");
        detailsInput.setAttribute("aria-invalid", "false");
        if (!dialog.open) dialog.showModal();

        try {
            const query = new URLSearchParams({ type, id: String(id) });
            const data = await request(`/api/reports/target?${query}`);
            displayTarget(data.target);
            targetToken = data.target_token;
            targetStatus.textContent = "";
        } catch (error) {
            targetStatus.replaceChildren();
            targetStatus.appendChild(
                element("span", "", error.message)
            );
            if (error.status === 401) {
                const login = element("a", "", "Log in");
                login.href = "/auth.html";
                targetStatus.append(" ", login);
            }
        } finally {
            submitButton.disabled = !targetToken;
        }
    }

    detailsInput.addEventListener("input", () => {
        const trimmedLength = detailsInput.value.trim().length;
        const invalid = detailsInput.value.length > 0 &&
            trimmedLength < detailsInput.minLength;
        detailsInput.setCustomValidity(invalid
            ? "Please enter at least 10 non-space characters."
            : "");
        detailsInput.setAttribute("aria-invalid", String(invalid));
    });

    form.addEventListener("submit", async event => {
        event.preventDefault();
        if (!targetToken || !form.reportValidity()) return;

        submitButton.disabled = true;
        submitButton.textContent = "Submitting...";
        targetStatus.textContent = "";
        try {
            const data = await request("/api/reports", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    target_token: targetToken,
                    reason: reasonSelect.value,
                    details: detailsInput.value.trim()
                })
            });
            if (!data.report?.report_id) {
                throw new Error("The server did not return a Report ID.");
            }
            reportId.textContent = String(data.report.report_id);
            success.hidden = false;
            targetStatus.textContent = "Report submitted successfully.";
            submitButton.textContent = "Submitted";
            if (typeof window.loadMyReports === "function") {
                await window.loadMyReports();
            }
        } catch (error) {
            targetStatus.textContent = error.message;
            submitButton.textContent = "Submit report";
            submitButton.disabled = false;
        }
    });

    detailsInput.addEventListener("input", () => {
        if (success.hidden) return;
        success.hidden = true;
        reportId.textContent = "";
        submitButton.textContent = "Submit report";
    });

    document.addEventListener("click", event => {
        const trigger = event.target.closest("[data-report-type][data-report-id]");
        if (!trigger) return;
        event.preventDefault();
        openReport(trigger.dataset.reportType, trigger.dataset.reportId);
    });

    const params = new URLSearchParams(location.search);
    if (location.pathname === "/reports.html" &&
        labels[params.get("type")] && params.has("id")) {
        openReport(params.get("type"), params.get("id"));
    }
})();
