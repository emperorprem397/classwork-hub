import { auth, db, CLOUDINARY_CLOUD_NAME, CLOUDINARY_UPLOAD_PRESET } from "./firebase-config.js";
import { syncThemeFromCloud } from "./theme.js";
import { onAuthStateChanged, signOut }
  from "https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js";
import {
  doc, getDoc, updateDoc, deleteDoc, collection, getDocs, addDoc, query, orderBy, where, limit, runTransaction, serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";
// NOTE: updateDoc above is reused for both the profile-sync background task
// and the new "edit subject" feature below — no new imports needed.
import {
  XP_UPLOAD, XP_FIRST_OF_DAY, XP_STREAK_TICK, calcRank,
  todayId, yesterdayId, formatDateLabel, escapeHtml, typeBadgeHtml, logActivity,
  uploadOneFile, fileThumbHtml, isPdfFile, getSubjectCoverImage
} from "./helpers.js";
import { openImageCropper } from "./cropper.js";
import { confirmDialog } from "./confirm-dialog.js";

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
const onboardingBanner  = document.getElementById("onboardingBanner");
const onboardingDismiss = document.getElementById("onboardingDismiss");

const modal         = document.getElementById("uploadModal");
const modalSubject  = document.getElementById("modalSubjectName");
const modalDate     = document.getElementById("modalDate");
const modalExisting = document.getElementById("modalExisting");
const typePillsWrap = document.getElementById("typePills");
const titleInput    = document.getElementById("titleInput");
const fileInput     = document.getElementById("fileInput");
const previewRow    = document.getElementById("previewRow");
const uploadSubmit  = document.getElementById("uploadSubmit");
const modalClose    = document.getElementById("modalClose");
const uploadStatus  = document.getElementById("uploadStatus");

const addSubjectBtn      = document.getElementById("addSubjectBtn");
const addSubjectBtnEmpty = document.getElementById("addSubjectBtnEmpty");
const addSubjectModal    = document.getElementById("addSubjectModal");
const addSubjectClose    = document.getElementById("addSubjectClose");
const subjectNameInput   = document.getElementById("subjectNameInput");
const subjectTeacherInput = document.getElementById("subjectTeacherInput");
const addSubjectSubmit   = document.getElementById("addSubjectSubmit");
const addSubjectStatus   = document.getElementById("addSubjectStatus");

const editSubjectModal    = document.getElementById("editSubjectModal");
const editSubjectClose    = document.getElementById("editSubjectClose");
const editSubjectNameInput = document.getElementById("editSubjectNameInput");
const editSubjectTeacherInput = document.getElementById("editSubjectTeacherInput");
const editSubjectSubmit   = document.getElementById("editSubjectSubmit");
const editSubjectStatus   = document.getElementById("editSubjectStatus");
const deleteSubjectBtn    = document.getElementById("deleteSubjectBtn");
let editingSubjectId = null;
let editingSubjectName = null;
let editingSubjectCoverURL = null;

// ---------- Cover photo pickers (Add + Edit subject modals) ----------
const addSubjectCoverBtn     = document.getElementById("addSubjectCoverBtn");
const addSubjectCoverInput   = document.getElementById("addSubjectCoverInput");
const addSubjectCoverPreview = document.getElementById("addSubjectCoverPreview");
const addSubjectCoverClear   = document.getElementById("addSubjectCoverClear");

const editSubjectCoverBtn     = document.getElementById("editSubjectCoverBtn");
const editSubjectCoverInput   = document.getElementById("editSubjectCoverInput");
const editSubjectCoverPreview = document.getElementById("editSubjectCoverPreview");
const editSubjectCoverClear   = document.getElementById("editSubjectCoverClear");

let pendingAddCoverBlob = null;   // cropped Blob queued for upload on "Add subject"
let pendingEditCoverBlob = null;  // cropped Blob queued for upload on "Save changes"
let editCoverRemoved = false;     // true once the person hits "Remove" in Edit — reverts to the default photo

async function uploadCoverBlob(blob) {
  const formData = new FormData();
  formData.append("file", blob, "cover.jpg");
  formData.append("upload_preset", CLOUDINARY_UPLOAD_PRESET);
  formData.append("folder", "subject-covers");
  const response = await fetch(
    `https://api.cloudinary.com/v1_1/${CLOUDINARY_CLOUD_NAME}/image/upload`,
    { method: "POST", body: formData }
  );
  const result = await response.json();
  if (!result.secure_url) throw new Error(result.error?.message || "Cover upload failed");
  return result.secure_url;
}

if (addSubjectCoverBtn) {
  addSubjectCoverBtn.addEventListener("click", () => addSubjectCoverInput.click());
  addSubjectCoverInput.addEventListener("change", async () => {
    const file = addSubjectCoverInput.files?.[0];
    addSubjectCoverInput.value = "";
    if (!file) return;
    const cropped = await openImageCropper(file, { shape: "square", outputSize: 640 });
    if (!cropped) return;
    pendingAddCoverBlob = cropped;
    addSubjectCoverPreview.style.backgroundImage = `url(${URL.createObjectURL(cropped)})`;
    addSubjectCoverClear.hidden = false;
  });
  addSubjectCoverClear.addEventListener("click", () => {
    pendingAddCoverBlob = null;
    addSubjectCoverPreview.style.backgroundImage = "";
    addSubjectCoverClear.hidden = true;
  });
}

if (editSubjectCoverBtn) {
  editSubjectCoverBtn.addEventListener("click", () => editSubjectCoverInput.click());
  editSubjectCoverInput.addEventListener("change", async () => {
    const file = editSubjectCoverInput.files?.[0];
    editSubjectCoverInput.value = "";
    if (!file) return;
    const cropped = await openImageCropper(file, { shape: "square", outputSize: 640 });
    if (!cropped) return;
    pendingEditCoverBlob = cropped;
    editCoverRemoved = false;
    editSubjectCoverPreview.style.backgroundImage = `url(${URL.createObjectURL(cropped)})`;
    editSubjectCoverClear.hidden = false;
  });
  editSubjectCoverClear.addEventListener("click", () => {
    pendingEditCoverBlob = null;
    editCoverRemoved = true;
    editSubjectCoverPreview.style.backgroundImage = `url(${getSubjectCoverImage(editingSubjectName)})`;
    editSubjectCoverClear.hidden = true;
  });
}

let currentUser = null;
let currentProfile = null;
let isAdminUser = false; // true when this signed-in account has role: "admin" on their own users/{uid} doc
let activeSubject = null; // { id, name, entry }
let pendingFiles = [];
let selectedType = null; // "classwork" | "homework" | null — fully optional
let loadedSubjects = []; // kept in sync by loadSubjects(), used for the duplicate-name check
const TODAY = todayId();

signOutBtn.addEventListener("click", () => signOut(auth));
todayDate.textContent = formatDateLabel(TODAY);

onAuthStateChanged(auth, async (user) => {
  if (!user) { window.location.href = "index.html"; return; }

  currentUser = user;
  userPhoto.src = user.photoURL || "";
  userNameEl.textContent = user.displayName || user.email;
  syncThemeFromCloud(db, user.uid); // fire-and-forget — picks up a theme set on another device

  const snap = await getDoc(doc(db, "users", user.uid));
  if (!snap.exists()) { window.location.href = "school-select.html"; return; }
  currentProfile = snap.data();
  isAdminUser = currentProfile.role === "admin";

  if (currentProfile.banned === true) {
    await signOut(auth);
    alert("This account has been blocked by an admin. Contact your school admin if you think this is a mistake.");
    window.location.href = "index.html";
    return;
  }

  if (!currentProfile.schoolId || !currentProfile.classId) {
    window.location.href = "school-select.html";
    return;
  }

  renderProfile();
  await loadSubjects();

  // Clears the "new activity" dot on the Dashboard sidebar item — best-effort,
  // never blocks the page if it fails.
  updateDoc(doc(db, "users", user.uid), { lastSeenUploads: serverTimestamp() })
    .catch((err) => console.error("lastSeenUploads sync failed:", err));

  // First-time onboarding banner — keyed by uid (not just a flat flag) so
  // it doesn't bleed across accounts on a shared device, and shown at most
  // once per account since it's just a one-time orientation, not a nag.
  const onboardingKey = `ch_onboarded_${user.uid}`;
  if (!localStorage.getItem(onboardingKey)) {
    onboardingBanner.hidden = false;
  }
  onboardingDismiss.addEventListener("click", () => {
    onboardingBanner.hidden = true;
    localStorage.setItem(onboardingKey, "1");
  });

  // Keep the Firestore mirror of name/photo in sync with the live Google
  // account — the leaderboard and admin panel read this stored copy (they
  // can't call the Firebase Auth API for other users), so without this a
  // name change made in Settings would never show up anywhere but your own
  // pages. Silent, fire-and-forget, runs at most once per session change.
  if (currentProfile.name !== user.displayName || currentProfile.photoURL !== user.photoURL) {
    updateDoc(doc(db, "users", user.uid), {
      name: user.displayName || currentProfile.name || "",
      photoURL: user.photoURL || "",
    }).catch((err) => console.error("Background profile sync failed:", err));
  }
});

function renderProfile() {
  profilePhoto.src = currentUser.photoURL || "";
  profileName.textContent = currentUser.displayName || currentUser.email;
  profileMeta.textContent = `${currentProfile.schoolName || "Your school"} · Class ${currentProfile.classId}`;
  statXp.textContent = currentProfile.xp ?? 0;
  statRank.textContent = currentProfile.rank || "Bronze";
  statStreak.textContent = currentProfile.streak ?? 0;
  classLabel.textContent = `Class ${currentProfile.classId}`;
}

async function loadSubjects() {
  const { schoolId, classId } = currentProfile;
  try {
    const subjectsCol = collection(db, "schools", schoolId, "classes", classId, "subjects");
    const snap = await getDocs(query(subjectsCol, orderBy("name")));

    loadingMsg.hidden = true;

    if (snap.empty) {
      loadedSubjects = [];
      emptyState.hidden = false;
      return;
    }

    subjectsGrid.innerHTML = "";

    // Fetch today's entry doc for every subject in parallel.
    const subjects = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    loadedSubjects = subjects;
    const entrySnaps = await Promise.all(
      subjects.map((s) =>
        getDoc(doc(db, "schools", schoolId, "classes", classId, "subjects", s.id, "entries", TODAY))
      )
    );

    // Which subjects had activity (an upload, etc.) since this person last
    // opened the dashboard — used to put a "new" glow on just those cards
    // instead of a single generic sidebar dot. Best-effort: any failure
    // here just means no cards glow this load, nothing else breaks.
    const newSubjectNames = await getRecentlyActiveSubjectNames();

    subjects.forEach((subj, i) => {
      const entrySnap = entrySnaps[i];
      const entry = entrySnap.exists() ? entrySnap.data() : null;
      subjectsGrid.appendChild(renderSubjectCard(subj, entry, newSubjectNames.has(subj.name)));
    });
  } catch (err) {
    console.error(err);
    loadingMsg.hidden = false;
    loadingMsg.textContent = "Couldn't load your subjects — check your connection and refresh.";
  }
}

async function getRecentlyActiveSubjectNames() {
  try {
    const { schoolId, classId } = currentProfile;
    const lastSeen = currentProfile.lastSeenUploads?.toDate
      ? currentProfile.lastSeenUploads.toDate()
      : new Date(0);
    const activityCol = collection(db, "schools", schoolId, "classes", classId, "activity");
    const q = query(activityCol, where("createdAt", ">", lastSeen), limit(25));
    const snap = await getDocs(q);
    return new Set(snap.docs.map((d) => d.data().subjectName).filter(Boolean));
  } catch (err) {
    console.error("Recent-activity check failed:", err);
    return new Set();
  }
}

// A deterministic emoji per subject (same subject always gets the same
// icon, no storage needed) — used by the Premium Showcase theme's popped
// icon-circle on each subject card. Purely cosmetic; every other theme
// ignores data-icon entirely.
const SUBJECT_ICONS = ["📘", "📗", "📙", "📕", "🧮", "🔬", "🎨", "🌍", "🎵", "⚗️", "📐", "🧪"];
function subjectIcon(name) {
  const str = String(name || "");
  let hash = 0;
  for (let i = 0; i < str.length; i++) hash = (hash * 31 + str.charCodeAt(i)) >>> 0;
  return SUBJECT_ICONS[hash % SUBJECT_ICONS.length];
}
// A per-subject two-tone cover gradient for the card's image strip — muted
// enough to sit quietly behind the floating icon in both Matte Dark and
// Soft Light. Deterministic (same subject → same cover) via the same hash
// as the icon. Stands in until real subject photography is wired up.
const SUBJECT_COVERS = [
  "linear-gradient(135deg, #3a3a3a, #1a1a1a)",
  "linear-gradient(135deg, #2d3a3a, #14211f)",
  "linear-gradient(135deg, #3a352d, #211c14)",
  "linear-gradient(135deg, #2d2d3a, #17171f)",
  "linear-gradient(135deg, #3a2d35, #21141c)",
  "linear-gradient(135deg, #303a2d, #1a2114)",
];
function subjectCover(name) {
  const str = String(name || "");
  let hash = 0;
  for (let i = 0; i < str.length; i++) hash = (hash * 17 + str.charCodeAt(i)) >>> 0;
  return SUBJECT_COVERS[hash % SUBJECT_COVERS.length];
}

function renderSubjectCard(subject, entry, isNew) {
  const card = document.createElement("div");
  card.className = "subject-card" + (isNew ? " subject-card--new" : "");
  card.dataset.icon = subjectIcon(subject.name);

  const uploaded = !!entry && (entry.uploadedBy?.length || 0) > 0;
  const uploaderCount = uploaded ? (entry.uploadedBy?.length || 0) : 0;
  const uploaderNames = uploaded ? Object.values(entry.uploaderNames || {}) : [];

  // If any submission today carries a title, surface the most recent one as
  // a small subtitle — gives absent students a hint of what's inside before
  // they even open it. Purely cosmetic; falls back to nothing if unset.
  const latest = uploaded && entry.uploads?.length ? entry.uploads[entry.uploads.length - 1] : null;

  const coverUrl = getSubjectCoverImage(subject.name, subject.coverURL);

  card.innerHTML = `
    <div class="subject-card-image" style="--subject-cover: ${subjectCover(subject.name)};">
      <img class="subject-card-photo" src="${coverUrl}" alt="" loading="lazy" onerror="this.remove()" />
    </div>
    <button class="subject-edit-btn" data-action="edit-subject" title="Edit subject">✎</button>
    <div class="subject-card-body">
      <div class="subject-card-head">
        <div class="subject-name">${escapeHtml(subject.name)}${isNew ? '<span class="badge badge-cyan subject-new-badge">New</span>' : ""}</div>
        <div class="subject-teacher">${subject.teacher ? escapeHtml(subject.teacher) : "Teacher not set"}</div>
      </div>
      ${uploaded
        ? `<span class="badge badge-green">✓ Uploaded by ${uploaderCount} classmate${uploaderCount > 1 ? "s" : ""}</span>`
        : `<span class="badge badge-cyan">No upload yet today</span>`}
      ${uploaderNames.length ? `<div class="subject-uploaders">${escapeHtml(uploaderNames.join(", "))}</div>` : ""}
      ${latest?.title ? `<div class="subject-last-title">"${escapeHtml(latest.title)}"</div>` : ""}
      <div class="card-actions">
        <button class="btn btn-ghost btn-sm" data-action="view">${uploaded ? "View" : "Nothing yet"}</button>
        <button class="btn btn-primary btn-sm" data-action="upload">
          ${uploaded ? "Add more photos" : "Upload"}
        </button>
      </div>
    </div>
  `;

  const viewBtn = card.querySelector('[data-action="view"]');
  const uploadBtn = card.querySelector('[data-action="upload"]');
  const editBtn = card.querySelector('[data-action="edit-subject"]');

  if (!uploaded) viewBtn.disabled = true;
  viewBtn.addEventListener("click", () => openModal(subject, entry));
  uploadBtn.addEventListener("click", () => openModal(subject, entry));
  editBtn.addEventListener("click", () => openEditSubjectModal(subject));

  return card;
}

// Type pills (Classwork / Homework) — mandatory as of this round: tapping
// a pill selects it and switches away from the other one, but tapping the
// already-selected pill no longer clears it back to null. The student must
// have one of the two selected before the upload button will proceed
// (enforced in the uploadSubmit handler below).
typePillsWrap.querySelectorAll(".type-pill").forEach((btn) => {
  btn.addEventListener("click", () => {
    typePillsWrap.querySelectorAll(".type-pill").forEach((b) => b.classList.remove("selected"));
    btn.classList.add("selected");
    selectedType = btn.dataset.type;
    typePillsWrap.classList.remove("pills-required-flash");
  });
});

function openModal(subject, entry) {
  activeSubject = { id: subject.id, name: subject.name, entry };
  pendingFiles = [];
  selectedType = null;
  fileInput.value = "";
  previewRow.innerHTML = "";
  uploadStatus.textContent = "";
  titleInput.value = "";
  typePillsWrap.querySelectorAll(".type-pill").forEach((b) => b.classList.remove("selected"));
  modalSubject.textContent = subject.name;
  modalDate.textContent = formatDateLabel(TODAY);

  if (entry && (entry.uploadedBy?.length || 0) > 0) {
    modalExisting.hidden = false;
    if (entry.uploads?.length) {
      // New-style entry: render each submission with its own type badge/title.
      modalExisting.innerHTML = `
        <p class="modal-existing-label">Already shared today:</p>
        ${entry.uploads.map((u) => `
          <div class="upload-group">
            <div class="upload-group-head">
              <span class="upload-group-name">${escapeHtml(u.name || "Classmate")}</span>
              ${typeBadgeHtml(u.type)}
              ${isAdminUser ? `<button class="upload-delete-btn" data-admin-delete="${escapeHtml(u.id || "")}" title="Delete this student's upload (admin)">🗑️ Delete</button>` : ""}
            </div>
            ${u.title ? `<div class="upload-group-title">"${escapeHtml(u.title)}"</div>` : ""}
            <div class="thumb-row">
              ${(u.files || (u.photoURLs || []).map((url) => ({ url, isPdf: false }))).map(fileThumbHtml).join("")}
            </div>
          </div>
        `).join("")}
      `;
      modalExisting.querySelectorAll("[data-admin-delete]").forEach((btn) => {
        btn.addEventListener("click", () => adminDeleteUploadRecord(subject.id, btn.dataset.adminDelete));
      });
    } else {
      // Backward compatibility for entries created before type/title existed.
      const names = Object.values(entry.uploaderNames || {}).join(", ") || "classmates";
      modalExisting.innerHTML = `
        <p class="modal-existing-label">Already uploaded today by ${escapeHtml(names)}:</p>
        <div class="thumb-row">
          ${(entry.photoURLs || []).map((url) => `<a href="${url}" target="_blank" rel="noopener"><img src="${url}" class="thumb" /></a>`).join("")}
        </div>
      `;
    }
  } else {
    modalExisting.hidden = true;
    modalExisting.innerHTML = "";
  }

  const alreadyMine = entry?.uploadedBy?.includes(currentUser.uid);
  uploadSubmit.disabled = false;
  uploadSubmit.textContent = alreadyMine ? "Add more photos" : "Upload photos";

  modal.hidden = false;
}

function closeModal() {
  modal.hidden = true;
  activeSubject = null;
  pendingFiles = [];
  selectedType = null;
}
modalClose.addEventListener("click", closeModal);

// Admin-only: remove any student's upload record straight from the "Already
// shared today" list, no need to go through their own My Uploads page.
async function adminDeleteUploadRecord(subjectId, recordId) {
  const confirmed = await confirmDialog({
    title: "Delete this upload?",
    detail: "This removes the student's upload record for today. This can't be undone.",
    confirmLabel: "Yes, delete upload",
  });
  if (!confirmed) return;
  const { schoolId, classId } = currentProfile;
  const entryRef = doc(db, "schools", schoolId, "classes", classId, "subjects", subjectId, "entries", TODAY);

  try {
    await runTransaction(db, async (tx) => {
      const entrySnap = await tx.get(entryRef);
      if (!entrySnap.exists()) return;
      const entryData = entrySnap.data();
      const remaining = (entryData.uploads || []).filter((u) => u.id !== recordId);
      const remainingUids = [...new Set(remaining.map((u) => u.uid))];
      const remainingNames = {};
      remaining.forEach((u) => { remainingNames[u.uid] = u.name; });
      const remainingPhotoURLs = remaining.flatMap((u) => u.photoURLs || []);
      tx.update(entryRef, {
        uploads: remaining,
        uploadedBy: remainingUids,
        uploaderNames: remainingNames,
        photoURLs: remainingPhotoURLs,
      });
    });

    logActivity(db, {
      schoolId, classId,
      uid: currentUser.uid,
      name: currentUser.displayName || currentUser.email,
      type: "upload_deleted",
      subjectName: activeSubject?.name || subjectId,
      detail: "(removed by admin)",
    });

    closeModal();
    await loadSubjects();
  } catch (err) {
    console.error(err);
    alert("Couldn't delete — check your connection and try again.");
  }
}
modal.addEventListener("click", (e) => { if (e.target === modal) closeModal(); });

// ---------- Add subject (self-service, no admin needed) ----------
function openAddSubjectModal() {
  subjectNameInput.value = "";
  subjectTeacherInput.value = "";
  addSubjectStatus.textContent = "";
  addSubjectSubmit.disabled = false;
  pendingAddCoverBlob = null;
  if (addSubjectCoverPreview) addSubjectCoverPreview.style.backgroundImage = "";
  if (addSubjectCoverClear) addSubjectCoverClear.hidden = true;
  addSubjectModal.hidden = false;
  subjectNameInput.focus();
}
function closeAddSubjectModal() {
  addSubjectModal.hidden = true;
}
addSubjectBtn.addEventListener("click", openAddSubjectModal);
addSubjectBtnEmpty.addEventListener("click", openAddSubjectModal);
addSubjectClose.addEventListener("click", closeAddSubjectModal);
addSubjectModal.addEventListener("click", (e) => { if (e.target === addSubjectModal) closeAddSubjectModal(); });

addSubjectSubmit.addEventListener("click", async () => {
  const name = subjectNameInput.value.trim();
  const teacher = subjectTeacherInput.value.trim();

  if (!name) {
    addSubjectStatus.textContent = "Give the subject a name first.";
    return;
  }
  // Light duplicate guard — case-insensitive check against what's already loaded.
  if (loadedSubjects.some((s) => (s.name || "").toLowerCase() === name.toLowerCase())) {
    addSubjectStatus.textContent = `"${name}" is already on your list.`;
    return;
  }

  addSubjectSubmit.disabled = true;
  addSubjectStatus.textContent = "Adding…";

  try {
    let coverURL = null;
    if (pendingAddCoverBlob) {
      addSubjectStatus.textContent = "Uploading cover photo…";
      coverURL = await uploadCoverBlob(pendingAddCoverBlob);
      addSubjectStatus.textContent = "Adding…";
    }

    const { schoolId, classId } = currentProfile;
    const subjectsCol = collection(db, "schools", schoolId, "classes", classId, "subjects");
    await addDoc(subjectsCol, {
      name,
      teacher: teacher || null,
      coverURL: coverURL || null,
      createdBy: currentUser.uid,
      createdAt: serverTimestamp(),
    });
    logActivity(db, {
      schoolId, classId,
      uid: currentUser.uid,
      name: currentUser.displayName || currentUser.email,
      type: "subject_created",
      subjectName: name,
    });
    closeAddSubjectModal();
    await loadSubjects();
  } catch (err) {
    console.error(err);
    addSubjectStatus.textContent = "Couldn't add it — check your connection and try again.";
    addSubjectSubmit.disabled = false;
  }
});

// ---------- Edit subject (any classmate — e.g. filling in a missing teacher name) ----------
function openEditSubjectModal(subject) {
  editingSubjectId = subject.id;
  editingSubjectName = subject.name || "";
  editingSubjectCoverURL = subject.coverURL || null;
  editSubjectNameInput.value = subject.name || "";
  editSubjectTeacherInput.value = subject.teacher || "";
  editSubjectStatus.textContent = "";
  editSubjectSubmit.disabled = false;
  if (deleteSubjectBtn) deleteSubjectBtn.disabled = false;

  pendingEditCoverBlob = null;
  editCoverRemoved = false;
  if (editSubjectCoverPreview) {
    editSubjectCoverPreview.style.backgroundImage = `url(${getSubjectCoverImage(subject.name, subject.coverURL)})`;
  }
  if (editSubjectCoverClear) editSubjectCoverClear.hidden = !subject.coverURL;

  editSubjectModal.hidden = false;
  editSubjectNameInput.focus();
}
function closeEditSubjectModal() {
  editSubjectModal.hidden = true;
  editingSubjectId = null;
  editingSubjectName = null;
  editingSubjectCoverURL = null;
}
editSubjectClose.addEventListener("click", closeEditSubjectModal);
editSubjectModal.addEventListener("click", (e) => { if (e.target === editSubjectModal) closeEditSubjectModal(); });

editSubjectSubmit.addEventListener("click", async () => {
  const name = editSubjectNameInput.value.trim();
  const teacher = editSubjectTeacherInput.value.trim();

  if (!name) {
    editSubjectStatus.textContent = "Subject name can't be empty.";
    return;
  }

  editSubjectSubmit.disabled = true;
  editSubjectStatus.textContent = "Saving…";

  try {
    let coverURL = editingSubjectCoverURL;
    if (pendingEditCoverBlob) {
      editSubjectStatus.textContent = "Uploading cover photo…";
      coverURL = await uploadCoverBlob(pendingEditCoverBlob);
      editSubjectStatus.textContent = "Saving…";
    } else if (editCoverRemoved) {
      coverURL = null;
    }

    const { schoolId, classId } = currentProfile;
    const subjectRef = doc(db, "schools", schoolId, "classes", classId, "subjects", editingSubjectId);
    await updateDoc(subjectRef, { name, teacher: teacher || null, coverURL: coverURL || null });
    logActivity(db, {
      schoolId, classId,
      uid: currentUser.uid,
      name: currentUser.displayName || currentUser.email,
      type: "subject_edited",
      subjectName: name,
    });
    closeEditSubjectModal();
    await loadSubjects();
  } catch (err) {
    console.error(err);
    editSubjectStatus.textContent = "Couldn't save — check your connection and try again.";
    editSubjectSubmit.disabled = false;
  }
});

// Delete a subject entirely — any classmate can do this now (not just
// admin), since every class has a different subject list and there's no
// reason a wrong/unwanted subject someone added should be stuck forever.
// A confirm() dialog is the only guard rail; there's no undo, so make that
// clear before it happens.
if (deleteSubjectBtn) {
  deleteSubjectBtn.addEventListener("click", async () => {
    if (!editingSubjectId) return;
    const confirmed = await confirmDialog({
      title: "Delete this subject?",
      detail: `This removes <b>${escapeHtml(editingSubjectName)}</b> and its whole upload history for the entire class. This can't be undone.`,
      confirmLabel: "Yes, delete subject",
    });
    if (!confirmed) return;

    deleteSubjectBtn.disabled = true;
    editSubjectSubmit.disabled = true;
    editSubjectStatus.textContent = "Deleting…";

    try {
      const { schoolId, classId } = currentProfile;
      const subjectRef = doc(db, "schools", schoolId, "classes", classId, "subjects", editingSubjectId);
      const deletedName = editingSubjectName;
      await deleteDoc(subjectRef);
      logActivity(db, {
        schoolId, classId,
        uid: currentUser.uid,
        name: currentUser.displayName || currentUser.email,
        type: "subject_deleted",
        subjectName: deletedName,
      });
      closeEditSubjectModal();
      await loadSubjects();
    } catch (err) {
      console.error(err);
      editSubjectStatus.textContent = "Couldn't delete — check your connection and try again.";
      deleteSubjectBtn.disabled = false;
      editSubjectSubmit.disabled = false;
    }
  });
}

function addPendingFiles(fileList) {
  // Append rather than replace. The <input type=file> always starts empty
  // when reopened, so picking photos one at a time (very common — snap one
  // page, tap "choose photos" again for the next) was silently wiping out
  // every photo picked in an earlier round instead of adding to it. This
  // was the "my first photo disappears when I pick a second one" bug.
  const newFiles = Array.from(fileList || []).filter(
    (f) => f.type.startsWith("image/") || isPdfFile(f)
  );
  pendingFiles = pendingFiles.concat(newFiles);
  renderPreviewRow();
}

fileInput.addEventListener("change", () => {
  addPendingFiles(fileInput.files);
  fileInput.value = ""; // reset so picking the exact same photo again still fires "change"
});

// Drag & drop straight onto the picker, in addition to the normal "choose
// files" click — same pendingFiles pipeline either way.
const fileDropZone = document.getElementById("fileDropZone");
if (fileDropZone) {
  ["dragenter", "dragover"].forEach((evt) =>
    fileDropZone.addEventListener(evt, (e) => {
      e.preventDefault();
      fileDropZone.classList.add("drag-over");
    })
  );
  ["dragleave", "drop"].forEach((evt) =>
    fileDropZone.addEventListener(evt, (e) => {
      e.preventDefault();
      fileDropZone.classList.remove("drag-over");
    })
  );
  fileDropZone.addEventListener("drop", (e) => {
    addPendingFiles(e.dataTransfer?.files);
  });
}

function renderPreviewRow() {
  previewRow.innerHTML = "";
  pendingFiles.forEach((file, idx) => {
    const wrap = document.createElement("div");
    wrap.className = "thumb-preview-wrap";

    let img;
    if (isPdfFile(file)) {
      img = document.createElement("div");
      img.className = "thumb thumb-preview thumb-pdf";
      img.title = file.name;
      const shortName = file.name.length > 16 ? file.name.slice(0, 13) + "…" : file.name;
      img.innerHTML = `📄<span class="thumb-pdf-name">${escapeHtml(shortName)}</span>`;
    } else {
      img = document.createElement("img");
      img.className = "thumb thumb-preview";
      img.src = URL.createObjectURL(file);
    }

    const removeBtn = document.createElement("button");
    removeBtn.type = "button";
    removeBtn.className = "thumb-remove-btn";
    removeBtn.setAttribute("aria-label", "Remove this photo");
    removeBtn.textContent = "✕";
    removeBtn.addEventListener("click", () => {
      pendingFiles.splice(idx, 1);
      renderPreviewRow();
    });

    wrap.appendChild(img);
    wrap.appendChild(removeBtn);
    previewRow.appendChild(wrap);
  });
}

uploadSubmit.addEventListener("click", async () => {
  if (!activeSubject || pendingFiles.length === 0) {
    uploadStatus.textContent = "Pick at least one photo first.";
    return;
  }
  if (!selectedType) {
    uploadStatus.textContent = "Please select Classwork or Homework before uploading.";
    typePillsWrap.classList.add("pills-required-flash");
    setTimeout(() => typePillsWrap.classList.remove("pills-required-flash"), 400);
    return;
  }

  uploadSubmit.disabled = true;
  uploadStatus.textContent = "Uploading photos…";

  const { schoolId, classId } = currentProfile;
  const subjectId = activeSubject.id;
  const title = titleInput.value.trim().slice(0, 80); // optional, capped for display sanity
  const type = selectedType; // now mandatory — "classwork" | "homework"

  try {
    // 1. Upload each file directly to Cloudinary (unsigned preset) — images
    //    are compressed first, PDFs go up as-is. No backend involved, the
    //    browser talks to Cloudinary's API directly either way.
    const urls = [];   // flat list of every URL (images + PDFs) — kept for
                        // backward compatibility with anything that only
                        // reads photoURLs (e.g. leaderboard-era code)
    const files = [];  // { url, isPdf, name } — used for correct rendering
    for (let i = 0; i < pendingFiles.length; i++) {
      const file = pendingFiles[i];
      const pdf = isPdfFile(file);
      uploadStatus.textContent = pdf
        ? `Uploading PDF ${i + 1}/${pendingFiles.length}…`
        : `Compressing & uploading photo ${i + 1}/${pendingFiles.length}…`;

      const uploaded = await uploadOneFile(
        file, CLOUDINARY_CLOUD_NAME, CLOUDINARY_UPLOAD_PRESET, pdf ? "pdfs" : "images"
      );
      urls.push(uploaded.url);
      files.push(uploaded);
    }

    uploadStatus.textContent = "Saving…";

    // This submission's own record — type/title are optional metadata, blank
    // string / null when the student skipped them. uploadedAt is a plain ISO
    // string (not serverTimestamp()) because Firestore doesn't allow the
    // serverTimestamp() sentinel inside array elements.
    const uploadRecord = {
      id: (crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}_${Math.random().toString(36).slice(2)}`),
      uid: currentUser.uid,
      name: currentUser.displayName || currentUser.email,
      type: type || null,
      title: title || "",
      photoURLs: urls,
      files: files,
      uploadedAt: new Date().toISOString(),
    };

    // 2. Transaction: update (or create) the entry doc + the user's XP/streak/rank
    //    + a private mirror record for the "My Uploads" history page.
    const entryRef = doc(db, "schools", schoolId, "classes", classId, "subjects", subjectId, "entries", TODAY);
    const userRef = doc(db, "users", currentUser.uid);
    const myUploadRef = doc(db, "users", currentUser.uid, "myUploads", `${TODAY}_${subjectId}`);

    await runTransaction(db, async (tx) => {
      const entrySnap = await tx.get(entryRef);
      const userSnap = await tx.get(userRef);
      const myUploadSnap = await tx.get(myUploadRef);
      const userData = userSnap.data();

      const isFirstForSubjectToday = !entrySnap.exists();
      let xpDelta = isFirstForSubjectToday ? (XP_UPLOAD + XP_FIRST_OF_DAY) : XP_UPLOAD;

      // Streak: only ticks once per day, on this user's first upload of the day
      // across ANY subject — not per-subject.
      const lastUploadDate = userData.lastUploadDate || null;
      let newStreak = userData.streak ?? 0;
      let newLastUploadDate = lastUploadDate;
      if (lastUploadDate !== TODAY) {
        newStreak = lastUploadDate === yesterdayId() ? newStreak + 1 : 1;
        newLastUploadDate = TODAY;
        xpDelta += XP_STREAK_TICK;
      }

      const newXp = (userData.xp || 0) + xpDelta;
      const newRank = calcRank(newXp);

      if (isFirstForSubjectToday) {
        tx.set(entryRef, {
          date: TODAY,
          subjectId,
          uploadedBy: [currentUser.uid],
          uploaderNames: { [currentUser.uid]: currentUser.displayName || currentUser.email },
          photoURLs: urls,
          uploads: [uploadRecord],
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
      } else {
        const existing = entrySnap.data();
        const alreadyIn = (existing.uploadedBy || []).includes(currentUser.uid);
        tx.update(entryRef, {
          uploadedBy: alreadyIn ? existing.uploadedBy : [...(existing.uploadedBy || []), currentUser.uid],
          uploaderNames: {
            ...(existing.uploaderNames || {}),
            [currentUser.uid]: currentUser.displayName || currentUser.email,
          },
          photoURLs: [...(existing.photoURLs || []), ...urls],
          uploads: [...(existing.uploads || []), uploadRecord],
          updatedAt: serverTimestamp(),
        });
      }

      tx.set(myUploadRef, {
        date: TODAY,
        subjectId,
        subjectName: activeSubject.name,
        photoURLs: myUploadSnap.exists()
          ? [...(myUploadSnap.data().photoURLs || []), ...urls]
          : urls,
        uploads: myUploadSnap.exists()
          ? [...(myUploadSnap.data().uploads || []), uploadRecord]
          : [uploadRecord],
        updatedAt: serverTimestamp(),
      }, { merge: true });

      tx.update(userRef, {
        xp: newXp,
        rank: newRank,
        streak: newStreak,
        lastUploadDate: newLastUploadDate,
        uploadCount: (userData.uploadCount || 0) + 1,
      });

      // Reflect locally so the header updates immediately without a reload.
      currentProfile.xp = newXp;
      currentProfile.rank = newRank;
      currentProfile.streak = newStreak;
      currentProfile.lastUploadDate = newLastUploadDate;
    });

    logActivity(db, {
      schoolId, classId,
      uid: currentUser.uid,
      name: currentUser.displayName || currentUser.email,
      type: "upload",
      subjectName: activeSubject.name,
      detail: type ? `(${type})` : "",
    });

    uploadStatus.textContent = "Done ✓";
    renderProfile();
    closeModal();
    await loadSubjects();
  } catch (err) {
    console.error(err);
    uploadStatus.textContent = "Upload failed — check your connection and try again.";
    uploadSubmit.disabled = false;
  }
});
