// Shared confirm dialog — matches the look of the Settings "reset account"
// modal (icon, glowing red title, detail copy, Cancel/Confirm buttons) so
// every destructive confirmation in the app looks and reads the same way,
// instead of some being a polished modal and others a plain browser
// confirm() popup.
//
// Usage:
//   const ok = await confirmDialog({
//     title: "Delete this subject?",
//     detail: "This removes Chemistry and everything inside it — today's
//              uploads, its activity history, all of it. This can't be undone.",
//     confirmLabel: "Yes, delete subject",
//   });
//   if (!ok) return;

let stylesInjected = false;
function injectStyles() {
  if (stylesInjected) return;
  stylesInjected = true;
  if (document.querySelector('link[data-confirm-dialog-css]')) return;
  const link = document.createElement("link");
  link.rel = "stylesheet";
  link.href = "css/confirm-dialog.css";
  link.setAttribute("data-confirm-dialog-css", "1");
  document.head.appendChild(link);
}

export function confirmDialog(opts = {}) {
  injectStyles();
  const {
    icon = "⚠️",
    title = "Are you sure?",
    detail = "This can't be undone.",
    confirmLabel = "Yes, continue",
    cancelLabel = "Cancel",
  } = opts;

  return new Promise((resolve) => {
    const overlay = document.createElement("div");
    overlay.className = "modal-overlay confirm-dialog-overlay";
    overlay.innerHTML = `
      <div class="modal glass reset-modal confirm-dialog-modal">
        <button type="button" class="modal-close confirm-dialog-close" aria-label="Close">✕</button>
        <div class="reset-modal-icon">${icon}</div>
        <h3 class="reset-modal-title">${title}</h3>
        <p class="reset-modal-detail">${detail}</p>
        <div class="reset-modal-actions">
          <button type="button" class="btn btn-ghost confirm-dialog-cancel" style="flex:1;">${cancelLabel}</button>
          <button type="button" class="btn btn-red reset-confirm-btn confirm-dialog-confirm" style="flex:1;">${confirmLabel}</button>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);

    function settle(result) {
      overlay.remove();
      resolve(result);
    }
    overlay.querySelector(".confirm-dialog-close").addEventListener("click", () => settle(false));
    overlay.querySelector(".confirm-dialog-cancel").addEventListener("click", () => settle(false));
    overlay.querySelector(".confirm-dialog-confirm").addEventListener("click", () => settle(true));
    overlay.addEventListener("click", (e) => { if (e.target === overlay) settle(false); });
    document.addEventListener("keydown", function onKey(e) {
      if (e.key === "Escape") { document.removeEventListener("keydown", onKey); settle(false); }
    });
  });
}
