// theme.js — shared Appearance (theme) helper.
// Used by settings.js (the Appearance tab UI) and dashboard.js (a silent
// one-time sync so a theme picked on another device shows up here too).
// The actual flash-free apply-on-load happens via a small inline <script>
// at the top of every page's <head> reading localStorage directly (a
// module import can't run early enough to beat first paint) — this file
// is for anything that needs Firestore, which that inline script can't do.

import { doc, getDoc, updateDoc }
  from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";

export const THEMES = [
  { id: "dark", label: "Dark Cyan", sub: "Default" },
  { id: "light", label: "Light" },
  { id: "monochrome", label: "Monochrome" },
];

const STORAGE_KEY = "cwhTheme";

export function getStoredTheme() {
  try { return localStorage.getItem(STORAGE_KEY) || "dark"; }
  catch { return "dark"; }
}

// Applies instantly (no reload) and persists to localStorage. Firestore
// sync is a separate, optional step — see saveThemeToCloud below.
export function applyTheme(themeId) {
  if (themeId === "dark") {
    document.documentElement.removeAttribute("data-theme");
  } else {
    document.documentElement.setAttribute("data-theme", themeId);
  }
  try { localStorage.setItem(STORAGE_KEY, themeId); } catch { /* private browsing etc. — non-fatal */ }
}

// Called once per page load (from settings.js and dashboard.js) after auth
// resolves: if this account has a theme saved in Firestore that differs
// from what's applied locally, adopt it — this is what makes a theme
// picked on one device show up on another without visiting Settings first.
export async function syncThemeFromCloud(db, uid) {
  try {
    const snap = await getDoc(doc(db, "users", uid));
    const cloudTheme = snap.exists() ? snap.data().theme : null;
    if (cloudTheme && cloudTheme !== getStoredTheme()) {
      applyTheme(cloudTheme);
    }
    return cloudTheme;
  } catch (err) {
    console.error("Theme sync failed:", err);
    return null;
  }
}

export async function saveThemeToCloud(db, uid, themeId) {
  await updateDoc(doc(db, "users", uid), { theme: themeId });
}
