import { auth, db } from "./firebase-config.js";
import { onAuthStateChanged, signOut }
  from "https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js";
import {
  doc, getDoc, setDoc, deleteDoc, collection, addDoc, query, orderBy, getDocs, serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";
import { escapeHtml, dateIdOffset, formatDateLabel, typeBadgeHtml } from "./helpers.js";

const userPhoto   = document.getElementById("userPhoto");
const userNameEl  = document.getElementById("userName");
const classLabel  = document.getElementById("classLabel");
const loadingMsg  = document.getElementById("loadingMsg");
const hwList      = document.getElementById("hwList");
const emptyState  = document.getElementById("emptyState");
const signOutBtn  = document.getElementById("signOutBtn");
const addHwBtn    = document.getElementById("addHwBtn");

const addHwModal   = document.getElementById("addHwModal");
const addHwClose   = document.getElementById("addHwClose");
const hwSubjectSel = document.getElementById("hwSubject");
const hwDescription = document.getElementById("hwDescription");
const hwDueDate    = document.getElementById("hwDueDate");
const hwSubmit     = document.getElementById("hwSubmit");
const hwStatus     = document.getElementById("hwStatus");

// ---------- Upload feed tabs (Classwork Uploads / Homework Uploads) ----------
const tabButtons = document.querySelectorAll(".work-tab");
const panels = {
  assignments: document.getElementById("panel-assignments"),
  classwork:   document.getElementById("panel-classwork"),
  homework:    document.getElementById("panel-homework"),
};
const feedEls = {
  classwork: {
    loading: document.getElementById("classworkLoadingMsg"),
    feed:    document.getElementById("classworkFeed"),
    empty:   document.getElementById("classworkEmptyState"),
    loaded:  false,
  },
  homework: {
    loading: document.getElementById("homeworkLoadingMsg"),
    feed:    document.getElementById("homeworkFeed"),
    empty:   document.getElementById("homeworkEmptyState"),
    loaded:  false,
  },
};

let currentUser = null;
let currentProfile = null;
let subjects = [];

// Look back 14 days for the upload feeds — recent enough to be useful,
// small enough to stay fast (subjects × 14 reads, done in parallel).
const FEED_DAYS = Array.from({ length: 14 }, (_, i) => dateIdOffset(-(13 - i)));

signOutBtn.addEventListener("click", () => signOut(auth));

onAuthStateChanged(auth, async (user) => {
  if (!user) { window.location.href = "index.html"; return; }

  currentUser = user;
  userPhoto.src = user.photoURL || "";
  userNameEl.textContent = user.displayName || user.email;

  const snap = await getDoc(doc(db, "users", user.uid));
  if (!snap.exists()) { window.location.href = "school-select.html"; return; }
  currentProfile = snap.data();
  if (!currentProfile.schoolId || !currentProfile.classId) {
    window.location.href = "school-select.html";
    return;
  }

  classLabel.textContent = `Class ${currentProfile.classId}`;

  await loadSubjects();
  await loadHomework();
});

// ---------- Tab switching ----------
tabButtons.forEach((btn) => {
  btn.addEventListener("click", () => {
    const tab = btn.dataset.tab;
    tabButtons.forEach((b) => b.classList.toggle("active", b === btn));
    Object.entries(panels).forEach(([key, el]) => el.classList.toggle("active", key === tab));

    if ((tab === "classwork" || tab === "homework") && !feedEls[tab].loaded) {
      loadUploadFeed(tab);
    }
  });
});

// ---------- Assignments tracker (unchanged behaviour, existing feature) ----------
async function loadSubjects() {
  const { schoolId, classId } = currentProfile;
  const subjectsCol = collection(db, "schools", schoolId, "classes", classId, "subjects");
  const snap = await getDocs(query(subjectsCol, orderBy("name")));
  subjects = snap.docs.map((d) => ({ id: d.id, ...d.data() }));

  hwSubjectSel.innerHTML = subjects.length
    ? subjects.map((s) => `<option value="${s.id}">${escapeHtml(s.name)}</option>`).join("")
    : `<option value="">No subjects set up yet</option>`;
}

async function loadHomework() {
  const { schoolId, classId } = currentProfile;
  try {
    const hwCol = collection(db, "schools", schoolId, "classes", classId, "homework");
    const snap = await getDocs(query(hwCol, orderBy("dueDate", "asc")));
    loadingMsg.hidden = true;

    if (snap.empty) { emptyState.hidden = false; hwList.innerHTML = ""; return; }
    emptyState.hidden = true;

    const items = snap.docs.map((d) => ({ id: d.id, ...d.data() }));

    const completionSnaps = await Promise.all(
      items.map((item) =>
        getDoc(doc(db, "schools", schoolId, "classes", classId, "homework", item.id, "completedBy", currentUser.uid))
      )
    );

    hwList.innerHTML = "";
    const today = new Date().toISOString().slice(0, 10);

    items.forEach((item, i) => {
      const done = completionSnaps[i].exists();
      const overdue = !done && item.dueDate && item.dueDate < today;
      const subjectName = subjects.find((s) => s.id === item.subjectId)?.name || item.subjectId;

      const row = document.createElement("div");
      row.className = `hw-row ${done ? "done" : ""} ${overdue ? "overdue" : ""}`;
      row.innerHTML = `
        <button class="hw-checkbox ${done ? "checked" : ""}" data-id="${item.id}">${done ? "✓" : ""}</button>
        <div class="hw-body">
          <div class="hw-subject">${escapeHtml(subjectName)}</div>
          <div class="hw-desc">${escapeHtml(item.description || "")}</div>
          <div class="hw-meta ${overdue ? "overdue-text" : ""}">
            ${item.dueDate ? `Due ${item.dueDate}` : "No due date"}${overdue ? " · overdue" : ""}
          </div>
        </div>
      `;
      row.querySelector(".hw-checkbox").addEventListener("click", () => toggleComplete(item.id, done));
      hwList.appendChild(row);
    });
  } catch (err) {
    console.error(err);
    loadingMsg.hidden = false;
    loadingMsg.textContent = "Couldn't load homework — check your connection and refresh.";
  }
}

async function toggleComplete(hwId, currentlyDone) {
  const { schoolId, classId } = currentProfile;
  const ref = doc(db, "schools", schoolId, "classes", classId, "homework", hwId, "completedBy", currentUser.uid);
  try {
    if (currentlyDone) {
      await deleteDoc(ref);
    } else {
      await setDoc(ref, { completedAt: serverTimestamp() });
    }
    await loadHomework();
  } catch (err) {
    console.error(err);
  }
}

addHwBtn.addEventListener("click", () => {
  hwStatus.textContent = "";
  hwDescription.value = "";
  hwDueDate.value = "";
  addHwModal.hidden = false;
});
addHwClose.addEventListener("click", () => { addHwModal.hidden = true; });
addHwModal.addEventListener("click", (e) => { if (e.target === addHwModal) addHwModal.hidden = true; });

hwSubmit.addEventListener("click", async () => {
  const subjectId = hwSubjectSel.value;
  const description = hwDescription.value.trim();
  const dueDate = hwDueDate.value;

  if (!subjectId || !description) {
    hwStatus.textContent = "Pick a subject and add a description.";
    return;
  }

  hwSubmit.disabled = true;
  hwStatus.textContent = "Posting…";

  try {
    const { schoolId, classId } = currentProfile;
    const hwCol = collection(db, "schools", schoolId, "classes", classId, "homework");
    await addDoc(hwCol, {
      subjectId,
      description,
      dueDate: dueDate || null,
      createdBy: currentUser.uid,
      createdByName: currentUser.displayName || currentUser.email,
      createdAt: serverTimestamp(),
    });
    addHwModal.hidden = true;
    await loadHomework();
  } catch (err) {
    console.error(err);
    hwStatus.textContent = "Couldn't post — try again.";
  } finally {
    hwSubmit.disabled = false;
  }
});

// ---------- NEW: Classwork / Homework upload feeds ----------
// Scans every subject's entries for the last 14 days and pulls out the
// individual submissions tagged with the given type — this is what makes
// a photo upload tagged "Homework" on the Dashboard actually show up
// somewhere under Work, instead of only living on that subject's card.
async function loadUploadFeed(type) {
  const els = feedEls[type];
  const { schoolId, classId } = currentProfile;

  els.loading.hidden = false;
  els.empty.hidden = true;
  els.feed.innerHTML = "";

  try {
    if (subjects.length === 0) {
      els.loading.hidden = true;
      els.empty.hidden = false;
      els.loaded = true;
      return;
    }

    // Fetch every subject's entries for every day in the window, in parallel.
    const results = await Promise.all(
      subjects.flatMap((subject) =>
        FEED_DAYS.map((dateId) =>
          getDoc(doc(db, "schools", schoolId, "classes", classId, "subjects", subject.id, "entries", dateId))
            .then((snap) => ({ subject, dateId, snap }))
        )
      )
    );

    // Flatten into individual submissions matching this tab's type.
    const items = [];
    results.forEach(({ subject, dateId, snap }) => {
      if (!snap.exists()) return;
      const data = snap.data();
      (data.uploads || []).forEach((u) => {
        if (u.type === type) {
          items.push({ ...u, subjectName: subject.name, dateId });
        }
      });
    });

    // Newest first.
    items.sort((a, b) => (b.uploadedAt || "").localeCompare(a.uploadedAt || ""));

    els.loading.hidden = true;

    if (items.length === 0) {
      els.empty.hidden = false;
      els.loaded = true;
      return;
    }

    els.feed.innerHTML = items.map((item) => `
      <div class="upload-feed-item">
        <div class="upload-feed-head">
          <span class="upload-feed-subject">${escapeHtml(item.subjectName)}</span>
          ${typeBadgeHtml(item.type)}
        </div>
        <div class="upload-feed-meta">${escapeHtml(item.name || "Classmate")} · ${formatDateLabel(item.dateId)}</div>
        ${item.title ? `<div class="upload-group-title">"${escapeHtml(item.title)}"</div>` : ""}
        <div class="thumb-row">
          ${(item.photoURLs || []).map((url) =>
            `<a href="${url}" target="_blank" rel="noopener"><img src="${url}" class="thumb" /></a>`
          ).join("")}
        </div>
      </div>
    `).join("");

    els.loaded = true;
  } catch (err) {
    console.error(err);
    els.loading.hidden = false;
    els.loading.textContent = "Couldn't load uploads — check your connection and refresh.";
  }
}
