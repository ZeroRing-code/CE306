const searchForm = document.getElementById("search-form");
const searchInput = document.getElementById("search-input");
const genreList = document.getElementById("genre-list");
const novelList = document.getElementById("novel-list");
const emptyMessage = document.getElementById("empty-message");
const resultCount = document.getElementById("result-count");
const sortSelect = document.getElementById("sort-select");
const clearButton = document.getElementById("clear-genres");

let selectedGenres = new Set();
let searchTimer;

// Load genres.
async function loadGenres() {
    try {
        const response = await fetch("/api/novels/genres");
        if (!response.ok) throw new Error("Could not load genres.");

        const genres = await response.json();

        genreList.replaceChildren();

        genres.forEach((genre) => {
            const label = document.createElement("label");
            label.className = "genre-option";

            const checkbox = document.createElement("input");
            checkbox.type = "checkbox";
            checkbox.value = genre.genre_id;

            const name = document.createElement("span");
            name.textContent = genre.genre_name;

            checkbox.addEventListener("change", () => {
                const id = Number(genre.genre_id);

                if (checkbox.checked) {
                    selectedGenres.add(id);
                } else {
                    selectedGenres.delete(id);
                }

                loadNovels();
            });

            label.append(checkbox, name);
            genreList.appendChild(label);
        });

    } catch (error) {
        genreList.textContent = "Could not load genres.";
        console.error(error);
    }
}

// Create the novel card element.
function createNovelCard(novel) {
    const card = document.createElement("article");
    card.className = "novel-card";

    const cover = document.createElement("div");
    cover.className = "novel-cover";

    if (novel.cover_image_url) {
        const image = document.createElement("img");
        image.src = novel.cover_image_url;
        image.alt = `Novel cover: ${novel.title}`;
        image.loading = "lazy";

        image.onerror = () => {
            image.remove();

            const placeholder = document.createElement("span");
            placeholder.className = "cover-placeholder";
            placeholder.textContent = "NOVELTAIL";
            cover.appendChild(placeholder);
        };

        cover.appendChild(image);
    } else {
        const placeholder = document.createElement("span");
        placeholder.className = "cover-placeholder";
        placeholder.textContent = "NOVELTAIL";
        cover.appendChild(placeholder);
    }

    const content = document.createElement("div");
    content.className = "novel-content";

const title = document.createElement("h3");
title.className = "novel-title";

const titleLink = document.createElement("a");
titleLink.href =
    `/novel.html?id=${encodeURIComponent(novel.novel_id)}`;

titleLink.textContent = novel.title;
titleLink.style.color = "inherit";
titleLink.style.textDecoration = "none";

title.appendChild(titleLink);

    const author = document.createElement("p");
    author.className = "novel-author";
    author.textContent =
        `by ${novel.display_name || novel.username}`;

    const description = document.createElement("p");
    description.className = "novel-description";
    description.textContent =
        novel.description || "No description available.";

    const genres = document.createElement("div");
    genres.className = "novel-genres";

    (novel.genres || []).forEach((genre) => {
        const tag = document.createElement("span");
        tag.className = "novel-genre";
        tag.textContent = genre.genre_name;
        genres.appendChild(tag);
    });

    const meta = document.createElement("div");
    meta.className = "novel-meta";

    const views = document.createElement("span");
    views.textContent =
        `Read ${Number(novel.view_count).toLocaleString("en-US")}`;

    const chapters = document.createElement("span");
    chapters.textContent = `${novel.chapter_count} chapters`;

    const rating = document.createElement("span");

    rating.textContent = Number(novel.review_count) > 0
        ? `★ ${novel.average_rating} (${novel.review_count})`
        : "No reviews yet";

    meta.append(views, chapters, rating);

    content.append(title, author, description, genres, meta);
    card.append(cover, content);

    return card;
}

// Load novels from the database.
async function loadNovels() {
    novelList.replaceChildren();
    emptyMessage.hidden = true;
    resultCount.textContent = "Loading novels...";

    const params = new URLSearchParams();

    params.set("q", searchInput.value.trim());
    params.set("sort", sortSelect.value);

    if (selectedGenres.size > 0) {
        params.set(
            "genres",
            [...selectedGenres].join(",")
        );
    }

    try {
        const response = await fetch(
            `/api/novels?${params.toString()}`
        );

        const data = await response.json();

        if (!response.ok) {
            throw new Error(data.message || "Could not load novels.");
        }

        resultCount.textContent =
            `${Number(data.total).toLocaleString("en-US")} novels found`;

        novelList.replaceChildren();

        if (data.novels.length === 0) {
            emptyMessage.hidden = false;
            return;
        }

        data.novels.forEach((novel) => {
            novelList.appendChild(createNovelCard(novel));
        });

    } catch (error) {
        resultCount.textContent = "Could not load novels.";
        console.error("Novel Loading Error:", error);
    }
}

// Search.
searchForm.addEventListener("submit", (event) => {
    event.preventDefault();
    loadNovels();
});

// Search as the user types.
searchInput.addEventListener("input", () => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(loadNovels, 300);
});

// Change the sort order.
sortSelect.addEventListener("change", loadNovels);

// Clear the selected genre.
clearButton.addEventListener("click", () => {
    selectedGenres.clear();

    genreList
        .querySelectorAll('input[type="checkbox"]')
        .forEach((checkbox) => {
            checkbox.checked = false;
        });

    loadNovels();
});

// Initialize the application.
async function init() {
    await loadGenres();
    await loadNovels();
}

init();
// =====================================
// NAVBAR AUTHENTICATION
// =====================================

async function updateNavbarAuth() {
    const authLink = document.getElementById("auth-link");
    const writeLink = document.getElementById("write-link");

    if (!authLink || !writeLink) return;

    try {
        const response = await fetch("/api/auth/me");

        let loggedIn = false;

        if (response.ok) {
            const data = await response.json();
            loggedIn = data.authenticated === true;
        }

        if (loggedIn) {
            // Signed in.
            authLink.textContent = "Logout";
            authLink.href = "#";
            authLink.dataset.loggedIn = "true";

            writeLink.href = "/my-novels.html";

        } else {
            // Not signed in.
            authLink.textContent = "Login";
            authLink.href = "/auth.html";
            authLink.dataset.loggedIn = "false";

            writeLink.href = "/auth.html?mode=register";
        }

    } catch (error) {
        console.error("Auth Status Error:", error);
    }
}

updateNavbarAuth();

// Sign out.
document.addEventListener("click", async (event) => {
    const authLink = event.target.closest("#auth-link");

    if (!authLink || authLink.dataset.loggedIn !== "true") {
        return;
    }

    event.preventDefault();

    try {
        const response = await fetch("/api/auth/logout", {
            method: "POST"
        });

        if (!response.ok) {
            throw new Error("Logout failed");
        }

        window.location.href = "/";

    } catch (error) {
        alert("Could not sign out.");
        console.error(error);
    }
});

updateNavbarAuth();