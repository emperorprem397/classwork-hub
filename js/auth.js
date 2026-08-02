import { auth, googleProvider, db } from "./firebase-config.js";
import {
  signInWithPopup,
  onAuthStateChanged,
  signOut
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js";
import {
  doc,
  getDoc,
  setDoc,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";

// The new hero landing page has three separate buttons that should all
// trigger the same Google sign-in (top-right "Login" pill, the "Get
// Started" hero CTA, and the bottom "Get Started" CTA) — so we bind by
// class instead of assuming a single #google-login-btn like before.
const loginBtns = Array.from(document.querySelectorAll(".google-signin-btn"));
const statusEl = document.getElementById("login-status");

loginBtns.forEach((btn) => {
  const originalLabel = btn.innerHTML;
  btn.addEventListener("click", async () => {
    setLoading(true, originalLabel);
    try {
      // Popup-based sign-in — same approach already working reliably in
      // admin/index.html on both desktop and mobile. Turns out the earlier
      // "Something went wrong signing in" errors were actually caused by the
      // Firestore rules mix-up (Storage rules pasted into the Firestore rules
      // tab), not by popup sign-in itself — popup was never the problem.
      // Redirect-based sign-in was tried as a fix but introduced a new issue:
      // it needs a background iframe handshake with classwork-hub.firebaseapp.com
      // that triggers Brave's (and similar browsers') third-party cookie prompt.
      // Popup avoids that handshake entirely, matching the admin panel's
      // already-working behavior.
      const result = await signInWithPopup(auth, googleProvider);
      const user = result.user;
      const { profile, isNew } = await ensureUserProfile(user);
      if (profile.banned === true) {
        await signOut(auth);
        showStatus("This account has been blocked by an admin. Contact your school admin if you think this is a mistake.");
        setLoading(false, originalLabel);
        return;
      }
      // First-ever sign-in gets the optional welcome/profile-setup wizard;
      // everyone else (including existing accounts from before this
      // feature shipped, since they'll already have onboarded === true or
      // a schoolId set) skips straight to their usual destination.
      window.location.href = (isNew || !profile.onboarded) && !profile.schoolId
        ? "welcome.html"
        : "school-select.html";
    } catch (err) {
      console.error(err);
      showStatus(getFriendlyError(err.code));
      setLoading(false, originalLabel);
    }
  });
});

// If already logged in (e.g. returning visit, session still valid), skip
// straight past login — but re-check banned status first, in case they
// were blocked after their last session started.
onAuthStateChanged(auth, async (user) => {
  if (user) {
    const snap = await getDoc(doc(db, "users", user.uid));
    if (snap.exists() && snap.data().banned === true) {
      await signOut(auth);
      showStatus("This account has been blocked by an admin. Contact your school admin if you think this is a mistake.");
      return;
    }
    const profile = snap.exists() ? snap.data() : null;
    window.location.href = (profile && !profile.onboarded && !profile.schoolId)
      ? "welcome.html"
      : "school-select.html";
  }
});

async function ensureUserProfile(user) {
  const userRef = doc(db, "users", user.uid);
  const existing = await getDoc(userRef);

  if (!existing.exists()) {
    const newProfile = {
      name: user.displayName,
      email: user.email,
      photoURL: user.photoURL || null,
      xp: 0,
      rank: "Bronze",
      streak: 0,
      lastUploadDate: null,
      schoolId: null,
      classId: null,
      sectionId: null,
      banned: false,
      onboarded: false, // flips to true once they finish (or skip) the welcome wizard
      createdAt: serverTimestamp()
    };
    await setDoc(userRef, newProfile);
    return { profile: newProfile, isNew: true };
  }
  return { profile: existing.data(), isNew: false };
}

function setLoading(isLoading, originalLabel) {
  loginBtns.forEach((btn) => {
    btn.disabled = isLoading;
    btn.innerHTML = isLoading ? "Signing in…" : originalLabel;
  });
}

function showStatus(message) {
  statusEl.textContent = message;
  statusEl.classList.add("visible");
}

function getFriendlyError(code) {
  switch (code) {
    case "auth/popup-closed-by-user":
      return "Sign-in was cancelled. Try again when you're ready.";
    case "auth/popup-blocked":
      return "Your browser blocked the sign-in popup. Please allow popups for this site and try again.";
    case "auth/network-request-failed":
      return "Network issue — check your connection and try again.";
    default:
      return "Something went wrong signing in. Please try again.";
  }
}
