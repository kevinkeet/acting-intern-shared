# Acting Intern — Architecture Overview

## What It Is
A PHI-free clinical simulation platform that combines a realistic EHR interface, an AI clinical copilot with persistent memory, a dynamic patient physiology simulator, and multi-modal chat (patient/nurse) with voice I/O. Built as a static site — no backend, no build system. All state lives in localStorage and the Anthropic API.

## Project Structure
```
index.html                     Single-page app entry point (all scripts loaded here)
css/epic-theme.css             EPIC-inspired design system: CSS variables, flexbox layout, responsive
js/app.js                      Init orchestrator: loads patient, starts components, sets up routing
js/router.js                   Hash-based SPA router (#/labs, #/notes/:id, #/vitals, etc.)
js/data-loader.js              Fetches & caches patient JSON data from data/ directory
js/utils/                      date-utils, lab-utils (H/L/C flagging), search index builder
js/components/  (30 modules)   UI rendering — each owns one view or widget
js/services/    (16 modules)   Business logic — AI, simulation, speech, context management
data/patients/PAT001/          Synthetic patient: demographics, labs, meds, notes, vitals, imaging
data/scenarios/                Simulation scenarios (e.g., CHF exacerbation with progression rates)
```

## Init Flow (app.js)
`Navigation → GlobalSearch → OrderEntry → AIPanel → SimulationEngine → SimulationControls → LiveVitalsBanner → SimulationLog → DynamicLabs → DynamicImaging → SimulationDebrief → ClinicalImages → FloatingChat → AICoworker → loadPatient(PAT001) → router.init() → About.checkFirstVisit() → logoAnimation`

## EHR Interface (js/components/)
30 components render a full chart: **chart-review** (dashboard), **labs-table** + **lab-trending** (Chart.js), **medications**, **problems** (ICD-10), **vitals** (flowsheet), **notes-list** + **note-viewer**, **imaging**, **orders** + **order-entry**, **encounters**, **allergies**, **procedures**, **history** (social/family), **immunizations**, **global-search** (Cmd+K across chart), **patient-header** (banner), **navigation** (sidebar). Each component has a `render()` method called by the router.

## AI System — 4-Layer Memory Architecture
```
Doctor Action (ask, dictate, refresh, write note)
  → SessionContext         Ephemeral: tracks chart navigation, timing, doctor inputs
  → LongitudinalDocument   Persistent: patient knowledge base accumulating across sessions
  → WorkingMemory          Focused: assembles 3-15K char context subset per interaction type
  → ContextAssembler       Builds systemPrompt + userMessage pair for the API call
  → Anthropic API          POST to /v1/messages (Sonnet 4.6 default, configurable)
  → LongitudinalUpdater    Parses AI response, writes memory updates back to persistent doc
  → AICoworker.render()    Displays: one-liner, clinical summary, problem list w/ DDx, actions
```
**5 interaction types** with different context budgets: Ask (~3-5K), Dictate (~6-10K), Refresh (~12-15K), Write Note (~12-15K), Update (~6-10K). The AI acts as an "acting intern" — organizes information, flags safety concerns, suggests actions, but never leads decisions.

**Key files:** `ai-coworker.js` (4700+ lines, core logic + rendering), `ai-panel.js` (collapsible panel UI), `context-assembler.js` (prompt construction), `working-memory.js` (context assembly), `longitudinal-document.js` + `longitudinal-builder/renderer/updater.js` (persistent knowledge base), `session-context.js` (session tracking), `claude-api.js` (HTTP client).

## Simulation Engine
**SimulationEngine** ticks every 1s real-time at 15x speed (1 real min = 15 sim min). Each tick: **PhysiologyEngine** applies natural disease progression across 5 systems (cardiovascular, fluid balance, renal, respiratory, symptoms) with stochastic noise → **InterventionTracker** applies medication/procedure effects using sigmoid dose-response curves (onset, peak, duration) → **DynamicLabs/DynamicImaging** generate synthetic results at scenario timepoints → UI updates vitals, labs, clinical state. Scenarios define initial state, progression rates, and intervention effect profiles. **SimulationScoreTracker** grades clinical decisions; **SimulationDebrief** provides post-scenario feedback.

## Chat System
**PatientChat** and **NurseChat** simulate clinical conversations via the Anthropic API with role-specific system prompts. Both support **voice I/O** (Web Speech API). **FloatingChat** manages independent pop-up windows. Context can be loaded from Google Docs for custom scenarios. Messages persist in localStorage.

## Data Architecture (data/patients/PAT001/)
```
demographics.json, allergies.json, encounters.json, vitals.json, family_history.json,
social_history.json, immunizations.json, orders.json, procedures.json
medications/{date}.json          Active & historical by encounter
problems/active.json + resolved.json   ICD-10 coded
labs/panels/{id}.json + results/{id}.json   Structured lab data with reference ranges
notes/{date}_{type}_{id}.json    ~100+ clinical notes
imaging/{date}.json              Studies with findings
```

## Tech Stack
| Technology | Use |
|---|---|
| Vanilla JS (no framework) | All components and services |
| Chart.js (CDN) | Lab trending and vitals visualization |
| Anthropic Claude API | AI copilot, patient/nurse chat (direct browser access) |
| Web Speech API | Voice input/output in chats |
| localStorage | State persistence, API keys, model preferences, AI memory |
| CSS Variables + Flexbox | Responsive EPIC-inspired theming |

## Layout (css/epic-theme.css)
Header (48px) → Allergy banner → Sidebar (200px, collapsible) + Main content + AI Panel (320px default, resizable 280-900px, starts collapsed). Floating AI button appears when panel is collapsed. Toast notifications, modals, tutorial spotlight overlay all managed via z-index layers. Print-ready with media queries.

## Key Design Decisions
- **No build system** — plain HTML/JS/CSS, deployed to GitHub Pages
- **No backend** — API calls go directly to Anthropic from browser (`anthropic-dangerous-direct-browser-access` header)
- **Doctor-driven AI** — the AI copilot mirrors, organizes, and flags but never leads clinical decisions
- **Persistent memory** — longitudinal document survives across sessions via localStorage + AI write-back
- **Cache busting** — all script tags use `?v=` query params; bump once in index.html to invalidate everything
