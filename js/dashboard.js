import { auth, db, APPS_SCRIPT_URL } from "./firebase-config.js";
import { onAuthStateChanged, signOut }
  from "https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js";
import {
  doc, getDoc, collection, getDocs, query, orderBy, runTransaction, serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";
import {
  XP_UPLOAD, XP_FIRST_OF_DAY, XP_STREAK_TICK, calcRank,
  todayId, yesterdayId, formatDateLabel, escapeHtml
} from "./helpers.js";

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

const modal         = document.getElementById("uploadModal");
const modalSubject  = document.getElementById("modalSubjectName");
const modalDate     = document.getElementById("modalDate");
const modalExisting = document.getElementById("modalExisting");
const fileInput     = document.getElementById("fileInput");
const previewRow    = document.getElementById("previewRow");
const uploadSubmit  = document.getElementById("uploadSubmit");
const modalClose    = document.getElementById("modalClose");
const uploadStatus  = document.getElementById("uploadStatus");

let currentUser = null;
let currentProfile = null;
let activeSubject = null; // { id, name, entry }
let pendingFiles = [];
const TODAY = todayId();

signOutBtn.addEventListener("click", () => signOut(auth));
todayDate.textContent = formatDateLabel(TODAY);

onAuthStateChanged(auth, async (user) => {
  if (!user) { window.location.href = "index.html"; return; }

  currentUser = user;
  userPhoto.src = user.photoURL || "";
  userNameEl.textContent = user.displayName || user.email;

  const snap = await getDoc(doc(db, "users", user.uid));
  if (!snap.exists()) { window.location.href = "school-select.html"; return; }
  currentProfile = snap.data();

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
      emptyState.hidden = false;
      return;
    }

    subjectsGrid.innerHTML = "";

    // Fetch today's entry doc for every subject in parallel.
    const subjects = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    const entrySnaps = await Promise.all(
      subjects.map((s) =>
        getDoc(doc(db, "schools", schoolId, "classes", classId, "subjects", s.id, "entries", TODAY))
      )
    );

    subjects.forEach((subj, i) => {
      const entrySnap = entrySnaps[i];
      const entry = entrySnap.exists() ? entrySnap.data() : null;
      subjectsGrid.appendChild(renderSubjectCard(subj, entry));
    });
  } catch (err) {
    console.error(err);
    loadingMsg.hidden = false;
    loadingMsg.textContent = "Couldn't load your subjects — check your connection and refresh.";
  }
}

function renderSubjectCard(subject, entry) {
  const card = document.createElement("div");
  card.className = "subject-card";

  const uploaded = !!entry;
  const alreadyMine = uploaded && entry.uploadedBy?.includes(currentUser.uid);
  const uploaderCount = uploaded ? entry.uploadedBy.length : 0;

  card.innerHTML = `
    <div class="subject-name">${escapeHtml(subject.name)}</div>
    <div class="subject-teacher">${subject.teacher ? escapeHtml(subject.teacher) : "Teacher not set"}</div>
    ${uploaded
      ? `<span class="badge badge-green">✓ Uploaded by ${uploaderCount} classmate${uploaderCount > 1 ? "s" : ""}</span>`
      : `<span class="badge badge-cyan">No upload yet today</span>`}
    <div class="card-actions">
      <button class="btn btn-ghost btn-sm" data-action="view">${uploaded ? "View" : "Nothing yet"}</button>
      <button class="btn btn-primary btn-sm" data-action="upload" ${alreadyMine ? "disabled" : ""}>
        ${alreadyMine ? "Already added ✓" : uploaded ? "Add your photos" : "Upload"}
      </button>
    </div>
  `;

  const viewBtn = card.querySelector('[data-action="view"]');
  const uploadBtn = card.querySelector('[data-action="upload"]');

  if (!uploaded) viewBtn.disabled = true;
  viewBtn.addEventListener("click", () => openModal(subject, entry));
  if (!alreadyMine) uploadBtn.addEventListener("click", () => openModal(subject, entry));

  return card;
}

function openModal(subject, entry) {
  activeSubject = { id: subject.id, name: subject.name, entry };
  pendingFiles = [];
  fileInput.value = "";
  previewRow.innerHTML = "";
  uploadStatus.textContent = "";
  modalSubject.textContent = subject.name;
  modalDate.textContent = formatDateLabel(TODAY);

  if (entry) {
    const names = Object.values(entry.uploaderNames || {}).join(", ") || "classmates";
    modalExisting.hidden = false;
    modalExisting.innerHTML = `
      <p class="modal-existing-label">Already uploaded today by ${escapeHtml(names)}:</p>
      <div class="thumb-row">
        ${(entry.photoURLs || []).map((url) => `<a href="${url}" target="_blank" rel="noopener"><img src="${url}" class="thumb" /></a>`).join("")}
      </div>
    `;
  } else {
    modalExisting.hidden = true;
    modalExisting.innerHTML = "";
  }

  const alreadyMine = entry?.uploadedBy?.includes(currentUser.uid);
  uploadSubmit.disabled = !!alreadyMine;
  uploadSubmit.textContent = alreadyMine ? "You've already added photos today" : "Upload photos";

  modal.hidden = false;
}

function closeModal() {
  modal.hidden = true;
  activeSubject = null;
  pendingFiles = [];
}
modalClose.addEventListener("click", closeModal);
modal.addEventListener("click", (e) => { if (e.target === modal) closeModal(); });

fileInput.addEventListener("change", () => {
  pendingFiles = Array.from(fileInput.files || []).slice(0, 6); // cap at 6 photos per upload
  previewRow.innerHTML = "";
  pendingFiles.forEach((file) => {
    const img = document.createElement("img");
    img.className = "thumb thumb-preview";
    img.src = URL.createObjectURL(file);
    previewRow.appendChild(img);
  });
});

uploadSubmit.addEventListener("click", async () => {
  if (!activeSubject || pendingFiles.length === 0) {
    uploadStatus.textContent = "Pick at least one photo first.";
    return;
  }

  uploadSubmit.disabled = true;
  uploadStatus.textContent = "Uploading photos…";

  const { schoolId, classId } = currentProfile;
  const subjectId = activeSubject.id;

  try {
    // 1. Upload each file to Google Drive via Apps Script, collect download URLs.
    const urls = [];
    for (let i = 0; i < pendingFiles.length; i++) {
      const file = pendingFiles[i];
      uploadStatus.textContent = `Uploading photo ${i + 1}/${pendingFiles.length}…`;
      
      // Convert file to base64
      const base64 = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result.split(",")[1]);
        reader.onerror = reject;
        reader.readAsDataURL(file);
      });

      // Call Google Apps Script to upload to Drive
      const ext = (file.name.split(".").pop() || "jpg").toLowerCase();
      const fileName = `${currentUser.uid}_${Date.now()}_${i}.${ext}`;
      const response = await fetch(APPS_SCRIPT_URL, {
        method: "POST",
        body: JSON.stringify({
          fileName,
          fileData: base64,
          mimeType: file.type || "image/jpeg"
        })
      });

      const result = await response.json();
      if (!result.success) throw new Error(result.error || "Upload failed");
      urls.push(result.url);
    }

    uploadStatus.textContent = "Saving…";

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
