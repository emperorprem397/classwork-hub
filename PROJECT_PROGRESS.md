# Classwork Hub — Project Progress

**Version:** 1.10 (Round 26 — hero permissions bug diagnosed [needs manual Firestore rules step], full-bleed hero, coverflow hover fixed + bigger cards, subject line-icons)
**Live site:** https://classwork-hub.vercel.app/
**Stack:** Plain HTML/CSS/JavaScript (ES modules, no bundler/framework) — Firebase Auth (Google popup) + Firestore + Cloudinary (images/PDFs) — hosted on GitHub, deployed on Vercel.

Refer to this file before making changes — it's the single source of truth for
current architecture, what's done, what's pending, and what's next. For the
round-by-round history of how it got here, see `CHANGELOG.md`.

> This build was consolidated from every round shipped so far (`FINAL` →
> round 11 → round 12 → two hotfixes → round 13 → round 14 → round 15 →
> round 16), verified file-by-file rather than assumed from the newest zip.
> Link/reference verification, dead-file scan, and a Firestore-rules
> brace-balance check all ran clean — see "Verification" below.

---

## What it is

Students in a class upload photos (or now PDFs) of completed notebook/classwork
pages so absent classmates can catch up. Open to any school (multi-tenant from
day one), with a lightweight XP/streak/rank system for engagement.

**Data hierarchy:** School → Class → Subject → Date → Uploads
**Roles:** Student, Admin (self) — admin has read/write access everywhere.

---

## Folder structure

```
/                     — index.html (landing), welcome.html, school-select.html
/admin                — self-contained admin panel (own inline script, no
                         shared imports — deliberate, keeps it dependency-free)
/css                  — one stylesheet per page + shared theme.css
/js                   — one module per page + shared modules:
                         firebase-config.js, helpers.js, theme.js, nav.js, topbar.js
/firebase             — firestore.rules, storage.rules (Storage is unused —
                         locked to allow read,write: if false)
PROJECT_PROGRESS.md   — this file (current state)
CHANGELOG.md          — round-by-round history
README.md             — setup/deployment instructions
```

This is intentionally flat, not the `/assets /icons /docs` layout sometimes
used for larger apps — for a project this size that split would scatter
related files (a page's HTML/CSS/JS) across more folders for no real benefit,
so it was kept as-is rather than churned for its own sake.

---

## Completed modules

- **Auth & onboarding** — Google Sign-In (popup), first-run welcome wizard (name/theme/avatar/school), school-select with admin approval workflow, self-serve "add your school" if not listed
- **Dashboard** — "Today's Work" per subject, upload modal (photos + PDFs, drag-and-drop, mandatory Classwork/Homework tag, optional title tag, multi-file, collaborative — several classmates can add to the same subject/day)
- **Subjects** — browse the last 7 days per subject; self-serve add/edit/delete subject (any classmate, not just admin)
- **My Uploads** — personal history (private per-user mirror), delete own upload, per-file delete/replace/reorder within an upload (new-format uploads)
- **Homework** — post an item, classmates check it off individually
- **Leaderboard** — ranked by XP within the student's own class; admin excluded
- **XP / rank / streak system** — +10 XP per upload, +5 first-of-day bonus, +2 daily streak tick; Bronze → Silver → Gold → Platinum
- **Activity Log** — who added/edited/deleted a subject or made an upload, append-only, real profile names
- **Class Chat** — real-time, edit/delete own message, typing indicator, 48h app-level auto-expiry; topbar bell deep-links straight to the Chat tab (`activity.html?tab=chat`)
- **Universal Search** — subjects, uploads, dates
- **Theming** — exactly two official themes, Matte Dark (default) and Soft Light, synced to Firestore, toggleable from the top navbar or Settings/Admin → Appearance. Sidebar, topbar, and dashboard subject cards fully match the reference design; other pages inherit the color tokens but haven't had page-specific layout rework yet (see Pending below).
- **Top navbar** — search shortcut, theme toggle, notification bell (unread dots for chat/activity/dashboard), profile dropdown
- **Settings** — tabbed (Account/Appearance/Notifications/Privacy/About), avatar picker (Google photo/upload/colored initials), Contact Admin (WhatsApp/email/in-app), "Start Fresh" account reset
- **Admin panel** — schools/classes/subjects/users management, Pending Schools approval, Messages inbox, Activity Log, Browse Classes (join-free browsing of any school/class's subjects/students/uploads), admin superpowers within a joined class (delete any upload, moderate any chat message)

---

## Firestore collections (summary — see `firebase/firestore.rules` for the authoritative, commented version)

- `users/{uid}` — profile (name, photo, schoolId, classId, role, XP, streak, theme, lastSeen* fields); self-writable except `banned`; self-deletable (Start Fresh)
  - `users/{uid}/myUploads/{uploadId}` — private per-user upload mirror
- `schools/{schoolId}` — any signed-in user can create (pending approval); admin manages
  - `classes/{classId}`
    - `subjects/{subjectId}` — any classmate can create/edit/delete
      - `entries/{entryId}` — one doc per subject per date (`YYYY-MM-DD`), collaboratively appended to; holds the `uploads[]` array (each `{uid, name, type, title, photoURLs, files[], uploadedAt}`) plus flattened `photoURLs`/`uploadedBy`/`uploaderNames` for backward compatibility
    - `activity/{activityId}` — append-only class activity log
    - `messages/{messageId}` — Class Chat, author/admin can edit or delete
    - `typing/{uid}` — ephemeral typing-indicator presence
    - `homework/{hwId}` — with `completedBy/{uid}` sub-tracking
- `adminMessages/{messageId}` — one-way Contact Admin mailbox, admin-only read

**Access model:** every collection under a class is gated by `inClass(schoolId, classId)` (same school+class as the requester's own profile) or `isAdmin()`. Admin therefore already has universal read access — the Round 16 "Browse Classes" admin feature needed no rules change, only new UI.

---

## Cloudinary setup

- Unsigned upload preset (no backend/signing needed — the browser uploads directly to Cloudinary)
- Images: client-side compressed (max 1600px, JPEG q0.82) before upload, tagged into an `images` folder
- PDFs: uploaded as-is via Cloudinary's `/auto/upload` endpoint (auto-detects resource type), tagged into a `pdfs` folder
- No Firebase Storage — `firebase/storage.rules` is intentionally locked closed

To set this up on a fresh Cloudinary account: create an unsigned upload preset, then set `CLOUDINARY_CLOUD_NAME` and `CLOUDINARY_UPLOAD_PRESET` in `js/firebase-config.js` to match.

---

## Deployment

1. GitHub repo → Vercel (auto-deploys on push to the connected branch; static site, no build step)
2. Firebase project: Auth (Google provider enabled), Firestore (in production mode), Storage feature can stay disabled/unused
3. After any `firebase/firestore.rules` change: Firebase Console → Firestore Database → Rules → paste → Publish (this is a separate manual step — pushing to GitHub does not touch Firestore rules)
4. Cloudinary: unsigned upload preset configured as above
5. Optional: Firestore TTL policy on the `messages` collection group's `expireAt` field (Firebase Console → Firestore → TTL) for actual background deletion of expired chat messages — not required, since expiry is already enforced client-side regardless

---

## Verification (this consolidation pass)

- Every `<script src>`/`<link href>` across all pages resolves to a file that exists — checked programmatically, zero broken references
- Every internal `<a href="*.html">` page link resolves to a real page — zero broken links
- No unreferenced/dead `.js` or `.css` files found (all are wired into at least one page or imported by another module)
- Every ES-module JS file passes a syntax check; the admin panel's inline script does too
- `firestore.rules` braces balance (44 open / 44 close)
- No duplicate/backup/temp files found in the tree

---

## Known limitations

- **Cloudinary account may block PDF/ZIP delivery by default** (a Cloudinary-side security setting, not this app's code) — if PDFs fail to open with a 401, enable PDF/ZIP delivery in Cloudinary Console → Settings → Security.
- Per-file management (My Uploads) only works on uploads made from Round 16 onward — pre-Round-16 uploads only support whole-record delete (no stable per-file identity to key on)
- Unread badges are yes/no dots, not precise counts (deliberate — avoids composite indexes)
- PDF viewing uses the browser's native viewer in a new tab rather than an embedded in-page viewer (no bundler in this stack for a React PDF library)
- Collaborative entry updates (`entries/{entryId}`) trust class membership as the boundary — rules can't easily enforce "only appended, never removed" for a shared array without a Cloud Function
- Admin's Firestore TTL Console setup for `messages` is optional and was last left unfinished (a Google Cloud IAM permissions issue, unrelated to this app's own rules) — not blocking anything

---

## Pending / not built yet

**Round 18–21 design-system rollout (in progress):**
- [x] Sidebar, topbar, Dashboard subject cards
- [x] Subjects and My Uploads restyled to the "large rounded parent container" layout
- [x] Homework (all 3 tabs) and Leaderboard restyled to the same container layout
- [x] Profile hero card polished; Search restyled to grouped rounded containers
- [x] Old hardcoded cyan accent colors swept and retinted across the whole codebase to match the 2-theme token system
- [x] Real per-subject imagery — keyword-matched default photos on the dashboard subject cards, plus a per-subject custom cover upload (square crop) in Add/Edit Subject
- [x] Profile photo upload now goes through a preview + drag + zoom crop step (`js/cropper.js`) instead of squashing whatever ratio was picked — fixed in Settings and the Welcome wizard
- [x] Navbar redesigned — glassmorphic sticky/blurred, search pill, message icon, Work shortcut, enlarged avatar
- [x] All destructive confirmations standardized to one shared modal component (`js/confirm-dialog.js`) instead of a mix of custom modals and browser `confirm()`
- [x] Dashboard subject cards show a "new activity" glow + badge for subjects with unseen uploads, on top of the existing sidebar dot
- [x] Onboarding-skip-after-reset bug found (auth.js race condition) and fixed
- [x] Matte Dark retoned — layered charcoal grays instead of near-flat black, subtle gradient wash
- [x] Sidebar + navbar icons replaced with minimalist line-icon SVGs instead of emoji
- [x] "Upload one" avatar tile now shows an actual live preview of the chosen photo (Welcome wizard + Settings), and Settings restores the correct active tile/preview on reload
- [x] Subject cards as a coverflow/3D carousel (center-focused, hover-to-enlarge, beveled-light card treatment) — done
- [x] Editable hero section (minimalist hero image + typography-picker tagline) on the dashboard — done, class-shared like subjects
- [x] Subtle scroll-reveal animation on the dashboard (hero, profile card, Today's Work) — fail-open by design
- [ ] Scroll-reveal on other pages (currently dashboard-only)
- [ ] Activity/Chat page — inherits new colors/sidebar/topbar automatically, page-specific layout not yet reworked to the container style
- [ ] Login (`index.html`) and School Selection pages — not yet on the shared token system at all (`index.html` uses its own standalone `css/style.css`)
- [ ] Welcome wizard steps beyond the Appearance step
- [ ] Admin panel's dashboard/users/schools/uploads views — inherit the 2-theme colors automatically, but not yet visually reworked to the new layout language
- [ ] Modals, empty states, and loading screens — individual pass against the reference not yet done
- [ ] Mobile-specific pass on the Round 23 navbar/theme changes (built with a mobile breakpoint in the CSS, but not device-tested this round)

**Other:**
- Comments on uploads
- In-app announcements (separate from the Activity Log)
- Notebook viewer upgrade beyond "opens in new tab" — in-page zoom/fullscreen for images specifically
- Leaderboard time filters (weekly/monthly/all-time)
- Contribution calendar (GitHub-style heatmap on Profile)
- Real per-file identity for pre-Round-16 legacy uploads
- Precise unread counts (currently dot-only, by design)

---

## Workflow reminders

- Deliver only changed/new files as a zip for incremental rounds (this consolidated build is the one exception — a full-repo replacement)
- Always call out manual steps (Firestore Console rule publishing, Cloudinary preset changes) separately from the GitHub upload
- Update this file after every milestone; log the round in `CHANGELOG.md`
