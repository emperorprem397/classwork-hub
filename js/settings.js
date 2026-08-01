import { auth, db } from "./firebase-config.js";
import { onAuthStateChanged, signOut, updateProfile }
  from "https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js";
import { doc, getDoc, updateDoc }
  from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";

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

signOutBtn.addEventListener("click", () => signOut(auth));
signOutBtn2.addEventListener("click", () => signOut(auth));

let currentUser = null;

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
