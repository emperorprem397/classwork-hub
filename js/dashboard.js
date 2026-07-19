import { auth, db } from "./firebase-config.js";
import { onAuthStateChanged, signOut }
  from "https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js";
import { doc, getDoc, collection, getDocs, query, orderBy }
  from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";

const userPhoto     = document.getElementById("userPhoto");
const userNameEl    = document.getElementById("userName");
const profilePhoto  = document.getElementById("profilePhoto");
const profileName   = document.getElementById("profileName");
const profileMeta   = document.getElementById("profileMeta");
const statXp        = document.getElementById("statXp");
const statRank      = document.getElementById("statRank");
const statStreak    = document.getElementById("statStreak");
const classLabel    = document.getElementById("classLabel");
const todayDate     = document.getElementById("todayDate");
const subjectsGrid  = document.getElementById("subjectsGrid");
const emptyState    = document.getElementById("emptyState");
const loadingMsg    = document.getElementById("loadingMsg");
const signOutBtn    = document.getElementById("signOutBtn");

signOutBtn.addEventListener("click", () => signOut(auth));

todayDate.textContent = new Date().toLocaleDateString(undefined, {
  weekday: "long", month: "long", day: "numeric"
});

onAuthStateChanged(auth, async (user) => {
  if (!user) {
    window.location.href = "index.html";
    return;
  }

  userPhoto.src = user.photoURL || "";
  userNameEl.textContent = user.displayName || user.email;

  const snap = await getDoc(doc(db, "users", user.uid));
  if (!snap.exists()) {
    window.location.href = "school-select.html";
    return;
  }
  const profile = snap.data();

  if (profile.banned === true) {
    await signOut(auth);
    alert("This account has been blocked by an admin. Contact your school admin if you think this is a mistake.");
    window.location.href = "index.html";
    return;
  }

  if (!profile.schoolId || !profile.classId) {
    window.location.href = "school-select.html";
    return;
  }

  renderProfile(user, profile);
  await loadSubjects(profile.schoolId, profile.classId, profile.schoolName || profile.schoolId);
});

function renderProfile(user, profile) {
  profilePhoto.src = user.photoURL || "";
  profileName.textContent = user.displayName || user.email;
  profileMeta.textContent = `${profile.schoolName || "Your school"} · Class ${profile.classId}`;
  statXp.textContent = profile.xp ?? 0;
  statRank.textContent = profile.rank || "Bronze";
  statStreak.textContent = profile.streak ?? 0;
  classLabel.textContent = `Class ${profile.classId}`;
}

async function loadSubjects(schoolId, classId, schoolLabel) {
  try {
    const subjectsCol = collection(db, "schools", schoolId, "classes", classId, "subjects");
    const snap = await getDocs(query(subjectsCol, orderBy("name")));

    loadingMsg.hidden = true;

    if (snap.empty) {
      emptyState.hidden = false;
      return;
    }

    subjectsGrid.innerHTML = "";
    snap.forEach((docSnap) => {
      const d = docSnap.data();
      const card = document.createElement("div");
      card.className = "subject-card";
      card.innerHTML = `
        <div class="subject-name">${escapeHtml(d.name)}</div>
        <div class="subject-teacher">${d.teacher ? escapeHtml(d.teacher) : "Teacher not set"}</div>
        <span class="badge badge-cyan">No upload yet today</span>
      `;
      subjectsGrid.appendChild(card);
    });
  } catch (err) {
    console.error(err);
    loadingMsg.textContent = "Couldn't load your subjects — check your connection and refresh.";
  }
}

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  }[c]));
}
