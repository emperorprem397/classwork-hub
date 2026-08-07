// Tiny helper shared by homework.js / activity.js / dashboard.js: once a
// share-link recipient (or anyone reopening their own shared link) lands on
// the real page, scroll the specific item into view and pulse it briefly so
// it's obvious which classwork/homework/message the link was actually for.
export function highlightShareTarget(selector) {
  requestAnimationFrame(() => {
    const el = document.querySelector(selector);
    if (!el) return; // link pointed at something since deleted/expired — fail quiet, page still loads normally
    el.scrollIntoView({ behavior: "smooth", block: "center" });
    el.classList.add("share-target-highlight");
    setTimeout(() => el.classList.remove("share-target-highlight"), 3000);
  });
}

export function getShareParams() {
  return new URLSearchParams(window.location.search);
}
