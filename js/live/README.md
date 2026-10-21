# Live Coworker

A real-time AI coworker that listens while the doctor talks with a patient (or
dictates), keeps a small always-current working memory, thinks in the
background, and speaks only when asked or when something is unsafe.
Full-site door only (`?allmodes`); study and demo browsers never load these
files (`tests/live-doors.test.js`).

## How it works

```
lines in ─► EAR (Haiku 5.5, every few lines) ─► WORKING MEMORY (facts heard,
               │ question / tripwire / alarm     your thinking, plan, take,
               ▼                                  watch list, said, held)
            BRAIN (Sonnet 5.5 or Opus 5.5)
              answer   the doctor asked: streams, may call tools
              verify   a tripwire or alarm fired: interrupt or not?
              update   heartbeat (60 s when something changed, 25 s apart at most)
              prime    before the visit: first take + tripwires for the ear
               │ tools: lookup_labs, search_chart (exact, no AI)
               │        ask_long_term_memory, check_medication (Haiku helpers)
               ▼
            SPEAKING RULES (code): answers always; safety alerts in every mode;
            insights only in Lead, one per 2 min; never repeat a point
            (new, more urgent information may follow up); otherwise hold.
```

The brain's prompt is cached: rules + a chart digest (structured allergies,
meds, problems, labs, vitals, encounters, then the AI long-term memory). Only
the working memory and the task change per call.

## Files

| File | What it does |
|---|---|
| `live-transport.js` | Streams a Messages API call through `ClaudeAPI`'s route (full site: `/api/claude-full`), prices it, retries once on overload |
| `live-chart.js` | Exact chart lookups: labs by name or shorthand, BM25 search over notes, problems, meds, allergies, imaging reports |
| `live-memory.js` | Builds the digest and the long-term text from the chart and the AI memory |
| `live-prompts.js` | Prompts and JSON schemas (`PROMPT_VERSION`) |
| `live-core.js` | The engine (no DOM): ear, working memory, brain lanes, tools, speaking rules, events |
| `live-panel.js` | The panel UI (DOM only) |
| `live-app.js` | Browser glue: chart, memory, mic (Deepgram room mic or browser speech), demo replay, settings |
| `live-fake.js` | `?livefake`: a scripted stand-in model for UI work and UI tests (no AI cost) |

Loader: the end of `js/components/ai-coworker.js`. Styles: `css/live-coworker.css`.

## Try it

- Lab: https://acting-intern-lab.onrender.com/?allmodes → AI Assistant → panel → "play the Morrison demo".
- Locally against the lab's AI routes: `node tools/live/dev-proxy.mjs`, then http://127.0.0.1:8787/?allmodes
  (add `&livefake` for the free stand-in model).

## Test and measure

- `node tests/live-core.test.js`, `node tests/live-doors.test.js`, `node tests/server-routes.test.js`
- `node tools/live/replay.mjs [--brain=opus] [--mode=lead]`: replays `data/live/morrison-admission-01.json`
  through the engine against the lab and scores it (Sonnet judge). Reports in `tools/live/runs/`.
- `node tools/live/script-audio.mjs` then `node tools/live/audio-run.mjs`: the same encounter as
  synthetic multi-voice audio through the real mic path (Deepgram).
- `node tools/live/deeplearn.mjs`: runs the full Deep Learn for PAT001 on the lab and saves
  `data/live/PAT001-deep-memory.json`, which the coworker uses as its long-term memory.

## Saving and reloading the Deep Learn memory

- `node tools/live/deeplearn.mjs` saves a checkpoint after every level
  (`tools/live/runs/PAT001-deeplearn-checkpoint.json`); if a run dies, `--resume`
  continues from the last completed level.
- The finished memory is saved in `data/live/` and committed to both GitHub remotes:
  `PAT001-deep-memory.json` (what the live coworker loads, automatically) and
  `PAT001-ai-seed-full.json` (same shape as the classic coworker's seed).
- To load it into the classic coworker too: `node tools/live/reseed.mjs PAT001`, then commit.
  Any earlier version comes back with `git checkout <commit> -- <file>`.
