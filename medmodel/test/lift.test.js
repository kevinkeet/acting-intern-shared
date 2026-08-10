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

console.log('\n— Goals-of-care thresholds & recommendation ladder (ported) —');
{
    check('4 GOC levels with original thresholds', Lift.GOC.length === 4 &&
        Lift.GOC[0].threshold === 3.0 && Lift.GOC[1].threshold === 1.0 &&
        Lift.GOC[2].threshold === 0.3 && Lift.GOC[3].threshold === 0.0);
    const base = { age: 70, frail: false, safety: { severity: null, beers: null, avoid: false }, highBurden: false, annualCost: 100, costSensitivity: 'moderate', contraHit: false };
    check('net 5 → strongly recommended', Lift.recommend(Object.assign({}, base, { netAnnualPer100: 5, goc: 3 })).tier === 'strong');
    check('net 0.5 fails comfort threshold', Lift.recommend(Object.assign({}, base, { netAnnualPer100: 0.5, goc: 1 })).tier === 'marginal');
    check('net 0.5 passes proactive threshold', Lift.recommend(Object.assign({}, base, { netAnnualPer100: 0.5, goc: 4 })).tier === 'recommended');
    check('negative net → not recommended', Lift.recommend(Object.assign({}, base, { netAnnualPer100: -1, goc: 4 })).tier === 'not-recommended');
    check('contraindication → held out', Lift.recommend(Object.assign({}, base, { netAnnualPer100: 5, goc: 3, contraHit: true })).tier === 'held-out');
    check('high burden + selective goals → consider', Lift.recommend(Object.assign({}, base, { netAnnualPer100: 1.5, goc: 2, highBurden: true })).tier === 'consider');
    check('expensive + cost-sensitive → consider', Lift.recommend(Object.assign({}, base, { netAnnualPer100: 1.5, goc: 3, annualCost: 6000, costSensitivity: 'high' })).tier === 'consider');
}

console.log('\n— Beers / elderly safety (ported checkElderlySafety) —');
{
    const frail80 = Lift.elderlySafety('gabapentin', { age: 80, frail: true, fallRisk: false, dementia: false, hf: false });
    check('gabapentin at 80 + frail → high severity', frail80.severity === 'high', JSON.stringify(frail80.warnings));
    check('… and avoid-in-frail fires', frail80.avoid === true);
    const young = Lift.elderlySafety('gabapentin', { age: 50, frail: false, fallRisk: false, dementia: false, hf: false });
    check('gabapentin at 50 → no warnings', young.warnings.length === 0 && !young.beers);
    const glip = Lift.elderlySafety('glipizide', { age: 78, frail: false, fallRisk: false, dementia: false, hf: false });
    check('glipizide at 78 flags hypoglycemia/Beers', !!(glip.beers || glip.warnings.length), JSON.stringify(glip));
}

console.log('\n— Goal-conditional severity weights —');
{
    check('balanced = base weights', Lift.gocWeight('mortality', 3) === 1.0 && Lift.gocWeight('gout_flares', 3) === 0.02);
    check('comfort halves survival weight', approx(Lift.gocWeight('mortality', 1), 0.5, 1e-9));
    check('comfort upweights symptomatic 1.75×', approx(Lift.gocWeight('gout_flares', 1), 0.035, 1e-9));
    check('comfort upweights disabling stroke', approx(Lift.gocWeight('stroke', 1), 0.4 * 1.15, 1e-9));
    check('proactive upweights survival', approx(Lift.gocWeight('mortality', 4), 1.15, 1e-9));
    check('severe hypoglycemia classed symptomatic', Lift.outcomeClass('severe_hypoglycemia') === 'symptomatic');
    check('ICH classed disabling', Lift.outcomeClass('intracranial_bleeding') === 'disabling');
    check('baseOverride honored', approx(Lift.gocWeight('unknown_thing', 3, 0.2), 0.2, 1e-9));
}

console.log('\n— Co-therapy rules —');
{
    const item = k => cat.find(c => c.key === k);
    const aspOnWarf = Lift.cotherapyCheck(item('aspirin'), [item('warfarin'), item('metformin')]);
    check('aspirin + warfarin → demote aspirin (AFIRE)', aspOnWarf.length === 1 && aspOnWarf[0].demoted === true, JSON.stringify(aspOnWarf));
    const warfSide = Lift.cotherapyCheck(item('warfarin'), [item('aspirin')]);
    check('warfarin side flagged but not demoted', warfSide.length === 1 && warfSide[0].demoted === false);
    const arbOnAcei = Lift.cotherapyCheck(item('losartan'), [item('lisinopril')]);
    check('ARB + ACEi → never-combine', arbOnAcei.length === 1 && arbOnAcei[0].neverCombine === true, JSON.stringify(arbOnAcei.map(h => h.text.slice(0, 30))));
    const suOnInsulin = Lift.cotherapyCheck(item('glipizide'), [item('insulin_basal')]);
    check('sulfonylurea + insulin → demote SU', suOnInsulin.length === 1 && suOnInsulin[0].demoted === true);
    const clean = Lift.cotherapyCheck(item('atorvastatin'), [item('warfarin'), item('lisinopril')]);
    check('statin has no co-therapy hits', clean.length === 0);
}

console.log('\n— Lifted harm scaling (ported eGFR/age rules) —');
{
    const hyperK = Lift.liftedHarmMultiplier('hyperkalemia_severe', { age: 76, egfr: 28, diabetes: true });
    check('hyperkalemia at eGFR 28 + DM ≈ ×4.1', approx(hyperK.mult, 3.3 * 1.25, 0.01), 'got ' + hyperK.mult);
    const hypo = Lift.liftedHarmMultiplier('severe_hypoglycemia', { age: 87, egfr: 26, dementia: true });
    check('hypoglycemia 87yo/CKD/dementia ≈ ×3.6', approx(hypo.mult, 1.7 * 1.4 * 1.5, 0.01), 'got ' + hypo.mult);
    const none = Lift.liftedHarmMultiplier('pneumonia_copd', { age: 87, egfr: 26 });
    check('unrelated harm unscaled', none.mult === 1);
    check('AFF duration: <3y ×0.4, ≥8y ×7', Lift.affDurationMultiplier(2).mult === 0.4 && Lift.affDurationMultiplier(9).mult === 7.0);
    check('AFF duration: unknown → ×1', Lift.affDurationMultiplier(null).mult === 1);
}

console.log('\n— Correlated-comorbidity damping (lifetables) —');
{
    const L2 = require(path.join(__dirname, '..', 'js', 'data', 'lifetables.js'));
    const poorAlone = L2.combinedMultiplier('poor', []);
    const poorStacked = L2.combinedMultiplier('poor', [3.0, 2.5]);
    check('poor + CKD4 + dementia ≤ poor × 1.4 ceiling', poorStacked <= poorAlone * 1.4 + 1e-9, 'got ' + poorStacked.toFixed(2) + ' vs alone ' + poorAlone);
    check('…but still worse than poor alone', poorStacked > poorAlone);
    const exHf = L2.combinedMultiplier('excellent', [1.8]);
    check('excellent + HF ≈ 0.55 × 1.8 (full weight when level is healthy)', approx(exHf, 0.55 * 1.8, 0.02), 'got ' + exHf.toFixed(2));
    const avgStack = L2.combinedMultiplier('average', [3.0, 2.5, 2.0]);
    check('average + 3 conditions capped at ×2.4 ceiling', avgStack <= 2.4 + 1e-9, 'got ' + avgStack.toFixed(2));
}

console.log('\n— Preference-modulated burden (ported) —');
{
    const item = { burdenTier: 'moderate', annualCost: 6000, monitoring: 'INR weekly' };
    const eff = Lift.effectiveBurden(item, { pills: 'low', cost: 'high', monitoring: 'low' });
    check('low pill tolerance bumps tier to high', eff.tier === 'high');
    check('cost + monitoring intolerance add penalty', eff.penalty > Lift.BURDEN_PENALTIES.high, 'got ' + eff.penalty);
    const eff2 = Lift.effectiveBurden(item, { pills: 'moderate', cost: 'low', monitoring: 'high' });
    check('neutral prefs keep base tier/penalty', eff2.tier === 'moderate' && eff2.penalty === Lift.BURDEN_PENALTIES.moderate);
}

console.log(failures === 0 ? '\nAll lift checks passed.' : `\n${failures} FAILURES`);
process.exit(failures ? 1 : 0);
