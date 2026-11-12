const form = document.getElementById("profile-form");
const submitButton = document.getElementById("submit-button");
const message = document.getElementById("message");

const avatarInput = document.getElementById("avatar-file");
const avatarPreview = document.getElementById("avatar-image");
const avatarUrlInput = document.getElementById("avatar-url");
const profileLink = document.getElementById("profile-link");

let selectedAvatar = null;
let previewUrl = null;
let currentAvatarUrl = null;
let currentUsername = "";

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
// Preview the profile image.
// =====================================

function showAvatar(url) {
    if (!url) {
        avatarPreview.hidden = true;
        avatarPreview.removeAttribute("src");
        return;
    }

    avatarPreview.src = url;
    avatarPreview.hidden = false;
}

// =====================================
// Select a profile image.
// =====================================

avatarInput.addEventListener("change", async () => {
    const file = avatarInput.files?.[0];
    if (!file) return;
    avatarInput.disabled = true;
    try {
        const croppedAvatar = await window.NoveltailCropper.crop(file, {
            aspectRatio: 1,
            shape: "circle"
        });

        if (!croppedAvatar) return;
        selectedAvatar = croppedAvatar;
        if (previewUrl) {
            URL.revokeObjectURL(previewUrl);
        }

        previewUrl = URL.createObjectURL(croppedAvatar);

        showAvatar(previewUrl);

        message.textContent = "";

    } catch (error) {
        message.textContent = error.message;
    } finally {
        avatarInput.value = "";
        avatarInput.disabled = false;
    }
});

// =====================================
// Load profile data.
// =====================================

async function loadProfile() {
    const data = await request("/api/profile/me");

    const user = data.user || data.profile || data;

    currentUsername = user.username || "";
    profileLink.href =
        `/profile.html?username=${encodeURIComponent(currentUsername)}`;

    document.getElementById("username").value =
        currentUsername;

    document.getElementById("display-name").value =
        user.display_name || "";

    document.getElementById("bio").value =
        user.bio || "";

    currentAvatarUrl = user.avatar_url || null;

    avatarUrlInput.value =
        currentAvatarUrl && /^https?:\/\//i.test(currentAvatarUrl)
            ? currentAvatarUrl
            : "";

    showAvatar(currentAvatarUrl);
}

// =====================================
// Save the profile.
// =====================================

form.addEventListener("submit", async event => {
    event.preventDefault();

    if (!form.reportValidity()) return;

    submitButton.disabled = true;
    message.textContent = "Saving profile...";

    try {
        const avatarUrl = selectedAvatar
            ? currentAvatarUrl
            : avatarUrlInput.value.trim() || currentAvatarUrl;
        const profileData = {
            display_name: document.getElementById("display-name").value,
            bio: document.getElementById("bio").value,
            avatar_url: avatarUrl || null
        };

        await request("/api/profile/me", {
            method: "PUT",
            headers: {
                "Content-Type": "application/json"
            },
            body: JSON.stringify(profileData)
        });

        if (selectedAvatar) {
            message.textContent = "Uploading profile image...";
            const imageData = new FormData();
            imageData.append("image", selectedAvatar);

            const uploaded = await request("/api/uploads/avatar", {
                method: "POST",
                body: imageData
            });
            currentAvatarUrl = uploaded.avatar_url;
        }

        message.textContent = "Profile saved.";

        setTimeout(() => {
            window.location.href = profileLink.href;
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
        await loadProfile();
    } catch (error) {
        message.textContent = error.message;
    }
}

init();

window.addEventListener("beforeunload", () => {
    if (previewUrl) URL.revokeObjectURL(previewUrl);
});