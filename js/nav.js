// nav.js — shared off-canvas sidebar toggle for the ⋮ menu button.
// Plain script (not a module) so it can be dropped into every app page
// the same way, after the page's own module script.
(function () {
  const toggle = document.getElementById("navToggle");
  const sidebar = document.getElementById("sidebar");
  const overlay = document.getElementById("navOverlay");
  if (!toggle || !sidebar || !overlay) return;

  function openNav() {
    sidebar.classList.add("open");
    overlay.classList.add("open");
    toggle.setAttribute("aria-expanded", "true");
  }
  function closeNav() {
    sidebar.classList.remove("open");
    overlay.classList.remove("open");
    toggle.setAttribute("aria-expanded", "false");
  }
  function toggleNav() {
    if (sidebar.classList.contains("open")) closeNav();
    else openNav();
  }

  toggle.addEventListener("click", toggleNav);
  overlay.addEventListener("click", closeNav);
  // Closing on Escape and on nav-link tap keeps it feeling like a proper
  // menu rather than a panel that's stuck open until you find the backdrop.
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") closeNav(); });
  sidebar.querySelectorAll(".sb-item, #signOutBtn").forEach((el) => {
    el.addEventListener("click", closeNav);
  });
})();
