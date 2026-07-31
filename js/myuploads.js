import { auth, db } from "./firebase-config.js";
import { onAuthStateChanged, signOut }
  from "https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js";
import { doc, getDoc, collection, query, orderBy, getDocs }
  from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";
import { escapeHtml, formatDateLabel, typeBadgeHtml } from "./helpers.js";

const userPhoto   = document.getElementById("userPhoto");
const userNameEl  = document.getElementById("userName");
const loadingMsg  = document.getElementById("loadingMsg");
const uploadsList = document.getElementById("uploadsList");
const emptyState  = document.getElementById("emptyState");
const signOutBtn  = document.getElementById("signOutBtn");

signOutBtn.addEventListener("click", () => signOut(auth));

onAuthStateChanged(auth, async (user) => {
  if (!user) { window.location.href = "index.html"; return; }

  userPhoto.src = user.photoURL || "";
  userNameEl.textContent = user.displayName || user.email;

  const profileSnap = await getDoc(doc(db, "users", user.uid));
  if (!profileSnap.exists()) { window.location.href = "school-select.html"; return; }
  if (!profileSnap.data().schoolId || !profileSnap.data().classId) {
    window.location.href = "school-select.html";
    return;
  }

  try {
    const uploadsCol = collection(db, "users", user.uid, "myUploads");
    const snap = await getDocs(query(uploadsCol, orderBy("date", "desc")));
    loadingMsg.hidden = true;

    if (snap.empty) { emptyState.hidden = false; return; }

    uploadsList.innerHTML = "";
    snap.forEach((docSnap) => {
      const d = docSnap.data();
      const row = document.createElement("div");
      row.className = "upload-row";

      if (d.uploads?.length) {
        // New-style mirror doc: show each submission's optional type/title
        // alongside its own photos.
        row.innerHTML = `
          <div class="upload-row-head">
            <span>
              <span class="upload-subject">${escapeHtml(d.subjectName || d.subjectId)}</span>
              <span class="upload-count-badge">${(d.photoURLs || []).length} photo${(d.photoURLs || []).length !== 1 ? "s" : ""}</span>
            </span>
            <span class="upload-date">${formatDateLabel(d.date)}</span>
          </div>
          ${d.uploads.map((u) => `
            <div class="upload-group">
              ${u.type || u.title ? `
                <div class="upload-group-head">
                  ${typeBadgeHtml(u.type)}
                </div>
                ${u.title ? `<div class="upload-group-title">"${escapeHtml(u.title)}"</div>` : ""}
              ` : ""}
              <div class="thumb-row">
                ${(u.photoURLs || []).map((url) =>
                  `<a href="${url}" target="_blank" rel="noopener"><img src="${url}" class="thumb" /></a>`
                ).join("")}
              </div>
            </div>
          `).join("")}
        `;
      } else {
        // Backward compatibility for mirror docs created before type/title existed.
        row.innerHTML = `
          <div class="upload-row-head">
            <span>
              <span class="upload-subject">${escapeHtml(d.subjectName || d.subjectId)}</span>
              <span class="upload-count-badge">${(d.photoURLs || []).length} photo${(d.photoURLs || []).length !== 1 ? "s" : ""}</span>
            </span>
            <span class="upload-date">${formatDateLabel(d.date)}</span>
          </div>
          <div class="thumb-row">
            ${(d.photoURLs || []).map((url) =>
              `<a href="${url}" target="_blank" rel="noopener"><img src="${url}" class="thumb" /></a>`
            ).join("")}
          </div>
        `;
      }
      uploadsList.appendChild(row);
    });
  } catch (err) {
    console.error(err);
    loadingMsg.hidden = false;
    loadingMsg.textContent = "Couldn't load your uploads — check your connection and refresh.";
  }
});
