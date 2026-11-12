(() => {
    const carousel = document.getElementById("home-announcements");
    const slides = document.getElementById("announcement-slides");
    const controls = document.getElementById("announcement-carousel-controls");
    const indicators = document.getElementById("announcement-indicators");
    const previous = document.getElementById("announcement-previous");
    const next = document.getElementById("announcement-next");
    const autoplay = document.getElementById("announcement-autoplay");
    const reducedMotion = window.matchMedia(
        "(prefers-reduced-motion: reduce)"
    );
    const intervalMs = 6000;
    let announcements = [];
    let currentIndex = 0;
    let timer = null;
    let pointerPaused = false;
    let focusPaused = false;
    let autoplayEnabled = !reducedMotion.matches;

    function safeHref(value) {
        if (typeof value !== "string" || value.includes("\\") ||
            /[\u0000-\u001f\u007f]/.test(value)) {
            return null;
        }
        if (value.startsWith("/") && !value.startsWith("//")) {
            return value;
        }
        if (!/^https?:\/\//i.test(value)) return null;
        try {
            const url = new URL(value);
            return ["http:", "https:"].includes(url.protocol) &&
                url.hostname && !url.username && !url.password
                ? url.href
                : null;
        } catch {
            return null;
        }
    }

    function updateTimer() {
        if (timer) {
            clearInterval(timer);
            timer = null;
        }
        const shouldRun = autoplayEnabled && !reducedMotion.matches &&
            !pointerPaused && !focusPaused && !document.hidden &&
            announcements.length > 1;
        slides.setAttribute("aria-live", shouldRun ? "off" : "polite");
        autoplay.setAttribute("aria-pressed", String(!shouldRun));
        autoplay.setAttribute(
            "aria-label",
            shouldRun ? "Pause automatic announcements" :
                "Resume automatic announcements"
        );
        autoplay.textContent = shouldRun ? "Pause" : "Play";
        autoplay.disabled = reducedMotion.matches;
        if (reducedMotion.matches) {
            autoplay.setAttribute(
                "aria-label",
                "Automatic announcements are disabled by reduced motion preference"
            );
            autoplay.textContent = "Auto-slide off";
        }
        if (shouldRun) {
            timer = setInterval(() => show(currentIndex + 1), intervalMs);
        }
    }

    function createSlide(announcement, index) {
        const slide = document.createElement("article");
        slide.className = "announcement-carousel__slide";
        slide.setAttribute("role", "group");
        slide.setAttribute("aria-roledescription", "slide");
        slide.setAttribute(
            "aria-label",
            `Announcement ${index + 1} of ${announcements.length}`
        );

        const title = document.createElement("h3");
        title.textContent = announcement.title;
        const content = document.createElement("p");
        content.textContent = announcement.content;
        slide.append(title, content);

        const href = safeHref(announcement.link_url);
        if (href && announcement.link_label) {
            const link = document.createElement("a");
            link.className = "announcement-carousel__link";
            link.href = href;
            link.textContent = announcement.link_label;
            if (!href.startsWith("/") &&
                new URL(href).origin !== window.location.origin) {
                link.target = "_blank";
                link.rel = "noopener noreferrer";
            }
            slide.appendChild(link);
        }
        return slide;
    }

    function show(index) {
        if (!announcements.length) return;
        currentIndex = (index + announcements.length) % announcements.length;
        slides.replaceChildren(
            createSlide(announcements[currentIndex], currentIndex)
        );
        indicators.querySelectorAll("button").forEach((button, buttonIndex) => {
            const active = buttonIndex === currentIndex;
            button.setAttribute("aria-current", String(active));
            button.setAttribute("aria-label",
                `Show announcement ${buttonIndex + 1} of ${announcements.length}`);
        });
        updateTimer();
    }

    function render() {
        if (!announcements.length) {
            carousel.hidden = true;
            return;
        }
        carousel.hidden = false;
        controls.hidden = announcements.length < 2;
        indicators.replaceChildren();
        announcements.forEach((announcement, index) => {
            const indicator = document.createElement("button");
            indicator.type = "button";
            indicator.className = "announcement-carousel__indicator";
            indicator.textContent = String(index + 1);
            indicator.addEventListener("click", () => show(index));
            indicators.appendChild(indicator);
        });
        show(0);
    }

    previous.addEventListener("click", () => show(currentIndex - 1));
    next.addEventListener("click", () => show(currentIndex + 1));
    autoplay.addEventListener("click", () => {
        if (reducedMotion.matches) return;
        autoplayEnabled = !autoplayEnabled;
        updateTimer();
    });

    carousel.addEventListener("pointerenter", () => {
        pointerPaused = true;
        updateTimer();
    });
    carousel.addEventListener("pointerleave", () => {
        pointerPaused = false;
        updateTimer();
    });
    carousel.addEventListener("focusin", () => {
        focusPaused = true;
        updateTimer();
    });
    carousel.addEventListener("focusout", () => {
        window.setTimeout(() => {
            if (!carousel.contains(document.activeElement)) {
                focusPaused = false;
                updateTimer();
            }
        }, 0);
    });
    carousel.addEventListener("keydown", event => {
        if (event.key === "ArrowLeft") {
            event.preventDefault();
            show(currentIndex - 1);
        } else if (event.key === "ArrowRight") {
            event.preventDefault();
            show(currentIndex + 1);
        } else if (event.key === "Home") {
            event.preventDefault();
            show(0);
        } else if (event.key === "End") {
            event.preventDefault();
            show(announcements.length - 1);
        }
    });
    document.addEventListener("visibilitychange", () => {
        updateTimer();
    });
    reducedMotion.addEventListener("change", event => {
        if (event.matches) autoplayEnabled = false;
        updateTimer();
    });

    fetch("/api/announcements/home-pinned")
        .then(async response => {
            const data = await response.json();
            if (!response.ok) {
                throw new Error(data.message || "Could not load announcements.");
            }
            announcements = Array.isArray(data.announcements)
                ? data.announcements
                : [];
            render();
        })
        .catch(error => {
            carousel.hidden = true;
            console.error("Pinned announcements error:", error);
        });
})();
