import { auth, db } from "./firebase-config.js";
import { onAuthStateChanged, signOut }
  from "https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js";
import { doc, getDoc, collection, getDocs, query, orderBy }
  from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";
import { escapeHtml, dateIdOffset, shortDayLabel, formatDateLabel, todayId, typeBadgeHtml } from "./helpers.js";

const userPhoto   = document.getElementById("userPhoto");
const userNameEl  = document.getElementById("userName");
const loadingMsg  = document.getElementById("loadingMsg");
const listEl      = document.getElementById("subjectsBrowseList");
const containerEl = document.getElementById("subjectsBrowseContainer");
const emptyState  = document.getElementById("emptyState");
const signOutBtn  = document.getElementById("signOutBtn");

const viewDayModal   = document.getElementById("viewDayModal");
const viewDayClose   = document.getElementById("viewDayClose");
const viewDaySubject = document.getElementById("viewDaySubject");
const viewDayDate    = document.getElementById("viewDayDate");
const viewDayBody    = document.getElementById("viewDayBody");

const TODAY = todayId();
// Last 30 days, oldest first, so the row reads left-to-right chronologically.
// (Widened from 7 -> 30 so older uploads stay easy to find, not just the
// most recent week — nothing is ever deleted, this just changes how far
// back the day-chip row looks.)
const WEEK = Array.from({ length: 30 }, (_, i) => dateIdOffset(-(29 - i)));

let currentProfile = null;

signOutBtn.addEventListener("click", () => signOut(auth));
viewDayClose.addEventListener("click", () => { viewDayModal.hidden = true; });
viewDayModal.addEventListener("click", (e) => { if (e.target === viewDayModal) viewDayModal.hidden = true; });

onAuthStateChanged(auth, async (user) => {
  if (!user) { window.location.href = "index.html"; return; }

  userPhoto.src = user.photoURL || "";
  userNameEl.textContent = user.displayName || user.email;

  const snap = await getDoc(doc(db, "users", user.uid));
  if (!snap.exists()) { window.location.href = "school-select.html"; return; }
  currentProfile = snap.data();
  if (!currentProfile.schoolId || !currentProfile.classId) {
    window.location.href = "school-select.html";
    return;
  }

  await loadSubjects();
});

async function loadSubjects() {
  const { schoolId, classId } = currentProfile;
  try {
    const subjectsCol = collection(db, "schools", schoolId, "classes", classId, "subjects");
    const snap = await getDocs(query(subjectsCol, orderBy("name")));
    loadingMsg.hidden = true;

    if (snap.empty) { emptyState.hidden = false; containerEl.hidden = true; return; }

    const subjects = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    listEl.innerHTML = "";

    for (const subject of subjects) {
      // Fetch all 7 days for this subject in parallel.
      const entrySnaps = await Promise.all(
        WEEK.map((dateId) =>
          getDoc(doc(db, "schools", schoolId, "classes", classId, "subjects", subject.id, "entries", dateId))
        )
      );
      listEl.appendChild(renderSubjectRow(subject, entrySnaps));
    }
  } catch (err) {
    console.error(err);
    loadingMsg.hidden = false;
    loadingMsg.textContent = "Couldn't load subjects — check your connection and refresh.";
  }
}

// Same deterministic per-subject icon as the Dashboard cards (js/dashboard.js)
// — small, inline duplicate rather than a shared import since this page has
// no other dependency on dashboard.js and the hash is tiny.
const SUBJECT_ICONS = ["📘", "📗", "📙", "📕", "🧮", "🔬", "🎨", "🌍", "🎵", "⚗️", "📐", "🧪"];
function subjectIcon(name) {
  const str = String(name || "");
  let hash = 0;
  for (let i = 0; i < str.length; i++) hash = (hash * 31 + str.charCodeAt(i)) >>> 0;
  return SUBJECT_ICONS[hash % SUBJECT_ICONS.length];
}

function renderSubjectRow(subject, entrySnaps) {
  const card = document.createElement("div");
  card.className = "subject-browse-card";

  const chips = WEEK.map((dateId, i) => {
    const entrySnap = entrySnaps[i];
    const hasEntry = entrySnap.exists();
    const isToday = dateId === TODAY;
    const classes = ["day-chip", hasEntry ? "has-entry" : "no-entry", isToday ? "is-today" : ""].join(" ");
    return `
      <div class="${classes}" data-date="${dateId}" data-has-entry="${hasEntry}">
        ${hasEntry ? '<span class="day-chip-dot"></span>' : ""}
        <span class="day-chip-label">${shortDayLabel(dateId)}</span>
      </div>
    `;
  }).join("");

  card.innerHTML = `
    <div class="subject-browse-head">
      <span class="subject-browse-icon">${subjectIcon(subject.name)}</span>
      <div class="subject-browse-name">${escapeHtml(subject.name)}</div>
    </div>
    <div class="day-chip-row">${chips}</div>
  `;

  card.querySelectorAll(".day-chip").forEach((chipEl, i) => {
    if (chipEl.dataset.hasEntry === "true") {
      chipEl.addEventListener("click", () => openViewModal(subject, WEEK[i], entrySnaps[i].data()));
    }
  });

  return card;
}

function openViewModal(subject, dateId, entryData) {
  viewDaySubject.textContent = subject.name;
  viewDayDate.textContent = formatDateLabel(dateId);

  if (entryData.uploads?.length) {
    // New-style entry: one block per submission, each with its own optional
    // type badge and title.
    viewDayBody.innerHTML = entryData.uploads.map((u) => `
      <div class="upload-group">
        <div class="upload-group-head">
          <span class="upload-group-name">${escapeHtml(u.name || "Classmate")}</span>
          ${typeBadgeHtml(u.type)}
        </div>
        ${u.title ? `<div class="upload-group-title">"${escapeHtml(u.title)}"</div>` : ""}
        <div class="thumb-row">
          ${(u.photoURLs || []).map((url) =>
            `<a href="${url}" target="_blank" rel="noopener"><img src="${url}" class="thumb" /></a>`
          ).join("")}
        </div>
      </div>
    `).join("");
  } else {
    // Backward compatibility for entries created before type/title existed.
    const names = Object.values(entryData.uploaderNames || {}).join(", ") || "classmates";
    viewDayBody.innerHTML = `
      <p class="modal-existing-label">Uploaded by ${escapeHtml(names)}:</p>
      <div class="thumb-row">
        ${(entryData.photoURLs || []).map((url) =>
          `<a href="${url}" target="_blank" rel="noopener"><img src="${url}" class="thumb" /></a>`
        ).join("")}
      </div>
    `;
  }
  viewDayModal.hidden = false;
}
