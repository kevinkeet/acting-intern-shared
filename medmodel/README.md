# MedModel — individualized medication benefit, harm & burden

Standalone, no-build web app (same conventions as the rest of this repo: plain
HTML/JS/CSS, browser globals, cache-busted script tags). Lives entirely under
`medmodel/`; not linked from the main simulator navigation.

> **Deployment note:** the canonical public deployment of this app is the
> `kevinkeet/medeval` repo, which serves it at meds.kevinkeet.com (original
> calculator preserved there under `/legacy/`). This copy is the teaching-
> simulator sibling; the files are structured identically — port meaningful
> changes across.

**What it does:** starts from RCT evidence and adjusts the expected absolute
benefit for the patient in front of you — baseline risk → competing mortality →
time-to-benefit → adherence — then shows harms (patient-scaled, immediate) and
treatment burden beside it. Every adjustment is displayed as a step in a
waterfall so the reasoning is inspectable.

**Merged with meds.kevinkeet.com (kevinkeet/medeval):** the upstream
60-medication database is imported verbatim and "lifted" into the engine
(NNT/RRR → implied control hazard + HR), with MedModel's 12 hand-verified
deep entries overlaid where they match (★ in the UI). Two views: a
single-medication deep dive, and a regimen review that ranks every therapy
applicable to the patient by severity-weighted net benefit (medeval's QALY
weights on engine-computed event counts). Symptomatic/replacement drugs are
deliberately not forced through the prevention model.

## Files

| File | Role |
|---|---|
| `index.html` | App shell (both views) |
| `methods.html` | Methods & evidence: formulas, data lineage, ~65 citations |
| `js/engine.js` | Pure computation: monthly-cycle competing-hazards model (`window.BenefitModel`, node-requirable) |
| `js/data/medications.js` | Deep-verified evidence entries, 12 meds (`window.MedLibrary`) |
| `js/data/medeval-database.js` | Upstream 60-med database from kevinkeet/medeval, imported verbatim + browser export (`window.MedevalDB`) — keep byte-compatible for two-way sync |
| `js/services/lift.js` | medeval→engine conversion: lift math, class-default TTB table, deep-overlay map, severity weights, contraindication matching (`window.Lift`) |
| `js/data/riskmodels.js` | PCE, CHA₂DS₂-VASc (Friberg), HAS-BLED (Pisters), CKD-EPI 2021 (`window.RiskModels`) |
| `js/data/lifetables.js` | Health levels, condition mortality HRs, Walter–Covinsky reference (`window.LifeTables`) |
| `js/app.js` | UI wiring: patient state, resolve deep/lifted/symptomatic, both views |
| `test/engine.test.js` | PCE worked examples, life-table anchors, trial round-trips (SPRINT, DAPA-HF), monotonicity |
| `test/lift.test.js` | CKD-EPI/HAS-BLED check values, catalog build, lift math vs hand entries, DOAC composition, deep-map integrity |

## Syncing with kevinkeet/medeval

`js/data/medeval-database.js` is the upstream `medications-database.js` plus an
attribution header and a browser-global export at the bottom. To pull upstream
changes, replace the middle verbatim; to push improvements upstream, copy the
edited entries back. New medeval entries appear in the catalog automatically
via the lift; add a `DEEP_MAP` row in `lift.js` when a hand-verified entry
should take over a drug-indication pair.

After editing any JS/CSS here, bump the `?v=` strings in both HTML files.

Run tests before committing:
`node medmodel/test/engine.test.js && node medmodel/test/lift.test.js`.
