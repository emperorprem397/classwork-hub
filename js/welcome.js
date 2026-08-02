import { auth, db, CLOUDINARY_CLOUD_NAME, CLOUDINARY_UPLOAD_PRESET } from "./firebase-config.js";
import { onAuthStateChanged, signOut, updateProfile }
  from "https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js";
import { doc, getDoc, updateDoc }
  from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";
import { applyTheme, saveThemeToCloud } from "./theme.js";
import { AVATAR_COLORS, generateLetterAvatarDataUri } from "./helpers.js";

const userPhoto  = document.getElementById("userPhoto");
const userNameEl = document.getElementById("userName");
const signOutBtn = document.getElementById("signOutBtn");

const steps = ["step-name", "step-appearance", "step-continue"];
const dots  = document.querySelectorAll(".wizard-dot");

const nameInput        = document.getElementById("nameInput");
const skipNameBtn      = document.getElementById("skipNameBtn");
const nextNameBtn      = document.getElementById("nextNameBtn");

const googlePhotoPreview = document.getElementById("googlePhotoPreview");
const letterPreview      = document.getElementById("letterPreview");
const avatarFileInput    = document.getElementById("avatarFileInput");
const avatarUploadStatus = document.getElementById("avatarUploadStatus");
const colorPickerRow     = document.getElementById("colorPickerRow");

const backAppearanceBtn = document.getElementById("backAppearanceBtn");
const skipAppearanceBtn = document.getElementById("skipAppearanceBtn");
const nextAppearanceBtn = document.getElementById("nextAppearanceBtn");

const backContinueBtn = document.getElementById("backContinueBtn");
const continueBtn     = document.getElementById("continueBtn");

signOutBtn.addEventListener("click", () => signOut(auth));

let currentUser = null;
let chosenName = "";
let chosenTheme = "dark";
let avatarMode = "google"; // "google" | "upload" | "letter"
let chosenPhotoURL = null; // set once "upload" finishes, or "letter" is picked
let chosenColor = AVATAR_COLORS[0];

onAuthStateChanged(auth, async (user) => {
  if (!user) { window.location.href = "index.html"; return; }
  currentUser = user;
  userPhoto.src = user.photoURL || "";
  userNameEl.textContent = user.displayName || user.email;

  const snap = await getDoc(doc(db, "users", user.uid));
  const profile = snap.exists() ? snap.data() : null;
  if (profile?.onboarded || profile?.schoolId) {
    window.location.href = "school-select.html";
    return;
  }

  chosenName = user.displayName || "";
  nameInput.value = chosenName;
  googlePhotoPreview.src = user.photoURL || "";
  renderLetterPreview();
  buildColorSwatches();
  goToStep(0);
});

function goToStep(idx) {
  steps.forEach((id, i) => { document.getElementById(id).hidden = i !== idx; });
  dots.forEach((dot, i) => {
    dot.classList.toggle("active", i === idx);
    dot.classList.toggle("done", i < idx);
  });
}

// ---------- Avatar picker ----------
function renderLetterPreview() {
  const ch = (nameInput.value || currentUser?.displayName || "?").trim().charAt(0).toUpperCase() || "?";
  letterPreview.textContent = ch;
  letterPreview.style.background = chosenColor;
}
nameInput.addEventListener("input", renderLetterPreview);

function buildColorSwatches() {
  colorPickerRow.innerHTML = AVATAR_COLORS.map((c, i) =>
    `<button type="button" class="avatar-color-swatch${i === 0 ? " active" : ""}" data-color="${c}" style="background:${c}"></button>`
  ).join("");
  colorPickerRow.querySelectorAll("[data-color]").forEach((btn) => {
    btn.addEventListener("click", () => {
      chosenColor = btn.dataset.color;
      colorPickerRow.querySelectorAll(".avatar-color-swatch").forEach((b) => b.classList.toggle("active", b === btn));
      renderLetterPreview();
    });
  });
}

document.querySelectorAll("[data-avatar-mode]").forEach((btn) => {
  btn.addEventListener("click", () => {
    avatarMode = btn.dataset.avatarMode;
    document.querySelectorAll("[data-avatar-mode]").forEach((b) => b.classList.toggle("active", b === btn));
    colorPickerRow.hidden = avatarMode !== "letter";
    avatarUploadStatus.textContent = "";
    if (avatarMode === "upload") avatarFileInput.click();
  });
});

avatarFileInput.addEventListener("change", async () => {
  const file = avatarFileInput.files?.[0];
  if (!file) { avatarMode = "google"; document.querySelector('[data-avatar-mode="google"]').click(); return; }

  avatarUploadStatus.textContent = "Uploading…";
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
    chosenPhotoURL = result.secure_url;
    avatarUploadStatus.textContent = "Photo ready ✓";
  } catch (err) {
    console.error(err);
    avatarUploadStatus.textContent = "Couldn't upload that photo — try a different one, or pick another option above.";
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

// ---------- Step 1: name ----------
nextNameBtn.addEventListener("click", () => {
  chosenName = nameInput.value.trim() || (currentUser.displayName || "");
  goToStep(1);
});
skipNameBtn.addEventListener("click", () => {
  chosenName = currentUser.displayName || "";
  goToStep(1);
});

// ---------- Step 2: appearance ----------
document.querySelectorAll("[data-theme-choice]").forEach((btn) => {
  btn.addEventListener("click", () => {
    chosenTheme = btn.dataset.themeChoice;
    document.querySelectorAll("[data-theme-choice]").forEach((b) => b.classList.toggle("active", b === btn));
    applyTheme(chosenTheme);
  });
});
backAppearanceBtn.addEventListener("click", () => goToStep(0));
nextAppearanceBtn.addEventListener("click", () => goToStep(2));
skipAppearanceBtn.addEventListener("click", () => {
  chosenTheme = "dark";
  applyTheme("dark");
  goToStep(2);
});

// ---------- Step 3: continue (mandatory) ----------
backContinueBtn.addEventListener("click", () => goToStep(1));
continueBtn.addEventListener("click", async () => {
  continueBtn.disabled = true;
  continueBtn.textContent = "Saving…";

  try {
    const userRef = doc(db, "users", currentUser.uid);
    const updates = { onboarded: true };

    if (chosenName && chosenName !== currentUser.displayName) {
      updates.name = chosenName;
    }

    let finalPhotoURL = null;
    if (avatarMode === "upload" && chosenPhotoURL) finalPhotoURL = chosenPhotoURL;
    if (avatarMode === "letter") finalPhotoURL = generateLetterAvatarDataUri(chosenName || currentUser.displayName, chosenColor);

    if (finalPhotoURL) {
      updates.photoURL = finalPhotoURL;
      try { await updateProfile(currentUser, { photoURL: finalPhotoURL }); } catch (e) { console.error(e); }
    }
    if (updates.name) {
      try { await updateProfile(currentUser, { displayName: updates.name }); } catch (e) { console.error(e); }
    }

    await updateDoc(userRef, updates);
    if (chosenTheme !== "dark") {
      await saveThemeToCloud(db, currentUser.uid, chosenTheme);
    }
  } catch (err) {
    console.error(err);
    // Don't block getting into the app over a profile-save hiccup — every
    // one of these can still be fixed later from Settings.
  }

  window.location.href = "school-select.html";
});
