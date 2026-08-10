/**
 * MedModel lift service — bridges the medeval database (meds.kevinkeet.com,
 * 60 medications with per-indication NNT/RRR, harms, burden, cost,
 * contraindications) into MedModel's competing-hazards engine format.
 *
 * The two datasets play different roles:
 *   - medeval provides BREADTH: the curated catalog, purpose taxonomy
 *     (preventive / disease-modifying / symptomatic / replacement),
 *     contraindications, costs, burden descriptions, QALY severity weights.
 *   - MedModel's hand-verified entries (medications.js) provide DEPTH for the
 *     major preventive classes: trial demographics, CIs, TTB from the
 *     time-to-benefit literature, harm scaling rules, citations.
 *
 * Lift math (documented in methods.html): a medeval outcome published as
 * {rrr, nnt, timeframe} implies, in its trial population,
 *     ARR_T = 1/NNT   and   control risk over T:  R0_T = ARR_T / RRR
 * giving an annual control hazard  h0 = −ln(1 − R0_T)/T  and HR = 1 − RRR.
 * Time-to-benefit and trial adherence are not published per-entry upstream,
 * so lifted entries carry class-level defaults (table below, sources noted)
 * and are labeled as such in the UI.
 */
(function (root, factory) {
    if (typeof module === 'object' && module.exports) {
        module.exports = factory(
            require('../data/medeval-database.js'),
            require('../data/medications.js')
        );
    } else {
        root.Lift = factory(root.MedevalDB, root.MedLibrary);
    }
})(typeof self !== 'undefined' ? self : this, function (MedevalDB, MedLibrary) {
    'use strict';

    var DB = MedevalDB.MEDICATIONS_DATABASE;

    // ------------------------------------------------------------------
    // Severity weights — imported from the medeval benefit engine
    // (QALY-utility conventions; used ONLY for the regimen-ranking view,
    // never for the per-1000 counts). 1.0 = death equivalent.
    // ------------------------------------------------------------------
    var OUTCOME_WEIGHTS = {
        death: 1.0, cv_death: 1.0, all_cause_mortality: 1.0, mortality: 1.0,
        stroke_disabling: 0.7, stroke_any: 0.4, stroke: 0.4, stroke_recurrence: 0.4,
        mi_fatal: 1.0, mi_nonfatal: 0.2, mi: 0.25,
        heart_failure_hospitalization: 0.15, hf_hospitalization: 0.15,
        hospitalization: 0.1, cv_hospitalization: 0.1,
        cv_death_hf_hosp: 0.4, mace: 0.35, mace_composite: 0.35,
        eskd_dialysis: 0.5, kidney_progression: 0.3, esrd: 0.5, doubling_creatinine: 0.2,
        amputation: 0.4, blindness: 0.4, thromboembolism: 0.3,
        hip_fracture: 0.5, vertebral_fracture: 0.2, nonvertebral_fracture: 0.15, falls: 0.05,
        exacerbations: 0.1, gout_flares: 0.02, pain_relief: 0.15, remission: 0.2,
        limb_events: 0.3, symptom_relief: 0.1, congestion_relief: 0.1,
        major_bleeding: 0.15, intracranial_bleeding: 0.6, gi_bleeding: 0.08, fatal_bleeding: 1.0,
        severe_hypoglycemia: 0.05, severe_hypoglycemia_elderly: 0.05, dka: 0.1,
        new_onset_diabetes: 0.05, hypercalcemia: 0.05,
        aki: 0.1, hyperkalemia_severe: 0.08, hyperkalemia: 0.05,
        atypical_femur_fracture: 0.4, osteonecrosis_jaw: 0.2,
        pneumonia: 0.1, pneumonia_copd: 0.15,
        cv_events: 0.3, afib: 0.1, falls_elderly: 0.1,
        cns_depression: 0.15, cognitive_impairment: 0.2, edema_worsening_hf: 0.1,
        discontinuation_syndrome: 0.02, angioedema: 0.1, pancreatitis: 0.1,
        rhabdomyolysis: 0.15, hypersensitivity_syndrome: 0.2, diarrhea_severe: 0.02,
        osteoporosis: 0.1, myopathy: 0.15
    };
    var BURDEN_PENALTIES = { low: 0.01, moderate: 0.03, high: 0.06 }; // annual QALY decrement (medeval)

    // ------------------------------------------------------------------
    // Class-level defaults for what the upstream database doesn't carry.
    // rampYears sources (see methods.html): HF neurohormonal/SGLT2 agents show
    // event-curve separation within weeks–months (CONSENSUS, COPERNICUS,
    // RALES, DAPA-HF day-28); statins ~2 y (Yourman 2021); BP ~1–3 y (Ho
    // 2022); bisphosphonates ~1 y (Deardorff 2022); antithrombotics
    // immediate; glycemic agents slow (UKPDS); urate-lowering ~6 mo
    // (paradoxical early flares); inhalers within one season.
    // ------------------------------------------------------------------
    var CLASS_DEFAULTS = [
        { match: /Beta-blocker|ACE Inhibitor|ARB|ARNI|Mineralocorticoid|Digoxin/i, ramp: 0.25, meanAge: 64 },
        { match: /SGLT2/i, ramp: 0.25, meanAge: 65 },
        { match: /Statin|Ezetimibe|PCSK9|Icosapent/i, ramp: 1.75, meanAge: 63 },
        { match: /DOAC|Anticoagulant|Vitamin K/i, ramp: 0, meanAge: 71 },
        { match: /Antiplatelet/i, ramp: 0, meanAge: 63 },
        { match: /Biguanide/i, ramp: 3, meanAge: 53 },
        { match: /Sulfonylurea|DPP-4|Insulin/i, ramp: 5, meanAge: 60 },
        { match: /GLP-1/i, ramp: 1.0, meanAge: 64 },
        { match: /Bisphosphonate|Denosumab|Teriparatide|Romosozumab/i, ramp: 1.0, meanAge: 72 },
        { match: /Thiazide|Calcium Channel|Diuretic/i, ramp: 1.5, meanAge: 66 },
        { match: /Corticosteroid|LABA|LAMA|Inhal/i, ramp: 0.25, meanAge: 63 },
        { match: /Xanthine|Uricosuric|Allopurinol|Febuxostat/i, ramp: 0.5, meanAge: 60 },
        { match: /Colchicine/i, ramp: 0.1, meanAge: 62 },
        { match: /Proton Pump/i, ramp: 0.1, meanAge: 60 }
    ];
    var DEFAULT_TRIAL_ADHERENCE = 0.85; // typical in-trial adherence (est.; see methods)

    // For DOACs the upstream RRRs are vs WARFARIN. Model vs no-antithrombotic:
    // 1−RRR_net = (1−0.64) × HR_vs_warfarin  (Hart 2007 warfarin RRR 64%).
    var WARFARIN_RRR_VS_NONE = 0.64;
    var DOAC_IDS = { apixaban: 1, rivaroxaban: 1, dabigatran: 1, edoxaban: 1 };

    // Anticoagulant bleeding is computed dynamically from HAS-BLED (see
    // riskmodels.js) instead of static NNH. Agent factors vs warfarin:
    // major bleeding: ARISTOTLE 0.69 (apixaban), RE-LY 0.94 (dabigatran 150),
    // ROCKET ~1.04 (rivaroxaban), ENGAGE 0.80 (edoxaban); ICH factors ~0.4–0.5
    // (Ruff 2014 class RR 0.48).
    var AGENT_BLEED_FACTORS = {
        warfarin:    { major: 1.0,  ich: 1.0 },
        apixaban:    { major: 0.69, ich: 0.42 },
        dabigatran:  { major: 0.94, ich: 0.40 },
        rivaroxaban: { major: 1.04, ich: 0.67 },
        edoxaban:    { major: 0.80, ich: 0.47 }
    };

    // Outcome-key → presentation metadata
    var OUTCOME_LABELS = {
        mortality: ['death from any cause', 'deaths', true],
        all_cause_mortality: ['death from any cause', 'deaths', true],
        cv_death: ['cardiovascular death', 'CV deaths', true],
        cv_mortality: ['cardiovascular death', 'CV deaths', true],
        mace: ['major CV event (MI, stroke, CV death)', 'major CV events', true],
        mace_composite: ['major CV event', 'major CV events', true],
        stroke: ['stroke or systemic embolism', 'strokes', false],
        stroke_any: ['stroke', 'strokes', false],
        stroke_recurrence: ['recurrent stroke', 'recurrent strokes', false],
        mi: ['myocardial infarction', 'heart attacks', false],
        hospitalization: ['hospitalization', 'hospitalizations', false],
        hf_hospitalization: ['heart-failure hospitalization', 'HF admissions', false],
        heart_failure_hospitalization: ['heart-failure hospitalization', 'HF admissions', false],
        cv_death_hf_hosp: ['CV death or HF hospitalization', 'HF events', true],
        kidney_progression: ['kidney disease progression (sustained eGFR decline or ESKD)', 'kidney progressions', false],
        eskd_dialysis: ['kidney failure requiring dialysis', 'dialysis starts', false],
        hip_fracture: ['hip fracture', 'hip fractures', false],
        vertebral_fracture: ['vertebral fracture', 'vertebral fractures', false],
        nonvertebral_fracture: ['nonvertebral fracture', 'nonvertebral fractures', false],
        exacerbations: ['moderate/severe exacerbation', 'exacerbations', false],
        gout_flares: ['gout flare', 'gout flares', false],
        thromboembolism: ['valve thrombosis or embolism', 'thromboembolic events', false],
        limb_events: ['major adverse limb event', 'limb events', false]
    };

    var INDICATION_LABELS = {
        heart_failure: 'Heart failure with reduced EF',
        post_mi: 'After myocardial infarction',
        post_mi_with_lv_dysfunction: 'Post-MI with LV dysfunction',
        hypertension: 'Hypertension',
        afib_stroke_prevention: 'Atrial fibrillation — stroke prevention',
        vte_treatment: 'VTE treatment/prevention',
        mechanical_valve: 'Mechanical valve',
        secondary_prevention: 'Established ASCVD (secondary prevention)',
        primary_prevention: 'Primary prevention',
        primary_prevention_high_risk: 'Primary prevention — high risk',
        ascvd_prevention: 'ASCVD prevention',
        diabetes: 'Type 2 diabetes',
        diabetes_cv: 'Type 2 diabetes — CV/mortality outcomes',
        diabetes_with_cvd: 'Type 2 diabetes with established CVD',
        diabetes_glycemic: 'Type 2 diabetes — glucose lowering',
        ckd: 'Chronic kidney disease',
        osteoporosis: 'Osteoporosis',
        copd: 'COPD',
        asthma: 'Asthma',
        gout: 'Gout',
        gout_prevention: 'Gout prevention',
        neuropathic_pain: 'Neuropathic pain',
        hypothyroidism: 'Hypothyroidism',
        heart_failure_symptoms: 'Heart failure — symptom control',
        resistant_hypertension: 'Resistant hypertension',
        stroke_prevention: 'Stroke prevention',
        pad: 'Peripheral artery disease',
        depression: 'Depression',
        anxiety: 'Anxiety',
        vitamin_d_deficiency: 'Vitamin D deficiency',
        fracture_prevention: 'Fracture prevention'
    };

    // Deep-overlay map: medevalId.indication → MedModel verified entry id
    var DEEP_MAP = {
        'atorvastatin.secondary_prevention': 'statin-secondary',
        'atorvastatin.primary_prevention_high_risk': 'statin-primary',
        'rosuvastatin.secondary_prevention': 'statin-secondary',
        'rosuvastatin.primary_prevention': 'statin-primary',
        'rosuvastatin.primary_prevention_high_risk': 'statin-primary',
        'simvastatin.secondary_prevention': 'statin-secondary',
        'apixaban.afib_stroke_prevention': 'apixaban-af',
        'alendronate.osteoporosis': 'alendronate',
        'dapagliflozin.heart_failure': 'dapagliflozin-hf',
        'empagliflozin.diabetes_with_cvd': 'empagliflozin-t2d',
        'metformin.diabetes_cv': 'metformin',
        'aspirin.secondary_prevention': 'aspirin-secondary'
        // aspirin.primary_prevention maps to the ASPREE deep entry only at ≥70 (see resolve()).
    };

    function classDefaults(cls) {
        for (var i = 0; i < CLASS_DEFAULTS.length; i++) {
            if (CLASS_DEFAULTS[i].match.test(cls)) return CLASS_DEFAULTS[i];
        }
        return { ramp: 1.0, meanAge: 65 };
    }

    function outcomeMeta(key) {
        var m = OUTCOME_LABELS[key];
        if (m) return { label: m[0], shortLabel: m[1], includesDeath: m[2] };
        var pretty = key.replace(/_/g, ' ');
        return { label: pretty, shortLabel: pretty, includesDeath: /death|mortality/.test(key) };
    }

    function severityFromWeight(key) {
        var w = OUTCOME_WEIGHTS[key] != null ? OUTCOME_WEIGHTS[key] : 0.05;
        if (w >= 0.3) return 'serious';
        if (w >= 0.08) return 'moderate';
        return 'nuisance';
    }

    function costTier(annualCost) {
        if (annualCost == null) return 1;
        if (annualCost < 200) return 1;
        if (annualCost < 2000) return 2;
        return 3;
    }

    function burdenScoreFromTier(tier) {
        return tier === 'high' ? 6.0 : (tier === 'moderate' ? 3.5 : 1.5);
    }

    // ------------------------------------------------------------------
    // Lift one medeval outcome into an engine-ready benefit spec.
    // Returns null when the outcome can't support the prevention model
    // (no rrr, no way to anchor a baseline).
    // ------------------------------------------------------------------
    function liftOutcome(medevalId, med, indication, outcomeKey, o) {
        if (!o || !o.rrr || o.rrr <= 0) return null;

        var rrr = o.rrr;
        var baselineType = 'anchored';
        var annualControlRate = null;

        if (indication === 'afib_stroke_prevention' && /stroke/.test(outcomeKey)) {
            baselineType = 'chadsvasc';
            if (DOAC_IDS[medevalId]) {
                // upstream RRR is vs warfarin → compose vs no antithrombotic
                rrr = 1 - (1 - WARFARIN_RRR_VS_NONE) * (1 - o.rrr);
            }
        } else if (o.nnt && o.timeframe) {
            var R0 = Math.min(0.95, (1 / o.nnt) / o.rrr);
            annualControlRate = 1 - Math.exp(Math.log(1 - R0) / o.timeframe);
        } else {
            return null; // rrr without nnt or a risk-model anchor — cannot place a baseline
        }

        var meta = outcomeMeta(outcomeKey);
        return {
            key: outcomeKey,
            label: meta.label,
            shortLabel: meta.shortLabel,
            includesDeath: meta.includesDeath,
            hr: 1 - rrr,
            rrDerivation: DOAC_IDS[medevalId] && baselineType === 'chadsvasc'
                ? 'vs no antithrombotic: warfarin RRR 64% (Hart 2007) composed with trial effect vs warfarin'
                : null,
            baselineType: baselineType,
            annualControlRate: annualControlRate,
            timeframe: o.timeframe || 1,
            nnt: o.nnt || null,
            endpoint: o.endpoint || outcomeKey,
            quality: o.quality || 'unknown',
            source: o.source || 'medeval database',
            weight: OUTCOME_WEIGHTS[outcomeKey] != null ? OUTCOME_WEIGHTS[outcomeKey] : 0.2
        };
    }

    function liftHarms(med) {
        var out = [];
        for (var h in (med.harms || {})) {
            var d = med.harms[h];
            if (!d || !d.nnh) continue;
            var annual = (1 / d.nnh) / (d.timeframe || 1);
            out.push({
                id: h,
                label: outcomeMeta(h).label,
                severity: severityFromWeight(h),
                excessAnnualRate: annual,
                scaling: [],
                source: (d.source || 'medeval database') + ' — NNH ' + d.nnh + (d.timeframe && d.timeframe !== 1 ? ' over ' + d.timeframe + ' y' : '/y'),
                weight: OUTCOME_WEIGHTS[h] != null ? OUTCOME_WEIGHTS[h] : 0.05
            });
        }
        return out;
    }

    // ------------------------------------------------------------------
    // Build the unified catalog.
    // Each catalog item: { key, medevalId, name, brandNames, drugClass,
    //   purpose, burdenTier, burdenDetails, annualCost, monitoring,
    //   contraindications, indications: [ {id, label, outcomes[], deepId} ],
    //   isStrategy }
    // Plus MedModel's "strategy" entries (bp-intensive etc.) appended.
    // ------------------------------------------------------------------
    function buildCatalog() {
        var items = [];
        for (var id in DB) {
            var med = DB[id];
            // The prevention engine only applies to event-prevention evidence.
            // Symptomatic/replacement drugs carry responder rates ("50% pain
            // reduction"), which are not preventable events — they get an
            // honest non-model card instead (raw data retained for display).
            var modelable = med.purpose === 'preventive' || med.purpose === 'disease_modifying';
            var inds = [];
            for (var ind in (med.benefits || {})) {
                var outcomes = [];
                for (var ok in med.benefits[ind]) {
                    var lifted = modelable ? liftOutcome(id, med, ind, ok, med.benefits[ind][ok]) : null;
                    if (lifted) outcomes.push(lifted);
                }
                inds.push({
                    id: ind,
                    label: INDICATION_LABELS[ind] || ind.replace(/_/g, ' '),
                    outcomes: outcomes,
                    deepId: DEEP_MAP[id + '.' + ind] || null,
                    raw: med.benefits[ind]
                });
            }
            items.push({
                key: id,
                medevalId: id,
                name: med.name,
                brandNames: med.brandNames || [],
                drugClass: med.class,
                purpose: med.purpose,
                burdenTier: med.burden,
                burdenDetails: med.burdenDetails || '',
                annualCost: med.annualCost,
                monitoring: med.monitoring || '',
                contraindications: med.contraindications || [],
                harms: liftHarms(med),
                indications: inds,
                classDefaults: classDefaults(med.class || ''),
                isStrategy: false,
                bleedFactors: AGENT_BLEED_FACTORS[id] || null
            });
        }

        // MedModel strategy entries (dose-target strategies, not single drugs)
        ['bp-standard', 'bp-intensive', 'tight-glucose'].forEach(function (sid) {
            var deep = MedLibrary.meds.find(function (m) { return m.id === sid; });
            if (!deep) return;
            items.push({
                key: 'strategy:' + sid,
                medevalId: null,
                name: deep.name,
                brandNames: [],
                drugClass: 'Treatment strategy',
                purpose: 'preventive',
                burdenTier: null,
                burdenDetails: '',
                annualCost: null,
                monitoring: '',
                contraindications: [],
                harms: [],
                indications: [{ id: 'strategy', label: deep.indication, outcomes: [], deepId: sid }],
                classDefaults: { ramp: deep.ttb.rampYears, meanAge: deep.trial.meanAge },
                isStrategy: true,
                bleedFactors: null
            });
        });

        return items;
    }

    // Contraindication tokens we can actually evaluate against patient state.
    // Everything else is displayed as a static "check before prescribing" list.
    function contraindicationCheck(tokens, ctx) {
        var hits = [];
        (tokens || []).forEach(function (t) {
            if ((t === 'egfr_below_30' || t === 'severe_ckd' || t === 'severe_renal_impairment') &&
                (ctx.ckd45 || (ctx.egfr != null && ctx.egfr < 30))) {
                hits.push('eGFR <30 — ' + t.replace(/_/g, ' '));
            }
            if (t === 'egfr_below_20' && ctx.egfr != null && ctx.egfr < 20) hits.push('eGFR <20');
            if (t === 'dialysis' && ctx.dialysis) hits.push('dialysis');
            if (t === 'active_bleeding' && ctx.priorBleed) hits.push('bleeding history — verify no active bleeding');
            if (t === 'noncompliance' && ctx.adherenceLow) hits.push('poor expected adherence (warfarin needs reliable INR control)');
            if ((t === 'decompensated_hf' || t === 'severe_hf') && ctx.hfSevere) hits.push(t.replace(/_/g, ' '));
        });
        return hits;
    }

    // ------------------------------------------------------------------
    // Goals of care — ported from the original meds.kevinkeet.com app.
    // The threshold is the net benefit (QALYs per 100 patients per YEAR)
    // a therapy must clear to be recommended for this patient. The app
    // converts to its per-1000-over-horizon units via thr × 10 × H.
    // ------------------------------------------------------------------
    var GOC = [
        { value: 1, id: 'comfort', name: 'Comfort-Focused', threshold: 3.0,
          summary: 'Quality of life now. Minimize medications; only very large, proven benefits are worth it.' },
        { value: 2, id: 'selective', name: 'Selective', threshold: 1.0,
          summary: 'High-value treatments only — clear, substantial benefit; quality of evidence matters.' },
        { value: 3, id: 'balanced', name: 'Balanced', threshold: 0.3,
          summary: 'Reasonable prevention with attention to burden; guidelines, but personalized.' },
        { value: 4, id: 'proactive', name: 'Proactive', threshold: 0.0,
          summary: 'Maximize prevention — willing to accept burden for any proven benefit.' }
    ];

    // ------------------------------------------------------------------
    // Beers / elderly safety — ported from the original engine
    // (AGS Beers Criteria 2023 basis; data lives on the database entries as
    // beers_criteria / elderly_caution).
    // ctx = { age, frail, fallRisk, dementia, hf }
    // ------------------------------------------------------------------
    function elderlySafety(medevalId, ctx) {
        var med = DB[medevalId];
        if (!med) return { beers: null, warnings: [], severity: null, avoid: false };
        var isElderly = ctx.age >= 65, isVeryElderly = ctx.age >= 75;
        var out = { beers: null, warnings: [], severity: null, avoid: false };

        if (med.beers_criteria && med.beers_criteria.listed && isElderly) {
            out.beers = {
                concern: med.beers_criteria.concern,
                recommendation: med.beers_criteria.recommendation,
                strength: med.beers_criteria.strength,
                severity: med.beers_criteria.strength === 'strong' ? 'high' : 'moderate'
            };
        }
        var c = med.elderly_caution;
        if (c) {
            if (c.fall_risk && (isElderly || ctx.fallRisk)) {
                out.warnings.push({ type: 'falls', message: 'Increases fall risk',
                    severity: (isVeryElderly || ctx.fallRisk || ctx.frail) ? 'high' : 'moderate' });
            }
            if (c.cognitive_impairment && (isElderly || ctx.dementia)) {
                out.warnings.push({ type: 'cognition', message: 'May cause or worsen cognitive impairment',
                    severity: ctx.dementia ? 'high' : 'moderate' });
            }
            if (c.sedation && isElderly) {
                out.warnings.push({ type: 'sedation', message: 'Sedation / CNS depression',
                    severity: (isVeryElderly || ctx.frail) ? 'high' : 'moderate' });
            }
            if (c.hypoglycemia_risk && isElderly) {
                out.warnings.push({ type: 'hypoglycemia', message: 'High severe-hypoglycemia risk in older adults',
                    severity: (isVeryElderly || ctx.frail || ctx.dementia) ? 'high' : 'moderate' });
            }
            if (c.avoid_in_hf && ctx.hf) {
                out.warnings.push({ type: 'hf', message: 'May worsen heart failure', severity: 'high' });
            }
            if (c.narrow_therapeutic_window && isElderly) {
                out.warnings.push({ type: 'toxicity', message: 'Narrow therapeutic window — toxicity risk in older adults', severity: 'high' });
            }
        }
        var sev = null;
        out.warnings.forEach(function (w) { if (w.severity === 'high') sev = 'high'; else if (!sev) sev = 'moderate'; });
        if (out.beers && out.beers.severity === 'high') sev = 'high';
        out.severity = sev;
        out.avoid = !!(ctx.frail && sev === 'high');
        return out;
    }

    // ------------------------------------------------------------------
    // Recommendation ladder — ported from the original engine, driven by the
    // merged model's numbers. netAnnualPer100 is the severity-weighted net in
    // the original's units (QALYs / 100 patients / year).
    // ------------------------------------------------------------------
    function recommend(opts) {
        var g = GOC[(opts.goc || 3) - 1];
        var net = opts.netAnnualPer100;
        var safety = opts.safety || { severity: null, beers: null, avoid: false };
        var isElderly = opts.age >= 65;

        if (opts.contraHit) return { tier: 'held-out', text: 'Possible contraindication — verify first' };
        if (net < 0) return { tier: 'not-recommended', text: 'Expected harms outweigh benefits' };
        if (safety.avoid) return { tier: 'caution-elderly', text: 'Avoid in frail patients — high adverse-event risk (Beers Criteria)' };
        if (safety.beers && safety.severity === 'high' && isElderly) {
            return net >= Math.max(g.threshold, 1.0)
                ? { tier: 'caution-elderly', text: 'Benefit exists, but Beers Criteria medication — discuss safer alternatives' }
                : { tier: 'not-recommended', text: 'Beers Criteria medication with limited benefit here — avoid' };
        }
        if (safety.beers && isElderly) {
            return net >= g.threshold
                ? { tier: 'caution-elderly', text: 'Beers Criteria medication — lowest dose, monitor closely' }
                : { tier: 'marginal', text: 'Beers Criteria medication with limited benefit — consider alternatives' };
        }
        if (net >= g.threshold) {
            if (net >= 3.0) return { tier: 'strong', text: 'High net benefit — strongly recommended' };
            if (safety.severity === 'high' && isElderly) return { tier: 'consider', text: 'Good benefit — use caution in older adults, monitor closely' };
            if (opts.highBurden && (opts.goc || 3) <= 2) return { tier: 'consider', text: 'Good benefit but high burden — discuss' };
            if (opts.annualCost > 3000 && opts.costSensitivity === 'high') return { tier: 'consider', text: 'Good benefit but high cost — discuss alternatives' };
            return { tier: 'recommended', text: 'Net benefit meets this patient\'s goals' };
        }
        return net > 0
            ? { tier: 'marginal', text: 'Benefit below the ' + g.name.toLowerCase() + ' threshold' }
            : { tier: 'not-recommended', text: 'No net benefit expected' };
    }

    // Preference-modulated burden (ported): low pill tolerance bumps the
    // tier; cost sensitivity and monitoring intolerance add penalty.
    function effectiveBurden(item, prefs) {
        prefs = prefs || {};
        var order = ['low', 'moderate', 'high'];
        var idx = Math.max(0, order.indexOf(item.burdenTier || 'moderate'));
        if (prefs.pills === 'low') idx = Math.min(2, idx + 1);
        var penalty = BURDEN_PENALTIES[order[idx]];
        if (prefs.cost === 'high' && item.annualCost > 2000) penalty += 0.005;
        else if (prefs.cost === 'moderate' && item.annualCost > 5000) penalty += 0.003;
        if (prefs.monitoring === 'low' && /monitor|INR|blood test|lab|potassium|creatinine/i.test(item.monitoring || '')) penalty += 0.003;
        return { tier: order[idx], penalty: penalty };
    }

    return {
        OUTCOME_WEIGHTS: OUTCOME_WEIGHTS,
        BURDEN_PENALTIES: BURDEN_PENALTIES,
        GOC: GOC,
        elderlySafety: elderlySafety,
        recommend: recommend,
        effectiveBurden: effectiveBurden,
        AGENT_BLEED_FACTORS: AGENT_BLEED_FACTORS,
        WARFARIN_RRR_VS_NONE: WARFARIN_RRR_VS_NONE,
        DEFAULT_TRIAL_ADHERENCE: DEFAULT_TRIAL_ADHERENCE,
        INDICATION_LABELS: INDICATION_LABELS,
        buildCatalog: buildCatalog,
        liftOutcome: liftOutcome,
        contraindicationCheck: contraindicationCheck,
        classDefaults: classDefaults,
        severityFromWeight: severityFromWeight,
        costTier: costTier,
        burdenScoreFromTier: burdenScoreFromTier,
        outcomeMeta: outcomeMeta
    };
});
