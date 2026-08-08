import { getStoredTheme, applyTheme } from "./theme.js";

// ---------- Theme toggle ----------
// Same [data-theme] convention + localStorage key as the rest of the app
// (js/theme.js) — a theme picked here carries over once signed in, and
// vice versa, since both read/write the same "cwhTheme" key.
const themeToggle = document.getElementById("lpThemeToggle");
themeToggle?.addEventListener("click", () => {
  applyTheme(getStoredTheme() === "dark" ? "light" : "dark");
});

// ---------- Reduced-motion / touch detection ----------
const prefersReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const isFinePointer = window.matchMedia("(hover: hover) and (pointer: fine)").matches;
const wantsCursorEffects = !prefersReducedMotion && isFinePointer;

// ---------- Cursor-tilt on the 3D notebook + trailing glow ----------
// Subtle by design — small rotation range, eased toward the target rather
// than snapping, and entirely scoped to the hero art so it never behaves
// like a full custom-cursor replacement. Disabled outright on touch
// devices and when prefers-reduced-motion is set (spec requirement).
if (wantsCursorEffects) {
  const tiltEl = document.getElementById("artTilt");
  const glowEl = document.getElementById("cursorGlow");
  const heroArt = document.querySelector(".hero-art");

  if (tiltEl && heroArt) {
    let targetX = 0, targetY = 0, currentX = 0, currentY = 0;
    const MAX_TILT = 9; // degrees — kept small per the "subtle, not gaming-style" brief

    heroArt.addEventListener("mousemove", (e) => {
      const rect = heroArt.getBoundingClientRect();
      const px = (e.clientX - rect.left) / rect.width - 0.5;  // -0.5..0.5
      const py = (e.clientY - rect.top) / rect.height - 0.5;
      targetY = px * MAX_TILT * 2;
      targetX = py * -MAX_TILT * 2;
    });
    heroArt.addEventListener("mouseleave", () => { targetX = 0; targetY = 0; });

    (function ease() {
      currentX += (targetX - currentX) * 0.08;
      currentY += (targetY - currentY) * 0.08;
      tiltEl.style.setProperty("--tiltX", `${currentX.toFixed(2)}deg`);
      tiltEl.style.setProperty("--tiltY", `${currentY.toFixed(2)}deg`);
      requestAnimationFrame(ease);
    })();
  }

  if (glowEl) {
    let gx = -300, gy = -300;
    document.addEventListener("mousemove", (e) => {
      gx = e.clientX; gy = e.clientY;
      glowEl.classList.add("active");
    });
    document.addEventListener("mouseleave", () => glowEl.classList.remove("active"));
    (function moveGlow() {
      glowEl.style.transform = `translate(${gx}px, ${gy}px) translate(-50%, -50%)`;
      requestAnimationFrame(moveGlow);
    })();
  }
}

// ---------- Scroll-reveal ----------
// Same lightweight pattern used on the dashboard (js/dashboard.js) — an
// IntersectionObserver that adds .is-visible once, then stops watching.
// Fails open: if IntersectionObserver isn't available, elements just stay
// at their default (visible) state instead of getting stuck hidden.
if ("IntersectionObserver" in window) {
  const targets = document.querySelectorAll(".reveal-armed");
  const observer = new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      if (entry.isIntersecting) {
        entry.target.classList.add("is-visible");
        observer.unobserve(entry.target);
      }
    });
  }, { threshold: 0.12 });
  targets.forEach((el) => observer.observe(el));
}
