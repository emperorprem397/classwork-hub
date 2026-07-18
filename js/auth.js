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

const loginBtn = document.getElementById("google-login-btn");
const statusEl = document.getElementById("login-status");

loginBtn.addEventListener("click", async () => {
  setLoading(true);
  try {
    const result = await signInWithPopup(auth, googleProvider);
    const user = result.user;
    const profile = await ensureUserProfile(user);
    if (profile.banned === true) {
      await signOut(auth);
      showStatus("This account has been blocked by an admin. Contact your school admin if you think this is a mistake.");
      setLoading(false);
      return;
    }
    window.location.href = "school-select.html";
  } catch (err) {
    console.error(err);
    showStatus(getFriendlyError(err.code));
    setLoading(false);
  }
});

// If already logged in, skip straight past login — but re-check banned status
// first, in case they were blocked after their last session started.
onAuthStateChanged(auth, async (user) => {
  if (user) {
    const snap = await getDoc(doc(db, "users", user.uid));
    if (snap.exists() && snap.data().banned === true) {
      await signOut(auth);
      showStatus("This account has been blocked by an admin. Contact your school admin if you think this is a mistake.");
      return;
    }
    window.location.href = "school-select.html";
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
      createdAt: serverTimestamp()
    };
    await setDoc(userRef, newProfile);
    return newProfile;
  }
  return existing.data();
}

function setLoading(isLoading) {
  loginBtn.disabled = isLoading;
  loginBtn.textContent = isLoading ? "Signing in…" : "Continue with Google";
}

function showStatus(message) {
  statusEl.textContent = message;
  statusEl.classList.add("visible");
}

function getFriendlyError(code) {
  switch (code) {
    case "auth/popup-closed-by-user":
      return "Sign-in was cancelled. Try again when you're ready.";
    case "auth/network-request-failed":
      return "Network issue — check your connection and try again.";
    default:
      return "Something went wrong signing in. Please try again.";
  }
}
