(() => {
    let preference = null;
    try {
        const stored = localStorage.getItem("noveltail-theme");
        if (stored === "light" || stored === "dark") {
            preference = stored;
        }
    } catch {
        preference = null;
    }

    const systemPrefersDark = window.matchMedia(
        "(prefers-color-scheme: dark)"
    ).matches;
    document.documentElement.dataset.theme = preference ||
        (systemPrefersDark ? "dark" : "light");
    document.documentElement.dataset.themePreference =
        preference ? "saved" : "system";
})();
