/**
 * Lift-service + new risk-model tests — run with: node medmodel/test/lift.test.js
 */
'use strict';
const path = require('path');
const R = require(path.join(__dirname, '..', 'js', 'data', 'riskmodels.js'));
const Lift = require(path.join(__dirname, '..', 'js', 'services', 'lift.js'));
const Lib = require(path.join(__dirname, '..', 'js', 'data', 'medications.js'));

let failures = 0;
function check(name, cond, detail) {
    if (cond) console.log('  ok  ' + name);
    else { failures++; console.error('FAIL  ' + name + (detail ? '  [' + detail + ']' : '')); }
}
function approx(a, b, tol) { return Math.abs(a - b) <= tol; }

console.log('\n— CKD-EPI 2021 (hand-computed check values) —');
{
    const f = R.egfrCkdEpi2021(1.2, 65, 'female');
    check('65F Scr 1.2 → eGFR ≈ 50', approx(f.egfr, 50, 1), 'got ' + f.egfr);
    check('stage G3a', f.stage === 'G3a', f.stage);
    const m = R.egfrCkdEpi2021(1.0, 55, 'male');
    check('55M Scr 1.0 → eGFR ≈ 89', approx(m.egfr, 89, 1), 'got ' + m.egfr);
    const s = R.egfrCkdEpi2021(2.6, 80, 'male');
    check('80M Scr 2.6 → CKD 4 range', s.egfr >= 15 && s.egfr < 30, 'got ' + s.egfr);
}

console.log('\n— HAS-BLED —');
{
    const h = R.hasbled({ age: 78, priorBleed: true, antiplateletOrNSAID: true });
    check('78yo + prior bleed + antiplatelet = 3 → 3.74%/y', h.score === 3 && h.annualBleedPct === 3.74,
        'score ' + h.score + ' rate ' + h.annualBleedPct);
    const lo = R.hasbled({ age: 60 });
    check('young, no factors → score 0, ~1.1%/y', lo.score === 0 && lo.annualBleedPct === 1.13);
}

console.log('\n— Catalog build —');
const cat = Lift.buildCatalog();
{
    check('63 catalog entries (60 medeval + 3 strategies)', cat.length === 63, 'got ' + cat.length);
    const modelable = cat.filter(c => c.indications.some(i => i.outcomes.length || i.deepId));
    check('≥40 entries produce modelable indications', modelable.length >= 40, 'got ' + modelable.length);
    const gaba = cat.find(c => c.key === 'gabapentin');
    check('gabapentin (symptomatic) has NO lifted outcomes', gaba.indications.every(i => i.outcomes.length === 0));
    check('gabapentin harms still lift (falls per-1000)', gaba.harms.length >= 1);
}

console.log('\n— Lift math vs hand-verified entries —');
{
    // DAPA-HF: medeval {rrr .26, nnt 17, tf 1.5} vs my hand entry (HR .74, annual control ~.147)
    const dapa = cat.find(c => c.key === 'dapagliflozin').indications.find(i => i.id === 'heart_failure');
    const o = dapa.outcomes.find(o => o.key === 'cv_death_hf_hosp');
    check('lifted DAPA-HF HR ≈ 0.74', approx(o.hr, 0.74, 0.001), 'got ' + o.hr);
    check('lifted DAPA-HF annual control rate ≈ hand entry (0.147 ± 0.02)',
        approx(o.annualControlRate, 0.147, 0.02), 'got ' + o.annualControlRate.toFixed(3));
    check('deep overlay wired (dapagliflozin.heart_failure → dapagliflozin-hf)',
        dapa.deepId === 'dapagliflozin-hf');
}
{
    // DOAC composition vs no antithrombotic
    const dabi = cat.find(c => c.key === 'dabigatran').indications.find(i => i.id === 'afib_stroke_prevention');
    const o = dabi.outcomes.find(o => /stroke/.test(o.key));
    check('dabigatran net HR vs none ≈ 0.36×0.66 ≈ 0.24', approx(o.hr, 0.2376, 0.01), 'got ' + o.hr);
    check('chadsvasc baseline type', o.baselineType === 'chadsvasc');
    const warf = cat.find(c => c.key === 'warfarin').indications.find(i => i.id === 'afib_stroke_prevention');
    const wo = warf.outcomes.find(o => /stroke/.test(o.key));
    check('warfarin HR vs none = 0.36 (Hart)', approx(wo.hr, 0.36, 0.001), 'got ' + wo.hr);
}
{
    // Harm lifting: alendronate AFF NNH 1000 over 5y → 0.0002/y
    const alen = cat.find(c => c.key === 'alendronate');
    const aff = alen.harms.find(h => h.id === 'atypical_femur_fracture');
    check('AFF lifted to ~2/10,000/y', approx(aff.excessAnnualRate, 0.0002, 0.00005), 'got ' + aff.excessAnnualRate);
    check('AFF severity serious (weight 0.4)', aff.severity === 'serious');
}

console.log('\n— Deep map integrity —');
{
    const ids = new Set(Lib.meds.map(m => m.id));
    let allOk = true;
    for (const c of cat) {
        for (const i of c.indications) {
            if (i.deepId && !ids.has(i.deepId)) { allOk = false; console.error('   missing deep id ' + i.deepId); }
        }
    }
    check('every deepId resolves to a verified entry', allOk);
    const strategies = cat.filter(c => c.isStrategy);
    check('3 strategy entries with deep ids', strategies.length === 3 && strategies.every(s => s.indications[0].deepId));
}

console.log('\n— Contraindication matching —');
{
    const hits = Lift.contraindicationCheck(['egfr_below_30', 'dialysis', 'pregnancy'], { egfr: 24 });
    check('eGFR 24 trips egfr_below_30 only', hits.length === 1 && /eGFR <30/.test(hits[0]), JSON.stringify(hits));
}

console.log(failures === 0 ? '\nAll lift checks passed.' : `\n${failures} FAILURES`);
process.exit(failures ? 1 : 0);
