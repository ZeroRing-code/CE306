(() => {
    "use strict";

    const headers = document.querySelectorAll(
        "header.navbar, header.reading-header, header.topbar"
    );

    if (!headers.length) {
        return;
    }

    const navigationGroups = [];

    headers.forEach(header => {
        const group = document.createElement("div");
        group.className = "account-navigation";

        const link = document.createElement("a");
        link.className = "profile-nav";
        link.href = "#";
        link.hidden = true;
        link.innerHTML = `
            <img class="profile-nav-avatar" alt="" data-default-image="avatar">
            <span class="profile-nav-label"></span>
        `;

        const walletLink = document.createElement("a");
        walletLink.className = "profile-nav-shortcut";
        walletLink.href = "/wallet.html";
        walletLink.textContent = "Wallet";
        walletLink.hidden = true;

        const notificationsLink = document.createElement("a");
        notificationsLink.className = "profile-nav-shortcut";
        notificationsLink.href = "/notifications.html";
        notificationsLink.title = "Notifications";
        notificationsLink.innerHTML =
            'Notifications <span class="notification-badge" hidden></span>';
        notificationsLink.hidden = true;

        const reportsLink = document.createElement("a");
        reportsLink.className = "profile-nav-shortcut";
        reportsLink.href = "/reports.html";
        reportsLink.textContent = "My Reports";
        reportsLink.hidden = true;

        const adminLink = document.createElement("a");
        adminLink.className = "profile-nav-shortcut";
        adminLink.href = "/admin.html";
        adminLink.textContent = "Admin";
        adminLink.hidden = true;

        const loginLink = document.createElement("a");
        loginLink.className = "profile-nav-shortcut";
        loginLink.href = "/auth.html";
        loginLink.textContent = "Sign in";
        loginLink.hidden = true;

        group.append(
            link, walletLink, notificationsLink, reportsLink, adminLink,
            loginLink
        );
        const destination = header.querySelector(".nav-actions") || header;
        destination.appendChild(group);
        navigationGroups.push({
            profile: link,
            wallet: walletLink,
            notifications: notificationsLink,
            reports: reportsLink,
            admin: adminLink,
            login: loginLink
        });
    });

    async function updateProfileLinks() {
        const showLogin = () => {
            navigationGroups.forEach(group => {
                group.profile.hidden = true;
                group.wallet.hidden = true;
                group.notifications.hidden = true;
                group.reports.hidden = true;
                group.admin.hidden = true;
                group.login.hidden = false;
            });

            const homeLoginLink = document.getElementById("auth-link");
            if (homeLoginLink) {
                homeLoginLink.hidden = true;
            }
        };

        try {
            const response = await fetch("/api/auth/me", {
                credentials: "same-origin",
                headers: {
                    Accept: "application/json"
                }
            });

            if (!response.ok) {
                showLogin();
                return;
            }

            const data = await response.json();
            const user = data.user;

            if (!data.authenticated || !user?.username) {
                throw new Error("Invalid current user data.");
            }

            const profileUrl =
                `/profile.html?username=${encodeURIComponent(user.username)}`;

            navigationGroups.forEach(group => {
                const avatar = group.profile.querySelector(".profile-nav-avatar");
                const label = group.profile.querySelector(".profile-nav-label");
                group.profile.href = profileUrl;
                group.profile.classList.add("is-authenticated");
                group.profile.setAttribute(
                    "aria-label",
                    `Profile: ${user.display_name || user.username}`
                );
                label.textContent = user.display_name || user.username;
                window.NoveltailImages.setAvatar(
                    avatar,
                    user.avatar_url,
                    user.display_name || user.username
                );
                avatar.hidden = false;
                group.profile.hidden = false;
                group.wallet.hidden = false;
                group.notifications.hidden = false;
                group.reports.hidden = false;
                group.admin.hidden =
                    !user.is_admin &&
                    !["ADMIN", "SUPER_ADMIN"].includes(user.role);
                group.login.hidden = true;
            });

            try {
                const countResponse = await fetch(
                    "/api/notifications/unread-count",
                    { credentials: "same-origin" }
                );
                if (!countResponse.ok) {
                    throw new Error("Could not load unread notification count.");
                }
                const countData = await countResponse.json();
                navigationGroups.forEach(group => {
                    const badge = group.notifications.querySelector(
                        ".notification-badge"
                    );
                    badge.textContent = countData.unread > 99
                        ? "99+"
                        : String(countData.unread);
                    badge.hidden = countData.unread === 0;
                });
            } catch (error) {
                console.error("Load unread notification count:", error);
            }
        } catch (error) {
            console.error("Load current user for navigation:", error);
            showLogin();
        }
    }

    updateProfileLinks();

    document.addEventListener("noveltail:notifications-changed", () => {
        updateProfileLinks();
    });
})();
