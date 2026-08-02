import { auth, db } from "./firebase-config.js";
import { onAuthStateChanged, signOut }
  from "https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js";
import {
  doc, getDoc, collection, query, orderBy, getDocs, runTransaction
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";
import { escapeHtml, formatDateLabel, typeBadgeHtml, logActivity } from "./helpers.js";

const userPhoto   = document.getElementById("userPhoto");
const userNameEl  = document.getElementById("userName");
const loadingMsg  = document.getElementById("loadingMsg");
const uploadsList = document.getElementById("uploadsList");
const emptyState  = document.getElementById("emptyState");
const signOutBtn  = document.getElementById("signOutBtn");

signOutBtn.addEventListener("click", () => signOut(auth));

let currentUser = null;
let currentProfile = null;

onAuthStateChanged(auth, async (user) => {
  if (!user) { window.location.href = "index.html"; return; }

  currentUser = user;
  userPhoto.src = user.photoURL || "";
  userNameEl.textContent = user.displayName || user.email;

  const profileSnap = await getDoc(doc(db, "users", user.uid));
  if (!profileSnap.exists()) { window.location.href = "school-select.html"; return; }
  currentProfile = profileSnap.data();
  if (!currentProfile.schoolId || !currentProfile.classId) {
    window.location.href = "school-select.html";
    return;
  }

  await loadUploads();
});

async function loadUploads() {
  loadingMsg.hidden = false;
  loadingMsg.textContent = "Loading your uploads…";
  emptyState.hidden = true;
  uploadsList.innerHTML = "";

  try {
    const uploadsCol = collection(db, "users", currentUser.uid, "myUploads");
    const snap = await getDocs(query(uploadsCol, orderBy("date", "desc")));
    loadingMsg.hidden = true;

    if (snap.empty) { emptyState.hidden = false; return; }

    snap.forEach((docSnap) => {
      const d = docSnap.data();
      uploadsList.appendChild(renderUploadRow(d));
    });
  } catch (err) {
    console.error(err);
    loadingMsg.hidden = false;
    loadingMsg.textContent = "Couldn't load your uploads — check your connection and refresh.";
  }
}

function renderUploadRow(d) {
  const row = document.createElement("div");
  row.className = "upload-row";

  const totalPhotos = (d.photoURLs || []).length;
  const groupsHtml = (d.uploads?.length ? d.uploads : [legacyRecordFrom(d)])
    .map((u) => renderUploadGroup(u, d))
    .join("");

  row.innerHTML = `
    <div class="upload-row-head">
      <span>
        <span class="upload-subject">${escapeHtml(d.subjectName || d.subjectId)}</span>
        <span class="upload-count-badge">${totalPhotos} photo${totalPhotos !== 1 ? "s" : ""}</span>
      </span>
      <span class="upload-date">${formatDateLabel(d.date)}</span>
    </div>
    ${groupsHtml}
  `;

  row.querySelectorAll("[data-delete-record]").forEach((btn) => {
    btn.addEventListener("click", () => handleDeleteRecord(btn.dataset.deleteRecord, d));
  });

  return row;
}

// Mirror docs created before the type/title/uploads-array format existed
// only have a flat photoURLs list — treat the whole doc as one "record"
// so the same delete flow still works for it.
function legacyRecordFrom(d) {
  return { id: null, uploadedAt: null, type: null, title: "", photoURLs: d.photoURLs || [] };
}

function renderUploadGroup(u, d) {
  // Legacy records (no id) can still be deleted — matched by the parent
  // mirror doc's own id instead of a record id — see handleDeleteRecord.
  const deleteKey = u.id || `__legacy__${d.date}_${d.subjectId}`;
  return `
    <div class="upload-group">
      <div class="upload-group-head">
        ${u.type || u.title ? typeBadgeHtml(u.type) : ""}
        ${u.title ? `<span class="upload-group-title">"${escapeHtml(u.title)}"</span>` : ""}
        <button class="upload-delete-btn" data-delete-record="${escapeHtml(deleteKey)}" title="Delete this upload">🗑️ Delete</button>
      </div>
      <div class="thumb-row">
        ${(u.photoURLs || []).map((url) =>
          `<a href="${url}" target="_blank" rel="noopener"><img src="${url}" class="thumb" /></a>`
        ).join("")}
      </div>
    </div>
  `;
}

async function handleDeleteRecord(deleteKey, myUploadDocData) {
  const confirmed = confirm(
    "Delete this upload? The photo(s) will be removed for the whole class, and can't be recovered. (Your XP for it is not clawed back.)"
  );
  if (!confirmed) return;

  const { schoolId, classId } = currentProfile;
  const { date, subjectId, subjectName } = myUploadDocData;
  const isLegacy = deleteKey.startsWith("__legacy__");

  const entryRef = doc(db, "schools", schoolId, "classes", classId, "subjects", subjectId, "entries", date);
  const myUploadRef = doc(db, "users", currentUser.uid, "myUploads", `${date}_${subjectId}`);

  try {
    await runTransaction(db, async (tx) => {
      const entrySnap = await tx.get(entryRef);
      const myUploadSnap = await tx.get(myUploadRef);
      if (!myUploadSnap.exists()) return;

      const myData = myUploadSnap.data();

      // ---- Update the private mirror doc ----
      let remainingMyUploads;
      if (isLegacy || !myData.uploads?.length) {
        remainingMyUploads = []; // legacy doc has exactly one implicit record — deleting it empties the doc
      } else {
        remainingMyUploads = myData.uploads.filter((u) => u.id !== deleteKey);
      }
      const remainingMyPhotoURLs = remainingMyUploads.flatMap((u) => u.photoURLs || []);

      if (remainingMyUploads.length === 0) {
        tx.delete(myUploadRef);
      } else {
        tx.update(myUploadRef, { uploads: remainingMyUploads, photoURLs: remainingMyPhotoURLs });
      }

      // ---- Update the shared class entry doc, if it still exists ----
      if (entrySnap.exists()) {
        const entryData = entrySnap.data();
        let remainingEntryUploads;
        if (isLegacy || !entryData.uploads?.length) {
          // Legacy entry docs (pre-uploads-array) can't be safely split per
          // record — fall back to removing this user's contribution entirely.
          remainingEntryUploads = (entryData.uploads || []).filter((u) => u.uid !== currentUser.uid);
        } else {
          remainingEntryUploads = entryData.uploads.filter((u) => u.id !== deleteKey);
        }

        const remainingUids = [...new Set(remainingEntryUploads.map((u) => u.uid))];
        const remainingNames = {};
        remainingEntryUploads.forEach((u) => { remainingNames[u.uid] = u.name; });
        const remainingPhotoURLs = remainingEntryUploads.flatMap((u) => u.photoURLs || []);

        tx.update(entryRef, {
          uploads: remainingEntryUploads,
          uploadedBy: remainingUids,
          uploaderNames: remainingNames,
          photoURLs: remainingPhotoURLs,
        });
      }
    });

    logActivity(db, {
      schoolId, classId,
      uid: currentUser.uid,
      name: currentUser.displayName || currentUser.email,
      type: "upload_deleted",
      subjectName: subjectName || subjectId,
    });

    await loadUploads();
  } catch (err) {
    console.error(err);
    alert("Couldn't delete that upload — check your connection and try again.");
  }
}
