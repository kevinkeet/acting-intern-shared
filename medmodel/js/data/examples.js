/**
 * MedBenefit — example patients for demonstration.
 *
 * Four phenotypes, all old and complex in different ways, spanning the
 * goals-of-care spectrum (Proactive → Comfort-Focused) and different social
 * situations (independence, engagement, cost strain and isolation,
 * supported frailty). Each uses the same JSON schema as the EMR
 * quick-import, plus goals/preferences fields, so loading one exercises the
 * exact same pathway as a real chart import.
 */
(function (root, factory) {
    if (typeof module === 'object' && module.exports) module.exports = factory();
    else root.ExamplePatients = factory();
})(typeof self !== 'undefined' ? self : this, function () {
    'use strict';

    return [
        {
            id: 'eleanor',
            name: 'Eleanor, 81',
            blurb: 'Robust and independent — wants everything that works',
            story: 'Eleanor Vance, 81 — walks two miles daily, gardens, runs her book club. AF and osteoporosis on treatment (alendronate since 2019), blood pressure controlled. She manages a pill organizer flawlessly, has good insurance, and tells you plainly: "I plan to be at my great-granddaughter\'s graduation."',
            data: {
                demographics: { age: 81, sex: 'female', race: 'white' },
                vitals: { systolic_bp: 128 },
                labs: { total_cholesterol: 195, hdl: 62, creatinine: 0.9 },
                cardiac: { afib: true },
                diabetes: { status: 'none' },
                other_conditions: { hypertension_treated: true, osteoporosis: true },
                overall_health: 'excellent',
                adherence: 'high',
                goals_of_care: 4,
                preferences: { pill_burden: 'high', cost_sensitivity: 'low', monitoring_tolerance: 'high' },
                time_horizon_years: 10,
                bisphosphonate_years: 6,
                current_medications: ['apixaban', 'atorvastatin', 'amlodipine', 'alendronate']
            }
        },
        {
            id: 'marisol',
            name: 'Marisol, 76',
            blurb: 'HFrEF + AF + diabetes — engaged, adherent, balanced goals',
            story: 'Marisol Ortega, 76 — retired ICU nurse with an EF of 28% (NYHA III), AF on warfarin, a remote MI, type 2 diabetes, and CKD 3. She tracks her own weights, knows her meds cold, and wants "reasonable prevention, but I\'ve seen what over-treatment looks like." Her regimen has real gaps her engagement deserves to have filled.',
            data: {
                demographics: { age: 76, sex: 'female', race: 'hispanic' },
                vitals: { systolic_bp: 118 },
                labs: { total_cholesterol: 168, hdl: 44, creatinine: 1.5, a1c: 7.6 },
                cardiac: { ejection_fraction: 28, nyha_class: 3, afib: true, prior_mi: true, heart_failure: true },
                diabetes: { status: 'type2' },
                other_conditions: { hypertension_treated: true },
                overall_health: 'fair',
                adherence: 'high',
                goals_of_care: 3,
                preferences: { pill_burden: 'moderate', cost_sensitivity: 'moderate', monitoring_tolerance: 'high' },
                time_horizon_years: 5,
                current_medications: ['metoprolol', 'lisinopril', 'furosemide', 'warfarin', 'metformin', 'atorvastatin']
            }
        },
        {
            id: 'frank',
            name: 'Frank, 79',
            blurb: 'Lives alone, cost-stretched, misses doses — high-value only',
            story: 'Frank Kowalski, 79 — widowed last year, lives alone on a fixed income, still smokes, drinks most evenings. COPD, diabetes, AF, and a prior stroke. His pharmacy record shows refill gaps everywhere; he takes warfarin "most days" plus an aspirin a neighbor recommended. He\'ll consider medicines that clearly matter — "but I\'m not eating pills instead of dinner."',
            data: {
                demographics: { age: 79, sex: 'male', race: 'white' },
                vitals: { systolic_bp: 152 },
                labs: { total_cholesterol: 210, hdl: 38, creatinine: 1.3, a1c: 8.2 },
                cardiac: { afib: true, prior_stroke_tia: true },
                diabetes: { status: 'type2' },
                bleeding_risks: { heavy_alcohol: true, on_antiplatelet: true },
                other_conditions: { hypertension_treated: true, current_smoker: true, copd: true },
                overall_health: 'fair',
                adherence: 'low',
                goals_of_care: 2,
                preferences: { pill_burden: 'low', cost_sensitivity: 'high', monitoring_tolerance: 'low' },
                time_horizon_years: 5,
                current_medications: ['warfarin', 'aspirin', 'metformin', 'amlodipine']
            }
        },
        {
            id: 'walter',
            name: 'Walter, 87',
            blurb: 'Frail, dementia, assisted living — comfort comes first',
            story: 'Walter Briggs, 87 — moderate dementia, two falls this year, now in assisted living where staff give his twelve daily doses reliably (adherence is not the problem — the medication list is). CKD 4, diabetes on glipizide, gabapentin for "restless legs," a statin since 2009. His daughter asks the right question: "What is all this actually doing for him now?"',
            data: {
                demographics: { age: 87, sex: 'male', race: 'white' },
                vitals: { systolic_bp: 138 },
                labs: { total_cholesterol: 172, hdl: 48, creatinine: 2.2, a1c: 7.8 },
                cardiac: {},
                diabetes: { status: 'type2' },
                bleeding_risks: { fall_risk: true },
                other_conditions: { hypertension_treated: true, dementia: true, osteoporosis: true, gout: true, neuropathy: true },
                overall_health: 'poor',
                adherence: 'high',
                goals_of_care: 1,
                preferences: { pill_burden: 'low', cost_sensitivity: 'moderate', monitoring_tolerance: 'low' },
                time_horizon_years: 2,
                current_medications: ['glipizide', 'gabapentin', 'atorvastatin', 'lisinopril', 'omeprazole', 'allopurinol']
            }
        }
    ];
});
