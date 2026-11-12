
(() => {
    // =====================================
    // INITIALIZE
    // =====================================

    const params = new URLSearchParams(window.location.search);
    const username = params.get("username");

    const message = document.getElementById("profile-message");
    const profileContent = document.getElementById("profile-content");

    const avatar = document.getElementById("profile-avatar");
    const editProfileLink = document.getElementById("edit-profile-link");
    const followButton = document.getElementById("follow-profile-button");
    const followMessage = document.getElementById("follow-profile-message");
    const novelsContainer = document.getElementById("profile-novels");
    const emptyState = document.getElementById("profile-empty");


    // =====================================
    // SAFE IMAGE URL
    // =====================================

    function safeImageUrl(value) {
        if (!value || typeof value !== "string") {
            return "";
        }

        try {
            const url = new URL(value, window.location.origin);

            if (
                url.protocol === "http:" ||
                url.protocol === "https:"
            ) {
                return url.href;
            }
        } catch (error) {
            return "";
        }

        return "";
    }


    // =====================================
    // FORMAT DATE
    // =====================================

    function formatDate(value) {
        if (!value) return "";

        const date = new Date(value);

        if (Number.isNaN(date.getTime())) {
            return "";
        }

        return new Intl.DateTimeFormat("th-TH", {
            year: "numeric",
            month: "long",
            day: "numeric"
        }).format(date);
    }


    // =====================================
    // CREATE NOVEL CARD
    // =====================================

    function createNovelCard(novel) {
        const card = document.createElement("article");
        card.className = "novel-card";

        const link = document.createElement("a");
        link.href = `/novel.html?id=${encodeURIComponent(novel.novel_id)}`;

        const cover = document.createElement("img");
        cover.className = "novel-cover";
        cover.alt = `Cover for ${novel.title || "novel"}`;

        window.NoveltailImages.setCover(
            cover,
            safeImageUrl(novel.cover_image_url),
            novel.title
        );

        link.appendChild(cover);

        const info = document.createElement("div");
        info.className = "novel-card-info";

        const title = document.createElement("h3");
        title.textContent = novel.title || "Untitled";

        const chapterCount = document.createElement("p");
        chapterCount.textContent =
            `${Number(novel.chapter_count) || 0} published chapters`;

        const description = document.createElement("p");
        description.className = "novel-description";
        description.textContent =
            novel.description || "No description available.";

        info.append(title, chapterCount, description);
        card.append(link, info);

        return card;
    }


    // =====================================
    // LOAD PROFILE
    // =====================================

    async function loadProfile() {
        if (!username) {
            message.textContent = "Username not found.";
            return;
        }

        try {
            const response = await fetch(
                `/api/profile/${encodeURIComponent(username)}`,
                {
                    headers: {
                        Accept: "application/json"
                    }
                }
            );

            const data = await response.json().catch(() => ({}));

            if (!response.ok) {
                throw new Error(
                    data.message || "Could not load profile."
                );
            }

            const profile = data.profile;
            const novels = Array.isArray(data.novels)
                ? data.novels
                : [];

            try {
                const authResponse = await fetch("/api/auth/me", {
                    credentials: "same-origin",
                    headers: {
                        Accept: "application/json"
                    }
                });
                if (authResponse.ok) {
                    const authData = await authResponse.json();
                    const isOwner =
                        String(authData.user?.user_id) === String(profile.user_id);
                    editProfileLink.hidden = !isOwner;
                    if (!isOwner && authData.authenticated) {
                        const followResponse = await fetch(
                            `/api/follows/${encodeURIComponent(profile.user_id)}/status`,
                            { credentials: "same-origin" }
                        );
                        if (followResponse.ok) {
                            const followData = await followResponse.json();
                            followButton.textContent =
                                followData.following ? "Unfollow" : "Follow";
                            followButton.setAttribute(
                                "aria-label",
                                followButton.textContent
                            );
                            followButton.dataset.following =
                                String(followData.following);
                            followButton.dataset.userId = profile.user_id;
                            followButton.title = followData.following
                                ? "Unfollow this author"
                                : "Follow this author";
                            followButton.hidden = false;
                        }
                    }
                }
            } catch (error) {
                console.error("Check Profile Owner:", error);
            }

            followButton.addEventListener("click", async () => {
                const following = followButton.dataset.following === "true";
                followButton.disabled = true;
                followMessage.textContent = "Updating...";
                try {
                    const response = await fetch(
                        `/api/follows/${encodeURIComponent(followButton.dataset.userId)}`,
                        {
                            method: following ? "DELETE" : "POST",
                            credentials: "same-origin"
                        }
                    );
                    const data = await response.json().catch(() => ({}));
                    if (!response.ok) {
                        throw new Error(data.message || "Could not update follow status.");
                    }
                    followButton.dataset.following = String(data.following);
                    followButton.textContent = data.following ? "Unfollow" : "Follow";
                    followButton.setAttribute(
                        "aria-label",
                        followButton.textContent
                    );
                    followButton.title = data.following
                        ? "Unfollow this author"
                        : "Follow this author";
                    followMessage.textContent = data.following
                        ? "Following writer."
                        : "Unfollowed writer.";
                } catch (error) {
                    followMessage.textContent = error.message;
                } finally {
                    followButton.disabled = false;
                }
            });

            // Profile image.
            window.NoveltailImages.setAvatar(
                avatar,
                safeImageUrl(profile.avatar_url),
                profile.display_name || profile.username
            );

            // User details.
            document.getElementById("profile-name").textContent =
                profile.display_name || profile.username;

            document.getElementById("profile-username").textContent =
                `@${profile.username}`;

            document.getElementById("profile-bio").textContent =
                profile.bio || "This user has not added a bio.";

            document.getElementById("profile-joined").textContent =
                `Member since ${formatDate(profile.created_at)}`;

            document.getElementById("profile-novel-count").textContent =
                Number(profile.novel_count) || 0;

            document.title =
                `${profile.display_name || profile.username} | Noveltail`;

            // Novel list.
            novelsContainer.innerHTML = "";

            if (novels.length === 0) {
                emptyState.hidden = false;
            } else {
                emptyState.hidden = true;

                novels.forEach(novel => {
                    novelsContainer.appendChild(
                        createNovelCard(novel)
                    );
                });
            }

            profileContent.hidden = false;
            message.hidden = true;

        } catch (error) {
            console.error("Load Profile:", error);

            message.textContent = error.message;
            message.hidden = false;
        }
    }


    // =====================================
    // START
    // =====================================

    loadProfile();

})();
