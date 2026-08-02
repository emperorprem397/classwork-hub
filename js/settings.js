import { auth, db, CLOUDINARY_CLOUD_NAME, CLOUDINARY_UPLOAD_PRESET } from "./firebase-config.js";
import { onAuthStateChanged, signOut, updateProfile }
  from "https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js";
import {
  doc, getDoc, updateDoc, deleteDoc, collection, getDocs, addDoc, runTransaction, serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";
import { getStoredTheme, applyTheme, syncThemeFromCloud, saveThemeToCloud } from "./theme.js";
import { AVATAR_COLORS, generateLetterAvatarDataUri } from "./helpers.js";

const userPhoto     = document.getElementById("userPhoto");
const userNameEl    = document.getElementById("userName");
const signOutBtn    = document.getElementById("signOutBtn");
const signOutBtn2   = document.getElementById("signOutBtn2");

const settingsPhoto = document.getElementById("settingsPhoto");
const nameInput     = document.getElementById("nameInput");
const nameSaveBtn   = document.getElementById("nameSaveBtn");
const nameStatus    = document.getElementById("nameStatus");

const enrolmentSchool = document.getElementById("enrolmentSchool");
const enrolmentClass  = document.getElementById("enrolmentClass");
const accountEmail    = document.getElementById("accountEmail");

const notifyStatus = document.getElementById("notifyStatus");
const NOTIFY_KEYS = {
  notifyActivity: "activity",
  notifyUploads: "uploads",
  notifyHomework: "homework",
  notifyAnnouncements: "announcements",
  notifyLeaderboard: "leaderboard",
};

// Avatar picker
const googlePhotoPreview = document.getElementById("googlePhotoPreview");
const letterPreview      = document.getElementById("letterPreview");
const avatarFileInput    = document.getElementById("avatarFileInput");
const colorPickerRow     = document.getElementById("colorPickerRow");
const avatarStatus       = document.getElementById("avatarStatus");

// Contact admin
const whatsappContactLink = document.getElementById("whatsappContactLink");
const emailContactLink    = document.getElementById("emailContactLink");
const adminMsgInput       = document.getElementById("adminMsgInput");
const adminMsgSendBtn     = document.getElementById("adminMsgSendBtn");
const adminMsgStatus      = document.getElementById("adminMsgStatus");

// Danger zone
const startFreshBtn = document.getElementById("startFreshBtn");

signOutBtn.addEventListener("click", () => signOut(auth));
signOutBtn2.addEventListener("click", () => signOut(auth));

let currentUser = null;
let currentProfile = null;
let googleOriginalPhoto = "";
let chosenColor = AVATAR_COLORS[0];

// ---------- Tabs ----------
document.querySelectorAll(".work-tab").forEach((btn) => {
  btn.addEventListener("click", () => {
    const tab = btn.dataset.tab;
    document.querySelectorAll(".work-tab").forEach((b) => b.classList.toggle("active", b === btn));
    document.querySelectorAll(".work-panel").forEach((p) => p.classList.toggle("active", p.id === `panel-${tab}`));
  });
});

// ---------- Appearance ----------
function updateThemeSwatchUI() {
  const current = getStoredTheme();
  document.querySelectorAll("[data-theme-choice]").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.themeChoice === current);
  });
}
document.querySelectorAll("[data-theme-choice]").forEach((btn) => {
  btn.addEventListener("click", async () => {
    const themeId = btn.dataset.themeChoice;
    applyTheme(themeId);
    updateThemeSwatchUI();
    if (currentUser) {
      try { await saveThemeToCloud(db, currentUser.uid, themeId); }
      catch (err) { console.error("Couldn't save theme preference:", err); }
    }
  });
});
updateThemeSwatchUI();

// ---------- Notifications ----------
document.querySelectorAll('[id^="notify"]').forEach((checkbox) => {
  checkbox.addEventListener("change", saveNotificationPrefs);
});
async function saveNotificationPrefs() {
  if (!currentUser) return;
  const prefs = {};
  Object.entries(NOTIFY_KEYS).forEach(([elId, key]) => {
    prefs[key] = document.getElementById(elId).checked;
  });
  notifyStatus.textContent = "Saving…";
  try {
    await updateDoc(doc(db, "users", currentUser.uid), { notificationPrefs: prefs });
    notifyStatus.textContent = "Saved ✓";
  } catch (err) {
    console.error(err);
    notifyStatus.textContent = "Couldn't save — check your connection.";
  }
}

// ---------- Avatar picker ----------
function buildColorSwatches() {
  colorPickerRow.innerHTML = AVATAR_COLORS.map((c) =>
    `<button type="button" class="avatar-color-swatch" data-color="${c}" style="background:${c}"></button>`
  ).join("");
  colorPickerRow.querySelectorAll("[data-color]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      chosenColor = btn.dataset.color;
      colorPickerRow.querySelectorAll(".avatar-color-swatch").forEach((b) => b.classList.toggle("active", b === btn));
      renderLetterPreview();
      await saveAvatar(generateLetterAvatarDataUri(currentUser.displayName, chosenColor));
    });
  });
}
function renderLetterPreview() {
  const ch = (currentUser?.displayName || "?").trim().charAt(0).toUpperCase() || "?";
  letterPreview.textContent = ch;
  letterPreview.style.background = chosenColor;
}

document.querySelectorAll("[data-avatar-mode]").forEach((btn) => {
  btn.addEventListener("click", async () => {
    const mode = btn.dataset.avatarMode;
    document.querySelectorAll("[data-avatar-mode]").forEach((b) => b.classList.toggle("active", b === btn));
    colorPickerRow.hidden = mode !== "letter";

    if (mode === "google") {
      await saveAvatar(googleOriginalPhoto);
    } else if (mode === "upload") {
      avatarFileInput.click();
    } else if (mode === "letter") {
      await saveAvatar(generateLetterAvatarDataUri(currentUser.displayName, chosenColor));
    }
  });
});

avatarFileInput.addEventListener("change", async () => {
  const file = avatarFileInput.files?.[0];
  if (!file) return;

  avatarStatus.textContent = "Uploading…";
  try {
    const compressed = await compressImage(file, 512, 0.85);
    const formData = new FormData();
    formData.append("file", compressed);
    formData.append("upload_preset", CLOUDINARY_UPLOAD_PRESET);
    const response = await fetch(
      `https://api.cloudinary.com/v1_1/${CLOUDINARY_CLOUD_NAME}/image/upload`,
      { method: "POST", body: formData }
    );
    const result = await response.json();
    if (!result.secure_url) throw new Error(result.error?.message || "Upload failed");
    await saveAvatar(result.secure_url);
  } catch (err) {
    console.error(err);
    avatarStatus.textContent = "Couldn't upload that photo — check your connection and try again.";
  }
});

function compressImage(file, maxDimension = 512, quality = 0.85) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(url);
      let { width, height } = img;
      if (width > maxDimension || height > maxDimension) {
        const scale = maxDimension / Math.max(width, height);
        width = Math.round(width * scale);
        height = Math.round(height * scale);
      }
      const canvas = document.createElement("canvas");
      canvas.width = width; canvas.height = height;
      canvas.getContext("2d").drawImage(img, 0, 0, width, height);
      canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("Compression failed"))), "image/jpeg", quality);
    };
    img.onerror = reject;
    img.src = url;
  });
}

async function saveAvatar(photoURL) {
  avatarStatus.textContent = "Saving…";
  try {
    await updateProfile(currentUser, { photoURL });
    await updateDoc(doc(db, "users", currentUser.uid), { photoURL });
    userPhoto.src = photoURL || "";
    settingsPhoto.src = photoURL || "";
    avatarStatus.textContent = "Saved ✓";
  } catch (err) {
    console.error(err);
    avatarStatus.textContent = "Couldn't save — check your connection and try again.";
  }
}

// ---------- Contact admin ----------
const ADMIN_WHATSAPP = "917568521210"; // +91 75685 21210
const ADMIN_EMAIL = "emperorprem397@gmail.com";
whatsappContactLink.href = `https://wa.me/${ADMIN_WHATSAPP}?text=${encodeURIComponent("Hey, I'm a user of Classwork Hub and I wanted to reach out about ")}`;
emailContactLink.href = `mailto:${ADMIN_EMAIL}?subject=${encodeURIComponent("Classwork Hub — question/feedback")}`;

adminMsgSendBtn.addEventListener("click", async () => {
  const text = adminMsgInput.value.trim();
  if (!text) { adminMsgStatus.textContent = "Write something first."; return; }
  if (!currentUser) return;

  adminMsgSendBtn.disabled = true;
  adminMsgStatus.textContent = "Sending…";
  try {
    await addDoc(collection(db, "adminMessages"), {
      uid: currentUser.uid,
      name: currentUser.displayName || currentUser.email,
      email: currentUser.email || "",
      schoolId: currentProfile?.schoolId || null,
      classId: currentProfile?.classId || null,
      text: text.slice(0, 1000),
      read: false,
      createdAt: serverTimestamp(),
    });
    adminMsgInput.value = "";
    adminMsgStatus.textContent = "Sent — thanks! It'll show up in the admin panel.";
  } catch (err) {
    console.error(err);
    adminMsgStatus.textContent = "Couldn't send — check your connection and try again.";
  } finally {
    adminMsgSendBtn.disabled = false;
  }
});

// ---------- Danger zone: start fresh ----------
startFreshBtn.addEventListener("click", async () => {
  const proceed = confirm(
    "Start fresh? This resets your Classwork Hub profile — name, photo, school, class, XP and streak — back to zero. You'll set up your profile again next time you sign in. This can't be undone. Continue?"
  );
  if (!proceed) return;

  const deleteWork = confirm(
    "Also delete the work you've uploaded from the class? Click OK to remove it everywhere. Click Cancel to keep it visible to your classmates — it'll just disappear from your own My Uploads."
  );

  startFreshBtn.disabled = true;
  startFreshBtn.textContent = "Resetting…";

  try {
    await resetAccount(deleteWork);
    await signOut(auth);
    window.location.href = "index.html";
  } catch (err) {
    console.error(err);
    alert("Something went wrong resetting your account — check your connection and try again.");
    startFreshBtn.disabled = false;
    startFreshBtn.textContent = "Start fresh (reset my account)";
  }
});

async function resetAccount(deleteWork) {
  const { schoolId, classId } = currentProfile || {};

  if (schoolId && classId) {
    const uploadsCol = collection(db, "users", currentUser.uid, "myUploads");
    const snap = await getDocs(uploadsCol);
    for (const docSnap of snap.docs) {
      const d = docSnap.data();
      if (deleteWork && d.subjectId && d.date) {
        await removeMyContributionFromEntry(schoolId, classId, d.subjectId, d.date);
      }
      await deleteDoc(docSnap.ref);
    }
  }

  // Deleting the users/{uid} doc entirely is what actually makes this a
  // clean reset — auth.js's ensureUserProfile() creates a brand new one
  // (onboarded: false) the next time this same Google account signs in,
  // which is exactly what routes them back through the welcome wizard.
  await deleteDoc(doc(db, "users", currentUser.uid));
}

async function removeMyContributionFromEntry(schoolId, classId, subjectId, date) {
  const entryRef = doc(db, "schools", schoolId, "classes", classId, "subjects", subjectId, "entries", date);
  try {
    await runTransaction(db, async (tx) => {
      const entrySnap = await tx.get(entryRef);
      if (!entrySnap.exists()) return;
      const entryData = entrySnap.data();
      const remainingUploads = (entryData.uploads || []).filter((u) => u.uid !== currentUser.uid);
      const remainingUids = [...new Set(remainingUploads.map((u) => u.uid))];
      const remainingNames = {};
      remainingUploads.forEach((u) => { remainingNames[u.uid] = u.name; });
      const remainingPhotoURLs = remainingUploads.flatMap((u) => u.photoURLs || []);
      tx.update(entryRef, {
        uploads: remainingUploads,
        uploadedBy: remainingUids,
        uploaderNames: remainingNames,
        photoURLs: remainingPhotoURLs,
      });
    });
  } catch (err) {
    // Best-effort — one failed entry shouldn't block the rest of the reset.
    console.error(`Couldn't remove contribution for ${subjectId}/${date}:`, err);
  }
}

// ---------- Auth / load ----------
onAuthStateChanged(auth, async (user) => {
  if (!user) { window.location.href = "index.html"; return; }
  currentUser = user;

  // The provider's own photo (Google's), independent of whatever custom
  // photo we might have set via updateProfile() — this is what "Google
  // photo" in the avatar picker always reverts to.
  googleOriginalPhoto = user.providerData?.[0]?.photoURL || user.photoURL || "";

  userPhoto.src = user.photoURL || "";
  userNameEl.textContent = user.displayName || user.email;
  settingsPhoto.src = user.photoURL || "";
  googlePhotoPreview.src = googleOriginalPhoto;
  nameInput.value = user.displayName || "";
  accountEmail.textContent = user.email || "";
  buildColorSwatches();
  renderLetterPreview();

  const snap = await getDoc(doc(db, "users", user.uid));
  if (!snap.exists()) { window.location.href = "school-select.html"; return; }
  currentProfile = snap.data();

  if (!currentProfile.schoolId || !currentProfile.classId) { window.location.href = "school-select.html"; return; }

  enrolmentSchool.textContent = currentProfile.schoolName || "Your school";
  enrolmentClass.textContent = `Class ${currentProfile.classId}`;

  await syncThemeFromCloud(db, user.uid);
  updateThemeSwatchUI();

  if (currentProfile.notificationPrefs) {
    Object.entries(NOTIFY_KEYS).forEach(([elId, key]) => {
      if (currentProfile.notificationPrefs[key] !== undefined) {
        document.getElementById(elId).checked = currentProfile.notificationPrefs[key];
      }
    });
  }

  if (currentProfile.name !== user.displayName || currentProfile.photoURL !== user.photoURL) {
    updateDoc(doc(db, "users", user.uid), {
      name: user.displayName || currentProfile.name || "",
      photoURL: user.photoURL || "",
    }).catch((err) => console.error("Background profile sync failed:", err));
  }
});

nameSaveBtn.addEventListener("click", async () => {
  const newName = nameInput.value.trim();
  if (!newName) {
    nameStatus.textContent = "Name can't be empty.";
    return;
  }
  nameSaveBtn.disabled = true;
  nameStatus.textContent = "Saving…";

  try {
    await updateProfile(currentUser, { displayName: newName });
    await updateDoc(doc(db, "users", currentUser.uid), { name: newName });

    userNameEl.textContent = newName;
    renderLetterPreview();
    nameStatus.textContent = "Saved ✓";
  } catch (err) {
    console.error(err);
    nameStatus.textContent = "Couldn't save — check your connection and try again.";
  } finally {
    nameSaveBtn.disabled = false;
  }
});
