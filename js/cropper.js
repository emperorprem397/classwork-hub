// Shared image cropper — a small self-contained modal (no HTML markup
// needed in any page; it builds and tears down its own DOM) that lets the
// person preview an uploaded photo, drag to reposition, and zoom before it
// gets saved. Used by:
//   - js/settings.js and js/welcome.js — avatar upload (circle preview)
//   - js/dashboard.js — subject cover photo upload (square preview)
//
// Fixes the "any ratio image gets pinched/stretched" issue: instead of
// silently resizing whatever was picked, the person sees exactly what will
// be saved (a proper square crop) before confirming.
//
// Usage: const blob = await openImageCropper(file, { shape: "circle" | "square", outputSize: 512 });
// Resolves to a JPEG Blob on "Use this photo", or null if the person cancels.

let stylesInjected = false;
function injectStyles() {
  if (stylesInjected) return;
  stylesInjected = true;
  if (document.querySelector('link[data-cropper-css]')) return;
  const link = document.createElement("link");
  link.rel = "stylesheet";
  link.href = "css/cropper.css";
  link.setAttribute("data-cropper-css", "1");
  document.head.appendChild(link);
}

export function openImageCropper(file, opts = {}) {
  injectStyles();
  const shape = opts.shape === "square" ? "square" : "circle";
  const outputSize = opts.outputSize || 512;
  const viewport = 260; // px — the visible crop window, fixed regardless of source image size

  return new Promise((resolve) => {
    const overlay = document.createElement("div");
    overlay.className = "cropper-overlay";
    overlay.innerHTML = `
      <div class="cropper-box">
        <h3 class="cropper-title">Move &amp; zoom</h3>
        <p class="cropper-sub">${shape === "circle" ? "This is how your profile photo will look." : "This is how the cover photo will look on the card."}</p>
        <div class="cropper-viewport ${shape === "circle" ? "is-circle" : "is-square"}">
          <img class="cropper-img" draggable="false" alt="" />
        </div>
        <input type="range" class="cropper-zoom" min="0" max="100" value="0" aria-label="Zoom" />
        <div class="cropper-actions">
          <button type="button" class="btn btn-ghost cropper-cancel">Cancel</button>
          <button type="button" class="btn btn-primary cropper-save">Use this photo</button>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);

    const viewportEl = overlay.querySelector(".cropper-viewport");
    const imgEl       = overlay.querySelector(".cropper-img");
    const zoomEl       = overlay.querySelector(".cropper-zoom");
    const cancelBtn    = overlay.querySelector(".cropper-cancel");
    const saveBtn      = overlay.querySelector(".cropper-save");

    let naturalW = 0, naturalH = 0, minScale = 1, scale = 1;
    let left = 0, top = 0;
    let dragging = false, startX = 0, startY = 0, startLeft = 0, startTop = 0;
    let settled = false;

    function clamp() {
      const w = naturalW * scale, h = naturalH * scale;
      left = Math.min(0, Math.max(viewport - w, left));
      top  = Math.min(0, Math.max(viewport - h, top));
    }
    function render() {
      imgEl.style.width  = `${naturalW * scale}px`;
      imgEl.style.height = `${naturalH * scale}px`;
      imgEl.style.left = `${left}px`;
      imgEl.style.top  = `${top}px`;
    }

    const objectUrl = URL.createObjectURL(file);
    imgEl.onload = () => {
      naturalW = imgEl.naturalWidth || 1;
      naturalH = imgEl.naturalHeight || 1;
      minScale = viewport / Math.min(naturalW, naturalH);
      scale = minScale;
      left = (viewport - naturalW * scale) / 2;
      top  = (viewport - naturalH * scale) / 2;
      clamp();
      render();
    };
    imgEl.onerror = () => {
      cleanup();
      resolve(null);
    };
    imgEl.src = objectUrl;

    function applyZoom(pct) {
      const t = Math.min(100, Math.max(0, pct)) / 100;
      const newScale = minScale * (1 + t * 2); // up to 3x the "fills viewport" scale
      const cx = viewport / 2, cy = viewport / 2;
      const imgX = (cx - left) / scale;
      const imgY = (cy - top) / scale;
      scale = newScale;
      left = cx - imgX * scale;
      top  = cy - imgY * scale;
      clamp();
      render();
    }
    zoomEl.addEventListener("input", () => applyZoom(Number(zoomEl.value)));
    viewportEl.addEventListener("wheel", (e) => {
      e.preventDefault();
      const next = Number(zoomEl.value) + (e.deltaY > 0 ? -6 : 6);
      zoomEl.value = String(Math.min(100, Math.max(0, next)));
      applyZoom(Number(zoomEl.value));
    }, { passive: false });

    viewportEl.addEventListener("pointerdown", (e) => {
      dragging = true;
      startX = e.clientX; startY = e.clientY;
      startLeft = left; startTop = top;
      viewportEl.setPointerCapture(e.pointerId);
    });
    viewportEl.addEventListener("pointermove", (e) => {
      if (!dragging) return;
      left = startLeft + (e.clientX - startX);
      top  = startTop + (e.clientY - startY);
      clamp();
      render();
    });
    ["pointerup", "pointercancel"].forEach((evt) =>
      viewportEl.addEventListener(evt, () => { dragging = false; })
    );

    function cleanup() {
      if (settled) return;
      settled = true;
      URL.revokeObjectURL(objectUrl);
      overlay.remove();
    }
    cancelBtn.addEventListener("click", () => { cleanup(); resolve(null); });
    overlay.addEventListener("click", (e) => { if (e.target === overlay) { cleanup(); resolve(null); } });

    saveBtn.addEventListener("click", () => {
      const canvas = document.createElement("canvas");
      canvas.width = outputSize;
      canvas.height = outputSize;
      const ctx = canvas.getContext("2d");
      const sx = -left / scale;
      const sy = -top / scale;
      const sSize = viewport / scale;
      ctx.drawImage(imgEl, sx, sy, sSize, sSize, 0, 0, outputSize, outputSize);
      canvas.toBlob((blob) => {
        cleanup();
        resolve(blob);
      }, "image/jpeg", 0.9);
    });
  });
}
