# Acting Intern — Session Handoff / Working Doc

Living status doc so work can resume in a fresh session. Repo:
`/Users/kevinkeet/Documents/Claude applications folder/synthetic-ehr` (actingintern.com, GitHub Pages).

## How the app works (fast facts)
- Vanilla HTML/JS/CSS, **no build system**. `index.html` loads all scripts; `js/router.js` hash routing.
- **Two git remotes — push BOTH after every commit:** `git push origin main && git push shared main`.
- **Cache busting:** every `<script>/<link>` in `index.html` uses `?v=YYYYMMDD[suffix]`. Bump it (search/replace all + `window.__CACHE_V`) whenever you change **JS or CSS**. **Data JSON under `data/` is NOT cache-busted** — edits take effect on reload. Current version: **`20260722u`**.
- **Access gate password:** `0slerian` → PBKDF2 → decrypts the embedded Anthropic key into localStorage. Never log/commit the decrypted key.
- **The shared Anthropic API key repeatedly runs OUT OF CREDITS** (Opus runs burn it fast). When it does, the live assessment (chat + grading) is DOWN. Only the user can top it up.
- **Supabase** project (`piwoinyrlicvndpsmtde`) auto-pauses on free tier; resume from the dashboard before use.
- **Live testing:** the Claude Preview MCP drives a local dev server (`ehr-dev` in `.claude/launch.json`). To reach the assessment runner programmatically: `UserCode.set('X'); ModeManager.set('assessment',{navigate:false}); await AssessmentEngine.start('PAT00N'); location.hash='#/assessment/run'; router.handleRoute();` then hide `#access-gate-overlay` for screenshots.

## The study (why this exists) — ASSESSMENT IS THE ONLY IN-SCOPE FEATURE
**Goal:** measure a resident's ability to use AI to solve clinical tasks. This assessment will be paired with an educational intervention that only some residents receive; we then compare performance across arms to see if their performance improves (an RCT). **Premise:** we use validated cases with validated scoring rubrics (from prior work) and have built a synthetic EHR around them to create a realistic, real-world clinical environment.
**Scope:** the app is dual-purpose today (Assessment / AI Tutor / AI Assistant modes), **but for the study only the ASSESSMENT mode is used — the Tutor and Assistant modes will be HIDDEN in the study deployment.** Focus all work on the assessment component: cases PAT002–PAT007, the context-bounded chatbot, the grader, and Supabase logging. Do not invest in Tutor/Assistant unless asked.
Flow: participants take a timed, chart-gated case, answer each prompt in their own words (informed by the context-bounded chatbot), LLM-graded against the rubric, logged to Supabase.
**Central finding from simulations this session:** on the current rubrics, naive **copy-paste beats skilled prompting** — even Opus-as-a-trained-resident (knowledge-suppressed) did NOT beat copy-paste, and multi-turn "challenge/steelman" often *lowered* scores. Root cause: rubrics reward **coverage/enumeration**, which a strong model supplies for free; they're blind to the judgment the training teaches. This is an instrument problem, not (only) a training-effect problem. (Full analyses delivered as Word docs in `~/Downloads/`.)

## Case ↔ patient ↔ source-rubric map
| Case | Patient | Topic | Source rubric docx (in ~/Downloads) |
|---|---|---|---|
| 1 | PAT003 Nguyen | lung nodule (Delphi) | "Management Cases 1-5.docx" (Case #1 section) |
| 2 | PAT004 Bell | PE + liver mass + IVC | "Case 2 Rubric (Management Case 1 renamed).docx" |
| 3 | PAT005 Whitlock | cirrhosis / FFP / drainage | "Case 3 Rubric.docx" |
| 4 | PAT006 Pierce | post-op AF | "Case 4 Rubric.docx" |
| 5 | PAT007 Brooks | drug fever / TIPS | "Case 5 Rubric draft.docx" |
PAT002 (Sandoval, SLE/NEJM) has NO source docx rubric — graded by the older essential/bonus format; out of scope for "prior-study fidelity."

## Grading mechanism (IMPORTANT)
`js/services/assessment-grader.js`: `grade()` uses the **points path** (`prompt.scoringRubric.rubricText` + `maxPoints`, awards points per the rubric's own rules) whenever `scoringRubric.rubricText` exists; otherwise falls back to an **essential/bonus formula** (`hits/count + 0.08/bonus cap +0.20 − 0.15/redflag`) that CANNOT reproduce docx points.
- **Points-graded (docx-faithful): PAT003, PAT004, PAT005, PAT006, PAT007** (as of the rubric-fidelity fixes below).
- **Essential/bonus only: PAT002.**

## DONE this session (high level)
- **Security/RCT hardening:** grader prompt-injection delimiting; stopped syncing the API key to Supabase; `claude-api.js` logs `error.message` only; **Supabase migration `004_scope_code_based_access.sql` applied LIVE** (scopes anon SELECT/UPDATE to an `x-participant-code` header via a custom fetch wrapper in `supabase-sync.js`) — closed the "any participant reads all rows" hole.
- **RCT data-loss fixes:** offline write-retry queue in `assessment-engine.js`; `complete()` merges in-memory rows so a failed SELECT can't zero the score; draft autosave + `beforeunload` guard + SYNCING indicator in `assessment-panel.js`.
- **Loader robustness:** `data-loader.js` treats `problems/resolved.json` & `medications/historical.json` as OPTIONAL (404 → empty); added the two missing PAT003 files (that bug broke the Problem List / Meds tabs during assessment).
- **Assessment runner UI rebuilt:** chart is full-height on the left (`#main-content`); a persistent right-rail **dock** (attached to `<body>`) holds the timer/progress bar + **tabbed panel: "Your Answer" / "AI Assistant"** (the chatbot `<aside>` is relocated into the rail). Single reservation: `body.assessment-dock-open .main-container { margin-right: var(--arail) }` (do NOT also pad `#main-content` — that double-squeezes the chart, which broke the Notes viewer). Compact 2-row bar. Removed the collapse toggle.
- **Removed the minimum-character-count** on answers (all questions): dropped the `_submitCurrent` gate + UI, zeroed 32 `minLength` fields.
- **PAT003 (Nguyen) content audit:** fixed smoking contradiction (NOTE_HX_001 current-smoker → quit-2004), brother lung-cancer death year (family_history 2018 → 2026), and the screening-history note. Nodule on problem list (PRB013) is INTENTIONAL — left as-is.
- **RUBRIC-FIDELITY RECONCILIATION (validity-critical), just committed:**
  - **PAT003:** added points `scoringRubric` to all 5 Qs encoding the **Delphi 6/9/11/7/3 = 36** (with the two-of-three / one-of-two / two-of-four partial-credit groups). Now points-graded.
  - **PAT004 AP2-Q5:** un-merged the IVC-in-this-case question back into the docx's THREE prompts — `AP2-Q5a` (decision 5, Yes-keyed), `AP2-Q5b` (arguments FOR 3), `AP2-Q5c` (arguments AGAINST 3), + `AP2-Q6` (8). Both reasoning sides now scored regardless of stance (fixes the "No answer capped at 3/8" problem the user hit).
  - **PAT005 AP2-Q4:** split fused PleurX+TIPS into `AP2-Q4` (PleurX 4) + `AP2-Q4b` (TIPS 4).
  - **PAT005 AP3-Q5:** realigned to the docx PRE-transplant framing — anchor moved to `2027-07-05`, scenario/stem rewritten, **added NOTE010** (pre-transplant improvement note) so the chart supports it, removed the stale transplant-physiology `rubric` block. Kept the docx 5-item `scoringRubric`.
  - Left faithful as-is: PAT006 monitor sub-parts and PAT004 1a/1b (sub-parts of a single docx question).
  - Verified point totals: PAT003=36, PAT004=71, PAT005=27, PAT006=23, PAT007=78.5; all Qs points-graded.

## DONE 2026-07-22
- **Chart Review "Latest Vitals" widget fix:** it only read the legacy `{systolic, diastolic, spO2}` vitals shape, but ALL study cases (PAT003–007) use `{bloodPressure: "112/70", oxygenSaturation}` — so every assessment case's chart landing page showed "undefined/undefined mmHg" / "undefined%". `chart-review.js renderVitalsWidget` now normalizes both shapes (mirrors `vitals.js`). Verified live on PAT005 (116/72 mmHg, 99%). Cache bumped to `20260722`.
- Note: two abandoned test attempts under participant code `CLAUDEVERIFY` may exist in Supabase (or died in the offline queue) from the live verification — ignore/delete.

## SCENARIO-BRIEF REWRITE — DONE (all 14 APs)
**Decision:** the old `scenarioBrief` pre-digested the case and in places leaked the answer (PAT007 AP3 stated "drug fever and drug-associated neurotoxicity"; PAT005 AP2 stated the FFP conclusion; PAT003 AP1 narrated the nodule-dropped-off-the-notes insight). Piecing the picture together from the chart IS part of what we measure.
**New format (per user):** an orientation stub that gives (a) the TIME JUMP, (b) the reason for the encounter / presenting problem, (c) "the chart is updated with...", (d) "Please review the chart and answer the questions below." It does NOT summarize the clinical picture, workup results, or conclusions.
Example (PAT004 AP2): *"Now we jump ahead about a month. Mr. Bell went to his scheduled outpatient liver biopsy today (8/10/2027), but arrived with recurrent shortness of breath and chest pain and was sent to the emergency department; he has been readmitted. The chart is updated with the interval outpatient records and today's workup. Please review the chart and answer the questions below."*
**Verified:** (1) every trigger fact each old brief carried is present in the chart AND visible at/before that AP's anchorDate under the chart gate (checked programmatically); (2) no new stub names a diagnosis, conclusion, or treatment (leak-grep clean on all 14). Questions unchanged (validated). Originals in git history.
**Methods caveat:** the source docx presented these as vignettes, so this is a deliberate departure from the validated ADMINISTRATION format (scoring unchanged). Consider A/B testing with vs. without once credits return.
**Watch:** residents must now reconstruct from the chart within the same 20-30 min limits — TIME LIMITS MAY NEED LOOSENING. This is the top thing to observe in the first live run.

## HIDDEN CASES (current study build)
**PAT001 (Morrison, demo) and PAT002 (Sandoval, SLE/NEJM) are HIDDEN.** Implemented as:
- `data/patients/index.json`: both carry `"hidden": true` (+ `_hiddenNote`).
- `js/data-loader.js loadPatientIndex()` filters out `hidden` patients — this feeds BOTH the patient switcher (`patient-header.js`) and the nav (`navigation.js`).
- `js/services/assessment-data.js` `CASE_IDS` no longer lists PAT002.
- `js/app.js` `defaultPatientId` moved PAT002 → **PAT003** (the old default was being hidden).
**To unhide:** remove the `hidden` flag(s), re-add PAT002 to `CASE_IDS`. Patient data files are untouched, so past attempts/results still resolve by id.
Verified live: visible patients = PAT003–007; assessment cases = PAT003–007; default = PAT003; no boot error.

## SIDEBAR "ASSESSMENT" LINK (return-to-questions)
The sidebar Assessment link was present in markup but hidden by CSS (`.assessment-nav-section .assessment-mode-link { display:none }`). Unhidden — it is how a resident gets back to the questions after browsing the chart. `App._navigateToAssessment` already routed correctly: `#/assessment/run` when an attempt is active, else `#/assessment/start`. The `.nav-section-learn` (tutor) link stays hidden. Verified live: from `#/notes`, clicking it returns to `#/assessment/run` with the answer box restored.

## CASE AUDIT — ANSWER-ALREADY-IN-CHART (new bug class)
**PAT005 AP1 FIXED:** Q1 asks *"would you perform a paracentesis and a thoracentesis?"* and Q2 *"would you give blood products?"* — but the IR procedure note (NOTE002, 3/10 **17:00**) documenting both procedures (and no FFP) was VISIBLE under the old 23:59 anchor. Anchor + chartGate moved to **2027-03-10T15:00:00Z**, between the ED workup (note/labs 13:30, US+CXR 13:40/13:45, vitals 14:00 — all still visible) and the 17:00 procedure note (now hidden). Verified live.
**GENERALIZE:** any question of the form *"would you do X?"* must have its anchor set BEFORE the chart documents X being done.
**SWEEP OF THE OTHER 4 — DONE:**
- **PAT003 AP1: clean.** No pre-arranged nodule biopsy/clinic referral visible (the discharge summary deliberately omits the nodule — that IS the case).
- **PAT004 AP1: clean** (the 3-day hold + biopsy timing live in the 8/8 IR note, correctly hidden at the 7/10 anchor). **AP2: acceptable** — NOTE009 lists 'the role, if any, of an IVC filter' as an OPEN ITEM for the team; it raises the question without answering it, which is appropriate framing, not a leak.
- **PAT006 AP1: ONE REAL ISSUE (unresolved, needs a decision).** Q1 asks what ADDITIONAL monitoring/testing/treatment you'd recommend; the rubric awards 1 pt for VTE prophylaxis — but NOTE003 and NOTE005 both say prophylactic enoxaparin was **already started today**, so it is handed to the resident and isn't 'additional'. Note this also diverges from the source docx vignette, which states she is on **no anticoagulation or antiplatelet medications**. **FIXED (option a):** pharmacologic VTE prophylaxis is now deferred to POD#2 — at POD#1 she is on mechanical SCDs only, so the chart matches the docx ('no anticoagulation or antiplatelet medications') and recommending VTE ppx is a genuine contribution. Changed: MED010 startDate 6/11→6/12; NOTE003 and NOTE005 POD#1 wording; NOTE010 'started POD#1'→'POD#2'. Verified live: enoxaparin absent from the AP1 med list, present at AP2. TSH and echo are handled WELL by contrast — LAB002 lists 'Thyroid panel (TSH): Not ordered' and NOTE005 says 'NO prior echocardiogram on file', i.e. the gaps are shown without the answers. **AP2: clean** (no apixaban/monitor pre-ordered).
- **PAT007 AP1/AP2: clean** (weight-loss workup items not pre-ordered; no 'stop antibiotics' recommendation visible before AP2 — the 5/14 ID consult recommends the opposite, which is the intended anchoring trap).

## TIME IS NO LONGER A LIMIT + CHART REFRESH ON PHASE ADVANCE
- **No time limit.** The timer now counts UP (elapsed) and NEVER auto-submits. `time_used_seconds` is still recorded for analysis. `_handleExpired` is now dead code (left in place, uncalled). Per-case `warning` text rewritten to say there is no limit. NOTE: `timeLimitMinutes` / `totalTimeLimitMinutes` still exist in the JSON but are no longer enforced or displayed.
- **Chart now refreshes when the phase advances.** The gate always advanced correctly in the data layer (verified: PAT005 AP1 = 3 notes → AP2 = 8), but the on-screen chart page did not re-render, so it looked stale until the resident navigated. `assessment-advanced` now calls `router.handleRoute()` and shows a 'New information has been added to the chart.' toast. Verified live: notes list went 3 → 8 on screen without navigating.

## RAIL LAYOUT — AI ASSISTANT ALWAYS OPEN (no more tabs)
The rail used to TAB between "Your Answer" and "AI Assistant", which hid the assistant — wrong for a study about whether residents can use AI. The tab bar is gone; the rail is now a vertical stack, both panes always visible: compact question/answer on top, chatbot below.
- `.assessment-rail-content` → flex column. `.assessment-rail-tabs` → `display:none`. Tab markup removed from `_mountDock`; the `tab-answer`/`tab-chat` visibility rules are deleted.
- **`.assessment-dock-body { flex: 0 0 auto; max-height: 54% }` — the `0 0` matters.** With `0 1 auto` the pane shrank below its own content and pushed the answer textarea underneath the chat panel (the resident could not type without scrolling). Do not reintroduce flex-shrink here.
- Chatbot: `flex: 1 1 auto; min-height: 240px`.
- Question/prompt shrunk to fit: question 15px→13.5px, scenario body 12px→11.5px with `max-height:5.6em; overflow-y:auto` (it is only an orientation stub now), prompt card padding 18/22→10/12, textarea min-height 160px→88px.
**Gotcha for future live checks:** `window.innerHeight` and `getBoundingClientRect()` returned 0 in the preview eval context, producing bogus "height 0" readings. Trust SCREENSHOTS for layout verification here, not measured rects.

## ADMIN REVIEW CONSOLE (study PI) — NEW, needs migration 005 applied
The admin dashboard is now a four-view console for reviewing every participant's assessment.
All of it lives in `js/components/admin-dashboard.js` (+ `.admin-*` styles at the end of the
admin block in `css/epic-theme.css`). Cache version bumped to **`20260722j`**.

**Routes** (registered in `js/app.js setupRoutes()`):
- `#/admin/attempts` — attempts list (per-participant cards, answers + AI-turn counts per attempt)
- `#/admin/attempts/:id` — **per-attempt chronological transcript** (the main deliverable)
- `#/admin/analytics` — aggregate AI-usage analytics
- `#/admin/export` — CSV / JSON download

**Login flow.** Participants use code identity and NEVER authenticate; admins sign in with
Supabase Auth (email + password) at `#/admin/attempts`. Key design point: the dashboard creates
its **own Supabase client** (`storageKey: 'sb-admin-auth'`), *not* `SupabaseSync.getClient()`.
Two reasons — (a) the SupabaseSync client injects `x-participant-code` on every request, and
(b) more importantly `assessment-engine.js` stamps new attempts with `SupabaseSync.getUser().id`
whenever that client holds a session, so a PI signed in on the shared client would silently
poison any attempt taken in the same browser. The separate client keeps the admin session
invisible to the participant path. After sign-in the dashboard confirms the role by selecting
its own row from `admin_roles` (policy `p_admin_roles_select_self`). Sign-out is in the admin
top bar. No credentials are hardcoded; nothing logs tokens, passwords, or the Anthropic key.

**Sidebar Admin link (fixed).** `App._refreshAssessmentNav()` used to gate the link on
`SupabaseSync.isAuthenticated()`, which is never true under code identity — so the link could
never appear. It now calls `AdminDashboard.probeAdmin()` and listens for the `admin:auth-change`
event. Before you have signed in the link stays hidden, so **the way in is to type
`#/admin/attempts` directly**. `App.init()` has a guard (`_onAdminRoute`) so ModeManager's study
lock does not bounce an `#/admin/...` deep link back to the assessment home.

**The transcript view** renders, per question, in order: the question text → the resident's
interleaved AI conversation for that `prompt_id` (each turn shows the chatbot settings from
`metadata->chatbot_setup` — time window + data types — plus `context_size_chars`) → the
submitted answer → the score with rubric breakdown and grader notes. AI turns are blue and
indented; the answer is a green block; the score is amber. Grouped by `assessment_id` then
`prompt_id`, ordered by the case definition. Long text collapses via pure-CSS `<details>`
(Expand all / Collapse all buttons up top). Unattributed AI turns and stored responses whose
prompt is missing from the case definition get their own sections.

**Analytics** (descriptive only, banner says so): distribution of chosen time windows;
frequency of each data type; AI turns per question (histogram) and per attempt; median context
size; questions answered with ZERO AI turns; mean score by turn-count bucket and by context
tercile; per-case usage; and a per-attempt table. Bars are plain CSS divs — no chart library
(CSP / no-build constraint).

**Export** is pure client-side Blob + object URL: flat responses CSV (one row per question,
29 columns, joined to attempt + question/rubric text + AI-usage summary), flat AI-log CSV, and
a lossless nested JSON dump. Every CSV field is quoted and embedded quotes doubled (RFC 4180),
with a UTF-8 BOM — verified by round-tripping an answer containing commas, quotes and newlines.

### ⚠️ MIGRATION 005 IS NOT YET APPLIED — do this before the dashboard shows any data
`supabase/migrations/005_admin_read_all.sql` adds `public.is_study_admin()` plus SELECT-all RLS
policies for authenticated admins, and `p_admin_roles_select_self`. **Until it is applied, RLS
silently filters every row (no error), so the dashboard looks empty.** The UI says exactly that
and names the file rather than showing a blank page. Three steps, in the Supabase SQL editor /
dashboard:
1. Run `supabase/migrations/005_admin_read_all.sql`.
2. Create the admin account: Dashboard → Authentication → Users → "Add user" (email + password,
   mark email confirmed).
3. Grant the role (substituting your email):
   ```sql
   INSERT INTO public.admin_roles (user_id, role)
   SELECT id, 'admin' FROM auth.users WHERE email = 'kkeet@stanford.edu'
   ON CONFLICT (user_id) DO UPDATE SET role = 'admin';
   ```
Then verify with `SELECT count(*) FROM public.test_attempts;` — it should return every attempt.

**Verified live vs. not.** Verified in the dev server: the sign-in gate renders and rejects bad
credentials with the real Supabase error; the "signed in but not an admin" and
"no attempts returned" states name migration 005; all four routes render; the transcript,
analytics and export layouts render correctly against an injected synthetic dataset (including
zero-AI questions, unanswered questions, and `ask_error` turns); all three export files build
and the responses CSV round-trips answer text containing commas, quotes and newlines; the
sidebar Admin link appears only once admin status is confirmed; a normal participant boot still
lands on `#/assessment/start`. **NOT verified against real rows** — no live data is readable
until migration 005 is applied.

## ADMIN CONSOLE — MIGRATION 005 IS APPLIED (2026-07-28). NO SETUP LEFT.

**Done live on the production DB (`piwoinyrlicvndpsmtde`) — do NOT re-run:**
1. `005_admin_read_all.sql` APPLIED ("Success. No rows returned"). Adds `public.is_study_admin()` + SELECT-all
   policies on `test_attempts` / `assessment_responses` / `assessment_ai_log`, and `p_admin_roles_select_self`.
2. Verified 19 policies across the 4 tables: the new `{authenticated}` admin policies sit ALONGSIDE the 004
   `{public}` code-scoped ones — participant isolation intact.
3. Auth users already existed and were confirmed; `admin_roles` now has **kevinkeet@gmail.com = admin** and
   **kkeet@stanford.edu = admin**. Sign in at `#/admin/attempts` with either (Kevin's own passwords —
   Claude never handles them; account creation/password entry is a prohibited action).

**Live data as of 2026-07-28:** 58 attempts (3 completed) · 54 responses · 46 AI turns · **only 15 of 46 AI
turns carry `metadata->chatbot_setup`** — the settings capture was added partway through, so time-window /
data-type analytics are PARTIAL for historical turns and complete only for turns logged from now on.

**Data-integrity bug the build caught:** `assessment-engine.js` stamps new attempts with
`SupabaseSync.getUser().id` whenever the shared client holds a session, so a PI signed in on the SHARED client
would have silently written PARTICIPANT attempts under the PI's user_id. The admin console therefore uses a
SEPARATE Supabase client (`storageKey: 'sb-admin-auth'`). Do not merge the two clients.

Routes: `#/admin/attempts` (list + login gate) · `#/admin/attempts/:id` (per-question transcript: AI turns
interleaved before the submitted answer, each turn showing its window/data-types) · `#/admin/analytics` ·
`#/admin/export` (responses CSV, AI-log CSV, JSON; RFC-4180 quoted + BOM). SELECT-only by design.

## RESIZABLE ASSESSMENT RAIL
Two drag handles, both persisted to localStorage and both resettable by double-click:
- **Rail width** — `.assessment-dock-resize-x` on the dock's left edge. Writes `--arail` INLINE ON `<body>`.
  **It MUST be body, not `<html>`:** the stylesheet declares `body.assessment-dock-open { --arail: … }` (plus
  1300px/1024px breakpoints), and a declaration on body SHADOWS any inherited value from `<html>` — setting it
  on `documentElement` changes the computed value on html and silently does nothing to the dock. Clamped
  300px .. 60% of viewport. Key: `assessment-rail-width`.
  *Testing note:* `window.innerWidth` reports **0** in the preview's JS eval context, which collapses the clamp
  to its 300px floor — assert the DOCK's `getBoundingClientRect().width` and `.main-container` margin-right,
  never just the CSS variable, or a no-op reads as a pass (that is exactly how this bug shipped).
- **Answer / assistant split** — `.assessment-dock-resize-y` between the two panes. Writes `--abody-h` on the
  dock + adds `.split-custom`, which overrides the default `max-height: 44%`. Clamped so the answer pane keeps
  >=120px and the assistant >=220px. Key: `assessment-body-height`.
`body.assessment-resizing` disables user-select and sets `pointer-events:none` inside both panes so a drag is
never swallowed by the textarea or the chat panel underneath.
Verified live at 20260722n: dock width actually changed 340px -> 300px AND `.main-container` margin-right followed (340px -> 300px), persisted;
split 376px, `.split-custom` applied and persisted; double-click cleared both localStorage keys and the class.

## NEW-USER ORIENTATION (pilot readiness)
- **`js/components/assessment-orientation.js`** — 5-step spotlight tour of the runner (chart → question/answer
  → AI Assistant → timer/pause → resize handles). Auto-shows ONCE per browser (localStorage key
  `assessment-orientation-seen`), replayable from the **? button** in the assessment bar. Esc/arrow keys work.
  Missing targets are skipped, so partial mounts can't strand it.
- **`assessment-start.js `_renderHowItWorks()`** — 3-step "what to expect" strip above the case list
  (review chart → answer free-text, no time limit, no going back → AI assistant available).
- **NEUTRALITY RULE:** both surfaces DESCRIBE the AI assistant ("using it is optional and up to you — work the
  way you normally would") — never encourage its use; a nudge would bias the trial's measured behaviour.
- Verified live at 20260722o: auto-shows for a fresh participant, all 5 steps advance, closes on the last,
  does NOT re-show after navigating away and back, ? button replays. NOTE: the spotlight animates (0.25s) —
  screenshots taken mid-transition look misplaced; wait for settle before judging geometry.

## NO PASS/FAIL REPORTED + RESIZE DRAG FIX
- **Pass/fail removed everywhere participants look** (research instrument, not an exam): results page shows a
  neutral blue score ring + COMPLETED badge (no PASS/FAIL, no "Passing threshold" line); case cards no longer
  say "Pass at 70%" (also dropped the stale "~X min total" — time is not a limit). `passingScorePct` /
  `passingOverallScorePct` remain in the case JSON, just never displayed; the admin console still has full
  scores.
- **Resize "acting weird" root-caused:** the drag handles had no pointer capture, so releasing the mouse
  outside the window meant `pointerup` never fired — the drag stayed armed and `body.assessment-resizing`
  left both panes `pointer-events:none` (rail felt dead until reload). Both handles now use
  `setPointerCapture` with `pointercancel` + window `blur` as recovery paths. Verified live: drag armed →
  pointercancel clears it; blur clears it.

## DEMO MODE (?demo) — public interface tour without study cases
- **actingintern.com/?demo** flips that browser to a DEMO build: patient list, default patient, and assessment
  list all show ONLY **PAT002 Sandoval (the NEJM case)** — none of the five study cases are listed anywhere.
  Persists via localStorage `demo-mode` (so plain actingintern.com stays demo in that browser until reset).
- **actingintern.com/?studymode** restores the study build (clears `demo-mode` AND `all-modes-unlocked`).
- Not a security boundary (same access gate + password; anyone who knows ?studymode can flip back) — per Kevin,
  "doesn't have to be super top secret." It's a clean door for letting people feel the interface.
- Demo attempts are inherently separable in the data: they're `case_id = PAT002`, never a study case.
- **Boot-order gotcha (was a real bug):** URL flags were parsed only in `ModeManager.init()`, which App.init
  calls AFTER loading the default patient and patient index — so `?demo` took effect one reload late.
  `_syncUnlockFromUrl()` now ALSO runs at script parse time (mode-manager loads 4th, before data-loader).
- Verified live both ways at 20260722r: cold `?demo` boots straight into Sandoval with case list = [PAT002];
  `?studymode` restores PAT003–007.

## FEEDBACK NOW REACHES THE STUDY TEAM (migration 006 APPLIED live 2026-08-17)
- **Was:** the feedback widget stored feedback ONLY in the participant's browser localStorage — pilot feedback
  would never have been seen. **Now:** every widget Submit also INSERTs into `public.feedback` (participant
  code, attempt_id when one is active, page, typed/dictated, text, UA). localStorage remains the offline copy;
  failed writes queue in `feedback-unsynced` and retry on the next submit.
- **RLS:** INSERT is code-scoped (`participant_code = participant_code()` header check, pattern from 004);
  SELECT is admin-only (`is_study_admin()`, 005). No API UPDATE/DELETE.
- **Where Kevin reads it: `#/admin/feedback`** — new Feedback tab in the admin console (newest first, links to
  the attempt when one was active).
- Verified end-to-end at 20260722s: widget submit under SAMPLE-RES1 → `synced:true`, empty unsynced queue, and
  the row visible server-side (code, page `#/assessment/start`, method `typed`).
- ALSO this session (2026-08-11..17): **all 72 test attempts deleted** (backups in `zz_backup_*_20260811`,
  RLS-locked); one full sample resident run (PAT003, code SAMPLE-RES1, 94%, 2 real AI asks) left in the DB as
  the only attempt — delete or filter by code before real enrollment. Sample export files delivered to Kevin.

## PILOT CRASH FIXED (participant 1295) — infinite emit loop at AP transitions
- **Symptom:** browser tab froze at every TIMEPOINT TRANSITION (first prompt of AP2). Participant 1295's trail:
  PAT003 (single-AP) completed fine; PAT004 froze at the AP1→AP2 boundary, restarted, abandoned at AP2-Q5a;
  PAT005 froze at AP2-Q2B; gave up. Answers were all SAVED (per-submit writes) — no data loss.
- **Root cause:** `assessment-engine.js _emit()` iterated the live listener Set; the panel's
  'assessment-advanced' handler ran `router.handleRoute()` synchronously, which re-runs `renderActive()` →
  `_attachEngineListener()` → unsubscribe + RE-SUBSCRIBE **during the emit**. `for..of` over a Set visits
  values added mid-iteration → the new listener fires in the same pass → infinite loop, frozen main thread.
- **Fix (both sides, keep both):** engine `_emit` iterates `Array.from(_listeners)` (snapshot); panel defers
  the re-render + toast in `setTimeout(0)` so no route re-render ever runs inside an emit.
- **Verified:** exact repro froze the tab at `20260722s` (even `1+1` timed out); at `20260722t` the same
  scripted run crosses AP1→AP2, tab responsive, typing + further submits work.
- Cleanup note: repro attempts under codes CRASHREPRO/CRASHREPRO2 + earlier SAMPLE-RES1 are in prod — purge
  test rows before enrollment.
## CHATBOT BANNER SLIMMED (pilot feedback)
Chat-state header collapsed from the 4-element block (title + Context line + data-type line + Change-context
button, ~110px) to ONE 49px row: sparkles + "AI Assistant" + ellipsized context string (full detail in the
tooltip) + icon-only Change button. The big cyan banner remains ONLY on the setup screen, where it earns its
discoverability keep. Verified live: slim class applied when chatting, Change button returns to setup.

## PENDING / NEXT
1. **Cleanup pass — DONE.** `assessment-results.js._renderRubric` now prefers `scoringRubric.rubricText` (falls back to essential/bonus only when there's no scoringRubric). Deleted the stale `rubric` block from all 22 points-graded prompts (PAT003–007). PAT002 keeps its 5 essential/bonus rubrics (they ARE its grader). `admin-dashboard.js` does not render rubrics. Final: PAT003=5, PAT004=8, PAT005=7, PAT006=4, PAT007=6 scoringRubrics, 0 legacy blocks; PAT002=5 legacy.
2. **Live-verify the rubric-fidelity fixes — DONE (2026-07-22)** except one piece: verified live that the PAT004 3-part IVC split (Q5a 5 / Q5b 3 / Q5c 3 / Q6 8) renders and flows end-to-end; PAT005 AP2-Q4→Q4b→AP3 flows; **PAT005 AP3 at anchor 7/05 shows NOTE010 (6/25) and hides NOTE008 (7/19 transplant) + NOTE009**; AP3 stem shows the pre-transplant rewrite. Point totals re-verified from data: 36/71/27/23/78.5, 0 legacy rubric blocks on PAT003–007. PAT003 points-path grading confirmed statically (grader branches on `scoringRubric.rubricText`, present on all 5 Qs) — **an actual end-to-end grade call still needs the access gate unlocked + API credits** (tooling can't enter the password).
3. **Bell (PAT004) content audit — Q2–Q6 + chart consistency DONE (2026-07-22).** Fixed: (a) **pain/infarct laterality** — chart said pleuritic LEFT pain + LEFT wedge opacity but the PE is RIGHT lower lobe; moved both to the right (NOTE001, IMG001, PRB001, ENC001, vitals context); (b) **note timestamps** — NOTE001 (10:00) cited the 16:30 TTE → moved to 17:30; NOTE008 (11:00) cited the 11:45 CTA/12:30 TTE → moved to 14:00 (+ notes index synced); (c) **LAB004 aPTT 68 "therapeutic on heparin"** drawn at 11:00, before the 11:15 heparin order → now baseline 31 pre-heparin; (d) ED-arrival vitals row moved 14:00→08:15; (e) AP2 scenarioBrief no longer implies apixaban started a month post-discharge. **App-wide fixes found via this audit:** header/dropdown patient AGE was computed from the wall clock (Bell showed 42y vs the notes' 43) → `DateUtils.calculateAge` now uses the chart-gate anchor, the switcher uses each case's default anchor, and `_applyDefaultGate` runs before the header renders; date-only strings (DOBs) were parsed as UTC and displayed one day early → `DateUtils.parseLocal`. Verified all 6 cases' anchor ages match the ages written in their notes. **FLAGGED, not changed (Kevin to decide):** (i) NOTE001 exam says "no hepatomegaly, no palpable mass" despite the 17 cm right-lobe mass — consider hedging the exam line; (ii) AP2-Q5b rubric item d says "large, hemodynamically significant PE" while the chart consistently says hemodynamically stable/submassive — left for source-docx fidelity; (iii) the IR 3-day apixaban hold vs Q3's 48-h key looks INTENTIONAL (the trap explaining the recurrence; IR note hidden at TP1) — left as-is; (iv) ap-level `totalWeight`/`passingScorePct` JSON fields are dead (engine weights by per-prompt maxPoints) — harmless, left.
4. **Human-synthesizer re-test** (needs credits): the "does skilled multi-turn help" question is confounded because the simulated resident was an LLM. Real answer needs a human (or the recorded transcripts) writing the final answer — especially on PAT007 (the drug-fever trap case, the missing data point).
5. **Hide the non-assessment modes for study deployment — DONE (2026-07-22).** `mode-manager.js` now boots in a **study lock** by default: no landing chooser (straight into Assessment), no top-bar switcher, `set('tutor'/'assistant')` and the `#/tutor` deep link forced back to assessment, stored tutor/assistant choices overwritten on boot. Tutor/Assistant code is untouched — **to restore all three modes in a browser, load the site once with `?allmodes` in the URL** (persists via localStorage key `all-modes-unlocked`); **`?studymode` locks it back**. Verified live both directions. Cache `20260722a`.
6. **Instrument redesign discussion** (deferred by validity choice): user wants grading identical to prior studies, so the "reward judgment over coverage" changes are OFF the table for now. Any future scoring changes must preserve comparability.

## Answered clinical question (for the record)
"Is there evidence for waiting ~a month to biopsy in a patient with suspected cancer + new VTE?" — Yes; the highest VTE-recurrence risk is the first ~month, so elective procedures are generally deferred ≥1 month (ideally 3) after acute VTE; the docx keys "4–6 weeks." (Case 2 / PAT004 Q1.)

## Deliverable docs produced (in ~/Downloads)
- "Management Cases 1-5 — Origin, Questions & Rubrics.docx"
- "Patient Memory Learn Prompts.docx"
- "Acting Intern — Prompting-Skill Discrimination Analysis.docx" (single-turn)
- "Acting Intern — Prompting-Skill Analysis (multi-turn).docx"

## Key files
- `js/services/assessment-grader.js` — grading (points vs essential/bonus).
- `js/services/assessment-engine.js` — attempt lifecycle, offline queue, scoring.
- `js/components/assessment-panel.js` — the runner (dock + tabs).
- `js/components/assessment-chatbot.js` — the context-bounded AI panel.
- `js/services/assessment-chart-gate.js` — date-filters the chart by timepoint anchor.
- `js/data-loader.js` — chart data fetch.
- `css/epic-theme.css` — all styles (assessment dock CSS near the `.assessment-dock` block).
- `data/assessments/PAT00N/{index,ap*}.json` — questions + rubrics.
- `supabase/migrations/004_scope_code_based_access.sql` — the applied RLS fix.
