(() => {
    const status = document.getElementById("reports-status");
    const list = document.getElementById("my-reports");
    const stateLabels = {
        pending: "Pending",
        reviewing: "Under review",
        resolved: "Resolved",
        rejected: "Rejected"
    };
    const reasonLabels = {
        inappropriate_content: "Inappropriate content",
        spam: "Spam",
        copyright: "Copyright infringement",
        harassment: "Harassment or bullying",
        other: "Other"
    };

    async function request(url, options = {}) {
        const response = await fetch(url, {
            credentials: "same-origin",
            ...options
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(data.message || "The request failed.");
        return data;
    }

    function appendText(parent, tag, text) {
        const node = document.createElement(tag);
        node.textContent = text == null ? "" : String(text);
        parent.appendChild(node);
        return node;
    }

    function renderReports(reports) {
        list.replaceChildren();
        if (!reports.length) {
            appendText(list, "p", "You have not submitted any reports.");
            return;
        }
        reports.forEach(report => {
            const card = document.createElement("article");
            card.className = "community-card";
            appendText(card, "h2", report.target_label || "Content");
            appendText(card, "p", `Report ID: ${report.report_id}`);
            appendText(card, "p",
                `Category: ${reasonLabels[report.reason] || report.reason}`);
            if (report.details) appendText(card, "p", report.details);
            appendText(card, "p",
                `Status: ${stateLabels[report.status] || report.status}`);
            const date = appendText(card, "small", "");
            date.dateTime = report.created_at;
            date.textContent = new Date(report.created_at).toLocaleString("en");
            list.appendChild(card);
        });
    }

    async function loadReports() {
        const data = await request("/api/reports/mine");
        renderReports(data.reports);
    }
    window.loadMyReports = loadReports;

    request("/api/auth/me")
        .then(data => {
            if (!data.authenticated) throw new Error("Please sign in.");
            return loadReports();
        })
        .catch(error => {
            status.textContent = error.message;
            if (error.message === "Please sign in.") {
                setTimeout(() => { location.href = "/auth.html"; }, 600);
            }
        });
})();
