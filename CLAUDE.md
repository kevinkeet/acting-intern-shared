# Project: Acting Intern — Clinical Simulation

## Git
- Two remotes: `origin` (synthetic-ehr, personal) and `shared` (acting-intern-shared, collaborative)
- After committing, always push to **both** remotes: `git push origin main && git push shared main`
- Commit messages: short summary line, optional detail paragraph, always include Co-Authored-By trailer

## Architecture
- **No build system** — plain HTML/JS/CSS, deployed to GitHub Pages
- **No backend** — API calls go directly to Anthropic from the browser
- **No frameworks** — vanilla JS with global objects (e.g., `window.ClaudeAPI`, `window.AICoworker`)
- Single-page app: `index.html` loads all scripts, `js/router.js` handles hash-based routing

## Cache Busting
- All `<script>` and `<link>` tags in `index.html` use `?v=YYYYMMDD[x]` query params
- When changing any JS/CSS file, bump the version string in `index.html` (search for the current version, replace all)
- Global version also stored in `window.__CACHE_V`

## Key Files
- `js/components/ai-coworker.js` — Core AI logic + rendering (4700+ lines, the big one)
- `js/services/context-assembler.js` — Prompt construction for AI analysis
- `js/services/claude-api.js` — HTTP client to Anthropic API
- `js/components/ai-panel.js` — AI panel UI shell
- `css/epic-theme.css` — All styles, EPIC-inspired design system

## Anthropic Model IDs
- `claude-sonnet-4-6` (default, no date suffix)
- `claude-opus-4-6` (no date suffix)
- `claude-haiku-4-5-20251001` (has date suffix)
- `claude-sonnet-4-5-20250929` (has date suffix)

## Dev Server
- `npx http-server -p 8080 -c-1` or use the launch.json config `ehr-dev`
