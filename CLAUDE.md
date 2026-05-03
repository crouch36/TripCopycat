# TripCopycat — Claude Working Document

> This file is the single source of truth for any Claude session working on TripCopycat.
> Read this before writing any code. Update it at the end of every session.

---

## Project Identity

- **Product:** TripCopycat — crowd-sourced travel itinerary platform
- **Entity:** Bishop Creek Ventures LLC, Canton OH (EIN obtained)
- **Owner:** Andrew Crouch — non-technical solo founder
- **Domain:** tripcopycat.com (Porkbun DNS → Vercel)
- **Admin email:** andrew@tripcopycat.com
- **Notifications email:** notifications@tripcopycat.com (Resend, domain verified)

---

## Stack

| Layer | Technology |
|---|---|
| Frontend | React 18 + Vite SPA |
| Database | Supabase (Postgres + Auth) — client in `src/supabaseClient.js` — never create a second instance |
| Image storage | Cloudflare R2 (`tripcopycat` bucket) |
| Hosting | Vercel Pro (under LLC, project name: tripcopycat) |
| Payments | Stripe live ($1.99 Blueprint purchases) |
| AI | Gemini 2.5 Flash (via `api/gemini.js`) |
| Email | Resend (via `api/notify-submission.js`) |
| Maps | Google Maps JS API + Geocoding API |

---

## Local Environment

- **Repo:** `C:\Users\crouc\tripcopycat`
- **Main file:** `src/App.jsx` (~4,900 lines monolith — component split partially done)
- **Deploy:** `git push origin main` ONLY — **never** `vercel`, `npx vercel`, `vercel deploy`, or any Vercel CLI commands
- **GitHub:** github.com/crouch36/TripCopycat
- **OS:** Windows (CRLF line endings — see critical section below)
- **Build command:** `cmd /c "npm run build"` — PowerShell blocks npm by default on this machine

---

## CRITICAL: Deployment Rules

- NEVER run `vercel`, `npx vercel`, `vercel --prod`, or `vercel deploy`
- All deployments happen automatically via `git push origin main`
- Vercel watches the repo and auto-deploys — no manual deploy ever needed
- Always run `cmd /c "npm run build"` locally before git push — must show ✓ built with no errors

---

## CRITICAL: App.jsx Working File Protocol

**Never ask Andrew to upload App.jsx unless there is a specific reason to believe the deployed version diverged from the last delivered output file.** Always work from `/mnt/user-data/outputs/App.jsx`. At the start of each session, verify key changes are present in the output file before writing new code. If a new upload is needed, state the reason explicitly.

**At session start, always grep for these markers to confirm output file is current:**
- `class ErrorBoundary` — ErrorBoundary present
- `function Toast()` — toast system present
- `PAGE_SIZE` — infinite scroll present
- `founding_copycat` — founding badge present
- `{/* Blueprint purchase button — public */}` — blueprint button public
- `alignItems:"flex-start"` in HowItWorksModal — iOS scroll fix present

---

## CRITICAL: Read Before Write Protocol

**Every session must follow this process before modifying any file:**

1. **Read the file first** — use the view tool to read the specific section being changed. Never modify from memory or assumption.
2. **State the current working state** — explicitly describe what the code currently does before changing it. If it's working, say so.
3. **State the scope** — list exactly which lines/functions will change and confirm no other functionality is affected.
4. **State dependencies** — identify any other files that depend on what's being changed.
5. **One fix at a time** — complete and verify one fix before starting the next.
6. **Diff verify** — after applying changes, run a line diff to confirm only intended lines changed.

**If any of these can't be answered confidently — stop and ask Andrew before writing code.**

---

## CRITICAL: Do Not Touch — Known Working State

### `index.html` OG Tags
- Homepage uses **real hardcoded values** — `og:title`, `og:description`, `og:url`, `og:image` all contain actual content
- `api/trip/[id].js` overrides these by **string-replacing the actual values** at serve time for trip pages
- Do NOT replace with `__OG_*` placeholders — the homepage is a static file and placeholders will show raw in social previews
- Do NOT change the exact strings used for replacement without updating `api/trip/[id].js` to match

### `api/image.js` — Allowed Hosts
- Must allow BOTH domains: `wnjxtjeospeblvqdqsdj.supabase.co` AND `pub-f680025b41de449893423994b6e1c42b.r2.dev`
- Removing R2 breaks: Instagram template download, OG image proxy for R2-hosted cover photos
- Do NOT revert to Supabase-only

### `vercel.json` Catch-All Exclusions
- `instagram-template.html` must remain excluded from the SPA catch-all
- `sitemap.xml` must remain routed to `api/sitemap.xml.js`
- `blueprint/sample` must remain routed to `api/sample-blueprint`
- Do NOT simplify the catch-all regex without preserving all exclusions

### `api/trip/[id].js` — OG Replacement Strings
- Replaces these exact strings: `TripCopycat | Real Itineraries from Real Travelers`, `User-submitted travel guides. Planned by others. Perfected by you.`, `https://www.tripcopycat.com`, `https://www.tripcopycat.com/og-default.png`
- If `index.html` OG values are ever changed, `api/trip/[id].js` replacement strings MUST be updated to match

### Instagram Template — Logo
- Uses `apple-touch-icon.png` — NOT `copycat.svg`
- Do NOT switch back to SVG, do NOT proxy the logo through `/api/image` during capture

### Admin Session Persistence
- Admin state stored in `sessionStorage` key `"tc_admin"` — set on login, removed on Exit Admin
- `useState` initializes from sessionStorage: `useState(() => sessionStorage.getItem("tc_admin") === "1")`
- Do NOT revert to plain `useState(false)`

### Sitemaps — Both Must Use www and /trips/
- `scripts/generate-sitemap.js`: `SITE_URL = "https://www.tripcopycat.com"` (www, not no-www)
- `api/sitemap.xml.js`: uses `https://www.tripcopycat.com` and `/trips/:id` (plural)

### SubmitTripModal Form Architecture
- Form text state lives in `SubmitFormStep` — NOT in `SubmitTripModal`
- `draftSaving` and `draftSaved` state variables do NOT exist — do not add them back
- Draft status uses DOM manipulation: `document.getElementById("draft-status")`
- `SubmitFormStep` is always mounted (display:none when hidden) — do not conditionally render it

### CRITICAL: Submit Flow Photo Upload — App.jsx inline SubmitTripModal
- `src/App.jsx` contains an **inline** `function SubmitTripModal(...)` — it does NOT import from `src/SubmitTripModal.jsx`
- `src/SubmitTripModal.jsx` exists as a separate file but is NOT rendered anywhere
- The inline `uploadPhoto` and `uploadGallery` in App.jsx MUST use R2 via `/api/upload-image` — **not** Supabase storage
- Fixed Apr 20 2026 — do NOT revert to Supabase storage uploads
- Current correct pattern uses `fetch('/api/upload-image?folder=photos...')` with raw binary body

### CRITICAL: React Import
- App.jsx must have `import React, { useState, ... }` — the `React,` default import is required for the `ErrorBoundary` class component
- Removing the default React import will cause `React is not defined` and white-screen the site

### Blueprint Purchase Button
- The GET BLUEPRINT $1.99 button in TripModal is **public** — no `isAdmin` guard
- Comment reads `{/* Blueprint purchase button — public */}`
- Do NOT wrap in `{isAdmin && ...}` again

---

## CRITICAL: File Handling — CRLF vs LF

- Windows files use `\r\n` (CRLF). Linux Python uses `\n` (LF)
- **Always normalize before editing:** `content = content.replace("\r\n", "\n").replace("\r", "\n")`
- **Always write with LF:** `open(path, "w", encoding="utf-8", newline="\n")`

---

## File Delivery Rules

- Deliver complete replacement files — never partial edits or diffs
- Git commands in isolated code blocks — never mixed with file content or prose
- Always work from `/mnt/user-data/outputs/App.jsx` — never ask Andrew to upload unless deployed version is suspected to have diverged
- Never run `vercel deploy` — deploy is `git push origin main` only

---

## Source File Map

| File | Lines | Purpose |
|---|---|---|
| `src/App.jsx` | ~4,900 | Main app — all components including inline SubmitTripModal. Contains ErrorBoundary, Toast, infinite scroll, founding badge logic. |
| `src/constants.js` | ~82 | `C`, `REGIONS`, `TAGS`, etc. — imported by all split components |
| `src/SubmitTripModal.jsx` | ~711 | EXISTS but NOT imported by App.jsx — reference for R2 upload patterns only |
| `src/SubmitFormStep.jsx` | ~280 | Form fields. Always mounted. Owns all text state via forwardRef. |
| `src/HybridProcessor.jsx` | ~143 | AI brain dump + photo processing |
| `src/PhotoImportModal.jsx` | ~263 | Photo album import, EXIF extraction |
| `src/supabaseClient.js` | — | Single Supabase instance — never create a second |

---

## Code Stability Rules

- Never declare a `useState` or `useRef` AFTER a `useEffect` that references it
- Never use `transition: "all"` — always specify individual properties
- Never add `overflow:hidden` to the TripModal overlay — breaks mobile scroll
- Window globals in use: `__openTrip`, `__closeTripModal`, `__setViewingProfile`, `__setShowLegal`, `__INITIAL_TRIP_ID__`, `__toast` — do not remove or rename
- `window.__toast("message")` — global toast, auto-dismisses 2.5s, available site-wide

---

## Vercel Environment Variables (all set)

```
VITE_SUPABASE_URL
VITE_SUPABASE_ANON_KEY
SUPABASE_SERVICE_KEY
SUPABASE_ANON_KEY
VITE_GOOGLE_MAPS_KEY
GOOGLE_GEOCODING_KEY
VITE_GEMINI_API_KEY
VITE_STRIPE_PUBLISHABLE_KEY
STRIPE_SECRET_KEY
STRIPE_WEBHOOK_SECRET
R2_ACCOUNT_ID
R2_ACCESS_KEY_ID
R2_SECRET_ACCESS_KEY
R2_BUCKET_NAME                # tripcopycat
R2_PUBLIC_URL                 # https://pub-f680025b41de449893423994b6e1c42b.r2.dev
RESEND_API_KEY
GEOCODE_SECRET
VITE_GEOCODE_SECRET
```

---

## API Functions (`api/`)

| File | Purpose | Notes |
|---|---|---|
| `gemini.js` | Proxies Gemini AI requests | Handles `{ imageUrls, prompt }` — R2 URL flow |
| `upload-image.js` | Uploads raw binary to R2 | Reads raw request body — NOT JSON |
| `approve-submission.js` | Approves submission → inserts into `trips` | Uses service key. Awards founding_copycat badge to first 50 unique authors. |
| `geocode-venues.js` | Geocodes venues on approval | Uses `GOOGLE_GEOCODING_KEY` |
| `notify-submission.js` | Sends email on new submission | From notifications@tripcopycat.com |
| `trip/[id].js` | Server-renders trip pages for SEO | Canonical uses `/trips/:id` |
| `sample-blueprint.js` | Serves sample Blueprint page | Share button uses inline `showToast()` — no React toast |
| `stripe-webhook.js` | Handles Stripe checkout events | Live keys only |
| `create-checkout.js` | Creates Stripe checkout session | Called from TripModal GET BLUEPRINT button |
| `sitemap.xml.js` | Dynamic sitemap | Uses `/trips/:id` URLs |
| `image.js` | Image proxy | Allows Supabase AND R2 — do not remove R2 |

---

## Supabase Schema Notes

### Tables
- `trips` — published trips. Key columns: `venue_coords`, `image`, `gallery`, `focal_point`, `featured`, `user_id`, `author_name`, `author_email`
- `submissions` — timestamp column: `submitted_at` (NOT `created_at`)
- `blueprint_purchases` — no `user_id` column
- `profiles` — columns: `id`, `display_name`, `email`, `created_at`, `featured_contributor`, `bio`, `founding_copycat` (boolean, default false)
- `drafts` — one row per user, `form_data` jsonb

### RLS
- `trips`: public read, service role insert/delete — client anon key cannot insert
- `submissions`: public read, anon/authenticated insert, service role update
- `profiles`: public read, users insert own

---

## Founding Copycat Badge

- **Asset:** `/public/founding-badge.png` — same-domain, no CORS
- **DB:** `profiles.founding_copycat` boolean — add via: `ALTER TABLE profiles ADD COLUMN founding_copycat boolean DEFAULT false;` (already run)
- **Auto-award:** `api/approve-submission.js` counts distinct approved `author_email` values after each approval. If ≤ 50, sets `founding_copycat = true` on matching profile
- **Display:** 18px on TripCard author line; 48px in ProfilePage header
- **Fetch:** `foundingCopycats` Set loaded on page mount from profiles table

---

## UX & Features Shipped (Apr 21 2026)

| Feature | Status | Notes |
|---|---|---|
| ErrorBoundary | ✅ | Wraps entire App. Requires `import React,` default import. |
| Font preconnect | ✅ | index.html preconnects fonts.googleapis.com |
| Lazy images | ✅ | `loading="lazy"` on trip cards + gallery |
| document.title | ✅ | Updates on trip modal open/close |
| Toast system | ✅ | `window.__toast()` global, 2.5s auto-dismiss |
| Skeleton loaders | ✅ | Shimmer cards during Supabase load |
| Quality badges | ✅ | `✦ 6 venues · 4 photos` on trip cards |
| alert() removed | ✅ | All 10 locations replaced with toast or inline error |
| Blueprint button public | ✅ | No isAdmin guard — visible to all visitors |
| Infinite scroll | ✅ | PAGE_SIZE=20, IntersectionObserver, fetchMoreTrips |
| Server-side search | ✅ | 300ms debounce, Supabase .or() query |
| allTrips deduplicated | ✅ | findIndex dedup prevents doubles |
| Founding Copycat badge | ✅ | Auto-awarded on approval to first 50 unique authors |
| HowItWorks iOS scroll | ✅ | alignItems:flex-start + WebkitOverflowScrolling |
| Sidebar mobile overlay | ✅ | Full-screen overlay on mobile instead of inline |
| R2 upload fix | ✅ | App.jsx inline SubmitTripModal now uses R2 not Supabase |

---

## Roadmap — Pending

### Tier 2
- **t2-1:** Public save count on trip cards — needs `save_count` DB column + RLS + UI
- **t2-2:** Post-read submission prompt — session counter, shows nudge after 3 trips viewed
- **t2-4:** Friction-ladder submit entry — destination field before full modal, dedicated session

### Tier 3
- **t3-1:** Similar trips at bottom of TripModal — scoring logic exists, needs UI
- **t3-2:** Destination pages `/destination/paris` — SEO leverage at scale
- **t3-3:** Email capture on high-intent actions

### Other Pending
- SVG favicon not square — `copycat.svg` viewBox 953×1166
- Gallery re-upload — Scotland, Prague, Amalfi, Ireland galleries
- Supabase egress resets May 6 2026 — watch usage
- Google Maps export — KML works for Google Earth; add instructional route for Google Maps import
- Leaked password protection — needs Supabase custom SMTP
- Founding Copycat homepage banner — announce first 50 spots with live remaining count

---

## Growth Strategy

### Founding Copycat Campaign
- First 50 unique approved authors earn permanent badge
- Announced via social media — Option 2 post drafted (see session history)
- Homepage banner planned showing remaining spots (live count from DB)

### Content Strategy
- "Give to Get" credit system planned medium-term — upload 1, earn credits for others
- Hold micro-blueprints, bounties, Instagram importer until 50+ real submissions
- Personal outreach to early submitters most effective at current scale

---

## SEO Infrastructure

- `api/trip/[id].js` server-renders trip pages — always returns 200
- Canonical URL format: `/trips/:id` (plural — matches both sitemaps)
- JSON-LD: `TouristTrip` + `FAQPage` schema on each trip page
- Search Console: Turks/Hawaii/Montreal requested Apr 19 — check May 1-7

---

## Image Storage

### Cloudflare R2 (all new uploads)
- Public URL: `https://pub-f680025b41de449893423994b6e1c42b.r2.dev`
- Subfolders: `photos/` (cover), `gallery/` (gallery), `temp/` (Gemini)
- Upload: `POST /api/upload-image?folder=X&type=image%2Fjpeg&name=filename.jpg` with raw binary body

### Supabase Storage (legacy)
- Bucket `trip-photos` still exists, no longer used for new uploads
- Egress grace period until May 6 2026

---

## Playwright Test Suite

### Location
`C:\Users\crouc\tripcopycat\tests\`

### Run commands
```
cmd /c "npx playwright test --config=playwright.config.cjs"
cmd /c "npx playwright test --config=playwright.config.cjs --grep "Phase 4""
```

### Status (Apr 21 2026)
- 46-48/50 tests passing
- Phases 1-6, 8-11: clean
- Phase 7 (draft): flaky by nature — 20s timer dependency, acceptable

### Critical selector findings
- Form inputs have NO placeholder — `getByLabel()` does NOT work
- Use `page.evaluate()` + `label.nextElementSibling` + React native setter
- Cover photo: requires `{ name, mimeType: "image/jpeg", buffer: require("fs").readFileSync(path) }`
- Gallery inputs work with bare paths
- Submit button: exactly `"Submit Trip"` — disabled until Terms checkbox checked

---

## Color System (key tokens)

```js
C.slate   = "#1C2B3A"   // Primary dark navy
C.amber   = "#C1692A"   // Primary orange / CTA
C.cta     = "#C4A882"   // Warm sand
C.white   = "#FFFFFF"
C.seafoam = "#FAF7F2"   // Page/modal background
C.tide    = "#E8DDD0"   // Borders
C.muted   = "#A89080"
C.green   = "#7A9E5A"
C.red     = "#B03A2E"
```

---

## Instagram Post Template

- File: `public/instagram-template.html` — excluded from SPA catch-all
- Uses `apple-touch-icon.png` — NOT `copycat.svg`
- Share button uses inline `showToast()` — NOT `window.__toast()` (outside React tree)
- AI caption via direct Gemini browser call

---

## Admin Queue

- Opens on Needs Review tab by default
- Approve: inserts to `trips`, fires geocoding, sets `founding_copycat` if ≤ 50 unique authors
- Admin session: `sessionStorage` key `"tc_admin"`

---

*Last updated: May 3, 2026 — Full UX improvement batch complete (ErrorBoundary, lazy images, toast system, skeleton loaders, quality badges, alert() removed, Blueprint public, infinite scroll, server-side search). Founding Copycat badge shipped. HowItWorks iOS scroll fix. Mobile sidebar filter fixed. App.jsx working file protocol added. React default import required for ErrorBoundary. Blueprint button confirmed public. Growth strategy and social launch documented. No known photo bugs outstanding — photo issues on trips are resolved.*
