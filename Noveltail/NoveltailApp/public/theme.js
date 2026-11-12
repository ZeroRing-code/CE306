(() => {
    const storageKey = "noveltail-theme";
    const root = document.documentElement;
    let userSelected = root.dataset.themePreference === "saved";

    function applyTheme(theme, persist = false) {
        root.dataset.theme = theme;
        if (persist) {
            userSelected = true;
            root.dataset.themePreference = "saved";
            try {
                localStorage.setItem(storageKey, theme);
            } catch {
                root.dataset.themePreference = "session";
            }
        }
        updateButton();
    }

    const button = document.createElement("button");
    button.type = "button";
    button.className = [
        "theme-toggle",
        "inline-flex",
        "items-center",
        "gap-2",
        "rounded-full",
        "border",
        "px-4",
        "py-2",
        "text-sm",
        "font-semibold",
        "shadow-lg",
        "transition"
    ].join(" ");

    function updateButton() {
        const isDark = root.dataset.theme === "dark";
        const label = isDark ? "Light mode" : "Dark mode";
        button.textContent = `${isDark ? "☀" : "☾"} ${label}`;
        button.setAttribute(
            "aria-label",
            `Switch to ${isDark ? "light" : "dark"} mode`
        );
        button.setAttribute("aria-pressed", String(isDark));
        button.title = `Switch to ${isDark ? "light" : "dark"} mode`;
    }

    button.addEventListener("click", () => {
        applyTheme(root.dataset.theme === "dark" ? "light" : "dark", true);
    });
    document.body.appendChild(button);
    updateButton();

    const systemPreference = window.matchMedia(
        "(prefers-color-scheme: dark)"
    );
    systemPreference.addEventListener("change", event => {
        if (!userSelected) applyTheme(event.matches ? "dark" : "light");
    });
})();
