const appealStatus = document.getElementById("appeal-status");

async function appealRequest(url, options = {}) {
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

function text(parent, tag, value) {
    const item = document.createElement(tag);
    item.textContent = value == null ? "" : String(value);
    parent.appendChild(item);
    return item;
}

function renderSuspensions(items) {
    const list = document.getElementById("suspension-list");
    list.replaceChildren();
    if (!items.length) {
        text(list, "p", "No account suspension history.");
        return;
    }
    items.forEach(item => {
        const card = document.createElement("article");
        card.className = "appeal-card";
        text(card, "h3", `Suspension #${item.suspension_id}`);
        text(card, "p", item.reason);
        text(card, "p", `Started ${new Date(item.suspended_at).toLocaleString("en-US")}`);
        text(card, "p", item.restored_at
            ? `Restored ${new Date(item.restored_at).toLocaleString("en-US")}`
            : item.suspended_until
                ? `Scheduled to end ${new Date(item.suspended_until).toLocaleString("en-US")}`
                : "Not restored");
        text(
            card,
            "p",
            `${item.attempt_count} / 4 appeals submitted` +
                (item.latest_status ? ` · Latest status: ${item.latest_status}` : "")
        );
        if (item.can_appeal) {
            const form = document.createElement("form");
            const label = document.createElement("label");
            label.textContent = "Appeal details";
            const input = document.createElement("textarea");
            input.name = "appeal_text";
            input.maxLength = 5000;
            input.required = true;
            label.appendChild(input);
            const submit = document.createElement("button");
            submit.type = "submit";
            submit.textContent = "Submit Appeal";
            submit.setAttribute("aria-label", "Submit appeal");
            form.append(label, submit);
            form.addEventListener("submit", async event => {
                event.preventDefault();
                submit.disabled = true;
                try {
                    await appealRequest(
                        `/api/appeals/suspensions/${item.suspension_id}/appeals`,
                        {
                            method: "POST",
                            headers: { "Content-Type": "application/json" },
                            body: JSON.stringify({ appeal_text: input.value })
                        }
                    );
                    appealStatus.textContent = "Appeal submitted.";
                    await loadAppeals();
                    await loadSuspensions();
                } catch (error) {
                    appealStatus.textContent = error.message;
                } finally {
                    submit.disabled = false;
                }
            });
            card.appendChild(form);
        }
        list.appendChild(card);
    });
}

async function loadSuspensions() {
    const data = await appealRequest("/api/appeals/me/suspensions");
    renderSuspensions(data.suspensions);
}

async function loadAppeals() {
    const data = await appealRequest("/api/appeals/me");
    const list = document.getElementById("appeal-list");
    list.replaceChildren();
    if (!data.appeals.length) {
        text(list, "p", "No appeals yet.");
        return;
    }
    data.appeals.forEach(item => {
        const card = document.createElement("article");
        card.className = "appeal-card";
        text(card, "h3", `Attempt ${item.attempt_no} · ${item.status}`);
        text(card, "p", item.appeal_text);
        text(card, "small", new Date(item.submitted_at).toLocaleString("en-US"));
        if (item.decision_note) text(card, "p", `Decision note: ${item.decision_note}`);
        list.appendChild(card);
    });
}

(async () => {
    try {
        await Promise.all([loadSuspensions(), loadAppeals()]);
    } catch (error) {
        appealStatus.textContent = error.message;
        if (error.status === 401) window.location.href = "/auth.html";
    }
})();
