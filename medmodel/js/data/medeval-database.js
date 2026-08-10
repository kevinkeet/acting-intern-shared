/**
 * medeval database — imported from kevinkeet/medeval (meds.kevinkeet.com),
 * the companion medication benefit calculator. This file is the upstream
 * curated 60-medication database (NNT/NNH per indication, purpose taxonomy,
 * burden, cost, monitoring, contraindications), kept byte-compatible with
 * upstream so improvements can be synced in either direction.
 *
 * Upstream: https://github.com/kevinkeet/medeval (medications-database.js)
 * Used here through the lift service (js/services/lift.js), which converts
 * entries into MedModel's competing-hazards engine format.
 */
/**
 * Medications Database - Evidence-Based NNT and NNH Values
 *
 * Each medication has:
 * - id: unique identifier
 * - name: generic name
 * - brandNames: common brand names
 * - class: medication class
 * - purpose: 'preventive' | 'disease_modifying' | 'symptomatic' | 'replacement'
 *     - preventive: Prevents future events/disease (statins for primary prevention, bisphosphonates)
 *     - disease_modifying: Treats underlying disease and alters its course (HF meds, SGLT2i for CKD)
 *     - symptomatic: Relieves symptoms without changing disease course (pain meds, PPIs, loop diuretics)
 *     - replacement: Replaces missing hormones/nutrients (levothyroxine, vitamin D)
 * - indications: array of conditions this treats/prevents
 * - benefits: object with indication -> outcome -> { rrr, nnt, timeframe, endpoint, quality, source }
 * - harms: ONLY serious adverse events with NNH from clinical trials
 *          Minor side effects (fatigue, nausea, etc.) are now part of burden
 * - burden: 'low' | 'moderate' | 'high' - includes pill burden + minor side effects
 * - burdenDetails: description of what makes it burdensome (including minor side effects)
 * - annualCost: estimated annual cost in USD
 * - monitoring: what monitoring is required
 * - contraindications: conditions where this shouldn't be used
 */

const MEDICATIONS_DATABASE = {
    // ===== 1. BETA-BLOCKER FOR HEART FAILURE - CARVEDILOL =====
    "carvedilol": {
        id: "carvedilol",
        name: "Carvedilol",
        brandNames: ["Coreg"],
        class: "Beta-blocker",
        purpose: "disease_modifying", // Improves survival and alters HF disease course
        indications: ["heart_failure", "post_mi", "hypertension"],
        benefits: {
            heart_failure: {
                mortality: { rrr: 0.35, nnt: 9, timeframe: 3, endpoint: "all-cause mortality", quality: "hard", source: "COPERNICUS" },
                hospitalization: { rrr: 0.24, nnt: 14, timeframe: 1, endpoint: "HF hospitalization", quality: "hard", source: "COPERNICUS" }
            },
            post_mi: {
                mortality: { rrr: 0.23, nnt: 42, timeframe: 2, endpoint: "all-cause mortality", quality: "hard", source: "CAPRICORN" }
            }
        },
        harms: {
            // Serious harms only - minor symptoms in burden
            // Beta-blockers in HF: serious bradycardia/hypotension requiring discontinuation is rare
            // No robust NNH data for serious harms - benefits vastly outweigh
        },
        burden: "moderate",
        burdenDetails: "Twice daily dosing. Common: fatigue (15%), dizziness (10%), bradycardia (5%). Requires slow uptitration over weeks.",
        annualCost: 48,
        monitoring: "Heart rate and blood pressure monitoring during uptitration",
        contraindications: ["severe_bradycardia", "heart_block", "severe_asthma", "decompensated_hf"]
    },

    // ===== 2. SGLT2 INHIBITOR - EMPAGLIFLOZIN =====
    "empagliflozin": {
        id: "empagliflozin",
        name: "Empagliflozin",
        brandNames: ["Jardiance"],
        class: "SGLT2 Inhibitor",
        purpose: "disease_modifying", // Modifies HF, CKD, and diabetes disease progression
        indications: ["heart_failure", "diabetes", "ckd"],
        benefits: {
            heart_failure: {
                cv_death_hf_hosp: { rrr: 0.25, nnt: 19, timeframe: 1.3, endpoint: "CV death or HF hospitalization", quality: "hard", source: "EMPEROR-Reduced" },
                mortality: { rrr: 0.17, nnt: 45, timeframe: 1.3, endpoint: "all-cause mortality", quality: "hard", source: "EMPEROR-Reduced" }
            },
            diabetes_with_cvd: {
                cv_mortality: { rrr: 0.38, nnt: 39, timeframe: 3.1, endpoint: "CV mortality", quality: "hard", source: "EMPA-REG OUTCOME" },
                mace: { rrr: 0.14, nnt: 63, timeframe: 3.1, endpoint: "MACE", quality: "composite", source: "EMPA-REG OUTCOME" }
            },
            ckd: {
                kidney_progression: { rrr: 0.28, nnt: 22, timeframe: 2, endpoint: "40% eGFR decline or ESKD", quality: "hard", source: "EMPA-KIDNEY" }
            }
        },
        harms: {
            // NNH from EMPA-REG: genital infections NNH 22, but these are mild/moderate
            // DKA extremely rare (~0.1%), NNH > 1000
            dka: { nnh: 1000, timeframe: 3, source: "EMPA-REG OUTCOME" }
        },
        burden: "low",
        burdenDetails: "Once daily pill. Common: genital yeast infections (6%), increased urination. No routine monitoring needed.",
        annualCost: 6000,
        monitoring: "Renal function at baseline, periodic monitoring",
        contraindications: ["egfr_below_20", "dialysis", "type1_diabetes"]
    },

    // ===== 3. MRA FOR HEART FAILURE - SPIRONOLACTONE =====
    "spironolactone": {
        id: "spironolactone",
        name: "Spironolactone",
        brandNames: ["Aldactone"],
        class: "Mineralocorticoid Receptor Antagonist (MRA)",
        purpose: "disease_modifying", // Improves HF mortality and alters disease course
        indications: ["heart_failure", "resistant_hypertension"],
        benefits: {
            heart_failure: {
                mortality: { rrr: 0.30, nnt: 6, timeframe: 2, endpoint: "all-cause mortality", quality: "hard", source: "RALES" },
                hospitalization: { rrr: 0.35, nnt: 8, timeframe: 2, endpoint: "HF hospitalization", quality: "hard", source: "RALES" }
            }
        },
        harms: {
            // MRA meta-analysis: hyperkalemia (K>5.5) NNH 12.7
            hyperkalemia_severe: { nnh: 13, timeframe: 2, source: "Meta-analysis 2025" }
        },
        burden: "moderate",
        burdenDetails: "Once daily. Common: gynecomastia in men (10%), breast tenderness. Requires periodic potassium and creatinine monitoring.",
        annualCost: 36,
        monitoring: "Potassium and creatinine at 1 week, 1 month, then every 3-6 months",
        contraindications: ["hyperkalemia", "severe_ckd", "addisons"]
    },

    // ===== 4. STATIN - ATORVASTATIN =====
    "atorvastatin": {
        id: "atorvastatin",
        name: "Atorvastatin",
        brandNames: ["Lipitor"],
        class: "Statin",
        purpose: "preventive", // Prevents CV events
        indications: ["ascvd_prevention", "post_mi", "diabetes_cv_risk"],
        benefits: {
            secondary_prevention: {
                mace: { rrr: 0.25, nnt: 25, timeframe: 5, endpoint: "major CV events", quality: "composite", source: "TNT, PROVE-IT" },
                mortality: { rrr: 0.15, nnt: 50, timeframe: 5, endpoint: "all-cause mortality", quality: "hard", source: "CTT meta-analysis" },
                stroke: { rrr: 0.20, nnt: 83, timeframe: 5, endpoint: "stroke", quality: "hard", source: "CTT meta-analysis" }
            },
            primary_prevention_high_risk: {
                mace: { rrr: 0.25, nnt: 50, timeframe: 5, endpoint: "major CV events", quality: "composite", source: "CTT meta-analysis" },
                mortality: { rrr: 0.10, nnt: 100, timeframe: 5, endpoint: "all-cause mortality", quality: "hard", source: "CTT meta-analysis" }
            }
        },
        harms: {
            // Statin NNH for new-onset diabetes: 255 over 4 years
            new_onset_diabetes: { nnh: 255, timeframe: 4, source: "Meta-analysis" },
            // Rhabdomyolysis extremely rare: NNH > 10,000
            rhabdomyolysis: { nnh: 10000, timeframe: 5, source: "CTT meta-analysis" }
        },
        burden: "low",
        burdenDetails: "Once daily pill. Myalgia reported in 5-10% (mostly nocebo effect per RCTs). Minimal monitoring needed.",
        annualCost: 24,
        monitoring: "Lipid panel at baseline, optional liver function tests",
        contraindications: ["active_liver_disease", "pregnancy"]
    },

    // ===== 5. DOAC - APIXABAN =====
    "apixaban": {
        id: "apixaban",
        name: "Apixaban",
        brandNames: ["Eliquis"],
        class: "Direct Oral Anticoagulant (DOAC)",
        purpose: "preventive", // Prevents stroke in AFib, prevents VTE recurrence
        indications: ["afib_stroke_prevention", "vte_treatment"],
        benefits: {
            afib_stroke_prevention: {
                stroke: { rrr: 0.21, nnt: null, timeframe: 1.8, endpoint: "stroke or systemic embolism", quality: "hard", source: "ARISTOTLE" }
                // NNT depends on CHA2DS2-VASc; use RRR with baseline risk
            }
        },
        harms: {
            // ARISTOTLE: Apixaban REDUCES bleeding vs warfarin (NNT 79 for major bleed prevention)
            // vs placebo: major bleeding ~2%/year
            major_bleeding: { nnh: 50, timeframe: 1, source: "ARISTOTLE (absolute rate)" },
            intracranial_bleeding: { nnh: 333, timeframe: 1, source: "ARISTOTLE" }
        },
        burden: "low",
        burdenDetails: "Twice daily pill, no dietary restrictions, no routine INR monitoring (unlike warfarin).",
        annualCost: 5500,
        monitoring: "Renal function annually",
        contraindications: ["mechanical_valve", "severe_bleeding", "severe_liver_disease"]
    },

    // ===== 6. METFORMIN FOR DIABETES =====
    "metformin": {
        id: "metformin",
        name: "Metformin",
        brandNames: ["Glucophage"],
        class: "Biguanide",
        purpose: "disease_modifying", // Reduces CV mortality in diabetes, modifies disease course
        indications: ["diabetes"],
        benefits: {
            diabetes_cv: {
                mortality: { rrr: 0.36, nnt: 14, timeframe: 10, endpoint: "diabetes-related death", quality: "hard", source: "UKPDS" },
                mi: { rrr: 0.39, nnt: 20, timeframe: 10, endpoint: "MI", quality: "hard", source: "UKPDS" }
            }
        },
        harms: {
            // Lactic acidosis extremely rare: ~3 per 100,000 patient-years
            // No meaningful NNH for serious events
        },
        burden: "moderate",
        burdenDetails: "Usually twice daily. Very common: GI upset (25%) especially when starting - usually resolves. B12 deficiency with long-term use.",
        annualCost: 48,
        monitoring: "Annual B12 if long-term use, renal function",
        contraindications: ["egfr_below_30", "acute_kidney_injury", "metabolic_acidosis"]
    },

    // ===== 7. SULFONYLUREA - GLIPIZIDE =====
    "glipizide": {
        id: "glipizide",
        name: "Glipizide",
        brandNames: ["Glucotrol"],
        class: "Sulfonylurea",
        purpose: "symptomatic", // Lowers glucose but no CV benefit, treats symptom of hyperglycemia
        indications: ["diabetes"],
        benefits: {
            diabetes_glycemic: {
                a1c_reduction: { absolute: 1.0, endpoint: "A1C reduction %", quality: "surrogate" }
            },
            diabetes_cv: {
                // No CV benefit demonstrated
                mortality: { rrr: 0.0, nnt: null, timeframe: 5, endpoint: "CV mortality", quality: "hard" }
            }
        },
        harms: {
            // Sulfonylureas: severe hypoglycemia in 1-2% per year in elderly
            // NNH for severe hypoglycemia varies by age
            severe_hypoglycemia: { nnh: 50, timeframe: 1, source: "Meta-analysis, elderly population" },
            severe_hypoglycemia_elderly: { nnh: 25, timeframe: 1, source: "Beers Criteria, observational data" }
        },
        burden: "moderate",
        burdenDetails: "Once or twice daily. Common: weight gain (3-5 kg), hypoglycemia risk - must eat regular meals.",
        annualCost: 36,
        monitoring: "Blood glucose monitoring, A1C every 3-6 months",
        contraindications: ["type1_diabetes", "dka", "severe_liver_disease"],
        beers_criteria: {
            listed: true,
            concern: "Higher risk of severe, prolonged hypoglycemia in older adults",
            recommendation: "Avoid in older adults; short-acting sulfonylureas like glipizide preferred over long-acting if used",
            strength: "strong",
            quality_of_evidence: "high"
        },
        elderly_caution: {
            hypoglycemia_risk: true,
            avoid_if_frail: true,
            avoid_if_cognitive_impairment: true,
            prefer_alternatives: ["metformin", "SGLT2i", "GLP1a"]
        }
    },

    // ===== 8. ASPIRIN FOR PRIMARY PREVENTION =====
    "aspirin": {
        id: "aspirin",
        name: "Aspirin",
        brandNames: ["Bayer", "Ecotrin"],
        class: "Antiplatelet",
        purpose: "preventive", // Prevents CV events
        indications: ["secondary_cv_prevention", "primary_cv_prevention"],
        benefits: {
            secondary_prevention: {
                mace: { rrr: 0.20, nnt: 50, timeframe: 2, endpoint: "major CV events", quality: "composite", source: "ATT meta-analysis" },
                stroke_recurrence: { rrr: 0.22, nnt: 77, timeframe: 2, endpoint: "recurrent stroke", quality: "hard", source: "ATT meta-analysis" }
            },
            primary_prevention: {
                mace: { rrr: 0.11, nnt: 250, timeframe: 5, endpoint: "major CV events", quality: "composite", source: "ASPREE, ARRIVE" },
                mortality: { rrr: 0.0, nnt: null, timeframe: 5, endpoint: "all-cause mortality", quality: "hard" }
            }
        },
        harms: {
            // Primary prevention: NNH 222 for major bleeding
            major_bleeding: { nnh: 222, timeframe: 5, source: "JAMA meta-analysis 2019" },
            intracranial_bleeding: { nnh: 1000, timeframe: 5, source: "JAMA meta-analysis" },
            // Age-dependent GI bleeding: NNH 202 in age 75-84
            gi_bleeding: { nnh: 400, timeframe: 1, source: "USPSTF analysis, age-adjusted" }
        },
        burden: "low",
        burdenDetails: "Once daily, no monitoring needed. May cause mild GI upset.",
        annualCost: 15,
        monitoring: "None routine, watch for bleeding symptoms",
        contraindications: ["active_bleeding", "severe_liver_disease", "aspirin_allergy"]
    },

    // ===== 9. ARNI - SACUBITRIL/VALSARTAN =====
    "sacubitril_valsartan": {
        id: "sacubitril_valsartan",
        name: "Sacubitril/Valsartan",
        brandNames: ["Entresto"],
        class: "Angiotensin Receptor-Neprilysin Inhibitor (ARNI)",
        purpose: "disease_modifying", // Improves HF survival and alters disease course
        indications: ["heart_failure"],
        benefits: {
            heart_failure: {
                cv_death_hf_hosp: { rrr: 0.20, nnt: 21, timeframe: 2.3, endpoint: "CV death or HF hospitalization", quality: "hard", source: "PARADIGM-HF" },
                mortality: { rrr: 0.16, nnt: 36, timeframe: 2.3, endpoint: "all-cause mortality", quality: "hard", source: "PARADIGM-HF" }
            }
        },
        harms: {
            // PARADIGM-HF: hypotension more common but rarely serious
            // Angioedema rare: 0.45% vs 0.24% with enalapril - NNH ~500
            angioedema: { nnh: 500, timeframe: 2.3, source: "PARADIGM-HF" }
        },
        burden: "moderate",
        burdenDetails: "Twice daily. Common: hypotension (14%), dizziness. Must stop ACEi 36h before starting. Requires titration.",
        annualCost: 6500,
        monitoring: "Blood pressure, potassium, creatinine during titration",
        contraindications: ["angioedema_history", "concurrent_acei", "pregnancy", "severe_liver_disease"]
    },

    // ===== 10. WARFARIN =====
    "warfarin": {
        id: "warfarin",
        name: "Warfarin",
        brandNames: ["Coumadin", "Jantoven"],
        class: "Vitamin K Antagonist",
        purpose: "preventive", // Prevents stroke and thromboembolism
        indications: ["afib_stroke_prevention", "mechanical_valve", "vte_treatment"],
        benefits: {
            afib_stroke_prevention: {
                stroke: { rrr: 0.64, nnt: null, timeframe: 1, endpoint: "stroke or systemic embolism", quality: "hard", source: "Meta-analysis" }
            },
            mechanical_valve: {
                thromboembolism: { rrr: 0.75, nnt: 10, timeframe: 1, endpoint: "valve thrombosis/embolism", quality: "hard" }
            }
        },
        harms: {
            // Warfarin: major bleeding 3%/year, ICH 0.5-0.8%/year
            major_bleeding: { nnh: 33, timeframe: 1, source: "SPAF studies" },
            intracranial_bleeding: { nnh: 125, timeframe: 1, source: "SPAF, RE-LY comparator" }
        },
        burden: "high",
        burdenDetails: "Requires frequent INR monitoring (weekly then monthly), dietary restrictions (vitamin K), many drug interactions.",
        annualCost: 60,
        monitoring: "INR weekly initially, then monthly when stable; target TTR >65%",
        contraindications: ["active_bleeding", "pregnancy", "severe_liver_disease", "noncompliance"]
    },

    // ===== 11. ACE INHIBITOR - LISINOPRIL =====
    "lisinopril": {
        id: "lisinopril",
        name: "Lisinopril",
        brandNames: ["Zestril", "Prinivil"],
        class: "ACE Inhibitor",
        purpose: "disease_modifying", // Modifies HF, nephropathy, and HTN disease course
        indications: ["heart_failure", "hypertension", "post_mi", "diabetic_nephropathy"],
        benefits: {
            heart_failure: {
                mortality: { rrr: 0.16, nnt: 22, timeframe: 3.5, endpoint: "all-cause mortality", quality: "hard", source: "SOLVD" },
                hospitalization: { rrr: 0.26, nnt: 15, timeframe: 3.5, endpoint: "HF hospitalization", quality: "hard", source: "SOLVD" }
            },
            post_mi: {
                mortality: { rrr: 0.12, nnt: 50, timeframe: 1, endpoint: "all-cause mortality", quality: "hard", source: "GISSI-3" }
            },
            hypertension: {
                stroke: { rrr: 0.30, nnt: 67, timeframe: 5, endpoint: "stroke", quality: "hard", source: "Meta-analysis" }
            }
        },
        harms: {
            // ACEi angioedema: NNH ~500 (ONTARGET)
            angioedema: { nnh: 500, timeframe: 5, source: "ONTARGET" },
            // Hyperkalemia requiring hospitalization: uncommon
            hyperkalemia_severe: { nnh: 100, timeframe: 1, source: "Clinical estimates" }
        },
        burden: "low",
        burdenDetails: "Once daily. Common: dry cough (10%), dizziness. Initial monitoring of potassium and creatinine.",
        annualCost: 24,
        monitoring: "Potassium, creatinine at baseline, 1-2 weeks after starting",
        contraindications: ["angioedema_history", "bilateral_renal_artery_stenosis", "pregnancy"]
    },

    // ===== 12. ACE INHIBITOR - ENALAPRIL =====
    "enalapril": {
        id: "enalapril",
        name: "Enalapril",
        brandNames: ["Vasotec"],
        class: "ACE Inhibitor",
        purpose: "disease_modifying", // Modifies HF disease course
        indications: ["heart_failure", "hypertension", "post_mi"],
        benefits: {
            heart_failure: {
                mortality: { rrr: 0.16, nnt: 22, timeframe: 3.5, endpoint: "all-cause mortality", quality: "hard", source: "SOLVD" },
                hospitalization: { rrr: 0.26, nnt: 15, timeframe: 3.5, endpoint: "HF hospitalization", quality: "hard", source: "SOLVD" }
            },
            heart_failure_severe: {
                mortality: { rrr: 0.40, nnt: 6, timeframe: 0.5, endpoint: "all-cause mortality", quality: "hard", source: "CONSENSUS" }
            }
        },
        harms: {
            angioedema: { nnh: 500, timeframe: 5, source: "ONTARGET" },
            hyperkalemia_severe: { nnh: 100, timeframe: 1, source: "Clinical estimates" }
        },
        burden: "moderate",
        burdenDetails: "Twice daily dosing. Common: dry cough (10%), hypotension (5%).",
        annualCost: 36,
        monitoring: "Potassium, creatinine at baseline, 1-2 weeks after starting",
        contraindications: ["angioedema_history", "bilateral_renal_artery_stenosis", "pregnancy"]
    },

    // ===== 13. ARB - LOSARTAN =====
    "losartan": {
        id: "losartan",
        name: "Losartan",
        brandNames: ["Cozaar"],
        class: "Angiotensin Receptor Blocker (ARB)",
        purpose: "disease_modifying", // Modifies nephropathy and HTN disease course
        indications: ["hypertension", "diabetic_nephropathy", "heart_failure"],
        benefits: {
            hypertension: {
                stroke: { rrr: 0.25, nnt: 67, timeframe: 5, endpoint: "stroke", quality: "hard", source: "LIFE" }
            },
            diabetic_nephropathy: {
                esrd: { rrr: 0.28, nnt: 13, timeframe: 3.4, endpoint: "ESRD", quality: "hard", source: "RENAAL" },
                doubling_creatinine: { rrr: 0.25, nnt: 11, timeframe: 3.4, endpoint: "doubling of creatinine", quality: "hard", source: "RENAAL" }
            }
        },
        harms: {
            // ARBs have lower angioedema risk than ACEi
            angioedema: { nnh: 2000, timeframe: 5, source: "Meta-analysis" },
            hyperkalemia_severe: { nnh: 100, timeframe: 1, source: "Clinical estimates" }
        },
        burden: "low",
        burdenDetails: "Once or twice daily. Well tolerated - no cough (unlike ACEi).",
        annualCost: 24,
        monitoring: "Potassium, creatinine periodically",
        contraindications: ["pregnancy", "bilateral_renal_artery_stenosis"]
    },

    // ===== 14. ARB - VALSARTAN =====
    "valsartan": {
        id: "valsartan",
        name: "Valsartan",
        brandNames: ["Diovan"],
        class: "Angiotensin Receptor Blocker (ARB)",
        purpose: "disease_modifying", // Modifies HF disease course
        indications: ["hypertension", "heart_failure", "post_mi"],
        benefits: {
            heart_failure: {
                mortality: { rrr: 0.13, nnt: 30, timeframe: 2, endpoint: "all-cause mortality", quality: "hard", source: "Val-HeFT" },
                hospitalization: { rrr: 0.24, nnt: 15, timeframe: 2, endpoint: "HF hospitalization", quality: "hard", source: "Val-HeFT" }
            },
            post_mi: {
                mortality: { rrr: 0.13, nnt: 45, timeframe: 2.1, endpoint: "all-cause mortality", quality: "hard", source: "VALIANT" }
            }
        },
        harms: {
            angioedema: { nnh: 2000, timeframe: 5, source: "Meta-analysis" },
            hyperkalemia_severe: { nnh: 100, timeframe: 1, source: "Clinical estimates" }
        },
        burden: "low",
        burdenDetails: "Once or twice daily. Well tolerated.",
        annualCost: 36,
        monitoring: "Potassium, creatinine periodically",
        contraindications: ["pregnancy", "bilateral_renal_artery_stenosis"]
    },

    // ===== 15. BETA-BLOCKER - METOPROLOL SUCCINATE =====
    "metoprolol": {
        id: "metoprolol",
        name: "Metoprolol Succinate",
        brandNames: ["Toprol-XL"],
        class: "Beta-blocker",
        purpose: "disease_modifying", // Improves HF survival and alters disease course
        indications: ["heart_failure", "hypertension", "post_mi"],
        benefits: {
            heart_failure: {
                mortality: { rrr: 0.34, nnt: 27, timeframe: 1, endpoint: "all-cause mortality", quality: "hard", source: "MERIT-HF" },
                hospitalization: { rrr: 0.18, nnt: 19, timeframe: 1, endpoint: "HF hospitalization", quality: "hard", source: "MERIT-HF" }
            },
            post_mi: {
                mortality: { rrr: 0.20, nnt: 50, timeframe: 2, endpoint: "all-cause mortality", quality: "hard", source: "MIAMI" }
            }
        },
        harms: {
            // Beta-blockers in HF trials: no robust NNH for serious events
        },
        burden: "low",
        burdenDetails: "Once daily (extended release). Common: fatigue (12%), bradycardia. Requires uptitration.",
        annualCost: 48,
        monitoring: "Heart rate and blood pressure during uptitration",
        contraindications: ["severe_bradycardia", "heart_block", "decompensated_hf", "severe_asthma"]
    },

    // ===== 16. BETA-BLOCKER - BISOPROLOL =====
    "bisoprolol": {
        id: "bisoprolol",
        name: "Bisoprolol",
        brandNames: ["Zebeta"],
        class: "Beta-blocker",
        purpose: "disease_modifying", // Improves HF survival
        indications: ["heart_failure", "hypertension"],
        benefits: {
            heart_failure: {
                mortality: { rrr: 0.34, nnt: 23, timeframe: 1.3, endpoint: "all-cause mortality", quality: "hard", source: "CIBIS-II" },
                hospitalization: { rrr: 0.20, nnt: 18, timeframe: 1.3, endpoint: "HF hospitalization", quality: "hard", source: "CIBIS-II" }
            }
        },
        harms: {
            // No robust NNH data - benefits vastly outweigh
        },
        burden: "low",
        burdenDetails: "Once daily. Common: fatigue (10%), bradycardia. More beta-1 selective - may be better in COPD.",
        annualCost: 36,
        monitoring: "Heart rate and blood pressure",
        contraindications: ["severe_bradycardia", "heart_block", "decompensated_hf"]
    },

    // ===== 17. DOAC - RIVAROXABAN =====
    "rivaroxaban": {
        id: "rivaroxaban",
        name: "Rivaroxaban",
        brandNames: ["Xarelto"],
        class: "Direct Oral Anticoagulant (DOAC)",
        purpose: "preventive", // Prevents stroke and VTE
        indications: ["afib_stroke_prevention", "vte_treatment", "secondary_prevention"],
        benefits: {
            afib_stroke_prevention: {
                stroke: { rrr: 0.21, nnt: null, timeframe: 1.9, endpoint: "stroke or systemic embolism", quality: "hard", source: "ROCKET-AF" }
            },
            secondary_prevention: {
                mace: { rrr: 0.24, nnt: 63, timeframe: 2, endpoint: "CV death, MI, stroke", quality: "composite", source: "COMPASS" }
            }
        },
        harms: {
            // ROCKET-AF: GI bleeding higher, NNH ~99 vs warfarin
            major_bleeding: { nnh: 50, timeframe: 1, source: "ROCKET-AF (absolute rate)" },
            gi_bleeding: { nnh: 99, timeframe: 1.9, source: "ROCKET-AF vs warfarin" },
            intracranial_bleeding: { nnh: 305, timeframe: 1.9, source: "ROCKET-AF" }
        },
        burden: "low",
        burdenDetails: "Once daily with food (for AF). No routine INR monitoring.",
        annualCost: 5500,
        monitoring: "Renal function annually",
        contraindications: ["mechanical_valve", "active_bleeding", "severe_liver_disease"]
    },

    // ===== 18. DOAC - DABIGATRAN =====
    "dabigatran": {
        id: "dabigatran",
        name: "Dabigatran",
        brandNames: ["Pradaxa"],
        class: "Direct Oral Anticoagulant (DOAC)",
        purpose: "preventive", // Prevents stroke and VTE
        indications: ["afib_stroke_prevention", "vte_treatment"],
        benefits: {
            afib_stroke_prevention: {
                stroke: { rrr: 0.34, nnt: null, timeframe: 2, endpoint: "stroke or systemic embolism", quality: "hard", source: "RE-LY (150mg)" }
            }
        },
        harms: {
            // RE-LY 150mg: GI bleeding higher, NNH ~67
            major_bleeding: { nnh: 50, timeframe: 1, source: "RE-LY (absolute rate)" },
            gi_bleeding: { nnh: 67, timeframe: 2, source: "RE-LY vs warfarin" },
            intracranial_bleeding: { nnh: 222, timeframe: 2, source: "RE-LY" }
        },
        burden: "low",
        burdenDetails: "Twice daily. Common: dyspepsia (10%). Has reversal agent (idarucizumab).",
        annualCost: 5000,
        monitoring: "Renal function annually",
        contraindications: ["mechanical_valve", "active_bleeding", "severe_ckd"]
    },

    // ===== 19. DOAC - EDOXABAN =====
    "edoxaban": {
        id: "edoxaban",
        name: "Edoxaban",
        brandNames: ["Savaysa"],
        class: "Direct Oral Anticoagulant (DOAC)",
        purpose: "preventive", // Prevents stroke and VTE
        indications: ["afib_stroke_prevention", "vte_treatment"],
        benefits: {
            afib_stroke_prevention: {
                stroke: { rrr: 0.21, nnt: null, timeframe: 2.8, endpoint: "stroke or systemic embolism", quality: "hard", source: "ENGAGE AF-TIMI 48" }
            }
        },
        harms: {
            // ENGAGE: lowest bleeding of DOACs
            major_bleeding: { nnh: 50, timeframe: 1, source: "ENGAGE (absolute rate)" },
            intracranial_bleeding: { nnh: 500, timeframe: 2.8, source: "ENGAGE AF-TIMI 48" }
        },
        burden: "low",
        burdenDetails: "Once daily. Well tolerated.",
        annualCost: 4500,
        monitoring: "Renal function annually",
        contraindications: ["mechanical_valve", "active_bleeding", "high_creatinine_clearance"]
    },

    // ===== 20. SGLT2 INHIBITOR - DAPAGLIFLOZIN =====
    "dapagliflozin": {
        id: "dapagliflozin",
        name: "Dapagliflozin",
        brandNames: ["Farxiga"],
        class: "SGLT2 Inhibitor",
        purpose: "disease_modifying", // Modifies HF, CKD, and diabetes disease progression
        indications: ["heart_failure", "diabetes", "ckd"],
        benefits: {
            heart_failure: {
                cv_death_hf_hosp: { rrr: 0.26, nnt: 17, timeframe: 1.5, endpoint: "CV death or HF hospitalization", quality: "hard", source: "DAPA-HF" },
                mortality: { rrr: 0.17, nnt: 45, timeframe: 1.5, endpoint: "all-cause mortality", quality: "hard", source: "DAPA-HF" }
            },
            ckd: {
                kidney_progression: { rrr: 0.39, nnt: 14, timeframe: 2.4, endpoint: "sustained eGFR decline, ESKD", quality: "hard", source: "DAPA-CKD" }
            }
        },
        harms: {
            dka: { nnh: 1000, timeframe: 2, source: "DAPA-HF, DAPA-CKD" }
        },
        burden: "low",
        burdenDetails: "Once daily. Common: genital infections (5%), increased urination. No routine monitoring.",
        annualCost: 6000,
        monitoring: "Renal function periodically",
        contraindications: ["dialysis", "type1_diabetes"]
    },

    // ===== 21. GLP-1 AGONIST - LIRAGLUTIDE =====
    "liraglutide": {
        id: "liraglutide",
        name: "Liraglutide",
        brandNames: ["Victoza", "Saxenda"],
        class: "GLP-1 Receptor Agonist",
        purpose: "disease_modifying", // Reduces CV mortality in diabetes
        indications: ["diabetes"],
        benefits: {
            diabetes_cv: {
                mace: { rrr: 0.13, nnt: 53, timeframe: 3.8, endpoint: "MACE", quality: "composite", source: "LEADER" },
                cv_mortality: { rrr: 0.22, nnt: 67, timeframe: 3.8, endpoint: "CV mortality", quality: "hard", source: "LEADER" },
                mortality: { rrr: 0.15, nnt: 67, timeframe: 3.8, endpoint: "all-cause mortality", quality: "hard", source: "LEADER" }
            }
        },
        harms: {
            // LEADER: no increased pancreatitis (0.4% vs 0.5% placebo)
            pancreatitis: { nnh: 1000, timeframe: 3.8, source: "LEADER (no significant increase)" }
        },
        burden: "moderate",
        burdenDetails: "Daily subcutaneous injection. Very common: nausea (20%), vomiting (8%), diarrhea (10%) - usually improves. Requires dose titration.",
        annualCost: 9000,
        monitoring: "A1C, weight",
        contraindications: ["medullary_thyroid_cancer", "men2_syndrome", "pancreatitis_history"]
    },

    // ===== 22. GLP-1 AGONIST - SEMAGLUTIDE =====
    "semaglutide": {
        id: "semaglutide",
        name: "Semaglutide",
        brandNames: ["Ozempic", "Wegovy", "Rybelsus"],
        class: "GLP-1 Receptor Agonist",
        purpose: "disease_modifying", // Reduces CV events and modifies diabetes/obesity
        indications: ["diabetes", "obesity"],
        benefits: {
            diabetes_cv: {
                mace: { rrr: 0.26, nnt: 46, timeframe: 2.1, endpoint: "MACE", quality: "composite", source: "SUSTAIN-6" },
                stroke: { rrr: 0.39, nnt: 100, timeframe: 2.1, endpoint: "stroke", quality: "hard", source: "SUSTAIN-6" }
            }
        },
        harms: {
            pancreatitis: { nnh: 1000, timeframe: 2, source: "SUSTAIN-6 (no significant increase)" }
        },
        burden: "moderate",
        burdenDetails: "Weekly injection or daily oral. Very common: nausea (22%), vomiting (10%), diarrhea (12%) - usually improves with time.",
        annualCost: 10000,
        monitoring: "A1C, weight",
        contraindications: ["medullary_thyroid_cancer", "men2_syndrome", "pancreatitis_history"]
    },

    // ===== 23. DPP-4 INHIBITOR - SITAGLIPTIN =====
    "sitagliptin": {
        id: "sitagliptin",
        name: "Sitagliptin",
        brandNames: ["Januvia"],
        class: "DPP-4 Inhibitor",
        purpose: "symptomatic", // Lowers glucose but CV neutral, treats symptom of hyperglycemia
        indications: ["diabetes"],
        benefits: {
            diabetes_glycemic: {
                a1c_reduction: { absolute: 0.7, endpoint: "A1C reduction %", quality: "surrogate" }
            },
            diabetes_cv: {
                // TECOS: CV neutral
                mace: { rrr: 0.0, nnt: null, timeframe: 3, endpoint: "MACE", quality: "composite", source: "TECOS" }
            }
        },
        harms: {
            // TECOS: no increased pancreatitis
            pancreatitis: { nnh: 1000, timeframe: 3, source: "TECOS" }
        },
        burden: "low",
        burdenDetails: "Once daily pill. Well tolerated, weight neutral, low hypoglycemia risk.",
        annualCost: 5000,
        monitoring: "A1C, renal function for dose adjustment",
        contraindications: ["pancreatitis_history"]
    },

    // ===== 24. MRA - EPLERENONE =====
    "eplerenone": {
        id: "eplerenone",
        name: "Eplerenone",
        brandNames: ["Inspra"],
        class: "Mineralocorticoid Receptor Antagonist (MRA)",
        purpose: "disease_modifying", // Improves HF survival
        indications: ["heart_failure", "post_mi"],
        benefits: {
            heart_failure: {
                cv_death_hf_hosp: { rrr: 0.24, nnt: 19, timeframe: 1.8, endpoint: "CV death or HF hospitalization", quality: "hard", source: "EMPHASIS-HF" },
                mortality: { rrr: 0.24, nnt: 50, timeframe: 1.8, endpoint: "all-cause mortality", quality: "hard", source: "EMPHASIS-HF" }
            },
            post_mi_with_lv_dysfunction: {
                mortality: { rrr: 0.15, nnt: 43, timeframe: 1.3, endpoint: "all-cause mortality", quality: "hard", source: "EPHESUS" }
            }
        },
        harms: {
            // EMPHASIS-HF: hyperkalemia K>=6.0 NNH ~167
            hyperkalemia_severe: { nnh: 167, timeframe: 1.8, source: "EMPHASIS-HF" }
        },
        burden: "moderate",
        burdenDetails: "Once daily. No gynecomastia (unlike spironolactone). Requires potassium monitoring.",
        annualCost: 200,
        monitoring: "Potassium at 1 week, 1 month, then every 3 months",
        contraindications: ["hyperkalemia", "severe_ckd"]
    },

    // ===== 25. DIGOXIN =====
    "digoxin": {
        id: "digoxin",
        name: "Digoxin",
        brandNames: ["Lanoxin"],
        class: "Cardiac Glycoside",
        purpose: "symptomatic", // Reduces hospitalizations but no mortality benefit
        indications: ["heart_failure", "afib_rate_control"],
        benefits: {
            heart_failure: {
                hospitalization: { rrr: 0.28, nnt: 13, timeframe: 3, endpoint: "HF hospitalization", quality: "hard", source: "DIG" },
                // No mortality benefit
                mortality: { rrr: 0.0, nnt: null, timeframe: 3, endpoint: "all-cause mortality", quality: "hard", source: "DIG" }
            }
        },
        harms: {
            // Digoxin toxicity: NNH ~50 in elderly
            // Narrow therapeutic window
            toxicity: { nnh: 50, timeframe: 2, source: "DIG trial, observational data" },
            arrhythmia: { nnh: 100, timeframe: 2, source: "DIG trial" }
        },
        burden: "moderate",
        burdenDetails: "Once daily. Requires level monitoring (target 0.5-0.9 ng/mL). Narrow therapeutic window - toxicity risk.",
        annualCost: 48,
        monitoring: "Digoxin level, renal function, potassium",
        contraindications: ["av_block", "ventricular_arrhythmia", "hypertrophic_cardiomyopathy"],
        beers_criteria: {
            listed: true,
            concern: "Use in HF may be associated with increased mortality. In AFib, may not add benefit beyond rate control agents. Increased toxicity risk with reduced renal function.",
            recommendation: "Avoid as first-line therapy for AFib and HF; if used, maintain serum level <1.0 ng/mL",
            strength: "strong",
            quality_of_evidence: "moderate"
        },
        elderly_caution: {
            toxicity_risk: true,
            requires_renal_adjustment: true,
            narrow_therapeutic_window: true,
            avoid_if_frail: true,
            monitor_levels: true
        }
    },

    // ===== 26. CALCIUM CHANNEL BLOCKER - AMLODIPINE =====
    "amlodipine": {
        id: "amlodipine",
        name: "Amlodipine",
        brandNames: ["Norvasc"],
        class: "Calcium Channel Blocker",
        purpose: "preventive", // Prevents stroke and CV events via BP control
        indications: ["hypertension", "angina"],
        benefits: {
            hypertension: {
                stroke: { rrr: 0.35, nnt: 67, timeframe: 5, endpoint: "stroke", quality: "hard", source: "ALLHAT" },
                mi: { rrr: 0.15, nnt: 125, timeframe: 5, endpoint: "MI", quality: "hard", source: "ALLHAT" }
            }
        },
        harms: {
            // No serious harms with NNH - edema is mild/moderate
        },
        burden: "low",
        burdenDetails: "Once daily. Common: peripheral edema (15%), headache (8%), flushing (5%).",
        annualCost: 24,
        monitoring: "Blood pressure",
        contraindications: ["severe_hypotension", "severe_aortic_stenosis"]
    },

    // ===== 27. THIAZIDE DIURETIC - HYDROCHLOROTHIAZIDE =====
    "hydrochlorothiazide": {
        id: "hydrochlorothiazide",
        name: "Hydrochlorothiazide",
        brandNames: ["Microzide"],
        class: "Thiazide Diuretic",
        purpose: "preventive", // Prevents stroke and CV events via BP control
        indications: ["hypertension"],
        benefits: {
            hypertension: {
                stroke: { rrr: 0.29, nnt: 50, timeframe: 5, endpoint: "stroke", quality: "hard", source: "ALLHAT" },
                mortality: { rrr: 0.10, nnt: 100, timeframe: 5, endpoint: "all-cause mortality", quality: "hard", source: "Meta-analysis" }
            }
        },
        harms: {
            // Electrolyte disturbances - usually mild
            // No robust NNH for serious events
        },
        burden: "low",
        burdenDetails: "Once daily. Common: increased urination, may cause hypokalemia, hyponatremia. Periodic electrolyte monitoring.",
        annualCost: 24,
        monitoring: "Electrolytes (K, Na), creatinine periodically",
        contraindications: ["anuria", "severe_hypokalemia"]
    },

    // ===== 28. LOOP DIURETIC - FUROSEMIDE =====
    "furosemide": {
        id: "furosemide",
        name: "Furosemide",
        brandNames: ["Lasix"],
        class: "Loop Diuretic",
        purpose: "symptomatic", // Relieves congestion symptoms, no mortality benefit
        indications: ["heart_failure", "edema"],
        benefits: {
            heart_failure_symptoms: {
                // Symptom relief, no mortality benefit
                congestion_relief: { absolute: 0.90, endpoint: "symptom improvement", quality: "surrogate" }
            }
        },
        harms: {
            // Electrolyte disturbances common but usually manageable
        },
        burden: "moderate",
        burdenDetails: "One to three times daily. Frequent urination. Common: electrolyte disturbances. Requires electrolyte monitoring.",
        annualCost: 24,
        monitoring: "Electrolytes, creatinine, weight",
        contraindications: ["anuria", "severe_hypokalemia"]
    },

    // ===== 29. ANTIPLATELET - CLOPIDOGREL =====
    "clopidogrel": {
        id: "clopidogrel",
        name: "Clopidogrel",
        brandNames: ["Plavix"],
        class: "Antiplatelet (P2Y12 Inhibitor)",
        purpose: "preventive", // Prevents recurrent CV events
        indications: ["acs", "post_pci", "stroke_secondary_prevention"],
        benefits: {
            acs: {
                mace: { rrr: 0.20, nnt: 46, timeframe: 1, endpoint: "CV death, MI, stroke", quality: "composite", source: "CURE" }
            },
            stroke_secondary_prevention: {
                stroke_recurrence: { rrr: 0.08, nnt: 91, timeframe: 2, endpoint: "recurrent stroke", quality: "hard", source: "CAPRIE" }
            }
        },
        harms: {
            major_bleeding: { nnh: 100, timeframe: 1, source: "CURE" }
        },
        burden: "low",
        burdenDetails: "Once daily. No routine monitoring. May cause mild GI upset.",
        annualCost: 24,
        monitoring: "Watch for bleeding symptoms",
        contraindications: ["active_bleeding", "severe_liver_disease"]
    },

    // ===== 30. STATIN - ROSUVASTATIN =====
    "rosuvastatin": {
        id: "rosuvastatin",
        name: "Rosuvastatin",
        brandNames: ["Crestor"],
        class: "Statin",
        purpose: "preventive", // Prevents CV events
        indications: ["ascvd_prevention", "hyperlipidemia"],
        benefits: {
            secondary_prevention: {
                mace: { rrr: 0.25, nnt: 25, timeframe: 5, endpoint: "major CV events", quality: "composite", source: "CTT meta-analysis" },
                mortality: { rrr: 0.15, nnt: 50, timeframe: 5, endpoint: "all-cause mortality", quality: "hard", source: "CTT meta-analysis" }
            },
            primary_prevention_high_risk: {
                mace: { rrr: 0.44, nnt: 25, timeframe: 5, endpoint: "major CV events", quality: "composite", source: "JUPITER" }
            }
        },
        harms: {
            new_onset_diabetes: { nnh: 255, timeframe: 4, source: "Meta-analysis" },
            rhabdomyolysis: { nnh: 10000, timeframe: 5, source: "CTT meta-analysis" }
        },
        burden: "low",
        burdenDetails: "Once daily. Most potent statin for LDL lowering. Myalgia in 5-8% (mostly nocebo).",
        annualCost: 36,
        monitoring: "Lipid panel periodically",
        contraindications: ["active_liver_disease", "pregnancy"]
    },

    // ===== 31. STATIN - SIMVASTATIN =====
    "simvastatin": {
        id: "simvastatin",
        name: "Simvastatin",
        brandNames: ["Zocor"],
        class: "Statin",
        purpose: "preventive", // Prevents CV events
        indications: ["ascvd_prevention", "hyperlipidemia"],
        benefits: {
            secondary_prevention: {
                mace: { rrr: 0.24, nnt: 30, timeframe: 5, endpoint: "major CV events", quality: "composite", source: "4S" },
                mortality: { rrr: 0.30, nnt: 30, timeframe: 5, endpoint: "all-cause mortality", quality: "hard", source: "4S" }
            }
        },
        harms: {
            new_onset_diabetes: { nnh: 255, timeframe: 4, source: "Meta-analysis" },
            rhabdomyolysis: { nnh: 10000, timeframe: 5, source: "CTT meta-analysis" }
        },
        burden: "low",
        burdenDetails: "Once daily (evening). Older statin, many drug interactions. 80mg dose increases myopathy risk.",
        annualCost: 24,
        monitoring: "Lipid panel periodically",
        contraindications: ["active_liver_disease", "pregnancy", "strong_cyp3a4_inhibitors"]
    },

    // ===== 32. EZETIMIBE =====
    "ezetimibe": {
        id: "ezetimibe",
        name: "Ezetimibe",
        brandNames: ["Zetia"],
        class: "Cholesterol Absorption Inhibitor",
        purpose: "preventive", // Prevents CV events (add-on to statin)
        indications: ["hyperlipidemia", "ascvd_prevention"],
        benefits: {
            secondary_prevention_addon: {
                mace: { rrr: 0.065, nnt: 50, timeframe: 7, endpoint: "CV death, MI, stroke", quality: "composite", source: "IMPROVE-IT" }
            }
        },
        harms: {
            // Very well tolerated, no significant harms
        },
        burden: "low",
        burdenDetails: "Once daily. Very well tolerated. Usually added to statin.",
        annualCost: 24,
        monitoring: "Lipid panel",
        contraindications: ["severe_liver_disease"]
    },

    // ===== 33. BISPHOSPHONATE - ALENDRONATE =====
    "alendronate": {
        id: "alendronate",
        name: "Alendronate",
        brandNames: ["Fosamax"],
        class: "Bisphosphonate",
        purpose: "preventive", // Prevents fractures
        indications: ["osteoporosis"],
        benefits: {
            osteoporosis: {
                hip_fracture: { rrr: 0.40, nnt: 91, timeframe: 3, endpoint: "hip fracture", quality: "hard", source: "FIT" },
                vertebral_fracture: { rrr: 0.47, nnt: 14, timeframe: 3, endpoint: "vertebral fracture", quality: "hard", source: "FIT" },
                nonvertebral_fracture: { rrr: 0.20, nnt: 50, timeframe: 3, endpoint: "non-vertebral fracture", quality: "hard", source: "FIT" }
            }
        },
        harms: {
            atypical_femur_fracture: { nnh: 1000, timeframe: 5, source: "Meta-analysis" },
            osteonecrosis_jaw: { nnh: 10000, timeframe: 5, source: "FDA data" }
        },
        burden: "moderate",
        burdenDetails: "Once weekly. MUST take fasting with full glass of water, stay upright 30 min. Common: GI upset, esophageal irritation.",
        annualCost: 48,
        monitoring: "Bone density every 2 years, dental exam",
        contraindications: ["esophageal_disorders", "inability_to_sit_upright", "hypocalcemia", "severe_ckd"]
    },

    // ===== 34. BISPHOSPHONATE - RISEDRONATE =====
    "risedronate": {
        id: "risedronate",
        name: "Risedronate",
        brandNames: ["Actonel", "Atelvia"],
        class: "Bisphosphonate",
        purpose: "preventive", // Prevents fractures
        indications: ["osteoporosis"],
        benefits: {
            osteoporosis: {
                hip_fracture: { rrr: 0.26, nnt: 77, timeframe: 3, endpoint: "hip fracture", quality: "hard", source: "HIP study" },
                vertebral_fracture: { rrr: 0.41, nnt: 20, timeframe: 3, endpoint: "vertebral fracture", quality: "hard", source: "VERT" }
            }
        },
        harms: {
            atypical_femur_fracture: { nnh: 1000, timeframe: 5, source: "Meta-analysis" },
            osteonecrosis_jaw: { nnh: 10000, timeframe: 5, source: "FDA data" }
        },
        burden: "moderate",
        burdenDetails: "Weekly or monthly. Same administration requirements as alendronate. May have less GI irritation.",
        annualCost: 200,
        monitoring: "Bone density every 2 years",
        contraindications: ["esophageal_disorders", "inability_to_sit_upright", "hypocalcemia", "severe_ckd"]
    },

    // ===== 35. IV BISPHOSPHONATE - ZOLEDRONIC ACID =====
    "zoledronic_acid": {
        id: "zoledronic_acid",
        name: "Zoledronic Acid",
        brandNames: ["Reclast", "Zometa"],
        class: "IV Bisphosphonate",
        purpose: "preventive", // Prevents fractures, also mortality benefit
        indications: ["osteoporosis"],
        benefits: {
            osteoporosis: {
                hip_fracture: { rrr: 0.41, nnt: 91, timeframe: 3, endpoint: "hip fracture", quality: "hard", source: "HORIZON" },
                vertebral_fracture: { rrr: 0.70, nnt: 14, timeframe: 3, endpoint: "vertebral fracture", quality: "hard", source: "HORIZON" },
                mortality: { rrr: 0.28, nnt: 28, timeframe: 2.8, endpoint: "all-cause mortality", quality: "hard", source: "HORIZON-RFT" }
            }
        },
        harms: {
            atypical_femur_fracture: { nnh: 1000, timeframe: 5, source: "Meta-analysis" },
            osteonecrosis_jaw: { nnh: 10000, timeframe: 5, source: "FDA data" }
        },
        burden: "low",
        burdenDetails: "Once yearly IV infusion. Common: flu-like symptoms after first dose (30%). No daily pill burden.",
        annualCost: 800,
        monitoring: "Bone density every 2 years, calcium/vitamin D levels, dental exam",
        contraindications: ["egfr_below_35", "hypocalcemia"]
    },

    // ===== 36. DENOSUMAB =====
    "denosumab": {
        id: "denosumab",
        name: "Denosumab",
        brandNames: ["Prolia"],
        class: "RANK Ligand Inhibitor",
        purpose: "preventive", // Prevents fractures
        indications: ["osteoporosis"],
        benefits: {
            osteoporosis: {
                hip_fracture: { rrr: 0.40, nnt: 200, timeframe: 3, endpoint: "hip fracture", quality: "hard", source: "FREEDOM" },
                vertebral_fracture: { rrr: 0.68, nnt: 21, timeframe: 3, endpoint: "vertebral fracture", quality: "hard", source: "FREEDOM" },
                nonvertebral_fracture: { rrr: 0.20, nnt: 67, timeframe: 3, endpoint: "non-vertebral fracture", quality: "hard", source: "FREEDOM" }
            }
        },
        harms: {
            osteonecrosis_jaw: { nnh: 1000, timeframe: 3, source: "FREEDOM extension" },
            atypical_femur_fracture: { nnh: 1000, timeframe: 5, source: "Meta-analysis" }
        },
        burden: "low",
        burdenDetails: "Subcutaneous injection every 6 months. Well tolerated. CRITICAL: must not stop suddenly - causes rapid bone loss.",
        annualCost: 2400,
        monitoring: "Calcium levels, dental exam, bone density",
        contraindications: ["hypocalcemia"]
    },

    // ===== 37. INHALED CORTICOSTEROID - FLUTICASONE =====
    "fluticasone_inh": {
        id: "fluticasone_inh",
        name: "Fluticasone (inhaled)",
        brandNames: ["Flovent", "ArmonAir"],
        class: "Inhaled Corticosteroid (ICS)",
        purpose: "disease_modifying", // Controls inflammation and prevents exacerbations
        indications: ["asthma", "copd"],
        benefits: {
            asthma: {
                exacerbations: { rrr: 0.50, nnt: 7, timeframe: 1, endpoint: "asthma exacerbations", quality: "hard", source: "Meta-analysis" }
            },
            copd: {
                exacerbations: { rrr: 0.25, nnt: 20, timeframe: 1, endpoint: "COPD exacerbations", quality: "hard", source: "TORCH" }
            }
        },
        harms: {
            pneumonia_copd: { nnh: 20, timeframe: 3, source: "TORCH (COPD patients only)" }
        },
        burden: "moderate",
        burdenDetails: "Once or twice daily inhaler. Common: oral thrush (5%), hoarseness. Rinse mouth after use.",
        annualCost: 300,
        monitoring: "Growth in children, bone density if long-term high dose",
        contraindications: ["active_tb", "untreated_fungal_infection"]
    },

    // ===== 38. LABA/ICS - FLUTICASONE/SALMETEROL =====
    "fluticasone_salmeterol": {
        id: "fluticasone_salmeterol",
        name: "Fluticasone/Salmeterol",
        brandNames: ["Advair"],
        class: "ICS/LABA Combination",
        purpose: "disease_modifying", // Controls disease and prevents exacerbations
        indications: ["asthma", "copd"],
        benefits: {
            asthma: {
                exacerbations: { rrr: 0.45, nnt: 8, timeframe: 1, endpoint: "severe exacerbations", quality: "hard", source: "GOAL" }
            },
            copd: {
                exacerbations: { rrr: 0.25, nnt: 15, timeframe: 1, endpoint: "moderate/severe exacerbations", quality: "hard", source: "TORCH" },
                mortality: { rrr: 0.18, nnt: 42, timeframe: 3, endpoint: "all-cause mortality (trend)", quality: "hard", source: "TORCH" }
            }
        },
        harms: {
            pneumonia_copd: { nnh: 16, timeframe: 3, source: "TORCH (COPD)" }
        },
        burden: "moderate",
        burdenDetails: "Twice daily inhaler. Combines steroid + long-acting bronchodilator. Rinse mouth after use.",
        annualCost: 400,
        monitoring: "Bone density if long-term, potassium",
        contraindications: ["severe_milk_allergy"]
    },

    // ===== 39. LAMA - TIOTROPIUM =====
    "tiotropium": {
        id: "tiotropium",
        name: "Tiotropium",
        brandNames: ["Spiriva"],
        class: "Long-Acting Muscarinic Antagonist (LAMA)",
        purpose: "disease_modifying", // Reduces exacerbations and improves disease control
        indications: ["copd", "asthma"],
        benefits: {
            copd: {
                exacerbations: { rrr: 0.14, nnt: 16, timeframe: 1, endpoint: "COPD exacerbations", quality: "hard", source: "UPLIFT" }
                // No mortality benefit in UPLIFT
            },
            asthma: {
                exacerbations: { rrr: 0.21, nnt: 20, timeframe: 1, endpoint: "asthma exacerbations (add-on)", quality: "hard", source: "Meta-analysis" }
            }
        },
        harms: {
            // Dry mouth common but not serious; no robust NNH for serious events
        },
        burden: "low",
        burdenDetails: "Once daily inhaler. Common: dry mouth (10%). Generally well tolerated.",
        annualCost: 400,
        monitoring: "None routine",
        contraindications: ["severe_glaucoma", "urinary_retention"]
    },

    // ===== 40. TRIPLE INHALER - FLUTICASONE/UMECLIDINIUM/VILANTEROL =====
    "fluticasone_umeclidinium_vilanterol": {
        id: "fluticasone_umeclidinium_vilanterol",
        name: "Fluticasone/Umeclidinium/Vilanterol",
        brandNames: ["Trelegy"],
        class: "Triple Therapy (ICS/LAMA/LABA)",
        purpose: "disease_modifying", // Reduces exacerbations and mortality
        indications: ["copd"],
        benefits: {
            copd: {
                exacerbations: { rrr: 0.35, nnt: 9, timeframe: 1, endpoint: "moderate/severe exacerbations", quality: "hard", source: "IMPACT" },
                mortality: { rrr: 0.28, nnt: 104, timeframe: 1, endpoint: "all-cause mortality", quality: "hard", source: "IMPACT" }
            }
        },
        harms: {
            pneumonia: { nnh: 24, timeframe: 1, source: "IMPACT" }
        },
        burden: "low",
        burdenDetails: "Once daily single inhaler. Combines 3 classes in one device. Rinse mouth after use.",
        annualCost: 600,
        monitoring: "Bone density if long-term",
        contraindications: ["severe_milk_allergy"]
    },

    // ===== 41. PROTON PUMP INHIBITOR - OMEPRAZOLE =====
    "omeprazole": {
        id: "omeprazole",
        name: "Omeprazole",
        brandNames: ["Prilosec"],
        class: "Proton Pump Inhibitor (PPI)",
        purpose: "symptomatic", // Relieves GERD symptoms; preventive for GI bleeding
        indications: ["gerd", "peptic_ulcer", "gi_bleed_prevention"],
        benefits: {
            gerd: {
                symptom_relief: { absolute: 0.80, endpoint: "symptom resolution", quality: "surrogate" }
            },
            gi_bleed_prevention: {
                gi_bleeding: { rrr: 0.70, nnt: 50, timeframe: 1, endpoint: "GI bleeding", quality: "hard", source: "Meta-analysis" }
            }
        },
        harms: {
            hip_fracture: { nnh: 1000, timeframe: 5, source: "Observational data (uncertain)" },
            c_diff: { nnh: 500, timeframe: 1, source: "Observational data" }
        },
        burden: "low",
        burdenDetails: "Once or twice daily. Take 30 min before meals. Long-term use concerns: B12 deficiency, low magnesium, possible fracture risk.",
        annualCost: 24,
        monitoring: "B12 and magnesium if long-term use",
        contraindications: ["ppi_allergy"]
    },

    // ===== 42. ALLOPURINOL =====
    "allopurinol": {
        id: "allopurinol",
        name: "Allopurinol",
        brandNames: ["Zyloprim"],
        class: "Xanthine Oxidase Inhibitor",
        purpose: "preventive", // Prevents gout flares
        indications: ["gout"],
        benefits: {
            gout: {
                gout_flares: { rrr: 0.40, nnt: 5, timeframe: 1, endpoint: "gout flares", quality: "hard", source: "Meta-analysis" }
            }
        },
        harms: {
            hypersensitivity_syndrome: { nnh: 1000, timeframe: 1, source: "Meta-analysis" }
        },
        burden: "moderate",
        burdenDetails: "Once daily. Requires slow titration. May trigger gout flares initially - use colchicine prophylaxis. Check HLA-B*5801 in some populations.",
        annualCost: 24,
        monitoring: "Uric acid levels, renal function",
        contraindications: ["allopurinol_hypersensitivity"]
    },

    // ===== 43. FEBUXOSTAT =====
    "febuxostat": {
        id: "febuxostat",
        name: "Febuxostat",
        brandNames: ["Uloric"],
        class: "Xanthine Oxidase Inhibitor",
        purpose: "preventive", // Prevents gout flares
        indications: ["gout"],
        benefits: {
            gout: {
                gout_flares: { rrr: 0.50, nnt: 4, timeframe: 1, endpoint: "gout flares (vs placebo)", quality: "hard", source: "CONFIRMS" }
            }
        },
        harms: {
            cv_death: { nnh: 91, timeframe: 3, source: "CARES (vs allopurinol)" }
        },
        burden: "low",
        burdenDetails: "Once daily. More potent than allopurinol. FDA boxed warning: increased CV death risk vs allopurinol in CV disease.",
        annualCost: 300,
        monitoring: "Uric acid, liver function",
        contraindications: ["azathioprine_use", "mercaptopurine_use"]
    },

    // ===== 44. COLCHICINE =====
    "colchicine": {
        id: "colchicine",
        name: "Colchicine",
        brandNames: ["Colcrys", "Mitigare"],
        class: "Anti-inflammatory",
        purpose: "preventive", // Prevents gout flares and CV events
        indications: ["gout", "cv_prevention"],
        benefits: {
            gout_flare_treatment: {
                pain_relief: { absolute: 0.40, endpoint: "50% pain reduction at 24h", quality: "surrogate", source: "AGREE" }
            },
            cv_prevention: {
                mace: { rrr: 0.23, nnt: 62, timeframe: 2.4, endpoint: "CV death, MI, stroke", quality: "composite", source: "COLCOT" }
            }
        },
        harms: {
            diarrhea_severe: { nnh: 20, timeframe: 0.1, source: "Acute dosing" }
        },
        burden: "moderate",
        burdenDetails: "Once or twice daily for prevention. Very common: diarrhea, nausea. Narrow therapeutic window - drug interactions with statins, CYP3A4.",
        annualCost: 200,
        monitoring: "Renal and hepatic function",
        contraindications: ["severe_ckd", "severe_liver_disease", "blood_dyscrasias"]
    },

    // ===== 45. INSULIN (BASAL) =====
    "insulin_basal": {
        id: "insulin",
        name: "Insulin (Basal)",
        brandNames: ["Lantus", "Basaglar", "Levemir", "Tresiba"],
        class: "Insulin",
        purpose: "replacement", // Replaces deficient insulin (especially T1DM) or supplements in T2DM
        indications: ["diabetes"],
        benefits: {
            diabetes_glycemic: {
                a1c_reduction: { absolute: 1.5, endpoint: "A1C reduction %", quality: "surrogate" }
            },
            diabetes_cv: {
                // ORIGIN trial: neutral CV effect
                mace: { rrr: 0.0, nnt: null, timeframe: 6.2, endpoint: "MACE", quality: "composite", source: "ORIGIN" }
            }
        },
        harms: {
            severe_hypoglycemia: { nnh: 50, timeframe: 1, source: "ORIGIN" }
        },
        burden: "high",
        burdenDetails: "Daily injection. Requires blood glucose monitoring. Common: weight gain (2-4 kg), hypoglycemia. Injection training needed.",
        annualCost: 3500,
        monitoring: "Frequent blood glucose, A1C every 3 months",
        contraindications: ["hypoglycemia_unawareness_severe"]
    },

    // ===== 46. LEVOTHYROXINE =====
    "levothyroxine": {
        id: "levothyroxine",
        name: "Levothyroxine",
        brandNames: ["Synthroid", "Levoxyl", "Unithroid"],
        class: "Thyroid Hormone",
        purpose: "replacement", // Replaces deficient thyroid hormone
        indications: ["hypothyroidism"],
        benefits: {
            hypothyroidism: {
                symptom_relief: { absolute: 0.90, endpoint: "symptom resolution", quality: "surrogate" }
            }
        },
        harms: {
            afib: { nnh: 200, timeframe: 5, source: "Observational (overtreatment)" },
            osteoporosis: { nnh: 500, timeframe: 10, source: "Observational (overtreatment)" }
        },
        burden: "moderate",
        burdenDetails: "Once daily on empty stomach. Take 30-60 min before eating. Many drug/food interactions. Requires dose adjustments.",
        annualCost: 48,
        monitoring: "TSH every 6-12 months once stable, more frequently when adjusting",
        contraindications: ["untreated_adrenal_insufficiency", "acute_mi"]
    },

    // ===== 47. VITAMIN D =====
    "vitamin_d": {
        id: "vitamin-d",
        name: "Vitamin D (Cholecalciferol)",
        brandNames: ["Various"],
        class: "Supplement",
        purpose: "replacement", // Replaces deficient vitamin D
        indications: ["vitamin_d_deficiency", "osteoporosis_adjunct"],
        benefits: {
            deficiency_treatment: {
                bone_health: { absolute: 0.90, endpoint: "normalized vitamin D levels", quality: "surrogate" }
            },
            fall_prevention: {
                falls: { rrr: 0.14, nnt: 100, timeframe: 1, endpoint: "falls (in deficient elderly)", quality: "hard", source: "Meta-analysis" }
            }
        },
        harms: {
            // Very low harm at standard doses
            hypercalcemia: { nnh: 5000, timeframe: 1, source: "With very high doses only" }
        },
        burden: "low",
        burdenDetails: "Daily or weekly. Very well tolerated at standard doses (1000-2000 IU/day).",
        annualCost: 24,
        monitoring: "25-OH vitamin D level if deficient",
        contraindications: ["hypercalcemia", "sarcoidosis"]
    },

    // ===== 48. GABAPENTIN =====
    "gabapentin": {
        id: "gabapentin",
        name: "Gabapentin",
        brandNames: ["Neurontin", "Gralise"],
        class: "Anticonvulsant/Neuropathic Pain Agent",
        purpose: "symptomatic", // Relieves pain symptoms
        indications: ["neuropathic_pain", "seizures"],
        benefits: {
            neuropathic_pain: {
                pain_relief: { rrr: 0.30, nnt: 6, timeframe: 0.25, endpoint: "50% pain reduction", quality: "hard", source: "Cochrane review" }
            }
        },
        harms: {
            falls_elderly: { nnh: 20, timeframe: 1, source: "Observational studies" },
            cns_depression: { nnh: 10, timeframe: 0.25, source: "FDA label, Beers Criteria" }
        },
        burden: "moderate",
        burdenDetails: "Three times daily. Very common: dizziness (20%), somnolence (20%), peripheral edema. Requires slow titration.",
        annualCost: 48,
        monitoring: "Renal function for dose adjustment",
        contraindications: ["gabapentin_hypersensitivity"],
        beers_criteria: {
            listed: true,
            concern: "May cause or exacerbate SIADH, ataxia, impaired psychomotor function, syncope, falls",
            recommendation: "Avoid in older adults; if used, reduce dose and monitor closely",
            strength: "strong",
            quality_of_evidence: "moderate"
        },
        elderly_caution: {
            fall_risk: true,
            cognitive_impairment: true,
            sedation: true,
            requires_renal_adjustment: true,
            avoid_if_frail: true
        }
    },

    // ===== 49. PREGABALIN =====
    "pregabalin": {
        id: "pregabalin",
        name: "Pregabalin",
        brandNames: ["Lyrica"],
        class: "Anticonvulsant/Neuropathic Pain Agent",
        purpose: "symptomatic", // Relieves pain symptoms
        indications: ["neuropathic_pain", "fibromyalgia", "seizures"],
        benefits: {
            neuropathic_pain: {
                pain_relief: { rrr: 0.35, nnt: 5, timeframe: 0.25, endpoint: "50% pain reduction", quality: "hard", source: "Cochrane review" }
            },
            fibromyalgia: {
                pain_relief: { rrr: 0.25, nnt: 10, timeframe: 0.25, endpoint: "30% pain reduction", quality: "hard", source: "Cochrane review" }
            }
        },
        harms: {
            falls_elderly: { nnh: 15, timeframe: 1, source: "Observational studies" },
            cns_depression: { nnh: 8, timeframe: 0.25, source: "FDA label, Beers Criteria" },
            edema_worsening_hf: { nnh: 25, timeframe: 0.5, source: "FDA label" }
        },
        burden: "moderate",
        burdenDetails: "Twice daily. Common: dizziness (30%), somnolence (25%), weight gain, peripheral edema. Schedule V controlled substance.",
        annualCost: 150,
        monitoring: "Renal function for dose adjustment",
        contraindications: ["pregabalin_hypersensitivity", "heart_failure_edema"],
        beers_criteria: {
            listed: true,
            concern: "May cause or exacerbate SIADH, ataxia, impaired psychomotor function, syncope, falls; peripheral edema may worsen heart failure",
            recommendation: "Avoid in older adults; if used, reduce dose and monitor closely",
            strength: "strong",
            quality_of_evidence: "moderate"
        },
        elderly_caution: {
            fall_risk: true,
            cognitive_impairment: true,
            sedation: true,
            requires_renal_adjustment: true,
            avoid_if_frail: true,
            avoid_in_hf: true
        }
    },

    // ===== 50. DULOXETINE =====
    "duloxetine": {
        id: "duloxetine",
        name: "Duloxetine",
        brandNames: ["Cymbalta"],
        class: "SNRI",
        purpose: "symptomatic", // Relieves depression and pain symptoms
        indications: ["depression", "neuropathic_pain", "fibromyalgia", "anxiety"],
        benefits: {
            depression: {
                remission: { rrr: 0.20, nnt: 8, timeframe: 0.25, endpoint: "depression remission", quality: "hard", source: "Meta-analysis" }
            },
            neuropathic_pain: {
                pain_relief: { rrr: 0.30, nnt: 6, timeframe: 0.25, endpoint: "50% pain reduction", quality: "hard", source: "Meta-analysis" }
            }
        },
        harms: {
            discontinuation_syndrome: { nnh: 10, timeframe: 0.1, source: "If stopped abruptly" }
        },
        burden: "moderate",
        burdenDetails: "Once daily. Common: nausea (25%), dry mouth (15%), constipation. Must taper to stop - withdrawal symptoms if stopped abruptly.",
        annualCost: 48,
        monitoring: "Blood pressure, liver function",
        contraindications: ["maoi_use", "uncontrolled_glaucoma", "severe_liver_disease"]
    },

    // ===== 51. PCSK9 INHIBITOR - EVOLOCUMAB =====
    "evolocumab": {
        id: "evolocumab",
        name: "Evolocumab",
        brandNames: ["Repatha"],
        class: "PCSK9 Inhibitor",
        purpose: "preventive", // Prevents CV events
        indications: ["hyperlipidemia", "ascvd_prevention"],
        benefits: {
            secondary_prevention: {
                mace: { rrr: 0.15, nnt: 63, timeframe: 2.2, endpoint: "CV death, MI, stroke", quality: "composite", source: "FOURIER" }
            }
        },
        harms: {
            // Very well tolerated, injection site reactions mild
        },
        burden: "moderate",
        burdenDetails: "Subcutaneous injection every 2 weeks or monthly. Common: injection site reactions (5%). Extremely potent LDL lowering (60%).",
        annualCost: 6000,
        monitoring: "Lipid panel",
        contraindications: ["pcsk9_hypersensitivity"]
    },

    // ===== 52. RIVAROXABAN LOW-DOSE + ASA =====
    "rivaroxaban_vascular": {
        id: "rivaroxaban_vascular",
        name: "Rivaroxaban 2.5mg BID (vascular dose)",
        brandNames: ["Xarelto (vascular)"],
        class: "Anticoagulant + Antiplatelet",
        purpose: "preventive", // Prevents CV and limb events
        indications: ["stable_cad", "pad"],
        benefits: {
            stable_cad_pad: {
                mace: { rrr: 0.24, nnt: 77, timeframe: 2, endpoint: "CV death, MI, stroke", quality: "composite", source: "COMPASS" },
                limb_events: { rrr: 0.46, nnt: 200, timeframe: 2, endpoint: "major adverse limb events", quality: "hard", source: "COMPASS" }
            }
        },
        harms: {
            major_bleeding: { nnh: 91, timeframe: 2, source: "COMPASS" }
        },
        burden: "moderate",
        burdenDetails: "Twice daily (taken with aspirin 100mg). Higher bleeding risk than aspirin alone.",
        annualCost: 5500,
        monitoring: "Renal function, bleeding symptoms",
        contraindications: ["high_bleeding_risk", "severe_ckd"]
    },

    // ===== 53. ICOSAPENT ETHYL =====
    "icosapent_ethyl": {
        id: "icosapent_ethyl",
        name: "Icosapent Ethyl",
        brandNames: ["Vascepa"],
        class: "Omega-3 Fatty Acid (purified EPA)",
        purpose: "preventive", // Prevents CV events
        indications: ["hypertriglyceridemia", "cv_prevention"],
        benefits: {
            cv_prevention_high_tg: {
                mace: { rrr: 0.25, nnt: 21, timeframe: 4.9, endpoint: "CV death, MI, stroke, revascularization", quality: "composite", source: "REDUCE-IT" }
            }
        },
        harms: {
            afib: { nnh: 77, timeframe: 4.9, source: "REDUCE-IT" },
            bleeding: { nnh: 125, timeframe: 4.9, source: "REDUCE-IT (minor bleeding)" }
        },
        burden: "moderate",
        burdenDetails: "Four capsules daily (2g twice daily with meals). Must be taken with food.",
        annualCost: 3600,
        monitoring: "Triglycerides, bleeding symptoms",
        contraindications: ["fish_allergy"]
    },

    // ===== 54. CANAGLIFLOZIN =====
    "canagliflozin": {
        id: "canagliflozin",
        name: "Canagliflozin",
        brandNames: ["Invokana"],
        class: "SGLT2 Inhibitor",
        purpose: "disease_modifying", // Modifies CKD and diabetes disease progression
        indications: ["diabetes", "ckd", "heart_failure"],
        benefits: {
            diabetes_cv: {
                mace: { rrr: 0.14, nnt: 73, timeframe: 2.4, endpoint: "MACE", quality: "composite", source: "CANVAS" }
            },
            ckd: {
                kidney_progression: { rrr: 0.30, nnt: 22, timeframe: 2.6, endpoint: "ESKD, doubling creatinine, renal death", quality: "hard", source: "CREDENCE" }
            }
        },
        harms: {
            amputation: { nnh: 345, timeframe: 2.4, source: "CANVAS (signal, not confirmed in CREDENCE)" },
            dka: { nnh: 1000, timeframe: 2, source: "CANVAS/CREDENCE" }
        },
        burden: "low",
        burdenDetails: "Once daily. Common: genital infections (6%), increased urination. FDA warning about amputation risk (uncertain causality).",
        annualCost: 6000,
        monitoring: "Renal function, foot exams",
        contraindications: ["dialysis", "type1_diabetes"]
    },

    // ===== 55. FINERENONE =====
    "finerenone": {
        id: "finerenone",
        name: "Finerenone",
        brandNames: ["Kerendia"],
        class: "Non-steroidal MRA",
        purpose: "disease_modifying", // Slows kidney disease progression
        indications: ["diabetic_kidney_disease"],
        benefits: {
            diabetic_kidney_disease: {
                kidney_progression: { rrr: 0.18, nnt: 34, timeframe: 2.6, endpoint: "kidney failure, 40% eGFR decline", quality: "hard", source: "FIDELIO-DKD" },
                cv_events: { rrr: 0.14, nnt: 42, timeframe: 2.6, endpoint: "CV death, MI, stroke, HF hosp", quality: "composite", source: "FIDELIO-DKD" }
            }
        },
        harms: {
            hyperkalemia: { nnh: 12, timeframe: 2.6, source: "FIDELIO-DKD" }
        },
        burden: "moderate",
        burdenDetails: "Once daily. Common: hyperkalemia (18%). Requires potassium monitoring. No gynecomastia (unlike spironolactone).",
        annualCost: 6000,
        monitoring: "Potassium at 4 weeks, then periodically; eGFR",
        contraindications: ["severe_ckd", "adrenal_insufficiency", "concurrent_strong_cyp3a4_inhibitors"]
    },

    // ===== 56. TERIPARATIDE =====
    "teriparatide": {
        id: "teriparatide",
        name: "Teriparatide",
        brandNames: ["Forteo"],
        class: "PTH Analog (Anabolic)",
        purpose: "disease_modifying", // Builds bone, modifies osteoporosis disease course
        indications: ["osteoporosis_severe"],
        benefits: {
            osteoporosis_severe: {
                vertebral_fracture: { rrr: 0.65, nnt: 11, timeframe: 1.8, endpoint: "vertebral fracture", quality: "hard", source: "Fracture Prevention Trial" },
                nonvertebral_fracture: { rrr: 0.35, nnt: 33, timeframe: 1.8, endpoint: "non-vertebral fracture", quality: "hard", source: "Fracture Prevention Trial" }
            }
        },
        harms: {
            hypercalcemia: { nnh: 50, timeframe: 1.8, source: "Fracture Prevention Trial" }
        },
        burden: "high",
        burdenDetails: "Daily subcutaneous injection for up to 2 years. Common: leg cramps, dizziness. Must transition to antiresorptive after.",
        annualCost: 25000,
        monitoring: "Calcium levels, uric acid",
        contraindications: ["pagets_disease", "prior_radiation_therapy", "bone_metastases", "hypercalcemia"]
    },

    // ===== 57. ROMOSOZUMAB =====
    "romosozumab": {
        id: "romosozumab",
        name: "Romosozumab",
        brandNames: ["Evenity"],
        class: "Sclerostin Inhibitor (Anabolic)",
        purpose: "disease_modifying", // Builds bone, modifies osteoporosis disease course
        indications: ["osteoporosis_severe"],
        benefits: {
            osteoporosis_severe: {
                vertebral_fracture: { rrr: 0.73, nnt: 20, timeframe: 1, endpoint: "vertebral fracture", quality: "hard", source: "FRAME" },
                hip_fracture: { rrr: 0.38, nnt: 167, timeframe: 2, endpoint: "hip fracture (vs alendronate)", quality: "hard", source: "ARCH" }
            }
        },
        harms: {
            cv_events: { nnh: 100, timeframe: 1, source: "ARCH" }
        },
        burden: "moderate",
        burdenDetails: "Monthly subcutaneous injection for 12 months only. Common: injection site reactions, arthralgia. FDA boxed warning: CV risk.",
        annualCost: 22000,
        monitoring: "Calcium, symptoms of CV events",
        contraindications: ["mi_within_1_year", "stroke_within_1_year", "hypocalcemia"]
    },

    // ===== 58. BUMETANIDE =====
    "bumetanide": {
        id: "bumetanide",
        name: "Bumetanide",
        brandNames: ["Bumex"],
        class: "Loop Diuretic",
        purpose: "symptomatic", // Relieves congestion symptoms
        indications: ["heart_failure", "edema"],
        benefits: {
            heart_failure_symptoms: {
                congestion_relief: { absolute: 0.90, endpoint: "symptom improvement", quality: "surrogate" }
            }
        },
        harms: {
            // Similar to furosemide
        },
        burden: "moderate",
        burdenDetails: "Once to twice daily. 40x more potent than furosemide per mg. May be preferred in severe edema or furosemide resistance.",
        annualCost: 120,
        monitoring: "Electrolytes, creatinine, weight",
        contraindications: ["anuria", "severe_hypokalemia"]
    },

    // ===== 59. TORSEMIDE =====
    "torsemide": {
        id: "torsemide",
        name: "Torsemide",
        brandNames: ["Demadex"],
        class: "Loop Diuretic",
        purpose: "symptomatic", // Relieves congestion symptoms
        indications: ["heart_failure", "edema"],
        benefits: {
            heart_failure: {
                hospitalization: { rrr: 0.17, nnt: 25, timeframe: 1, endpoint: "HF hospitalization vs furosemide", quality: "hard", source: "TRANSFORM-HF (no sig diff)" }
            }
        },
        harms: {
            // Similar to furosemide
        },
        burden: "low",
        burdenDetails: "Once daily. Longer duration than furosemide, more predictable absorption. May reduce nighttime urination.",
        annualCost: 48,
        monitoring: "Electrolytes, creatinine, weight",
        contraindications: ["anuria", "severe_hypokalemia"]
    },

    // ===== 60. CHLORTHALIDONE =====
    "chlorthalidone": {
        id: "chlorthalidone",
        name: "Chlorthalidone",
        brandNames: ["Hygroton"],
        class: "Thiazide-like Diuretic",
        purpose: "preventive", // Prevents stroke and CV events via BP control
        indications: ["hypertension"],
        benefits: {
            hypertension: {
                stroke: { rrr: 0.36, nnt: 50, timeframe: 5, endpoint: "stroke", quality: "hard", source: "ALLHAT" },
                mortality: { rrr: 0.15, nnt: 100, timeframe: 5, endpoint: "all-cause mortality", quality: "hard", source: "Meta-analysis" }
            }
        },
        harms: {
            // Electrolyte disturbances, gout
            hypokalemia_severe: { nnh: 50, timeframe: 1, source: "ALLHAT" }
        },
        burden: "low",
        burdenDetails: "Once daily. Longer acting than HCTZ, more potent. May cause more hypokalemia than HCTZ.",
        annualCost: 24,
        monitoring: "Electrolytes (K, Na), uric acid, glucose",
        contraindications: ["anuria", "severe_hypokalemia"]
    }
};

// Helper function to get medication by ID
function getMedication(id) {
    return MEDICATIONS_DATABASE[id] || null;
}

// Get all medications
function getAllMedications() {
    return Object.values(MEDICATIONS_DATABASE);
}

// Get medications by indication
function getMedicationsByIndication(indication) {
    return Object.values(MEDICATIONS_DATABASE).filter(med =>
        med.indications.includes(indication)
    );
}

// Get medications by class
function getMedicationsByClass(medClass) {
    return Object.values(MEDICATIONS_DATABASE).filter(med =>
        med.class.toLowerCase().includes(medClass.toLowerCase())
    );
}

// Get medications by purpose
function getMedicationsByPurpose(purpose) {
    return Object.values(MEDICATIONS_DATABASE).filter(med =>
        med.purpose === purpose
    );
}

// Purpose display labels and descriptions
const PURPOSE_INFO = {
    preventive: {
        label: "Preventive",
        shortLabel: "PREVENT",
        description: "Prevents future events or disease (e.g., statins, bisphosphonates, anticoagulants)",
        color: "#3498db" // Blue
    },
    disease_modifying: {
        label: "Disease-Modifying",
        shortLabel: "DISEASE-MOD",
        description: "Treats underlying disease and changes its course (e.g., HF medications, SGLT2 inhibitors for CKD)",
        color: "#27ae60" // Green
    },
    symptomatic: {
        label: "Symptomatic",
        shortLabel: "SYMPTOM",
        description: "Relieves symptoms without changing disease course (e.g., pain medications, loop diuretics)",
        color: "#f39c12" // Orange
    },
    replacement: {
        label: "Replacement",
        shortLabel: "REPLACE",
        description: "Replaces missing hormones or nutrients (e.g., levothyroxine, vitamin D, insulin)",
        color: "#9b59b6" // Purple
    }
};

// Export for use in other modules
if (typeof module !== 'undefined' && module.exports) {
    module.exports = { MEDICATIONS_DATABASE, getMedication, getAllMedications, getMedicationsByIndication, getMedicationsByClass, getMedicationsByPurpose, PURPOSE_INFO };
}

// MedModel browser global (upstream file only exports for CommonJS)
if (typeof window !== 'undefined') {
    window.MedevalDB = { MEDICATIONS_DATABASE: MEDICATIONS_DATABASE, PURPOSE_INFO: typeof PURPOSE_INFO !== 'undefined' ? PURPOSE_INFO : {} };
}
