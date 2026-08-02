import { auth, db } from "./firebase-config.js";
import { onAuthStateChanged, signOut, updateProfile }
  from "https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js";
import { doc, getDoc, updateDoc }
  from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";
import { getStoredTheme, applyTheme, syncThemeFromCloud, saveThemeToCloud } from "./theme.js";

const userPhoto     = document.getElementById("userPhoto");
const userNameEl    = document.getElementById("userName");
const signOutBtn    = document.getElementById("signOutBtn");
const signOutBtn2   = document.getElementById("signOutBtn2");

const settingsPhoto = document.getElementById("settingsPhoto");
const nameInput     = document.getElementById("nameInput");
const nameSaveBtn   = document.getElementById("nameSaveBtn");
const nameStatus    = document.getElementById("nameStatus");

const enrolmentSchool = document.getElementById("enrolmentSchool");
const enrolmentClass  = document.getElementById("enrolmentClass");
const accountEmail    = document.getElementById("accountEmail");

const notifyStatus = document.getElementById("notifyStatus");
const NOTIFY_KEYS = {
  notifyActivity: "activity",
  notifyUploads: "uploads",
  notifyHomework: "homework",
  notifyAnnouncements: "announcements",
  notifyLeaderboard: "leaderboard",
};

signOutBtn.addEventListener("click", () => signOut(auth));
signOutBtn2.addEventListener("click", () => signOut(auth));

let currentUser = null;

// ---------- Tabs ----------
document.querySelectorAll(".work-tab").forEach((btn) => {
  btn.addEventListener("click", () => {
    const tab = btn.dataset.tab;
    document.querySelectorAll(".work-tab").forEach((b) => b.classList.toggle("active", b === btn));
    document.querySelectorAll(".work-panel").forEach((p) => p.classList.toggle("active", p.id === `panel-${tab}`));
  });
});

// ---------- Appearance ----------
function updateThemeSwatchUI() {
  const current = getStoredTheme();
  document.querySelectorAll("[data-theme-choice]").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.themeChoice === current);
  });
}
document.querySelectorAll("[data-theme-choice]").forEach((btn) => {
  btn.addEventListener("click", async () => {
    const themeId = btn.dataset.themeChoice;
    applyTheme(themeId);
    updateThemeSwatchUI();
    if (currentUser) {
      try { await saveThemeToCloud(db, currentUser.uid, themeId); }
      catch (err) { console.error("Couldn't save theme preference:", err); }
    }
  });
});
updateThemeSwatchUI();

// ---------- Notifications ----------
document.querySelectorAll('[id^="notify"]').forEach((checkbox) => {
  checkbox.addEventListener("change", saveNotificationPrefs);
});

async function saveNotificationPrefs() {
  if (!currentUser) return;
  const prefs = {};
  Object.entries(NOTIFY_KEYS).forEach(([elId, key]) => {
    prefs[key] = document.getElementById(elId).checked;
  });
  notifyStatus.textContent = "Saving…";
  try {
    await updateDoc(doc(db, "users", currentUser.uid), { notificationPrefs: prefs });
    notifyStatus.textContent = "Saved ✓";
  } catch (err) {
    console.error(err);
    notifyStatus.textContent = "Couldn't save — check your connection.";
  }
}

onAuthStateChanged(auth, async (user) => {
  if (!user) { window.location.href = "index.html"; return; }
  currentUser = user;

  userPhoto.src = user.photoURL || "";
  userNameEl.textContent = user.displayName || user.email;
  settingsPhoto.src = user.photoURL || "";
  nameInput.value = user.displayName || "";
  accountEmail.textContent = user.email || "";

  const snap = await getDoc(doc(db, "users", user.uid));
  if (!snap.exists()) { window.location.href = "school-select.html"; return; }
  const profile = snap.data();

  if (!profile.schoolId || !profile.classId) { window.location.href = "school-select.html"; return; }

  enrolmentSchool.textContent = profile.schoolName || "Your school";
  enrolmentClass.textContent = `Class ${profile.classId}`;

  // Pull any theme saved from another device and reflect it here.
  await syncThemeFromCloud(db, user.uid);
  updateThemeSwatchUI();

  // Reflect saved notification prefs (default: all on except Leaderboard,
  // matching the checked/unchecked attributes already in the HTML).
  if (profile.notificationPrefs) {
    Object.entries(NOTIFY_KEYS).forEach(([elId, key]) => {
      if (profile.notificationPrefs[key] !== undefined) {
        document.getElementById(elId).checked = profile.notificationPrefs[key];
      }
    });
  }

  // Keep the Firestore mirror of name/photo in sync with the live Google
  // account — this is what the leaderboard and admin panel actually read
  // (they can't call the Firebase Auth API for other users), so without
  // this a name/photo change would only ever show on your own pages.
  // Silent, fire-and-forget — nothing for the student to do here.
  if (profile.name !== user.displayName || profile.photoURL !== user.photoURL) {
    updateDoc(doc(db, "users", user.uid), {
      name: user.displayName || profile.name || "",
      photoURL: user.photoURL || "",
    }).catch((err) => console.error("Background profile sync failed:", err));
  }
});

nameSaveBtn.addEventListener("click", async () => {
  const newName = nameInput.value.trim();
  if (!newName) {
    nameStatus.textContent = "Name can't be empty.";
    return;
  }
  nameSaveBtn.disabled = true;
  nameStatus.textContent = "Saving…";

  try {
    // Updates the Firebase Auth profile (what every page reads for "your own" name)...
    await updateProfile(currentUser, { displayName: newName });
    // ...and the Firestore mirror (what the leaderboard/admin panel read for OTHER users).
    await updateDoc(doc(db, "users", currentUser.uid), { name: newName });

    userNameEl.textContent = newName;
    nameStatus.textContent = "Saved ✓";
  } catch (err) {
    console.error(err);
    nameStatus.textContent = "Couldn't save — check your connection and try again.";
  } finally {
    nameSaveBtn.disabled = false;
  }
});
