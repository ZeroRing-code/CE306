
(() => {
    // =====================================
    // INITIALIZE
    // =====================================

    const params = new URLSearchParams(window.location.search);
    const chapterId = params.get("chapterId");

    const commentForm = document.getElementById("comment-form");
    const commentInput = document.getElementById("comment-input");
    const commentSubmit = document.getElementById("comment-submit");
    const commentLogin = document.getElementById("comment-login");
    const commentList = document.getElementById("comments-list");
    const commentCount = document.getElementById("comments-count");
    const commentMessage = document.getElementById("comment-form-message");
    const charCount = document.getElementById("comment-char-count");

    const MAX_LENGTH = 2000;

    let currentUserId = null;
    let comments = [];
    let myReactions = new Map();
    let sortMode = "newest";
    const busyReactions = new Set();

    if (
        !commentForm || !commentInput || !commentSubmit ||
        !commentLogin || !commentList || !commentCount ||
        !commentMessage || !charCount
    ) {
        console.error("Comments: required HTML elements were not found.");
        return;
    }

    if (!/^\d+$/.test(chapterId || "") || Number(chapterId) <= 0) {
        commentList.textContent = "Chapter ID not found.";
        return;
    }


    // =====================================
    // CSS
    // =====================================

    const style = document.createElement("style");

    style.textContent = `
        .comment-sort-bar {
            display: flex;
            align-items: center;
            justify-content: flex-end;
            gap: 10px;
            flex-wrap: wrap;
            margin-bottom: 16px;
        }

        .comment-sort-bar label {
            color: #5f5c6a;
            font-size: 12px;
        }

        .comment-sort-select {
            padding: 8px 12px;
            border: 1px solid #dedbe8;
            border-radius: 8px;
            background: white;
            color: #555;
            font-size: 12px;
            cursor: pointer;
        }

        .comment-reaction-bar {
            display: flex;
            align-items: center;
            gap: 9px;
            flex-wrap: wrap;
            margin-top: 12px;
        }

        .comment-reaction-button {
            border: 1px solid #e8e5ef;
            background: white;
            color: #5f5c6a;
            border-radius: 20px;
            padding: 6px 11px;
            font-size: 12px;
            cursor: pointer;
            transition: 0.15s;
        }

        .comment-reaction-button:hover {
            border-color: #b9a7ed;
            background: #f7f4ff;
        }

        .comment-reaction-button.active {
            background: #f1edff;
            border-color: #7656d8;
            color: #7656d8;
            font-weight: 700;
        }

        .comment-reaction-button.dislike-active {
            background: #fff1f1;
            border-color: #d97979;
            color: #c44b4b;
            font-weight: 700;
        }

        .comment-reaction-button:disabled {
            opacity: 0.55;
            cursor: not-allowed;
        }

        .comment-item .comment-actions {
            display: flex;
            flex-wrap: wrap;
            gap: 10px;
        }
    `;

    document.head.appendChild(style);


    // =====================================
    // SORT CONTROL
    // =====================================

    const sortBar = document.createElement("div");
    sortBar.className = "comment-sort-bar";

    const sortLabel = document.createElement("label");
    sortLabel.textContent = "Sort by";

    const sortSelect = document.createElement("select");
    sortSelect.className = "comment-sort-select";

    const sortOptions = [
        ["newest", "Newest first"],
        ["oldest", "Oldest first"],
        ["score-desc", "Highest score"],
        ["score-asc", "Lowest score"]
    ];

    sortOptions.forEach(([value, label]) => {
        const option = document.createElement("option");
        option.value = value;
        option.textContent = label;
        sortSelect.appendChild(option);
    });

    sortSelect.value = sortMode;
    sortLabel.appendChild(sortSelect);
    sortBar.appendChild(sortLabel);

    commentList.parentNode.insertBefore(sortBar, commentList);

    sortSelect.addEventListener("change", () => {
        sortMode = sortSelect.value;
        renderComments();
    });


    // =====================================
    // API HELPER
    // =====================================

    async function apiRequest(url, options = {}) {
        const response = await fetch(url, {
            credentials: "same-origin",
            ...options,
            headers: {
                Accept: "application/json",
                ...(options.headers || {})
            }
        });

        const data = await response.json().catch(() => ({}));

        if (!response.ok) {
            throw new Error(data.message || "The action could not be completed.");
        }

        return data;
    }


    // =====================================
    // CHECK LOGIN
    // =====================================

    async function checkLogin() {
        try {
            const data = await apiRequest("/api/auth/me");

            if (data.authenticated && data.user?.user_id) {
                currentUserId = String(data.user.user_id);
            }
        } catch (error) {
            currentUserId = null;
        }

        commentForm.hidden = !currentUserId;
        commentLogin.hidden = Boolean(currentUserId);
    }


    // =====================================
    // LOAD MY REACTIONS
    // =====================================

    async function loadMyReactions() {
        myReactions.clear();

        if (!currentUserId) return;

        try {
            const data = await apiRequest(
                `/api/reactions/comments/${encodeURIComponent(chapterId)}/mine`
            );

            (data.reactions || []).forEach(item => {
                myReactions.set(
                    String(item.comment_id),
                    item.reaction_type
                );
            });

        } catch (error) {
            console.error("Load My Comment Reactions:", error);
        }
    }


    // =====================================
    // FORMAT DATE
    // =====================================

    function formatDate(dateValue) {
        if (!dateValue) return "";

        const date = new Date(dateValue);

        if (Number.isNaN(date.getTime())) return "";

        return new Intl.DateTimeFormat("th-TH", {
            year: "numeric",
            month: "short",
            day: "numeric",
            hour: "2-digit",
            minute: "2-digit"
        }).format(date);
    }


    // =====================================
    // SORTING
    // =====================================

    function reactionScore(comment) {
        return (Number(comment.like_count) || 0) -
            (Number(comment.dislike_count) || 0);
    }

    function compareComments(a, b) {
        const dateA = new Date(a.created_at).getTime() || 0;
        const dateB = new Date(b.created_at).getTime() || 0;

        if (sortMode === "oldest") {
            return dateA - dateB;
        }

        if (sortMode === "score-desc") {
            return reactionScore(b) - reactionScore(a) ||
                dateB - dateA;
        }

        if (sortMode === "score-asc") {
            return reactionScore(a) - reactionScore(b) ||
                dateB - dateA;
        }

        return dateB - dateA;
    }


    // =====================================
    // CHARACTER COUNTER
    // =====================================

    commentInput.addEventListener("input", () => {
        charCount.textContent =
            `${commentInput.value.length} / ${MAX_LENGTH}`;
    });


    // =====================================
    // FORM MESSAGE
    // =====================================

    function showFormMessage(text, isError = false) {
        commentMessage.textContent = text;
        commentMessage.classList.toggle("error", isError);
    }


    // =====================================
    // CREATE REACTION BUTTONS
    // =====================================

    function createReactionBar(comment) {
        const bar = document.createElement("div");
        bar.className = "comment-reaction-bar";

        const id = String(comment.comment_id);
        const selected = myReactions.get(id);

        const likeButton = document.createElement("button");
        likeButton.type = "button";
        likeButton.className = "comment-reaction-button";
        likeButton.dataset.commentReaction = id;
        likeButton.dataset.reactionType = "like";
        likeButton.textContent = `Like · ${Number(comment.like_count) || 0}`;
        likeButton.title = "Like comment";
        likeButton.setAttribute(
            "aria-label",
            `Like comment (${Number(comment.like_count) || 0})`
        );

        if (selected === "like") {
            likeButton.classList.add("active");
            likeButton.setAttribute("aria-pressed", "true");
        } else {
            likeButton.setAttribute("aria-pressed", "false");
        }

        const dislikeButton = document.createElement("button");
        dislikeButton.type = "button";
        dislikeButton.className = "comment-reaction-button";
        dislikeButton.dataset.commentReaction = id;
        dislikeButton.dataset.reactionType = "dislike";
        dislikeButton.textContent =
            `Dislike · ${Number(comment.dislike_count) || 0}`;
        dislikeButton.title = "Dislike comment";
        dislikeButton.setAttribute(
            "aria-label",
            `Dislike comment (${Number(comment.dislike_count) || 0})`
        );

        if (selected === "dislike") {
            dislikeButton.classList.add("dislike-active");
            dislikeButton.setAttribute("aria-pressed", "true");
        } else {
            dislikeButton.setAttribute("aria-pressed", "false");
        }

        if (busyReactions.has(id)) {
            likeButton.disabled = true;
            dislikeButton.disabled = true;
        }

        bar.append(likeButton, dislikeButton);

        return bar;
    }


    // =====================================
    // CREATE COMMENT ELEMENT
    // =====================================

    function createCommentElement(comment, isReply = false) {
        const article = document.createElement("article");

        article.className = isReply
            ? "comment-item comment-reply-item"
            : "comment-item";

        const meta = document.createElement("div");
        meta.className = "comment-meta";

        const authorArea = document.createElement("div");
        const authorLine = document.createElement("div");
        authorLine.className = "comment-author-line";

        const author = document.createElement("div");
        author.className = "comment-author";
        author.textContent =
            comment.display_name || comment.username || "User";

        authorLine.appendChild(author);

        if (comment.is_author === true) {
            const badge = document.createElement("span");
            badge.className = "comment-author-badge";
            badge.textContent = "✦ Author";
            authorLine.appendChild(badge);
        }

        const date = document.createElement("div");
        date.className = "comment-date";
        date.textContent = formatDate(comment.created_at);

        authorArea.append(authorLine, date);
        meta.appendChild(authorArea);

        const content = document.createElement("p");
        content.className = "comment-content";
        content.textContent = comment.content;

        article.append(meta, content);

        // Like / Dislike
        article.appendChild(createReactionBar(comment));

        const actions = document.createElement("div");
        actions.className = "comment-actions";

        // Only top-level comments can be replied to.
        if (!isReply && currentUserId) {
            const replyButton = document.createElement("button");
            replyButton.type = "button";
            replyButton.className = "comment-reply-button";
            replyButton.textContent = "Reply";
            replyButton.title = "Reply to this comment";
            replyButton.setAttribute("aria-label", "Reply to this comment");
            replyButton.dataset.replyId = String(comment.comment_id);
            actions.appendChild(replyButton);
        }

        // Only the comment owner can delete it.
        if (
            currentUserId &&
            String(comment.user_id) === currentUserId
        ) {
            const editButton = document.createElement("button");
            editButton.type = "button";
            editButton.className = "comment-reply-button";
            editButton.textContent = "Edit";
            editButton.title = "Edit comment";
            editButton.dataset.editComment = String(comment.comment_id);
            actions.appendChild(editButton);

            const deleteButton = document.createElement("button");
            deleteButton.type = "button";
            deleteButton.className = "comment-delete";
            deleteButton.textContent = "Delete";
            deleteButton.title = "Delete comment";
            deleteButton.dataset.commentId = String(comment.comment_id);
            actions.appendChild(deleteButton);
        }

        const reportButton = document.createElement("button");
        reportButton.type = "button";
        reportButton.className = "comment-reply-button";
        reportButton.textContent = "Report";
        reportButton.title = "Report comment";
        reportButton.setAttribute("aria-label", "Report comment");
        reportButton.dataset.reportType = "comment";
        reportButton.dataset.reportId = String(comment.comment_id);
        actions.appendChild(reportButton);

        if (actions.children.length > 0) {
            article.appendChild(actions);
        }

        return article;
    }


    // =====================================
    // CREATE REPLY FORM
    // =====================================

    function createReplyForm(parentId) {
        const form = document.createElement("form");
        form.className = "reply-form";
        form.dataset.replyForm = "true";
        form.dataset.parentId = String(parentId);

        const textarea = document.createElement("textarea");
        textarea.maxLength = MAX_LENGTH;
        textarea.required = true;
        textarea.placeholder = "Write a reply...";

        const actions = document.createElement("div");
        actions.className = "reply-form-actions";

        const cancelButton = document.createElement("button");
        cancelButton.type = "button";
        cancelButton.className = "reply-cancel";
        cancelButton.textContent = "Cancel";
        cancelButton.addEventListener("click", () => form.remove());

        const sendButton = document.createElement("button");
        sendButton.type = "submit";
        sendButton.className = "reply-send";
        sendButton.textContent = "Submit reply";

        actions.append(cancelButton, sendButton);
        form.append(textarea, actions);

        return form;
    }


    // =====================================
    // RENDER COMMENTS AND REPLIES
    // =====================================

    function renderComments() {
        commentList.innerHTML = "";

        commentCount.textContent =
            `${comments.length.toLocaleString("en-US")} comments`;

        if (comments.length === 0) {
            const empty = document.createElement("p");
            empty.className = "comments-empty";
            empty.textContent =
                "No comments yet. Be the first to comment.";

            commentList.appendChild(empty);
            return;
        }

        const commentMap = new Map(
            comments.map(comment => [
                String(comment.comment_id),
                comment
            ])
        );

        const repliesMap = new Map();
        const roots = [];

        comments.forEach(comment => {
            const parentId = comment.parent_comment_id == null
                ? null
                : String(comment.parent_comment_id);

            const parent = parentId
                ? commentMap.get(parentId)
                : null;

            if (parent && parent.parent_comment_id == null) {
                if (!repliesMap.has(parentId)) {
                    repliesMap.set(parentId, []);
                }

                repliesMap.get(parentId).push(comment);
            } else {
                roots.push(comment);
            }
        });

        roots.sort(compareComments);

        roots.forEach(root => {
            const thread = document.createElement("div");
            thread.className = "comment-thread";

            thread.appendChild(createCommentElement(root));

            const replies = (
                repliesMap.get(String(root.comment_id)) || []
            ).sort(compareComments);

            if (replies.length > 0) {
                const replyContainer = document.createElement("div");
                replyContainer.className = "comment-replies";

                replies.forEach(reply => {
                    replyContainer.appendChild(
                        createCommentElement(reply, true)
                    );
                });

                thread.appendChild(replyContainer);
            }

            commentList.appendChild(thread);
        });
    }


    // =====================================
    // LOAD COMMENTS
    // =====================================

    async function loadComments() {
        commentList.innerHTML = "";

        const loading = document.createElement("p");
        loading.className = "comments-loading";
        loading.textContent = "Loading comments...";
        commentList.appendChild(loading);

        try {
            const data = await apiRequest(
                `/api/comments/${encodeURIComponent(chapterId)}`
            );

            comments = Array.isArray(data.comments)
                ? data.comments
                : [];

            await loadMyReactions();
            renderComments();

        } catch (error) {
            console.error("Load Comments:", error);

            commentList.innerHTML = "";

            const errorMessage = document.createElement("p");
            errorMessage.className = "comments-empty";
            errorMessage.textContent = error.message;
            commentList.appendChild(errorMessage);
        }
    }


    // =====================================
    // ADD COMMENT / REPLY
    // =====================================

    async function submitComment(content, parentCommentId = null) {
        const body = { content };

        if (parentCommentId !== null) {
            body.parentCommentId = parentCommentId;
        }

        return apiRequest(
            `/api/comments/${encodeURIComponent(chapterId)}`,
            {
                method: "POST",
                headers: {
                    "Content-Type": "application/json"
                },
                body: JSON.stringify(body)
            }
        );
    }


    // =====================================
    // MAIN COMMENT SUBMIT
    // =====================================

    commentForm.addEventListener("submit", async event => {
        event.preventDefault();

        const content = commentInput.value.trim();

        if (!content) {
            showFormMessage("Please enter a comment.", true);
            return;
        }

        if (content.length > MAX_LENGTH) {
            showFormMessage(
                `Comments must be no more than ${MAX_LENGTH} characters.`,
                true
            );
            return;
        }

        commentSubmit.disabled = true;
        commentSubmit.textContent = "Submitting...";

        try {
            await submitComment(content);

            commentInput.value = "";
            charCount.textContent = `0 / ${MAX_LENGTH}`;
            showFormMessage("Comment posted.");

            await loadComments();

        } catch (error) {
            console.error("Add Comment:", error);
            showFormMessage(error.message, true);

        } finally {
            commentSubmit.disabled = false;
            commentSubmit.textContent = "Submit comment";
        }
    });


    // =====================================
    // HANDLE REACTIONS
    // =====================================

    async function handleReaction(commentId, reactionType) {
        if (!currentUserId) {
            commentLogin.hidden = false;
            commentLogin.scrollIntoView({
                behavior: "smooth",
                block: "center"
            });
            return;
        }

        if (busyReactions.has(commentId)) return;

        busyReactions.add(commentId);
        renderComments();

        try {
            const current = myReactions.get(commentId);

            if (current === reactionType) {
                await apiRequest(
                    `/api/reactions/comments/${encodeURIComponent(commentId)}`,
                    { method: "DELETE" }
                );
            } else {
                await apiRequest(
                    `/api/reactions/comments/${encodeURIComponent(commentId)}`,
                    {
                        method: "PUT",
                        headers: {
                            "Content-Type": "application/json"
                        },
                        body: JSON.stringify({
                            reaction_type: reactionType
                        })
                    }
                );
            }

            await loadComments();

        } catch (error) {
            console.error("Comment Reaction:", error);
            alert(error.message);

        } finally {
            busyReactions.delete(commentId);
            renderComments();
        }
    }


    // =====================================
    // CLICK: REACTION / REPLY / DELETE
    // =====================================

    commentList.addEventListener("click", async event => {

        const reactionButton =
            event.target.closest("[data-comment-reaction]");

        if (reactionButton) {
            await handleReaction(
                reactionButton.dataset.commentReaction,
                reactionButton.dataset.reactionType
            );
            return;
        }

        const replyButton = event.target.closest("[data-reply-id]");

        if (replyButton) {
            if (!currentUserId) {
                commentLogin.hidden = false;
                return;
            }

            const commentElement =
                replyButton.closest(".comment-item");

            if (!commentElement) return;

            const existingForm =
                commentElement.querySelector(".reply-form");

            if (existingForm) {
                existingForm.remove();
                return;
            }

            const replyForm =
                createReplyForm(replyButton.dataset.replyId);

            commentElement.appendChild(replyForm);
            replyForm.querySelector("textarea").focus();
            return;
        }

        const editButton = event.target.closest("[data-edit-comment]");
        if (editButton) {
            const commentElement = editButton.closest(".comment-item");
            if (!commentElement) return;
            const existingForm = commentElement.querySelector(".comment-edit-form");
            if (existingForm) {
                existingForm.remove();
                return;
            }
            const form = document.createElement("form");
            form.className = "reply-form comment-edit-form";
            form.dataset.editCommentForm = editButton.dataset.editComment;
            const textarea = document.createElement("textarea");
            textarea.maxLength = MAX_LENGTH;
            textarea.required = true;
            textarea.value = commentElement.querySelector(".comment-content").textContent;
            const actions = document.createElement("div");
            actions.className = "reply-form-actions";
            const submit = document.createElement("button");
            submit.type = "submit";
            submit.className = "reply-send";
            submit.textContent = "Save";
            const cancel = document.createElement("button");
            cancel.type = "button";
            cancel.className = "reply-cancel";
            cancel.textContent = "Cancel";
            cancel.addEventListener("click", () => form.remove());
            actions.append(submit, cancel);
            form.append(textarea, actions);
            commentElement.appendChild(form);
            textarea.focus();
            return;
        }

        const deleteButton =
            event.target.closest("[data-comment-id]");

        if (!deleteButton) return;

        const commentId = deleteButton.dataset.commentId;

        if (!commentId) return;

        if (!window.confirm("Delete this comment?")) {
            return;
        }

        deleteButton.disabled = true;
        deleteButton.textContent = "Deleting...";

        try {
            await apiRequest(
                `/api/comments/${encodeURIComponent(commentId)}`,
                { method: "DELETE" }
            );

            await loadComments();

        } catch (error) {
            console.error("Delete Comment:", error);
            alert(error.message);

            deleteButton.disabled = false;
            deleteButton.textContent = "Delete";
        }
    });


    // =====================================
    // SUBMIT REPLY
    // =====================================

    commentList.addEventListener("submit", async event => {
        const editForm = event.target.closest("[data-edit-comment-form]");
        if (editForm) {
            event.preventDefault();
            const submit = editForm.querySelector('[type="submit"]');
            submit.disabled = true;
            try {
                await apiRequest(
                    `/api/comments/${encodeURIComponent(editForm.dataset.editCommentForm)}`,
                    {
                        method: "PUT",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({
                            content: editForm.querySelector("textarea").value
                        })
                    }
                );
                await loadComments();
            } catch (error) {
                console.error("Update Comment:", error);
                alert(error.message);
                submit.disabled = false;
            }
            return;
        }

        const form = event.target.closest("[data-reply-form]");

        if (!form) return;

        event.preventDefault();

        const textarea = form.querySelector("textarea");
        const sendButton = form.querySelector(".reply-send");

        const content = textarea.value.trim();
        const parentId = form.dataset.parentId;

        if (!content) {
            alert("Please enter a reply.");
            return;
        }

        if (content.length > MAX_LENGTH) {
            alert(`Replies must be no more than ${MAX_LENGTH} characters.`);
            return;
        }

        sendButton.disabled = true;
        sendButton.textContent = "Submitting...";

        try {
            await submitComment(content, parentId);
            await loadComments();

        } catch (error) {
            console.error("Reply Comment:", error);
            alert(error.message);

            sendButton.disabled = false;
            sendButton.textContent = "Submit reply";
        }
    });


    // =====================================
    // START
    // =====================================

    async function initializeComments() {
        await checkLogin();
        await loadComments();
    }

    initializeComments();

})();
