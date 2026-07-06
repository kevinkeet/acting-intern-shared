# SAT Daily

Quick, NYT-games-style daily practice for the SAT — vanilla HTML/JS/CSS, no build step, no backend. Lives at `/sat/` on GitHub Pages.

## Games

| Game | Inspired by | Covers |
|---|---|---|
| **Vocab** | Wordle | SAT vocabulary — guess the 5-letter word from its definition, 6 tries |
| **Connections** | NYT Connections | Mixed math + reading/writing categories, 4 groups of 4 |
| **The Mini** | The Mini crossword | 5 timed SAT questions (algebra, geometry, data, advanced math, grammar, words-in-context, reading) with explanations |
| **Sprint** | — | 60 seconds of procedurally generated mental math |

## How it works

- **Daily puzzles**: selected deterministically from the banks by days-since-2026-01-01 (`js/core.js` → `dayIndex()`), so everyone gets the same puzzle on the same day. Each game also has an unlimited **practice** mode (`#/vocab/practice`, etc.).
- **Progress**: streaks, per-game stats, guess distributions, and per-topic accuracy are stored in `localStorage` (`satDaily.v1`) — no accounts, no server. See the 📊 stats page.
- **Sharing**: Wordle-style emoji result grids via the Web Share API (clipboard fallback).

## Structure

```
index.html            shell + script loading (bump ?v= when editing files)
css/style.css         all styles
js/core.js            dates, seeded RNG, storage, hash router, UI helpers
js/app.js             home + stats pages
js/data/              content banks: vocab words, connections puzzles, question bank
js/games/             one module per game
```

## Adding content

- **Vocab**: append to `js/data/vocab.js` — words must be exactly 5 letters, with `pos`, `def`, and an `ex` sentence containing `___`.
- **Connections**: append to `js/data/connections-puzzles.js` — 4 groups × 4 items, ordered easy → hard, all 16 items unique.
- **Mini questions**: append to `js/data/questions.js` — `section` is `math` or `rw`; `topic` feeds the stats page; `a` is the index of the correct choice.

## Dev

```
cd sat && npx http-server -p 8080 -c-1
```
