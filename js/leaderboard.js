import { auth, db } from "./firebase-config.js";
import { onAuthStateChanged, signOut }
  from "https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js";
import { doc, getDoc, collection, query, where, getDocs }
  from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";
import { escapeHtml } from "./helpers.js";

const userPhoto  = document.getElementById("userPhoto");
const userNameEl = document.getElementById("userName");
const classLabel = document.getElementById("classLabel");
const loadingMsg = document.getElementById("loadingMsg");
const lbList     = document.getElementById("lbList");
const emptyState = document.getElementById("emptyState");
const signOutBtn = document.getElementById("signOutBtn");

signOutBtn.addEventListener("click", () => signOut(auth));

onAuthStateChanged(auth, async (user) => {
  if (!user) { window.location.href = "index.html"; return; }

  userPhoto.src = user.photoURL || "";
  userNameEl.textContent = user.displayName || user.email;

  const snap = await getDoc(doc(db, "users", user.uid));
  if (!snap.exists()) { window.location.href = "school-select.html"; return; }
  const profile = snap.data();

  if (!profile.schoolId || !profile.classId) { window.location.href = "school-select.html"; return; }

  classLabel.textContent = `Class ${profile.classId}`;

  try {
    // Deliberately NOT using orderBy() here — two equality filters (schoolId,
    // classId) plus orderBy("xp") requires a manually-created Firestore
    // composite index, which is exactly why the leaderboard used to fail the
    // first time it ran on a fresh project. Fetching everyone in the class
    // (cheap — a class is at most a few dozen students) and sorting in the
    // browser avoids that requirement entirely, no console/index step needed.
    const usersCol = collection(db, "users");
    const q = query(
      usersCol,
      where("schoolId", "==", profile.schoolId),
      where("classId", "==", profile.classId)
    );
    const results = await getDocs(q);
    loadingMsg.hidden = true;

    // Every enrolled classmate shows up, even with 0 XP and zero uploads —
    // they just sort to the bottom. Banned accounts are excluded entirely.
    const students = results.docs
      .map((d) => ({ id: d.id, ...d.data() }))
      .filter((d) => d.banned !== true)
      .sort((a, b) => (b.xp ?? 0) - (a.xp ?? 0));

    if (students.length === 0) { emptyState.hidden = false; return; }

    lbList.innerHTML = "";
    students.forEach((d, i) => {
      const isMe = d.id === user.uid;
      const row = document.createElement("div");
      row.className = "lb-row" + (isMe ? " me" : "");
      row.innerHTML = `
        <div class="lb-pos">${i + 1}</div>
        <img class="lb-photo" src="${d.photoURL || ""}" alt="" />
        <div class="lb-info">
          <div class="lb-name">${escapeHtml(d.name || d.displayName || "Student")}${isMe ? " (you)" : ""}</div>
          <div class="lb-sub">${d.rank || "Bronze"} · 🔥 ${d.streak ?? 0} day streak</div>
        </div>
        <div class="lb-xp">
          <div class="lb-xp-num">${d.xp ?? 0}</div>
          <div class="lb-xp-label">XP</div>
        </div>
      `;
      lbList.appendChild(row);
    });
  } catch (err) {
    console.error(err);
    loadingMsg.hidden = false;
    loadingMsg.textContent = "Couldn't load the leaderboard — check your connection and refresh.";
  }
});
