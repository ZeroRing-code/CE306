const walletBalance = document.getElementById("wallet-balance");
const walletMessage = document.getElementById("wallet-message");
const packagesContainer = document.getElementById("wallet-packages");
const transactionsList = document.getElementById("wallet-transactions");
const emptyState = document.getElementById("wallet-empty");
const moreButton = document.getElementById("wallet-more");
const adminPanel = document.getElementById("wallet-admin");
const adminForm = document.getElementById("wallet-admin-form");
const adminMessage = document.getElementById("admin-message");
let transactionPage = 1;
let totalTransactions = 0;

const transactionLabels = {
    top_up: "Coin top-up",
    purchase: "Chapter purchase",
    refund: "Coin refund",
    cancel: "Transaction cancellation",
    admin_credit: "Admin coin credit",
    admin_debit: "Admin coin debit",
    creator_earning: "Creator earnings",
    failed: "Failed transaction"
};
const transactionStatusLabels = {
    success: "Success",
    failed: "Failed",
    refunded: "Refunded",
    cancelled: "Cancelled"
};

async function api(url, options = {}) {
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

function requestKey() {
    return crypto.randomUUID();
}

function formatDate(value) {
    return new Intl.DateTimeFormat("th-TH", {
        dateStyle: "medium",
        timeStyle: "short"
    }).format(new Date(value));
}

async function loadWallet() {
    const data = await api("/api/wallet");
    walletBalance.textContent = Number(data.balance).toLocaleString("en-US");
    adminPanel.hidden = !data.is_admin;
    packagesContainer.replaceChildren();
    data.packages.forEach(amount => {
        const button = document.createElement("button");
        button.type = "button";
        button.textContent = `${Number(amount).toLocaleString("en-US")} coins`;
        button.setAttribute(
            "aria-label",
            `Top up ${Number(amount).toLocaleString("en-US")} coins`
        );
        button.title = button.getAttribute("aria-label");
        button.addEventListener("click", () => topUp(amount, button));
        packagesContainer.appendChild(button);
    });
}

async function topUp(amount, button) {
    button.disabled = true;
    walletMessage.textContent = "Adding coins...";
    try {
        const data = await api("/api/wallet/top-up", {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "Idempotency-Key": requestKey()
            },
            body: JSON.stringify({ amount })
        });
        walletBalance.textContent = Number(data.balance).toLocaleString("en-US");
        walletMessage.textContent = data.message;
        await loadTransactions(true);
    } catch (error) {
        walletMessage.textContent = error.message;
    } finally {
        button.disabled = false;
    }
}

function transactionItem(transaction) {
    const item = document.createElement("li");
    item.className = "wallet-transaction";
    const description = document.createElement("div");
    const title = document.createElement("strong");
    title.textContent = transactionLabels[transaction.type] || transaction.type;
    const date = document.createElement("p");
    date.textContent = formatDate(transaction.created_at);
    const status = document.createElement("p");
    status.textContent =
        transactionStatusLabels[transaction.status] || transaction.status;
    description.append(title, date, status);
    const amount = document.createElement("span");
    amount.className = "wallet-amount";
    amount.textContent = `${Number(transaction.amount) > 0 ? "+" : ""}${Number(transaction.amount).toLocaleString("en-US")} coins`;
    item.append(description, amount);
    return item;
}

async function loadTransactions(reset = false) {
    if (reset) {
        transactionPage = 1;
        transactionsList.replaceChildren();
    }
    const data = await api(`/api/wallet/transactions?page=${transactionPage}`);
    totalTransactions = data.total;
    data.transactions.forEach(item => transactionsList.appendChild(transactionItem(item)));
    emptyState.hidden = totalTransactions !== 0;
    moreButton.hidden = transactionsList.children.length >= totalTransactions;
}

moreButton.addEventListener("click", async () => {
    moreButton.disabled = true;
    try {
        transactionPage += 1;
        await loadTransactions();
    } catch (error) {
        transactionPage -= 1;
        walletMessage.textContent = error.message;
    } finally {
        moreButton.disabled = false;
    }
});

adminForm.addEventListener("submit", async event => {
    event.preventDefault();
    const button = adminForm.querySelector("button");
    button.disabled = true;
    adminMessage.textContent = "Saving...";
    try {
        const data = await api("/api/wallet/admin/adjust", {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "Idempotency-Key": requestKey()
            },
            body: JSON.stringify({
                user_id: document.getElementById("admin-user-id").value,
                operation: document.getElementById("admin-operation").value,
                amount: Number(document.getElementById("admin-amount").value),
                reason: document.getElementById("admin-reason").value
            })
        });
        adminMessage.textContent = data.message;
        adminForm.reset();
    } catch (error) {
        adminMessage.textContent = error.message;
    } finally {
        button.disabled = false;
    }
});

(async () => {
    try {
        await loadWallet();
        await loadTransactions(true);
    } catch (error) {
        walletMessage.textContent = error.message;
        if (error.status === 401) {
            window.location.href = "/auth.html";
        }
    }
})();
