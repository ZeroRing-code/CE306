
(() => {
    // =====================================
    // NOVELTAIL DEFAULT IMAGES
    // =====================================

    function escapeXML(value) {
        return String(value ?? "").replace(/[&<>"']/g, char => ({
            "&": "&amp;",
            "<": "&lt;",
            ">": "&gt;",
            '"': "&quot;",
            "'": "&apos;"
        })[char]);
    }

    function toSVGData(svg) {
        return `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`;
    }


    // =====================================
    // DEFAULT AVATAR
    // =====================================

    function avatar(label = "N") {
        const initial = Array.from(
            String(label || "N").trim()
        )[0] || "N";

        const svg = `
            <svg xmlns="http://www.w3.org/2000/svg"
                 width="300" height="300" viewBox="0 0 300 300">

                <defs>
                    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
                        <stop offset="0%" stop-color="#9476ed"/>
                        <stop offset="100%" stop-color="#5635b5"/>
                    </linearGradient>
                </defs>

                <rect width="300" height="300" rx="150" fill="url(#bg)"/>

                <circle cx="150" cy="150" r="119"
                        fill="none" stroke="#ffffff"
                        stroke-opacity=".18" stroke-width="2"/>

                <circle cx="150" cy="150" r="102"
                        fill="#ffffff" fill-opacity=".08"/>

                <text x="150" y="180"
                      text-anchor="middle"
                      font-family="Arial, sans-serif"
                      font-size="115"
                      font-weight="700"
                      fill="#ffffff">
                    ${escapeXML(initial.toUpperCase())}
                </text>
            </svg>
        `;

        return toSVGData(svg);
    }


    // =====================================
    // DEFAULT NOVEL COVER
    // =====================================

    function cover() {
        const svg = `
            <svg xmlns="http://www.w3.org/2000/svg"
                 width="360" height="480" viewBox="0 0 360 480">

                <defs>
                    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
                        <stop offset="0%" stop-color="#9476ed"/>
                        <stop offset="100%" stop-color="#35206f"/>
                    </linearGradient>

                    <linearGradient id="book" x1="0" y1="0" x2="1" y2="1">
                        <stop offset="0%" stop-color="#ffffff"/>
                        <stop offset="100%" stop-color="#e5dcff"/>
                    </linearGradient>
                </defs>

                <rect width="360" height="480" fill="url(#bg)"/>

                <circle cx="310" cy="80" r="105"
                        fill="#ffffff" fill-opacity=".07"/>

                <circle cx="30" cy="390" r="125"
                        fill="#ffffff" fill-opacity=".06"/>

                <path d="M110 153
                         Q150 137 180 160
                         Q210 137 250 153
                         L250 290
                         Q210 275 180 297
                         Q150 275 110 290 Z"
                      fill="url(#book)"
                      stroke="#ffffff"
                      stroke-width="5"
                      stroke-linejoin="round"/>

                <path d="M180 160 L180 297"
                      fill="none"
                      stroke="#7656d8"
                      stroke-width="4"/>

                <path d="M125 180 Q150 173 164 183
                         M125 199 Q150 192 164 202
                         M195 183 Q220 173 235 180
                         M195 202 Q220 192 235 199"
                      fill="none"
                      stroke="#9476ed"
                      stroke-width="4"
                      stroke-linecap="round"/>

                <text x="180" y="365"
                      text-anchor="middle"
                      font-family="Arial, sans-serif"
                      font-size="27"
                      font-weight="800"
                      letter-spacing="3"
                      fill="#ffffff">
                    NOVELTAIL
                </text>

                <text x="180" y="394"
                      text-anchor="middle"
                      font-family="Arial, sans-serif"
                      font-size="12"
                      letter-spacing="4"
                      fill="#ffffff"
                      fill-opacity=".8">
                    EVERY STORY MATTERS
                </text>

            </svg>
        `;

        return toSVGData(svg);
    }


    // =====================================
    // SET IMAGE WITH FALLBACK
    // =====================================

    function setImage(img, imageUrl, type, label = "") {
        if (!img) return;

        img.dataset.defaultImage = type;
        img.dataset.fallbackLabel = label;

        if (!img.dataset.fallbackListener) {
            img.addEventListener("error", () => {
                if (img.dataset.fallbackApplied === "true") {
                    return;
                }

                img.dataset.fallbackApplied = "true";

                img.src = type === "avatar"
                    ? avatar(img.dataset.fallbackLabel)
                    : cover();
            });

            img.dataset.fallbackListener = "true";
        }

        if (
            typeof imageUrl === "string" &&
            imageUrl.trim() &&
            imageUrl.trim() !== "null" &&
            imageUrl.trim() !== "undefined"
        ) {
            img.dataset.fallbackApplied = "false";
            img.src = imageUrl.trim();

        } else {
            img.dataset.fallbackApplied = "true";

            img.src = type === "avatar"
                ? avatar(label)
                : cover();
        }
    }


    // =====================================
    // AUTOMATIC IMAGE FALLBACK
    // =====================================

    function enhanceImage(img) {
        if (!(img instanceof HTMLImageElement)) return;

        const type = img.dataset.defaultImage;

        if (type !== "avatar" && type !== "cover") {
            return;
        }

        if (!img.dataset.fallbackListener) {
            img.addEventListener("error", () => {
                if (img.dataset.fallbackApplied === "true") {
                    return;
                }

                img.dataset.fallbackApplied = "true";

                img.src = type === "avatar"
                    ? avatar(img.dataset.fallbackLabel)
                    : cover();

            });

            img.dataset.fallbackListener = "true";
        }

        const src = img.getAttribute("src");

        if (!src || !src.trim()) {
            img.dataset.fallbackApplied = "true";

            img.src = type === "avatar"
                ? avatar(img.dataset.fallbackLabel)
                : cover();
        }
    }


    function scanImages(root = document) {
        if (root instanceof HTMLImageElement) {
            enhanceImage(root);
        }

        if (root.querySelectorAll) {
            root.querySelectorAll("img[data-default-image]")
                .forEach(enhanceImage);
        }
    }


    const observer = new MutationObserver(records => {
        records.forEach(record => {
            if (record.type === "childList") {
                record.addedNodes.forEach(node => {
                    if (node instanceof Element) {
                        scanImages(node);
                    }
                });
            }

            if (
                record.type === "attributes" &&
                record.target instanceof HTMLImageElement
            ) {
                enhanceImage(record.target);
            }
        });
    });


    // =====================================
    // PUBLIC FUNCTIONS
    // =====================================

    window.NoveltailImages = {
        avatar,
        cover,
        setImage,

        setAvatar(img, url, displayName) {
            setImage(img, url, "avatar", displayName || "N");
        },

        setCover(img, url, title) {
            setImage(img, url, "cover", title || "");
        }
    };


    // Initialize.
    scanImages();

    observer.observe(document.documentElement, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ["src", "data-default-image"]
    });

})();
