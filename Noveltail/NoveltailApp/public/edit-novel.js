const form = document.getElementById("edit-form");
const submitButton = document.getElementById("submit-button");
const message = document.getElementById("message");
const genreList = document.getElementById("genre-list");

const coverInput = document.getElementById("cover-image");
const coverPreview = document.getElementById("cover-preview");
const coverUrlInput = document.getElementById("cover_image_url");

const params = new URLSearchParams(window.location.search);
const novelId = params.get("id");

let selectedCover = null;
let previewUrl = null;
let currentCoverUrl = null;

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

function showPreview(url) {
    if (!url) {
        coverPreview.hidden = true;
        coverPreview.removeAttribute("src");
        return;
    }

    coverPreview.src = url;
    coverPreview.hidden = false;
}

// =====================================
// Select a new cover image.
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

        showPreview(previewUrl);
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

async function loadGenres(selectedGenres = []) {
    const data = await request("/api/novels/genres");

    const genres = Array.isArray(data)
        ? data
        : data.genres || [];

    genreList.innerHTML = "";

    genres.forEach(genre => {
        const label = document.createElement("label");
        label.className = "genre-option";

        const checkbox = document.createElement("input");

        checkbox.type = "checkbox";
        checkbox.name = "genres";
        checkbox.value = genre.genre_id;

        if (selectedGenres.map(Number).includes(Number(genre.genre_id))) {
            checkbox.checked = true;
        }

        const span = document.createElement("span");
        span.textContent = genre.genre_name;

        label.append(checkbox, span);
        genreList.appendChild(label);
    });
}

// =====================================
// Load novel data.
// =====================================

async function loadNovel() {
    if (!novelId || !/^\d+$/.test(novelId)) {
        throw new Error("Novel ID not found.");
    }

    const data = await request(
        `/api/writer/novels/${novelId}`
    );

    const novel = data.novel || data;

    document.getElementById("title").value =
        novel.title || "";

    document.getElementById("description").value =
        novel.description || "";

    document.getElementById("status").value =
        novel.status || "ongoing";

    currentCoverUrl = novel.cover_image_url || null;

    coverUrlInput.value =
        currentCoverUrl && /^https?:\/\//i.test(currentCoverUrl)
            ? currentCoverUrl
            : "";

    showPreview(currentCoverUrl);

    await loadGenres(novel.genres || []);
}

// =====================================
// Save changes.
// =====================================

form.addEventListener("submit", async event => {
    event.preventDefault();

    if (!form.reportValidity()) return;

    submitButton.disabled = true;
    message.textContent = "Saving...";

    try {
        const formData = new FormData(form);

        const enteredUrl = formData.get("cover_image_url")?.trim();

        let coverImageUrl = enteredUrl || currentCoverUrl;

        // Upload a newly selected file after saving the novel details.
        if (selectedCover) {
            coverImageUrl = currentCoverUrl;
        }

        const novelData = {
            title: formData.get("title"),
            description: formData.get("description"),
            cover_image_url: coverImageUrl || null,
            status: formData.get("status"),
            genres: formData.getAll("genres").map(Number)
        };

        await request(`/api/writer/novels/${novelId}`, {
            method: "PUT",
            headers: {
                "Content-Type": "application/json"
            },
            body: JSON.stringify(novelData)
        });

        // Upload the new image.
        if (selectedCover) {
            message.textContent = "Uploading cover image...";

            const imageData = new FormData();
            imageData.append("image", selectedCover);

            await request(`/api/uploads/cover/${novelId}`, {
                method: "POST",
                body: imageData
            });
        }

        message.textContent = "Changes saved.";

        setTimeout(() => {
            window.location.href = "/my-novels.html";
        }, 800);

    } catch (error) {
        message.textContent = error.message;

    } finally {
        submitButton.disabled = false;
    }
});

// =====================================
// Initialize the page.
// =====================================

async function init() {
    try {
        await loadNovel();
    } catch (error) {
        message.textContent = error.message;
    }
}

init();

window.addEventListener("beforeunload", () => {
    if (previewUrl) URL.revokeObjectURL(previewUrl);
});