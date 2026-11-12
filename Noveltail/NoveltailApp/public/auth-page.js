const loginTab = document.getElementById("login-tab");
const registerTab = document.getElementById("register-tab");

const loginForm = document.getElementById("login-form");
const registerForm = document.getElementById("register-form");

const formTitle = document.getElementById("form-title");
const formSubtitle = document.getElementById("form-subtitle");

const message = document.getElementById("message");

const authForms = document.getElementById("auth-forms");
const accountPanel = document.getElementById("account-panel");
const accountInfo = document.getElementById("account-info");

function showMessage(text, type = "error") {
    message.textContent = text;
    message.className = type;
}

function switchTab(mode) {
    message.textContent = "";

    const isLogin = mode === "login";

    loginForm.hidden = !isLogin;
    registerForm.hidden = isLogin;

    loginTab.classList.toggle("active", isLogin);
    registerTab.classList.toggle("active", !isLogin);

    formTitle.textContent = isLogin
        ? "Welcome back"
        : "Create your account";

    formSubtitle.textContent = isLogin
        ? "Sign in to continue to your stories."
        : "Create an account to start your journey.";
}

loginTab.addEventListener("click", () => switchTab("login"));
registerTab.addEventListener("click", () => switchTab("register"));

// REGISTER
registerForm.addEventListener("submit", async (event) => {
    event.preventDefault();

    const formData = new FormData(registerForm);

    const body = Object.fromEntries(formData.entries());

    try {
        const response = await fetch("/api/auth/register", {
            method: "POST",
            headers: {
                "Content-Type": "application/json"
            },
            credentials: "same-origin",
            body: JSON.stringify(body)
        });

        const data = await response.json();

        if (!response.ok) {
            throw new Error(data.message || "Could not register.");
        }

        registerForm.reset();

        showMessage("Registration successful!", "success");

        showAccount(data.user);

    } catch (error) {
        showMessage(error.message);
    }
});

// LOGIN
loginForm.addEventListener("submit", async (event) => {
    event.preventDefault();

    const formData = new FormData(loginForm);

    const body = Object.fromEntries(formData.entries());

    try {
        const response = await fetch("/api/auth/login", {
            method: "POST",
            headers: {
                "Content-Type": "application/json"
            },
            credentials: "same-origin",
            body: JSON.stringify(body)
        });

        const data = await response.json();

        if (!response.ok) {
            throw new Error(data.message || "Could not sign in.");
        }

        loginForm.reset();

        showAccount(data.user);

    } catch (error) {
        showMessage(error.message);
    }
});

// SHOW ACCOUNT
function showAccount(user) {
    authForms.hidden = true;
    accountPanel.hidden = false;

    accountInfo.textContent =
        `Username: ${user.username} | Display Name: ${user.display_name}`;
}

// CHECK SESSION
async function checkSession() {
    try {
        const response = await fetch("/api/auth/me", {
            credentials: "same-origin"
        });

        if (!response.ok) return;

        const data = await response.json();

        if (data.authenticated) {
            showAccount(data.user);
        }

    } catch (error) {
        console.error("Session Error:", error);
    }
}

// LOGOUT
document.getElementById("logout-button")
    .addEventListener("click", async () => {
        try {
            const response = await fetch("/api/auth/logout", {
                method: "POST",
                credentials: "same-origin"
            });

            if (!response.ok) {
                throw new Error("Could not sign out.");
            }

            accountPanel.hidden = true;
            authForms.hidden = false;

            loginForm.reset();
            registerForm.reset();

            switchTab("login");

        } catch (error) {
            alert(error.message);
        }
    });

const initialMode = new URLSearchParams(
    window.location.search
).get("mode");

if (initialMode === "register") {
    switchTab("register");
}

checkSession();