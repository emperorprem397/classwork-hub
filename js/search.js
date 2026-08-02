import { auth, db } from "./firebase-config.js";
import { onAuthStateChanged, signOut }
  from "https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js";
import { doc, getDoc, collection, getDocs, query, where }
  from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";
import { escapeHtml, dateIdOffset, formatDateLabel } from "./helpers.js";

const userPhoto  = document.getElementById("userPhoto");
const userNameEl = document.getElementById("userName");
const signOutBtn = document.getElementById("signOutBtn");

const searchInput   = document.getElementById("searchInput");
const searchClearBtn = document.getElementById("searchClearBtn");
const recentSearches = document.getElementById("recentSearches");
const recentChips    = document.getElementById("recentChips");
const searchSkeleton = document.getElementById("searchSkeleton");
const searchIdleState = document.getElementById("searchIdleState");
const searchNoResults = document.getElementById("searchNoResults");
const searchResults   = document.getElementById("searchResults");

signOutBtn.addEventListener("click", () => signOut(auth));

const RECENT_KEY = "cwhRecentSearches";
// Look back 30 days for uploads — matches the Subjects page's browse window,
// so "search" and "browse" never disagree about how far back things go.
const SEARCH_DAYS = Array.from({ length: 30 }, (_, i) => dateIdOffset(-(29 - i)));

let currentUser = null;
let currentProfile = null;
let searchIndex = []; // flat list of { type, icon, title, sub, matchText, href }
let indexReady = false;
let debounceTimer = null;

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

  await buildSearchIndex();
  showRecentSearches();
});

async function buildSearchIndex() {
  const { schoolId, classId } = currentProfile;
  const items = [];

  try {
    // ---- Subjects + teachers ----
    const subjectsCol = collection(db, "schools", schoolId, "classes", classId, "subjects");
    const subjectsSnap = await getDocs(subjectsCol);
    const subjects = subjectsSnap.docs.map((d) => ({ id: d.id, ...d.data() }));

    subjects.forEach((s) => {
      items.push({
        type: "Subjects", icon: "📚",
        title: s.name, sub: s.teacher ? `Taught by ${s.teacher}` : "No teacher set",
        matchText: `${s.name} ${s.teacher || ""}`.toLowerCase(),
        href: "dashboard.html",
      });
      if (s.teacher) {
        items.push({
          type: "Teachers", icon: "🍎",
          title: s.teacher, sub: `Teaches ${s.name}`,
          matchText: `${s.teacher} ${s.name}`.toLowerCase(),
          href: "dashboard.html",
        });
      }
    });

    // ---- Homework assignments ----
    const hwCol = collection(db, "schools", schoolId, "classes", classId, "homework");
    const hwSnap = await getDocs(hwCol);
    hwSnap.docs.forEach((d) => {
      const h = d.data();
      const subjectName = subjects.find((s) => s.id === h.subjectId)?.name || "";
      items.push({
        type: "Homework", icon: "📌",
        title: h.description || "Homework", sub: `${subjectName}${h.dueDate ? ` · Due ${h.dueDate}` : ""}`,
        matchText: `${h.description || ""} ${subjectName}`.toLowerCase(),
        href: "homework.html",
      });
    });

    // ---- Recent uploads (classwork + homework tagged photos) ----
    const uploadResults = await Promise.all(
      subjects.flatMap((subject) =>
        SEARCH_DAYS.map((dateId) =>
          getDoc(doc(db, "schools", schoolId, "classes", classId, "subjects", subject.id, "entries", dateId))
            .then((snap) => ({ subject, dateId, snap }))
        )
      )
    );
    uploadResults.forEach(({ subject, dateId, snap }) => {
      if (!snap.exists()) return;
      const data = snap.data();
      (data.uploads || []).forEach((u) => {
        const dateLabel = formatDateLabel(dateId);
        items.push({
          type: "Uploads", icon: u.type === "homework" ? "📝" : "📓",
          title: u.title || `${subject.name} — ${dateLabel}`,
          sub: `${subject.name} · ${u.name || "Classmate"} · ${dateLabel}`,
          matchText: `${u.title || ""} ${subject.name} ${u.name || ""} ${dateLabel} ${dateId}`.toLowerCase(),
          href: "homework.html",
        });
      });
    });

    // ---- Classmates ----
    const usersSnap = await getDocs(query(
      collection(db, "users"),
      where("schoolId", "==", schoolId),
      where("classId", "==", classId)
    ));
    usersSnap.docs.forEach((d) => {
      const u = d.data();
      if (u.banned === true) return;
      items.push({
        type: "Classmates", icon: "🧑‍🎓",
        title: u.name || u.displayName || "Classmate",
        sub: `${u.rank || "Bronze"} · ${u.xp ?? 0} XP`,
        matchText: `${u.name || u.displayName || ""}`.toLowerCase(),
        href: "leaderboard.html",
      });
    });
  } catch (err) {
    console.error("Couldn't build search index:", err);
  }

  searchIndex = items;
  indexReady = true;
  searchSkeleton.hidden = true;
}

// ---------- Recent searches ----------
function getRecent() {
  try { return JSON.parse(localStorage.getItem(RECENT_KEY) || "[]"); }
  catch { return []; }
}
function addRecent(term) {
  if (!term.trim()) return;
  const existing = getRecent().filter((t) => t.toLowerCase() !== term.toLowerCase());
  existing.unshift(term);
  localStorage.setItem(RECENT_KEY, JSON.stringify(existing.slice(0, 6)));
}
function showRecentSearches() {
  const recent = getRecent();
  if (!recent.length) {
    recentSearches.hidden = true;
    searchIdleState.hidden = false;
    return;
  }
  searchIdleState.hidden = true;
  recentSearches.hidden = false;
  recentChips.innerHTML = recent.map((t) =>
    `<button class="recent-chip" data-term="${escapeHtml(t)}">${escapeHtml(t)}</button>`
  ).join("");
  recentChips.querySelectorAll("[data-term]").forEach((chip) => {
    chip.addEventListener("click", () => {
      searchInput.value = chip.dataset.term;
      runSearch(chip.dataset.term);
      searchInput.focus();
    });
  });
}

// ---------- Search + render ----------
searchInput.addEventListener("input", () => {
  const term = searchInput.value;
  searchClearBtn.hidden = !term;
  clearTimeout(debounceTimer);
  debounceTimer = setTimeout(() => runSearch(term), 150);
});
searchClearBtn.addEventListener("click", () => {
  searchInput.value = "";
  searchClearBtn.hidden = true;
  runSearch("");
  searchInput.focus();
});

function runSearch(rawTerm) {
  const term = rawTerm.trim().toLowerCase();

  if (!term) {
    searchResults.innerHTML = "";
    searchNoResults.hidden = true;
    showRecentSearches();
    return;
  }

  recentSearches.hidden = true;
  searchIdleState.hidden = true;

  if (!indexReady) return; // skeleton still showing, nothing to search yet

  const matches = searchIndex.filter((item) => item.matchText.includes(term));

  if (matches.length === 0) {
    searchResults.innerHTML = "";
    searchNoResults.hidden = false;
    return;
  }
  searchNoResults.hidden = true;

  const grouped = {};
  matches.forEach((m) => { (grouped[m.type] = grouped[m.type] || []).push(m); });

  const order = ["Subjects", "Teachers", "Homework", "Uploads", "Classmates"];
  searchResults.innerHTML = order
    .filter((type) => grouped[type]?.length)
    .map((type) => `
      <div class="search-group">
        <div class="search-group-label">${type} (${grouped[type].length})</div>
        <div class="search-group-items">
          ${grouped[type].slice(0, 12).map((item) => `
            <a class="search-result-item" href="${item.href}">
              <span class="search-result-icon">${item.icon}</span>
              <div class="search-result-body">
                <div class="search-result-title">${highlight(item.title, term)}</div>
                <div class="search-result-sub">${escapeHtml(item.sub)}</div>
              </div>
            </a>
          `).join("")}
        </div>
      </div>
    `).join("");

  addRecent(rawTerm.trim());
}

function highlight(text, term) {
  const safe = escapeHtml(text);
  if (!term) return safe;
  const idx = safe.toLowerCase().indexOf(term.toLowerCase());
  if (idx === -1) return safe;
  return safe.slice(0, idx) + `<span class="search-result-match">${safe.slice(idx, idx + term.length)}</span>` + safe.slice(idx + term.length);
}
