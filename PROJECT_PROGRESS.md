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

## ➡️ Next step

Not yet decided — ask Prem what to prioritize from the "Pending" list above, or whether something new has come up.


