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
  collection, query, where, getDocs, addDoc,
  doc, getDoc, setDoc, serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";

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
const toggleRequestForm = document.getElementById("toggleRequestForm");
const requestSchoolForm = document.getElementById("requestSchoolForm");
const newSchoolName    = document.getElementById("newSchoolName");
const newSchoolCity    = document.getElementById("newSchoolCity");
const schoolError      = document.getElementById("schoolError");

const chosenSchoolLabel = document.getElementById("chosenSchoolLabel");
const classInput        = document.getElementById("classInput");
const sectionInput      = document.getElementById("sectionInput");
const classError        = document.getElementById("classError");
const backToSchool      = document.getElementById("backToSchool");
const saveClassBtn      = document.getElementById("saveClassBtn");

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
  // If the user already has a school+class saved (e.g. they navigated back here
  // by mistake), skip straight to dashboard instead of making them redo it.
  const userSnap = await getDoc(doc(db, "users", currentUser.uid));

  if (userSnap.exists() && userSnap.data().banned === true) {
    loadingMsg.hidden = false;
    loadingMsg.textContent = "This account has been blocked by an admin.";
    await signOut(auth);
    return;
  }

  if (userSnap.exists() && userSnap.data().classId) {
    window.location.href = "dashboard.html";
    return;
  }

  await loadSchools();
  stepSchool.hidden = false;
}

// ---------- Step 1: search / request school ----------
async function loadSchools() {
  const q = query(collection(db, "schools"), where("status", "==", "approved"));
  const snap = await getDocs(q);
  allSchools = snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

function renderResults(filterText) {
  const term = filterText.trim().toLowerCase();
  const matches = term
    ? allSchools.filter(s => s.name.toLowerCase().includes(term))
    : allSchools;

  schoolResults.innerHTML = "";
  matches.slice(0, 20).forEach(school => {
    const li = document.createElement("li");
    li.innerHTML = `<span>${school.name}</span><span class="school-city">${school.city || ""}</span>`;
    li.addEventListener("click", () => selectSchool(school));
    schoolResults.appendChild(li);
  });

  schoolEmptyMsg.hidden = matches.length > 0 || term === "";
}

schoolSearch.addEventListener("input", (e) => renderResults(e.target.value));
renderResults(""); // show all on load

toggleRequestForm.addEventListener("click", () => {
  requestSchoolForm.hidden = !requestSchoolForm.hidden;
});

requestSchoolForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  schoolError.hidden = true;

  const name = newSchoolName.value.trim();
  const city = newSchoolCity.value.trim();
  if (!name || !city) return;

  const submitBtn = requestSchoolForm.querySelector("button");
  submitBtn.disabled = true;

  try {
    // Now goes to "pending" — the admin panel exists, so new schools wait
    // for a quick review instead of auto-joining instantly.
    await addDoc(collection(db, "schools"), {
      name,
      city,
      status: "pending",
      requestedBy: currentUser.uid,
      requestedByName: currentUser.displayName || "",
      requestedByEmail: currentUser.email || "",
      createdAt: serverTimestamp(),
    });
    showPendingMessage(name);
  } catch (err) {
    schoolError.textContent = "Couldn't add school — try again.";
    schoolError.hidden = false;
    console.error(err);
  } finally {
    submitBtn.disabled = false;
  }
});

// Shown after a new-school request is submitted — replaces the search UI
// with a waiting message since the student can't proceed until an admin
// approves it. Built dynamically so no changes to school-select.html are needed.
function showPendingMessage(name) {
  schoolSearch.hidden = true;
  schoolResults.innerHTML = "";
  schoolEmptyMsg.hidden = true;
  toggleRequestForm.hidden = true;
  requestSchoolForm.hidden = true;

  if (document.getElementById("pendingMsg")) return; // don't duplicate on double-submit
  const pendingMsg = document.createElement("p");
  pendingMsg.id = "pendingMsg";
  pendingMsg.className = "sub";
  pendingMsg.style.marginTop = "16px";
  pendingMsg.textContent = `"${name}" was submitted and is waiting for admin approval — check back soon and it'll show up in search.`;
  stepSchool.appendChild(pendingMsg);
}

function selectSchool(school) {
  selectedSchool = school;
  chosenSchoolLabel.textContent = `${school.name}${school.city ? ", " + school.city : ""}`;
  stepSchool.hidden = true;
  stepClass.hidden = false;
}

backToSchool.addEventListener("click", () => {
  stepClass.hidden = true;
  stepSchool.hidden = false;
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
    // Create the class doc if this is the first student joining it — otherwise leave it alone.
    const classRef = doc(db, "schools", selectedSchool.id, "classes", classId);
    const classSnap = await getDoc(classRef);
    if (!classSnap.exists()) {
      await setDoc(classRef, { name: classId, session, createdAt: serverTimestamp() });
    }

    // Save the student's profile — this is what init() checks next time to skip this flow.
    await setDoc(doc(db, "users", currentUser.uid), {
      name: currentUser.displayName || "",
      email: currentUser.email || "",
      schoolId: selectedSchool.id,
      schoolName: selectedSchool.name,
      classId,
      xp: 0,
      streak: 0,
      rank: "Bronze",
      joinedAt: serverTimestamp(),
    }, { merge: true });

    window.location.href = "dashboard.html";
  } catch (err) {
    classError.textContent = "Couldn't save — try again.";
    classError.hidden = false;
    console.error(err);
    saveClassBtn.disabled = false;
  }
});
