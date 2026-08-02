// topbar.js — shared horizontal-navbar behavior (search shortcut, theme
// toggle, notification bell, profile avatar dropdown) plus the unread
// badge dots on the sidebar. Runs on every app page independently of that
// page's own script — it does its own light auth/profile read rather than
// depending on the page module, so dropping <script type="module"
// src="js/topbar.js"> into any page is enough to get the new navbar and
// badges working, with zero changes needed to that page's existing script.
import { auth, db } from "./firebase-config.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js";
import {
  doc, getDoc, collection, query, where, limit, getDocs
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";
import { THEMES, getStoredTheme, applyTheme, saveThemeToCloud } from "./theme.js";

const themeToggleBtn   = document.getElementById("themeToggleBtn");
const notifBell        = document.getElementById("notifBell");
const notifDot         = document.getElementById("notifDot");
const profileAvatarBtn = document.getElementById("profileAvatarBtn");
const profileDropdown  = document.getElementById("profileDropdown");
const sbDashboardBadge = document.getElementById("sbDashboardBadge");
const sbActivityBadge  = document.getElementById("sbActivityBadge");

let currentUid = null;

// ---------- Theme toggle — cycles Dark Cyan → Light → Monochrome → … ----------
if (themeToggleBtn) {
  themeToggleBtn.addEventListener("click", () => {
    const ids = THEMES.map((t) => t.id);
    const next = ids[(ids.indexOf(getStoredTheme()) + 1) % ids.length];
    applyTheme(next);
    if (currentUid) saveThemeToCloud(db, currentUid, next).catch((err) => console.error("Theme cloud save failed:", err));
  });
}

// ---------- Profile avatar dropdown ----------
if (profileAvatarBtn && profileDropdown) {
  profileAvatarBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    const willOpen = profileDropdown.hidden;
    profileDropdown.hidden = !willOpen;
    profileAvatarBtn.setAttribute("aria-expanded", String(willOpen));
  });
  document.addEventListener("click", (e) => {
    if (!profileDropdown.hidden && !profileDropdown.contains(e.target) && e.target !== profileAvatarBtn) {
      profileDropdown.hidden = true;
      profileAvatarBtn.setAttribute("aria-expanded", "false");
    }
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !profileDropdown.hidden) {
      profileDropdown.hidden = true;
      profileAvatarBtn.setAttribute("aria-expanded", "false");
    }
  });
}

// ---------- Unread badges ----------
// Two independent signals, each a simple yes/no dot (not a precise count —
// keeps this to cheap existence checks, no composite indexes needed):
//   • Chat + Activity Log → the 🔔 notif bell + the sidebar "Activity" dot.
//     Both live on activity.html, so one combined signal is enough.
//   • Dashboard → the sidebar "Dashboard" dot, meaning "something changed
//     in your class (a new upload, a subject edit, etc.) since you last
//     opened the dashboard" — reuses the same class Activity log rather
//     than a separate "announcements" feed, since that feature doesn't
//     exist yet (flagged honestly in PROJECT_PROGRESS.md).
// Cleared by each page marking its own lastSeen* field on users/{uid} when
// visited (see dashboard.js / activity.js) — new accounts simply show a
// dot until they first open each page, which is expected.
async function hasNewSince(colRef, lastSeenDate) {
  try {
    const q = query(colRef, where("createdAt", ">", lastSeenDate || new Date(0)), limit(1));
    const snap = await getDocs(q);
    return !snap.empty;
  } catch (err) {
    console.error("Unread-check failed:", err);
    return false;
  }
}

function toDateOrNull(ts) {
  return ts && typeof ts.toDate === "function" ? ts.toDate() : null;
}

async function updateBadges(profile) {
  const { schoolId, classId } = profile;
  if (!schoolId || !classId) return;

  const messagesCol = collection(db, "schools", schoolId, "classes", classId, "messages");
  const activityCol = collection(db, "schools", schoolId, "classes", classId, "activity");

  const [newChat, newActivityForBell, newActivityForDashboard] = await Promise.all([
    hasNewSince(messagesCol, toDateOrNull(profile.lastSeenChat)),
    hasNewSince(activityCol, toDateOrNull(profile.lastSeenActivity)),
    hasNewSince(activityCol, toDateOrNull(profile.lastSeenUploads)),
  ]);

  const bellOn = newChat || newActivityForBell;
  if (notifDot) notifDot.hidden = !bellOn;
  if (sbActivityBadge) sbActivityBadge.hidden = !bellOn;
  if (sbDashboardBadge) sbDashboardBadge.hidden = !newActivityForDashboard;
}

onAuthStateChanged(auth, async (user) => {
  if (!user) return; // each page's own script already handles the redirect
  currentUid = user.uid;
  try {
    const snap = await getDoc(doc(db, "users", user.uid));
    if (!snap.exists()) return;
    const profile = snap.data();
    if (!profile.schoolId || !profile.classId) return;
    await updateBadges(profile);
  } catch (err) {
    console.error("topbar init failed:", err);
  }
});
