# MedModel — individualized medication benefit, harm & burden

Standalone, no-build web app (same conventions as the rest of this repo: plain
HTML/JS/CSS, browser globals, cache-busted script tags). Lives entirely under
`medmodel/`; not linked from the main simulator navigation.

**What it does:** starts from RCT evidence and adjusts the expected absolute
benefit for the patient in front of you — baseline risk → competing mortality →
time-to-benefit → adherence — then shows harms (patient-scaled, immediate) and
treatment burden beside it. Every adjustment is displayed as a step in a
waterfall so the reasoning is inspectable.

## Files

| File | Role |
|---|---|
| `index.html` | App shell |
| `methods.html` | Methods & evidence: formulas + ~60 citations |
| `js/engine.js` | Pure computation: monthly-cycle competing-hazards model (`window.BenefitModel`, node-requirable) |
| `js/data/medications.js` | Evidence library, 12 meds (`window.MedLibrary`) |
| `js/data/riskmodels.js` | Pooled Cohort Equations + CHA₂DS₂-VASc (`window.RiskModels`) |
| `js/data/lifetables.js` | Health levels, condition mortality HRs, Walter–Covinsky reference (`window.LifeTables`) |
| `js/app.js` | UI wiring |
| `test/engine.test.js` | `node medmodel/test/engine.test.js` — PCE worked examples, life-table anchors, trial round-trips (SPRINT, DAPA-HF), monotonicity |

## Adding medications (e.g., from meds.kevinkeet.com)

The library is a plain array of entries; merge external datasets with
`MedLibrary.merge([...])` or add entries directly in `medications.js`.
Each entry needs: an effect (trial HR + CI + source), a baseline-risk method
(`pce` | `chadsvasc` | `anchored` with control rate + risk-level multipliers),
`ttb` (ramp + displayed literature value), `trial` metadata (mean/max age,
adherence, exclusions — drives the representativeness badge), `harms`
(absolute excess rates + `scaling` rules), `burden` facets, and `citations`.

After editing any JS/CSS here, bump the `?v=` strings in both HTML files.

Run tests before committing: `node medmodel/test/engine.test.js`.
