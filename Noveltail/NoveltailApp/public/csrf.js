(() => {
    const originalFetch = window.fetch.bind(window);
    const cookieName = "noveltail_csrf";
    const unsafeMethods = new Set(["POST", "PUT", "PATCH", "DELETE"]);

    function readToken() {
        const cookie = document.cookie
            .split("; ")
            .find(item => item.startsWith(`${cookieName}=`));
        return cookie ? decodeURIComponent(cookie.slice(cookieName.length + 1)) : "";
    }

    window.fetch = async (input, init = {}) => {
        const requestUrl = input instanceof Request ? input.url : input;
        const url = new URL(requestUrl, window.location.href);
        const method = String(
            init.method || (input instanceof Request ? input.method : "GET")
        ).toUpperCase();
        if (url.origin !== window.location.origin || !unsafeMethods.has(method)) {
            return originalFetch(input, init);
        }

        let token = readToken();
        if (!token) {
            const response = await originalFetch("/api/auth/csrf", {
                credentials: "same-origin"
            });
            if (!response.ok) {
                throw new Error("Could not validate the CSRF token. Please reload the page.");
            }
            const data = await response.json();
            token = data.token;
        }

        const headers = new Headers(
            init.headers || (input instanceof Request ? input.headers : undefined)
        );
        headers.set("X-CSRF-Token", token);
        return originalFetch(input, { ...init, headers });
    };
})();
