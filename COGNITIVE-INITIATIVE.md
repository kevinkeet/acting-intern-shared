# Cognitive Initiative: An Experiment in AI Clinical Support

## Overview

Acting Intern is an experiment in user interface design for AI-assisted clinical care. The central question is not *how smart should the AI be* — it is always smart. The question is: **who should be thinking right now?**

We call this axis **cognitive initiative** — the degree to which the AI independently synthesizes, surfaces, and pushes its clinical reasoning versus deferring to the physician. This document describes how the underlying AI system works and the three levels of cognitive initiative we are trialing.

---

## The Base System: How the AI Understands a Patient

Before any mode takes effect, the AI has already done substantial work.

### Chart Ingestion

The moment a patient chart opens, the system scrapes every data domain — vitals, labs, medications, imaging, clinical notes, allergies, problem list, encounters, social and family history — and structures it into a unified representation.

### The Longitudinal Clinical Document

From this raw data, the AI builds and maintains a **longitudinal clinical document** — its internal memory. This is a living document that synthesizes the chart into a layered clinical picture:

- **Patient Knowledge Base** — Demographics, chronic conditions with severity markers, medication regimens with dosing, social history, functional status. The stable foundation.
- **Active Clinical State** — Recent lab trends, current vital signs, pending workups, active complaints. What is happening now.
- **Clinical Narrative** — A running synthesis of the encounter that evolves as new information arrives. The story of this admission.

### Continuous Updates via Ambient Listening

The document updates continuously as the physician works — navigating the chart, reviewing results, placing orders. But the most important input channel is the physician's own voice.

The system is designed to pair with an always-on dictation source — an ambient scribe overhearing the doctor-patient conversation, or a personal mic capturing the doctor thinking out loud on the walk between rooms. The physician never has to stop and "brief" the AI. Instead, their natural clinical reasoning — muttered assessments, verbal orders to nurses, questions asked of the patient — flows continuously into the AI's understanding.

This matters because **the physician's own clinical reasoning is indexed most heavily.** What the doctor says about a case carries more weight than what the AI infers from data alone. The doctor's thinking becomes the spine of the AI's model. If the doctor says "I think this is a CHF exacerbation on top of baseline CKD," the AI restructures its understanding around that framing.

### Context-Aware Readiness

With this model assembled and continuously updated, the AI is ready to act across a range of tasks:

- **Context-aware ordering.** The doctor says "resume home metop" — and the AI knows the patient's home medication list includes metoprolol succinate 50mg daily, that it was held on admission for hypotension, that the blood pressure has stabilized, and places the correct order with the right dose, route, and frequency. Or "monitor and replete electrolytes" — the AI knows the potassium is 3.2 trending down on a loop diuretic, the magnesium is borderline, and generates a repletion protocol with appropriate monitoring intervals.

- **Safety surveillance.** Drug-drug interactions, allergy conflicts, critical lab values, contraindications given the clinical picture — surfaced immediately regardless of mode.

- **Situation reports.** The AI's internal model is rich enough to generate role-specific summaries: a clinical update for the nurse focused on active orders and monitoring parameters, a patient-facing explanation of what's happening in plain language, a case summary for the care manager focused on disposition and barriers to discharge.

- **Note generation.** A clinical note that reflects the actual encounter — incorporating the ambient conversation, the doctor's reasoning, the relevant data — rather than a generic template.

---

## Three Levels of Cognitive Initiative

All three modes share the same underlying intelligence and the same continuously-updated clinical model. What differs is the AI's **epistemic posture** — its willingness to independently synthesize and surface its thinking.

```
    FOLLOW               ABREAST               LEAD
    ─────────────────────────────────────────────────
    Doctor thinks         Shared thinking       AI thinks alongside
    AI executes           AI mirrors            AI challenges
    Reactive              Responsive            Anticipatory

    "I know, but          "I'll keep pace       "I have an opinion
     I wait."              with you."            and I'll push it."
```

### Follow — Cognitive Initiative: Doctor

The AI is a well-informed instrument. It has full situational awareness but does not surface any of it unprompted. It waits for an explicit task.

**What the doctor sees:** A single context line summarizing the patient ("73M, HFrEF/CKD3b/T2DM | SOB x1 week") and a chat interface. No problem list. No suggested actions. No clinical summary. The panel is quiet.

**What the AI does:**
- Executes tasks on request — place orders, look up results, draft a note.
- Interprets vague or shorthand orders using its full internal context. "Resume home metop" becomes the correct medication, dose, route, and frequency without the doctor specifying any of it. "Monitor and replete electrolytes" becomes a specific repletion protocol calibrated to the patient's current values and clinical picture.
- Answers questions concisely when asked directly.
- Does **not** independently synthesize, analyze, or opine.

**Core principle:** Having knowledge and volunteering it are different things. The intelligence is present but quiescent.

### Abreast — Cognitive Initiative: Shared

The AI is a copilot. It doesn't grab the controls, but it reads the instruments and speaks up when something matters. It synthesizes *in response to* the doctor's actions.

**What the doctor sees:** A structured clinical panel — a concise summary, a problem list with brief plans, categorized suggested actions, and a conversation thread.

**What the AI does:**
- Generates a clinical summary and problem list that **reflect the doctor's direction**, not the AI's independent opinion.
- Tracks what has been reviewed versus what remains open.
- Surfaces contextually relevant data as the doctor works through the chart.
- Updates its synthesis when the doctor dictates new thinking — reshaping its output around the doctor's evolving assessment.

**Core principle:** The AI's synthesis is a mirror, not a spotlight. It reflects the doctor's direction of travel.

### Lead — Cognitive Initiative: AI

The AI is a senior colleague with its own clinical opinion. It challenges the differential, critiques the plan, and points out what's been missed. It doesn't wait to be asked.

**What the doctor sees:** Everything in Abreast, plus comprehensive analysis — full differentials on every problem, detailed rationales on every action, and an active DDx challenge that pushes alternative diagnoses.

**What the AI does:**
- Forms and voices its own clinical assessment, clearly labeled ("My thinking: this presentation is more consistent with...").
- Actively challenges the differential diagnosis — surfaces what the doctor may not have considered.
- Flags divergence from guidelines or best practices.
- Produces comprehensive, detailed output. Nothing is abbreviated.

**Core principle:** The AI's cognition is additive, not duplicative. It says things the doctor hasn't said yet.

---

## The Experiment

This is fundamentally an experiment in **cognitive unloading** — how much of the physician's cognitive burden can be offloaded to an AI system, and at what level does that offloading become helpful versus intrusive?

The hypothesis is that there is no single right answer. A physician's cognitive needs shift throughout a shift, across patients, and even within a single encounter. Early in a complex admission with high diagnostic uncertainty, having a second brain actively working the differential may be invaluable. Once the assessment crystallizes, a quiet mirror that keeps things organized is enough. During routine order entry, the AI should be invisible except when it can save keystrokes.

The ability to move fluidly between these stances — with a single click or voice command — means the AI adapts to the physician's cognitive state, not the other way around.

The question is never "how smart should the AI be?" It's always smart. The question is: **who should be thinking right now?**
