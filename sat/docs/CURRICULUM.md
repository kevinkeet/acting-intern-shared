# SAT Daily — Curriculum Architecture

Goal: **play every day for ~4 months (120 days) and you will have studied, drilled, and demonstrated mastery of every skill tested on the Digital SAT.**

This document defines the syllabus (what the test covers), the coverage model (how the app guarantees you touch all of it), and the mapping from skills to games.

## 1. What the Digital SAT tests

The Digital SAT has 8 content domains containing 30 distinct tested skills. Sources: College Board test specifications and domain descriptions, cross-checked against prep-provider breakdowns (PrepScholar, Test Innovators, The Test Advantage, Larry Learns, Albert.io).

### Reading & Writing — 54 questions, 64 min

| Domain | Weight | Skills (app skill id) |
|---|---|---|
| Craft and Structure | ~28% (13–15 q) | Words in Context (`craft-wic`) · Text Structure and Purpose (`craft-tsp`) · Cross-Text Connections (`craft-ctc`) |
| Information and Ideas | ~26% (12–14 q) | Central Ideas and Details (`info-cid`) · Command of Evidence: Textual (`info-coe-t`) · Command of Evidence: Quantitative (`info-coe-q`) · Inferences (`info-inf`) |
| Standard English Conventions | ~26% (11–15 q) | Boundaries (`sec-boundaries`) · Form, Structure, and Sense (`sec-form`) |
| Expression of Ideas | ~20% (8–12 q) | Rhetorical Synthesis (`exp-synthesis`) · Transitions (`exp-transitions`) |

### Math — 44 questions, 70 min

| Domain | Weight | Skills (app skill id) |
|---|---|---|
| Algebra | ~35% (13–15 q) | Linear equations in 1 variable (`alg-lin1`) · Linear equations in 2 variables (`alg-lin2`) · Linear functions (`alg-linfunc`) · Systems of 2 linear equations (`alg-sys`) · Linear inequalities (`alg-ineq`) |
| Advanced Math | ~35% (13–15 q) | Equivalent expressions (`adv-equiv`) · Nonlinear functions (`adv-nonlinfunc`) · Nonlinear equations & systems (`adv-nonlineq`) |
| Problem-Solving & Data Analysis | ~15% (5–7 q) | Ratios/rates/proportions/units (`psda-ratio`) · Percentages (`psda-percent`) · One-variable data (`psda-1var`) · Two-variable data (`psda-2var`) · Probability (`psda-prob`) · Inference & margin of error (`psda-inference`) · Evaluating statistical claims (`psda-claims`) |
| Geometry & Trigonometry | ~15% (5–7 q) | Area and volume (`geo-area`) · Lines, angles, triangles (`geo-lines`) · Right triangles & trigonometry (`geo-trig`) · Circles (`geo-circles`) |

## 2. The coverage model

Three mechanisms together guarantee full-syllabus coverage; none relies on the student choosing wisely.

**a) The Focus rotation (deliberate instruction).** A fixed 30-day cycle orders all 30 skills pedagogically (foundations before applications, math and R&W interleaved). Each day, one skill is *today's focus*: the **Focus** game shows that skill's lesson card — the complete essential knowledge, written to be re-readable in 60 seconds — then drills 4 questions on exactly that skill. Over 120 days the cycle runs 4 full passes, so every skill is formally taught and re-drilled at least 4 times, echoing the structure of commercial 4-month plans (foundation → fluency → weakness targeting → polish).

**b) Adaptive selection (weakness targeting).** *The Mini* (5 questions/day) is not random: it picks from (1) skills you've never seen, (2) your weakest skills by recent accuracy, (3) today's and yesterday's focus skills (spaced repetition), weighted toward the domains the real test weights most. Seen questions are tracked and not repeated until the pool is exhausted.

**c) Fluency games (automaticity).** Sprint (mental math across algebra/data/geometry generators), The Editor (90-second grammar conventions blitz), Vocab (words in context), and Connections (cross-domain terminology) build the speed layer that the adaptive drilling doesn't. Every answer in every game feeds the same per-skill mastery record.

### Mastery model

Each skill tracks total attempts, correct answers, and the last 12 results. Levels:

| Level | Criteria |
|---|---|
| Not started | 0 attempts |
| Learning | attempted, but recent accuracy < 70% or < 6 attempts |
| Solid | ≥ 6 attempts and recent accuracy ≥ 70% |
| Mastered | ≥ 12 attempts and recent accuracy ≥ 85% |

The progress page renders the full 30-skill matrix grouped by domain — the syllabus IS the progress screen, so a gap is always visible. "Syllabus coverage" = skills at Solid or better; the headline goal is 30/30 Mastered.

## 3. Skill → game mapping

| Skill group | Focus drill | The Mini | Sprint | Editor | Vocab | Connections |
|---|---|---|---|---|---|---|
| Algebra (5) | ✓ | ✓ | ✓ (solve-x, slope, evaluate f) | | | ✓ (terms) |
| Advanced Math (3) | ✓ | ✓ | ✓ (exponents, squares) | | | ✓ |
| PSDA (7) | ✓ | ✓ | ✓ (percent, mean, rates, units) | | | ✓ |
| Geometry/Trig (4) | ✓ | ✓ | ✓ (area, triples) | | | ✓ |
| Craft & Structure (3) | ✓ | ✓ | | | ✓ (words in context) | ✓ |
| Information & Ideas (4) | ✓ | ✓ | | | | |
| Conventions (2) | ✓ | ✓ | | ✓ (30+30 rapid items) | | ✓ |
| Expression of Ideas (2) | ✓ | ✓ | | | | |

Every skill is covered by at least two games: the Focus drill (deliberate practice with instruction) plus at least one other format.

## 4. Content inventory

- Question bank: ~300 skill-tagged multiple-choice questions (every skill ≥ 6, weighted toward Algebra/Advanced Math to match the test), each with difficulty 1–3 and an explanation that names the trap.
- Editor bank: 60 rapid conventions items (30 Boundaries, 30 Form/Structure/Sense).
- Lesson cards: 30 — one per skill, 4–6 bullets of complete essential knowledge + a test-day tip.
- Vocab bank: 56 SAT-level words. Connections: 12 cross-domain puzzles. Sprint: 15 procedural generators (infinite).

## 5. Honest scope note

Daily play builds and proves skill mastery across the full tested syllabus. A real 1600 also requires full-length timed practice under test conditions — the app's stats page reminds students to take official Bluebook practice tests in months 2–4; the app is the daily engine, Bluebook is the dress rehearsal.

## Sources

- College Board, [Digital SAT Test Specifications Overview](https://satsuite.collegeboard.org/media/pdf/digital-sat-test-spec-overview.pdf) and [Content Domains](https://satsuite.collegeboard.org/practice/content-domains)
- College Board, [The Math Section: Overview](https://satsuite.collegeboard.org/sat/whats-on-the-test/math/overview)
- [PrepScholar — question type breakdown by percent](https://blog.prepscholar.com/breakdown-of-every-question-type-in-sat-reading-by-percentage); [PrepScholar — SAT study plans](https://blog.prepscholar.com/sat-study-plan)
- [Test Innovators — R&W section guide](https://testinnovators.com/blog/digital-sat-reading-writing-section/)
- [Larry Learns — SAT Math topics](https://www.larrylearns.com/blog/sat-math-topics); [Ivy Strides — Math domain breakdown](https://www.ivystrides.com/blog/sat-math-topics/)
