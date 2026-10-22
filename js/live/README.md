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

It speaks briefly (prompts `live-v20`). A safety alert is one sentence of at
most 12 words: the action and the one fact that makes it matter ("Hold the
Zosyn: penicillin anaphylaxis in 1985."); the reason waits behind "Why?". An
answer is the answer itself: a fact in one sentence, a drug question in two, the
overall take in four short ones; "tell me more" gives the next level.

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
as told so far, the physical exam, and assessment and plan by problem (the
doctor's plan; the coworker's suggestions only as "consider"). It is rewritten a
few seconds after new speech, at most every 12 s, after each take update and at
the end of the encounter; new or changed sentences light up briefly. About
$0.002 per rewrite.

The physical exam has its own space in the Note tab: vitals said aloud (by
anyone, or read off the monitor) and the findings by system, only what was said
(no normal findings filled in; a correction replaces what it corrects). Three
ways in:
- Just say it while examining, or after ("For my note: JVP to the angle of the jaw…").
- **Dictate exam**: the mic comes on (the same encounter and note, even after
  "End encounter") and the doctor's words are marked as exam dictation until
  **Done**; the patient's are not. A live caption shows what it is hearing, and
  each finding shows at once as "Adding" until the note files it under its
  system (the note catches up 1.5 s after dictation, at most every 5 s). Not in
  the demo, which is a recording.
- Type a finding in the box under the exam ("Lungs: crackles at both bases").
Copy note and the H&P draft (On my radar) include the exam.

The doctor can edit the note in place: click the problem representation, the HPI,
or a problem's name, assessment or plan (one item per line), then Save (⌘↩, or
Enter for a name) or Cancel (Esc). What the doctor wrote stays theirs over every
rewrite ("Edited by you"; "Let it update" hands it back): the scribe sees the edits
and keeps the rest consistent, and code lays them over its version (`editNote`,
`wm.noteRaw` is the scribe's own). In an edited plan, items said later still come
in and items the doctor took out stay out. A rewrite waits while the doctor types.
A "Consider" item is a button ("Order"): one click puts it in that problem's plan
and in the conversation as the doctor's ("You, in the note"), sends it to the radar
at once, and opens its order form once the radar has it ready (several, one after
another; never over a form that is already open) (`acceptSuggestion`).

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
- An order a safety alert is about is flagged at one of two levels (prompts
  `live-v22`). **Stop** (red, first in the list, with the reason, left out of
  "Review all"): the alert says not to give it as it is (Zosyn with penicillin
  anaphylaxis, heparin with a bleed, diltiazem with a low EF). **Check first**
  (amber, "N to check" in the header): it can go ahead once something is checked
  first or alongside (a hemoglobin before diuresing); "Review all" includes it and
  its order form shows "Check first: ...". A flag without a level counts as stop,
  and a red flag never turns amber for the same alert. The doctor's own ticks and
  removals stand; only an order seen placed in the EHR overrides them.
- Side panel: the header ("6 to do · 2 flagged", Review all) and the newest
  item; open it for the whole list. Full screen: the whole list in its own column.
  Only the header is fixed: when space is short the list scrolls, and the
  conversation keeps a few lines. The line in the conversation that put something
  on the radar says "on radar". Ask "Coworker, what's left to order?" and it
  starts from the radar.
- Guards in code (the model does not always follow the prompt): a hold or stop is
  always a nursing order (as a medication order, signing it would give the drug); a
  medicine only the coworker named stays off the list until the doctor takes it up
  ("let's do that"; brand and generic names count as the same drug); an alert that
  also says to hold a drug does not flag the hold; two items listed side by side are
  two things ("BMP" and "magnesium"), and a repeat updates the closest title. A lab
  order that names several tests is split, one item per test with the form's own test
  name ("Repeat BMP and magnesium in the morning", "Type and screen, repeat CBC
  tonight"); so is a medicine said as a load and then a schedule ("Furosemide 80 mg IV
  now, then 40 mg IV twice a day"), or signing it would leave out the second dose. A
  reply that would rename an item into another one already listed is ignored (the BMP
  renamed "Magnesium in the morning" was how the BMP got lost).
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
- **Fill the screen** (the button next to ⓘ): three columns: the conversation; the
  live note; then the radar, the take and what it is tracking. The take and the
  radar open by themselves there. Esc or the same button goes back to the side panel.
- Safety alerts: pinned until "Got it". Each shows one line (the action and the
  fact); "Why?" opens the rest: the chart fact and what was heard. A new point
  about a problem already on screen goes onto that card as an update ("Safety ·
  updated": the newest point leads, "Earlier (n)" shows what came before) and the
  card comes back to the top; after "Got it" the same problem gets a new card.
  The brain decides "same problem" itself (it sees the open alerts and their ids).
- On my radar: the doctor's orders and to-dos (above).
- My take: in the side panel one line, what worries it most; open it for the
  problem representation, assessment and next steps. Open in full screen.
- Long replies in the conversation show their first lines; "More" shows the rest.
- **Inside the coworker** (the ⓘ in the header): the Memory tab draws information
  flowing, top to bottom: the last lines heard in the room, the ear, working memory
  (a dot per thing it filed, by group: story, meds, exam and labs, your thinking,
  the plan; the note and the radar are written from it), then the brain, with the
  chart digest beside it (always in mind) and long-term memory (Deep Learn's 373
  records, one bar per year, 2018 to 2026) that it reaches into only to look
  something up; alerts and answers come out at the bottom, and a saved H&P goes
  back into the chart. Something moves only when that lane actually works, and a
  caption says what just happened ("The ear filed ... under Story"). Loaded only
  when opened (`live-about.js`, `css/live-about.css`).
  Four more tabs, each its own file loaded on first use (`live-about-<id>.js` and
  `css/live-about-<id>.css`):
  - **Digestion**: how the chart becomes what it keeps in mind, from 392 raw files
    (~500K tokens) through 358 fact cards (Haiku, one per record) and the memory
    document (Sonnet, 13 passes) to the ~6K-token digest, and what each call carries.
  - **Problems**: the long-term memory by problem over the years, one dot per record
    that mentions it, hospital stays as bands; pick a problem to read the memory's
    own summary and dated evidence.
  - **How it thinks**: for any alert, update, answer or thought, the chain behind it:
    the words heard, what the ear filed, the tripwire or alarm that set off the check,
    the verdict, what it said, and what it led to (a flagged radar item). And its
    picture of the patient over time: a strip of every look it took (a new or more
    urgent worry in amber or red), and for each version what was new since the one
    before, what changed (summary and assessment word by word; worries new, more
    urgent or dropped) and the take as it stood, with the live note's summary at that
    time (`wm.takes`, `wm.notePRs`).
  - **Each call**: what every AI call actually read, part by part (rules, digest,
    working memory, conversation, lookups, task), how much was cached, time and cost.
  The numbers behind Digestion and Problems come from `tools/live/memory-stats.mjs`
  (writes `data/live/<patient>-memory-stats.json`; rerun after a new Deep Learn).
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
| `live-app.js` | Browser glue: chart, memory, mic (Deepgram room mic or browser speech), demo replay (voices, the ending's EHR actions), full screen, settings, the radar's buttons (order form, nurse chat, note editor) |
| `live-about.js` | "Inside the coworker": the tabs, the memory rings and the lanes, live (loaded on first open) |
| `live-about-*.js` | Its other views: digest, threads, why, calls (each loaded when its tab opens) |
| `live-fake.js` | `?livefake`: a scripted stand-in model for UI work and UI tests (no AI cost) |

Loader: the end of `js/components/ai-coworker.js`. Styles: `css/live-coworker.css`.

## Try it

- Lab: https://acting-intern-lab.onrender.com/?allmodes → AI Assistant → panel → "play the Morrison demo".
  The demo (version 2, 13½ minutes, `data/live/morrison-admission-02.json`) has
  recorded voices, one per speaker (Deepgram Aura; they play at 1× and 2×, and the
  speaker button in the player turns them off), Dr. Rivera thinking out loud through
  the plan, and an ending at the workstation where the demo works the EHR: it takes
  the four flagged orders off the radar, keeps the furosemide (signing it even if the
  coworker flagged it to wait for labs), signs the rest with "Review all", places the
  new orders, ticks off the med rec and the allergy update, and saves the H&P from the
  live note. A pause holds the ending where it is; Stop ends it.
  `?livedemo=01` plays version 1 (shorter, no voices, no ending).
- Locally against the lab's AI routes: `node tools/live/dev-proxy.mjs`, then http://127.0.0.1:8787/?allmodes
  (add `&livefake` for the free stand-in model).

## Test and measure

- `node tests/live-core.test.js`, `node tests/live-doors.test.js`, `node tests/server-routes.test.js`
- `node tools/live/replay.mjs [--brain=opus] [--mode=lead]`: replays `data/live/morrison-admission-01.json`
  through the engine against the lab and scores it (Sonnet judge). Reports in `tools/live/runs/`.
  `--script=data/live/morrison-admission-02.json` replays version 2 (same planted moments).
- `node tools/live/build-demo-v2.mjs`: rebuilds version 2 from version 1 (the thinking-aloud
  lines, the ending and its EHR actions), its review sheet (`.md`) and its voices through the lab's `/api/tts`
  (about 3 MB of MP3s in `data/live/audio/morrison-admission-02/`); `--no-tts` keeps the saved audio.
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
