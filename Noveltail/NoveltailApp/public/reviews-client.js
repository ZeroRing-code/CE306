
(() => {
    // =====================================
    // INITIALIZE
    // =====================================

    const params = new URLSearchParams(window.location.search);
    const novelId = params.get("id") || params.get("novelId");
    const novelDetail = document.getElementById("novel-detail");

    const MAX_LENGTH = 5000;

    let currentUserId = null;
    let reviews = [];
    let selectedRating = 0;
    let currentReview = null;
    let myReactions = new Map();
    let sortMode = "newest";

    const busyReactions = new Set();

    if (
        !/^\d+$/.test(novelId || "") ||
        Number(novelId) <= 0 ||
        !novelDetail
    ) {
        console.error("Reviews: novel ID or detail page was not found.");
        return;
    }


    // =====================================
    // CSS
    // =====================================

    const style = document.createElement("style");

    style.textContent = `
        .reviews-section {
            margin-top: 45px;
            padding-top: 30px;
            border-top: 1px solid #e5e3ec;
        }

        .reviews-heading {
            display: flex;
            justify-content: space-between;
            align-items: center;
            gap: 20px;
            flex-wrap: wrap;
            margin-bottom: 20px;
        }

        .reviews-heading h2 {
            font-size: 24px;
            margin: 5px 0;
        }

        .reviews-eyebrow {
            color: #7656d8;
            font-size: 11px;
            font-weight: 700;
            letter-spacing: 2px;
        }

        .reviews-summary {
            display: flex;
            align-items: center;
            gap: 10px;
            flex-wrap: wrap;
        }

        .reviews-average {
            font-size: 27px;
            font-weight: 800;
            color: #7656d8;
        }

        .reviews-stars {
            color: #efa928;
            letter-spacing: 2px;
        }

        .reviews-total {
            color: #5f5c6a;
            font-size: 12px;
        }

        .review-open-button {
            border: none;
            border-radius: 8px;
            padding: 11px 19px;
            background: #7656d8;
            color: white;
            font-size: 13px;
            font-weight: 600;
            cursor: pointer;
            transition: 0.2s;
            margin-bottom: 20px;
        }

        .review-open-button:hover {
            background: #6243bf;
            transform: translateY(-1px);
        }

        .review-panel {
            background: #faf9fc;
            border: 1px solid #eceaf1;
            border-radius: 12px;
            padding: 20px;
            margin-bottom: 25px;
        }

        .review-panel h3 {
            font-size: 17px;
            margin-bottom: 15px;
        }

        .review-login {
            color: #666;
            font-size: 14px;
        }

        .review-login a {
            color: #7656d8;
            font-weight: 600;
        }

        .review-rating-label {
            font-size: 13px;
            font-weight: 600;
            margin-bottom: 8px;
        }

        .review-rating-picker {
            display: flex;
            gap: 5px;
            margin-bottom: 8px;
        }

        .review-star-button {
            border: none;
            background: transparent;
            padding: 0;
            font-size: 30px;
            color: #d8d5df;
            cursor: pointer;
            transition: 0.15s;
        }

        .review-star-button.selected {
            color: #efa928;
        }

        .review-star-button:hover {
            transform: scale(1.12);
        }

        .review-rating-hint {
            font-size: 12px;
            color: #5f5c6a;
            margin-bottom: 17px;
        }

        .review-textarea {
            width: 100%;
            min-height: 110px;
            padding: 13px;
            border: 1px solid #dedbe8;
            border-radius: 9px;
            box-sizing: border-box;
            font-family: inherit;
            font-size: 14px;
            line-height: 1.7;
            resize: vertical;
            outline: none;
        }

        .review-textarea:focus {
            border-color: #7656d8;
            box-shadow: 0 0 0 3px rgba(118, 86, 216, 0.1);
        }

        .review-form-bottom {
            display: flex;
            justify-content: space-between;
            align-items: center;
            flex-wrap: wrap;
            gap: 12px;
            margin-top: 12px;
        }

        .review-char-count {
            color: #5f5c6a;
            font-size: 12px;
        }

        .review-form-actions {
            display: flex;
            gap: 8px;
        }

        .review-submit,
        .review-cancel {
            border: none;
            border-radius: 8px;
            padding: 10px 17px;
            font-size: 13px;
            font-weight: 600;
            cursor: pointer;
        }

        .review-submit {
            background: #7656d8;
            color: white;
        }

        .review-submit:hover {
            background: #6243bf;
        }

        .review-cancel {
            background: #eeeaf5;
            color: #666;
        }

        .review-submit:disabled,
        .review-cancel:disabled {
            opacity: 0.6;
            cursor: not-allowed;
        }

        .review-form-message {
            font-size: 13px;
            margin-top: 10px;
            color: #38875c;
        }

        .review-form-message.error {
            color: #a82f2f;
        }

        .review-sort-bar {
            display: flex;
            justify-content: flex-end;
            align-items: center;
            gap: 10px;
            flex-wrap: wrap;
            margin-bottom: 16px;
        }

        .review-sort-bar label {
            color: #5f5c6a;
            font-size: 12px;
        }

        .review-sort-select {
            padding: 8px 12px;
            border: 1px solid #dedbe8;
            border-radius: 8px;
            background: white;
            color: #555;
            font-size: 12px;
            cursor: pointer;
        }

        .review-list {
            display: flex;
            flex-direction: column;
            gap: 15px;
        }

        .review-item {
            border: 1px solid #eceaf1;
            background: white;
            border-radius: 11px;
            padding: 18px;
        }

        .review-item-header {
            display: flex;
            justify-content: space-between;
            align-items: flex-start;
            gap: 12px;
            margin-bottom: 10px;
        }

        .review-author {
            font-size: 14px;
            font-weight: 700;
            color: #343044;
        }

        .review-date {
            font-size: 11px;
            color: #5f5c6a;
            margin-top: 4px;
        }

        .review-card-rating {
            color: #efa928;
            font-size: 16px;
            letter-spacing: 2px;
            margin: 8px 0;
        }

        .review-card-rating-number {
            color: #5f5c6a;
            font-size: 11px;
            letter-spacing: 0;
        }

        .review-content {
            color: #555;
            font-size: 14px;
            line-height: 1.8;
            white-space: pre-wrap;
            overflow-wrap: anywhere;
            margin-top: 10px;
        }

        .review-actions {
            display: flex;
            gap: 8px;
            margin-top: 14px;
            flex-wrap: wrap;
        }

        .review-edit-button,
        .review-delete-button {
            border: none;
            border-radius: 7px;
            padding: 7px 12px;
            font-size: 12px;
            cursor: pointer;
        }

        .review-edit-button {
            background: #f1edff;
            color: #7656d8;
        }

        .review-delete-button {
            background: #fff0f0;
            color: #a82f2f;
        }

        .review-reaction-bar {
            display: flex;
            gap: 9px;
            flex-wrap: wrap;
            margin-top: 14px;
        }

        .review-reaction-button {
            border: 1px solid #e8e5ef;
            background: white;
            color: #5f5c6a;
            border-radius: 20px;
            padding: 6px 11px;
            font-size: 12px;
            cursor: pointer;
            transition: 0.15s;
        }

        .review-reaction-button:hover {
            border-color: #b9a7ed;
            background: #f7f4ff;
        }

        .review-reaction-button.active {
            background: #f1edff;
            border-color: #7656d8;
            color: #7656d8;
            font-weight: 700;
        }

        .review-reaction-button.dislike-active {
            background: #fff1f1;
            border-color: #d97979;
            color: #c44b4b;
            font-weight: 700;
        }

        .review-reaction-button:disabled {
            opacity: 0.55;
            cursor: not-allowed;
        }

        .review-empty,
        .review-loading {
            text-align: center;
            color: #5f5c6a;
            font-size: 14px;
            padding: 30px 15px;
        }

        .reviews-section [hidden] {
            display: none !important;
        }

        @media (max-width: 500px) {
            .reviews-heading h2 {
                font-size: 20px;
            }

            .review-panel {
                padding: 14px;
            }

            .review-item {
                padding: 14px;
            }
        }
    `;

    document.head.appendChild(style);


    // =====================================
    // CREATE REVIEW SECTION
    // =====================================

    const section = document.createElement("section");
    section.id = "reviews-section";
    section.className = "reviews-section";

    section.innerHTML = `
        <div class="reviews-heading">

            <div>
                <p class="reviews-eyebrow">READER REVIEWS</p>
                <h2>Reviews and Ratings</h2>
            </div>

            <div class="reviews-summary">
                <strong id="reviews-average" class="reviews-average">0.0</strong>

                <div>
                    <div id="reviews-summary-stars" class="reviews-stars">
                        ☆☆☆☆☆
                    </div>

                    <span id="reviews-total" class="reviews-total">
                        0 reviews
                    </span>
                </div>
            </div>

        </div>

        <button
            type="button"
            id="review-open-button"
            class="review-open-button"
        >
            Write Review
        </button>

        <div class="review-panel">

            <h3 id="review-form-title">Write Your Review</h3>

            <p id="review-login" class="review-login" hidden>
                Sign in to rate and review this novel.
                <a href="/auth.html">Sign in</a>
            </p>

            <form id="review-form" hidden>

                <p class="review-rating-label">Rate this novel</p>

                <div
                    id="review-rating-picker"
                    class="review-rating-picker"
                    role="radiogroup"
                    aria-label="Novel rating from 1 to 5 stars"
                >
                    <button type="button" class="review-star-button" data-rating="1" aria-label="1 star"><span class="sr-only">1 star</span><span aria-hidden="true">★</span></button>
                    <button type="button" class="review-star-button" data-rating="2" aria-label="2 stars"><span class="sr-only">2 stars</span><span aria-hidden="true">★</span></button>
                    <button type="button" class="review-star-button" data-rating="3" aria-label="3 stars"><span class="sr-only">3 stars</span><span aria-hidden="true">★</span></button>
                    <button type="button" class="review-star-button" data-rating="4" aria-label="4 stars"><span class="sr-only">4 stars</span><span aria-hidden="true">★</span></button>
                    <button type="button" class="review-star-button" data-rating="5" aria-label="5 stars"><span class="sr-only">5 stars</span><span aria-hidden="true">★</span></button>
                </div>

                <p id="review-rating-hint" class="review-rating-hint">
                    Choose a rating from 1–5 stars.
                </p>

                <textarea
                    id="review-text"
                    class="review-textarea"
                    maxlength="5000"
                    placeholder="Share your thoughts about this novel..."
                    required
                ></textarea>

                <div class="review-form-bottom">

                    <span id="review-char-count" class="review-char-count">
                        0 / 5000
                    </span>

                    <div class="review-form-actions">

                        <button
                            type="button"
                            id="review-cancel"
                            class="review-cancel"
                            hidden
                        >
                            Cancel
                        </button>

                        <button
                            type="submit"
                            id="review-submit"
                            class="review-submit"
                        >
                            Submit Review
                        </button>

                    </div>

                </div>

                <p
                    id="review-form-message"
                    class="review-form-message"
                    role="status"
                ></p>

            </form>

        </div>

        <div id="review-list" class="review-list">
            <p class="review-loading">Loading reviews...</p>
        </div>
    `;

    const chapterSection = novelDetail.querySelector(".chapter-section");

    if (chapterSection) {
        chapterSection.insertAdjacentElement("afterend", section);
    } else {
        novelDetail.appendChild(section);
    }


    // =====================================
    // GET ELEMENTS
    // =====================================

    const reviewForm = section.querySelector("#review-form");
    const reviewLogin = section.querySelector("#review-login");
    const reviewText = section.querySelector("#review-text");
    const reviewSubmit = section.querySelector("#review-submit");
    const reviewCancel = section.querySelector("#review-cancel");
    const reviewOpenButton = section.querySelector("#review-open-button");

    const reviewList = section.querySelector("#review-list");
    const reviewAverage = section.querySelector("#reviews-average");
    const reviewSummaryStars = section.querySelector("#reviews-summary-stars");
    const reviewTotal = section.querySelector("#reviews-total");

    const ratingPicker = section.querySelector("#review-rating-picker");
    const ratingHint = section.querySelector("#review-rating-hint");

    const reviewCharCount = section.querySelector("#review-char-count");
    const reviewFormMessage = section.querySelector("#review-form-message");
    const reviewFormTitle = section.querySelector("#review-form-title");


    // =====================================
    // SORT CONTROL
    // =====================================

    const sortBar = document.createElement("div");
    sortBar.className = "review-sort-bar";

    const sortLabel = document.createElement("label");
    sortLabel.textContent = "Sort by";

    const sortSelect = document.createElement("select");
    sortSelect.className = "review-sort-select";

    [
        ["newest", "Newest first"],
        ["oldest", "Oldest first"],
        ["score-desc", "Highest rating"],
        ["score-asc", "Lowest rating"]
    ].forEach(([value, label]) => {
        const option = document.createElement("option");
        option.value = value;
        option.textContent = label;
        sortSelect.appendChild(option);
    });

    sortSelect.value = sortMode;
    sortLabel.appendChild(sortSelect);
    sortBar.appendChild(sortLabel);

    reviewList.parentNode.insertBefore(sortBar, reviewList);

    sortSelect.addEventListener("change", () => {
        sortMode = sortSelect.value;
        renderReviews();
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

        reviewForm.hidden = true;
        reviewLogin.hidden = true;
        reviewOpenButton.hidden = false;
    }


    // =====================================
    // LOAD MY REACTIONS
    // =====================================

    async function loadMyReactions() {
        myReactions.clear();

        if (!currentUserId) return;

        try {
            const data = await apiRequest(
                `/api/reactions/reviews/${encodeURIComponent(novelId)}/mine`
            );

            (data.reactions || []).forEach(item => {
                myReactions.set(
                    String(item.review_id),
                    item.reaction_type
                );
            });

        } catch (error) {
            console.error("Load My Review Reactions:", error);
        }
    }


    // =====================================
    // OPEN REVIEW FORM
    // =====================================

    reviewOpenButton.addEventListener("click", () => {
        if (!currentUserId) {
            reviewLogin.hidden = false;

            reviewLogin.scrollIntoView({
                behavior: "smooth",
                block: "center"
            });

            return;
        }

        fillReviewForm(currentReview);

        reviewLogin.hidden = true;
        reviewForm.hidden = false;

        reviewForm.scrollIntoView({
            behavior: "smooth",
            block: "center"
        });

        reviewText.focus();
    });


    // =====================================
    // RATING
    // =====================================

    function updateRatingButtons() {
        const buttons = ratingPicker.querySelectorAll("[data-rating]");

        buttons.forEach(button => {
            const value = Number(button.dataset.rating);
            const selected = value <= selectedRating;

            button.classList.toggle("selected", selected);
            button.setAttribute(
                "aria-checked",
                String(value === selectedRating)
            );
        });

        ratingHint.textContent = selectedRating
            ? `Your rating: ${selectedRating} / 5 stars`
            : "Choose a rating from 1–5 stars.";
    }

    ratingPicker.addEventListener("click", event => {
        const button = event.target.closest("[data-rating]");

        if (!button) return;

        selectedRating = Number(button.dataset.rating);
        updateRatingButtons();
    });


    // =====================================
    // CHARACTER COUNTER
    // =====================================

    reviewText.addEventListener("input", () => {
        reviewCharCount.textContent =
            `${reviewText.value.length} / ${MAX_LENGTH}`;
    });


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
    // REACTION SCORE
    // =====================================

    function reactionScore(review) {
        return (Number(review.like_count) || 0) -
            (Number(review.dislike_count) || 0);
    }


    // =====================================
    // SORT REVIEWS
    // =====================================

    function compareReviews(a, b) {
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
    // RENDER SUMMARY
    // =====================================

    function renderSummary(summary = {}) {
        const average = Number(summary.averageRating) || 0;
        const total = Number(summary.totalReviews) || 0;

        reviewAverage.textContent = average.toFixed(1);

        const rounded = Math.round(average);

        reviewSummaryStars.textContent =
            "★".repeat(rounded) + "☆".repeat(5 - rounded);

        reviewTotal.textContent =
            `${total.toLocaleString("en-US")} reviews`;
    }


    // =====================================
    // FORM MESSAGE
    // =====================================

    function showFormMessage(text, isError = false) {
        reviewFormMessage.textContent = text;
        reviewFormMessage.classList.toggle("error", isError);
    }


    // =====================================
    // LOAD OWN REVIEW INTO FORM
    // =====================================

    function fillReviewForm(review) {
        currentReview = review || null;

        if (currentReview) {
            selectedRating = Number(currentReview.rating);
            reviewText.value = currentReview.review_text || "";

            reviewFormTitle.textContent = "Edit Your Review";
            reviewSubmit.textContent = "Save Changes";
            reviewCancel.hidden = false;

        } else {
            selectedRating = 0;
            reviewText.value = "";

            reviewFormTitle.textContent = "Write Your Review";
            reviewSubmit.textContent = "Submit Review";
            reviewCancel.hidden = true;
        }

        reviewCharCount.textContent =
            `${reviewText.value.length} / ${MAX_LENGTH}`;

        reviewOpenButton.textContent = currentReview
            ? "Edit Your Review"
            : "Write Review";

        updateRatingButtons();
        showFormMessage("");
    }


    // =====================================
    // CREATE REACTION BAR
    // =====================================

    function createReactionBar(review) {
        const bar = document.createElement("div");
        bar.className = "review-reaction-bar";

        const id = String(review.review_id);
        const selected = myReactions.get(id);

        const likeButton = document.createElement("button");
        likeButton.type = "button";
        likeButton.className = "review-reaction-button";
        likeButton.dataset.reviewReaction = id;
        likeButton.dataset.reactionType = "like";
        likeButton.textContent = `Like · ${Number(review.like_count) || 0}`;
        likeButton.title = "Like review";
        likeButton.setAttribute(
            "aria-label",
            `Like review (${Number(review.like_count) || 0})`
        );

        if (selected === "like") {
            likeButton.classList.add("active");
            likeButton.setAttribute("aria-pressed", "true");
        } else {
            likeButton.setAttribute("aria-pressed", "false");
        }

        const dislikeButton = document.createElement("button");
        dislikeButton.type = "button";
        dislikeButton.className = "review-reaction-button";
        dislikeButton.dataset.reviewReaction = id;
        dislikeButton.dataset.reactionType = "dislike";
        dislikeButton.textContent =
            `Dislike · ${Number(review.dislike_count) || 0}`;
        dislikeButton.title = "Dislike review";
        dislikeButton.setAttribute(
            "aria-label",
            `Dislike review (${Number(review.dislike_count) || 0})`
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
    // CREATE REVIEW ELEMENT
    // =====================================

    function createReviewElement(review) {
        const article = document.createElement("article");
        article.className = "review-item";

        const header = document.createElement("div");
        header.className = "review-item-header";

        const authorArea = document.createElement("div");

        const author = document.createElement("div");
        author.className = "review-author";
        author.textContent =
            review.display_name ||
            review.username ||
            "User";

        const date = document.createElement("div");
        date.className = "review-date";
        date.textContent = formatDate(review.created_at);

        authorArea.append(author, date);
        header.appendChild(authorArea);
        article.appendChild(header);

        const rating = document.createElement("div");
        rating.className = "review-card-rating";

        const score = Number(review.rating) || 0;

        rating.textContent =
            "★".repeat(score) + "☆".repeat(5 - score);

        const ratingNumber = document.createElement("span");
        ratingNumber.className = "review-card-rating-number";
        ratingNumber.textContent = ` ${score}/5`;

        rating.appendChild(ratingNumber);
        article.appendChild(rating);

        const content = document.createElement("p");
        content.className = "review-content";
        content.textContent = review.review_text;

        article.appendChild(content);

        // Like / Dislike
        article.appendChild(createReactionBar(review));

        // Show edit and delete controls only to the review owner.
        if (
            currentUserId &&
            String(review.user_id) === currentUserId
        ) {
            const actions = document.createElement("div");
            actions.className = "review-actions";

            const editButton = document.createElement("button");
            editButton.type = "button";
            editButton.className = "review-edit-button";
            editButton.textContent = "Edit Review";
            editButton.title = "Edit review";
            editButton.dataset.editReview = String(review.review_id);

            const deleteButton = document.createElement("button");
            deleteButton.type = "button";
            deleteButton.className = "review-delete-button";
            deleteButton.textContent = "Delete Review";
            deleteButton.title = "Delete review";
            deleteButton.dataset.deleteReview = String(review.review_id);

            actions.append(editButton, deleteButton);
            article.appendChild(actions);
        }

        return article;
    }


    // =====================================
    // RENDER REVIEWS
    // =====================================

    function renderReviews() {
        reviewList.innerHTML = "";

        if (reviews.length === 0) {
            const empty = document.createElement("p");
            empty.className = "review-empty";
            empty.textContent =
                "No reviews yet. Be the first to review this novel.";

            reviewList.appendChild(empty);
            return;
        }

        [...reviews]
            .sort(compareReviews)
            .forEach(review => {
                reviewList.appendChild(createReviewElement(review));
            });
    }


    // =====================================
    // LOAD REVIEWS
    // =====================================

    async function loadReviews() {
        reviewList.innerHTML = "";

        const loading = document.createElement("p");
        loading.className = "review-loading";
        loading.textContent = "Loading reviews...";
        reviewList.appendChild(loading);

        try {
            const data = await apiRequest(
                `/api/reviews/${encodeURIComponent(novelId)}`
            );

            reviews = Array.isArray(data.reviews)
                ? data.reviews
                : [];

            renderSummary(data.summary);

            await loadMyReactions();

            const ownReview = currentUserId
                ? reviews.find(
                    review =>
                        String(review.user_id) === currentUserId
                )
                : null;

            currentReview = ownReview || null;

            reviewOpenButton.textContent = currentReview
                ? "Edit Your Review"
                : "Write Review";

            renderReviews();

        } catch (error) {
            console.error("Load Reviews:", error);

            reviewList.innerHTML = "";

            const errorMessage = document.createElement("p");
            errorMessage.className = "review-empty";
            errorMessage.textContent = error.message;

            reviewList.appendChild(errorMessage);
        }
    }


    // =====================================
    // SUBMIT REVIEW
    // =====================================

    reviewForm.addEventListener("submit", async event => {
        event.preventDefault();

        const rating = selectedRating;
        const reviewTextValue = reviewText.value.trim();

        if (!rating || rating < 1 || rating > 5) {
            showFormMessage("Please choose a rating from 1–5 stars.", true);
            return;
        }

        if (!reviewTextValue) {
            showFormMessage("Please enter a review.", true);
            return;
        }

        if (reviewTextValue.length > MAX_LENGTH) {
            showFormMessage(
                `Reviews must be no more than ${MAX_LENGTH} characters.`,
                true
            );
            return;
        }

        const isEditing = Boolean(currentReview);

        reviewSubmit.disabled = true;
        reviewSubmit.textContent = "Saving...";

        try {
            const data = await apiRequest(
                `/api/reviews/${encodeURIComponent(novelId)}`,
                {
                    method: isEditing ? "PUT" : "POST",
                    headers: {
                        "Content-Type": "application/json"
                    },
                    body: JSON.stringify({
                        rating,
                        review_text: reviewTextValue
                    })
                }
            );

            await loadReviews();

            reviewForm.hidden = true;
            showFormMessage(data.message || "Review saved.");

        } catch (error) {
            console.error("Save Review:", error);
            showFormMessage(error.message, true);

        } finally {
            reviewSubmit.disabled = false;
            reviewSubmit.textContent = currentReview
                ? "Save Changes"
                : "Submit Review";
        }
    });


    // =====================================
    // CANCEL EDIT
    // =====================================

    reviewCancel.addEventListener("click", () => {
        fillReviewForm(currentReview);
        reviewForm.hidden = true;
    });


    // =====================================
    // HANDLE REACTIONS
    // =====================================

    async function handleReaction(reviewId, reactionType) {
        if (!currentUserId) {
            reviewLogin.hidden = false;

            reviewLogin.scrollIntoView({
                behavior: "smooth",
                block: "center"
            });

            return;
        }

        if (busyReactions.has(reviewId)) return;

        busyReactions.add(reviewId);
        renderReviews();

        try {
            const current = myReactions.get(reviewId);

            if (current === reactionType) {
                await apiRequest(
                    `/api/reactions/reviews/${encodeURIComponent(reviewId)}`,
                    { method: "DELETE" }
                );
            } else {
                await apiRequest(
                    `/api/reactions/reviews/${encodeURIComponent(reviewId)}`,
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

            await loadReviews();

        } catch (error) {
            console.error("Review Reaction:", error);
            alert(error.message);

        } finally {
            busyReactions.delete(reviewId);
            renderReviews();
        }
    }


    // =====================================
    // EDIT / DELETE / REACTION
    // =====================================

    reviewList.addEventListener("click", async event => {

        // Like / Dislike
        const reactionButton =
            event.target.closest("[data-review-reaction]");

        if (reactionButton) {
            await handleReaction(
                reactionButton.dataset.reviewReaction,
                reactionButton.dataset.reactionType
            );
            return;
        }

        // Edit a review.
        const editButton = event.target.closest("[data-edit-review]");

        if (editButton) {
            const ownReview = reviews.find(
                review =>
                    String(review.review_id) === editButton.dataset.editReview
            );

            if (!ownReview) return;

            fillReviewForm(ownReview);
            reviewForm.hidden = false;

            reviewForm.scrollIntoView({
                behavior: "smooth",
                block: "center"
            });

            reviewText.focus();
            return;
        }

        // Delete a review.
        const deleteButton = event.target.closest("[data-delete-review]");

        if (!deleteButton) return;

        const reviewId = deleteButton.dataset.deleteReview;

        if (!reviewId) return;

        if (!window.confirm("Delete this review?")) {
            return;
        }

        deleteButton.disabled = true;
        deleteButton.textContent = "Deleting...";

        try {
            const data = await apiRequest(
                `/api/reviews/${encodeURIComponent(reviewId)}`,
                { method: "DELETE" }
            );

            await loadReviews();

            fillReviewForm(null);
            reviewForm.hidden = true;
            showFormMessage(data.message || "Review deleted.");

        } catch (error) {
            console.error("Delete Review:", error);
            alert(error.message);

            deleteButton.disabled = false;
            deleteButton.textContent = "Delete Review";
        }
    });


    // =====================================
    // START
    // =====================================

    async function initializeReviews() {
        await checkLogin();
        await loadReviews();
    }

    initializeReviews();

})();
