import { auth, db } from "./firebase-config.js";
import { onAuthStateChanged, signOut }
  from "https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js";
import { doc, getDoc, collection, query, where, orderBy, limit, getDocs }
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
    const usersCol = collection(db, "users");
    const q = query(
      usersCol,
      where("schoolId", "==", profile.schoolId),
      where("classId", "==", profile.classId),
      orderBy("xp", "desc"),
      limit(50)
    );
    const results = await getDocs(q);
    loadingMsg.hidden = true;

    if (results.empty) { emptyState.hidden = false; return; }

    lbList.innerHTML = "";
    let pos = 0;
    results.forEach((docSnap) => {
      pos++;
      const d = docSnap.data();
      if (d.banned === true) return; // skip banned users, don't count toward position display oddly
      const isMe = docSnap.id === user.uid;
      const row = document.createElement("div");
      row.className = "lb-row" + (isMe ? " me" : "");
      row.innerHTML = `
        <div class="lb-pos">${pos}</div>
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
    // Most likely cause: Firestore needs a composite index for this query
    // (schoolId ==, classId ==, xp desc). The console error usually contains
    // a direct link to auto-create it — check the browser console.
    loadingMsg.textContent = "Couldn't load the leaderboard. If this is the first time this page has run, check the browser console (F12) for a Firestore 'create index' link and click it.";
  }
});
