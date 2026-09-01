# Acting Intern — Session Handoff / Working Doc

## LATEST (2026-09-01, cache 20260723s): demo-door escape hatch — pilots were doing Sandoval
Kevin: "I want the 5 main cases piloted." Coded pilots (6773/0663/4217) landed on the DEMO door and
did/attempted Sandoval thinking it was the study; entry-mode persists so they'd never re-see the
chooser. Fix: yellow banner on the demo assessment-start page ("Sandoval is a demo case — not the
study") with a one-click "Go to the study cases" switch (sets pilot mode, strips ?demo via
location.replace(pathname) — do NOT add reload(), the race re-applies the URL flag).
Also this session: per-case time quote 30-45 → 10-20 min (all 4 spots). Completion #10: 8019 resumed
after 13 days and finished PAT003 (~14.5 min case time) — BUT their rows have secs=0/no user_question:
they resumed in a stale pre-fix tab. Long-lived open tabs bypass deployed fixes; consider a version
check + reload prompt if this recurs.

## PREVIOUS (2026-09-01, cache 20260723q): anti-daunting funnel redesign + study-door steering
Kevin's word-of-mouth pilot feedback: "seems daunting... they sit down, get overwhelmed, give up."
Fixes (all verified in preview with 4782's real code):
- **Stale scary copy removed**: start page said "dedicate at least 90 minutes uninterrupted",
  "each stage has its own time limit" (false), "you will see your scoring report" (false).
  Rewritten as "Good to know": one case at a time (~10-20 min, per Kevin 9/1), no time limits, saves as you go,
  chart moves forward in time. Consent copy reframed the same way. Per-case data warnings
  (data/assessments/*/index.json, no cache-bust needed) also softened.
- **Progress + chunking on the case list**: "You've completed X of 5" line; numbered cases with
  ~30-45 min chips; ✓ Completed badges (per-code query via _loadMyCompletions); first uncompleted
  case highlighted with "Start here"; results page now says "Case complete — thank you!" with a
  "See remaining cases" CTA.
- **Entry chooser**: Study participant door now first + highlighted (ec-primary), copy says
  pilot testers should pick it; Demo explicitly "Not one of the study cases". Fixed ?choose loop
  (flag persisted through the post-pick reload and wiped entry-mode).
- Study-case pilot coverage as of 9/1: PAT003 ×2, PAT004 ×2, PAT005/6/7 ×1 each (1295 only) —
  Kevin wants the 5 main cases piloted; demo completions (6773) don't count toward that.

## Previous (2026-08-31, cache 20260723o): second-hand pilot feedback — chatbot amnesia + family history
Second-hand report (likely 4782, second case = PAT004): (a) "chatbot forgot the case after the
mid-case update" — ROOT CAUSE: the AI Chat context window is relative to the chart anchor, and the
AP time jump (PAT004 jumps 31 days) slid a 7/30-day window past the original presentation. FIX:
window floor in `_buildContextBlock` — from = min(anchor-win, caseStart-win), so advancing time only
ADDS data; AP-transition divider now says "Time has passed — chart updated." (b) "family history
missing" — study patients (PAT003-007) use a nested shape {relation, vital, conditions:[...]} that
the FamilyHistory page rendered as "undefined" rows; renderer now normalizes both shapes (PAT002
flat shape regression-checked). Both verified in preview against PAT004.

## Previous (2026-08-30, cache 20260723n): instrumentation fixes from pilot-behavior analysis
Behavioral analysis of 9 real pilot users (15 attempts) found 3 measurement gaps, all fixed + verified:
1. **Per-answer timing**: `time_spent_seconds` was hardcoded 0 on all 81 pilot responses. Engine now
   tracks `_promptShownAt` (reset on every cursor move/start/resume) and stamps the real delta.
2. **AI question was being truncated away**: `query_text` (full transcript, context first) is capped
   at 20K and 51/59 pilot rows hit it — head-slicing kept context, dropped the participant's question.
   Now: `_capQuery` keeps the TAIL, and the chatbot attaches the raw typed question as
   `metadata.user_question` (read it via `metadata->>'user_question'` — no schema change needed).
3. **Attempt provenance**: `test_attempts.metadata` now carries `entry_mode` (demo/pilot/full) and
   `origin` (hostname) — separates demo dabbles and localhost tests from study data. NOTE: localhost
   testing DOES write to prod Supabase (discovered via my own RESZCHK row).
Analysis-side reminders: dedup restarts by (user_code,case_id)→latest/completed; junk purge before
enrollment. Pilot phenotypes: 1295=light consulter (1-4 asks/case, hand-typed ~300ch answers);
4782=AI-driven (14-15 asks/case, pasted markdown answers, 2 cases completed 8/30 evening).

## Previous (2026-08-30, cache 20260723m): scenario box unsquished (pilot feedback 0663)
Pilot 0663 (demo door, 8/30): "the 'scenario' tab is really tiny and I can't change the size of it."
`.assessment-scenario-body` was capped at 3.2em/11.5px. Now 12.5px, max-height 12em — every shipped
brief (longest 407 chars) renders in full with no scroll. Same-day fix, shipped 8/30.
Pilot activity 8/30: three new visitors — 4217 (demo, stalled Q1), 0663 (demo, 1 AI ask + the
feedback), 4782 (STUDY door PAT003 Nguyen, active evening of 8/30, 2 AI asks). None answered yet.
Admin data access from a session: table names are `test_attempts`, `assessment_responses`,
`assessment_ai_log` (ORDER BY `timestamp`, not created_at), `feedback` (text col `feedback_text`);
query via fresh Chrome tab → actingintern.com/#/admin → `await AdminDashboard._adminClient()`.

## Previous (2026-08-29, cache 20260723l): AI reasoning overhaul — structured actions, schema-forced JSON
Implemented the 5 improvements Kevin approved ("implement them all"):
1. **Structured suggested actions**: memory-doc pendingItems are now objects
   {text, category, urgency, evidence, orderType, orderData(JSON-string)} — schema in
   `MEMORY_PENDING_SPEC` + `MEMORY_DOC_SCHEMA` (context-assembler.js, shared by Learn/Level-1/
   Synthesis/Refresh prompts). Evidence cites chart item IDs. `_normalizeSuggestion()` handles
   legacy strings AND parses string orderData. Urgent items sort first + red-border styling
   (.action-urgent). Executable orders now open OrderEntry prefilled from Learn/Re-Analyze
   (previously only the dictation path could).
2. **Schema-forced JSON (replaces prefill)**: Claude 5 REMOVED assistant prefill (400). Memory-doc
   calls now use structured outputs — `output_config: {format: {type:'json_schema', schema},
   effort:'medium'}` in callLLM/callLLMStreaming when `options.outputSchema` set. GOTCHAS learned:
   (a) a 5-way anyOf of orderData object shapes → "compiled grammar too large" 400 — orderData is
   a JSON-encoded STRING in the schema instead; (b) thinking:{disabled} → hollow all-empty docs;
   (c) default (high-effort) adaptive thinking eats max_tokens → truncated JSON. effort:'medium' +
   maxTokens 24000 is the working combo. Schema includes a discarded `reasoning` scratchpad field
   FIRST (deleted before storing).
3. **Provenance**: prompts instruct citing item IDs (NOTE###/LAB###/IMG###) in keyData/evidence.
4. **changesSinceLastReview + coverage** fields in the memory doc; rendered as the
   "Since Last Review" panel section (`_renderChangesSinceReview`) and a coverage line in the
   between-levels learn card (.dl-coverage).
5. **De-Morrison'd prompt examples** (fictional 68F COPD patient) + explicit "example values are a
   DIFFERENT patient" note + date-anchor rule (anchor "recent/today" to dated chart entries).
Legacy full-refresh/dictation streaming maxTokens 4096→8192 (fallback was truncating).
Seed regenerated with structured actions (18 pending, 10 with orderData, 4 urgent).
**Claude 5 migration landmines found & fixed while testing (READ IF TOUCHING API CALLS):**
- `content[0].text` is WRONG on Claude 5 — adaptive thinking emits a thinking block FIRST, so
  content[0] has no .text. Fixed everywhere via `ClaudeAPI.textFrom(content)` (filters text blocks):
  claude-api chat/_singleChat, ai-coworker callLLM + digest, ambient-scribe, dictation-widget.
  This had silently broken deep-learn Levels 2+ ("Haiku extraction: 0 document extractions").
- Extraction maxTokens 2048 also starved by thinking → 8000 + EXTRACTION_SCHEMA (structured
  outputs) in buildHaikuExtractionPrompt; _singleChat supports req.outputSchema.
- Level runner now THROWS if extraction returns 0 for a non-empty batch instead of marking items
  processed (was silent data loss — items "learned" with nothing extracted).
- Deep-learn pipeline validated end-to-end on Sonnet 5: Level 1 ✓, incremental refresh ✓ (18/18
  structured actions, BNP order opened OrderEntry prefilled), Level 2 ✓ (30/30 extractions,
  synthesis merged: problems 9→14, meds 11→14).

## Previous (2026-08-29, cache 20260723k): AI seed + banner fix + Claude 5 models
- **AI Coworker pre-seeding**: `data/patients/PAT001/ai-seed.json` (~600KB) ships a pre-computed
  Level-1 deep learn + first analysis for Morrison. On first load with no saved memory,
  `AICoworker._applyAiSeed(pid)` (called from `initializeLongitudinalDocument`) writes
  `longitudinalDoc_PAT001` + `deepLearn_PAT001` to localStorage, then loads via the normal
  deserialize path → panel is instantly populated (one-liner, clinical summary, 9 problems w/ plans,
  20 suggested actions), learn bar shows Level 1 done with **Continue Learning** (→ Level 2) and
  **Re-Analyze** buttons. Zero API calls on first load (verified via network log on cleared storage).
  Regenerate the seed after chart-data changes: run a fresh Level 1 + Re-Analyze in the browser, then
  export `localStorage longitudinalDoc_PAT001` + `deepLearn_PAT001` into the JSON (top-level keys
  `longitudinalDoc`, `deepLearn`, `generated`).
- **Learning-banner squish fixed**: `#assistant-tab-body` is a flex column; `.copilot-thinking-banner`
  had default flex-shrink:1 + overflow:hidden → crushed to ~26px. Fix: `flex-shrink:0` (+ stages wrap).
- **Suggested Actions fixed (pre-existing bug)**: after Deep Learn exists, Re-Analyze uses the
  incremental memory-doc refresh whose schema has NO categorizedActions — so the Suggested Actions
  section showed empty category headers forever. Fix: `_categorizeSuggestions()` keyword-sorts the
  flat pendingItems into the communication/labs/imaging/medications/other buckets whenever
  `state.categorizedActions` is null. Click paths verified: labs/other → agentic copilot chat
  ("Help me: ..."), communication → patient/nurse chat pre-filled, orders w/ orderData → OrderEntry.
  `_applyAiSeed` also supports an optional `seed.panel` snapshot (categorizedActions etc.) applied in
  `hydrateFromMemory`.
- **Models updated to Claude 5**: default/analysis/dictation/grader/scribe → `claude-sonnet-5`;
  edu-tutor → `claude-opus-5`; settings picker now Haiku 4.5 / Sonnet 4.6 / Sonnet 5 (default) /
  Opus 5, with localStorage migrations for retired IDs. **Assessment chatbot stays
  `claude-haiku-4-5-20251001` on purpose — it is the study intervention; do not change mid-study
  without Kevin's sign-off.** Note: grader model changed pre-enrollment (pilot scores not comparable).

Living status doc so work can resume in a fresh session. Repo:
`/Users/kevinkeet/Documents/Claude applications folder/synthetic-ehr` (actingintern.com, GitHub Pages).

## How the app works (fast facts)
- Vanilla HTML/JS/CSS, **no build system**. `index.html` loads all scripts; `js/router.js` hash routing.
- **Two git remotes — push BOTH after every commit:** `git push origin main && git push shared main`.
- **Cache busting:** every `<script>/<link>` in `index.html` uses `?v=YYYYMMDD[suffix]`. Bump it (search/replace all + `window.__CACHE_V`) whenever you change **JS or CSS**. **Data JSON under `data/` is NOT cache-busted** — edits take effect on reload. Current version: **`20260723s`**.
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

## PARTICIPANTS SEE NO SCORES (study decision 2026-08-19)
Driven by pilot feedback (1295: 25-27% "feels demoralizing... I used AI and felt my answers [were good]").
The participant results page now shows: a checkmark "Submitted / Your responses have been recorded for the
study", their own answers, their AI transcript, and time used. REMOVED from the participant surface: overall
percentage, per-AP and per-question scores, score breakdowns, grader notes (they carry point counts), and the
RUBRIC display (it is the answer key — the delayed-control arm sits the same cases later; contamination risk).
Scores are still computed and stored; the ADMIN console shows everything unchanged. Verified by rendering the
template against a scored stub and grepping the output: no %, no points, no rubric, no notes; answers and
time remain. NOTE for the group/SAP: what participants are shown is an administration-protocol decision —
record it in the protocol; the delayed-control arm's later exposure makes rubric secrecy load-bearing.

## HIDDEN PATIENTS VISIBLE IN UNLOCKED (?allmodes) BROWSERS
The patient-list filter is now lock-aware: demo → PAT002 only; study-locked (default) → hidden patients
excluded; **?allmodes-unlocked → ALL patients including PAT001 Morrison** (simulation + AI Assistant live
there). ?studymode still relocks everything. Verified live: unlocked browser lists PAT001-007, all 3 modes,
Morrison loads with sim controls (#sim-controls) + AI panel mounted.

## PILOT FEEDBACK ROUND 2 FIXED (1295's three items, 2026-08-20)
1. **Vitals wall-clock leak:** stale SimulationEngine state injected a real-date row badged LIVE into gated
   charts (bypassing the chart gate). vitals.js now skips sim-row injection whenever the chart gate is active
   or body.in-assessment. Verified: planted fake sim state + active PAT005 gate → no LIVE row.
2. **Consent code field:** relabeled "Your participant code", help text now says "usually a short number,
   e.g. 4217 — NOT the site password you typed a moment ago", placeholder "e.g. 4217". (Someone had started
   an attempt under code '0slerian' — the site password. That junk attempt + 8019's are still in the DB.)
3. **Time transitions:** the missable toast is now a BLOCKING interstitial (#assessment-timejump) on every
   AP advance: "Time has passed in this case — it is now <anchor date>. Re-review the chart." Must be
   dismissed. Verified live at PAT005 AP1→AP2 ("It is now 4/30/2027"), dismisses cleanly.
NOTE: 1295's third feedback item (misses grading; suggests a 60-100% rescale or majority-point rubric) is a
PROTOCOL question — parked for the Monday group, not implemented.

## AI CHAT DISCOVERABILITY, ROUND 3 (screen-share evidence, 2026-08-25)
A screen-shared demo showed a user browsing the CHART from #/assessment/start with NO trace of AI anywhere —
the chatbot only exists inside a run. Two changes:
1. ~~Pre-assessment cue pill~~ — built, then REMOVED same day at Kevin's call ("pushing it too much"): a
   floating always-on pill crossed from discoverability into promotion. Do not re-add. The in-run welcome
   (below) is the sanctioned level of prominence.
2. **Chatbot welcome state** (`_renderWelcome` in assessment-chatbot.js): the panel no longer opens on the
   context-picker form (read as settings, not chat). First view is now a centered "AI Chat" + big
   "Start AI Chat" button + "Optional — use it as much or as little as you like"; click → context picker →
   chat. Wording deliberately neutral (visible, not pushy).
Verified live at 20260722z: cue on chart page pre-run with correct text; cue hidden in run; welcome shows;
Start click opens the picker (7 window options).

## BROWSE-MODE FLOATING AI CHAT (no active run)
Kevin: chart pages outside a run (e.g. default Nguyen #/chart-review) had no AI chat at all. Now: in
assessment mode with NO active attempt, on chart routes (not /admin, not /assessment), the chatbot floats
bottom-right — launcher pill "AI Chat" → expands to the same welcome → context → chat panel; minimize (–)
returns to the pill. `AssessmentChatbot.mountFloating()/unmountFloating()` + `App._syncBrowseChat()` on
hashchange. During a run the dock owns the panel (floating class stripped in `_attachChatbot`); activate()
resets chat state at case start, so browse-chat history never bleeds into a run. **Browse chat is NOT
study-logged** (logger requires an active attempt) — deliberate; noted for the group.
Gotcha found while building: the panel's creation helper is `_mountRoot()` (I first guessed `_ensureRoot` —
silent failure). Verified live at 20260723c: launcher on chart-review/labs, persists across tabs, minimize
works, dock takes over in a run.

## ENTRY CHOOSER (first-visit front door) + STALE-DOCK FIX
- **actingintern.com now opens with a 3-door chooser** for brand-new browsers: **Demo** (Sandoval practice
  case), **Study participant** (locked study build → #/assessment/start), **Full site** (?allmodes-equivalent:
  all patients incl. Morrison, all 3 AI modes). Choice persists as localStorage `entry-mode`; each pick sets
  the underlying flags (demo-mode / all-modes-unlocked / app-mode) and reloads for a consistent boot.
- URL flags still work and now RECORD the choice (skip the chooser): ?demo→demo, ?studymode→pilot,
  ?allmodes→full. **?choose** clears entry-mode and re-opens the chooser. Session slips/emails can therefore
  deep-link participants straight past the chooser with ?studymode.
- **Stale-dock bug fixed** (visible in Kevin's screenshot as a half-width consent card): abandoning/finishing
  a case left `body.assessment-dock-open` + the dock element behind, squeezing every later page against a
  phantom rail. `_syncBrowseChat` now sweeps both whenever no run is active.
- Verified live at 20260723d: fresh browser → chooser with all 3 options; pilot→PAT003-007 @ start; demo→
  PAT002 only; full→unlocked, PAT001-007; stale dock/class removed.

## HOME BUTTON (demo + full-site only)
Header "Home" button (left of Feedback/ABOUT) returns to the entry chooser (clears `entry-mode`, reloads).
Shown ONLY when entry-mode is demo or full — deliberately absent in study-participant mode so residents can't
wander between builds mid-assessment. ?choose remains the URL fallback. Verified live at 20260723e:
visible in full and demo, absent in pilot, click clears entry-mode.

## THREE DISJOINT WORLDS (final partition, 2026-08-25)
- **Demo** → PAT002 Sandoval only (assessment case PAT002 only)
- **Study participant** (locked) → PAT003–007 only (the five study cases)
- **Full site** (unlocked) → **PAT001 Morrison ONLY**, default patient Morrison, **NO assessment cases
  offered** — that door is the simulation + AI Assistant/Tutor. Study cases cannot leak through it.
To take/test study cases, use the Study door or ?studymode. Verified live at 20260723g (full: [PAT001],
header Morrison, cases []; pilot: PAT003-007 with 5 cases).

## DUPLICATE PATIENT DROPDOWN REMOVED
The header had TWO patient selectors: a left "PATIENT" `<select id="patient-select">` (populated by
navigation.js, which safely no-ops now — it guards on the element) and the right patient banner's switcher
(patient-header.js: name + demographics + `.patient-switcher-btn`). The left one is deleted from index.html;
the right banner is now the single switcher. Verified at 20260723h: left picker gone; in the study build the
banner switcher opens with all 5 patients; full site shows Morrison alone.

## AI COWORKER STALL FIXED (naming + root cause)
**Naming:** the full-site assistant = **"AI Coworker"** (its codebase name, ai-coworker.js); the assessment's
stripped-down one = **"AI Chat"** (assessment-chatbot.js). Use these consistently.
**Kevin's Level-6 "Building memory document" stall (203/373, no error shown):** the Deep Learn level runner
IS try/caught — but `claude-api.js` had NO request timeout, so one hung connection never settled and the
catch never fired: eternal spinner. Fix: `_timedFetch` (AbortController, 300s default) now wraps all three
fetch sites in claude-api.js — hangs become ordinary errors that existing handlers surface as retryable
toasts ("Level N failed — retry"). Deep-learn progress persists (`_saveDeepLearnState`), so after a timeout
the user reloads and hits Continue Learning.
Also: `loadProcedures`/`loadOrders` are now optional (study patients lack those files — was throwing 404
noise from the coworker's ingest on PAT003).
Verified at 20260723i: helper aborts with the timeout message; normal Haiku call works; PAT003 procedures
returns empty instead of throwing.

## FIRST-VISIT FUNNEL FIXED + WALKTHROUGH (2026-08-26, cache 20260723j) — READ FIRST ON RESUME
**The bounce bug was found:** first-time visitors (and ONLY first-timers — cookied browsers skip it via
`about-seen`) hit the legacy About modal (Sign In / Create Account / "PHI-free playground") right on top of
the consent page — an apparent account wall. Pilots 2874/6773/6713 all hit it; that's the best explanation
for the 3 zero-answer bounces. FIXED: `about.js checkFirstVisit()` auto-shows ONLY when entry-mode='full';
ABOUT button still opens it anywhere. Verified clean live funnel: password → 3-door chooser → consent+code →
case list ("what to expect" strip, Begin buttons). **Re-invite 2874/6773/6713 to retry.**

## CURRENT STATE SNAPSHOT (2026-08-26)
- **Live cache version 20260723j**, deployed to actingintern.com (GitHub Pages, push both remotes!).
- **Entry doors:** 3-door chooser on first visit; entry-mode ∈ demo|pilot|full in localStorage. demo=Sandoval
  only; pilot=study build PAT003-007; full=Morrison ONLY + AI Coworker/Tutor, lands #/chart-review assistant
  mode, no assessment cases. URL flags: ?demo ?studymode ?allmodes (each records entry-mode), ?choose reopens.
  Home button in header (demo+full only) returns to chooser.
- **Naming:** full-site assistant = "AI Coworker" (ai-coworker.js); assessment's = "AI Chat"
  (assessment-chatbot.js: welcome "Start AI Chat" → context picker → chat; slim header in chat; floating
  launcher on chart pages when no run active — NOT study-logged).
- **API client has a 300s timeout** (`ClaudeAPI._timedFetch`) — fixed the Coworker Deep Learn eternal-spinner.
- **Participants see NO scores/rubrics/grader notes** (results = "Submitted" + own answers + AI transcript).
  Timer counts up, no limits. Timepoint transitions show a blocking interstitial.
- **PILOT DATA (all of it so far):** 1295 = full battery (25/27/59/65/17%) + 4 feedback items (all acted on);
  2874, 6773, 6713 = zero-answer bounces (now explained, see above); 8019 = stalled at 2 answers; 4873 = new
  8/25, PAT005 1 answer + 1 AI ask, unfinished; codes 1234/0000 = demo dabblers.
- **JUNK TO PURGE before enrollment** (test_attempts by user_code): 0slerian, 1234, 0000, SAMPLE-RES1,
  CRASHREPRO, CRASHREPRO2, CUECHK, CUEGONE, FLOATCHK, BANNERCHK, PROM1/2, UITEST*, RESZ*, SEQ*, NOPASS,
  WALKTHRU (client-only, no rows), FIX3CHK, CUEGONE — plus the feedback row from SAMPLE-RES1. Backups of the
  pre-8/11 purge live in zz_backup_*_20260811 (RLS-locked).
- **MONITORING:** `public.pilot_pulse()` RPC (migration 007, applied) returns aggregate counts/timestamps;
  callable with the public anon key (it's in index.html). The in-session Monitor polling it DIES with the
  session — on resume, either re-arm the same 30-min curl loop (state file pattern in scratchpad) or set up a
  scheduled cloud check. Query details via the admin console page's `AdminDashboard._adminClient()` in a
  FRESH Chrome tab (old tabs freeze via Memory Saver — always open a new tab).
- **Admin console:** actingintern.com/#/admin/attempts|analytics|export|feedback. Admins: kevinkeet@gmail.com
  + kkeet@stanford.edu (Supabase Auth; migration 005). Feedback pipeline live (migration 006).
- **COORDINATION DOCS (Google Drive, MACY RCT folder):** Master Overview doc; Coordinator Workflow (final,
  incl. site access/passwords, Raj's email-volunteer model, Noreen Vijil/Blackhawk payment pipeline — PTA
  string still pending from Ronald Sol/Brandi); Research Coordinator JD (10 hrs/wk, Mon 2pm PST meetings).
  Stanford gift-card process is in persistent memory (reference_stanford_gift_cards.md).
- **OPEN ITEMS:** Macy PTA string + Blackhawk-to-external-emails (Noreen); randomization procedure in
  writing (Raj/QSU); payment-claim form on completion screen (offered, not built); per-site roster decision;
  purge junk data; CHA workshop 9/8 — recruitment email imminent; consider gating the Full-site door during
  enrollment (contamination-by-curiosity).

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
