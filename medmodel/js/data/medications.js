/**
 * MedModel — medication evidence library.
 *
 * Each entry carries: the trial-level effect (ITT hazard/risk ratio and the
 * population it came from), a way to individualize baseline risk, a
 * time-to-benefit ramp, harms as absolute excess rates with patient-factor
 * scaling, burden facets, representativeness rules, and citations.
 *
 * Numeric values were verified against primary sources where possible
 * (see methods.html for the full evidence trail). Values that are
 * curated estimates rather than directly published are marked "est." in
 * their note/source strings. Educational tool — not medical advice.
 *
 * The schema is deliberately generic so datasets from other sources
 * (e.g., meds.kevinkeet.com) can be merged: push entries onto
 * MedLibrary.meds or call MedLibrary.merge(list).
 */
(function (root, factory) {
    if (typeof module === 'object' && module.exports) {
        module.exports = factory();
    } else {
        root.MedLibrary = factory();
    }
})(typeof self !== 'undefined' ? self : this, function () {
    'use strict';

    var ADHERENCE_LEVELS = [
        { id: 'high',    label: 'Excellent (~90% of days)', value: 0.90,
          desc: 'Organized, tolerates medicines, few barriers — like a trial volunteer.' },
        { id: 'typical', label: 'Typical real-world (~65%)', value: 0.65,
          desc: 'Most patients: refill gaps, occasional missed doses. Real-world adherence to chronic meds averages ~50–70% (Osterberg NEJM 2005); ~half of new statin users stop within a year (Jackevicius JAMA 2002).' },
        { id: 'low',     label: 'Struggles (~40%)', value: 0.40,
          desc: 'Cost, side effects, complex regimen, many medicines, or ambivalence.' }
    ];

    var MEDS = [

    // =====================================================================
    {
        id: 'statin-primary',
        name: 'Statin — primary prevention',
        example: 'atorvastatin 20–40 mg nightly',
        drugClass: 'HMG-CoA reductase inhibitor',
        indication: 'Primary prevention of atherosclerotic cardiovascular disease',
        tagline: 'No prior heart attack or stroke; risk estimated from your own risk-factor profile.',
        baseline: { type: 'pce' },
        outcome: { label: 'Major vascular event (MI, stroke, or cardiovascular death)', shortLabel: 'major vascular events', includesDeath: true },
        effect: {
            hr: 0.70, ci: [0.64, 0.76],
            source: 'CTT Lancet 2010: RR 0.78 (0.76–0.80) per 1.0 mmol/L LDL lowering; moderate–high-intensity statin lowers LDL ~1.4–1.8 mmol/L → RR ≈ 0.78^1.45 ≈ 0.70',
            note: 'Relative effect is stable across baseline-risk strata (CTT Lancet 2012 low-risk analysis) — the key fact that lets us apply it to your risk.'
        },
        ttb: { rampYears: 2.0, displayYears: 2.5,
               display: '≈ 2.5 years to prevent the first 1 event per 100 treated',
               source: 'Yourman et al., JAMA Intern Med 2021 (meta-analysis of 8 primary-prevention trials)' },
        trial: {
            name: 'CTT meta-analyses (26 trials, n≈170,000)',
            meanAge: 63, maxAge: 82, pctFemale: 27, medianFollowupYears: 5,
            adherence: 0.87, adherenceNote: 'HPS-style in-trial compliance ~85–90%',
            annualControlRate: 0.013,
            controlRateSource: 'primary-prevention control arms ~1–1.4%/y (JUPITER placebo 1.36/100 py; HOPE-3 ~1%/y)',
            sex: 'mixed',
            keyExclusions: ['Advanced frailty / limited life expectancy', 'Significant comorbid illness in most trials', 'Age >82 (oldest enrolled)']
        },
        subgroups: [
            { label: 'Age >75, primary prevention', text: 'CTT 2019 (Lancet 393:407): relative effect similar across age bands overall, but the primary-prevention subset over 75 had few events — direct evidence is sparse and CIs are wide. Numbers here are extrapolations; STAREE-type trials are addressing the gap.' }
        ],
        repRules: [
            { when: { minAge: 76 }, level: 'extrapolated', text: 'Only ~8% of CTT participants were >75, and primary-prevention evidence in that group is inconclusive.' },
            { when: { healthAtLeast: 'poor' }, level: 'extrapolated', text: 'Frail adults and those with limited life expectancy were effectively excluded from statin trials.' }
        ],
        harms: [
            { id: 'nod', label: 'New-onset diabetes', severity: 'moderate',
              excessAnnualRate: 0.001,
              scaling: [{ when: { condition: 'prediabetes' }, mult: 2.0, why: 'risk concentrated in those near the diabetic threshold' }],
              source: 'Sattar Lancet 2010: ~1 extra case per 255 treated over 4 y; dose-dependent (Preiss JAMA 2011)' },
            { id: 'myopathy', label: 'Serious muscle injury (myopathy/rhabdomyolysis)', severity: 'serious',
              excessAnnualRate: 0.000044,
              source: 'Graham JAMA 2004: rhabdomyolysis ~4.4 per 100,000 person-years on statin monotherapy (higher with fibrate combinations)' },
            { id: 'sams', label: 'Muscle symptoms leading to bother/stopping', severity: 'nuisance',
              excessAnnualRate: 0.005,
              source: 'Blinded trials (SAMSON NEJM 2020: nocebo ratio 0.90; StatinWISE BMJ 2021) show ~90% of reported statin muscle symptoms occur equally on placebo — true pharmacologic excess is small (est. ~0.5%/y)' }
        ],
        burden: {
            dosesPerDay: 1, route: 'oral', labsPerYear: 1, extraVisitsPerYear: 0,
            constraints: [], costTier: 1, interactions: 'moderate',
            notes: ['Generic, pennies a day', 'Lipid panel ± rare CK/LFTs', 'Some statins interact via CYP3A4 (simvastatin > atorvastatin > rosuvastatin)']
        },
        citations: [
            { label: 'CTT Collaboration, Lancet 2010;376:1670 (per-mmol effect)' },
            { label: 'CTT Collaboration, Lancet 2012;380:581 (effect stable at low risk)' },
            { label: 'CTT Collaboration, Lancet 2019;393:407 (age subgroups)' },
            { label: 'Yourman et al., JAMA Intern Med 2021 (time to benefit 2.5 y)' },
            { label: 'Sattar et al., Lancet 2010 (new-onset diabetes)' },
            { label: 'Wood et al., NEJM 2020 (SAMSON — nocebo)' }
        ]
    },

    // =====================================================================
    {
        id: 'statin-secondary',
        name: 'Statin — secondary prevention',
        example: 'atorvastatin 80 mg nightly',
        drugClass: 'HMG-CoA reductase inhibitor',
        indication: 'After MI, stroke, or known ASCVD',
        tagline: 'The strongest statin case: high baseline risk makes absolute benefit large.',
        baseline: {
            type: 'anchored',
            label: 'Risk of major coronary/vascular events',
            trialControlRate: { risk: 0.28, years: 5.4 },
            rateSource: '4S placebo arm: 28% major coronary events over 5.4 y (~5%/y)',
            options: [
                { id: 'low',     label: 'Well-controlled, revascularized, years since event', mult: 0.6 },
                { id: 'typical', label: 'Typical established ASCVD', mult: 1.0 },
                { id: 'high',    label: 'Recent ACS, polyvascular disease, or diabetes', mult: 1.5 }
            ]
        },
        outcome: { label: 'Major coronary event (MI or coronary death)', shortLabel: 'major coronary events', includesDeath: true },
        effect: {
            hr: 0.66, ci: [0.59, 0.75],
            source: '4S Lancet 1994: major coronary events RR 0.66; all-cause mortality RR 0.70 (11.5%→8.2% over 5.4 y)',
            note: 'Modern populations on aspirin/ACEi have lower baseline risk than 4S — pick the risk level accordingly.'
        },
        ttb: { rampYears: 1.5, displayYears: 1.5,
               display: 'Survival curves separate within ~1–2 years',
               source: '4S Kaplan-Meier; CTT' },
        trial: {
            name: '4S (n=4,444) + CTT secondary-prevention subset',
            meanAge: 59, maxAge: 70, pctFemale: 19, medianFollowupYears: 5.4,
            adherence: 0.87, adherenceNote: 'in-trial compliance ~85–90%',
            annualControlRate: 0.052, sex: 'mixed',
            keyExclusions: ['Age >70 in 4S (later trials to ~82)', 'HF, significant comorbidity']
        },
        subgroups: [
            { label: 'Age >75', text: 'CTT 2019: relative benefit persists in older secondary-prevention patients (clearest elderly statin evidence).' }
        ],
        repRules: [
            { when: { minAge: 83 }, level: 'extrapolated', text: 'Beyond the oldest ages enrolled in the statin trials.' },
            { when: { healthAtLeast: 'poor' }, level: 'extrapolated', text: 'In advanced frailty/limited life expectancy, guidelines support individualizing; stopping statins near end of life did not worsen outcomes (Kutner JAMA IM 2015).' }
        ],
        harms: [
            { id: 'nod', label: 'New-onset diabetes', severity: 'moderate',
              excessAnnualRate: 0.0012,
              scaling: [{ when: { condition: 'prediabetes' }, mult: 2.0, why: 'risk concentrated near the diabetic threshold' }],
              source: 'Sattar Lancet 2010; slightly higher with intensive dosing (Preiss JAMA 2011)' },
            { id: 'myopathy', label: 'Serious muscle injury (myopathy/rhabdomyolysis)', severity: 'serious',
              excessAnnualRate: 0.000044, source: 'Graham JAMA 2004: ~4.4 per 100,000 person-years' },
            { id: 'sams', label: 'Muscle symptoms leading to bother/stopping', severity: 'nuisance',
              excessAnnualRate: 0.005, source: 'SAMSON NEJM 2020 — mostly nocebo; small true excess (est.)' }
        ],
        burden: {
            dosesPerDay: 1, route: 'oral', labsPerYear: 1, extraVisitsPerYear: 0,
            constraints: [], costTier: 1, interactions: 'moderate',
            notes: ['Generic', 'Minimal monitoring']
        },
        citations: [
            { label: '4S, Lancet 1994;344:1383' },
            { label: 'CTT Collaboration, Lancet 2010 & 2019' },
            { label: 'Kutner et al., JAMA Intern Med 2015 (stopping statins in advanced illness)' }
        ]
    },

    // =====================================================================
    {
        id: 'bp-standard',
        name: 'Blood-pressure treatment (standard)',
        example: 'amlodipine 5–10 mg or lisinopril 20 mg daily',
        drugClass: 'Antihypertensive (class effect)',
        indication: 'Hypertension — lowering SBP by ~10 mmHg',
        tagline: 'Benefit scales with how high the pressure and the underlying risk are.',
        baseline: {
            type: 'anchored',
            label: 'Cardiovascular event risk',
            trialControlRate: { risk: 0.02, years: 1 },
            rateSource: 'BPLTTC trial populations: ~2 major CV events per 100 person-years (control arms)',
            options: [
                { id: 'low',     label: 'Younger, SBP 140s, no diabetes/CKD, no prior CVD', mult: 0.5 },
                { id: 'typical', label: 'Typical hypertension clinic patient', mult: 1.0 },
                { id: 'high',    label: 'Older, SBP ≥160, diabetes/CKD, or prior CVD', mult: 1.7 }
            ]
        },
        outcome: { label: 'Major cardiovascular event (MI, stroke, HF, CV death)', shortLabel: 'major CV events', includesDeath: true },
        effect: {
            hr: 0.80, ci: [0.77, 0.83],
            source: 'Ettehad et al., Lancet 2016: RR 0.80 per 10 mmHg SBP reduction — consistent across baseline BP and comorbidity (also BPLTTC Lancet 2021: RR 0.90 per 5 mmHg)',
            note: 'Stroke falls more (RR 0.73), heart failure most (RR 0.72). Assumes ~10 mmHg achieved reduction; scale expectations if less.'
        },
        ttb: { rampYears: 1.5, displayYears: 1.7,
               display: 'In adults ≥65: ~0.9 y for a 1-in-500 stroke benefit, ~1.7 y for 1-in-200, ~3 y for 1-in-100',
               source: 'Ho et al., J Am Geriatr Soc 2022 (TTB meta-analysis, 9 RCTs); HYVET NEJM 2008' },
        trial: {
            name: 'BPLTTC / Ettehad meta-analyses (~600,000 participants)',
            meanAge: 65, maxAge: 105, pctFemale: 42, medianFollowupYears: 4,
            adherence: 0.85, adherenceNote: 'est. typical in-trial adherence',
            annualControlRate: 0.02, sex: 'mixed',
            keyExclusions: ['Orthostatic hypotension, advanced frailty in most trials', 'Nursing-home residents rarely enrolled']
        },
        subgroups: [
            { label: 'Age ≥80', text: 'HYVET (NEJM 2008, ≥80 y): mortality HR 0.79, stroke HR 0.70, HF HR 0.36 — but enrolled unusually healthy 80-year-olds.' }
        ],
        repRules: [
            { when: { healthAtLeast: 'fair' }, level: 'extrapolated', text: 'Trials enrolled robust elders; in frail adults with falls/orthostasis, observational data suggest more harm (Tinetti JAMA IM 2014).' }
        ],
        harms: [
            { id: 'falls', label: 'Serious fall injury or syncope', severity: 'serious',
              excessAnnualRate: 0.002,
              scaling: [
                  { when: { minAge: 80 }, mult: 2.0, why: 'fall risk rises steeply with age' },
                  { when: { healthAtLeast: 'fair' }, mult: 2.0, why: 'frailty multiplies fall/syncope risk (Tinetti JAMA IM 2014)' }
              ],
              source: 'SPRINT syncope excess ~0.2%/y; serious fall injuries in frail elders on antihypertensives (Tinetti JAMA IM 2014) — est. excess' },
            { id: 'aki', label: 'Acute kidney injury / electrolyte problems', severity: 'moderate',
              excessAnnualRate: 0.0025,
              scaling: [{ when: { condition: 'ckd45' }, mult: 2.0, why: 'reduced renal reserve' }],
              source: 'SPRINT AKI 4.1% vs 2.5% over 3.3 y (intensive); standard-target excess est. lower' },
            { id: 'ankle', label: 'Edema, dizziness, or cough (agent-dependent)', severity: 'nuisance',
              excessAnnualRate: 0.04, source: 'amlodipine edema ~5–10%; ACEi cough ~5–10% (est. annualized)' }
        ],
        burden: {
            dosesPerDay: 1, route: 'oral', labsPerYear: 1, extraVisitsPerYear: 1,
            constraints: ['Home BP checks helpful'], costTier: 1, interactions: 'low',
            notes: ['Generic', 'BMP for ACEi/ARB/diuretic', 'Titration visits early on']
        },
        citations: [
            { label: 'Ettehad et al., Lancet 2016;387:957' },
            { label: 'BPLTTC (Rahimi et al.), Lancet 2021;397:1625' },
            { label: 'HYVET, NEJM 2008;358:1887' },
            { label: 'Tinetti et al., JAMA Intern Med 2014 (serious fall injuries)' }
        ]
    },

    // =====================================================================
    {
        id: 'bp-intensive',
        name: 'Intensive BP target (<120 vs <140)',
        example: 'adding a 2nd–3rd agent to reach SBP <120',
        drugClass: 'Antihypertensive intensification',
        indication: 'High-CV-risk hypertension without diabetes or prior stroke (SPRINT population)',
        tagline: 'A sharp test of representativeness: SPRINT excluded diabetes, stroke, HF, frailty, and nursing-home residents.',
        baseline: {
            type: 'anchored',
            label: 'CV event risk (SPRINT-like)',
            trialControlRate: { risk: 0.0219, years: 1 },
            rateSource: 'SPRINT standard-arm event rate 2.19%/y',
            options: [
                { id: 'low',     label: 'Lower-risk SPRINT-eligible', mult: 0.7 },
                { id: 'typical', label: 'Typical SPRINT participant', mult: 1.0 },
                { id: 'high',    label: 'Age ≥75 or CKD or prior CVD (SPRINT high-risk strata)', mult: 1.6 }
            ]
        },
        outcome: { label: 'MI, ACS, stroke, HF, or CV death', shortLabel: 'major CV events', includesDeath: true },
        effect: {
            hr: 0.75, ci: [0.64, 0.89],
            source: 'SPRINT NEJM 2015: primary outcome 1.65 vs 2.19%/y; all-cause mortality HR 0.73',
            note: 'Ambulatory, non-diabetic, high-risk adults able to stand without symptoms.'
        },
        ttb: { rampYears: 1.0, displayYears: 1.0,
               display: 'Curves separated by ~1 year; trial stopped at 3.3 y (elderly TTB meta: ~0.9–3 y)',
               source: 'SPRINT NEJM 2015; Ho et al., JAGS 2022' },
        trial: {
            name: 'SPRINT (n=9,361)',
            meanAge: 68, maxAge: 96, pctFemale: 36, medianFollowupYears: 3.26,
            adherence: 0.88, adherenceNote: 'est. in-trial adherence',
            annualControlRate: 0.0219, sex: 'mixed',
            keyExclusions: ['Diabetes', 'Prior stroke', 'Symptomatic HF / EF <35%', 'eGFR <20', 'Dementia', 'Nursing-home residence', 'Standing SBP <110', 'Proteinuria >1 g/d']
        },
        subgroups: [
            { label: 'Age ≥75 (ambulatory)', text: 'SPRINT-Senior (JAMA 2016): benefit preserved (HR 0.66) in ambulatory ≥75 — but these were robust elders; frail adults with dementia or falls were excluded.' }
        ],
        repRules: [
            { when: { conditionAny: ['diabetes'] }, level: 'outside', text: 'SPRINT excluded diabetes (ACCORD-BP found no significant MACE benefit of <120 in diabetes).' },
            { when: { conditionAny: ['priorStroke'] }, level: 'outside', text: 'SPRINT excluded prior stroke.' },
            { when: { conditionAny: ['dementia'] }, level: 'outside', text: 'SPRINT excluded dementia and nursing-home residents.' },
            { when: { conditionAny: ['hf'] }, level: 'outside', text: 'SPRINT excluded symptomatic heart failure.' },
            { when: { healthAtLeast: 'fair' }, level: 'extrapolated', text: 'SPRINT elders were unusually robust; frailty shifts the balance toward harms.' }
        ],
        harms: [
            { id: 'syncope', label: 'Syncope or serious hypotension', severity: 'serious',
              excessAnnualRate: 0.005,
              scaling: [
                  { when: { minAge: 80 }, mult: 1.6, why: 'orthostatic vulnerability rises with age' },
                  { when: { healthAtLeast: 'fair' }, mult: 1.8, why: 'frailty (excluded from SPRINT) multiplies risk' }
              ],
              source: 'SPRINT: syncope 2.3% vs 1.7%, hypotension 2.4% vs 1.4% over 3.3 y' },
            { id: 'aki', label: 'Acute kidney injury', severity: 'moderate',
              excessAnnualRate: 0.005,
              scaling: [{ when: { condition: 'ckd45' }, mult: 1.8, why: 'reduced renal reserve' }],
              source: 'SPRINT: AKI 4.1% vs 2.5% over 3.3 y' },
            { id: 'lytes', label: 'Electrolyte abnormality', severity: 'moderate',
              excessAnnualRate: 0.0025, source: 'SPRINT: 3.1% vs 2.3% over 3.3 y' }
        ],
        burden: {
            dosesPerDay: 2, route: 'oral', labsPerYear: 2, extraVisitsPerYear: 2,
            constraints: ['Usually needs 2–3 agents', 'More titration visits', 'Home BP monitoring'],
            costTier: 1, interactions: 'moderate',
            notes: ['SPRINT intensive arm averaged ~2.8 BP meds', 'More lab checks for AKI/electrolytes']
        },
        citations: [
            { label: 'SPRINT, NEJM 2015;373:2103' },
            { label: 'SPRINT-Senior (Williamson et al.), JAMA 2016;315:2673' },
            { label: 'ACCORD-BP, NEJM 2010 (diabetes — no significant benefit)' }
        ]
    },

    // =====================================================================
    {
        id: 'apixaban-af',
        name: 'Apixaban — atrial fibrillation',
        example: 'apixaban 5 mg twice daily',
        drugClass: 'Direct oral anticoagulant (factor Xa inhibitor)',
        indication: 'Stroke prevention in nonvalvular atrial fibrillation',
        tagline: 'Benefit is immediate and scales directly with CHA₂DS₂-VASc; bleeding scales with age and kidneys.',
        baseline: { type: 'chadsvasc' },
        outcome: { label: 'Ischemic stroke or systemic embolism', shortLabel: 'strokes', includesDeath: false },
        effect: {
            hr: 0.32, ci: [0.25, 0.42],
            source: 'Derived vs no antithrombotic two ways: warfarin RRR 64% (Hart 2007) × ARISTOTLE HR 0.79 → 0.28; AVERROES HR 0.45 vs aspirin × aspirin RRR ~20% → 0.36. Model uses the midpoint, 0.32',
            note: 'ARISTOTLE: stroke/SE 1.27 vs 1.60%/y (vs warfarin), major bleeding LOWER than warfarin (2.13 vs 3.09%/y), mortality HR 0.89.'
        },
        ttb: { rampYears: 0, displayYears: 0,
               display: 'Protection begins within days of starting',
               source: 'Anticoagulant effect is immediate; trial curves separate from the outset' },
        trial: {
            name: 'ARISTOTLE (n=18,201) + Hart meta-analysis',
            meanAge: 70, maxAge: 95, pctFemale: 35, medianFollowupYears: 1.8,
            adherence: 0.85, adherenceNote: 'est.; ~25% discontinued during trial',
            annualControlRate: 0.045,
            controlRateSource: 'untreated CHA₂DS₂-VASc ~4 (Friberg 2012)',
            sex: 'mixed',
            keyExclusions: ['CrCl <25 mL/min or Cr >2.5', 'Mechanical valve / moderate-severe mitral stenosis', 'Prior ICH in many DOAC trials', 'High fall-risk patients often excluded in practice, not protocol']
        },
        subgroups: [
            { label: 'Age ≥80', text: 'DOAC benefit preserved in the very old (ARISTOTLE age subgroups; ELDERCARE-AF showed benefit of low-dose edoxaban even in frail ≥80) — but bleeding rates are 2–3× higher than in the trial average.' }
        ],
        repRules: [
            { when: { conditionAny: ['ckd45'] }, level: 'extrapolated', text: 'ARISTOTLE excluded CrCl <25; dosing and evidence in advanced CKD are observational.' },
            { when: { conditionAny: ['dementia'] }, level: 'extrapolated', text: 'Cognitively impaired patients were rarely enrolled; weigh supervision and fall risk.' }
        ],
        harms: [
            { id: 'majorbleed', label: 'Major bleeding (excess vs no anticoagulant)', severity: 'serious',
              excessAnnualRate: 0.009,
              scaling: [
                  { when: { minAge: 75 }, mult: 1.6, why: 'bleeding roughly doubles from age 65–70 to ≥80' },
                  { when: { minAge: 85 }, mult: 1.4, why: 'further rise in the very old (applied on top of ≥75)' },
                  { when: { condition: 'ckd45' }, mult: 1.6, why: 'renal impairment raises drug levels and bleeding' },
                  { when: { condition: 'priorBleed' }, mult: 2.0, why: 'prior major bleed is the strongest predictor of the next one' }
              ],
              source: 'AVERROES: apixaban 1.4%/y vs aspirin 1.2%/y; est. excess ~0.5–1%/y vs no antithrombotic at trial-average age, scaled by HAS-BLED-style factors' },
            { id: 'ich', label: 'Intracranial hemorrhage (excess)', severity: 'serious',
              excessAnnualRate: 0.002,
              scaling: [{ when: { minAge: 80 }, mult: 1.5, why: 'age raises ICH risk' }],
              source: 'ARISTOTLE ICH 0.33%/y (less than half of warfarin’s 0.80%/y; DOAC-class ICH RR 0.48 vs warfarin — Ruff Lancet 2014); est. excess vs none' },
            { id: 'gib', label: 'Nuisance/minor bleeding (bruising, epistaxis)', severity: 'nuisance',
              excessAnnualRate: 0.06, source: 'est. from clinically-relevant-non-major bleeding rates' }
        ],
        burden: {
            dosesPerDay: 2, route: 'oral', labsPerYear: 1, extraVisitsPerYear: 0,
            constraints: ['Twice-daily dosing — missed doses lose protection quickly', 'Hold around procedures', 'Avoid NSAIDs'],
            costTier: 2, interactions: 'moderate',
            notes: ['No INR monitoring (unlike warfarin)', 'Renal function check ~yearly', 'Cost falling as generics arrive']
        },
        citations: [
            { label: 'ARISTOTLE, NEJM 2011;365:981' },
            { label: 'AVERROES, NEJM 2011;364:806' },
            { label: 'Hart et al., Ann Intern Med 2007;146:857 (warfarin RRR 64% vs control)' },
            { label: 'Ruff et al., Lancet 2014;383:955 (DOAC meta-analysis)' },
            { label: 'Friberg et al., Eur Heart J 2012 (CHA₂DS₂-VASc event rates)' }
        ]
    },

    // =====================================================================
    {
        id: 'alendronate',
        name: 'Alendronate — osteoporosis',
        example: 'alendronate 70 mg weekly (fasting, upright)',
        drugClass: 'Bisphosphonate',
        indication: 'Postmenopausal osteoporosis (T-score ≤ −2.5 or prior fragility fracture)',
        tagline: 'Fast time-to-benefit and cheap — but a genuinely burdensome dosing ritual.',
        baseline: {
            type: 'anchored',
            label: 'Fracture risk',
            trialControlRate: { risk: 0.182, years: 3 },
            rateSource: 'FIT-1 placebo: 18.2% clinical fractures over 3 y (women with prior vertebral fracture)',
            options: [
                { id: 'low',     label: 'Osteoporosis by T-score only, no prior fracture', mult: 0.55 },
                { id: 'typical', label: 'Prior fragility/vertebral fracture', mult: 1.0 },
                { id: 'high',    label: 'Multiple fractures or very low T-score (≤ −3.5)', mult: 1.4 }
            ]
        },
        outcome: { label: 'Clinical fracture (hip, vertebral, wrist…)', shortLabel: 'fractures', includesDeath: false },
        effect: {
            hr: 0.72, ci: [0.63, 0.82],
            source: 'FIT-1 Lancet 1996 (any clinical fracture 13.8% vs 18.2%); components: hip RR 0.49, clinical vertebral RR ~0.45, nonvertebral RR ~0.80 (Cochrane)',
            note: 'In women without prior fracture (FIT-2), benefit was significant only with T ≤ −2.5 (RR ~0.64 for clinical fractures).'
        },
        ttb: { rampYears: 1.0, displayYears: 1.03,
               display: '≈ 12 months to prevent 1 nonvertebral fracture per 100 treated (hip: ~20 months per 200)',
               source: 'Deardorff et al., JAMA Intern Med 2022 (TTB meta-analysis, 10 RCTs)' },
        trial: {
            name: 'FIT-1 (n=2,027) / FIT-2 (n=4,432)',
            meanAge: 71, maxAge: 81, pctFemale: 100, medianFollowupYears: 3,
            adherence: 0.89, adherenceNote: 'in-trial; real-world bisphosphonate persistence is notoriously poor (~50% by 1 y)',
            annualControlRate: 0.065, sex: 'female',
            keyExclusions: ['Severe CKD (eGFR <30–35)', 'Esophageal disease', 'Unable to sit upright 30 min', 'Men (FIT was women only; separate smaller trials support use in men)']
        },
        subgroups: [
            { label: 'Age >80', text: 'FIT enrolled to 81; benefit in the very old is supported by HORIZON (zoledronate, to age 89+) — hip-fracture prevention persists but evidence thins past the mid-80s.' }
        ],
        repRules: [
            { when: { conditionAny: ['ckd45'] }, level: 'outside', text: 'Bisphosphonates are generally avoided below eGFR 30–35 (hypocalcemia, adynamic bone).' },
            { when: { minAge: 86 }, level: 'extrapolated', text: 'Beyond the ages enrolled in the pivotal trials.' },
            { when: { sex: 'male' }, level: 'extrapolated', text: 'FIT enrolled women; male data come from smaller trials showing similar BMD/vertebral effects.' }
        ],
        harms: [
            { id: 'aff', label: 'Atypical femoral fracture', severity: 'serious',
              excessAnnualRate: 0.00017,
              scaling: [{ when: { condition: 'asian' }, mult: 4.8, why: 'AFF hazard ~4.8× higher in Asian vs White women (Black NEJM 2020)' }],
              source: 'Black NEJM 2020: ~1–2/10,000 person-years in the first 3–5 y, rising steeply with duration (>5–8 y); risk falls quickly after stopping. At 3 y, ~149 hip fractures are prevented per AFF-pair caused (per 10,000 White women)' },
            { id: 'onj', label: 'Osteonecrosis of the jaw', severity: 'serious',
              excessAnnualRate: 0.00005, source: '~1/10,000–1/100,000 person-years with oral dosing' },
            { id: 'gi', label: 'Reflux/esophagitis or GI upset', severity: 'nuisance',
              excessAnnualRate: 0.015, source: 'est.; the dosing ritual exists to protect the esophagus' }
        ],
        burden: {
            dosesPerDay: 0.15, route: 'oral (weekly ritual)', labsPerYear: 1, extraVisitsPerYear: 0,
            constraints: ['Empty stomach, plain water only', 'Stay upright 30–60 min', 'No food/coffee/other pills for 30–60 min', 'Dental check advised before starting', 'DXA every ~2 y'],
            costTier: 1, interactions: 'low',
            notes: ['Weekly, not daily — but the ritual is strict', 'Drug holiday usually considered after 5 y']
        },
        citations: [
            { label: 'FIT-1 (Black et al.), Lancet 1996;348:1535' },
            { label: 'FIT-2 (Cummings et al.), JAMA 1998;280:2077' },
            { label: 'Deardorff et al., JAMA Intern Med 2022 (time to benefit)' },
            { label: 'Black et al., NEJM 2020 (atypical femoral fractures)' },
            { label: 'Wells et al., Cochrane 2008 (nonvertebral RR)' }
        ]
    },

    // =====================================================================
    {
        id: 'dapagliflozin-hf',
        name: 'Dapagliflozin — HFrEF',
        example: 'dapagliflozin 10 mg daily',
        drugClass: 'SGLT2 inhibitor',
        indication: 'Heart failure with reduced ejection fraction (with or without diabetes)',
        tagline: 'One of the fastest times-to-benefit in preventive medicine — weeks, not years.',
        baseline: {
            type: 'anchored',
            label: 'Risk of worsening HF or CV death',
            trialControlRate: { risk: 0.212, years: 1.5 },
            rateSource: 'DAPA-HF placebo: 21.2% over median 18.2 months',
            options: [
                { id: 'low',     label: 'NYHA II, stable, on full background therapy', mult: 0.8 },
                { id: 'typical', label: 'Typical DAPA-HF participant', mult: 1.0 },
                { id: 'high',    label: 'NYHA III–IV or recent HF hospitalization', mult: 1.4 }
            ]
        },
        outcome: { label: 'Worsening heart failure or cardiovascular death', shortLabel: 'HF events', includesDeath: true },
        effect: {
            hr: 0.74, ci: [0.65, 0.85],
            source: 'DAPA-HF NEJM 2019: 16.3% vs 21.2% over 18.2 mo; all-cause mortality HR 0.83',
            note: 'Consistent with EMPEROR-Reduced; effect independent of diabetes status.'
        },
        ttb: { rampYears: 0.08, displayYears: 0.08,
               display: 'Statistically significant benefit by day 28',
               source: 'Berg et al., JAMA Cardiol 2021' },
        trial: {
            name: 'DAPA-HF (n=4,744)',
            meanAge: 66, maxAge: 94, pctFemale: 23, medianFollowupYears: 1.5,
            adherence: 0.92, adherenceNote: 'in-trial discontinuation ~5%/y',
            annualControlRate: 0.147, sex: 'mixed',
            keyExclusions: ['eGFR <30', 'SBP <95', 'Type 1 diabetes']
        },
        subgroups: [
            { label: 'Age ≥75', text: 'DAPA-HF age analysis: benefit preserved (HR ~0.68 in the oldest quartile) with no excess of key harms — unusually good elderly evidence.' }
        ],
        repRules: [
            { when: { conditionAny: ['ckd45'] }, level: 'extrapolated', text: 'DAPA-HF excluded eGFR <30 (later trials extend to ~20–25; benefit appears preserved).' }
        ],
        harms: [
            { id: 'gmi', label: 'Genital mycotic infection', severity: 'nuisance',
              excessAnnualRate: 0.02,
              scaling: [{ when: { condition: 'diabetes' }, mult: 1.8, why: 'glycosuria higher in diabetes' }],
              source: 'In T2DM trials ~5–6% vs ~1–2%; lower in HF populations (est.)' },
            { id: 'volume', label: 'Volume depletion / hypotension', severity: 'moderate',
              excessAnnualRate: 0.005,
              scaling: [
                  { when: { minAge: 80 }, mult: 1.5, why: 'less reserve' },
                  { when: { healthAtLeast: 'fair' }, mult: 1.5, why: 'frailty' }
              ],
              source: 'DAPA-HF: volume depletion 7.5% vs 6.8% (NS) — est. excess' },
            { id: 'dka', label: 'Diabetic ketoacidosis (incl. euglycemic)', severity: 'serious',
              excessAnnualRate: 0.001,
              scaling: [{ when: { conditionNot: 'diabetes' }, mult: 0.2, why: 'DKA essentially confined to diabetes' }],
              source: 'DAPA-HF: 3 cases, all with T2DM; hold during acute illness/surgery ("sick-day rules")' }
        ],
        burden: {
            dosesPerDay: 1, route: 'oral', labsPerYear: 1, extraVisitsPerYear: 0,
            constraints: ['Sick-day rules: hold when not eating/drinking or before surgery', 'Genital hygiene awareness'],
            costTier: 3, interactions: 'low',
            notes: ['Brand-name cost is the main barrier (generics emerging)', 'Small expected eGFR dip at start — do not stop for it']
        },
        citations: [
            { label: 'DAPA-HF (McMurray et al.), NEJM 2019;381:1995' },
            { label: 'Berg et al., JAMA Cardiol 2021 (benefit by 28 days)' },
            { label: 'Martinez et al., Circulation 2020 (age subgroups)' }
        ]
    },

    // =====================================================================
    {
        id: 'empagliflozin-t2d',
        name: 'Empagliflozin — T2D with CVD',
        example: 'empagliflozin 10–25 mg daily',
        drugClass: 'SGLT2 inhibitor',
        indication: 'Type 2 diabetes with established cardiovascular disease',
        tagline: 'Modest MACE effect but a large drop in CV death and HF admissions.',
        baseline: {
            type: 'anchored',
            label: 'CV event risk',
            trialControlRate: { risk: 0.121, years: 3.1 },
            rateSource: 'EMPA-REG placebo: 3-point MACE 12.1% over 3.1 y',
            options: [
                { id: 'low',     label: 'Stable CAD, well-controlled risk factors', mult: 0.8 },
                { id: 'typical', label: 'Typical EMPA-REG participant', mult: 1.0 },
                { id: 'high',    label: 'Polyvascular disease, prior HF, or CKD 3', mult: 1.5 }
            ]
        },
        outcome: { label: 'MACE (CV death, MI, or stroke)', shortLabel: 'major CV events', includesDeath: true },
        effect: {
            hr: 0.86, ci: [0.74, 0.99],
            source: 'EMPA-REG NEJM 2015: MACE 10.5% vs 12.1%; CV death HR 0.62; HF hospitalization HR 0.65',
            note: 'The mortality/HF effects are larger than the MACE composite suggests.'
        },
        ttb: { rampYears: 0.25, displayYears: 0.25,
               display: 'CV-death curves separate within ~3 months',
               source: 'EMPA-REG Kaplan-Meier' },
        trial: {
            name: 'EMPA-REG OUTCOME (n=7,020)',
            meanAge: 63, maxAge: 92, pctFemale: 28, medianFollowupYears: 3.1,
            adherence: 0.9, adherenceNote: 'est.',
            annualControlRate: 0.041, sex: 'mixed',
            keyExclusions: ['eGFR <30', 'No established CVD (primary-prevention diabetes NOT covered by this evidence)']
        },
        subgroups: [],
        repRules: [
            { when: { conditionAny: ['ckd45'] }, level: 'extrapolated', text: 'Excluded eGFR <30 (EMPA-KIDNEY later extended CKD evidence).' },
            { when: { healthAtLeast: 'poor' }, level: 'extrapolated', text: 'Frail adults were not enrolled; hypovolemia risk rises.' }
        ],
        harms: [
            { id: 'gmi', label: 'Genital mycotic infection', severity: 'nuisance',
              excessAnnualRate: 0.015, source: 'EMPA-REG: 6.4% vs 1.8% over 3.1 y' },
            { id: 'volume', label: 'Volume depletion / hypotension', severity: 'moderate',
              excessAnnualRate: 0.004,
              scaling: [{ when: { minAge: 80 }, mult: 1.5, why: 'less reserve' }],
              source: 'est. from trial AE tables' },
            { id: 'dka', label: 'Diabetic ketoacidosis', severity: 'serious',
              excessAnnualRate: 0.0005, source: 'EMPA-REG: rare (0.1% vs <0.1%); class warning stands' },
            { id: 'gu', label: 'Urinary tract infection', severity: 'moderate',
              excessAnnualRate: 0.005, source: 'small excess in women in some trials (est.)' }
        ],
        burden: {
            dosesPerDay: 1, route: 'oral', labsPerYear: 1, extraVisitsPerYear: 0,
            constraints: ['Sick-day rules', 'Hold before surgery'],
            costTier: 3, interactions: 'low',
            notes: ['Cost is the main burden', 'Expected small initial eGFR dip']
        },
        citations: [
            { label: 'EMPA-REG OUTCOME (Zinman et al.), NEJM 2015;373:2117' }
        ]
    },

    // =====================================================================
    {
        id: 'metformin',
        name: 'Metformin — type 2 diabetes',
        example: 'metformin 1000 mg twice daily',
        drugClass: 'Biguanide',
        indication: 'Newly diagnosed type 2 diabetes (UKPDS population: overweight, ~age 53)',
        tagline: 'A representativeness caution: the trial enrolled newly diagnosed 50-somethings — not long-standing diabetes in the elderly.',
        baseline: {
            type: 'anchored',
            label: 'Risk of diabetes-related endpoints',
            trialControlRate: { risk: 0.0433, years: 1 },
            rateSource: 'UKPDS 34 conventional-therapy arm: ~43 events per 1000 person-years',
            options: [
                { id: 'low',     label: 'Well-controlled, few risk factors', mult: 0.7 },
                { id: 'typical', label: 'Typical newly diagnosed T2D', mult: 1.0 },
                { id: 'high',    label: 'Poor control or additional CV risk', mult: 1.4 }
            ]
        },
        outcome: { label: 'Any diabetes-related endpoint (MI, stroke, microvascular, death)', shortLabel: 'diabetes-related events', includesDeath: true },
        effect: {
            hr: 0.68, ci: [0.53, 0.87],
            source: 'UKPDS 34 Lancet 1998: RR 0.68 for any diabetes-related endpoint; all-cause mortality RR 0.64 over median 10.7 y',
            note: 'Only 342 patients received metformin — the CI is wide and the mortality effect has never been cleanly replicated. Modern first-line status also rests on safety, weight, cost.'
        },
        ttb: { rampYears: 3.0, displayYears: 3.0,
               display: 'Curves diverged over ~3–6 years (glycemic benefits are slow)',
               source: 'UKPDS 34 Kaplan-Meier' },
        trial: {
            name: 'UKPDS 34 (n=753 overweight, newly diagnosed)',
            meanAge: 53, maxAge: 65, pctFemale: 46, medianFollowupYears: 10.7,
            adherence: 0.85, adherenceNote: 'est.; substantial crossover diluted ITT',
            annualControlRate: 0.0433, sex: 'mixed',
            keyExclusions: ['Age >65 at diagnosis', 'Established CVD', 'Renal impairment (contraindicated below eGFR 30)']
        },
        subgroups: [],
        repRules: [
            { when: { minAge: 70 }, level: 'extrapolated', text: 'UKPDS enrolled newly diagnosed patients aged 25–65 (mean 53). Applying this to older adults with long-standing diabetes is a large extrapolation.' },
            { when: { conditionAny: ['ckd45'] }, level: 'outside', text: 'Contraindicated below eGFR 30 (lactic acidosis risk).' }
        ],
        harms: [
            { id: 'gi', label: 'GI upset (diarrhea, nausea) — often early', severity: 'nuisance',
              excessAnnualRate: 0.03, oneTimeExtra: 0.15,
              source: '~10–25% experience GI symptoms at initiation; most settle or resolve with ER formulation' },
            { id: 'b12', label: 'B12 deficiency (long-term)', severity: 'moderate',
              excessAnnualRate: 0.006, source: 'HOME trial / DPPOS: ~5–10% over years; check B12 periodically' },
            { id: 'lactic', label: 'Lactic acidosis', severity: 'serious',
              excessAnnualRate: 0.00001, source: '<1 per 30,000 person-years with intact kidneys (Cochrane: no confirmed excess)' }
        ],
        burden: {
            dosesPerDay: 2, route: 'oral', labsPerYear: 2, extraVisitsPerYear: 0,
            constraints: ['Take with food', 'Hold for contrast studies/serious illness', 'Periodic B12'],
            costTier: 1, interactions: 'low',
            notes: ['Pennies a day', 'ER formulation once daily if GI upset']
        },
        citations: [
            { label: 'UKPDS 34, Lancet 1998;352:854' },
            { label: 'de Jager et al., BMJ 2010 (B12 — HOME trial)' },
            { label: 'Salpeter et al., Cochrane 2010 (lactic acidosis)' }
        ]
    },

    // =====================================================================
    {
        id: 'aspirin-secondary',
        name: 'Aspirin — secondary prevention',
        example: 'aspirin 81 mg daily',
        drugClass: 'Antiplatelet',
        indication: 'After MI, stroke, or established ASCVD',
        tagline: 'Immediate protection at high baseline risk — contrast with primary prevention in the elderly.',
        baseline: {
            type: 'anchored',
            label: 'Vascular event risk',
            trialControlRate: { risk: 0.082, years: 1 },
            rateSource: 'ATT secondary-prevention meta: control ~8.2% serious vascular events/y (older trial era)',
            options: [
                { id: 'low',     label: 'Modern, well-treated stable ASCVD', mult: 0.45 },
                { id: 'typical', label: 'Typical established ASCVD (trial era)', mult: 1.0 },
                { id: 'high',    label: 'Recent event or polyvascular disease', mult: 1.3 }
            ]
        },
        outcome: { label: 'Serious vascular event (MI, stroke, vascular death)', shortLabel: 'vascular events', includesDeath: true },
        effect: {
            hr: 0.81, ci: [0.75, 0.87],
            source: 'Antithrombotic Trialists’ Collaboration, Lancet 2009: 6.7 vs 8.2%/y in secondary prevention',
            note: 'On modern background therapy the baseline (and thus absolute benefit) is lower — choose the risk level accordingly.'
        },
        ttb: { rampYears: 0, displayYears: 0,
               display: 'Antiplatelet effect within days',
               source: 'Platelet inhibition is immediate' },
        trial: {
            name: 'ATT Collaboration secondary-prevention meta (16 trials)',
            meanAge: 62, maxAge: 90, pctFemale: 25, medianFollowupYears: 2.5,
            adherence: 0.9, adherenceNote: 'est.',
            annualControlRate: 0.082, sex: 'mixed',
            keyExclusions: ['Bleeding diathesis', 'Active ulcer disease']
        },
        subgroups: [],
        repRules: [
            { when: { conditionAny: ['priorBleed'] }, level: 'extrapolated', text: 'Prior major bleeding shifts the balance — trials excluded active bleeding risk.' }
        ],
        harms: [
            { id: 'gib', label: 'Major GI bleed (excess)', severity: 'serious',
              excessAnnualRate: 0.0012,
              scaling: [
                  { when: { minAge: 75 }, mult: 3.0, why: 'major upper-GI bleeding on antiplatelets rises steeply with age (Li Lancet 2017: HR ~4 at ≥75, disabling/fatal OR ~10; consider PPI co-prescription)' },
                  { when: { condition: 'priorBleed' }, mult: 2.5, why: 'prior bleed strongly predicts recurrence' }
              ],
              source: 'ATT: ~1–2 extra major extracranial bleeds per 1000/y at trial-average age' },
            { id: 'ich', label: 'Hemorrhagic stroke (excess)', severity: 'serious',
              excessAnnualRate: 0.0003, source: 'ATT: small absolute excess' },
            { id: 'dyspepsia', label: 'Dyspepsia / easy bruising', severity: 'nuisance',
              excessAnnualRate: 0.03, source: 'est.' }
        ],
        burden: {
            dosesPerDay: 1, route: 'oral', labsPerYear: 0, extraVisitsPerYear: 0,
            constraints: ['Hold per proceduralist before some procedures'], costTier: 1, interactions: 'low',
            notes: ['Cheapest drug in the formulary', 'No monitoring']
        },
        citations: [
            { label: 'ATT Collaboration, Lancet 2009;373:1849' },
            { label: 'Li et al., Lancet 2017 (age and bleeding on antiplatelets)' }
        ]
    },

    // =====================================================================
    {
        id: 'aspirin-primary-elderly',
        name: 'Aspirin — primary prevention, age ≥70',
        example: 'aspirin 100 mg daily (ASPREE regimen)',
        drugClass: 'Antiplatelet',
        indication: 'Primary prevention in healthy adults ≥70 — a cautionary example',
        tagline: 'What it looks like when a preventive drug has no net benefit: RCT evidence of harm exceeding benefit.',
        baseline: {
            type: 'anchored',
            label: 'CV event risk',
            trialControlRate: { risk: 0.0108, years: 1 },
            rateSource: 'ASPREE placebo CV event rate ~10.8/1000 person-years',
            options: [
                { id: 'typical', label: 'Healthy community-dwelling ≥70 (ASPREE population)', mult: 1.0 },
                { id: 'high',    label: 'More risk factors (still no known CVD)', mult: 1.5 }
            ]
        },
        outcome: { label: 'Cardiovascular event (fatal CHD, MI, stroke, HF)', shortLabel: 'CV events', includesDeath: true },
        effect: {
            hr: 0.95, ci: [0.83, 1.08],
            source: 'ASPREE NEJM 2018 (n=19,114, median age 74): no significant CVD reduction; all-cause mortality HR 1.14 (1.01–1.29), disability-free survival not improved',
            note: 'This entry is included deliberately: the model shows a near-zero benefit bar against a real bleeding harm bar.'
        },
        ttb: { rampYears: 0, displayYears: 0,
               display: 'Not applicable — no clear benefit to wait for',
               source: 'ASPREE' },
        trial: {
            name: 'ASPREE (n=19,114)',
            meanAge: 74, maxAge: 95, pctFemale: 56, medianFollowupYears: 4.7,
            adherence: 0.7, adherenceNote: 'in-trial adherence ~62–71% by year',
            annualControlRate: 0.0108, sex: 'mixed',
            keyExclusions: ['Known CVD', 'Dementia', 'Independence-limiting disability', 'High bleeding risk']
        },
        subgroups: [],
        repRules: [],
        harms: [
            { id: 'majorbleed', label: 'Major hemorrhage (excess)', severity: 'serious',
              excessAnnualRate: 0.0024,
              scaling: [
                  { when: { minAge: 80 }, mult: 1.5, why: 'bleeding risk continues rising with age' },
                  { when: { condition: 'priorBleed' }, mult: 2.5, why: 'prior bleed strongly predicts recurrence' }
              ],
              source: 'ASPREE: 8.6 vs 6.2 major hemorrhages per 1000 person-years' }
        ],
        burden: {
            dosesPerDay: 1, route: 'oral', labsPerYear: 0, extraVisitsPerYear: 0,
            constraints: [], costTier: 1, interactions: 'low',
            notes: ['Cheap and easy — which is exactly why "low burden" cannot rescue "no benefit"']
        },
        citations: [
            { label: 'ASPREE (McNeil et al.), NEJM 2018;379:1509/1519/1499' }
        ]
    },

    // =====================================================================
    {
        id: 'tight-glucose',
        name: 'Intensive glycemic control (A1c <7%)',
        example: 'adding glipizide/insulin to reach A1c <7% vs ~7.9%',
        drugClass: 'Glycemic intensification (sulfonylurea/insulin era)',
        indication: 'Type 2 diabetes — microvascular prevention',
        tagline: 'The classic time-to-benefit mismatch: ~a decade to microvascular benefit, hypoglycemia starts today.',
        baseline: {
            type: 'anchored',
            label: 'Risk of advanced microvascular complications',
            trialControlRate: { risk: 0.0114, years: 1 },
            rateSource: 'UKPDS 33 conventional arm: ~11.4 microvascular events per 1000 person-years',
            options: [
                { id: 'low',     label: 'Short duration, no retinopathy/albuminuria', mult: 0.7 },
                { id: 'typical', label: 'Typical newly diagnosed T2D (UKPDS-like)', mult: 1.0 },
                { id: 'high',    label: 'Existing retinopathy/albuminuria', mult: 1.6 }
            ]
        },
        outcome: { label: 'Microvascular complication (retinopathy needing photocoagulation, nephropathy…)', shortLabel: 'microvascular events', includesDeath: false },
        effect: {
            hr: 0.75, ci: [0.60, 0.93],
            source: 'UKPDS 33 Lancet 1998: microvascular RR 0.75 (A1c 7.0 vs 7.9); no significant macrovascular/mortality benefit during the trial',
            note: 'ACCORD (NEJM 2008) found intensive control to A1c <6 INCREASED mortality in older established diabetes — targets must fit the patient.'
        },
        ttb: { rampYears: 6.0, displayYears: 8.5,
               display: '≈ 8–9 years to meaningful microvascular benefit (UKPDS curves diverge after ~6 y)',
               source: 'UKPDS 33 Kaplan-Meier; Huang et al., Ann Intern Med 2008 (decision model: expected benefit falls sharply with age/comorbidity)' },
        trial: {
            name: 'UKPDS 33 (n=3,867 newly diagnosed)',
            meanAge: 53, maxAge: 65, pctFemale: 39, medianFollowupYears: 10,
            adherence: 0.85, adherenceNote: 'est.; crossover diluted ITT',
            annualControlRate: 0.0114, sex: 'mixed',
            keyExclusions: ['Age >65 at diagnosis', 'Long-standing diabetes', 'Significant comorbidity']
        },
        subgroups: [
            { label: 'Older adults / established diabetes', text: 'ACCORD: intensive control (target A1c <6) in ~62-year-olds with long-standing T2D increased mortality (HR 1.22) and severe hypoglycemia 3-fold. Guidelines relax targets to 7.5–8.5% in the frail elderly.' }
        ],
        repRules: [
            { when: { minAge: 70 }, level: 'outside', text: 'UKPDS enrolled newly diagnosed 25–65-year-olds. For older adults with long-standing diabetes, ACCORD suggests net harm from tight targets — guidelines recommend A1c 7.5–8.5% when frail.' },
            { when: { healthAtLeast: 'fair' }, level: 'outside', text: 'With limited life expectancy, the ~9-year time-to-benefit usually cannot be realized while hypoglycemia harm is immediate (Holmes framework).' }
        ],
        harms: [
            { id: 'hypo', label: 'Severe hypoglycemia (needing assistance)', severity: 'serious',
              excessAnnualRate: 0.01,
              scaling: [
                  { when: { minAge: 75 }, mult: 1.7, why: 'age impairs counter-regulation and awareness' },
                  { when: { condition: 'ckd45' }, mult: 1.6, why: 'reduced insulin/sulfonylurea clearance' },
                  { when: { condition: 'dementia' }, mult: 1.5, why: 'erratic intake, impaired self-rescue' }
              ],
              source: 'UKPDS insulin arm ~2.3%/y any major; ACCORD intensive 3.1%/y requiring assistance (excess ~1%/y at moderate targets, est.)' },
            { id: 'weight', label: 'Meaningful weight gain', severity: 'nuisance',
              excessAnnualRate: 0.02, oneTimeExtra: 0.35,
              source: 'UKPDS: ~2.9–4 kg average gain vs conventional, mostly in the first years (est. share affected)' },
            { id: 'falls', label: 'Hypoglycemia-related falls/fractures', severity: 'moderate',
              excessAnnualRate: 0.003,
              scaling: [{ when: { minAge: 75 }, mult: 2.0, why: 'falls consequence severity rises with age' }],
              source: 'observational; est.' }
        ],
        burden: {
            dosesPerDay: 2, route: 'oral ± injections', labsPerYear: 4, extraVisitsPerYear: 2,
            constraints: ['Glucose self-monitoring', 'Hypoglycemia action plan', 'Meal timing discipline'],
            costTier: 1, interactions: 'moderate',
            notes: ['Monitoring workload is the dominant burden', 'Insulin adds injection burden and driving considerations']
        },
        citations: [
            { label: 'UKPDS 33, Lancet 1998;352:837' },
            { label: 'ACCORD, NEJM 2008;358:2545' },
            { label: 'Huang et al. (modeled lag-to-benefit of glycemic control)' },
            { label: 'Holmes et al., Arch Intern Med 2006 (medication appropriateness late in life)' }
        ]
    }
    ];

    function merge(list) {
        (list || []).forEach(function (m) {
            var i = MEDS.findIndex(function (x) { return x.id === m.id; });
            if (i >= 0) MEDS[i] = m; else MEDS.push(m);
        });
    }

    return {
        version: '2026-08-09',
        disclaimer: 'Educational model for clinical teaching. Estimates are curated from published trials and meta-analyses but individualized numbers are model outputs, not measured facts. Not medical advice.',
        ADHERENCE_LEVELS: ADHERENCE_LEVELS,
        meds: MEDS,
        merge: merge
    };
});
