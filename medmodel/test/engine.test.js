/**
 * MedModel engine tests — run with:  node medmodel/test/engine.test.js
 * No framework; process exits 1 on failure.
 */
'use strict';
const path = require('path');
const M = require(path.join(__dirname, '..', 'js', 'engine.js'));
const R = require(path.join(__dirname, '..', 'js', 'data', 'riskmodels.js'));
const L = require(path.join(__dirname, '..', 'js', 'data', 'lifetables.js'));

let failures = 0;
function check(name, cond, detail) {
    if (cond) { console.log('  ok  ' + name); }
    else { failures++; console.error('FAIL  ' + name + (detail ? '  [' + detail + ']' : '')); }
}
function approx(a, b, tol) { return Math.abs(a - b) <= tol; }

// ---------------------------------------------------------------------------
console.log('\n— Pooled Cohort Equations vs published worked examples —');
// Goff 2013 appendix: 55 y, TC 213, HDL 50, SBP 120 untreated, nonsmoker, no DM
const base = { age: 55, totalChol: 213, hdl: 50, sbp: 120, bpTreated: false, smoker: false, diabetes: false };
const cases = [
    { sex: 'female', race: 'other', expect: 0.021, label: 'white woman 2.1%' },
    { sex: 'female', race: 'black', expect: 0.030, label: 'black woman 3.0%' },
    { sex: 'male',   race: 'other', expect: 0.053, label: 'white man 5.3%' },
    { sex: 'male',   race: 'black', expect: 0.061, label: 'black man 6.1%' }
];
for (const c of cases) {
    const risk = R.pce10y(Object.assign({}, base, c));
    check('PCE ' + c.label, approx(risk, c.expect, 0.0016), 'got ' + (risk * 100).toFixed(2) + '%');
}

// ---------------------------------------------------------------------------
console.log('\n— Life expectancy vs US life tables (average health) —');
// NCHS "United States Life Tables, 2022" (Arias et al.): e65 = 17.5 (M) / 20.2 (F);
// e75 ≈ 10.9 / 12.7; e85 ≈ 5.7 / 6.8
const leChecks = [
    { age: 65, sex: 'male', expect: 17.5 }, { age: 65, sex: 'female', expect: 20.2 },
    { age: 75, sex: 'male', expect: 10.9 }, { age: 75, sex: 'female', expect: 12.7 },
    { age: 85, sex: 'male', expect: 5.7 },  { age: 85, sex: 'female', expect: 6.8 }
];
for (const c of leChecks) {
    const le = M.lifeExpectancy(c.age, c.sex, 1).le;
    check(`e${c.age} ${c.sex} ≈ ${c.expect}`, approx(le, c.expect, 1.6), 'got ' + le.toFixed(1));
}

console.log('\n— Health levels vs Walter & Covinsky quartiles —');
// excellent(0.45)≈top quartile, average(1.0)≈median, poor(2.9)≈bottom quartile
for (const sex of ['male', 'female']) {
    for (const age of [70, 75, 80, 85]) {
        const ref = L.WALTER_COVINSKY[sex][age];
        const hi = M.lifeExpectancy(age, sex, 0.55).le;
        const md = M.lifeExpectancy(age, sex, 1.0).le;
        const lo = M.lifeExpectancy(age, sex, 2.9).le;
        check(`${sex} ${age} top-quartile ≈ ${ref.q75}`, approx(hi, ref.q75, 2.6), 'got ' + hi.toFixed(1));
        check(`${sex} ${age} median ≈ ${ref.med}`, approx(md, ref.med, 2.2), 'got ' + md.toFixed(1));
        check(`${sex} ${age} bottom-quartile ≈ ${ref.q25}`, approx(lo, ref.q25, 2.0), 'got ' + lo.toFixed(1));
    }
}

// ---------------------------------------------------------------------------
console.log('\n— Adherence dilution —');
check('full trial adherence reproduces trial HR',
    approx(M.effectiveHR(0.75, 0.88, 0.88), 0.75, 1e-9));
check('half adherence halves the RRR',
    approx(M.effectiveHR(0.75, 0.44, 0.88), 1 - 0.5 * 0.25, 1e-9));
check('zero adherence → HR 1', approx(M.effectiveHR(0.75, 0, 0.88), 1, 1e-9));
check('super-adherence capped at implied biological effect',
    approx(M.effectiveHR(0.75, 1.0, 0.88), 1 - 0.25 / 0.88, 1e-9));

// ---------------------------------------------------------------------------
console.log('\n— Trial round-trips (model reproduces published ARR/NNT) —');
// SPRINT (NEJM 2015): control 2.19%/y, HR 0.75, median 3.26 y, mean age 68.
// Published: ~1.6% ARR → NNT ≈ 61 over 3.26 y.
{
    const s = M.runScenario({
        horizonYears: 3.26, annualEventHazard: 0.0219, hr: 0.75, ttbYears: 1,
        patientAdherence: 0.88, trialAdherence: 0.88,
        age: 68, sex: 'male', healthMult: 0.9
    });
    check('SPRINT-like NNT ≈ 61 (±15)', approx(s.nnt, 61, 15), 'got ' + s.nnt.toFixed(0));
}
// DAPA-HF (NEJM 2019): 21.2% → 16.3% over 1.5 y (HR 0.74) → NNT ≈ 21.
{
    const h = M.cumRiskToAnnualHazard(0.212, 1.5);
    const s = M.runScenario({
        horizonYears: 1.5, annualEventHazard: h, hr: 0.74, ttbYears: 0.08,
        patientAdherence: 0.9, trialAdherence: 0.9,
        age: 66, sex: 'male', healthMult: 1
    });
    check('DAPA-HF-like NNT ≈ 21 (±4)', approx(s.nnt, 21, 4), 'got ' + s.nnt.toFixed(0));
}

// ---------------------------------------------------------------------------
console.log('\n— Competing risk & TTB behavior —');
{
    const common = { horizonYears: 10, annualEventHazard: 0.02, hr: 0.75, ttbYears: 2.5, patientAdherence: 0.9, trialAdherence: 0.9, sex: 'male' };
    const young = M.runScenario(Object.assign({}, common, { age: 55, healthMult: 0.75 }));
    const oldFrail = M.runScenario(Object.assign({}, common, { age: 87, healthMult: 2.9 }));
    check('same baseline risk: frail 87yo gains far less than healthy 55yo',
        oldFrail.arr < 0.55 * young.arr, `young ${(young.arr * 1000).toFixed(1)} vs frail ${(oldFrail.arr * 1000).toFixed(1)} per 1000`);

    const life = M.lifeExpectancy(87, 'male', 2.9);
    check('frail 87yo median survival < 5y (context for TTB flags)', life.median < 5, 'median ' + life.median.toFixed(1));

    // With a TTB longer than remaining life, ARR should collapse toward 0.
    const longTTB = M.runScenario(Object.assign({}, common, { age: 87, healthMult: 2.9, ttbYears: 8 }));
    check('TTB ≫ survival collapses benefit', longTTB.arr < 0.5 * oldFrail.arr,
        `ttb8 ${(longTTB.arr * 1000).toFixed(2)} vs ttb2.5 ${(oldFrail.arr * 1000).toFixed(2)} per 1000`);

    // Monotonic in adherence
    const lowAdh = M.runScenario(Object.assign({}, common, { age: 55, healthMult: 0.75, patientAdherence: 0.45 }));
    check('lower adherence → smaller ARR', lowAdh.arr < young.arr);
}

// ---------------------------------------------------------------------------
console.log('\n— Waterfall consistency —');
{
    const wf = M.waterfall({
        horizonYears: 5,
        trial: { annualControlHazard: 0.022, hr: 0.75, meanAge: 63, sex: 'mixed', adherence: 0.88, ttbYears: 2.5 },
        patient: { annualEventHazard: 0.012, age: 82, sex: 'female', healthMult: 1.7, adherence: 0.6 }
    });
    check('waterfall has 4 steps', wf.steps.length === 4);
    check('final equals last step', approx(wf.final.arr, wf.steps[3].result.arr, 1e-12));
    const arrs = wf.steps.map(s => s.result.arr);
    check('each adjustment reduces ARR in this scenario',
        arrs[1] < arrs[0] && arrs[2] < arrs[1] && arrs[3] < arrs[2],
        arrs.map(a => (a * 1000).toFixed(1)).join(' → '));
    check('life summary present', wf.life.le > 0 && wf.life.median > 0);
}

// ---------------------------------------------------------------------------
console.log('\n— Harm model —');
{
    const harm = M.runHarm({ horizonYears: 5, excessAnnualRate: 0.002, multiplier: 2, patientAdherence: 0.9, age: 80, sex: 'male', healthMult: 1.7 });
    check('harm CIF positive and < naive rate·t', harm.cif > 0 && harm.cif < 0.002 * 2 * 5,
        'got ' + (harm.cif * 1000).toFixed(1) + '/1000');
    const harmYoung = M.runHarm({ horizonYears: 5, excessAnnualRate: 0.002, multiplier: 2, patientAdherence: 0.9, age: 55, sex: 'male', healthMult: 1 });
    check('competing death also trims harms in the frail', harm.cif < harmYoung.cif);
}

// ---------------------------------------------------------------------------
console.log('\n— CHA2DS2-VASc —');
{
    const f = R.chadsvasc({ age: 78, sex: 'female', chf: false, htn: true, diabetes: true, priorStroke: false, vascular: false });
    check('score computes (78F htn dm = 5)', f.score === 5, 'got ' + f.score);
    check('rate table lookup', f.annualRatePct === 7.2, 'got ' + f.annualRatePct);
}

console.log(failures === 0 ? '\nAll checks passed.' : `\n${failures} FAILURES`);
process.exit(failures ? 1 : 0);
