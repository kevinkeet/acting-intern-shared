/**
 * MedModel — baseline-risk models.
 *
 * PCE: 2013 ACC/AHA Pooled Cohort Equations (Goff DC et al., Circulation
 * 2014;129:S49–S73, Appendix 7 Table A). 10-year first hard ASCVD event
 * (nonfatal MI, CHD death, fatal/nonfatal stroke). Valid ages 40–79.
 * Coefficients are validated in medmodel/test/ against the guideline's
 * published worked examples (55-year-old profiles: 2.1% / 3.0% / 5.3% / 6.1%).
 *
 * CHA2DS2VASC: annual stroke/thromboembolism rates without anticoagulation,
 * Swedish national AF cohort (Friberg L et al., Eur Heart J 2012;33:1500-10).
 * Contemporary cohorts run somewhat lower; see methods.html.
 *
 * Browser global: window.RiskModels. Node: module.exports.
 */
(function (root, factory) {
    if (typeof module === 'object' && module.exports) {
        module.exports = factory();
    } else {
        root.RiskModels = factory();
    }
})(typeof self !== 'undefined' ? self : this, function () {
    'use strict';

    // ---- Pooled Cohort Equations ----------------------------------------
    // Groups: whiteFemale, blackFemale, whiteMale, blackMale
    // Terms use: lnAge, lnAge2, lnTC, lnAgeTC, lnHDL, lnAgeHDL,
    //            lnSBPtx / lnAgeSBPtx, lnSBPuntx / lnAgeSBPuntx,
    //            smoker, lnAgeSmoker, diabetes
    var PCE = {
        whiteFemale: {
            lnAge: -29.799, lnAge2: 4.884, lnTC: 13.540, lnAgeTC: -3.114,
            lnHDL: -13.578, lnAgeHDL: 3.149,
            lnSBPtx: 2.019, lnAgeSBPtx: 0, lnSBPuntx: 1.957, lnAgeSBPuntx: 0,
            smoker: 7.574, lnAgeSmoker: -1.665, diabetes: 0.661,
            meanLP: -29.18, s10: 0.9665
        },
        blackFemale: {
            lnAge: 17.114, lnAge2: 0, lnTC: 0.940, lnAgeTC: 0,
            lnHDL: -18.920, lnAgeHDL: 4.475,
            lnSBPtx: 29.291, lnAgeSBPtx: -6.432, lnSBPuntx: 27.820, lnAgeSBPuntx: -6.087,
            smoker: 0.691, lnAgeSmoker: 0, diabetes: 0.874,
            meanLP: 86.61, s10: 0.9533
        },
        whiteMale: {
            lnAge: 12.344, lnAge2: 0, lnTC: 11.853, lnAgeTC: -2.664,
            lnHDL: -7.990, lnAgeHDL: 1.769,
            lnSBPtx: 1.797, lnAgeSBPtx: 0, lnSBPuntx: 1.764, lnAgeSBPuntx: 0,
            smoker: 7.837, lnAgeSmoker: -1.795, diabetes: 0.658,
            meanLP: 61.18, s10: 0.9144
        },
        blackMale: {
            lnAge: 2.469, lnAge2: 0, lnTC: 0.302, lnAgeTC: 0,
            lnHDL: -0.307, lnAgeHDL: 0,
            lnSBPtx: 1.916, lnAgeSBPtx: 0, lnSBPuntx: 1.809, lnAgeSBPuntx: 0,
            smoker: 0.549, lnAgeSmoker: 0, diabetes: 0.645,
            meanLP: 19.54, s10: 0.8954
        }
    };

    /**
     * 10-year hard-ASCVD risk.
     * p = { age, sex: 'male'|'female', race: 'black'|'other',
     *       totalChol, hdl (mg/dL), sbp, bpTreated, smoker, diabetes }
     */
    function pce10y(p) {
        var group = (p.race === 'black' ? 'black' : 'white') +
                    (p.sex === 'female' ? 'Female' : 'Male');
        var c = PCE[group];
        var age = Math.min(79, Math.max(40, p.age));
        var lnAge = Math.log(age), lnTC = Math.log(p.totalChol),
            lnHDL = Math.log(p.hdl), lnSBP = Math.log(p.sbp);
        var lp = c.lnAge * lnAge + c.lnAge2 * lnAge * lnAge +
                 c.lnTC * lnTC + c.lnAgeTC * lnAge * lnTC +
                 c.lnHDL * lnHDL + c.lnAgeHDL * lnAge * lnHDL;
        if (p.bpTreated) lp += c.lnSBPtx * lnSBP + c.lnAgeSBPtx * lnAge * lnSBP;
        else lp += c.lnSBPuntx * lnSBP + c.lnAgeSBPuntx * lnAge * lnSBP;
        if (p.smoker) lp += c.smoker + c.lnAgeSmoker * lnAge;
        if (p.diabetes) lp += c.diabetes;
        var risk = 1 - Math.pow(c.s10, Math.exp(lp - c.meanLP));
        return Math.min(0.99, Math.max(0.001, risk));
    }

    // ---- CHA2DS2-VASc ----------------------------------------------------
    // Annual stroke/TE rate (%) without anticoagulation, by score.
    // Friberg 2012, Eur Heart J (n=90,490 AF patients, no anticoagulant).
    var CHADSVASC_ANNUAL_PCT = {
        0: 0.2, 1: 0.6, 2: 2.2, 3: 3.2, 4: 4.8,
        5: 7.2, 6: 9.7, 7: 11.2, 8: 10.8, 9: 12.2
    };

    /**
     * f = { age, sex, chf, htn, diabetes, priorStroke, vascular }
     * Returns { score, annualRatePct }
     */
    function chadsvasc(f) {
        var s = 0;
        if (f.chf) s += 1;
        if (f.htn) s += 1;
        if (f.age >= 75) s += 2; else if (f.age >= 65) s += 1;
        if (f.diabetes) s += 1;
        if (f.priorStroke) s += 2;
        if (f.vascular) s += 1;
        if (f.sex === 'female') s += 1;
        var capped = Math.min(9, s);
        return { score: s, annualRatePct: CHADSVASC_ANNUAL_PCT[capped] };
    }

    // ---- HAS-BLED --------------------------------------------------------
    // Pisters et al., Chest 2010 (Euro Heart Survey): major bleeds per 100
    // patient-years on anticoagulation, by score. Scores ≥5 extrapolated.
    // (Ported from the medeval calculator, meds.kevinkeet.com.)
    var HASBLED_ANNUAL_PCT = { 0: 1.13, 1: 1.02, 2: 1.88, 3: 3.74, 4: 8.70, 5: 12.50 };

    /**
     * f = { age, sbpOver160, renalImpaired (Cr>2.3 or eGFR<30), liverDisease,
     *       priorStroke, priorBleed, labileINR, antiplateletOrNSAID, alcohol }
     */
    function hasbled(f) {
        var s = 0;
        if (f.sbpOver160) s += 1;
        if (f.renalImpaired) s += 1;
        if (f.liverDisease) s += 1;
        if (f.priorStroke) s += 1;
        if (f.priorBleed) s += 1;
        if (f.labileINR) s += 1;
        if (f.age > 65) s += 1;
        if (f.antiplateletOrNSAID) s += 1;
        if (f.alcohol) s += 1;
        return { score: s, annualBleedPct: HASBLED_ANNUAL_PCT[Math.min(5, s)] || 12.5 };
    }

    // ---- CKD-EPI 2021 (race-free) eGFR ----------------------------------
    // Inker et al., NEJM 2021. (Ported from the medeval calculator.)
    function egfrCkdEpi2021(creatinine, age, sex) {
        if (!creatinine || !age) return null;
        var female = sex === 'female';
        var kappa = female ? 0.7 : 0.9;
        var alpha = female ? -0.241 : -0.302;
        var r = creatinine / kappa;
        var e = 142 *
            Math.pow(Math.min(r, 1), alpha) *
            Math.pow(Math.max(r, 1), -1.200) *
            Math.pow(0.9938, age) *
            (female ? 1.012 : 1);
        var stage = e >= 90 ? 'G1' : e >= 60 ? 'G2' : e >= 45 ? 'G3a' : e >= 30 ? 'G3b' : e >= 15 ? 'G4' : 'G5';
        return { egfr: Math.round(e), stage: stage };
    }

    return {
        PCE: PCE,
        pce10y: pce10y,
        CHADSVASC_ANNUAL_PCT: CHADSVASC_ANNUAL_PCT,
        chadsvasc: chadsvasc,
        HASBLED_ANNUAL_PCT: HASBLED_ANNUAL_PCT,
        hasbled: hasbled,
        egfrCkdEpi2021: egfrCkdEpi2021
    };
});
