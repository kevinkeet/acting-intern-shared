# PAT006 — Dorothy Pierce — Assessment Walkthrough

> **Purpose.** Shows what the resident sees, the four questions across two
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

Dorothy Pierce, 72, with poorly-controlled hypertension, type 2 diabetes, and
GERD, is admitted with **perforated cholecystitis and peritonitis** and taken
for an **urgent open cholecystectomy**. On **POD#1** telemetry catches **three
brief (15–20 second) asymptomatic, self-terminating runs of atrial
fibrillation**; her preop and current ECGs are both sinus, she has **no prior
echocardiogram**, and she is on **no anticoagulation or antiplatelet**. There
are no episodes on POD#2–3. On **POD#4** — the day before anticipated
discharge — she has a single **2-hour asymptomatic AF episode** (rate 70–105,
BP unaffected) that **spontaneously converts**. The case is not about a hidden
diagnosis; it is about managing new perioperative/subclinical AF: separating
transient post-op AF from incident paroxysmal AF, risk-stratifying for stroke
and bleeding in a borderline patient who just had surgery, choosing an
anticoagulant, and designing a monitoring strategy that matches an infrequent,
asymptomatic arrhythmia.

## At-a-glance

| | |
|---|---|
| Timepoints | 2 (TP1 = POD#1, 2027-06-11; TP2 = POD#4, 2027-06-14) |
| Questions | 4 (Q1 at TP1; Q2/Q3/Q4 at TP2) |
| Total weight | 3.6 |
| Time budget | ~20 min |
| Pass | 70% (= 2.52 / 3.6) |
| Source | Management Case Bank, Case 4 (discussants Villano, Matos, Katz, Jagadish; finalized by Eric Strong) |
| CHA2DS2-VASc | 4 (age 65–74 = 1, female = 1, hypertension = 1, diabetes = 1) |

## The two personas

**Novice (AI-naïve):** pastes the question verbatim, takes the first answer,
never opens the telemetry **event** notes or the ECGs, never assembles her
comorbidities to compute a score, copies the generic AI output nearly verbatim.

**Educated (AI-literate):** reads the primary sources (the telemetry event
notes and the POD#4 ECG that characterize the actual episodes), assembles her
risk factors from the scattered chart, prompts with her specifics, iterates,
and synthesizes in their own words.

## Where the answer-relevant facts are deliberately scattered

- **Episode characteristics** (how many, how long, symptomatic?, rate,
  spontaneous conversion) live in the **telemetry EVENT notes** (NOTE004 POD#1,
  NOTE008 POD#4) and the **POD#4 ECG** (IMG004) — *not* in the daily progress
  notes, which only summarize broadly ("some atrial fibrillation overnight").
- **CHA2DS2-VASc inputs** are spread across demographics (age, sex), the
  problem list + PCP notes + vitals (poorly-controlled HTN), and the
  problem list + A1c (diabetes).
- **No prior echo** is stated in the 2026 cardiology consult note and the
  problem list. **No thyroid studies** is visible only by noticing TSH is
  absent from every lab panel.
- **Renal function** for DOAC dosing is in the labs (eGFR ~68). **Recent major
  surgery** (bleeding-risk timing) is in the op note + procedures.
- **No home anticoagulant/antiplatelet** is confirmed in the med-rec note.
- **Patient values** (driving autonomy; father's AFib + fatal stroke) are in
  social history and family history.

---

## TP1 — POD#1

### Q1 — Additional monitoring/testing/treatment (weight 0.8)

> "In addition to continuing telemetry monitoring, would you recommend any
> additional monitoring, testing, or treatment at this time? If so, what?"

**Rubric-passing answer** continues telemetry and looks for reversible/secondary
triggers (electrolytes incl. K/Mg, volume, pain, hypoxia, anemia, ongoing
post-op inflammation), checks **TSH** (none on file), obtains a **TTE** (no
prior echo), and — crucially — does **not** start anticoagulation or
rate/rhythm control for brief, self-terminating, asymptomatic runs on POD#1.

**Novice** pastes the question → the generic "new AF workup" answer is actually
solid here (AI does textbook workup well): electrolytes, TSH, echo, treat
reversible causes, continue telemetry. But it tends to hedge toward "calculate
CHA2DS2-VASc and consider anticoagulation," doesn't clearly **defer**
anticoagulation, and never quantifies the real burden (never opened the event
note). **~4/5 essentials, no bonuses. ~0.55 / 0.80 (69%).**

**Educated** reads the telemetry event note (3 runs, 15–20s, asymptomatic),
confirms normal electrolytes/Mg and absent TSH in the labs, notes no prior
echo, and prompts for what's appropriate at POD#1 for brief self-terminating
runs in a post-op patient → all essentials including the judgment to defer
anticoagulation, plus bonuses (quantifies burden, frames transient-vs-incident,
Mg optimization). **~0.75 / 0.80 (94%).**

*Discrimination: low–moderate.* The new-AF workup is something AI does well
unprompted; the discriminator is the **judgment not to over-treat** and reading
the actual burden.

---

## TP2 — POD#4

### Q2 — Anticoagulation decision + factors (weight 1.2) — the discriminator

> "Would you recommend therapeutic anticoagulation? What factors would
> influence your decision?"

**Rubric-passing answer** computes **CHA2DS2-VASc = 4** for *this* patient
(favoring anticoagulation), weighs **bleeding risk including the recent major
surgery**, engages the **transient post-op vs incident paroxysmal AF** nuance,
brings the patient into a **shared decision** (driving autonomy, father's fatal
stroke, low fall risk), and reaches a **clear, defensible recommendation**.

**Novice** pastes the question → gets a generic AF-anticoagulation lecture
("calculate CHA2DS2-VASc; anticoagulate if elevated; weigh HAS-BLED"). Because
only the question was pasted, the AI never pins her score to **4**, misses the
post-op transient-vs-incident nuance and the recent-surgery bleeding-timing
issue, and underweights shared decision-making. **~2.5/5 essentials.
~0.60 / 1.20 (50%).**

**Educated** supplies her comorbidities (AI confirms CHA2DS2-VASc = 4), asks
specifically about post-op/transient AF vs incident AF and bleeding-risk timing
after a recent open operation, and folds in her driving autonomy + father's
stroke + low fall risk to reach a clear shared recommendation. **5/5 +
bonuses. ~1.05 / 1.20 (88%).**

*Discrimination: high.* The score computation, the post-op nuance, and the
patient-values piece all require patient-specific prompting and chart
assembly.

### Q3 — Best anticoagulant choice (weight 0.8)

> "If the decision was made to start therapeutic anticoagulation on hospital
> day #4, what would be the best choice of anticoagulant, and why?"

**Rubric-passing answer** chooses a **DOAC over warfarin**, names a specific
agent (e.g., **apixaban**) at **standard dose** justified by her renal function
(eGFR ~68), weight (>60 kg), and age (<80), and addresses **timing relative to
recent surgery** (coordinate with surgery / contingent on hemostasis).

**Novice** pastes the question → nails the textbook headline ("DOAC preferred,
e.g., apixaban") but doesn't pin the standard dose to her renal function
(didn't pull labs) and misses the post-op timing point (didn't know she's
POD#4). **~2.5/4. ~0.50 / 0.80 (63%).**

**Educated** provides eGFR/weight/age and the recent-surgery context → DOAC +
apixaban standard-dose justified + renal dosing + surgical timing, plus bonuses
(no valvular disease, GI protection already on omeprazole, cost/adherence).
**4/4. ~0.75 / 0.80 (94%).**

*Discrimination: moderate.* AI gets the DOAC-vs-warfarin headline easily; the
discriminators are renal-dosing specifics and post-op timing.

### Q4 — Ambulatory ECG monitor (weight 0.8)

> "Would you discharge her with an ambulatory ECG monitor? What type? What
> factors should be considered? What would you do with the information?"

**Rubric-passing answer** says **yes** to extended monitoring, chooses a
**longer-duration monitor** (14–30 day patch / MCT / loop recorder) because her
episodes are **infrequent** — explicitly rejecting a 24–48h Holter as likely to
miss them — recognizes that because her episodes are **asymptomatic** a
symptom-/patient-triggered recorder is the wrong tool, considers patient/cost
factors, and ties the data to the **anticoagulation decision** with
**closed-loop** outpatient follow-up.

**Novice** pastes the question → generic answer lists every monitor type
without committing, may suggest a Holter or symptom event recorder, and doesn't
internalize that her episodes are asymptomatic and infrequent (never read the
event notes). "Follow up with cardiology" without a closed loop. **~2/4.
~0.40 / 0.80 (50%).**

**Educated** knows the episodes are asymptomatic and infrequent, so commits to
an extended auto-detecting monitor, explicitly rejects the Holter and the
symptom-triggered recorder, gives the choice factors, and ties the AF burden to
the long-term anticoagulation decision with a named follow-up loop. **4/4 +
bonuses. ~0.75 / 0.80 (94%).**

*Discrimination: high.* Matching the monitor to "asymptomatic + infrequent"
requires having read the actual episode characteristics.

---

## Result

| Question | Weight | Novice | Educated |
|---|---|---|---|
| Q1 POD#1 monitoring/testing | 0.8 | 0.55 (69%) | 0.75 (94%) |
| Q2 Anticoagulation decision | 1.2 | 0.60 (50%) | 1.05 (88%) |
| Q3 Anticoagulant choice | 0.8 | 0.50 (63%) | 0.75 (94%) |
| Q4 Ambulatory monitor | 0.8 | 0.40 (50%) | 0.75 (94%) |
| **Total** | **3.6** | **2.05 (57%)** | **3.30 (92%)** |

**Pass = 70%.** Novice **fails at 57%**; educated **passes at 92%** — a
~35-point gap.

## Where the gap actually opens

- **Two behaviors drive most of it:**
  1. *Reading the primary source.* The educated resident opens the **telemetry
     event notes and the POD#4 ECG** to characterize the actual episodes
     (number, duration, asymptomatic, rate, spontaneous conversion) instead of
     trusting the daily progress note's vague summary. This directly powers Q4
     (monitor type) and Q1 (burden).
  2. *Prompting with the patient's specifics* — assembling her CHA2DS2-VASc
     inputs, renal function, recent surgery, and values — rather than pasting
     the bare question (Q2, Q3).
- **Q2 (1.2 of 3.6 weight)** is where the case lives: it is the
  risk/benefit + post-op-nuance + shared-decision question, and generic
  prompting produces a generic, non-passing answer. This mirrors PAT002 and
  PAT003, where the judgment/social questions were the biggest discriminators.
- **Q1 barely discriminates** — appropriate, because a broad "new AF workup" is
  the one thing AI does well unprompted. The only Q1 trap is over-treating
  (anticoagulating or rate-controlling brief self-terminating runs on POD#1).

## Tuning notes

- If novices routinely clear 70%, the highest-yield change is to weight the
  post-op-nuance and patient-values essentials in Q2 more heavily, or to gate
  Q4 on the "asymptomatic ⇒ not a symptom-triggered recorder" and "infrequent
  ⇒ not a 24–48h Holter" essentials.
- If educated users can't clear ~85%, re-audit whether the chart actually
  supports each essential — verified present during the build across: telemetry
  event notes NOTE004/NOTE008, ECG IMG004, labs (electrolytes/Mg normal, no
  TSH, eGFR ~68, normal coags), the 2026 cardiology consult (no echo),
  op note + procedures (recent surgery), med-rec NOTE010 (no anticoagulant),
  and social/family history (driving autonomy; father's AFib + fatal stroke).
