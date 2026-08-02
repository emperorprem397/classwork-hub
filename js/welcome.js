import { auth, db } from "./firebase-config.js";
import { onAuthStateChanged, signOut, updateProfile }
  from "https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js";
import { doc, getDoc, updateDoc }
  from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";
import { applyTheme, saveThemeToCloud } from "./theme.js";

const userPhoto  = document.getElementById("userPhoto");
const userNameEl = document.getElementById("userName");
const signOutBtn = document.getElementById("signOutBtn");

const steps = ["step-name", "step-appearance", "step-continue"];
const dots  = document.querySelectorAll(".wizard-dot");

const nameInput        = document.getElementById("nameInput");
const skipNameBtn      = document.getElementById("skipNameBtn");
const nextNameBtn      = document.getElementById("nextNameBtn");

const backAppearanceBtn = document.getElementById("backAppearanceBtn");
const skipAppearanceBtn = document.getElementById("skipAppearanceBtn");
const nextAppearanceBtn = document.getElementById("nextAppearanceBtn");

const backContinueBtn = document.getElementById("backContinueBtn");
const continueBtn     = document.getElementById("continueBtn");

signOutBtn.addEventListener("click", () => signOut(auth));

let currentUser = null;
let chosenName = "";
let chosenTheme = "dark";
let stepIndex = 0;

onAuthStateChanged(auth, async (user) => {
  if (!user) { window.location.href = "index.html"; return; }
  currentUser = user;
  userPhoto.src = user.photoURL || "";
  userNameEl.textContent = user.displayName || user.email;

  // Already finished onboarding once (or an existing account from before
  // this feature existed that already has schoolId/classId set) — no need
  // to show this again, straight to where they were headed.
  const snap = await getDoc(doc(db, "users", user.uid));
  const profile = snap.exists() ? snap.data() : null;
  if (profile?.onboarded || profile?.schoolId) {
    window.location.href = "school-select.html";
    return;
  }

  chosenName = user.displayName || "";
  nameInput.value = chosenName;
  goToStep(0);
});

function goToStep(idx) {
  stepIndex = idx;
  steps.forEach((id, i) => {
    document.getElementById(id).hidden = i !== idx;
  });
  dots.forEach((dot, i) => {
    dot.classList.toggle("active", i === idx);
    dot.classList.toggle("done", i < idx);
  });
}

// ---------- Step 1: name ----------
nextNameBtn.addEventListener("click", () => {
  chosenName = nameInput.value.trim() || (currentUser.displayName || "");
  goToStep(1);
});
skipNameBtn.addEventListener("click", () => {
  chosenName = currentUser.displayName || "";
  goToStep(1);
});

// ---------- Step 2: appearance ----------
document.querySelectorAll("[data-theme-choice]").forEach((btn) => {
  btn.addEventListener("click", () => {
    chosenTheme = btn.dataset.themeChoice;
    document.querySelectorAll("[data-theme-choice]").forEach((b) =>
      b.classList.toggle("active", b === btn)
    );
    applyTheme(chosenTheme); // live preview, same as Settings does
  });
});
backAppearanceBtn.addEventListener("click", () => goToStep(0));
nextAppearanceBtn.addEventListener("click", () => goToStep(2));
skipAppearanceBtn.addEventListener("click", () => {
  chosenTheme = "dark";
  applyTheme("dark");
  goToStep(2);
});

// ---------- Step 3: continue (mandatory) ----------
backContinueBtn.addEventListener("click", () => goToStep(1));
continueBtn.addEventListener("click", async () => {
  continueBtn.disabled = true;
  continueBtn.textContent = "Saving…";

  try {
    const userRef = doc(db, "users", currentUser.uid);
    const updates = { onboarded: true };

    if (chosenName && chosenName !== currentUser.displayName) {
      updates.name = chosenName;
      // Keep Firebase Auth's own displayName in sync too, since several
      // pages read user.displayName directly rather than the Firestore doc.
      try { await updateProfile(currentUser, { displayName: chosenName }); } catch (e) { console.error(e); }
    }

    await updateDoc(userRef, updates);
    if (chosenTheme !== "dark") {
      await saveThemeToCloud(db, currentUser.uid, chosenTheme);
    }
  } catch (err) {
    console.error(err);
    // Don't block them getting into the app over a profile-save hiccup —
    // school-select.html will still work fine, and Settings can fix name/
    // theme later either way.
  }

  window.location.href = "school-select.html";
});
