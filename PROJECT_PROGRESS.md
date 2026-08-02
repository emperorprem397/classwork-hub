# Classwork Hub — Progress Tracker

Live site: https://classwork-hub.vercel.app/
Stack: Firebase Auth (Google, popup) + Firestore + Cloudinary (images) + GitHub → Vercel hosting.

Refer to this file before making changes — it's the single source of truth for what's done, what's pending, and what's next.

> **📦 Consolidation note:** This file's project package (`classwork-hub-FINAL.zip`, 35 files) is a from-scratch merge of every round shipped so far — verified file-by-file against every prior delivery, not just a copy of the latest one. It's meant to be uploaded as a complete replacement to a fresh GitHub repo (or to overwrite the existing one entirely) rather than dragged in piecemeal. In particular, this is the first package where `firebase/firestore.rules` is confirmed to include **both** the collaborative-upload rules **and** the `banned`-field crash fix **and** the self-serve subject/school write permissions — earlier individual zips could easily end up with only some of these if uploaded out of order, which is exactly what caused the permission-denied debugging session earlier in this project.

---

## ✅ Completed

**Auth & onboarding**
- Google Sign-In (popup-based — matches the admin panel's working pattern; redirect-based auth was tried and reverted, see "Decisions" below)
- School-select flow (search/select school, join a class)
- Admin panel: create schools, classes, subjects; ban/unban users

**Core class flow**
- Dashboard — "Today's Work": one card per subject, shows upload status, opens upload modal
- Upload flow: pick up to 6 photos → client-side compress (max 1600px, JPEG q0.82) → upload to Cloudinary (unsigned preset) → URLs saved to Firestore
- **NEW — optional metadata per upload:** student can tag a submission as Classwork / Homework and add a short title (e.g. "Chapter 5 — Photosynthesis notes"). Both fully optional, no validation blocks a bare photo-only upload.
- Collaborative entries: multiple classmates can add photos to the same subject/day; each submission (with its own type/title) is tracked individually, not just merged into one flat photo list
- Subjects page — browse the last 7 days per subject, view any day's uploads
- My Uploads — personal upload history, mirrored via a private per-user subcollection
- Homework tracker — separate from classwork uploads; post an item (subject + description + due date), classmates check it off individually
- Leaderboard — ranked by XP within the student's own class
- Profile — XP, streak, rank progress
- XP / rank / streak system: +10 XP per upload, +5 bonus for being first on a subject that day, +2 streak tick once per day; ranks Bronze → Silver → Gold → Platinum

**Access control (Firestore rules)**
- Students can only read/write within their own school + class
- Admin has read/write access everywhere
- Verified: this already satisfies "classwork should only be visible to the uploader's class + admin" — no rules change was needed for the metadata update

**Infra decisions**
- Switched from Firebase Storage to Cloudinary for images — keeps the project on free tiers; Firestore stores only the resulting URLs
- Firebase Storage rules are locked to `allow read, write: if false` since Storage isn't used at all

---

## 🔧 Decisions / issues resolved (so we don't redo them)

- **Auth method:** Popup-based Google Sign-In is final. Redirect-based auth was tried to fix an unrelated "Something went wrong signing in" error, but that error was actually a Firestore-rules mix-up (Storage rules pasted into the Firestore rules tab), not a popup problem. Redirect auth introduced a real regression — it needs a background iframe handshake with `classwork-hub.firebaseapp.com`, which triggered Brave's third-party-cookie consent dialog and broke sign-in-after-sign-out on mobile Brave. Reverted to popup, matching the admin panel's approach, which never had this issue.
- **Data model for entries:** `entries/{date}` is one shared doc per subject per day; `uploadedBy` / `uploaderNames` / flat `photoURLs` are kept for backward compatibility with older entries, and a new `uploads` array now holds one record per submission `{ uid, name, type, title, photoURLs, uploadedAt }` so per-student metadata doesn't get flattened away.
- **Chapters layer** was dropped from the hierarchy for MVP (School → Class → Subject → Date, not → Chapter → Date) — can be reintroduced later if needed.

---

## 🔧 Round: self-serve subjects + "unpublished rules" theory (partially wrong, see below)

- **Students can now add subjects themselves** — a "+ Add subject" button on the dashboard (also shown in the empty state) opens a small modal for name + optional teacher. Previously subject creation was admin-only in the Firestore rules, which is why the dashboard showed no upload option until a subject existed. Editing/deleting a subject is still admin-only (this part is correct and confirmed working).
- Noted separately, not a bug: if testing in Brave, you may see red `ERR_BLOCKED_BY_CLIENT` lines in the console on Firestore's realtime "Listen" channel — that's Brave Shields' ad-blocker misfiring on Firestore's long-polling URL pattern, unrelated to the permission error. Safe to ignore, or turn Shields off for the site to silence it.

## 🐛 Root cause of "Missing or insufficient permissions" — actually found this round

The earlier theory (rules never republished) turned out to be wrong — the rules *were* published correctly, verified directly against the Firebase Console. Added temporary debug logging to `dashboard.js` to get the real answer, which showed the true cause:

- The test account's `/users/{uid}` profile doc has **no `banned` field at all** (never set).
- The rules' `inClass()` helper checked `myProfile().banned != true` using **direct dot access**. In Firestore Rules, accessing a field that doesn't exist on a map errors out rather than returning `false`/`undefined` — so that comparison silently broke `inClass()` on **every write, for every student**, regardless of role.
- This didn't affect reads (subjects/entries loading fine) because reads have an `isAdmin()` OR-branch that bypasses `inClass()` entirely, and this particular test account happened to have `role: "admin"` set (from earlier admin-panel setup on the same Google account) — which is exactly what made this so confusing to trace: reads worked, writes silently failed, on the same account.

**Fix, in `firebase/firestore.rules`:**
- Changed every `myProfile().banned != true` to `myProfile().get('banned', false) != true` (safe default instead of a hard error on a missing field) — this is the actual fix, applies to every account, not just admin ones.
- Also added an explicit `isAdmin() ||` bypass to the `subjects`, `entries`, and `homework` create rules, so an admin account is never blocked by `inClass()` on any write either, matching "admin should have access to everything."
- Debug logging that was temporarily added to `dashboard.js` for this diagnosis has been removed — the file is back to production form, no leftover console noise.

**This must be republished** (Firestore Database → Rules → paste → Publish) — same as before, but this time it's the actual fix, not a guess.

## ⚙️ Settings page (new)

Requested as "2nd improvement" — a gear-icon Settings page, built and added to the sidebar on every page (Dashboard, Subjects, My Uploads, Homework, Leaderboard, Profile, Settings itself).

- **Profile photo** — always your live Google account photo, read-only (by design — not something we store a custom upload for)
- **Display name** — editable. Saves via `updateProfile()` on the Firebase Auth user (so it's correct everywhere immediately for your own pages) **and** mirrors into the Firestore `users/{uid}.name` field, because the leaderboard and admin panel can't call the Auth API for *other* people — they only ever read the Firestore copy. Both dashboard.js and settings.js now silently keep that Firestore mirror (`name` + `photoURL`) in sync in the background on every load, so this also retroactively fixes it for accounts that never had `photoURL` saved at all (which was every account until now — `school-select.js` never wrote it).
- **Enrolment (school/class)** — shows current enrolment, with a "Change school / class" button → `school-select.html?edit=1`. Patched `school-select.js` to recognize `?edit=1` and skip its normal "already enrolled → bounce to dashboard" redirect, show a small banner confirming current enrolment, and — importantly — **not reset XP/streak/rank to zero** on re-save (the original save logic always included `xp:0, streak:0, rank:"Bronze"`, which would've wiped progress on every re-enrolment; now it only sets those on a genuinely first-time signup).
- **Admin panel** — Users table now has a Photo column showing each student's Google profile photo, as you asked for specifically.

No Firestore rules changes needed this round — the existing update rule (`request.auth.uid == uid` + banned-unchanged) already permits all of this.

## 🎯 Default subjects + self-serve school-add + onboarding polish (new)

This is the "1st improvement" that was queued after Settings — now built.

- **Default subjects** — every brand-new class automatically gets Hindi, English, Science, Maths, and Social Science seeded the moment the first student joins it (fixed doc IDs, so this can never run twice for the same class). "+ Add subject" still exists for anything extra (AI, Psychology, a school-specific elective). Never re-seeds a class that already exists — whether it already has the defaults or a fully custom list, this can't stomp on it.
- **Self-serve "Add your school"** — on the school-select page, if a student's school isn't in the fixed APS list, "Can't find your school? + Add your school" lets them add it (name + optional city) and continue immediately — not gated behind approval. It's saved with `status:"pending"` and `requestedBy*` fields, which plugs directly into the admin panel's **already-existing** "Pending Schools" tab (with its unread-count badge) — no admin panel changes needed, that workflow was already built, just never wired up on the student side. Admin can approve, edit, or remove from there as before.
  - **Duplicate protection:** the school search now also pulls in Firestore-registered non-APS schools (not just the static list), and matches case-insensitively before creating a new one — so a second student from the same new school finds and joins the *same* school/class instead of fragmenting it into two.
- **XP-safety fix carried over correctly:** confirmed the reordering here (profile save now happens *before* subject-seeding, not after) — this was required for the Firestore rules to authorize the new subjects writes (they check the student's own profile schoolId/classId), and it doesn't disturb the earlier Settings-round fix that a re-enrolment via `?edit=1` still preserves XP/streak/rank.
- **Onboarding banner** — a dismissible "👋 Quick tour" card at the top of the dashboard, shown once per account (tracked per-uid so it doesn't bleed across accounts on a shared device), explaining what each of the 6 sidebar sections is for. Disappears for good once dismissed.

No Firestore rules changes needed this round either — schools/classes/subjects creation was already permissive enough (`name is string`), and the existing "Pending Schools" admin workflow already existed and just needed a student-facing entry point.

## 🛠️ Multi-upload fixes, Work section, leaderboard fix, off-canvas nav, new homepage (this round)

Large round covering most of the outstanding bug list plus two structural changes (Work section, nav redesign) and a full homepage rebuild.

**Bug fixes:**
- **Unlimited photos per upload** — removed the hard-coded 6-photo cap in `dashboard.js`'s file picker.
- **Multiple uploads per subject per day** — removed the "you've already uploaded" disabled-button lock. A student can now add more photos to the same subject repeatedly in one day; the upload transaction already supported this correctly, only the UI was blocking it.
- **Leaderboard actually works now** — root cause was the query (`where` + `where` + `orderBy`) requiring a Firestore composite index that never got created. Rewrote it to fetch by the two equality filters only and sort by XP client-side in the browser — this needs **no manual index step**, ever. Every classmate now shows up (even 0-XP, never-uploaded students, sorted to the bottom); banned accounts are excluded.
- **Subject editing** — any classmate can now edit a subject's name/teacher (✎ button on each dashboard card opens a small modal), not just the admin. Firestore rule updated to match — `create`/`update` now both check `inClass()`, `delete` stays admin-only.
- **Uploader names visible** — subject cards now list who uploaded (not just a count), pulled from the existing `uploaderNames` map on the entry doc.
- **"Lost my uploads after switching class" — investigated, not a code bug.** School/class IDs are deterministic for APS schools, so switching back to the same school+class restores the exact same Firestore path — the data was never actually gone. The most likely real cause: the Subjects page only showed a 7-day window, so anything uploaded further back looked "missing." Widened that window to 30 days. If this still happens after this update, it's worth screenshotting exactly which page shows nothing (Dashboard "today" card vs. Subjects day-chip row are two different queries).

**Homework → Work section (structural change):**
- `homework.html`/`homework.js` (filenames kept, content rebuilt) is now a tabbed **Work** page: **Assignments** (the original due-date tracker, unchanged behavior) + **Classwork Uploads** + **Homework Uploads** — the latter two scan every subject's last 14 days of entries and surface any individual photo submission tagged with that type. This is what makes tagging an upload "Homework" on the Dashboard actually make it appear somewhere under Work, which it never did before.
- Sidebar label everywhere changed from "✅ Homework" to "🗂️ Work" (same `homework.html` href, just relabeled — no link breakage).

**Off-canvas navigation (structural change):**
- The sidebar on all 7 app pages (Dashboard, Subjects, My Uploads, Work, Leaderboard, Profile, Settings) is now hidden by default and opens via a minimal 3-dot (⋮) button in the topbar, with a dimmed backdrop and close-on-outside-click/Escape. New shared `js/nav.js` handles this identically on every page. CSS lives in `css/dashboard.css` (already shared by all pages, no per-page CSS files needed).

**New public homepage:**
- `index.html` (previously just a login card) is now a full monochrome marketing hero page — nav with Home/Features/About/Contact, hero headline + Get Started/Login CTAs, an abstract stacked-notebook illustration built in CSS (no external image), Features/About/Contact sections, footer. All CTA buttons trigger the same Google popup sign-in as before.
- New dedicated `css/style.css` rewrite for this page only — intentionally not using the dark cyan glass `theme.css` the rest of the app uses, since this is the one page a visitor sees before signing in.
- `js/auth.js` changed from binding one `#google-login-btn` id to binding every `.google-signin-btn` element, since the new page has three separate sign-in triggers (top-right Login pill, hero Get Started, bottom Get Started).

**Firestore Console step required this round:** yes — republish `firestore.rules` (Firestore Database → Rules → paste → Publish) for the subject-editing permission change. Nothing else needs a console step; the leaderboard fix is pure client-side code, no index to create.

## ⏳ Pending / not built yet

- Comments on uploads
- Notifications
- Search across uploads
- Any analytics in the admin panel beyond the basics
- Known gap, not yet addressed: Firestore rules let a signed-in student update their own `xp`/`rank`/`streak` fields directly (not just `name`/`photoURL`) since the update rule only checks that `banned` is unchanged — fine for now, worth locking down later if it ever matters
- Admin's "Pending Schools" review UI itself wasn't touched — it already existed from before the APS-only pivot and works as-is
- Subject editing (✎) was only added to the Dashboard page, not the Subjects (browse) page — could extend there too if it comes up
- The new homepage's illustration is an abstract CSS-built stack of notebook icons, not a pixel match of the reference screenshot's 3D render — flagging in case an exact visual match still matters

## 🎨 Theming system + redesigned Settings + admin parity, 🔍 Universal Search (this round)

Milestone 2 was a 14-item feature brief — way too much for one safe round, so Prem ranked priorities and this round covers the top two: **Theming** and **Universal Search**. The rest (Activity Feed + Class Chat, Dashboard widgets, Profile redesign, Contribution calendar, Leaderboard filters, Notebook viewer upgrade, Upload polish, empty states/skeletons elsewhere) are queued for follow-up rounds — see Pending below.

**Note on the brief itself:** Milestone 2's document specified React/Vite/Tailwind/Framer Motion. The live site (and everything shipped in every round so far) is plain HTML/CSS/JS + Firebase + Cloudinary — confirmed with Prem to keep that stack rather than rebuild from scratch.

**Theming (Dark Cyan / Light / Monochrome):**
- Every color in the app already lived in CSS custom properties (`css/theme.css`), so adding themes meant adding two override blocks (`:root[data-theme="light"]`, `:root[data-theme="monochrome"]`) that redefine the same variable names — no other CSS file needed touching for the app itself. Fixed two spots (`​.btn-primary`, `.primary-btn` on school-select) that had a hardcoded text color instead of a variable, which would've been unreadable on the new light backgrounds.
- New `js/theme.js` — shared helper: `applyTheme()`, `getStoredTheme()`, `syncThemeFromCloud()`, `saveThemeToCloud()`.
- A tiny inline script at the very top of every page's `<head>` (before any stylesheet) reads the saved theme from `localStorage` and applies it before first paint — no flash of the wrong theme on load.
- Theme is saved to `localStorage` **and** to `users/{uid}.theme` in Firestore, so switching on your phone shows up on your laptop next time you open the app — `dashboard.js` does a silent one-time pull from Firestore on load in case it changed elsewhere.
- **Settings page redesigned** into tabs (Account / Appearance / Notifications / Privacy / About), matching the brief. Appearance has the 3 theme swatches. Notifications has 5 toggles saved to `users/{uid}.notificationPrefs` — **honest caveat: these are saved and ready, but nothing is actually pushed yet** since there's no notification infrastructure (that's part of the deferred Activity Feed work). Privacy is a static explainer of who can see what. About is static app info.
- **Admin panel parity** — same 3-theme system added as a new "🎨 Appearance" tab in the sidebar, self-contained (the admin panel is one standalone HTML file, doesn't share code with the main app, so the same token pattern was duplicated there rather than shared — intentional, keeps the admin panel's "no dependency on the main site's file structure" property that was a deliberate choice from an earlier round).
- No Firestore rules changes needed — the existing per-user update rule already permits writing arbitrary fields to your own `users/{uid}` doc (aside from `banned`), so `theme` and `notificationPrefs` were already writable.

**Universal Search:**
- New sidebar item "🔍 Search" (added to all 8 pages) → dedicated `search.html` + `js/search.js`.
- Builds a client-side searchable index once per page load: subjects, teachers, homework assignments, the last 30 days of classwork/homework uploads (same window as the Work page's upload feeds), and classmates (from the same query the leaderboard uses). Typing filters instantly (150ms debounce) — no per-keystroke Firestore reads.
- Results are grouped by type (Subjects / Teachers / Homework / Uploads / Classmates) with the matched text highlighted.
- Recent searches (last 6) saved to `localStorage`, shown as tappable chips when the box is empty. Skeleton loader while the index builds, a "start typing" empty state, and a distinct "no matches" state.
- Search results link to the most relevant existing page (a subject match → Dashboard, a homework/upload match → Work, a classmate match → Leaderboard) rather than a dedicated per-item detail page, since those don't exist yet.

**Firestore Console step required this round:** none. **GitHub upload:** drag every file in this round's zip into "Add file" as usual — several are brand new (`search.html`, `js/search.js`, `css/search.css`, `js/theme.js`), the rest are edits to existing files.

## ⏳ Pending / not built yet

- Activity Feed + real-time Class Group Chat (ranked #3 — biggest remaining lift, needs new Firestore collections + security rules of its own)
- Dashboard widgets (Welcome card, Upload streak, Quick Upload shortcut, Leaderboard preview, etc.)
- Profile page redesign (GitHub-profile-style: badges, contribution score, achievements)
- GitHub-style contribution calendar
- Leaderboard filters (Today/Week/Month/All-time) — needs XP to start being recorded with timestamps, not just as a running total, so this needs a small data-model change first
- Notebook viewer upgrade (zoom, fullscreen, next/prev, keyboard nav) — currently photos just open in a new tab
- Smart upload improvements (blur/duplicate detection, rotate/crop, reorder)
- OCR-ready fields on upload documents (foundation only, no OCR itself)
- Skeleton loaders + polished empty states on the older pages (Search has one now; Dashboard/Subjects/etc. still use the plain "Loading…" text from earlier rounds)
- Bottom mobile nav + floating upload button
- Notification toggles exist and save, but nothing is actually sent yet — needs the Activity Feed infrastructure first
- Comments on uploads, in-app announcements
- Known gap, carried over: Firestore rules let a signed-in student update their own `xp`/`rank`/`streak` fields directly since the update rule only checks `banned` is unchanged — fine for now, worth locking down later

## ➡️ Next step

Activity Feed + Class Group Chat was ranked #3 — likely next up, but confirm with Prem before starting since it's the largest remaining piece (new Firestore collections, new security rules, real-time listeners).

## 🩹 Hotfix — signup/class-switch permission-denied bug (`js/school-select.js`)

**Not a new-round regression — a pre-existing bug that had been there since school-select.js was first written**, just hadn't been noticed because early testing was mostly the first person into each school.

**Symptom:** any student picking an APS school that a previous student had *already* selected got "Missing or insufficient permissions" on "Continue to Dashboard" and could never reach the dashboard. Switching class via Settings hit the same code path and failed the same way.

**Root cause:** `saveClassBtn`'s click handler unconditionally ran `setDoc(schoolRef, {...}, {merge:true})` on the school's document for every APS school selection. The very first student to pick a given school creates that doc (Firestore `create`, always allowed). Every student after them hits the exact same doc, which now exists — Firestore rules only let **admins** `update` an existing school doc — so the write is rejected for everyone else.

**Fix:** check `schoolSnap.exists()` first and only write when it doesn't (mirrors the pattern already used two lines below it for the class doc, which is why the class doc was never affected by this). No Firestore rules change needed — this is a client-code-only fix.

**Deploy:** just `js/school-select.js` this time — single file, shipped separately from the Milestone 2 round since it's an active blocker.

## 🩹 Hotfix #2 — duplicate school data isolation + cache-busting

**Two more reports right after the last hotfix:** (1) two accounts both in "APS Bareilly" / Class 11-F saw completely different subjects, teacher names, and uploads from each other, and (2) multi-photo upload appeared to only take one photo at a time despite that being fixed two rounds ago.

**Bug #1 root cause — duplicate school documents:** at some point a second "APS Bareilly" got self-added through "+ Add your school" even though it was already in the fixed APS list — most likely because the student's typed name had a tiny whitespace difference from the list entry (e.g. a double space), so the old exact-match duplicate check didn't catch it and a second Firestore document got created with a different ID. Two students who each picked a differently-IDed "APS Bareilly" are, underneath the identical-looking name, actually in two entirely separate schools/classes/subjects — neither can ever see the other's data. Deleting the duplicate from the admin panel (as Prem did) removes it from the picker going forward, but doesn't fix an account that's already bound to the deleted ID — Firestore doesn't cascade-delete a doc's subcollections, so that account's data quietly keeps working in isolation.
- **Fix (prevents new duplicates):** the "+ Add your school" duplicate check and the school search box now both normalize whitespace before comparing, so a stray extra space can't slip a near-duplicate past the check. (`js/school-select.js`)
- **Fix for already-affected accounts:** no code can safely auto-merge two unrelated Firestore subtrees. Any account currently bound to a stale/orphaned school ID needs to go to **Settings → Change school / class** and re-pick "APS Bareilly" + the right class from the list — now that the duplicate is gone, everyone re-selecting lands on the same canonical school document and starts seeing the same shared class data.

**Bug #2 — multi-photo upload:** re-verified the code — the file input still has `multiple`, and the upload loop still iterates every selected file with no cap. Almost certainly this was stale cached JavaScript rather than a real regression — browsers (and Vercel's CDN) can keep serving an old cached copy of a `.js` file after a GitHub update even though the file on disk changed, since there was nothing telling the browser the file was new.
- **Fix:** every page's local `<script src="js/...">` and `<link href="css/...">` now has a `?v=20260803` version tag appended. Bump that date string any time a future round should force everyone's browser to fetch fresh files instead of a cached copy — this should prevent "I shipped the fix but you're still seeing the old bug" mismatches like this one going forward.

**Deploy:** every `.html` file (all 10 got the version-tag change) plus `js/school-select.js`. No Firestore Console step.

## ✅ Round 13 — subject delete + activity log + theme/underline fixes

**1. Delete a subject (self-service, not just admin)**
Classes vary a lot (Science stream vs. Commerce vs. Arts electives), so students shouldn't be stuck with subjects that don't apply, or wait on an admin to remove one. The existing edit-subject modal (✎ on each subject card) now has a red "🗑️ Delete this subject" button. Confirms via a plain `confirm()` dialog first (no undo). `firestore.rules`: `subjects/{subjectId}` delete rule changed from admin-only to `isAdmin() || inClass(schoolId, classId)`.

**2. New: Class Activity log (`activity.html`)**
New sidebar page, 7th item, between Leaderboard and Profile. A lightweight, append-only feed — every subject **create**, **edit**, and **delete**, plus every **photo upload**, now writes one small doc to a new `schools/{schoolId}/classes/{classId}/activity` subcollection with the actor's profile name (same name shown everywhere else, not just "a classmate"), what they did, to which subject, and a timestamp. The Activity page lists the most recent 100, newest first, with an icon + relative time ("3h ago"). Nobody can edit or delete their own past entries — it's an honest log, not a chat — admin can still delete an entry for moderation. New files: `activity.html`, `js/activity.js`, `css/activity.css`. New shared helpers in `helpers.js`: `logActivity()`, `ACTIVITY_META`, `timeAgo()`. `firestore.rules`: new `activity/{activityId}` rule (read: class members + admin; create: class members + admin, must self-attest `actorUid`; update: nobody; delete: admin only).
This is a **scoped-down version** of the bigger "Activity Center" from the Milestone 2 brief — it's a log, not real-time messaging. The full **Class Group Chat** (live messages, typing indicators, replies, edit/delete own message, emoji) is still a separate, much bigger feature — same as noted in the "Pending" list below, worth confirming before starting since it needs its own Firestore collection design and real-time listeners.

**3. Theme switch not reaching the sidebar/topbar — fixed**
Root cause: `.sidebar` and `.topbar` in `dashboard.css` (shared across every app page) had two colors hardcoded as plain `rgba(11,18,21,...)` values instead of reading from `theme.css`'s custom properties — so switching to Light or Monochrome in Settings → Appearance re-skinned every card on the page except the nav, which stayed dark no matter what. Fix: added `--nav-surface` / `--nav-surface-soft` tokens to all three theme blocks in `theme.css` (dark/light/monochrome each get their own values), and pointed `.sidebar`, `.topbar`, and the school-select page's topbar at those instead of the old hardcoded colors.

**4. Stray underlines removed**
Several links (sidebar nav items, uploader thumbnail links, etc.) were showing a plain browser-default underline since nothing explicitly turned it off. Added one global rule to `theme.css`: `a { text-decoration: none; color: inherit; }`. Anywhere an underline is actually wanted (e.g. the small "forgot password"-style helper text), that page already sets `text-decoration: underline` on a specific class, which still wins by CSS specificity — nothing intentional was lost.

**Files changed this round:** `firebase/firestore.rules`, `css/theme.css`, `css/dashboard.css`, `css/school-select.css`, `js/helpers.js`, `js/dashboard.js`, `dashboard.html`, plus 7 other pages' sidebars got the new Activity nav link (`subjects.html`, `myuploads.html`, `homework.html`, `leaderboard.html`, `profile.html`, `settings.html`, `search.html`). New files: `activity.html`, `js/activity.js`, `css/activity.css`.

**Firestore Console step required:** yes — republish `firestore.rules` (subject delete rule changed, new `activity` collection rule added). No Storage rules change.

## ✅ Round 14 — real-time Class Chat, delete-my-upload, first-run wizard, Work tab order, multi-photo bug fix

**1. Real-time Class Chat** — `activity.html` now has two tabs: **Activity Log** (unchanged) and **Class Chat** (new). Chat is fully live: messages write to `schools/{schoolId}/classes/{classId}/messages`, and every classmate's browser is subscribed via Firestore's `onSnapshot` (a live connection, not a page you refresh) — a message you send typically shows up on someone else's screen in well under a second, the same mechanism WhatsApp Web uses. Features: sender avatar + name (except on your own bubbles, right-aligned), timestamps, edit your own message (inline, saves on Enter/blur), delete your own message (hard delete, no "message was deleted" placeholder), and a "so-and-so is typing…" indicator (writes at most once every 2s while typing, other clients treat it as stale after 5s of silence). New `messages` and `typing` subcollections + rules (read: class members; create/edit/delete own message only; typing: write only your own doc). Emoji: no custom picker was built — your keyboard's own emoji key/panel (which every phone and most desktop keyboards have) works fine typed straight into the message box, since it's a plain text field.
*Not built (flagging honestly):* read receipts, @mentions, reactions, image/file attachments in chat, message search. Worth a future round if wanted.

**2. Delete your own upload** — "My Uploads" page: every submission now has a "🗑️ Delete" button. Removes those photo(s) from the shared class view *and* your own history via a Firestore transaction (keeps both in sync, can't half-fail). Deleting the last remaining upload for a subject/day correctly flips that subject back to "not uploaded yet" on the Dashboard (fixed a related display bug: a subject whose only upload gets deleted was still showing the green "uploaded" badge with 0 names — now checks the classmate count, not just whether the entry doc exists). **Known, intentional limitation:** XP/streak from a deleted upload is *not* clawed back — recalculating streaks precisely is a lot of extra complexity for an edge case, and it discourages people from being scared to fix a mistake. Logged to the Activity feed as "X deleted their upload for Y" either way.

**3. First-run profile setup wizard** — brand-new accounts now land on `welcome.html` (3 short steps: name, appearance theme, then continue) instead of going straight to school/class selection. Steps 1 and 2 are genuinely skippable with sensible defaults (Google's own name, Dark Cyan theme) and say up front they can be changed later in Settings. **Honest caveat:** step 3 (school + class) is *not* skippable — the whole app is scoped per-class, so there's nothing to show without it — the wizard is upfront about that rather than offering a fake skip button. Existing accounts (and anyone who already has a `schoolId` set) skip the wizard entirely and go straight to their usual destination, so nobody who's already using the app sees this. New `onboarded` boolean added to the `users/{uid}` doc.

**4. Work page tab order** — Classwork Uploads is now the first (default-open) tab, then Homework Uploads, then Assignments last, per request. Classwork feed now loads eagerly on page load (it used to lazy-load only when clicked, back when Assignments was the default tab).

**5. Fixed: second photo picked made the first one disappear** — root cause: selecting photos replaced `pendingFiles` from scratch every time the file picker was reopened, so picking one photo, then reopening the picker to add a second, silently dropped the first. Now appends instead of replacing, and each pending photo has its own ✕ button to remove it before uploading if you picked the wrong one.

**Files changed this round:** `firebase/firestore.rules` (new `messages`/`typing` rules), `js/dashboard.js` (multi-photo fix, uploaded-badge fix), `js/myuploads.js` (rewritten — delete-own-upload), `js/homework.js` + `homework.html` (tab reorder), `js/helpers.js` (`upload_deleted` activity type), `js/activity.js` + `activity.html` + `css/activity.css` (Class Chat tab), `js/auth.js` (wizard routing), `css/dashboard.css` (removable-photo-preview styling). New files: `welcome.html`, `js/welcome.js`, `css/welcome.css`. Every page's cache-bust version bumped to `20260804` so none of this can get served stale from a browser cache.

**Firestore Console step required:** yes — republish `firestore.rules` again (new `messages` and `typing` collection rules). No Storage rules change.

## ✅ Round 15 — real admin superpowers, account reset, avatar picker, Contact Admin, chat auto-expiry, admin theme fix

**Scope note up front:** this request had ~12 distinct asks. The horizontal top navbar redesign, unread-message/upload notification badges on that navbar, per-image delete/replace within a single upload (vs. deleting the whole submission), and a full admin cross-class browser (join-free access to *any* class) are each big enough to deserve their own round — **not built yet, queued next.** Everything below **is** done:

**1. Admin theme bug — same root cause as the student-facing fix a few rounds back:** `admin/index.html`'s embedded `.sidebar`/`.topbar` CSS had the same hardcoded dark color instead of a theme variable. Added a `--nav-surface` token to all three of the admin panel's theme blocks (it has its own self-contained `:root[data-theme]` blocks, separate from `css/theme.css`) — Light/Monochrome now actually restyle the admin nav too.

**2. Admin superpowers, main website (not just admin panel) — for accounts with `role: "admin"` on their own profile doc:**
   - Excluded from the Leaderboard entirely (`js/leaderboard.js`).
   - Can delete *any* student's upload straight from the Dashboard's "Already shared today" list (not just their own, via My Uploads) — new 🗑️ button per upload group, admin-only.
   - Can edit or delete *anyone's* Class Chat message, not just their own — shows a small "admin view" tag next to a moderated name.
   - **Honest limit:** this all works within a class the admin has actually joined (same as any student, via school-select) — a true "browse *any* class without joining it" switcher is the bigger deferred piece above.

**3. Contact Admin** — Settings → About: a WhatsApp button (glowing hover, deep-links to `wa.me/917568521210` with a pre-filled message), an email link to emperorprem397@gmail.com, and a direct message box that writes to a new `adminMessages` collection. Admin panel gets a new **Messages** tab (with an unread-count badge in the sidebar) to read and mark them as handled.

**4. Start Fresh (account reset)** — Settings → Danger Zone. Resets your Classwork Hub profile back to zero (name, photo, school, class, XP, streak — `onboarded` flips back to `false`) by deleting your own `users/{uid}` doc; signs you out; next sign-in with the same Google account creates a brand-new profile and routes you straight back through the welcome wizard. Asks first whether to also strip your uploaded work out of the class entirely, or leave it visible to classmates (your private "My Uploads" mirror is always cleared either way — that's inherently part of "your account"). **This does not delete your actual Google account** — only your Classwork Hub data — and it doesn't remove the actual image files from Cloudinary (no delete API available client-side without exposing a secret key), just their listing in Firestore.

**5. Profile photo picker — Google photo / custom upload / colored-initials —** available both during the welcome wizard and any time after from Settings → Account. "Initials" mode generates a small inline SVG avatar (no upload needed) in one of 8 colors, the same idea as Google's own fallback avatars.

**6. Class Chat messages now auto-expire after 48 hours** — every message gets an `expireAt` field set at send time; the chat listener hides anything past that mark immediately (belt-and-suspenders) regardless of whether the backend has actually deleted it yet. **Manual step required for real deletion, not just hiding:** Firestore's TTL policies aren't something `firestore.rules` can configure — they're a separate one-time setup step in the Google Cloud Console: go to `console.cloud.google.com/firestore/ttl` (or Firebase Console → Firestore Database → the "TTL" area), add a policy on the `expireAt` field for the `messages` collection group. Google's own docs say actual deletion typically happens within 24 hours of expiry (not instant) — but since the app already hides expired messages on the client the moment they pass 48h, nobody actually sees a stale message either way.

**Files changed this round:** `admin/index.html` (theme fix + Messages tab), `js/leaderboard.js` (exclude admin), `js/dashboard.js` (admin delete-any-upload), `js/activity.js` (admin chat moderation + 48h expiry), `js/settings.js` (rewritten — avatar picker, Contact Admin, Start Fresh), `js/welcome.js` + `welcome.html` (avatar picker added), `js/helpers.js` (`generateLetterAvatarDataUri`, `AVATAR_COLORS`), `settings.html` + `css/settings.css` (avatar picker, Danger Zone, Contact Admin UI), `firebase/firestore.rules` (self-delete on `users/{uid}`, new `adminMessages` collection). Cache-bust bumped to `20260805` on every page.

**Firestore Console step required:** yes — republish `firestore.rules` (self-delete + `adminMessages` rules). **Plus the new one-time TTL setup** described above for real (not just client-hidden) 48-hour chat deletion. No Storage rules change.


