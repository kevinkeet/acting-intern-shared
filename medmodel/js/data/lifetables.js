/**
 * MedModel — mortality individualization data.
 *
 * The engine's Gompertz baseline (engine.js) is anchored to US period life
 * tables (NCHS/CDC): annual probability of death qx at 65/85 by sex.
 * Overall-health levels scale that hazard; the scale factors are chosen so
 * the three middle levels reproduce approximately the upper-quartile /
 * median / lower-quartile remaining life expectancy by age and sex from
 * Walter & Covinsky, JAMA 2001;285:2750-6 — the standard framework for
 * individualizing prevention decisions in older adults. Verified in
 * medmodel/test/.
 *
 * Condition multipliers are pragmatic mortality hazard ratios from cohort
 * literature (sources inline); they stack multiplicatively on the health
 * level, capped, and are meant to move a patient between quartiles — not to
 * be a validated prognostic index. For real prognostication see ePrognosis.
 */
(function (root, factory) {
    if (typeof module === 'object' && module.exports) {
        module.exports = factory();
    } else {
        root.LifeTables = factory();
    }
})(typeof self !== 'undefined' ? self : this, function () {
    'use strict';

    var HEALTH_LEVELS = [
        {
            id: 'excellent', label: 'Excellent — more robust than most people my age',
            desc: 'No major illness, exercises regularly, brisk gait. Tracks the top-quartile life expectancy for age.',
            mult: 0.55
        },
        {
            id: 'good', label: 'Good — about as healthy as typical for my age',
            desc: 'A well-controlled chronic condition or two, fully independent.',
            mult: 0.75
        },
        {
            id: 'average', label: 'Average — a typical patient in a clinic panel',
            desc: 'Multiple controlled chronic conditions. Tracks median life expectancy for age.',
            mult: 1.0
        },
        {
            id: 'fair', label: 'Fair — more illness or slower than most peers',
            desc: 'Several active conditions, slow gait, some difficulty with stairs or errands.',
            mult: 1.7
        },
        {
            id: 'poor', label: 'Poor — frail or advanced illness',
            desc: 'Needs help with daily activities, weight loss, or advanced organ disease. Tracks bottom-quartile life expectancy.',
            mult: 2.9
        }
    ];

    // Additional mortality-limiting conditions. HRs are adjusted all-cause
    // mortality estimates from cohort studies (rounded); they multiply the
    // health-level hazard. Deliberately short list of high-lethality states.
    var CONDITIONS = [
        { id: 'hf',       label: 'Heart failure (symptomatic)',            hr: 1.8, source: 'all-cause mortality HR ~1.7 vs no HF (HFrEF ~2.4) — KP cohort 2023' },
        { id: 'dementia', label: 'Dementia (moderate–severe)',             hr: 2.5, source: 'meta-analyses: adjusted mortality HR ~2.4–2.7; median survival ~5–6 y from diagnosis' },
        { id: 'copdO2',   label: 'COPD on home oxygen',                    hr: 3.0, source: 'NOTT 1980 / MRC 1981: ~10–15%/y mortality on LTOT ≈ 3–5× age-matched' },
        { id: 'ckd45',    label: 'CKD stage 4–5 (eGFR <30)',               hr: 3.0, source: 'Go NEJM 2004: adjusted death HR 3.2 (eGFR 15–29), 5.9 (<15) vs ≥60' },
        { id: 'cancer',   label: 'Metastatic solid cancer',                hr: 4.0, source: 'SEER distant-stage survival; highly cancer-dependent (est.)' }
    ];

    // When NYHA class is known, it replaces the flat HF multiplier with a
    // graded one (mortality rises steeply with class — registry gradients,
    // e.g., MAGGIC; rounded estimates).
    var NYHA_HF_MULT = { 1: 1.4, 2: 1.6, 3: 2.3, 4: 3.4 };

    var MAX_TOTAL_MULT = 8; // cap on healthMult × condition HRs

    function totalMultiplier(healthId, conditionIds) {
        var level = HEALTH_LEVELS.find(function (h) { return h.id === healthId; }) || HEALTH_LEVELS[2];
        var m = level.mult;
        (conditionIds || []).forEach(function (id) {
            var c = CONDITIONS.find(function (x) { return x.id === id; });
            if (c) m *= c.hr;
        });
        return Math.min(m, MAX_TOTAL_MULT);
    }

    // Reference: remaining life expectancy quartiles by age (years), from
    // Walter & Covinsky JAMA 2001 (based on 1997 US life tables — the
    // framework is the citation; these figure-read values are approximate).
    // Used for display and for calibration tests of the health-level
    // multipliers. q75 = healthiest quartile, q25 = sickest quartile.
    var WALTER_COVINSKY = {
        female: {
            70: { q75: 21.3, med: 15.7, q25: 9.5 },
            75: { q75: 17.0, med: 11.9, q25: 6.8 },
            80: { q75: 13.0, med: 8.6,  q25: 4.6 },
            85: { q75: 9.6,  med: 5.9,  q25: 2.9 },
            90: { q75: 6.8,  med: 3.9,  q25: 1.8 }
        },
        male: {
            70: { q75: 18.0, med: 12.4, q25: 6.7 },
            75: { q75: 14.2, med: 9.3,  q25: 4.9 },
            80: { q75: 10.8, med: 6.7,  q25: 3.3 },
            85: { q75: 7.9,  med: 4.7,  q25: 2.2 },
            90: { q75: 5.8,  med: 3.2,  q25: 1.5 }
        }
    };

    return {
        HEALTH_LEVELS: HEALTH_LEVELS,
        CONDITIONS: CONDITIONS,
        NYHA_HF_MULT: NYHA_HF_MULT,
        MAX_TOTAL_MULT: MAX_TOTAL_MULT,
        totalMultiplier: totalMultiplier,
        WALTER_COVINSKY: WALTER_COVINSKY
    };
});
