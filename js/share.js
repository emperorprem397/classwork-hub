// Reusable "Share" bottom sheet (WhatsApp / Email / Copy link / native More)
// plus the deep-link builder every page uses to construct a shareable URL.
//
// A share link always points at share.html and carries the school + class
// IDs alongside whatever it's linking to (a subject's work feed, one
// upload, one assignment, or the class chat). That's what lets share.html
// quick-join a brand-new recipient straight into the right class after a
// bare Google sign-in — see js/share-landing.js for that half of the flow.

let sheetEl = null;

function ensureSheet() {
  if (sheetEl) return sheetEl;
  sheetEl = document.createElement("div");
  sheetEl.className = "share-sheet-backdrop";
  sheetEl.innerHTML = `
    <div class="share-sheet" role="dialog" aria-modal="true" aria-label="Share">
      <div class="share-sheet-head">
        <span class="share-sheet-title">Share</span>
        <button type="button" class="share-sheet-close" aria-label="Close">✕</button>
      </div>
      <div class="share-sheet-options">
        <button type="button" class="share-option" data-opt="whatsapp">
          <span class="share-option-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M21 11.5a8.38 8.38 0 01-.9 3.8 8.5 8.5 0 01-7.6 4.7 8.38 8.38 0 01-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 01-.9-3.8 8.5 8.5 0 014.7-7.6 8.38 8.38 0 013.8-.9h.5a8.48 8.48 0 018 8v.5z"/></svg></span>
          <span class="share-option-label">WhatsApp</span>
        </button>
        <button type="button" class="share-option" data-opt="email">
          <span class="share-option-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="5" width="18" height="14" rx="2.5"/><path d="M3.5 6.5l8.5 6 8.5-6"/></svg></span>
          <span class="share-option-label">Email</span>
        </button>
        <button type="button" class="share-option" data-opt="copy">
          <span class="share-option-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M9.5 14.5l5-5"/><path d="M11 6.5l1-1a3.5 3.5 0 015 5l-1 1"/><path d="M13 17.5l-1 1a3.5 3.5 0 01-5-5l1-1"/></svg></span>
          <span class="share-option-label">Copy link</span>
        </button>
        <button type="button" class="share-option" data-opt="more" hidden>
          <span class="share-option-icon"><svg viewBox="0 0 24 24" fill="currentColor" stroke="none"><circle cx="5" cy="12" r="1.8"/><circle cx="12" cy="12" r="1.8"/><circle cx="19" cy="12" r="1.8"/></svg></span>
          <span class="share-option-label">More options</span>
        </button>
      </div>
      <p class="share-sheet-hint">Anyone with this link can view it after a quick Google sign-in — no profile setup needed to get in.</p>
    </div>
  `;
  document.body.appendChild(sheetEl);
  sheetEl.addEventListener("click", (e) => { if (e.target === sheetEl) closeShareSheet(); });
  sheetEl.querySelector(".share-sheet-close").addEventListener("click", closeShareSheet);
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") closeShareSheet(); });
  return sheetEl;
}

function closeShareSheet() {
  sheetEl?.classList.remove("open");
}

/**
 * Opens the share sheet for a given title + already-built URL.
 * @param {{title: string, url: string}} opts
 */
export function openShareSheet({ title, url }) {
  const el = ensureSheet();
  el.querySelector(".share-sheet-title").textContent = title || "Share";

  const waBtn = el.querySelector('[data-opt="whatsapp"]');
  waBtn.onclick = () => {
    const text = title ? `${title}\n${url}` : url;
    window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, "_blank", "noopener");
    closeShareSheet();
  };

  const mailBtn = el.querySelector('[data-opt="email"]');
  mailBtn.onclick = () => {
    const subject = title || "Shared from Classwork Hub";
    window.location.href = `mailto:?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(url)}`;
    closeShareSheet();
  };

  const copyBtn = el.querySelector('[data-opt="copy"]');
  const copyLabel = copyBtn.querySelector(".share-option-label");
  copyBtn.onclick = async () => {
    try {
      await navigator.clipboard.writeText(url);
      copyLabel.textContent = "Link copied ✓";
      setTimeout(() => { copyLabel.textContent = "Copy link"; closeShareSheet(); }, 900);
    } catch (_) {
      // Clipboard permission blocked (rare) — fall back to a manual prompt
      // rather than silently doing nothing.
      window.prompt("Copy this link:", url);
    }
  };

  const moreBtn = el.querySelector('[data-opt="more"]');
  moreBtn.hidden = !navigator.share;
  moreBtn.onclick = async () => {
    try { await navigator.share({ title, url }); } catch (_) { /* user cancelled — no error needed */ }
    closeShareSheet();
  };

  el.classList.add("open");
}

/**
 * Builds a share.html deep link. schoolId/classId always travel with it so
 * a signed-out recipient can be quick-joined into the right class; `dest`
 * + `params` say exactly what to open once they land.
 */
export function buildShareLink({ schoolId, classId, dest, params = {} }) {
  const url = new URL("share.html", window.location.href);
  url.searchParams.set("school", schoolId);
  url.searchParams.set("class", classId);
  url.searchParams.set("dest", dest);
  Object.entries(params).forEach(([k, v]) => {
    if (v !== null && v !== undefined && v !== "") url.searchParams.set(k, String(v));
  });
  return url.toString();
}

// Small circular "Share" button, styled to match the app's existing
// .icon-btn / .thumb-mini-btn minimalist black-line-icon look. Pass a
// className to size/position it for the spot it's being dropped into.
export function shareButtonHtml(className = "item-share-btn") {
  return `<button type="button" class="${className}" title="Share" aria-label="Share">
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
      <circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/>
      <line x1="8.6" y1="10.6" x2="15.4" y2="6.4"/><line x1="8.6" y1="13.4" x2="15.4" y2="17.6"/>
    </svg>
  </button>`;
}
