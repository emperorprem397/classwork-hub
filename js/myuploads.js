import { auth, db, CLOUDINARY_CLOUD_NAME, CLOUDINARY_UPLOAD_PRESET } from "./firebase-config.js";
import { onAuthStateChanged, signOut }
  from "https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js";
import {
  doc, getDoc, collection, query, orderBy, getDocs, runTransaction
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";
import {
  escapeHtml, formatDateLabel, typeBadgeHtml, logActivity,
  fileThumbHtml, uploadOneFile, isPdfFile
} from "./helpers.js";

const userPhoto   = document.getElementById("userPhoto");
const userNameEl  = document.getElementById("userName");
const loadingMsg  = document.getElementById("loadingMsg");
const uploadsList = document.getElementById("uploadsList");
const uploadsContainer = document.getElementById("uploadsContainer");
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
  uploadsContainer.hidden = false;
  uploadsList.innerHTML = "";

  try {
    const uploadsCol = collection(db, "users", currentUser.uid, "myUploads");
    const snap = await getDocs(query(uploadsCol, orderBy("date", "desc")));
    loadingMsg.hidden = true;

    if (snap.empty) { emptyState.hidden = false; uploadsContainer.hidden = true; return; }

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

  const records = d.uploads?.length ? d.uploads : [legacyRecordFrom(d)];
  const totalFiles = (d.photoURLs || []).length;
  const groupsHtml = records.map((u) => renderUploadGroup(u, d)).join("");

  row.innerHTML = `
    <div class="upload-row-head">
      <span>
        <span class="upload-subject">${escapeHtml(d.subjectName || d.subjectId)}</span>
        <span class="upload-count-badge">${totalFiles} file${totalFiles !== 1 ? "s" : ""}</span>
      </span>
      <span class="upload-date">${formatDateLabel(d.date)}</span>
    </div>
    ${groupsHtml}
  `;

  row.querySelectorAll("[data-delete-record]").forEach((btn) => {
    btn.addEventListener("click", () => handleDeleteRecord(btn.dataset.deleteRecord, d));
  });

  // Per-file management (delete one photo/PDF, replace it, reorder within
  // the same upload) — not available on legacy pre-PDF records, since those
  // only ever have a flat photoURLs list with nothing to individually key on.
  records.forEach((u) => {
    const deleteKey = u.id || `__legacy__${d.date}_${d.subjectId}`;
    if (!u.id) return; // legacy — whole-record delete above still works
    const items = u.files && u.files.length ? u.files : (u.photoURLs || []).map((url) => ({ url, isPdf: false }));
    const groupEl = row.querySelector(`.upload-group[data-record="${CSS.escape(deleteKey)}"]`);
    if (!groupEl) return;

    groupEl.querySelectorAll("[data-remove]").forEach((btn) => {
      btn.addEventListener("click", () => handleRemoveFile(deleteKey, Number(btn.dataset.remove), d, items));
    });
    groupEl.querySelectorAll("[data-move]").forEach((btn) => {
      const [idx, dir] = btn.dataset.move.split(":").map(Number);
      btn.addEventListener("click", () => handleMoveFile(deleteKey, idx, dir, d, items));
    });
    const replaceInput = groupEl.querySelector("[data-replace-input]");
    groupEl.querySelectorAll("[data-replace]").forEach((btn) => {
      btn.addEventListener("click", () => {
        replaceInput.dataset.forIdx = btn.dataset.replace;
        replaceInput.click();
      });
    });
    if (replaceInput) {
      replaceInput.addEventListener("change", () => {
        const file = replaceInput.files?.[0];
        replaceInput.value = "";
        if (!file) return;
        handleReplaceFile(deleteKey, Number(replaceInput.dataset.forIdx), file, d, items);
      });
    }
  });

  return row;
}

// Mirror docs created before the type/title/uploads-array format existed
// only have a flat photoURLs list — treat the whole doc as one "record"
// so the same whole-upload delete flow still works for it. No per-file id,
// so per-image controls aren't offered for these (see renderUploadRow).
function legacyRecordFrom(d) {
  return { id: null, uploadedAt: null, type: null, title: "", photoURLs: d.photoURLs || [] };
}

function renderUploadGroup(u, d) {
  const deleteKey = u.id || `__legacy__${d.date}_${d.subjectId}`;
  const items = u.files && u.files.length ? u.files : (u.photoURLs || []).map((url) => ({ url, isPdf: false }));
  const canManagePerFile = !!u.id;

  return `
    <div class="upload-group" data-record="${escapeHtml(deleteKey)}">
      <div class="upload-group-head">
        ${u.type || u.title ? typeBadgeHtml(u.type) : ""}
        ${u.title ? `<span class="upload-group-title">"${escapeHtml(u.title)}"</span>` : ""}
        <button class="upload-delete-btn" data-delete-record="${escapeHtml(deleteKey)}" title="Delete this whole upload">🗑️ Delete all</button>
      </div>
      <div class="thumb-row">
        ${items.map((item, idx) => `
          <div class="thumb-manage-wrap">
            ${fileThumbHtml(item)}
            ${canManagePerFile ? `
              <div class="thumb-manage-actions">
                ${idx > 0 ? `<button type="button" class="thumb-mini-btn" data-move="${idx}:-1" title="Move earlier">◀</button>` : ""}
                <button type="button" class="thumb-mini-btn" data-replace="${idx}" title="Replace this file">🔁</button>
                <button type="button" class="thumb-mini-btn" data-remove="${idx}" title="Remove this file">✕</button>
                ${idx < items.length - 1 ? `<button type="button" class="thumb-mini-btn" data-move="${idx}:1" title="Move later">▶</button>` : ""}
              </div>
            ` : ""}
          </div>
        `).join("")}
      </div>
      ${canManagePerFile ? `<input type="file" class="hidden-replace-input" data-replace-input hidden accept="image/*,application/pdf" />` : ""}
    </div>
  `;
}

// ---------- Per-file management (delete / replace / reorder one photo or
// PDF inside an existing upload, without deleting the whole submission) ----------
async function updateRecordFiles(deleteKey, newItems, myUploadDocData) {
  const { schoolId, classId } = currentProfile;
  const { date, subjectId, subjectName } = myUploadDocData;
  const entryRef = doc(db, "schools", schoolId, "classes", classId, "subjects", subjectId, "entries", date);
  const myUploadRef = doc(db, "users", currentUser.uid, "myUploads", `${date}_${subjectId}`);
  const wholeRecordRemoved = newItems.length === 0;

  try {
    await runTransaction(db, async (tx) => {
      const entrySnap = await tx.get(entryRef);
      const myUploadSnap = await tx.get(myUploadRef);
      if (!myUploadSnap.exists()) return;
      const myData = myUploadSnap.data();

      const applyToRecord = (u) => (u.id !== deleteKey ? u : { ...u, files: newItems, photoURLs: newItems.map((i) => i.url) });

      const remainingMyUploads = wholeRecordRemoved
        ? (myData.uploads || []).filter((u) => u.id !== deleteKey)
        : (myData.uploads || []).map(applyToRecord);
      const remainingMyPhotoURLs = remainingMyUploads.flatMap((u) => u.photoURLs || []);

      if (remainingMyUploads.length === 0) {
        tx.delete(myUploadRef);
      } else {
        tx.update(myUploadRef, { uploads: remainingMyUploads, photoURLs: remainingMyPhotoURLs });
      }

      if (entrySnap.exists()) {
        const entryData = entrySnap.data();
        const remainingEntryUploads = wholeRecordRemoved
          ? (entryData.uploads || []).filter((u) => u.id !== deleteKey)
          : (entryData.uploads || []).map(applyToRecord);
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

    if (wholeRecordRemoved) {
      logActivity(db, {
        schoolId, classId, uid: currentUser.uid,
        name: currentUser.displayName || currentUser.email,
        type: "upload_deleted", subjectName: subjectName || subjectId,
      });
    }
    await loadUploads();
  } catch (err) {
    console.error(err);
    alert("Couldn't update that upload — check your connection and try again.");
  }
}

function handleRemoveFile(deleteKey, idx, myUploadDocData, currentItems) {
  const newItems = currentItems.slice();
  newItems.splice(idx, 1);
  const confirmMsg = newItems.length === 0
    ? "This is the last file in this upload — remove it and delete the whole upload?"
    : "Remove this file from the upload? Can't be undone.";
  if (!confirm(confirmMsg)) return;
  updateRecordFiles(deleteKey, newItems, myUploadDocData);
}

function handleMoveFile(deleteKey, idx, direction, myUploadDocData, currentItems) {
  const newItems = currentItems.slice();
  const target = idx + direction;
  if (target < 0 || target >= newItems.length) return;
  [newItems[idx], newItems[target]] = [newItems[target], newItems[idx]];
  updateRecordFiles(deleteKey, newItems, myUploadDocData);
}

async function handleReplaceFile(deleteKey, idx, file, myUploadDocData, currentItems) {
  try {
    const pdf = isPdfFile(file);
    const uploaded = await uploadOneFile(file, CLOUDINARY_CLOUD_NAME, CLOUDINARY_UPLOAD_PRESET, pdf ? "pdfs" : "images");
    const newItems = currentItems.slice();
    newItems[idx] = uploaded;
    await updateRecordFiles(deleteKey, newItems, myUploadDocData);
  } catch (err) {
    console.error(err);
    alert("Couldn't upload the replacement — check your connection and try again.");
  }
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
