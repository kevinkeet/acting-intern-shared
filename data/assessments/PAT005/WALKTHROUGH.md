# PAT005 — Sarah Whitlock — Assessment Walkthrough

> **Purpose.** Shows what the resident sees, the five questions across three
> timepoints, what a rubric-passing answer looks like, and how a *novice*
> (AI-naïve) vs an *educated* (AI-literate) resident perform on the same case
> with the same clinical knowledge but opposite AI habits.
>
> **Caveat on the simulation.** I did not drive the live Haiku chatbot (its API
> key is encrypted under the site access password). These are high-fidelity
> simulated runs against the actual chart and the real ap1/ap2/ap3 rubrics.
> Scores are best-faith estimates against the documented essential / bonus /
> red-flag lists.

---

## The case in one paragraph

Sarah Whitlock, 50, has decompensated alcohol-related cirrhosis (hepatic
encephalopathy, diuretic-refractory ascites, right hepatic hydrothorax) and is
sober ~14 months, in transplant evaluation. Diuretics can't be up-titrated
(they cause AKI, hyperkalemia, hyponatremia), so she's referred for therapeutic
**paracentesis + thoracentesis** with an INR of 2.0 and platelets of 55 K. The
academic center drains her **without** prophylactic blood products. Because she
lives 90 minutes away, weekly drainage is handed to a **community radiologist
who gives 4 units of FFP every session "for the INR"** — a non-evidence-based
practice. After several weeks she develops **flash pulmonary edema** (transfusion-
associated circulatory overload), is intubated, and recovers. The team asks the
radiologist to stop the FFP; PleurX vs TIPS is weighed; she's transplanted and
her drainage needs vanish. The case tests recognizing and resisting an
authoritative-but-wrong practice, evidence-based cross-system communication, and
bridging decisions in a transplant candidate.

## At-a-glance

| | |
|---|---|
| Timepoints | 3 (TP1 ED 2027-03-10; TP2 ICU 2027-04-30; TP3 post-transplant 2027-09-15) |
| Questions | 5 (Q1/Q2 at TP1; Q3/Q4 at TP2; Q5 at TP3) |
| Total weight | 3.8 |
| Time budget | ~28 min |
| Pass | 70% (= 2.66 / 3.8) |
| Source | Management Case Bank, Case 3 (finalized by Adam Rodman) |

## The built-in "red herring" (authentic to the source)

This case has a real, chart-documented non-evidence-based practice the resident
must resist rather than propagate: an elevated INR (2.0) in cirrhosis is being
"corrected" with prophylactic FFP before low-risk drainage. The FFP is **buried
in the community radiology procedure notes and the Procedures tab** (gated to
TP2) — not in the hepatology notes. An AI-literate resident verifies the
bleeding-risk question against current cirrhosis evidence (rebalanced hemostasis;
guidelines against prophylactic transfusion) and connects the flash pulmonary
edema to the repeated FFP; a naïve resident anchors on "high INR → give FFP."

## The two personas

**Novice (AI-naïve):** pastes the question verbatim, takes the first answer,
doesn't open the community-radiology procedure notes, doesn't tailor to her
specifics, copies the output.

**Educated (AI-literate):** reads the primary sources (the procedure notes that
reveal the weekly FFP; the ICU note), prompts with her specifics, verifies the
FFP/INR question against current evidence rather than the chart's practice,
iterates, synthesizes.

---

## TP1 — ED presentation

### Q1 — Perform paracentesis + thoracentesis? (weight 0.7)

**Rubric-passing answer:** yes — both are indicated and are low-bleeding-risk;
the INR 2.0 / platelets 55 K of cirrhosis don't contraindicate them; give
albumin for the large-volume paracentesis; send fluid to rule out SBP.

**Novice:** the generic "should I drain decompensated cirrhosis" answer is
decent (yes, low-risk) but may waffle about "correcting" the INR and omits
albumin/SBP studies. **~3/4. ~0.50 / 0.70 (71%).**

**Educated:** reads the diuretic-intolerance note, prompts with specifics → yes
+ low-risk + albumin + SBP studies + the rebalanced-hemostasis point. **~0.65 /
0.70 (93%).**

*Discrimination: low–moderate.*

### Q2 — Blood products before/after? (weight 1.1) — the discriminator

**Rubric-passing answer:** NO prophylactic FFP or platelets — the INR doesn't
predict bleeding in cirrhosis, FFP doesn't durably correct it, and it carries
real volume-overload (TACO)/TRALI harm; platelets 55 K need no transfusion;
albumin (not FFP) is the right peri-procedural product.

**Novice:** the trap. Anchoring on "high INR → correct it before a procedure"
(or a poorly-framed prompt like "how do I correct the INR before paracentesis?")
leads to giving or endorsing prophylactic FFP — a **red flag** — or a hedged
answer. **~2/4 essentials + a red flag. ~0.45 / 1.10 (41%).**

**Educated:** prompts specifically about cirrhosis hemostasis, verifies the
rebalanced-hemostasis evidence, firmly declines FFP, names TACO/TRALI, albumin
over FFP, cites guidelines. **~1.00 / 1.10 (91%).**

*Discrimination: high — this is the core teaching point.*

---

## TP2 — ICU for FFP-related flash pulmonary edema

### Q3 — Approach the call asking the radiologist to stop FFP (weight 0.7)

**Rubric-passing answer:** collegial/non-judgmental; share the specific harm
(ICU/volume overload) and the evidence; propose a concrete alternative
(continue drainage **without** prophylactic FFP, albumin is fine); explicitly
**preserve her local access** (90 minutes away — don't end the arrangement).

**Novice:** generic "be collegial, share evidence" framework, but misses the
access-preservation stakes and the concrete no-FFP alternative. **~2.5/4. ~0.40
/ 0.70 (57%).**

**Educated:** folds in her rural dependence, gives the concrete alternative
protocol, offers to share guidelines / be a resource, and uses the AI to draft
a respectful evidence-cited message. **~0.65 / 0.70 (93%).**

*Discrimination: moderate–high.*

### Q4 — PleurX vs TIPS (weight 0.9)

**Rubric-passing answer:** TIPS can control the fluid and bridge to transplant
but risks worsening her **recurrent hepatic encephalopathy**; PleurX avoids
repeat procedures/transfusions but risks **infection** (heightened by coming
immunosuppression) and protein loss; tailor to her (HE, transplant candidacy,
rural access) and frame transplant as the definitive fix.

**Novice:** textbook pros/cons not applied to her — misses the HE→TIPS caution
as it applies to *her* and the transplant-bridge framing. **~2.5/4. ~0.50 /
0.90 (56%).**

**Educated:** tailors to her HE/transplant/rural specifics; frames as a bridge.
**~0.80 / 0.90 (89%).**

*Discrimination: high.*

---

## TP3 — Post-transplant

### Q5 — Why did her drainage needs drop? (weight 0.4)

**Rubric-passing answer:** the transplant resolved the portal hypertension (and
restored albumin synthesis) driving the ascites/hydrothorax, so fluid stopped
re-accumulating.

**Novice:** generic pathophysiology AI does well; gets the main reason. **~0.30
/ 0.40 (75%).**

**Educated:** + synthetic-function/albumin and corroborating labs. **~0.40 /
0.40 (100%).**

*Discrimination: low.*

---

## Result

| Question | Weight | Novice | Educated |
|---|---|---|---|
| Q1 Perform para+thora | 0.7 | 0.50 (71%) | 0.65 (93%) |
| Q2 Blood products / prophylactic FFP | 1.1 | 0.45 (41%) | 1.00 (91%) |
| Q3 Call radiologist re FFP | 0.7 | 0.40 (57%) | 0.65 (93%) |
| Q4 PleurX vs TIPS | 0.9 | 0.50 (56%) | 0.80 (89%) |
| Q5 Post-transplant para needs | 0.4 | 0.30 (75%) | 0.40 (100%) |
| **Total** | **3.8** | **2.15 (57%)** | **3.50 (92%)** |

**Pass = 70%.** Novice **fails at 57%**; educated **passes at 92%** — a
~35-point gap.

## Where the gap opens

- **Q2 (1.1 of 3.8) is the case.** It's a verification/calibration question:
  the chart and reflex both push toward "correct the INR with FFP," and the
  skilled behavior is checking that against current cirrhosis evidence and
  declining. This is precisely the AI-use skill an educational intervention can
  move — the endpoint should be sensitive to it.
- **Two behaviors drive most of the spread:** (1) verifying a confident,
  authoritative-but-wrong practice against the evidence (Q2, Q3); (2) tailoring
  to her specifics — HE, transplant candidacy, rural access (Q3, Q4) — rather
  than reciting generic comparisons.
- **Q1 and Q5 barely discriminate** — appropriately, since "drain low-risk
  effusions" and "transplant cures portal hypertension" are things AI answers
  well unprompted.

## Tuning notes

- If novices clear 70%, weight Q2 (and its red flag for giving prophylactic FFP)
  more heavily, and/or gate Q3 on the access-preservation essential.
- If educated users can't clear ~85%, re-audit chart support — verified present:
  INR/platelets in LAB001; the academic no-FFP procedure note (NOTE002); the
  community-radiology weekly FFP procedure notes + Procedures tab (NOTE003,
  PROC004-008, TP2); the ICU note attributing the edema to FFP (NOTE005); the
  IR consult weighing PleurX/TIPS (NOTE006); recurrent HE in the problem list;
  and the post-transplant resolution (NOTE009, LAB003, IMG005).
