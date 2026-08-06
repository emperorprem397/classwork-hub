import { auth, db, CLOUDINARY_CLOUD_NAME, CLOUDINARY_UPLOAD_PRESET } from "./firebase-config.js";
import { syncThemeFromCloud } from "./theme.js";
import { onAuthStateChanged, signOut }
  from "https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js";
import {
  doc, getDoc, setDoc, updateDoc, deleteDoc, collection, getDocs, addDoc, query, orderBy, where, limit, runTransaction, serverTimestamp
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
const coverflowPrevBtn = document.getElementById("coverflowPrev");
const coverflowNextBtn = document.getElementById("coverflowNext");
const emptyState    = document.getElementById("emptyState");
const loadingMsg    = document.getElementById("loadingMsg");

// ---------- Hero banner ----------
const heroSection    = document.getElementById("dashboardHero");
const heroImage      = document.getElementById("heroImage");
const heroTextWrap   = document.getElementById("heroTextWrap");
const heroTagline    = document.getElementById("heroTagline");
const editHeroBtn    = document.getElementById("editHeroBtn");
const editHeroModal  = document.getElementById("editHeroModal");
const editHeroClose  = document.getElementById("editHeroClose");
const heroTaglineInput = document.getElementById("heroTaglineInput");
const heroFontSelect   = document.getElementById("heroFontSelect");
const heroAlignRow     = document.getElementById("heroAlignRow");
const heroCoverPreview = document.getElementById("heroCoverPreview");
const heroCoverBtn     = document.getElementById("heroCoverBtn");
const heroCoverClear   = document.getElementById("heroCoverClear");
const heroCoverInput   = document.getElementById("heroCoverInput");
const editHeroSubmit   = document.getElementById("editHeroSubmit");
const editHeroStatus   = document.getElementById("editHeroStatus");

const HERO_FONTS = {
  zilla:    "'Zilla Slab', serif",
  playfair: "'Playfair Display', serif",
  dmserif:  "'DM Serif Display', serif",
  grotesk:  "'Space Grotesk', sans-serif",
  caveat:   "'Caveat', cursive",
};
const HERO_DEFAULT_TAGLINE = "By students, for students.";
const HERO_DEFAULT_IMAGE = "https://images.unsplash.com/photo-1497633762265-9d179a990aa6?w=1600&h=600&fit=crop&q=80";
let heroData = { tagline: HERO_DEFAULT_TAGLINE, font: "zilla", align: "left", coverURL: null };
let pendingHeroCoverBlob = null;
let heroCoverRemoved = false;

function heroDocRef() {
  const { schoolId, classId } = currentProfile;
  return doc(db, "schools", schoolId, "classes", classId, "meta", "hero");
}

async function loadHero() {
  try {
    const snap = await getDoc(heroDocRef());
    if (snap.exists()) heroData = { ...heroData, ...snap.data() };
    renderHero();
  } catch (err) {
    console.error("Hero load failed, using defaults:", err);
    try { renderHero(); } catch (_) { /* give up quietly — defaults were already assigned */ }
  }
}

function renderHero() {
  // Defensive: earlier rounds had this <img> ship with src="" plus an
  // inline onerror="this.remove()" in the HTML — an empty src fires the
  // browser's error event immediately during page parse, which ran BEFORE
  // this module's getElementById() call, so heroImage was already null by
  // the time any of this code ran (that was the "Cannot set properties of
  // null (setting 'src')" crash). The <img> no longer has src="" or an
  // inline onerror, but we still guard here + attach the fallback in JS so
  // a bad/expired photo URL degrades to the default image (and ultimately
  // to the plain gradient) instead of ever crashing or vanishing again.
  if (!heroImage) return;
  heroImage.onerror = () => {
    if (heroImage.src !== HERO_DEFAULT_IMAGE) {
      heroImage.onerror = () => { heroImage.style.display = "none"; };
      heroImage.src = HERO_DEFAULT_IMAGE;
    } else {
      heroImage.style.display = "none"; // gradient background shows through
    }
  };
  heroImage.style.display = "";
  heroImage.src = heroData.coverURL || HERO_DEFAULT_IMAGE;
  heroTagline.textContent = heroData.tagline || HERO_DEFAULT_TAGLINE;
  heroTagline.style.fontFamily = HERO_FONTS[heroData.font] || HERO_FONTS.zilla;
  heroTextWrap.dataset.align = heroData.align || "left";
}

function openEditHeroModal() {
  heroTaglineInput.value = heroData.tagline || HERO_DEFAULT_TAGLINE;
  heroFontSelect.value = heroData.font || "zilla";
  heroAlignRow.querySelectorAll(".hero-align-btn").forEach((b) =>
    b.classList.toggle("active", b.dataset.align === (heroData.align || "left"))
  );
  pendingHeroCoverBlob = null;
  heroCoverRemoved = false;
  heroCoverPreview.style.backgroundImage = `url(${heroData.coverURL || HERO_DEFAULT_IMAGE})`;
  heroCoverClear.hidden = !heroData.coverURL;
  editHeroStatus.textContent = "";
  editHeroModal.hidden = false;
}
function closeEditHeroModal() { editHeroModal.hidden = true; }

editHeroBtn.addEventListener("click", openEditHeroModal);
editHeroClose.addEventListener("click", closeEditHeroModal);
editHeroModal.addEventListener("click", (e) => { if (e.target === editHeroModal) closeEditHeroModal(); });

heroAlignRow.querySelectorAll(".hero-align-btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    heroAlignRow.querySelectorAll(".hero-align-btn").forEach((b) => b.classList.toggle("active", b === btn));
  });
});

heroCoverBtn.addEventListener("click", () => heroCoverInput.click());
heroCoverInput.addEventListener("change", async () => {
  const file = heroCoverInput.files?.[0];
  heroCoverInput.value = "";
  if (!file) return;
  const cropped = await openImageCropper(file, { shape: "banner", outputWidth: 1600, outputHeight: 600 });
  if (!cropped) return;
  pendingHeroCoverBlob = cropped;
  heroCoverRemoved = false;
  heroCoverPreview.style.backgroundImage = `url(${URL.createObjectURL(cropped)})`;
  heroCoverClear.hidden = false;
});
heroCoverClear.addEventListener("click", () => {
  pendingHeroCoverBlob = null;
  heroCoverRemoved = true;
  heroCoverPreview.style.backgroundImage = `url(${HERO_DEFAULT_IMAGE})`;
  heroCoverClear.hidden = true;
});

editHeroSubmit.addEventListener("click", async () => {
  editHeroSubmit.disabled = true;
  editHeroStatus.textContent = "Saving…";
  try {
    let coverURL = heroData.coverURL || null;
    if (pendingHeroCoverBlob) {
      editHeroStatus.textContent = "Uploading photo…";
      const formData = new FormData();
      formData.append("file", pendingHeroCoverBlob, "hero.jpg");
      formData.append("upload_preset", CLOUDINARY_UPLOAD_PRESET);
      formData.append("folder", "hero-banners");
      const response = await fetch(
        `https://api.cloudinary.com/v1_1/${CLOUDINARY_CLOUD_NAME}/image/upload`,
        { method: "POST", body: formData }
      );
      const result = await response.json();
      if (!result.secure_url) throw new Error(result.error?.message || "Upload failed");
      coverURL = result.secure_url;
      editHeroStatus.textContent = "Saving…";
    } else if (heroCoverRemoved) {
      coverURL = null;
    }

    const activeAlignBtn = heroAlignRow.querySelector(".hero-align-btn.active");
    const newHero = {
      tagline: heroTaglineInput.value.trim() || HERO_DEFAULT_TAGLINE,
      font: heroFontSelect.value,
      align: activeAlignBtn ? activeAlignBtn.dataset.align : "left",
      coverURL: coverURL || null,
    };
    await setDoc(heroDocRef(), newHero, { merge: true });
    heroData = newHero;
    renderHero();
    closeEditHeroModal();
  } catch (err) {
    console.error(err);
    editHeroStatus.textContent = "Couldn't save — check your connection and try again.";
  } finally {
    editHeroSubmit.disabled = false;
  }
});

// ---------- Lightweight scroll-reveal ----------
function initScrollReveal() {
  if (!("IntersectionObserver" in window)) return; // fine — elements are visible by default until "armed"
  const targets = document.querySelectorAll(".reveal-on-scroll");
  const observer = new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      if (entry.isIntersecting) {
        entry.target.classList.add("is-visible");
        observer.unobserve(entry.target);
      }
    });
  }, { threshold: 0.12 });
  targets.forEach((el) => {
    el.classList.add("reveal-armed"); // opt in to the opacity:0 starting state right before observing it
    observer.observe(el);
  });
}
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
  await loadHero();
  initScrollReveal();

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

    initCoverflow();
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

// ---------- Subject coverflow ----------
// Positions every rendered .subject-card absolutely, centered, offset by
// distance from coverflowActiveIndex — the classic "coverflow" look:
// focused card full-size and centered, neighbors shrunk/rotated/faded on
// either side. Re-initialized every time loadSubjects() rebuilds the grid
// (add/edit/delete subject, today's rollover, etc.).
let coverflowActiveIndex = 0;
let coverflowResizeHandler = null;

function initCoverflow() {
  const cards = Array.from(subjectsGrid.children);
  if (!cards.length) return;
  cards.forEach((card, i) => { card.dataset.index = String(i); });

  // Default focus to the first card with unseen activity (if any) — that's
  // the one worth surfacing first — otherwise just the first subject.
  const preferredStart = cards.findIndex((c) => c.classList.contains("subject-card--new"));
  coverflowActiveIndex = preferredStart >= 0 ? preferredStart : 0;

  renderCoverflow(cards);
  wireCoverflowInteractions(cards);
}

function renderCoverflow(cards) {
  const activeCard = cards[coverflowActiveIndex];
  const cardWidth = activeCard ? activeCard.getBoundingClientRect().width : 260;
  const step = Math.max(140, cardWidth * 0.82);

  cards.forEach((card, i) => {
    const offset = i - coverflowActiveIndex;
    const abs = Math.abs(offset);
    const dir = offset < 0 ? 1 : -1; // rotate the far side "away" from center, coverflow-style
    let scale, opacity, z, rotate;
    if (abs === 0)      { scale = 1;    opacity = 1;    z = 50; rotate = 0; }
    else if (abs === 1) { scale = 0.82; opacity = 0.85; z = 40; rotate = dir * 16; }
    else if (abs === 2) { scale = 0.68; opacity = 0.5;  z = 30; rotate = dir * 22; }
    else                { scale = 0.6;  opacity = 0;    z = 10; rotate = dir * 22; }

    card.style.transform = `translate(-50%, -50%) translateX(${offset * step}px) scale(${scale}) rotateY(${rotate}deg)`;
    card.style.opacity = String(opacity);
    card.style.zIndex = String(z);
    card.style.pointerEvents = abs > 3 ? "none" : "auto";
    card.classList.toggle("is-coverflow-active", offset === 0);
  });

  if (coverflowPrevBtn) coverflowPrevBtn.disabled = coverflowActiveIndex <= 0;
  if (coverflowNextBtn) coverflowNextBtn.disabled = coverflowActiveIndex >= cards.length - 1;
}

function setCoverflowActive(idx, cards) {
  coverflowActiveIndex = Math.min(cards.length - 1, Math.max(0, idx));
  renderCoverflow(cards);
}

function wireCoverflowInteractions(cards) {
  // Hovering a side card brings it to focus, but with a short "hover
  // intent" delay — without it, moving the mouse across several cards on
  // the way to the one you actually want re-centers the layout under your
  // cursor on every card you pass over, so it feels like the cards are
  // sprinting away from you and you can never land on the one in the
  // middle. Requiring the mouse to sit still on a card for ~160ms before
  // it takes focus fixes that: a fast pass-through no longer triggers
  // anything, only a deliberate hover does.
  let hoverTimer = null;
  cards.forEach((card) => {
    card.addEventListener("mouseenter", () => {
      const idx = Number(card.dataset.index);
      if (idx === coverflowActiveIndex) return;
      clearTimeout(hoverTimer);
      hoverTimer = setTimeout(() => setCoverflowActive(idx, cards), 160);
    });
    card.addEventListener("mouseleave", () => clearTimeout(hoverTimer));
    // Tapping/clicking a side card (mobile has no hover) focuses it first;
    // the tap that actually reaches "Upload"/edit/etc. is the *next* one,
    // once that card is already centered — captured so it fires before the
    // card's own inner button handlers.
    card.addEventListener("click", (e) => {
      const idx = Number(card.dataset.index);
      if (idx !== coverflowActiveIndex) {
        e.preventDefault();
        e.stopPropagation();
        clearTimeout(hoverTimer);
        setCoverflowActive(idx, cards);
      }
    }, true);
  });

  if (coverflowPrevBtn) coverflowPrevBtn.onclick = () => setCoverflowActive(coverflowActiveIndex - 1, cards);
  if (coverflowNextBtn) coverflowNextBtn.onclick = () => setCoverflowActive(coverflowActiveIndex + 1, cards);

  // Basic swipe for touch devices, since hover doesn't exist there.
  let touchStartX = null;
  subjectsGrid.addEventListener("touchstart", (e) => { touchStartX = e.touches[0].clientX; }, { passive: true });
  subjectsGrid.addEventListener("touchend", (e) => {
    if (touchStartX === null) return;
    const dx = e.changedTouches[0].clientX - touchStartX;
    if (Math.abs(dx) > 40) setCoverflowActive(coverflowActiveIndex + (dx < 0 ? 1 : -1), cards);
    touchStartX = null;
  }, { passive: true });

  // Re-space the cards if the viewport is resized (card width changes at
  // the sm breakpoint). One handler at a time — loadSubjects() can rebuild
  // the grid more than once per page view (add/edit/delete a subject).
  if (coverflowResizeHandler) window.removeEventListener("resize", coverflowResizeHandler);
  coverflowResizeHandler = () => renderCoverflow(cards);
  window.addEventListener("resize", coverflowResizeHandler);
}

// Minimalist line-icon per subject, matched by keyword — mirrors the
// keyword logic in getSubjectCoverImage() (helpers.js) so a "Chemistry"
// subject consistently gets both the flask photo AND the flask icon.
// Falls back to a generic graduation-cap icon for anything unmatched,
// same fallback shape every time (not hash-randomized) since an SVG icon
// carries meaning — showing the wrong-category icon reads as more broken
// than reading as generic.
const SUBJECT_ICON_SVGS = [
  { match: /chem/i, svg: '<path d="M9 3h6"/><path d="M10 3v6.5L4.5 19a2 2 0 001.7 3h11.6a2 2 0 001.7-3L14 9.5V3"/>' },
  { match: /phys/i, svg: '<circle cx="12" cy="12" r="1.6" fill="currentColor" stroke="none"/><ellipse cx="12" cy="12" rx="9" ry="3.5"/><ellipse cx="12" cy="12" rx="9" ry="3.5" transform="rotate(60 12 12)"/><ellipse cx="12" cy="12" rx="9" ry="3.5" transform="rotate(120 12 12)"/>' },
  { match: /math/i, svg: '<rect x="5" y="2" width="14" height="20" rx="2"/><rect x="7.5" y="4.5" width="9" height="4" rx="1"/><circle cx="8.5" cy="13" r="1" fill="currentColor" stroke="none"/><circle cx="12" cy="13" r="1" fill="currentColor" stroke="none"/><circle cx="15.5" cy="13" r="1" fill="currentColor" stroke="none"/><circle cx="8.5" cy="17" r="1" fill="currentColor" stroke="none"/><circle cx="12" cy="17" r="1" fill="currentColor" stroke="none"/><circle cx="15.5" cy="17" r="1" fill="currentColor" stroke="none"/>' },
  { match: /english|literat/i, svg: '<path d="M4 4.5A2.5 2.5 0 016.5 2H20v17H6.5A2.5 2.5 0 004 16.5v-12z"/><path d="M4 16.5A2.5 2.5 0 016.5 19H20"/>' },
  { match: /bio/i, svg: '<path d="M5 21c0-9 6-15 15-15 0 9-6 15-15 15z"/><path d="M5 21c3-3 6-9 12-14"/>' },
  { match: /computer|programming|\bit\b/i, svg: '<polyline points="8 6 3 12 8 18"/><polyline points="16 6 21 12 16 18"/>' },
  { match: /hist/i, svg: '<path d="M4 21h16"/><path d="M6 21V10"/><path d="M10 21V10"/><path d="M14 21V10"/><path d="M18 21V10"/><path d="M3 10l9-6 9 6"/>' },
  { match: /geog/i, svg: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18"/><path d="M12 3c3 4 3 14 0 18"/><path d="M12 3c-3 4-3 14 0 18"/>' },
  { match: /art|draw/i, svg: '<path d="M12 3a9 9 0 100 18c1.5 0 2-1 2-2s-.5-1.5-.5-2 1-1.5 2-1.5H17a4 4 0 004-4c0-5-4-8.5-9-8.5z"/><circle cx="8" cy="10" r="1" fill="currentColor" stroke="none"/><circle cx="8" cy="14" r="1" fill="currentColor" stroke="none"/><circle cx="12" cy="16" r="1" fill="currentColor" stroke="none"/><circle cx="15" cy="9" r="1" fill="currentColor" stroke="none"/>' },
  { match: /music/i, svg: '<path d="M9 18V5l11-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="17" cy="16" r="3"/>' },
  { match: /econ|commerce|business/i, svg: '<path d="M3 3v18h18"/><path d="M7 15l4-5 3 3 5-7"/>' },
  { match: /sanskrit|hindi/i, svg: '<path d="M4 4.5A2.5 2.5 0 016.5 2H20v17H6.5A2.5 2.5 0 004 16.5v-12z"/><path d="M4 16.5A2.5 2.5 0 016.5 19H20"/>' },
  { match: /phy(sical)? ?ed|sports|\bpe\b/i, svg: '<circle cx="12" cy="6" r="3"/><path d="M12 9v6"/><path d="M8 12h8"/><path d="M9 21l3-6 3 6"/>' },
];
const SUBJECT_ICON_DEFAULT = '<path d="M12 3l10 5-10 5L2 8z"/><path d="M6 10.5V16c0 1.5 2.5 3 6 3s6-1.5 6-3v-5.5"/>';
function subjectIconSvg(name) {
  const str = String(name || "");
  const found = SUBJECT_ICON_SVGS.find((s) => s.match.test(str));
  const inner = found ? found.svg : SUBJECT_ICON_DEFAULT;
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">${inner}</svg>`;
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
    <div class="subject-icon-badge">${subjectIconSvg(subject.name)}</div>
    <button class="subject-edit-btn" data-action="edit-subject" title="Edit subject"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" style="width:14px;height:14px;"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 013 3L7 19l-4 1 1-4z"/></svg></button>
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
