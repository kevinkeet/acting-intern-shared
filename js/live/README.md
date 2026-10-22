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
              verify   a tripwire or alarm fired: say now, wait for the doctor's
                       next words (then look again), or keep quiet
              update   the take: heartbeat every 90 s while things change,
                       20 s after something "worth a look", never < 60 s apart
              prime    before the visit: first take + tripwires for the ear
               │ tools: lookup_labs, search_chart (exact, no AI)
               │        ask_long_term_memory, check_medication (Haiku helpers)
               ▼
            SPEAKING RULES (code): answers always; "critical" safety alerts in
            every mode; "important" points held until asked (Lead offers one
            per 2 min); never repeat a point (a check that finishes after
            another alert went out asks Haiku whether that alert covers it);
            otherwise hold.
```

The brain's prompt is cached: rules + a chart digest (structured allergies,
meds, problems, labs, vitals, encounters, then the AI long-term memory, about
6K tokens). Only the working memory and the task change per call. The long-term
memory helper reads the whole Deep Learn record (about 319K tokens for PAT001,
cached; thinking off, 2 to 5 s per question) and only when the brain asks.

## The room mic

The live coworker's mic asks the server's Deepgram relay for the medical model
(`nova-3-medical`) and passes up to 50 key terms: the patient's medicines (brand
and generic), allergies, common inpatient drugs and a few clinical words
(`LiveChart.speechTerms()`), so "Zosyn" and "pneumonia" are heard as such. The
relay accepts only `model=medical` and well-formed `keyterm=` values; callers
that pass nothing (classic dictation, the scribe) connect as before.
`?livemic=general` (or `audio-run.mjs --mic=general`) uses the general model for
side-by-side tests.

## The live note

A scribe (Haiku 5.5, thinking off) keeps a short admission note current: a
problem representation (two or three sentences with the key qualifiers), the HPI
as told so far, and assessment and plan by problem (the doctor's plan; the
coworker's suggestions only as "consider"). It is rewritten a few seconds after
new speech, at most every 12 s, after each take update and at the end of the
encounter; new or changed sentences light up briefly. About $0.002 per rewrite.

## On my radar

Every order, consult, referral, message, note and task the doctor asks for goes
on a list, ready to act on with one click:

- The ear catches it as a plan item ("Repeat BMP and magnesium in the morning")
  and it shows at once as "heard". A second cheap model (Haiku 5.5, thinking off;
  1.5 to 3.5 s, about 2 cents an encounter) turns it into items: one per orderable
  thing, with the EHR order form's own fields and choices, a drafted message or
  note, and the next step. It sees the list so far and returns only what changed;
  "no lisinopril then" takes an item off.
- Buttons: **Review order** / **Order consult** opens the EHR's order form filled
  in ("From the coworker's radar"); signing it ticks the item off and the
  coworker safety-checks the order like any other; under an order, "Fill in: dose"
  names what the form still needs (worked out from the form, not the model).
  **Review all N** (in the radar's header) opens the orders one after another
  (flagged ones are left out). **Message nurse** opens the
  nurse chat with the message typed in; **Open draft** opens the note editor (an
  H&P starts from the live note), and Save to Chart ticks it off; other messages
  and referrals have **Copy**. Tasks (update the allergy list, the med rec, a
  family meeting) have the next step and a tick box.
- An order a safety alert is about is **flagged**: red, first in the list, with
  the reason, and left out of "Review all". The doctor's own ticks and removals
  stand; only an order seen placed in the EHR overrides them.
- Narrow panel: the header ("6 to do · 2 flagged", Review all) and the newest
  item; open it for the whole list. Side by side: the whole list under the alerts.
  Only the header is fixed: when space is short the list scrolls, and the
  conversation keeps a few lines. The line in the conversation that put something
  on the radar says "on radar". Ask "Coworker, what's left to order?" and it
  starts from the radar.
- The model maps to the form's choices; code maps what it says otherwise ("twice
  a day" to BID, "BMP" to Basic Metabolic Panel) and leaves a choice blank rather
  than guess (`LiveCore.toOrderForm`). `tests/live-core.test.js` checks the
  field guide still matches `js/components/order-entry.js`.

## The panel

- Header: a full-width **Start encounter** when idle; during the encounter
  "Encounter · 3:42", the mic pauses and resumes, **End encounter** writes the final
  note. Mode (Follow / Abreast / Lead). If two AI calls fail in a row, or it hears
  speech and the ear gets no reply for 20 s, it says **"not checking"** (amber mic
  and a pinned warning) until calls succeed again: silence must never look like "all clear".
- Safety alerts: pinned until "Got it". The first sentence (the action) is bold;
  older alerts fold to that sentence. "Why?" shows the chart fact and what was heard.
  A new point about a problem already on screen goes onto that card as an update
  ("Safety · updated": the newest point leads, what came before sits below) and
  the card comes back to the top; after "Got it" the same problem gets a new card.
  The brain decides "same problem" itself (it sees the open alerts and their ids).
- On my radar: the doctor's orders and to-dos (above).
- My take: the problem representation, then what worries it most; assessment and
  next steps on request. One line while an alert waits.
- Conversation (what it heard and what it said, in order, with a live caption),
  Note (the live note; "Side by side" widens the panel to show both), Tracking
  (working memory), Log (decisions, calls, cost).
- After "Coworker, …" it waits for the whole question ("um" and pauses are fine).
- Read aloud (setting): answers and safety alerts in Deepgram's natural Aura voice
  (server route `/api/tts`, one sentence per request, the next fetched while one
  plays; Athena by default, nine to choose from), or this computer's voice, which
  also takes over if the server can't speak. It stops when you talk, and the mic
  ignores its own voice.

## Files

| File | What it does |
|---|---|
| `live-transport.js` | Streams a Messages API call through `ClaudeAPI`'s route (full site: `/api/claude-full`), prices it, retries once on overload |
| `live-chart.js` | Exact chart lookups: labs by name or shorthand, BM25 search over notes, problems, meds, allergies, imaging reports |
| `live-memory.js` | Builds the digest and the long-term text from the chart and the AI memory |
| `live-prompts.js` | Prompts and JSON schemas (`PROMPT_VERSION`) |
| `live-core.js` | The engine (no DOM): ear, working memory, brain lanes, tools, speaking rules, the live note, the radar, events |
| `live-voice.js` | Speaking aloud (Deepgram's Aura voices, or this computer's): cleanup, sentence pieces, voice choice, echo check |
| `live-panel.js` | The panel UI (DOM only) |
| `live-app.js` | Browser glue: chart, memory, mic (Deepgram room mic or browser speech), demo replay, settings, the radar's buttons (order form, nurse chat, note editor) |
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
