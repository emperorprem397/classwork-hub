import { auth, db } from "./firebase-config.js";
import { onAuthStateChanged, signOut }
  from "https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js";
import { doc, getDoc }
  from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";
import { nextRankInfo } from "./helpers.js";

const userPhoto  = document.getElementById("userPhoto");
const userNameEl = document.getElementById("userName");
const classLabel = document.getElementById("classLabel");
const signOutBtn = document.getElementById("signOutBtn");

const heroPhoto  = document.getElementById("heroPhoto");
const heroName   = document.getElementById("heroName");
const heroMeta   = document.getElementById("heroMeta");
const statXp     = document.getElementById("statXp");
const statStreak = document.getElementById("statStreak");
const statUploads = document.getElementById("statUploads");
const rankCurrent = document.getElementById("rankCurrent");
const rankNext    = document.getElementById("rankNext");
const progressFill = document.getElementById("progressFill");

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

  heroPhoto.src = user.photoURL || "";
  heroName.textContent = user.displayName || user.email;
  heroMeta.textContent = `${profile.schoolName || "Your school"} · Class ${profile.classId}`;

  const xp = profile.xp || 0;
  statXp.textContent = xp;
  statStreak.textContent = profile.streak ?? 0;
  statUploads.textContent = profile.uploadCount ?? 0;

  const info = nextRankInfo(xp);
  rankCurrent.textContent = info.current;
  rankNext.textContent = info.next ? `${info.xpToNext} XP to ${info.next}` : "Top rank reached 🎉";
  progressFill.style.width = `${Math.round(info.progress * 100)}%`;
});
