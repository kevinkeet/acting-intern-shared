# SAT Daily

Quick, NYT-games-style daily prep that deliberately covers **everything the Digital SAT tests** — vanilla HTML/JS/CSS, no build step, no backend. Lives at `/sat/` on GitHub Pages.

The pitch: play ~10 minutes a day for 120 days and you will have been taught, drilled, and tracked to mastery on all 30 officially tested skills. See [docs/CURRICULUM.md](docs/CURRICULUM.md) for the full architecture and sources.

## Games

| Game | Inspired by | Covers |
|---|---|---|
| **Focus** 🎯 | — | The curriculum backbone: each day one skill from the 30-day rotation gets a lesson card + 4-question drill. 120 days = 4 passes over the whole syllabus |
| **The Mini** 🔵 | The Mini crossword | 5 timed questions, adaptively picked: today's focus, your 2 weakest skills, an unseen skill, yesterday's focus |
| **Vocab** 🟩 | Wordle | Words in Context — guess the 5-letter word from its definition |
| **The Editor** ✏️ | — | Standard English Conventions: 90-second rapid grammar/punctuation fixes |
| **Connections** 🟪 | NYT Connections | Cross-domain terminology, 4 groups of 4 |
| **Sprint** ⚡ | — | Math fluency: 60s of generated problems across algebra, data, geometry |

## Curriculum engine

- **Skill taxonomy** (`js/data/skills.js`): the official 8 domains / 30 skills with section weights, plus the 30-day focus rotation.
- **Mastery tracking** (`js/core.js`): every answer in every game records to its skill (last-12 accuracy). Levels: not started → learning → solid (6+ tries, ≥70%) → mastered (12+ tries, ≥85%).
- **Adaptive selection** (`SAT.curriculum`): question picks prefer never-served questions (djb2 hash of passage+stem tracked in localStorage) and target focus/weak/unseen skills.
- **Progress page**: the full 30-skill syllabus matrix with mastery chips — coverage gaps are always visible.

## Content inventory

- ~300 skill-tagged questions (`js/data/questions.js` + `js/data/bank/*.js`), every skill ≥6 questions, difficulty 1–3, explanation names the trap. Math answers machine-verified; R&W reviewed for single-defensible-answer.
- 60 rapid conventions items (`js/data/editor-items.js`), 30 lesson cards (`js/data/lessons.js`), 56 vocab words, 12 connections puzzles, 15 sprint generators.

## Structure

```
index.html            shell + script loading (bump ?v= when editing files)
css/style.css         all styles
js/core.js            dates, storage, mastery, curriculum selection, router
js/quiz-engine.js     shared question-answer-explain runner (Mini + Focus)
js/app.js             home + syllabus/progress pages
js/data/              skills taxonomy, lessons, banks, vocab, puzzles
js/games/             one module per game
docs/CURRICULUM.md    the full curriculum architecture + sources
```

## Adding content

Questions: append to a `js/data/bank/*.js` file — `{ skill, d, passage?, q, c[4], a, exp }` with a skill id from `skills.js`. Editor items: `{ skill, s (one ___ blank), c[4], a, exp }`. Keep exactly one defensible answer; distractors should be specific errors.

## Dev

```
cd sat && npx http-server -p 8080 -c-1
```
