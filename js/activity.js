import { auth, db } from "./firebase-config.js";
import { syncThemeFromCloud } from "./theme.js";
import { onAuthStateChanged, signOut }
  from "https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js";
import { doc, getDoc, collection, query, orderBy, limit, getDocs }
  from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";
import { escapeHtml, ACTIVITY_META, timeAgo } from "./helpers.js";

const userPhoto    = document.getElementById("userPhoto");
const userNameEl   = document.getElementById("userName");
const classLabel   = document.getElementById("classLabel");
const loadingMsg   = document.getElementById("loadingMsg");
const activityList = document.getElementById("activityList");
const emptyState   = document.getElementById("emptyState");
const signOutBtn   = document.getElementById("signOutBtn");
const refreshBtn   = document.getElementById("refreshBtn");

signOutBtn.addEventListener("click", () => signOut(auth));

let currentProfile = null;

onAuthStateChanged(auth, async (user) => {
  if (!user) { window.location.href = "index.html"; return; }

  userPhoto.src = user.photoURL || "";
  userNameEl.textContent = user.displayName || user.email;
  syncThemeFromCloud(db, user.uid);

  const snap = await getDoc(doc(db, "users", user.uid));
  if (!snap.exists()) { window.location.href = "school-select.html"; return; }
  currentProfile = snap.data();

  if (!currentProfile.schoolId || !currentProfile.classId) {
    window.location.href = "school-select.html";
    return;
  }

  classLabel.textContent = `Class ${currentProfile.classId}`;
  await loadActivity();
});

refreshBtn.addEventListener("click", loadActivity);

async function loadActivity() {
  loadingMsg.hidden = false;
  loadingMsg.textContent = "Loading activity…";
  emptyState.hidden = true;
  activityList.innerHTML = "";

  try {
    const { schoolId, classId } = currentProfile;
    const activityCol = collection(db, "schools", schoolId, "classes", classId, "activity");
    // Most recent 100 events — this is a rolling feed, not a full audit
    // trail archive, so there's no need to paginate further back than that.
    const snap = await getDocs(query(activityCol, orderBy("createdAt", "desc"), limit(100)));

    loadingMsg.hidden = true;

    if (snap.empty) {
      emptyState.hidden = false;
      return;
    }

    snap.docs.forEach((d) => {
      activityList.appendChild(renderActivityItem(d.data()));
    });
  } catch (err) {
    console.error(err);
    loadingMsg.hidden = false;
    loadingMsg.textContent = "Couldn't load activity — check your connection and refresh.";
  }
}

function renderActivityItem(item) {
  const meta = ACTIVITY_META[item.type] || { icon: "•", verb: "did something with" };
  const row = document.createElement("div");
  row.className = "activity-item glass";

  const when = item.createdAt?.toDate ? timeAgo(item.createdAt.toDate()) : "";

  row.innerHTML = `
    <span class="activity-icon">${meta.icon}</span>
    <div class="activity-body">
      <div class="activity-line">
        <b>${escapeHtml(item.actorName || "Classmate")}</b>
        ${meta.verb}
        <b>${escapeHtml(item.subjectName || "")}</b>
        ${item.detail ? escapeHtml(item.detail) : ""}
      </div>
      <div class="activity-time">${escapeHtml(when)}</div>
    </div>
  `;
  return row;
}
