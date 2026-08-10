/**
 * MedModel — computation engine.
 *
 * Individualizes RCT evidence with a discrete-time (monthly) cause-specific
 * hazards model. Two absorbing-ish causes are tracked while alive and
 * event-free: the index outcome and death from other causes (Gompertz).
 *
 * Adjustment chain (each step is a scenario the UI can display):
 *   1. baseline risk        — patient's hazard replaces the trial control arm's
 *   2. competing mortality  — patient's age/sex/health replaces the trial's
 *   3. time-to-benefit      — treatment effect ramps in over class-specific TTB
 *   4. adherence            — RRR diluted by expected vs in-trial adherence
 *
 * Methods and evidence for every step: medmodel/methods.html
 *
 * Pure functions, no DOM. Loads as window.BenefitModel in the browser and as a
 * CommonJS module under node (for medmodel/test/).
 */
(function (root, factory) {
    if (typeof module === 'object' && module.exports) {
        module.exports = factory();
    } else {
        root.BenefitModel = factory();
    }
})(typeof self !== 'undefined' ? self : this, function () {
    'use strict';

    var DT = 1 / 12; // monthly cycles

    // ---------------------------------------------------------------------
    // Other-cause mortality: Gompertz h(a) = A·e^(B·a), calibrated to the US
    // 2019/2023 period life tables (anchors: qx at 65 and 85 by sex; see
    // lifetables.js for the anchor values and sources). healthMult scales the
    // hazard; the named levels are calibrated in tests against the
    // Walter & Covinsky (JAMA 2001) life-expectancy quartiles.
    // ---------------------------------------------------------------------
    var GOMPERTZ = {
        male:   { A: 4.73e-5,  B: 0.0896 },
        female: { A: 1.647e-5, B: 0.0983 }
    };
    // Below ~50 Gompertz undershoots (external causes); floor keeps it sane.
    var MIN_ANNUAL_MORT = 0.0008;

    function otherCauseHazard(age, sex, healthMult) {
        var g = GOMPERTZ[sex] || GOMPERTZ.male;
        var h = g.A * Math.exp(g.B * age) * (healthMult || 1);
        return Math.max(h, MIN_ANNUAL_MORT * (healthMult || 1));
    }

    // Survival curve from other-cause mortality alone.
    // Returns { le: mean residual life expectancy (y), median: median survival (y),
    //           surv: function(tYears) -> P(alive) }
    function lifeExpectancy(age, sex, healthMult) {
        var s = 1, le = 0, median = null;
        var survAt = [1]; // index = month
        for (var m = 1; m <= 12 * 60; m++) {
            var a = age + (m - 0.5) * DT;
            var p = 1 - Math.exp(-otherCauseHazard(a, sex, healthMult) * DT);
            le += s * DT; // person-time lived during the month (start-of-month approx)
            s *= (1 - p);
            survAt.push(s);
            if (median === null && s <= 0.5) median = m * DT;
            if (s < 1e-6) break;
        }
        if (median === null) median = 60;
        return {
            le: le,
            median: median,
            surv: function (tYears) {
                var idx = Math.round(tYears / DT);
                if (idx < 0) idx = 0;
                if (idx >= survAt.length) return 0;
                return survAt[idx];
            }
        };
    }

    // ---------------------------------------------------------------------
    // Hazard conversions
    // ---------------------------------------------------------------------
    function cumRiskToAnnualHazard(risk, years) {
        if (risk >= 1) risk = 0.999;
        return -Math.log(1 - risk) / years;
    }
    function annualHazardToCumRisk(h, years) {
        return 1 - Math.exp(-h * years);
    }

    // ---------------------------------------------------------------------
    // Adherence dilution.
    // Under proportional hazards with an on/off effect, ITT effect observed in
    // the trial embeds trial adherence:  1-HR_trial = f_trial·(1-HR_bio).
    // A patient covered a fraction f_pt of days gets
    //   1-HR_pt = (f_pt/f_trial)·(1-HR_trial), capped at the biological effect.
    // ---------------------------------------------------------------------
    function effectiveHR(hrTrial, patientAdh, trialAdh) {
        if (hrTrial >= 1) return hrTrial; // harmful/no-benefit effects: don't "dilute" upward
        var fT = clamp(trialAdh == null ? 0.9 : trialAdh, 0.4, 1);
        var fP = clamp(patientAdh == null ? fT : patientAdh, 0, 1);
        var rrrTrial = 1 - hrTrial;
        var rrrBio = Math.min(rrrTrial / fT, 0.95); // implied fully-adherent effect
        var rrr = Math.min((fP / fT) * rrrTrial, rrrBio);
        return 1 - rrr;
    }

    // Time-to-benefit ramp: fraction of the full RRR realized at time t.
    // Linear ramp reaching 1 at ttbFull years (ttbFull = 0 → immediate).
    function ttbRamp(t, ttbFull) {
        if (!ttbFull || ttbFull <= 0) return 1;
        return Math.min(1, t / ttbFull);
    }

    function clamp(x, lo, hi) { return Math.min(hi, Math.max(lo, x)); }

    // ---------------------------------------------------------------------
    // Core scenario runner.
    //
    // opts = {
    //   horizonYears,
    //   annualEventHazard,        // untreated cause-specific hazard (per year)
    //   hr,                       // trial ITT hazard ratio (<1 = benefit)
    //   ttbYears,                 // time to full effect (0 = immediate)
    //   patientAdherence, trialAdherence,   // proportion-of-days-covered style
    //   age, sex, healthMult,     // competing mortality inputs
    //   eventHazardGrowth,        // optional annual multiplicative growth of h0
    //                             // (e.g., 1.05 ≈ event risk rising with age)
    // }
    //
    // Returns cumulative incidence of the event with/without treatment,
    // accounting for competing death, plus survival diagnostics.
    // ---------------------------------------------------------------------
    function runScenario(opts) {
        var H = opts.horizonYears;
        var steps = Math.round(H / DT);
        var growth = opts.eventHazardGrowth || 1;

        var hrEffFull = effectiveHR(opts.hr, opts.patientAdherence, opts.trialAdherence);

        var sU = 1, sT = 1;       // alive & event-free
        var cifU = 0, cifT = 0;   // cumulative incidence of FIRST event
        var evU = 0, evT = 0;     // expected event COUNT (recurrent outcomes:
                                  // person stays at risk after an event, so
                                  // integrate hazard over alive person-time)
        var aliveT = 1;           // alive regardless of event (other-cause only)
        var series = [];

        for (var m = 1; m <= steps; m++) {
            var t = m * DT;
            var aMid = opts.age + (t - DT / 2);
            var hOther = otherCauseHazard(aMid, opts.sex, opts.healthMult);
            var h0 = opts.annualEventHazard * Math.pow(growth, t - DT / 2);

            var ramp = ttbRamp(t, opts.ttbYears);
            var hrNow = 1 - (1 - hrEffFull) * ramp;
            var hT = h0 * hrNow;

            var pOth = 1 - Math.exp(-hOther * DT);
            var pU = 1 - Math.exp(-h0 * DT);
            var pT = 1 - Math.exp(-hT * DT);

            // cause-specific incidence with half-cycle competing correction
            cifU += sU * pU * (1 - pOth / 2);
            cifT += sT * pT * (1 - pOth / 2);
            sU *= (1 - pU) * (1 - pOth);
            sT *= (1 - pT) * (1 - pOth);
            evU += aliveT * h0 * DT;
            evT += aliveT * hT * DT;
            aliveT *= (1 - pOth);

            if (m % 12 === 0 || m === steps) {
                series.push({ t: t, cifU: cifU, cifT: cifT, arr: cifU - cifT });
            }
        }

        return {
            cifUntreated: cifU,
            cifTreated: cifT,
            arr: cifU - cifT,
            nnt: (cifU - cifT) > 1e-9 ? 1 / (cifU - cifT) : Infinity,
            eventsUntreated: evU,
            eventsTreated: evT,
            eventsPrevented: evU - evT,
            aliveAtHorizon: aliveT,
            hrEffective: hrEffFull,
            series: series
        };
    }

    // ---------------------------------------------------------------------
    // Harm scenario: excess absolute rate while exposed, no benefit ramp
    // (harms start at once), scaled by patient risk multipliers and by actual
    // exposure (adherence), with competing mortality.
    //
    // opts = { horizonYears, excessAnnualRate, multiplier, patientAdherence,
    //          age, sex, healthMult, oneTimeFraction }
    // oneTimeFraction: portion of the harm that is an early/idiosyncratic
    // one-off (applied in year 1 regardless of later persistence).
    // ---------------------------------------------------------------------
    function runHarm(opts) {
        var H = opts.horizonYears;
        var steps = Math.round(H / DT);
        var f = clamp(opts.patientAdherence == null ? 1 : opts.patientAdherence, 0, 1);
        var hHarm = Math.max(0, opts.excessAnnualRate) * (opts.multiplier || 1) * f;

        var s = 1, cif = 0;
        for (var m = 1; m <= steps; m++) {
            var aMid = opts.age + m * DT - DT / 2;
            var pOth = 1 - Math.exp(-otherCauseHazard(aMid, opts.sex, opts.healthMult) * DT);
            var pH = 1 - Math.exp(-hHarm * DT);
            cif += s * pH * (1 - pOth / 2);
            s *= (1 - pH) * (1 - pOth);
        }
        return {
            cif: cif,
            nnh: cif > 1e-9 ? 1 / cif : Infinity,
            annualExcess: hHarm
        };
    }

    // ---------------------------------------------------------------------
    // The adjustment waterfall: a canonical sequence of scenarios from
    // "trial conditions" to "this patient", attributing the change in ARR to
    // each adjustment. Returns the steps plus final benefit outputs.
    //
    // input = {
    //   horizonYears,
    //   trial: { annualControlHazard, hr, meanAge, sex ('mixed' allowed),
    //            adherence, ttbYears, eventHazardGrowth },
    //   patient: { annualEventHazard, age, sex, healthMult, adherence }
    // }
    // ---------------------------------------------------------------------
    function waterfall(input) {
        var H = input.horizonYears;
        var tr = input.trial, pt = input.patient;
        var trialSex = tr.sex === 'female' ? 'female' : (tr.sex === 'male' ? 'male' : 'mixed');

        // For 'mixed' trial populations use the average of male/female hazards.
        function trialScenario(over) {
            var base = {
                horizonYears: H,
                annualEventHazard: tr.annualControlHazard,
                hr: tr.hr,
                ttbYears: tr.ttbYears || 0,
                patientAdherence: tr.adherence,
                trialAdherence: tr.adherence,
                age: tr.meanAge,
                sex: trialSex === 'mixed' ? 'male' : trialSex,
                healthMult: tr.healthMult || 1,
                eventHazardGrowth: tr.eventHazardGrowth || 1
            };
            for (var k in over) base[k] = over[k];
            if (trialSex === 'mixed' && !over.sexResolved) {
                var m = runScenario(assign({}, base, { sex: 'male' }));
                var f = runScenario(assign({}, base, { sex: 'female' }));
                return averageScenario(m, f);
            }
            return runScenario(base);
        }

        // Step 0 — trial replication: trial baseline risk, trial demographics,
        // trial adherence. Should approximate the published ARR (calibration).
        var s0 = trialScenario({});

        // Step 1 — your baseline risk.
        var s1 = trialScenario({ annualEventHazard: pt.annualEventHazard });

        // Step 2 — your age/sex/health (competing mortality + horizon truncation).
        var s2 = trialScenario({
            annualEventHazard: pt.annualEventHazard,
            age: pt.age, sex: pt.sex, healthMult: pt.healthMult,
            sexResolved: true
        });

        // Step 3 — your expected adherence.
        var s3 = trialScenario({
            annualEventHazard: pt.annualEventHazard,
            age: pt.age, sex: pt.sex, healthMult: pt.healthMult,
            patientAdherence: pt.adherence,
            sexResolved: true
        });

        var life = lifeExpectancy(pt.age, pt.sex, pt.healthMult);

        return {
            steps: [
                { key: 'trial',     label: 'Trial population, trial conditions', result: s0 },
                { key: 'baseline',  label: 'Your baseline risk',                 result: s1 },
                { key: 'competing', label: 'Your age, sex & overall health',     result: s2 },
                { key: 'adherence', label: 'Your expected adherence',            result: s3 }
            ],
            final: s3,
            life: life,
            ttbYears: tr.ttbYears || 0,
            ttbExceedsSurvival: (tr.ttbYears || 0) > 0 && life.median < (tr.ttbYears || 0)
        };
    }

    function averageScenario(a, b) {
        function avg(x, y) { return (x + y) / 2; }
        var series = a.series.map(function (p, i) {
            var q = b.series[i] || p;
            return { t: p.t, cifU: avg(p.cifU, q.cifU), cifT: avg(p.cifT, q.cifT), arr: avg(p.arr, q.arr) };
        });
        var arr = avg(a.arr, b.arr);
        return {
            cifUntreated: avg(a.cifUntreated, b.cifUntreated),
            cifTreated: avg(a.cifTreated, b.cifTreated),
            arr: arr,
            nnt: arr > 1e-9 ? 1 / arr : Infinity,
            eventsUntreated: avg(a.eventsUntreated || 0, b.eventsUntreated || 0),
            eventsTreated: avg(a.eventsTreated || 0, b.eventsTreated || 0),
            eventsPrevented: avg(a.eventsPrevented || 0, b.eventsPrevented || 0),
            aliveAtHorizon: avg(a.aliveAtHorizon, b.aliveAtHorizon),
            hrEffective: a.hrEffective,
            series: series
        };
    }

    function assign(target) {
        for (var i = 1; i < arguments.length; i++) {
            var src = arguments[i];
            for (var k in src) target[k] = src[k];
        }
        return target;
    }

    return {
        DT: DT,
        otherCauseHazard: otherCauseHazard,
        lifeExpectancy: lifeExpectancy,
        cumRiskToAnnualHazard: cumRiskToAnnualHazard,
        annualHazardToCumRisk: annualHazardToCumRisk,
        effectiveHR: effectiveHR,
        ttbRamp: ttbRamp,
        runScenario: runScenario,
        runHarm: runHarm,
        waterfall: waterfall
    };
});
