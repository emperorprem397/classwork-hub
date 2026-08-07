import { auth, googleProvider, db } from "./firebase-config.js";
import { signInWithPopup, onAuthStateChanged, signOut }
  from "https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js";
import { doc, getDoc, setDoc, serverTimestamp }
  from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";

const loginBtn      = document.getElementById("shareLoginBtn");
const statusEl      = document.getElementById("login-status");
const validState     = document.getElementById("shareValidState");
const errorState     = document.getElementById("shareErrorState");
const titleEl        = document.getElementById("shareTitle");
const descEl         = document.getElementById("shareDesc");

const params   = new URLSearchParams(window.location.search);
const schoolId = params.get("school");
const classId  = params.get("class");
const dest     = params.get("dest");
const label    = params.get("label"); // human-readable description supplied by whoever built the link

if (!schoolId || !classId || !dest) {
  validState.hidden = true;
  errorState.classList.add("visible");
} else {
  if (label) {
    titleEl.textContent = "You've been invited to view:";
    descEl.textContent = `"${label}" — sign in with Google to open it. No profile setup needed, you can do that later from Settings.`;
  }

  // Guards the same race the main auth.js guards against: onAuthStateChanged
  // firing mid-popup and redirecting before this handler's own (more
  // specific, quick-join-aware) redirect gets to run.
  let signingIn = false;

  loginBtn.addEventListener("click", () => handleSignIn());

  // Already signed in (e.g. re-opening the same link, or clicked while a
  // session was still active) — skip straight to enroll-and-redirect,
  // no need to click again.
  onAuthStateChanged(auth, (user) => {
    if (signingIn) return;
    if (user) handleSignedInUser(user);
  });

  async function handleSignIn() {
    signingIn = true;
    setLoading(true);
    try {
      const result = await signInWithPopup(auth, googleProvider);
      await handleSignedInUser(result.user);
    } catch (err) {
      console.error(err);
      showStatus(getFriendlyError(err.code));
      setLoading(false);
      signingIn = false;
    }
  }

  async function handleSignedInUser(user) {
    const userRef = doc(db, "users", user.uid);
    const existing = await getDoc(userRef);

    if (existing.exists() && existing.data().banned === true) {
      await signOut(auth);
      showStatus("This account has been blocked by an admin. Contact your school admin if you think this is a mistake.");
      setLoading(false);
      signingIn = false;
      return;
    }

    if (!existing.exists()) {
      // Brand-new account, arriving via a share link — quick-join straight
      // into the linked class instead of sending them through the full
      // welcome/school-select wizard. Default name/photo come straight
      // from their Google account; they can change everything in Settings
      // whenever they want.
      await setDoc(userRef, {
        name: user.displayName || "",
        email: user.email || "",
        photoURL: user.photoURL || null,
        schoolId,
        classId,
        xp: 0,
        rank: "Bronze",
        streak: 0,
        lastUploadDate: null,
        banned: false,
        onboarded: false, // Settings can still offer the full setup later — this only skips it as a login gate
        quickJoined: true,
        joinedAt: serverTimestamp(),
        createdAt: serverTimestamp()
      });
    } else if (!existing.data().schoolId || !existing.data().classId) {
      // Existing account (e.g. signed in before but never finished
      // school-select) that still has no class — safe to quick-join too.
      await setDoc(userRef, { schoolId, classId, quickJoined: true }, { merge: true });
    }
    // Else: already belongs to a class (this one or another) — leave their
    // enrollment untouched. We never silently move an established account
    // into a different class just because they clicked someone else's link.

    window.location.href = buildDestinationUrl();
  }
}

function buildDestinationUrl() {
  if (dest === "chat") {
    const url = new URL("activity.html", window.location.href);
    url.searchParams.set("tab", "chat");
    return url.toString();
  }
  if (dest === "dashboard") {
    return new URL("dashboard.html", window.location.href).toString();
  }
  // dest === "work" — homework.html, opening a specific tab/item.
  const url = new URL("homework.html", window.location.href);
  const tab = params.get("tab");
  if (tab) url.searchParams.set("tab", tab);
  const map = { subject: "openSubject", date: "openDate", upload: "openUpload", assignment: "openAssignment" };
  Object.entries(map).forEach(([from, to]) => {
    const v = params.get(from);
    if (v) url.searchParams.set(to, v);
  });
  return url.toString();
}

function setLoading(isLoading) {
  loginBtn.disabled = isLoading;
  loginBtn.innerHTML = isLoading ? "Signing in…" : `Continue with Google <span class="cta-arrow">→</span>`;
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
