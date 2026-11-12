const form = document.getElementById("create-form");
const submitButton = document.getElementById("submit-button");
const message = document.getElementById("message");
const genreList = document.getElementById("genre-list");

const coverInput = document.getElementById("cover-image");
const coverPreview = document.getElementById("cover-preview");

let selectedCover = null;
let previewUrl = null;

// =====================================
// API
// =====================================

async function request(url, options = {}) {
    const response = await fetch(url, {
        credentials: "same-origin",
        ...options
    });

    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
        throw new Error(data.message || "Something went wrong.");
    }

    return data;
}

// =====================================
// Preview the novel cover.
// =====================================

coverInput.addEventListener("change", async () => {
    const file = coverInput.files?.[0];
    if (!file) return;
    coverInput.disabled = true;
    try {
        const croppedCover = await window.NoveltailCropper.crop(file, {
            aspectRatio: 3 / 4,
            shape: "rectangle"
        });

        if (!croppedCover) return;
        selectedCover = croppedCover;
        if (previewUrl) {
            URL.revokeObjectURL(previewUrl);
        }

        previewUrl = URL.createObjectURL(croppedCover);

        coverPreview.src = previewUrl;
        coverPreview.hidden = false;

        message.textContent = "";

    } catch (error) {
        message.textContent = error.message;
    } finally {
        coverInput.value = "";
        coverInput.disabled = false;
    }
});

// =====================================
// Load genres.
// =====================================

async function loadGenres() {
    try {
        const data = await request("/api/novels/genres");

        const genres = Array.isArray(data)
            ? data
            : data.genres || [];

        genreList.innerHTML = "";

        if (genres.length === 0) {
            genreList.textContent = "No genres available.";
            return;
        }

        genres.forEach(genre => {
            const label = document.createElement("label");
            label.className = "genre-option";

            const checkbox = document.createElement("input");
            checkbox.type = "checkbox";
            checkbox.name = "genres";
            checkbox.value = genre.genre_id;

            const span = document.createElement("span");
            span.textContent = genre.genre_name;

            label.append(checkbox, span);
            genreList.appendChild(label);
        });

    } catch (error) {
        genreList.textContent = error.message;
    }
}

// =====================================
// Check authentication.
// =====================================

async function checkLogin() {
    try {
        await request("/api/auth/me");
    } catch {
        window.location.href = "/auth.html";
    }
}

// =====================================
// Create the novel.
// =====================================

form.addEventListener("submit", async event => {
    event.preventDefault();

    if (!form.reportValidity()) return;

    submitButton.disabled = true;
    message.textContent = "Creating novel...";

    try {
        const formData = new FormData(form);

        const novelData = {
            title: formData.get("title"),
            description: formData.get("description"),
            cover_image_url: selectedCover
                ? null
                : (formData.get("cover_image_url") || null),
            status: formData.get("status"),
            genres: formData.getAll("genres").map(Number)
        };

        // Create the novel.
        const created = await request("/api/writer/novels", {
            method: "POST",
            headers: {
                "Content-Type": "application/json"
            },
            body: JSON.stringify(novelData)
        });

        const novelId = created.novel?.novel_id;

        if (!novelId) {
            throw new Error("Could not retrieve the new novel ID.");
        }

        // Upload the cover image.
        if (selectedCover) {
            message.textContent = "Uploading novel cover...";

            const imageData = new FormData();
            imageData.append("image", selectedCover);

            await request(`/api/uploads/cover/${novelId}`, {
                method: "POST",
                body: imageData
            });
        }

        message.textContent = "Novel created.";

        form.reset();

        selectedCover = null;
        if (previewUrl) {
            URL.revokeObjectURL(previewUrl);
            previewUrl = null;
        }
        coverPreview.hidden = true;
        coverPreview.removeAttribute("src");

        setTimeout(() => {
            window.location.href = "/my-novels.html";
        }, 800);

    } catch (error) {
        message.textContent = error.message;

    } finally {
        submitButton.disabled = false;
    }
});

window.addEventListener("beforeunload", () => {
    if (previewUrl) URL.revokeObjectURL(previewUrl);
});

// =====================================
// Initialize the page.
// =====================================

checkLogin();
loadGenres();