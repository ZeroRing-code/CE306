(() => {
    "use strict";

    const MAX_FILE_SIZE = 10 * 1024 * 1024;
    const ALLOWED_TYPES = new Set([
        "image/jpeg",
        "image/png",
        "image/webp"
    ]);

    let dialog;

    function createDialog() {
        if (dialog) {
            return dialog;
        }

        dialog = document.createElement("dialog");
        dialog.className = "image-crop-dialog";
        dialog.setAttribute("aria-labelledby", "image-crop-title");
        dialog.innerHTML = `
            <h2 id="image-crop-title">Adjust Image</h2>
            <p class="image-crop-help">Drag the image to reposition it, then use the slider to zoom.</p>
            <div class="image-crop-layout">
                <div class="image-crop-stage">
                    <img alt="Image being edited" draggable="false">
                    <div class="image-crop-frame" aria-hidden="true"></div>
                </div>
                <div class="image-crop-preview-panel">
                    <p class="image-crop-preview-label">Preview</p>
                    <div class="image-crop-preview-wrap">
                        <canvas class="image-crop-preview"></canvas>
                    </div>
                </div>
            </div>
            <div class="image-crop-controls">
                <label for="image-crop-zoom">
                    <span>Zoom</span>
                    <span data-crop-zoom-value>100%</span>
                </label>
                <input id="image-crop-zoom" type="range" min="1" max="3" step="0.01" value="1">
            </div>
            <p class="image-crop-error" role="status" aria-live="polite"></p>
            <div class="image-crop-actions">
                <button type="button" data-crop-cancel>Cancel</button>
                <button type="button" data-crop-confirm>Use Image</button>
            </div>
        `;
        document.body.appendChild(dialog);

        return dialog;
    }

    function clamp(value, min, max) {
        return Math.min(Math.max(value, min), max);
    }

    function crop(file, { aspectRatio = 1, shape = "rectangle" } = {}) {
        if (!(file instanceof File)) {
            return Promise.reject(new Error("Please select an image."));
        }

        if (!ALLOWED_TYPES.has(file.type)) {
            return Promise.reject(
                new Error("Only JPG, JPEG, PNG, and WebP files are supported.")
            );
        }

        if (file.size > MAX_FILE_SIZE) {
            return Promise.reject(
                new Error("Image must be no larger than 10 MB.")
            );
        }

        const cropDialog = createDialog();

        if (cropDialog.open) {
            return Promise.reject(
                new Error("Another image is currently being edited.")
            );
        }

        return new Promise((resolve, reject) => {
            const stage = cropDialog.querySelector(".image-crop-stage");
            const image = stage.querySelector("img");
            const previewPanel = cropDialog.querySelector(".image-crop-preview-panel");
            const previewCanvas = cropDialog.querySelector(".image-crop-preview");
            const previewContext = previewCanvas.getContext("2d");
            const zoomInput = cropDialog.querySelector("#image-crop-zoom");
            const zoomValue = cropDialog.querySelector("[data-crop-zoom-value]");
            const errorMessage = cropDialog.querySelector(".image-crop-error");
            const cancelButton = cropDialog.querySelector("[data-crop-cancel]");
            const confirmButton = cropDialog.querySelector("[data-crop-confirm]");
            const sourceUrl = URL.createObjectURL(file);
            let stageWidth = 0;
            let stageHeight = 0;
            let baseScale = 1;
            let scale = 1;
            let offsetX = 0;
            let offsetY = 0;
            let activePointerId = null;
            let lastPointerX = 0;
            let lastPointerY = 0;
            let settled = false;

            const cleanUp = () => {
                URL.revokeObjectURL(sourceUrl);
                image.onload = null;
                image.onerror = null;
                cropDialog.removeEventListener("cancel", onCancel);
                cropDialog.removeEventListener("click", onDialogClick);
                cancelButton.removeEventListener("click", onCancel);
                confirmButton.removeEventListener("click", onConfirm);
                zoomInput.removeEventListener("input", onZoom);
                stage.removeEventListener("pointerdown", onPointerDown);
                stage.removeEventListener("pointermove", onPointerMove);
                stage.removeEventListener("pointerup", onPointerUp);
                stage.removeEventListener("pointercancel", onPointerUp);
                window.removeEventListener("resize", onResize);
                confirmButton.disabled = false;
                if (cropDialog.open) {
                    cropDialog.close();
                }
            };

            const finish = (result, error) => {
                if (settled) {
                    return;
                }
                settled = true;
                cleanUp();
                if (error) {
                    reject(error);
                } else {
                    resolve(result);
                }
            };

            const constrainImage = () => {
                const imageWidth = image.naturalWidth * scale;
                const imageHeight = image.naturalHeight * scale;
                offsetX = clamp(offsetX, stageWidth - imageWidth, 0);
                offsetY = clamp(offsetY, stageHeight - imageHeight, 0);
                image.style.width = `${imageWidth}px`;
                image.style.height = `${imageHeight}px`;
                image.style.transform = `translate(${offsetX}px, ${offsetY}px)`;
            };

            const renderPreview = () => {
                const sourceX = -offsetX / scale;
                const sourceY = -offsetY / scale;
                const sourceWidth = stageWidth / scale;
                const sourceHeight = stageHeight / scale;
                previewContext.fillStyle = "#fff";
                previewContext.fillRect(
                    0,
                    0,
                    previewCanvas.width,
                    previewCanvas.height
                );
                previewContext.drawImage(
                    image,
                    sourceX,
                    sourceY,
                    sourceWidth,
                    sourceHeight,
                    0,
                    0,
                    previewCanvas.width,
                    previewCanvas.height
                );
            };

            const render = () => {
                constrainImage();
                renderPreview();
            };

            const setZoom = nextZoom => {
                const oldScale = scale;
                scale = baseScale * nextZoom;
                offsetX = stageWidth / 2 -
                    (stageWidth / 2 - offsetX) * (scale / oldScale);
                offsetY = stageHeight / 2 -
                    (stageHeight / 2 - offsetY) * (scale / oldScale);
                zoomValue.textContent = `${Math.round(nextZoom * 100)}%`;
                render();
            };

            const onZoom = () => setZoom(Number(zoomInput.value));

            const onPointerDown = event => {
                if (event.button !== 0 && event.pointerType === "mouse") {
                    return;
                }
                activePointerId = event.pointerId;
                lastPointerX = event.clientX;
                lastPointerY = event.clientY;
                stage.classList.add("is-dragging");
                stage.setPointerCapture(event.pointerId);
                event.preventDefault();
            };

            const onPointerMove = event => {
                if (event.pointerId !== activePointerId) {
                    return;
                }
                offsetX += event.clientX - lastPointerX;
                offsetY += event.clientY - lastPointerY;
                lastPointerX = event.clientX;
                lastPointerY = event.clientY;
                render();
            };

            const onPointerUp = event => {
                if (event.pointerId !== activePointerId) {
                    return;
                }
                activePointerId = null;
                stage.classList.remove("is-dragging");
            };

            const onResize = () => {
                const zoom = Number(zoomInput.value);
                const previousWidth = stageWidth;
                const previousHeight = stageHeight;
                stageWidth = stage.clientWidth;
                stageHeight = stage.clientHeight;
                baseScale = Math.max(
                    stageWidth / image.naturalWidth,
                    stageHeight / image.naturalHeight
                );
                scale = baseScale * zoom;
                offsetX = previousWidth
                    ? (offsetX / previousWidth) * stageWidth
                    : (stageWidth - image.naturalWidth * scale) / 2;
                offsetY = previousHeight
                    ? (offsetY / previousHeight) * stageHeight
                    : (stageHeight - image.naturalHeight * scale) / 2;
                render();
            };

            const onCancel = event => {
                event?.preventDefault();
                finish(null);
            };

            const onDialogClick = event => {
                if (event.target === cropDialog) {
                    finish(null);
                }
            };

            const onConfirm = () => {
                confirmButton.disabled = true;
                errorMessage.textContent = "";
                const outputCanvas = document.createElement("canvas");
                outputCanvas.width = shape === "circle" ? 600 : 900;
                outputCanvas.height = Math.round(outputCanvas.width / aspectRatio);
                const outputContext = outputCanvas.getContext("2d");
                outputContext.fillStyle = "#fff";
                outputContext.fillRect(
                    0,
                    0,
                    outputCanvas.width,
                    outputCanvas.height
                );
                outputContext.drawImage(
                    image,
                    -offsetX / scale,
                    -offsetY / scale,
                    stageWidth / scale,
                    stageHeight / scale,
                    0,
                    0,
                    outputCanvas.width,
                    outputCanvas.height
                );
                outputCanvas.toBlob(blob => {
                    if (!blob) {
                        confirmButton.disabled = false;
                        errorMessage.textContent =
                            "Could not create the image. Please try again.";
                        return;
                    }
                    if (blob.size > MAX_FILE_SIZE) {
                        confirmButton.disabled = false;
                        errorMessage.textContent =
                            "The cropped image exceeds 10 MB.";
                        return;
                    }
                    finish(new File(
                        [blob],
                        `cropped-${Date.now()}.jpg`,
                        {
                            type: "image/jpeg",
                            lastModified: Date.now()
                        }
                    ));
                }, "image/jpeg", 0.92);
            };

            stage.dataset.shape = shape;
            stage.style.setProperty("--crop-aspect", String(aspectRatio));
            const maxStageHeight = Math.min(window.innerHeight * 0.48, 420);
            stage.style.setProperty(
                "--crop-stage-width",
                `min(76vw, 340px, ${maxStageHeight * aspectRatio}px)`
            );
            previewPanel.dataset.shape = shape;
            previewCanvas.width = aspectRatio === 1 ? 240 : 180;
            previewCanvas.height = Math.round(
                previewCanvas.width / aspectRatio
            );
            zoomInput.value = "1";
            errorMessage.textContent = "";
            image.onload = () => {
                URL.revokeObjectURL(sourceUrl);
                cropDialog.showModal();
                requestAnimationFrame(onResize);
            };
            image.onerror = () => finish(
                null,
                new Error("Could not open the image. Please choose another file.")
            );
            cancelButton.addEventListener("click", onCancel);
            confirmButton.addEventListener("click", onConfirm);
            zoomInput.addEventListener("input", onZoom);
            stage.addEventListener("pointerdown", onPointerDown);
            stage.addEventListener("pointermove", onPointerMove);
            stage.addEventListener("pointerup", onPointerUp);
            stage.addEventListener("pointercancel", onPointerUp);
            cropDialog.addEventListener("cancel", onCancel);
            cropDialog.addEventListener("click", onDialogClick);
            window.addEventListener("resize", onResize);
            image.src = sourceUrl;
        });
    }

    window.NoveltailCropper = { crop };
})();
