// school-select.js
// Handles: auth guard -> search/request school -> pick class & section -> save to user profile -> go to dashboard.
//
// ASSUMPTION (verify against your actual js/firebase-config.js from the login page):
// this file expects firebase-config.js to `export const auth` and `export const db`
// (the standard modular-SDK pattern: getAuth(app) and getFirestore(app)).
// If your config file exports different names, just change the two names in the
// import line below — nothing else needs to change.
import { auth, db } from "./firebase-config.js";

import { onAuthStateChanged, signOut }
  from "https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js";

import {
  doc, getDoc, setDoc, addDoc, collection, query, where, getDocs, serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";

import { APS_SCHOOLS } from "./schools-data.js";

// ---------- DOM refs ----------
const stepSchool      = document.getElementById("step-school");
const stepClass        = document.getElementById("step-class");
const loadingMsg       = document.getElementById("loadingMsg");

const userPhoto        = document.getElementById("userPhoto");
const userNameEl       = document.getElementById("userName");
const signOutBtn        = document.getElementById("signOutBtn");

const schoolSearch     = document.getElementById("schoolSearch");
const schoolResults    = document.getElementById("schoolResults");
const schoolEmptyMsg   = document.getElementById("schoolEmptyMsg");

const chosenSchoolLabel = document.getElementById("chosenSchoolLabel");
const classInput        = document.getElementById("classInput");
const sectionInput      = document.getElementById("sectionInput");
const classError        = document.getElementById("classError");
const backToSchool      = document.getElementById("backToSchool");
const saveClassBtn      = document.getElementById("saveClassBtn");

const addSchoolToggleBtn = document.getElementById("addSchoolToggleBtn");
const addSchoolForm      = document.getElementById("addSchoolForm");
const addSchoolCancelBtn = document.getElementById("addSchoolCancelBtn");
const addSchoolSubmitBtn = document.getElementById("addSchoolSubmitBtn");
const newSchoolName      = document.getElementById("newSchoolName");
const newSchoolCity      = document.getElementById("newSchoolCity");
const addSchoolStatus    = document.getElementById("addSchoolStatus");

// Every class gets these five seeded automatically the first time it's
// created, so students never have to manually add the basics — "+ Add
// subject" stays for anything extra (AI, Psychology, a specific elective).
const DEFAULT_SUBJECTS = [
  { id: "hindi", name: "Hindi" },
  { id: "english", name: "English" },
  { id: "science", name: "Science" },
  { id: "maths", name: "Maths" },
  { id: "social-science", name: "Social Science" },
];

// ---------- State ----------
let currentUser = null;
let allSchools = [];          // cached list of approved schools (fine at small scale)
let selectedSchool = null;    // { id, name, city }

// ---------- Auth guard ----------
// Same pattern as the rest of the site: no session -> back to login.
onAuthStateChanged(auth, (user) => {
  if (!user) {
    window.location.href = "index.html";
    return;
  }
  currentUser = user;
  userPhoto.src = user.photoURL || "";
  userNameEl.textContent = user.displayName || user.email;
  loadingMsg.hidden = true;
  init();
});

signOutBtn.addEventListener("click", () => signOut(auth));

// ---------- Init ----------
async function init() {
  // ?edit=1 means the student came from Settings → "Change school / class" —
  // in that case we deliberately do NOT auto-redirect to dashboard even
  // though they already have a schoolId/classId, since re-picking is the
  // whole point of that link.
  const isEditMode = new URLSearchParams(window.location.search).get("edit") === "1";

  // If the user already has a school+class saved (e.g. they navigated back here
  // by mistake), skip straight to dashboard instead of making them redo it —
  // unless they're here deliberately to change it (isEditMode).
  const userSnap = await getDoc(doc(db, "users", currentUser.uid));

  if (userSnap.exists() && userSnap.data().banned === true) {
    loadingMsg.hidden = false;
    loadingMsg.textContent = "This account has been blocked by an admin.";
    await signOut(auth);
    return;
  }

  if (userSnap.exists() && userSnap.data().classId && !isEditMode) {
    window.location.href = "dashboard.html";
    return;
  }

  if (isEditMode && userSnap.exists() && userSnap.data().classId) {
    // Small banner so it's clear this is a re-pick, not a fresh signup.
    const banner = document.createElement("p");
    banner.className = "edit-mode-banner";
    banner.textContent = `Currently enrolled in ${userSnap.data().schoolName || "your school"} · Class ${userSnap.data().classId}. Pick a new school/class below to switch — your XP, streak, and rank stay with your account.`;
    stepSchool.parentElement.insertBefore(banner, stepSchool);
  }

  await loadSchools();
  stepSchool.hidden = false;
}

// ---------- Step 1: search the fixed APS school list + any self-added ones ----------
async function loadSchools() {
  // Static list of ~132 APS schools is always available, no network needed.
  // On top of that, merge in any non-APS schools students have added
  // themselves — otherwise a second student from that same school would
  // never find it and would end up creating a duplicate.
  allSchools = APS_SCHOOLS.map(s => ({ ...s, fromAPS: true }));
  try {
    const q = query(collection(db, "schools"), where("isAPS", "==", false));
    const snap = await getDocs(q);
    snap.forEach((docSnap) => {
      const d = docSnap.data();
      allSchools.push({ id: docSnap.id, name: d.name, city: d.city || "", fromAPS: false });
    });
  } catch (err) {
    // Non-fatal — worst case, self-added schools just don't show up in search
    // this load and the student re-adds via the form below (harmless duplicate).
    console.error("Couldn't load self-added schools:", err);
  }
}

function renderResults(filterText) {
  const term = filterText.trim().toLowerCase();
  const matches = term
    ? allSchools.filter(s => s.name.toLowerCase().includes(term))
    : allSchools;

  schoolResults.innerHTML = "";
  matches.forEach(school => {
    const li = document.createElement("li");
    li.innerHTML = `<span>${school.name}</span>`;
    li.addEventListener("click", () => selectSchool(school));
    schoolResults.appendChild(li);
  });

  schoolEmptyMsg.hidden = matches.length > 0;
}

schoolSearch.addEventListener("input", (e) => renderResults(e.target.value));
renderResults(""); // show full scrollable list on load

function selectSchool(school) {
  selectedSchool = school;
  chosenSchoolLabel.textContent = school.name;
  stepSchool.hidden = true;
  stepClass.hidden = false;
}

backToSchool.addEventListener("click", () => {
  stepClass.hidden = true;
  stepSchool.hidden = false;
});

// ---------- Self-serve "Add your school" ----------
addSchoolToggleBtn.addEventListener("click", () => {
  addSchoolForm.hidden = false;
  addSchoolToggleBtn.hidden = true;
  newSchoolName.focus();
});
addSchoolCancelBtn.addEventListener("click", () => {
  addSchoolForm.hidden = true;
  addSchoolToggleBtn.hidden = false;
  addSchoolStatus.hidden = true;
  newSchoolName.value = "";
  newSchoolCity.value = "";
});

addSchoolSubmitBtn.addEventListener("click", async () => {
  const name = newSchoolName.value.trim();
  const city = newSchoolCity.value.trim();
  addSchoolStatus.hidden = true;

  if (!name) {
    addSchoolStatus.textContent = "Enter your school's name first.";
    addSchoolStatus.hidden = false;
    return;
  }

  // Duplicate guard — if a match already exists (APS or a school someone
  // else already self-added), just select that one instead of creating a
  // second copy that would fragment the class.
  const existingMatch = allSchools.find(s => s.name.toLowerCase() === name.toLowerCase());
  if (existingMatch) {
    addSchoolStatus.textContent = "";
    selectSchool(existingMatch);
    return;
  }

  addSchoolSubmitBtn.disabled = true;
  addSchoolStatus.hidden = false;
  addSchoolStatus.textContent = "Adding…";

  try {
    // Not gated behind approval — the student can carry on immediately.
    // status:"pending" + requestedBy* just makes it show up in the admin's
    // existing "Pending Schools" tab so they know it was added and can
    // review, edit, or remove it later; it doesn't block anyone.
    const newSchoolRef = await addDoc(collection(db, "schools"), {
      name,
      city: city || "",
      isAPS: false,
      status: "pending",
      requestedByUid: currentUser.uid,
      requestedByName: currentUser.displayName || "",
      requestedByEmail: currentUser.email || "",
      requestedAt: serverTimestamp(),
    });

    const newSchool = { id: newSchoolRef.id, name, city, fromAPS: false };
    allSchools.push(newSchool);
    selectSchool(newSchool);
  } catch (err) {
    console.error(err);
    addSchoolStatus.textContent = "Couldn't add it — check your connection and try again.";
    addSchoolSubmitBtn.disabled = false;
  }
});

// ---------- Step 2: class + section -> save ----------
// India's school year runs April-March, so July 2026 is session "2026-27".
// This just computes that automatically instead of asking the student.
function currentSession() {
  const now = new Date();
  const y = now.getMonth() >= 3 ? now.getFullYear() : now.getFullYear() - 1; // month 3 = April
  return `${y}-${String(y + 1).slice(2)}`;
}

saveClassBtn.addEventListener("click", async () => {
  classError.hidden = true;

  const classNum = classInput.value;
  const section = sectionInput.value.trim().toUpperCase();
  if (!classNum || !section) {
    classError.textContent = "Pick a class and enter a section.";
    classError.hidden = false;
    return;
  }

  saveClassBtn.disabled = true;
  const session = currentSession();
  const classId = `${classNum}-${section}`;

  try {
    // Only touch the school doc for the fixed APS list — a self-added school
    // was already created (with its own isAPS:false / status:"pending")
    // by the "Add your school" flow, so re-writing it here would clobber that.
    if (selectedSchool.fromAPS) {
      await setDoc(doc(db, "schools", selectedSchool.id), {
        name: selectedSchool.name,
        isAPS: true,
        status: "approved",
      }, { merge: true });
    }

    // Create the class doc if this is the first student joining it — otherwise leave it alone.
    const classRef = doc(db, "schools", selectedSchool.id, "classes", classId);
    const classSnap = await getDoc(classRef);
    const isBrandNewClass = !classSnap.exists();
    if (isBrandNewClass) {
      await setDoc(classRef, { name: classId, session, createdAt: serverTimestamp() });
    }

    // Save the student's profile — this is what init() checks next time to skip this flow.
    // isEditMode / existing-profile check matters here: merge:true only preserves fields
    // we DON'T include, so if we always included xp/streak/rank/joinedAt, switching class
    // via Settings would silently reset a student's progress to zero every time.
    const existingSnap = await getDoc(doc(db, "users", currentUser.uid));
    const isReEnrolment = existingSnap.exists() && existingSnap.data().xp !== undefined;

    const profileData = {
      name: currentUser.displayName || "",
      email: currentUser.email || "",
      photoURL: currentUser.photoURL || "",
      schoolId: selectedSchool.id,
      schoolName: selectedSchool.name,
      classId,
    };
    if (!isReEnrolment) {
      profileData.xp = 0;
      profileData.streak = 0;
      profileData.rank = "Bronze";
      profileData.joinedAt = serverTimestamp();
    }

    // Written BEFORE the default-subject seeding below (not after) — the
    // Firestore security rules check the student's OWN profile schoolId/
    // classId to authorize writing subjects into this class, so the profile
    // has to already reflect this class by the time that write happens.
    await setDoc(doc(db, "users", currentUser.uid), profileData, { merge: true });

    // Seed the standard subjects once, only for a class nobody has joined
    // before — never re-run for a class that already has its own subject list
    // (whether default or custom), so this can't stomp on anything.
    if (isBrandNewClass) {
      await Promise.all(DEFAULT_SUBJECTS.map(subj =>
        setDoc(
          doc(db, "schools", selectedSchool.id, "classes", classId, "subjects", subj.id),
          { name: subj.name, isDefault: true, createdAt: serverTimestamp() },
          { merge: true }
        )
      ));
    }

    window.location.href = "dashboard.html";
  } catch (err) {
    classError.textContent = "Couldn't save — try again.";
    classError.hidden = false;
    console.error(err);
    saveClassBtn.disabled = false;
  }
});
