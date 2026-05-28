# PAT004 — Marcus Bell — Assessment Walkthrough

> **Purpose.** Shows what the resident sees, the six questions across two
> timepoints, what a rubric-passing answer looks like, and how a *novice*
> (AI-naïve) vs an *educated* (AI-literate) resident perform on the same case
> with the same clinical knowledge but opposite AI habits.
>
> **Caveat on the simulation.** I did not drive the live Haiku chatbot (its API
> key is encrypted under the site access password). These are high-fidelity
> simulated runs against the actual chart and the real `ap1.json` / `ap2.json`
> rubrics. Scores are best-faith estimates against the documented essential /
> bonus / red-flag lists.

---

## The case in one paragraph

Marcus Bell, 43, a previously healthy construction foreman, presents with an
**acute, essentially unprovoked segmental PE** and an **extensive right-leg
DVT** (low-risk: troponin negative, no RV strain). Imaging incidentally finds a
**17 cm right-hepatic-lobe mass** with left-lobe foci and **right portal-vein
thrombus**, with high radiologic suspicion for malignancy and a recommendation
to biopsy. He is anticoagulated, transitioned to apixaban, and an outpatient
biopsy is planned. Per interventional radiology, **apixaban is held 3 days**
for the biopsy — and during that hold he returns with **progressed bilateral PE,
new RV strain, and a new troponin rise**. The case is not about diagnosing the
mass; it is about competing-risk anticoagulation: how long to anticoagulate
before biopsying, how to handle a DOAC around a procedure, when (not) to bridge,
and whether the post-hold recurrence warrants an IVC filter.

## At-a-glance

| | |
|---|---|
| Timepoints | 2 (TP1 = initial admission HD5, 2027-07-10; TP2 = readmission, 2027-08-10) |
| Questions | 6 (Q1-Q4 at TP1; Q5-Q6 at TP2) |
| Total weight | 4.2 |
| Time budget | ~28 min |
| Pass | 70% (= 2.94 / 4.2) |
| Source | Management Case Bank, Case 2 (discussants Pishko, Carroll, Weinstein; finalized by Kanjee) |

## The two personas

**Novice (AI-naïve):** pastes each question verbatim, takes the first answer,
never opens the primary imaging or the interventional-radiology note, doesn't
connect *why* the recurrence happened, copies the generic AI output.

**Educated (AI-literate):** reads the primary sources (the liver MRI; at TP2,
the IR pre-procedure note and the readmission workup), prompts with the
patient's specifics, and synthesizes — especially recognizing that the TP2
recurrence happened *during an anticoagulation hold*.

## Where the answer-relevant facts are deliberately scattered / gated

- The **liver MRI** (17 cm mass + portal-vein thrombus + biopsy recommendation)
  is a separate report from the CTPA — the educated resident opens it.
- The exact **"hold apixaban 3 days"** instruction lives ONLY in the IR
  pre-procedure note, which is **gated to TP2** — so at TP1 it cannot hand away
  the DOAC-hold question (Q3); the resident must reason it out.
- At TP2, the **reason** for the recurrence (it happened during the supervised
  3-day hold, while he was *off* anticoagulation) is the crux of Q5 — it lives
  in the IR note + the readmission notes, and the progressed-PE problem and CTA
  only appear at TP2.

---

## TP1 — Initial admission (HD5)

### Q1 — How long to anticoagulate before biopsy + rationale (weight 0.9)

**Rubric-passing answer:** defer the (non-emergent) biopsy to allow ~3-4 weeks
(about a month) of uninterrupted anticoagulation first, because VTE recurrence
risk is highest in the first weeks after an acute event; the tissue diagnosis
won't change the immediate management (anticoagulation either way), so it can
wait — a competing-risk judgment.

**Novice** pastes the question → the generic answer often does land "delay the
elective procedure ~3-4 weeks; early-recurrence risk is highest," but stays
generic and doesn't tie it to *this* patient (portal-vein thrombus, unprovoked
→ occult malignancy). **~3/4 essentials, no bonuses. ~0.60 / 0.90 (67%).**

**Educated** reads the MRI, frames the competing risk, and emphasizes the biopsy
is not emergent → all essentials + bonuses (portal-vein thrombus, occult
malignancy, multidisciplinary). **~0.85 / 0.90 (94%).**

*Discrimination: moderate.*

### Q2 — General biopsy-timing factors, prompt vs delay (weight 0.7)

**Rubric-passing answer:** names factors on BOTH sides (prompt: result urgently
changes management, low lesion bleeding risk, stable patient; delay: recent VTE
in the high-recurrence window, large/visceral clot burden, result doesn't change
near-term management, high procedural bleeding risk), explicitly weighs the
competing risks, and considers procedure bleeding risk + anticoagulant
reversibility.

**Novice:** a generic, somewhat one-sided list; tends to miss the anticoagulant
half-life/reversibility angle. **~0.45 / 0.70 (64%).**
**Educated:** balanced both-sides answer + bonuses (multidisciplinary,
less-invasive data, risk-stratify by PE severity). **~0.65 / 0.70 (93%).**

*Discrimination: moderate.*

### Q3 — DOAC hold duration before the procedure + rationale (weight 0.7)

**Rubric-passing answer:** a percutaneous liver biopsy is HIGH bleeding risk →
hold apixaban ~48 hours (48-72h acceptable) with normal renal function, tied to
its ~12-hour half-life and the procedure's bleeding risk, adjusting for renal
function.

**Novice** pastes the question → generic DOAC-periprocedural knowledge ("hold
24-48h depending on bleeding risk and renal function") but often fails to firmly
classify the liver biopsy as HIGH-risk, so may under-hold and stay vague on
renal adjustment. (The IR note's "3 days" is gated to TP2, so the novice can't
copy it.) **~0.45 / 0.70 (64%).**
**Educated:** classifies high-bleed-risk, 48h, half-life rationale, renal
adjustment, PAUSE-style framing. **~0.65 / 0.70 (93%).**

*Discrimination: moderate.*

### Q4 — Bridging factors (weight 0.5)

**Rubric-passing answer:** DOACs generally do NOT need bridging (short
half-life; brief interruption window); the decision balances thrombotic vs
bleeding risk; renal function matters.

**Novice:** the "DOACs don't need bridging" headline is textbook and AI captures
it well. **~0.35 / 0.50 (70%).**
**Educated:** full + bonus (delay rather than bridge for very high thrombotic
risk; BRIDGE-trial evidence). **~0.48 / 0.50 (96%).**

*Discrimination: low* — this is the one AI nails unprompted.

---

## TP2 — Readmission with recurrent PE

### Q5 — IVC filter for this patient? (weight 0.9) — the discriminator

**Rubric-passing answer:** recognize the recurrence happened during a
**supervised anticoagulation HOLD** (not despite therapeutic anticoagulation) —
so it is *not* an anticoagulation failure; he has **no contraindication** to
anticoagulation and is now therapeutic on heparin → the standard filter
indications are not met → **generally NO filter**; resume/optimize
anticoagulation, and entertain only a **retrievable** filter if another
mandatory interruption is truly unavoidable.

**Novice** pastes "recurrent PE — would you place an IVC filter?" → the generic
answer leans **toward** a filter ("recurrent VTE can be an indication; consider a
retrievable filter"), MISSING that this recurrence was *off* anticoagulation
during a hold. This is the trap. **Triggers the red flag of framing it as
anticoagulation failure. ~0.35 / 0.90 (39%).**

**Educated** reads the IR note + readmission notes, connects the recurrence to
the 3-day hold, notes he's now therapeutic with no contraindication → generally
no filter, resume anticoagulation, reconsider the biopsy strategy. **~0.82 /
0.90 (91%).**

*Discrimination: HIGH.* The whole question hinges on reading **why** the
recurrence happened — which is in the gated IR + readmission notes.

### Q6 — General IVC filter pros/cons (weight 0.5)

**Rubric-passing answer:** valid FOR (contraindication to anticoagulation;
recurrent VTE despite therapeutic anticoagulation) and AGAINST (don't treat
clot/replace anticoagulation; increase DVT; mechanical complications; retrieval
failure); a filter only prevents embolization, it doesn't treat thrombosis.

**Novice:** a competent general list (textbook knowledge). **~0.38 / 0.50
(76%).**
**Educated:** full + PREPIC/PREPIC2 (no mortality benefit) + retrievable-vs-
permanent. **~0.48 / 0.50 (96%).**

*Discrimination: low.*

---

## Result

| Question | Weight | Novice | Educated |
|---|---|---|---|
| Q1 Anticoagulate before biopsy | 0.9 | 0.60 (67%) | 0.85 (94%) |
| Q2 General biopsy-timing factors | 0.7 | 0.45 (64%) | 0.65 (93%) |
| Q3 DOAC hold duration | 0.7 | 0.45 (64%) | 0.65 (93%) |
| Q4 Bridging factors | 0.5 | 0.35 (70%) | 0.48 (96%) |
| Q5 IVC filter for this patient | 0.9 | 0.35 (39%) | 0.82 (91%) |
| Q6 General IVC pros/cons | 0.5 | 0.38 (76%) | 0.48 (96%) |
| **Total** | **4.2** | **2.58 (61%)** | **3.93 (94%)** |

**Pass = 70%.** Novice **fails at 61%**; educated **passes at 94%** — a
~33-point gap.

## Where the gap actually opens

- **Q5 is the single biggest discriminator** (0.35 vs 0.82 on a 0.9-weight
  item). The novice who pastes "recurrent PE — filter?" gets pulled into the
  "recurrent VTE → IVC filter" reflex and misses that the recurrence happened
  *during an anticoagulation hold*, which is documented in the gated IR and
  readmission notes. The educated resident reads **why** it recurred and
  reaches the opposite, correct conclusion.
- **Q1-Q3** discriminate moderately: the headline knowledge is something AI
  handles, but tying the timing to *this* patient (recent VTE recurrence window,
  high-bleed-risk biopsy, renal function) and reading the primary imaging is
  what earns full credit.
- **Q4 and Q6 barely discriminate** — "DOACs don't need bridging" and the
  general IVC pros/cons are textbook content AI produces well unprompted.

## Tuning notes

- If novices clear 70%, the highest-yield lever is Q5: weight the "recurrence
  occurred during a hold, not an anticoagulation failure" essential more
  heavily, or gate on it.
- If educated users can't clear ~85%, re-audit that the chart supports each
  essential — verified present during the build: the liver MRI (IMG004), the
  CTPA's incidental liver note (IMG001), normal renal function and weight >60 kg
  for DOAC dosing (labs/vitals), the IR pre-procedure note's 3-day hold
  (NOTE007, TP2), and the readmission CTA/TTE/labs showing the progression
  occurred off anticoagulation (IMG006/IMG007/LAB004, TP2).
