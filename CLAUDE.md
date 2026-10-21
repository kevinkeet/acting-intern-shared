# Project: Acting Intern — Clinical Simulation

## Git
- Two remotes: `origin` (synthetic-ehr, personal) and `shared` (acting-intern-shared, collaborative)
- After committing, always push to **both** remotes: `git push origin main && git push shared main`
- A push to `main` deploys the live study site: read "Study guardrails" below first
- Commit messages: short summary line, optional detail paragraph, always include Co-Authored-By trailer

## Study guardrails (TEACH-AI trial is live; Kevin, 21 Oct 2026)
actingintern.com runs an IRB-approved RCT (Stanford IRB 85976). Residents do cases at all hours,
there is no staging site, and every push to `main` deploys. The study must never glitch.

- **Study-protected files** (full list: `scripts/study-protected.txt`): the study's AI Chat,
  engine, start page, logger and auto-grader (`assessment-*.js`), case content and case charts
  (`data/assessments/`, `data/patients/PAT003`–`PAT007`), the chart pages a case shows, the app
  shell (`index.html`, `app.js`, `router.js`, `data-loader.js`, `mode-manager.js`,
  `access-gate.js`, `claude-api.js`, `user-code.js`, `supabase-sync.js`), `css/epic-theme.css`,
  grading, the admin console, the progress page, `server.js` and `supabase/`. Change them only
  with Kevin's explicit OK for that change. A cache-version bump in `index.html` needs no OK.
- **AI Coworker work is full-site only.** The coworker (`ai-coworker.js`, `ai-panel.js`,
  `context-assembler.js`, dictation, scribe, glasses) still loads in study browsers, and
  `onPatientLoaded` runs on study case charts. New behavior must check the door first:
  `if (ModeManager.isStudyLocked()) return;` (study and demo browsers are locked; `?allmodes`
  unlocks). In a locked browser: no AI calls, timers or heavy work at start-up or on patient
  load. New coworker styles go in a coworker-only stylesheet scoped to the coworker's own
  containers, not in `epic-theme.css` (adding that file to `index.html` needs Kevin's OK once).
- **Two AI routes on the server.** `/api/claude` (key `ANTHROPIC_API_KEY`) serves the study and
  demo doors and stays as it is. `/api/claude-full` (key `ANTHROPIC_API_KEY_FULLSITE`, its own
  Anthropic workspace with a spend limit; falls back to the shared key until that is set)
  serves the full-site door. `ClaudeAPI` and `AICoworker.detectBackend()` choose the route, so
  call Claude through `ClaudeAPI` or `AICoworker.apiEndpoint`, never a hard-coded URL.
- **Start-up firewall.** `App._startSafely()` wraps `AIPanel.init()` and `AICoworker.init()`, and
  `loadPatient` wraps `AICoworker.onPatientLoaded()`. Without it, any start-up error in the
  coworker or AI panel leaves the study page stuck on "Loading..." for every resident (shown by
  the smoke test's control run against 3adaf2f). `tests/startup-firewall.test.js` keeps it in place.
- **Tests before any push to main:** `for t in tests/*.test.js; do node "$t"; done` and
  `node scripts/smoke-study.mjs` (headless Chrome, read-only: it blocks every outside write,
  never starts a case, and uses fake API keys). Needs `npm install` once per checkout.
- **Pre-push hook** (install once per clone: `sh scripts/install-git-hooks.sh`) runs on every
  push to `main` and blocks it when:
  - it falls in a freeze window (`scripts/deploy-freeze.json`: from 00:00 the day before each
    workshop session until the session ends; add each new session there),
  - it changes study-protected files, or
  - any syntax check, test or smoke check fails (run on an export of exactly what is pushed).
  Overrides, one push at a time and only after Kevin's OK in chat: `TEACHAI_FREEZE_OK=1`,
  `TEACHAI_STUDY_OK=1`, `TEACHAI_SKIP_SMOKE=1`.
- **When to deploy:** when no resident is mid-case. The pre-push check prints recent activity
  from `study_pulse`. Mornings (Pacific) have been quiet; residents often work in the evening,
  and the night before a session is the busiest time, when pre-workshop cases that are missed
  can't be made up. Freeze windows are for bigger changes; a small, well-tested fix can go
  out inside one with Kevin's OK.
- **After every deploy:** `node scripts/smoke-study.mjs --live=https://actingintern.com`
  (read-only; checks the live files match the checkout, the doors render behind the password
  box without typing it, and both AI routes answer with one tiny call each).
- **Test data:** never start a case under a four-digit code or a participant's code; use
  `TEST-` codes. Never open the randomization table.
- **Rollback** when a deploy misbehaves:
  1. Render dashboard → the actingintern.com web service → Events → the last good deploy →
     Rollback. This restores the previous build in a minute or two without touching git.
     Render may switch off auto-deploy after a rollback; check it and turn it back on in step 3.
  2. Make git match: `git revert <bad commit>`, then push to both remotes. A pure revert during
     a freeze window is the one case for `TEACHAI_FREEZE_OK=1` (still with Kevin's OK).
  3. Check `https://actingintern.com/api/health`, the study door (`/?studymode`), and that
     `study_pulse` still shows progress.

## Architecture
- **No build system** — plain HTML/JS/CSS
- **Server:** `server.js` (Express) on Render behind Cloudflare serves the files and the AI
  routes `/api/claude` and `/api/claude-full`. The old GitHub Pages `CNAME` is not what serves
  the site. Browsers call Claude through those routes, or directly with the key the site
  password unlocks (`js/access-config.js`), depending on a start-up race (see `claude-api.js`).
- **No frameworks** — vanilla JS with global objects (e.g., `window.ClaudeAPI`, `window.AICoworker`)
- Single-page app: `index.html` loads all scripts, `js/router.js` handles hash-based routing

## Cache Busting
- All `<script>` and `<link>` tags in `index.html` use `?v=YYYYMMDD[x]` query params
- When changing any JS/CSS file, bump the version string in `index.html` (search for the current version, replace all)
- Global version also stored in `window.__CACHE_V`

## Key Files
- `js/components/ai-coworker.js` — Core AI logic + rendering (about 9,900 lines, the big one)
- `js/services/context-assembler.js` — Prompt construction for AI analysis
- `js/services/claude-api.js` — HTTP client to Anthropic API
- `js/components/ai-panel.js` — AI panel UI shell
- `css/epic-theme.css` — All styles, EPIC-inspired design system

## Anthropic Model IDs
- `claude-sonnet-5` (default, no date suffix)
- `claude-opus-5` (no date suffix; used by edu-tutor)
- `claude-sonnet-4-6` (previous default, still selectable)
- `claude-haiku-4-5-20251001` (has date suffix; dictation parse only — the assessment chatbot moved to `claude-sonnet-5` on 20 Sep 2026)

## Dev Server
- `npx http-server -p 8080 -c-1` or use the launch.json config `ehr-dev` (static files only:
  no AI routes, so the site falls back to direct browser calls)
- `npm install && PORT=3000 node server.js` for the real server with the AI routes
