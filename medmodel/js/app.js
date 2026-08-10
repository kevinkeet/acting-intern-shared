/**
 * MedBenefit — application wiring (v3, the true merge).
 *
 * The original meds.kevinkeet.com product supplies the consultation spine:
 * full intake + EMR quick-import → goals of care (with net-benefit
 * thresholds) → current medications → a review with a risk dashboard,
 * recommendation tiers, and Beers/elderly safety. The competing-hazards
 * engine (engine.js) supplies every number underneath, and the
 * single-medication deep dive remains the drill-down.
 */
(function () {
    'use strict';

    var E = window.BenefitModel;
    var L = window.LifeTables;
    var R = window.RiskModels;
    var Lib = window.MedLibrary;
    var Lift = window.Lift;

    var CATALOG = Lift.buildCatalog();

    // ------------------------------------------------------------------
    // Conditions, grouped as in the original intake
    // ------------------------------------------------------------------
    var COND_GROUPS = {
        'cond-cardiac': [
            { id: 'afib',        label: 'Atrial fibrillation / flutter' },
            { id: 'hf',          label: 'History of heart failure' },
            { id: 'priorMI',     label: 'Prior MI' },
            { id: 'pad',         label: 'Peripheral artery disease' },
            { id: 'priorStroke', label: 'Prior stroke / TIA' },
            { id: 'htn',         label: 'Hypertension' }
        ],
        'cond-bleeding': [
            { id: 'priorBleed',   label: 'Prior major bleeding' },
            { id: 'anemia',       label: 'Anemia' },
            { id: 'liverDisease', label: 'Liver disease' },
            { id: 'alcohol',      label: 'Heavy alcohol (≥8/wk)' },
            { id: 'antiplatelet', label: 'On antiplatelet / NSAID' },
            { id: 'fallRisk',     label: 'High fall risk' }
        ],
        'cond-other': [
            { id: 'copd',         label: 'COPD' },
            { id: 'copdO2',       label: 'COPD on home O₂' },
            { id: 'asthma',       label: 'Asthma' },
            { id: 'osteoporosis', label: 'Osteoporosis' },
            { id: 'gout',         label: 'Gout' },
            { id: 'dementia',     label: 'Dementia / cognitive impairment' },
            { id: 'cancer',       label: 'Metastatic cancer' },
            { id: 'ckd45',        label: 'CKD 4–5 (eGFR <30)' },
            { id: 'neuropathy',   label: 'Neuropathic / chronic pain' },
            { id: 'depression',   label: 'Depression / anxiety' },
            { id: 'hypothyroidism', label: 'Hypothyroidism' }
        ]
    };

    var HEALTH_RANK = { excellent: 0, good: 1, average: 2, fair: 3, poor: 4 };

    var state = {
        age: 76, sex: 'female', race: 'other',
        sbp: 138, weightKg: null, heightCm: null,
        totalChol: 200, hdl: 50, ldl: null, a1c: null,
        creatinine: null, egfrOverride: null,
        bpTreated: true, smoker: false,
        ef: null, nyha: 0,
        diabetesStatus: 'none',
        conditions: {},
        health: 'average', adherence: 'typical',
        goc: 3,
        prefs: { pills: 'moderate', cost: 'moderate', monitoring: 'moderate' },
        horizon: 5,
        view: 'review',
        selection: null,
        anchored: {},
        currentMeds: {},
        regimenAdded: {}
    };

    function $(sel) { return document.querySelector(sel); }
    function el(html) {
        var t = document.createElement('template');
        t.innerHTML = html.trim();
        return t.content.firstChild;
    }
    function esc(s) {
        return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
            return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
        });
    }

    // ------------------------------------------------------------------
    // Derived patient facts
    // ------------------------------------------------------------------
    function has(id) {
        if (id === 'diabetes') return state.diabetesStatus === 'type2' || state.diabetesStatus === 'type1';
        if (id === 'prediabetes') return state.diabetesStatus === 'prediabetes';
        if (id === 'asian') return state.race === 'asian';
        if (id === 'efLow') return state.ef != null && state.ef < 40;
        if (id === 'vascular') return !!state.conditions.priorMI || !!state.conditions.pad;
        return !!state.conditions[id];
    }
    function adhValue() {
        var lv = Lib.ADHERENCE_LEVELS.find(function (a) { return a.id === state.adherence; });
        return lv ? lv.value : 0.65;
    }
    function egfr() {
        if (state.egfrOverride) {
            var e = state.egfrOverride;
            return { egfr: e, stage: e >= 90 ? 'G1' : e >= 60 ? 'G2' : e >= 45 ? 'G3a' : e >= 30 ? 'G3b' : e >= 15 ? 'G4' : 'G5', source: 'entered' };
        }
        if (!state.creatinine) return null;
        var r = R.egfrCkdEpi2021(state.creatinine, state.age, state.sex);
        if (r) r.source = 'CKD-EPI 2021';
        return r;
    }
    function bmi() {
        if (!state.weightKg || !state.heightCm) return null;
        return state.weightKg / Math.pow(state.heightCm / 100, 2);
    }
    function frailish() { return state.health === 'fair' || state.health === 'poor'; }

    function healthMult() {
        var ids = Object.keys(state.conditions).filter(function (id) { return state.conditions[id]; })
            .filter(function (id) { return ['dementia', 'copdO2', 'ckd45', 'cancer'].indexOf(id) >= 0; });
        var m = L.totalMultiplier(state.health, ids);
        // HF: NYHA-graded multiplier when class known, else flat HF factor
        if (has('hf') || state.nyha > 0) {
            var hfMult = state.nyha > 0 ? (L.NYHA_HF_MULT[state.nyha] || 1.6) : 1.8;
            m = Math.min(L.MAX_TOTAL_MULT, m * hfMult);
        }
        var eg = egfr();
        if (!has('ckd45') && eg && eg.egfr < 30) m = Math.min(L.MAX_TOTAL_MULT, m * 3.0);
        return m;
    }

    function beersCtx() {
        return { age: state.age, frail: frailish(), fallRisk: has('fallRisk'), dementia: has('dementia'), hf: has('hf') || state.nyha > 0 };
    }

    function fmt1000(x) {
        var v = x * 1000;
        if (v > 0 && v < 0.1) return '<0.1';
        if (v < 10) return (Math.round(v * 10) / 10).toString();
        return Math.round(v).toString();
    }
    function fmtPct(x, dp) {
        var p = x * 100;
        return p.toFixed(dp != null ? dp : (p < 10 ? 1 : 0)) + '%';
    }
    function fmtNNT(nnt) {
        if (!isFinite(nnt) || nnt > 2000) return '—';
        return Math.round(nnt).toString();
    }

    function hasbledFor(medKey) {
        var eg = egfr();
        return R.hasbled({
            age: state.age,
            sbpOver160: state.sbp > 160,
            renalImpaired: has('ckd45') || (eg && eg.egfr < 30) || (state.creatinine && state.creatinine > 2.3),
            liverDisease: has('liverDisease'),
            priorStroke: has('priorStroke'),
            priorBleed: has('priorBleed') || has('anemia'),
            labileINR: medKey === 'warfarin' && state.adherence === 'low',
            antiplateletOrNSAID: has('antiplatelet'),
            alcohol: has('alcohol')
        });
    }

    // ------------------------------------------------------------------
    // Selection resolution (deep / lifted / symptomatic) — as v2
    // ------------------------------------------------------------------
    function catalogItem(key) { return CATALOG.find(function (c) { return c.key === key; }); }
    function deepEntry(id) { return Lib.meds.find(function (m) { return m.id === id; }); }

    function resolve(sel) {
        if (!sel) return null;
        var item = catalogItem(sel.key);
        if (!item) return null;
        var ind = item.indications.find(function (i) { return i.id === sel.indId; }) || item.indications[0];
        if (!ind) return null;

        var deepId = ind.deepId;
        if (item.key === 'aspirin' && ind.id === 'primary_prevention' && state.age >= 70) {
            deepId = 'aspirin-primary-elderly';
        }
        if (deepId) {
            var med = deepEntry(deepId);
            if (med) return { mode: 'deep', med: med, item: item, ind: ind };
        }
        if (ind.outcomes.length === 0) return { mode: 'symptomatic', item: item, ind: ind };

        var outcomes = ind.outcomes.slice().sort(function (a, b) { return b.weight - a.weight; });
        var primary = outcomes[0];
        var cd = item.classDefaults;
        var med2 = {
            id: item.key + '.' + ind.id,
            name: item.name + ' — ' + ind.label,
            example: (item.brandNames[0] ? item.brandNames[0] + ' · ' : '') + item.drugClass,
            drugClass: item.drugClass,
            indication: ind.label,
            tagline: '',
            baseline: primary.baselineType === 'chadsvasc'
                ? { type: 'chadsvasc' }
                : {
                    type: 'anchored',
                    label: 'Risk of ' + primary.shortLabel,
                    trialControlRate: { risk: primary.annualControlRate, years: 1 },
                    rateSource: 'implied by the trial NNT (' + (primary.nnt || '—') + ' over ' + primary.timeframe + ' y): control rate ≈ ' + fmtPct(primary.annualControlRate, 1) + '/y',
                    options: [
                        { id: 'low',     label: 'Lower risk than the trial average', mult: 0.6 },
                        { id: 'typical', label: 'About like the trial population', mult: 1.0 },
                        { id: 'high',    label: 'Higher risk than the trial average', mult: 1.6 }
                    ]
                },
            outcome: { label: primary.label + ' (' + primary.endpoint + ')', shortLabel: primary.shortLabel, includesDeath: primary.includesDeath },
            effect: {
                hr: primary.hr, ci: null,
                source: primary.source + (primary.rrDerivation ? ' — ' + primary.rrDerivation : ''),
                note: primary.quality === 'composite' ? 'Composite endpoint — components differ in severity.' : ''
            },
            ttb: {
                rampYears: cd.ramp, displayYears: cd.ramp,
                display: cd.ramp === 0 ? 'Effect is immediate for this class' : '≈ ' + cd.ramp + ' y (class-level default — not published for this specific entry)',
                source: 'class default, see methods'
            },
            trial: {
                name: primary.source,
                meanAge: cd.meanAge, maxAge: null, pctFemale: null,
                medianFollowupYears: primary.timeframe,
                adherence: Lift.DEFAULT_TRIAL_ADHERENCE, adherenceNote: 'est.',
                annualControlRate: primary.annualControlRate || 0.03,
                sex: 'mixed',
                keyExclusions: ['Detailed trial demographics not yet curated for this entry — representativeness grading is limited']
            },
            subgroups: [],
            repRules: [],
            harms: item.harms,
            burden: null,
            citations: [{ label: primary.source + ' (via the meds.kevinkeet.com database)' }],
            provenance: 'lifted'
        };
        return { mode: 'lifted', med: med2, item: item, ind: ind, outcomes: outcomes };
    }

    // Default anchored risk level: NYHA drives HF-med risk stratum
    function defaultAnchoredOption(res) {
        if (res.ind.id === 'heart_failure') {
            if (state.nyha >= 3) return 'high';
            if (state.nyha === 2 || state.nyha === 0) return 'typical';
            return 'low';
        }
        return 'typical';
    }

    function baselineHazard(med, selKey, res) {
        var b = med.baseline;
        if (b.type === 'pce') {
            var r10 = R.pce10y({
                age: state.age, sex: state.sex, race: state.race === 'black' ? 'black' : 'other',
                totalChol: state.totalChol, hdl: state.hdl,
                sbp: state.sbp, bpTreated: state.bpTreated,
                smoker: state.smoker, diabetes: has('diabetes')
            });
            return { hazard: E.cumRiskToAnnualHazard(r10, 10), display: 'Pooled Cohort Equations 10-year ASCVD risk: <strong>' + fmtPct(r10) + '</strong> (from the vitals & labs entered above)' };
        }
        if (b.type === 'chadsvasc') {
            var f = R.chadsvasc({
                age: state.age, sex: state.sex,
                chf: has('hf') || state.nyha > 0, htn: has('htn') || state.bpTreated || state.sbp >= 140,
                diabetes: has('diabetes'),
                priorStroke: has('priorStroke'), vascular: has('vascular')
            });
            var annual = f.annualRatePct / 100;
            return {
                hazard: E.cumRiskToAnnualHazard(annual, 1),
                display: 'CHA₂DS₂-VASc <strong>' + f.score + '</strong> → untreated stroke/embolism rate ≈ <strong>' + f.annualRatePct + '%/year</strong> (Friberg 2012)'
            };
        }
        var optKey = selKey || med.id;
        var optId = state.anchored[optKey] || (res ? defaultAnchoredOption(res) : 'typical');
        var opt = b.options.find(function (o) { return o.id === optId; }) || b.options[0];
        var h = E.cumRiskToAnnualHazard(b.trialControlRate.risk, b.trialControlRate.years) * opt.mult;
        return {
            hazard: h,
            display: esc(b.label) + ': <strong>' + fmtPct(E.annualHazardToCumRisk(h, 1), 1) + '/year</strong> untreated (' + esc(opt.label) + ')'
        };
    }

    // ------------------------------------------------------------------
    // Representativeness — as v2
    // ------------------------------------------------------------------
    function matchWhen(w) {
        if (!w) return false;
        if (w.minAge != null && state.age < w.minAge) return false;
        if (w.maxAge != null && state.age > w.maxAge) return false;
        if (w.sex && state.sex !== w.sex) return false;
        if (w.healthAtLeast && HEALTH_RANK[state.health] < HEALTH_RANK[w.healthAtLeast]) return false;
        if (w.condition && !has(w.condition)) return false;
        if (w.conditionNot && has(w.conditionNot)) return false;
        if (w.conditionAny && !w.conditionAny.some(has)) return false;
        return true;
    }

    function representativeness(med) {
        var LEVELS = { in: 0, extrapolated: 1, outside: 2 };
        var level = 0, reasons = [];
        (med.repRules || []).forEach(function (r) {
            if (matchWhen(r.when)) { level = Math.max(level, LEVELS[r.level] || 0); reasons.push(r.text); }
        });
        if (med.trial.maxAge && state.age > med.trial.maxAge) {
            level = Math.max(level, 1);
            reasons.push('At ' + state.age + ', this patient is older than the oldest participants (~' + med.trial.maxAge + ') in the underlying trials.');
        }
        if (state.health === 'poor' && level < 1) {
            level = Math.max(level, 1);
            reasons.push('Frail patients were rarely enrolled: most RCTs exclude by comorbidity, age, or functional status (Van Spall JAMA 2007).');
        }
        if (med.provenance === 'lifted' && level < 1 && state.age >= 80) {
            level = 1;
            reasons.push('Lifted database entry without curated trial demographics — at ' + state.age + ', assume the trials skewed younger.');
        }
        var names = ['in', 'extrapolated', 'outside'];
        return { level: names[level], reasons: reasons };
    }

    // ------------------------------------------------------------------
    // Harms — as v2 (HAS-BLED dynamic for anticoagulants)
    // ------------------------------------------------------------------
    function computeHarms(med, item) {
        var isAnticoag = item && item.bleedFactors;
        var list = [];
        if (isAnticoag) {
            var hb = hasbledFor(item.key);
            var excessMajor = (hb.annualBleedPct / 100) * item.bleedFactors.major * 0.55;
            var excessIch = (hb.annualBleedPct / 100) * 0.12 * item.bleedFactors.ich;
            [['Major bleeding (excess vs no anticoagulant)', excessMajor, 0.15,
              'HAS-BLED ' + hb.score + ' → ' + hb.annualBleedPct + '%/y on warfarin (Pisters 2010) × agent factor ' + item.bleedFactors.major + '; ~55% attributable vs none (est.)'],
             ['Intracranial hemorrhage (excess)', excessIch, 0.6,
              '≈12% of major bleeds are intracranial; agent ICH factor ' + item.bleedFactors.ich + ' (Ruff 2014)']]
            .forEach(function (row) {
                list.push({
                    def: { id: row[0], label: row[0], severity: 'serious', source: row[3], weight: row[2] },
                    cif: E.runHarm({
                        horizonYears: state.horizon, excessAnnualRate: row[1], multiplier: 1,
                        patientAdherence: adhValue(), age: state.age, sex: state.sex, healthMult: healthMult()
                    }).cif,
                    mult: 1, why: []
                });
            });
        }
        (med.harms || []).forEach(function (h) {
            if (isAnticoag && /bleed|ich|intracranial/i.test(h.id)) return;
            var mult = 1, why = [];
            (h.scaling || []).forEach(function (s) {
                if (matchWhen(s.when)) { mult *= s.mult; why.push(s.why); }
            });
            var res = E.runHarm({
                horizonYears: state.horizon, excessAnnualRate: h.excessAnnualRate, multiplier: mult,
                patientAdherence: adhValue(), age: state.age, sex: state.sex, healthMult: healthMult()
            });
            list.push({ def: h, cif: res.cif, mult: mult, why: why });
        });
        return list.sort(function (a, b) {
            var rank = { serious: 0, moderate: 1, nuisance: 2 };
            return (rank[a.def.severity] - rank[b.def.severity]) || (b.cif - a.cif);
        });
    }

    function computeBurden(med, item) {
        if (med && med.burden) {
            var b = med.burden, pts = 0, facts = [];
            if (b.dosesPerDay >= 3) pts += 2.5; else if (b.dosesPerDay >= 2) pts += 1.5; else if (b.dosesPerDay >= 1) pts += 0.5;
            facts.push('<strong>' + (b.dosesPerDay < 1 ? 'Weekly' : b.dosesPerDay + '×/day') + '</strong> — ' + esc(b.route));
            var labs = b.labsPerYear || 0, visits = b.extraVisitsPerYear || 0;
            if (labs + visits >= 4) pts += 1.5; else if (labs + visits >= 2) pts += 1; else if (labs + visits >= 1) pts += 0.5;
            facts.push(labs || visits ? '<strong>Monitoring:</strong> ~' + labs + ' labs' + (visits ? ' + ' + visits + ' visits' : '') + '/yr' : '<strong>Monitoring:</strong> none routinely');
            var cn = (b.constraints || []).length;
            pts += Math.min(2.5, cn * 0.8);
            (b.constraints || []).forEach(function (c) { facts.push(esc(c)); });
            pts += b.costTier === 3 ? 1.5 : (b.costTier === 2 ? 0.75 : 0);
            facts.push('<strong>Cost:</strong> ' + ['$', '$$', '$$$'][b.costTier - 1]);
            pts += b.interactions === 'high' ? 1 : (b.interactions === 'moderate' ? 0.5 : 0);
            facts.push('<strong>Interactions:</strong> ' + esc(b.interactions));
            (b.notes || []).forEach(function (n) { facts.push(esc(n)); });
            var score = Math.min(10, Math.round(pts * 10) / 10);
            return { score: score, cat: score < 2 ? 'low' : (score <= 4.5 ? 'moderate' : 'high'), facts: facts };
        }
        var eff = Lift.effectiveBurden(item, state.prefs);
        var facts2 = [];
        if (item.burdenDetails) facts2.push(esc(item.burdenDetails));
        if (item.monitoring) facts2.push('<strong>Monitoring:</strong> ' + esc(item.monitoring));
        if (item.annualCost != null) facts2.push('<strong>Cost:</strong> ~$' + item.annualCost + '/year');
        if (eff.tier !== item.burdenTier) facts2.push('Tier raised for this patient\'s preference for fewer medications');
        return { score: Lift.burdenScoreFromTier(eff.tier), cat: eff.tier, facts: facts2 };
    }

    // ------------------------------------------------------------------
    // Scoring one therapy (shared by both views)
    // ------------------------------------------------------------------
    function contraCtx() {
        var eg = egfr();
        return {
            ckd45: has('ckd45'), egfr: eg ? eg.egfr : null, dialysis: false,
            priorBleed: has('priorBleed'), adherenceLow: state.adherence === 'low',
            // Decompensation can't be inferred from this intake — never trip
            // the decompensated_hf token on frailty alone (it would bury GDMT).
            hfSevere: false
        };
    }

    function computeSingle(res) {
        var med = res.med;
        var base = baselineHazard(med, res.item.key + '.' + res.ind.id, res);
        var wf = E.waterfall({
            horizonYears: state.horizon,
            trial: {
                annualControlHazard: E.cumRiskToAnnualHazard(med.trial.annualControlRate, 1),
                hr: med.effect.hr, meanAge: med.trial.meanAge, sex: med.trial.sex,
                adherence: med.trial.adherence, ttbYears: med.ttb.rampYears, healthMult: 0.85
            },
            patient: {
                annualEventHazard: base.hazard, age: state.age, sex: state.sex,
                healthMult: healthMult(), adherence: adhValue()
            }
        });
        return {
            med: med, base: base, wf: wf,
            harms: computeHarms(med, res.item),
            burden: computeBurden(med, res.item),
            rep: representativeness(med),
            life: wf.life,
            safety: res.item.medevalId ? Lift.elderlySafety(res.item.medevalId, beersCtx()) : { beers: null, warnings: [], severity: null, avoid: false },
            contraHits: Lift.contraindicationCheck(res.item.contraindications, contraCtx())
        };
    }

    function quickOutcome(o, scaleMult) {
        var haz = o.baselineType === 'chadsvasc'
            ? E.cumRiskToAnnualHazard(R.chadsvasc({
                age: state.age, sex: state.sex, chf: has('hf') || state.nyha > 0,
                htn: has('htn') || state.bpTreated, diabetes: has('diabetes'),
                priorStroke: has('priorStroke'), vascular: has('vascular')
            }).annualRatePct / 100, 1)
            : E.cumRiskToAnnualHazard(o.annualControlRate, 1) * (scaleMult || 1);
        return E.runScenario({
            horizonYears: state.horizon, annualEventHazard: haz, hr: o.hr,
            ttbYears: 0.5, patientAdherence: adhValue(), trialAdherence: Lift.DEFAULT_TRIAL_ADHERENCE,
            age: state.age, sex: state.sex, healthMult: healthMult()
        });
    }

    function currentAnchoredMult(res) {
        var med = res.med;
        if (!med || med.baseline.type !== 'anchored') return 1;
        var key = res.item.key + '.' + res.ind.id;
        var optId = state.anchored[key] || defaultAnchoredOption(res);
        var opt = med.baseline.options.find(function (o) { return o.id === optId; });
        return opt ? opt.mult : 1;
    }

    function scoreEntry(cand) {
        var res = resolve({ key: cand.key, indId: cand.indId });
        if (!res || res.mode === 'symptomatic') return null;
        var out = computeSingle(res);
        var H = state.horizon;

        var primaryWeight = res.mode === 'lifted'
            ? res.outcomes[0].weight
            : (Lift.OUTCOME_WEIGHTS[guessWeightKey(out.med)] != null ? Lift.OUTCOME_WEIGHTS[guessWeightKey(out.med)] : 0.35);
        var benefitScore = out.wf.final.arr * primaryWeight * 1000;
        if (res.mode === 'lifted' && res.outcomes.length > 1) {
            res.outcomes.slice(1).forEach(function (o) {
                benefitScore += quickOutcome(o, currentAnchoredMult(res)).arr * o.weight * 1000;
            });
        }
        var harmScore = 0;
        out.harms.forEach(function (h) {
            var w = h.def.weight != null ? h.def.weight : (h.def.severity === 'serious' ? 0.3 : h.def.severity === 'moderate' ? 0.08 : 0.02);
            harmScore += h.cif * w * 1000;
        });

        var eff = res.item.medevalId ? Lift.effectiveBurden(res.item, state.prefs)
            : { tier: out.burden.cat, penalty: Lift.BURDEN_PENALTIES[out.burden.cat] || 0.03 };
        var burdenPenalty = Math.max(0, eff.penalty) * H * 1000 * 0.2;

        // Original units for the goals-of-care threshold: QALYs/100/yr,
        // net of harms but NOT burden (burden modifies the tier instead).
        var netAnnualPer100 = (benefitScore - harmScore) / (10 * H);
        var reco = Lift.recommend({
            netAnnualPer100: netAnnualPer100, goc: state.goc, age: state.age,
            frail: frailish(), safety: out.safety,
            highBurden: eff.tier === 'high',
            annualCost: res.item.annualCost || 0, costSensitivity: state.prefs.cost,
            contraHit: out.contraHits.length > 0
        });

        var flags = [];
        if (out.rep.level === 'outside') flags.push({ cls: 'f-red', txt: 'outside evidence' });
        else if (out.rep.level === 'extrapolated') flags.push({ cls: 'f-amber', txt: 'extrapolated' });
        if (out.wf.ttbExceedsSurvival) flags.push({ cls: 'f-amber', txt: 'TTB > survival' });
        if (out.med.effect.ci && out.med.effect.ci[1] >= 1) flags.push({ cls: 'f-grey', txt: 'benefit unproven' });
        if (out.safety.beers) flags.push({ cls: 'f-red', txt: 'Beers' });
        out.safety.warnings.slice(0, 2).forEach(function (w) {
            flags.push({ cls: w.severity === 'high' ? 'f-red' : 'f-amber', txt: w.message.toLowerCase() });
        });

        return {
            cand: cand, res: res, out: out,
            benefitScore: benefitScore, harmScore: harmScore, burdenPenalty: burdenPenalty,
            net: benefitScore - harmScore - burdenPenalty,
            netAnnualPer100: netAnnualPer100,
            reco: reco, flags: flags, burdenTier: eff.tier
        };
    }

    function guessWeightKey(med) {
        var s = (med.outcome.shortLabel || '').toLowerCase();
        if (/death/.test(s)) return 'mortality';
        if (/stroke/.test(s)) return 'stroke';
        if (/hf|heart failure/.test(s)) return 'cv_death_hf_hosp';
        if (/fracture/.test(s)) return 'nonvertebral_fracture';
        if (/microvascular/.test(s)) return 'kidney_progression';
        return 'mace';
    }

    // ------------------------------------------------------------------
    // Applicability
    // ------------------------------------------------------------------
    function applicableIndications() {
        var eg = egfr();
        var inds = {};
        if ((has('hf') || state.nyha > 0) && (state.ef == null || state.ef < 45)) inds.heart_failure = true;
        if (has('afib')) inds.afib_stroke_prevention = true;
        if (has('vascular') || has('priorStroke')) {
            inds.secondary_prevention = true;
            if (has('priorMI')) inds.post_mi = true;   // post-MI drugs need an actual MI
            if (has('pad')) inds.pad = true;
        }
        if (has('htn') || state.sbp >= 140 || state.bpTreated) inds.hypertension = true;
        if (has('diabetes')) {
            inds.diabetes = true; inds.diabetes_cv = true; inds.diabetes_glycemic = true;
            if (has('vascular')) inds.diabetes_with_cvd = true;
        }
        if (has('ckd45') || (eg && eg.egfr < 60)) inds.ckd = true;
        if (has('osteoporosis')) { inds.osteoporosis = true; inds.fracture_prevention = true; }
        if (has('copd') || has('copdO2')) inds.copd = true;
        if (has('asthma')) inds.asthma = true;
        if (has('gout')) { inds.gout = true; inds.gout_prevention = true; }
        if (has('neuropathy')) inds.neuropathic_pain = true;
        if (has('depression')) inds.depression = true;
        if (has('hypothyroidism')) inds.hypothyroidism = true;
        if (!has('vascular') && !has('priorStroke') && state.age >= 40 && state.age <= 79) {
            inds.primary_prevention = true; inds.primary_prevention_high_risk = true; inds.ascvd_prevention = true;
        }
        return inds;
    }

    function bestIndicationFor(item, inds) {
        return item.indications.find(function (i) { return inds[i.id] && (i.deepId || i.outcomes.length); }) ||
               item.indications.find(function (i) { return inds[i.id]; }) || null;
    }

    // ==================================================================
    // MED-REVIEW VIEW (default) — the original consultation, re-powered
    // ==================================================================
    function tierChip(reco) {
        var map = {
            'strong': ['t-strong', 'Strongly recommended'],
            'recommended': ['t-rec', 'Recommended'],
            'consider': ['t-consider', 'Consider'],
            'marginal': ['t-marginal', 'Marginal'],
            'caution-elderly': ['t-caution', 'Caution (Beers)'],
            'not-recommended': ['t-not', 'Not recommended'],
            'held-out': ['t-not', 'Verify contraindication']
        };
        var m = map[reco.tier] || map.marginal;
        return '<span class="tier ' + m[0] + '" title="' + esc(reco.text) + '">' + m[1] + '</span>';
    }

    function rgRowHtml(s, maxAbs, isCurrent) {
        var flags = s.flags.map(function (f) { return '<span class="rg-flag ' + f.cls + '">' + esc(f.txt) + '</span>'; }).join('');
        var w = Math.min(100, Math.abs(s.net) / maxAbs * 100);
        var barCls = s.net >= 0 ? 'benefit' : 'harm';
        return '<button type="button" class="rg-row" data-key="' + esc(s.cand.key) + '" data-ind="' + esc(s.cand.indId) + '">' +
            '<div class="rg-name">' + (s.res.mode === 'deep' ? '<span class="prov-dot" title="verified deep entry">★</span>' : '') + esc(s.cand.item.name) +
            tierChip(s.reco) +
            '<span class="rg-ind">' + esc(s.cand.ind.label) + ' · ' + esc(s.reco.text) + '</span>' +
            (flags ? '<span class="rg-flags">' + flags + '</span>' : '') + '</div>' +
            '<div class="rg-nums"><span class="rg-benefit">' + fmt1000(s.out.wf.final.arr) + '/1000 ' + esc(s.res.mode === 'lifted' ? s.res.outcomes[0].shortLabel : s.out.med.outcome.shortLabel) + ' (+' + s.benefitScore.toFixed(1) + ')</span>' +
            '<span class="rg-harm">' + (s.harmScore > 0.05 ? 'harms −' + s.harmScore.toFixed(1) : 'minimal harms') + ' · burden −' + s.burdenPenalty.toFixed(0) + '</span></div>' +
            '<div class="rg-bar-wrap"><div class="rg-bar"><div class="rg-fill ' + barCls + '" style="width:' + w.toFixed(1) + '%"></div></div>' +
            '<span class="rg-net ' + (s.net >= 0 ? 'benefit' : 'harm') + '">' + (s.net >= 0 ? '+' : '') + s.net.toFixed(1) + '</span></div>' +
            '</button>';
    }

    function riskTiles() {
        var tiles = [];
        function tile(cls, label, value, note) {
            tiles.push('<div class="risk-tile ' + cls + '"><div class="rt-label">' + label + '</div><div class="rt-value">' + value + '</div><div class="rt-note">' + note + '</div></div>');
        }
        var pceOk = state.age >= 40 && state.age <= 79 && !has('vascular') && !has('priorStroke');
        if (pceOk) {
            var r10 = R.pce10y({
                age: state.age, sex: state.sex, race: state.race === 'black' ? 'black' : 'other',
                totalChol: state.totalChol, hdl: state.hdl, sbp: state.sbp,
                bpTreated: state.bpTreated, smoker: state.smoker, diabetes: has('diabetes')
            });
            tile(r10 >= 0.20 ? 'high' : r10 >= 0.075 ? 'moderate' : 'low', '10-y ASCVD (PCE)', fmtPct(r10),
                r10 >= 0.20 ? 'High risk' : r10 >= 0.075 ? 'Intermediate' : 'Low');
        }
        if (has('afib')) {
            var cv = R.chadsvasc({
                age: state.age, sex: state.sex, chf: has('hf') || state.nyha > 0,
                htn: has('htn') || state.bpTreated, diabetes: has('diabetes'),
                priorStroke: has('priorStroke'), vascular: has('vascular')
            });
            tile(cv.score >= 2 ? 'high' : cv.score === 1 ? 'moderate' : 'low', 'CHA₂DS₂-VASc', cv.score, cv.annualRatePct + '%/y stroke untreated');
            var hb = hasbledFor(null);
            tile(hb.score >= 3 ? 'high' : 'moderate', 'HAS-BLED', hb.score, hb.annualBleedPct + '%/y major bleed on OAC');
        }
        var eg = egfr();
        if (eg) tile(eg.egfr >= 60 ? 'low' : eg.egfr >= 30 ? 'moderate' : 'high', 'eGFR', eg.egfr, eg.stage + ' (' + eg.source + ')');
        var b = bmi();
        if (b) tile(b >= 35 || b < 18.5 ? 'moderate' : 'low', 'BMI', b.toFixed(1), b >= 30 ? 'Obesity' : b >= 25 ? 'Overweight' : 'Normal range');
        var life = E.lifeExpectancy(state.age, state.sex, healthMult());
        tile(life.median < 3 ? 'high' : life.median < 7 ? 'moderate' : 'low', 'Median survival',
            life.median.toFixed(1) + ' y', 'life expectancy ' + life.le.toFixed(1) + ' y — gates slow-payoff prevention');
        if (state.nyha > 0 || (state.ef != null && state.ef < 45)) {
            tile(state.nyha >= 3 ? 'high' : 'moderate', 'Heart failure',
                (state.ef != null ? 'EF ' + state.ef + '%' : 'NYHA ' + state.nyha),
                'NYHA ' + (state.nyha || '—') + ' — drives HF-med baseline & prognosis');
        }
        return '<div class="risk-grid">' + tiles.join('') + '</div>';
    }

    function renderReview() {
        var root = $('#results');
        var inds = applicableIndications();
        var g = Lift.GOC[state.goc - 1];

        // ---- current medications ----
        var currentRows = [], currentSymp = [], currentClasses = {};
        Object.keys(state.currentMeds).filter(function (k) { return state.currentMeds[k]; }).forEach(function (key) {
            var item = catalogItem(key);
            if (!item) return;
            currentClasses[item.drugClass] = true;
            var ind = bestIndicationFor(item, inds) || item.indications[0];
            if (!ind) return;
            var scored = scoreEntry({ key: key, indId: ind.id, item: item, ind: ind });
            if (scored) currentRows.push(scored);
            else {
                var safety = Lift.elderlySafety(key, beersCtx());
                currentSymp.push({ item: item, ind: ind, safety: safety });
            }
        });
        currentRows.sort(function (a, b) { return b.net - a.net; });

        // ---- candidates: positive tiers, not taken, class not covered; best in class ----
        var candidates = [];
        CATALOG.forEach(function (item) {
            if (state.currentMeds[item.key]) return;
            if (currentClasses[item.drugClass] && !item.isStrategy) return;
            item.indications.forEach(function (ind) {
                if (!inds[ind.id] && !state.regimenAdded[item.key + '.' + ind.id] &&
                    !(item.isStrategy && ((ind.deepId === 'bp-standard' || ind.deepId === 'bp-intensive') && inds.hypertension || ind.deepId === 'tight-glucose' && has('diabetes')))) return;
                if (!ind.outcomes.length && !ind.deepId) return;
                var s = scoreEntry({ key: item.key, indId: ind.id, item: item, ind: ind });
                if (s) candidates.push(s);
            });
        });
        var bestByClass = {};
        candidates.forEach(function (s) {
            var cls = s.cand.item.drugClass;
            if (!bestByClass[cls] || s.net > bestByClass[cls].net) bestByClass[cls] = s;
        });
        var candRows = Object.keys(bestByClass).map(function (k) { return bestByClass[k]; })
            .filter(function (s) { return !s.out.contraHits.length; })
            .sort(function (a, b) { return b.net - a.net; });
        // Held-out: one row per medication (its best-scoring indication)
        var heldByKey = {};
        candidates.filter(function (s) { return s.out.contraHits.length; })
            .concat(currentRows.filter(function (s) { return s.out.contraHits.length; }))
            .forEach(function (s) {
                if (!heldByKey[s.cand.key] || s.net > heldByKey[s.cand.key].net) heldByKey[s.cand.key] = s;
            });
        var heldOut = Object.keys(heldByKey).map(function (k) { return heldByKey[k]; })
            .sort(function (a, b) { return b.net - a.net; });
        currentRows = currentRows.filter(function (s) { return !s.out.contraHits.length; });

        var maxAbs = Math.max.apply(null, currentRows.concat(candRows).map(function (s) { return Math.abs(s.net); }).concat([1]));

        // ---- symptomatic candidates (indication-matched, not modelable) ----
        var sympCands = [];
        CATALOG.forEach(function (item) {
            if (state.currentMeds[item.key]) return;
            if (item.purpose !== 'symptomatic' && item.purpose !== 'replacement') return;
            item.indications.forEach(function (ind) {
                if (inds[ind.id]) sympCands.push({ item: item, ind: ind, safety: Lift.elderlySafety(item.key, beersCtx()) });
            });
        });

        function sympRow(x) {
            var warn = x.safety.severity
                ? '<span class="rg-flag ' + (x.safety.severity === 'high' ? 'f-red' : 'f-amber') + '">' +
                  (x.safety.beers ? 'Beers: ' + esc(x.safety.beers.recommendation || 'caution') : esc((x.safety.warnings[0] || {}).message || 'caution')) + '</span>'
                : '';
            return '<button type="button" class="rg-symp" data-key="' + esc(x.item.key) + '" data-ind="' + esc(x.ind.id) + '">' +
                esc(x.item.name) + ' ' + warn + ' <span>' + esc(x.ind.label) + ' — judge by symptoms</span></button>';
        }

        root.innerHTML =
            // goals banner
            '<div class="panel"><div class="panel-body">' +
            '<div style="display:flex;gap:12px;align-items:center;flex-wrap:wrap">' +
            '<span class="goc-badge goc-' + g.id + '">' + g.name + '</span>' +
            '<span class="subline">' + esc(g.summary) + '</span></div>' +
            '<p class="subline" style="margin-top:8px">To be <strong>recommended</strong> for this patient, a therapy needs a net benefit of at least <strong>' + g.threshold.toFixed(1) + ' QALYs per 100 patients per year</strong> (goals-of-care threshold from the original meds.kevinkeet.com framework)' +
            (state.prefs.cost === 'high' ? ' · cost matters to this patient' : '') +
            (state.prefs.pills === 'low' ? ' · prefers fewer medications (burden weighted up)' : '') + '.</p>' +
            '</div></div>' +

            // risk dashboard
            '<div class="panel"><div class="panel-head"><h2>Risk profile</h2><span class="kicker">computed live from the intake</span></div>' +
            '<div class="panel-body">' + riskTiles() + '</div></div>' +

            // current medications
            '<div class="panel"><div class="panel-head"><h2>Current medications, reviewed</h2><span class="kicker">' + (currentRows.length + currentSymp.length) + ' selected</span></div>' +
            '<div class="panel-body">' +
            (currentRows.length || currentSymp.length
                ? '<div class="rg-list">' + currentRows.map(function (s) { return rgRowHtml(s, maxAbs, true); }).join('') +
                  currentSymp.map(sympRow).join('') + '</div>' +
                  '<p class="wf-caption">Rows marked <em>not recommended</em>, <em>marginal</em>, or <em>caution</em> are deprescribing conversations waiting to happen — click through for the full arithmetic.</p>'
                : '<p class="subline">Tick the patient\'s current medications in the left rail to review them.</p>') +
            '</div></div>' +

            // candidates
            '<div class="panel"><div class="panel-head"><h2>Worth considering — best in each class</h2><span class="kicker">not currently taken</span></div>' +
            '<div class="panel-body">' +
            (candRows.length
                ? '<div class="rg-list">' + candRows.map(function (s) { return rgRowHtml(s, maxAbs, false); }).join('') + '</div>'
                : '<p class="subline">No additional positive-benefit therapies found for this profile.</p>') +
            '<div class="field" style="margin-top:14px"><label for="rg-add">Add any therapy to the comparison</label>' +
            '<select id="rg-add"><option value="">— choose —</option>' +
            CATALOG.map(function (item) {
                return item.indications.map(function (ind) {
                    return '<option value="' + esc(item.key + '.' + ind.id) + '">' + esc(item.name) + ' — ' + esc(ind.label) + '</option>';
                }).join('');
            }).join('') + '</select></div>' +
            '</div></div>' +

            (sympCands.length ? '<div class="panel"><div class="panel-head"><h2>Symptom-directed &amp; replacement options</h2><span class="kicker">not rankable by events</span></div>' +
                '<div class="panel-body"><div class="rg-list">' + sympCands.map(sympRow).join('') + '</div>' +
                '<p class="wf-caption">Judged by felt benefit against harms and burden — the prevention model deliberately abstains. Beers Criteria warnings still apply.</p></div></div>' : '') +

            (heldOut.length ? '<div class="panel"><div class="panel-head"><h2>Held out — possible contraindication</h2><span class="kicker">verify before comparing</span></div>' +
                '<div class="panel-body"><div class="rg-list">' + heldOut.map(function (s) { return rgRowHtml(s, maxAbs, false); }).join('') + '</div></div></div>' : '') +

            synthesisPanel(currentRows, currentSymp, candRows, heldOut, g) +

            '<p class="wf-caption" style="margin:14px 4px">Net score = Σ(events prevented ×severity) − Σ(harms ×severity) − burden, per 1000 over ' + state.horizon + ' y; recommendation tiers apply the goals-of-care threshold to the benefit−harm balance in the original framework\'s units. Every number is a model output — click any row to inspect the assumptions. <a href="methods.html">Methods</a>.</p>';

        root.querySelectorAll('.rg-row, .rg-symp, .syn-line[data-key]').forEach(function (btn) {
            btn.addEventListener('click', function () {
                state.selection = { key: btn.dataset.key, indId: btn.dataset.ind };
                state.view = 'single';
                syncViewSeg();
                renderMedPicker();
                update();
            });
        });
        var add = $('#rg-add');
        if (add) add.addEventListener('change', function () {
            if (!this.value) return;
            state.regimenAdded[this.value] = true;
            renderReview();
        });
    }

    // ------------------------------------------------------------------
    // Synthesis — the bottom line. Groups every therapy by action, using
    // the severity-weighted net (benefit − harms), the burden/cost-adjusted
    // score, the goals-of-care threshold, contraindications, and Beers.
    // ------------------------------------------------------------------
    function synthesisPanel(currentRows, currentSymp, candRows, heldOut, g) {
        var H = state.horizon;
        function line(s, extra) {
            return '<button type="button" class="syn-line" data-key="' + esc(s.cand.key) + '" data-ind="' + esc(s.cand.indId) + '">' +
                '<strong>' + esc(s.cand.item.name) + '</strong> <span class="syn-ind">(' + esc(s.cand.ind.label) + ')</span> — ' +
                'net <span class="' + (s.net >= 0 ? 'syn-pos' : 'syn-neg') + '">' + (s.net >= 0 ? '+' : '') + s.net.toFixed(1) + '/1000</span> over ' + H + ' y' +
                (extra ? ' · ' + extra : ' · ' + esc(s.reco.text)) + '</button>';
        }
        var start = candRows.filter(function (s) { return s.reco.tier === 'strong' || s.reco.tier === 'recommended'; });
        var discuss = candRows.filter(function (s) { return s.reco.tier === 'consider' || s.reco.tier === 'caution-elderly'; });
        var keep = currentRows.filter(function (s) { return ['strong', 'recommended', 'consider'].indexOf(s.reco.tier) >= 0; });
        var reconsider = currentRows.filter(function (s) { return ['marginal', 'not-recommended', 'caution-elderly'].indexOf(s.reco.tier) >= 0; });
        var sympFlagged = currentSymp.filter(function (x) { return x.safety.severity === 'high' || x.safety.beers; });

        function group(title, cls, rows) {
            if (!rows.length) return '';
            return '<div class="syn-group ' + cls + '"><div class="syn-title">' + title + '</div>' + rows.join('') + '</div>';
        }

        var summaryBits = [];
        if (start.length) summaryBits.push('<strong>' + start.length + '</strong> to start');
        if (keep.length) summaryBits.push('<strong>' + keep.length + '</strong> to continue');
        if (reconsider.length + sympFlagged.length) summaryBits.push('<strong>' + (reconsider.length + sympFlagged.length) + '</strong> to reconsider');
        if (heldOut.length) summaryBits.push('<strong>' + heldOut.length + '</strong> to verify');
        var biggest = start.concat(keep).sort(function (a, b) { return b.net - a.net; })[0];

        return '<div class="panel syn-panel"><div class="panel-head"><h2>Synthesis — the bottom line</h2><span class="kicker">' + g.name + ' goals · ' + H + '-year view</span></div>' +
            '<div class="panel-body">' +
            '<p class="headline" style="font-size:17px">' +
            (summaryBits.length ? 'For this patient: ' + summaryBits.join(', ') + '.' : 'Enter conditions and current medications for a bottom line.') +
            (biggest ? ' The single biggest win is <strong>' + esc(biggest.cand.item.name) + '</strong> (net +' + biggest.net.toFixed(1) + ' severity-weighted points per 1000).' : '') + '</p>' +
            group('Start — clears the ' + g.name.toLowerCase() + ' threshold after harms, burden & cost', 'sg-start', start.map(function (s) { return line(s); })) +
            group('Worth a conversation', 'sg-discuss', discuss.map(function (s) { return line(s); })) +
            group('Continue', 'sg-keep', keep.map(function (s) { return line(s); })) +
            group('Reconsider or deprescribe', 'sg-stop', reconsider.map(function (s) { return line(s); })
                .concat(sympFlagged.map(function (x) {
                    return '<button type="button" class="syn-line" data-key="' + esc(x.item.key) + '" data-ind="' + esc(x.ind.id) + '"><strong>' + esc(x.item.name) + '</strong> <span class="syn-ind">(' + esc(x.ind.label) + ')</span> — symptomatic; ' +
                        esc(x.safety.beers ? 'Beers: ' + (x.safety.beers.recommendation || 'caution in older adults') : (x.safety.warnings[0] || {}).message || 'elderly-safety caution') + '</button>';
                }))) +
            group('Verify contraindication first', 'sg-verify', heldOut.map(function (s) { return line(s, s.out.contraHits.map(esc).join('; ')); })) +
            '<p class="wf-caption">How this synthesis is built: each therapy\'s events prevented and caused are weighted by severity (death 1.0 → nuisance 0.02) and netted; burden and cost are charged against it according to this patient\'s stated preferences; the goals-of-care threshold (' + g.threshold.toFixed(1) + ' QALYs/100/yr for ' + g.name.toLowerCase() + ') decides recommend vs not; contraindications and Beers Criteria override. It is a decision aid for a conversation — not a prescription.</p>' +
            '</div></div>';
    }

    // ==================================================================
    // SINGLE-MED VIEW — as v2, plus safety chips
    // ==================================================================
    function badgeHtml(rep) {
        var map = {
            in: ['b-in', 'Patients like this were in the trials'],
            extrapolated: ['b-ex', 'Extrapolated beyond the trial population'],
            outside: ['b-out', 'Outside the trial evidence']
        };
        var m = map[rep.level];
        return '<span class="badge ' + m[0] + '">' + m[1] + '</span>';
    }
    function provChip(mode) {
        return mode === 'deep'
            ? '<span class="prov-chip p-deep">★ verified deep entry</span>'
            : '<span class="prov-chip p-lift">lifted from the meds.kevinkeet.com database</span>';
    }
    function harmItemHtml(h) {
        var d = h.def;
        var negligible = h.cif * 1000 < 0.1;
        var scaleNote = h.mult !== 1
            ? '<div class="h-scale">Scaled ×' + h.mult.toFixed(1) + ' for this patient: ' + h.why.map(esc).join('; ') + '.</div>' : '';
        var oneTime = d.oneTimeExtra
            ? '<div class="h-src">Plus ~' + Math.round(d.oneTimeExtra * 100) + '% affected at or soon after starting (not in the per-1000 count).</div>' : '';
        return '<div class="harm-item sev-' + d.severity + '">' +
            '<div class="h-name">' + esc(d.label) + '<span class="sev-tag ' + d.severity + '">' + d.severity + '</span></div>' +
            '<div class="h-num' + (negligible ? ' negligible' : '') + '">' + (negligible ? '<0.1' : '+' + fmt1000(h.cif)) + ' /1000</div>' +
            scaleNote + oneTime + '<div class="h-src">' + esc(d.source) + '</div></div>';
    }
    function burdenHtml(b) {
        return '<div class="burden-wrap"><div class="burden-dial">' +
            '<div class="b-score">' + b.score.toFixed(1) + '<small style="font-size:15px;color:var(--ink-faint)">/10</small></div>' +
            '<div class="b-cat" style="color:' + (b.cat === 'low' ? 'var(--benefit)' : b.cat === 'moderate' ? 'var(--caution)' : 'var(--harm)') + '">' + b.cat + ' burden</div>' +
            '<div class="b-track"><div class="b-fill" style="width:' + (b.score * 10) + '%"></div></div>' +
            '</div><ul class="burden-facts">' + b.facts.map(function (f) { return '<li>' + f + '</li>'; }).join('') + '</ul></div>';
    }
    function contraPanel(res) {
        var all = res.item.contraindications || [];
        if (!all.length) return '';
        var hits = Lift.contraindicationCheck(all, contraCtx());
        return '<div class="panel"><div class="panel-head"><h2>Contraindications</h2></div><div class="panel-body">' +
            (hits.length ? '<div class="flagline f-danger"><span class="fl-icon">✕</span><div><strong>This patient may hit: </strong>' + hits.map(esc).join(' · ') + '</div></div>' : '') +
            '<p class="trialbox" style="margin:' + (hits.length ? '10px' : '0') + ' 0 0">Check: ' + all.map(function (t) { return esc(t.replace(/_/g, ' ')); }).join(' · ') + '</p>' +
            '</div></div>';
    }

    function renderSymptomatic(res) {
        var item = res.item, ind = res.ind;
        var safety = Lift.elderlySafety(item.key, beersCtx());
        var raws = [];
        for (var ok in (ind.raw || {})) {
            var d = ind.raw[ok];
            raws.push('<div class="harm-item sev-nuisance"><div class="h-name">' + esc(Lift.outcomeMeta(ok).label) + '</div>' +
                '<div class="h-num negligible">' + (d.nnt ? 'NNT ' + d.nnt : (d.absolute != null ? Math.round(d.absolute * 100) + '% respond' : '—')) + '</div>' +
                '<div class="h-src">' + esc(d.endpoint || '') + (d.source ? ' — ' + esc(d.source) : '') + ' · quality: ' + esc(d.quality || 'unknown') + '</div></div>');
        }
        var safetyHtml = '';
        if (safety.beers) {
            safetyHtml += '<div class="flagline f-danger"><span class="fl-icon">!</span><div><strong>Beers Criteria (' + esc(safety.beers.strength || 'listed') + '):</strong> ' + esc(safety.beers.concern || '') + ' — ' + esc(safety.beers.recommendation || '') + '</div></div>';
        }
        safety.warnings.forEach(function (w) {
            safetyHtml += '<div class="flagline' + (w.severity === 'high' ? ' f-danger' : '') + '"><span class="fl-icon">±</span><div>' + esc(w.message) + '</div></div>';
        });
        var harms = computeHarms({ harms: item.harms }, item);
        var burden = computeBurden(null, item);

        $('#results').innerHTML =
            '<div class="panel"><div class="panel-body">' +
            '<div style="display:flex;justify-content:space-between;gap:12px;flex-wrap:wrap;align-items:center;margin-bottom:8px">' +
            '<span class="prov-chip p-symp">' + (item.purpose === 'replacement' ? 'replacement therapy' : 'symptomatic therapy') + '</span>' +
            '<span class="subline">' + esc(item.name) + ' · ' + esc(ind.label) + '</span></div>' +
            '<p class="headline">This medicine is judged by <strong>how the patient feels</strong>, not by events prevented.</p>' +
            '<p class="subline">Weigh the felt benefit directly against the harms and burden below — and stop it if it isn\'t helping.</p>' +
            safetyHtml +
            '</div></div>' +
            '<div class="panel"><div class="panel-head"><h2>Reported benefit</h2></div>' +
            '<div class="panel-body"><div class="harm-list">' + (raws.join('') || '<p class="subline">No benefit data recorded.</p>') + '</div></div></div>' +
            '<div class="panel"><div class="panel-head"><h2>Harms, per 1000 over ' + state.horizon + ' years</h2></div>' +
            '<div class="panel-body"><div class="harm-list">' + (harms.map(harmItemHtml).join('') || '<p class="subline">No serious-harm rates recorded.</p>') + '</div></div></div>' +
            '<div class="panel"><div class="panel-head"><h2>Treatment burden</h2></div>' +
            '<div class="panel-body">' + burdenHtml(burden) + '</div></div>' +
            contraPanel(res);
    }

    function renderSingle() {
        var root = $('#results');
        var res = resolve(state.selection);
        if (!res) {
            root.innerHTML = '<div class="panel"><div class="results-empty">Choose a medication in the left rail (or click a row in Med review).</div></div>';
            return;
        }
        if (res.mode === 'symptomatic') { renderSymptomatic(res); return; }

        var out = computeSingle(res);
        var med = out.med, wf = out.wf, fin = wf.final;
        var H = state.horizon;

        var benefitPhrase = med.outcome.shortLabel === 'deaths' || med.outcome.shortLabel === 'CV deaths'
            ? '<span class="hl-benefit">' + fmt1000(fin.arr) + ' fewer die</span>'
            : '<span class="hl-benefit">' + fmt1000(fin.arr) + ' avoid ' + esc(med.outcome.shortLabel) + '</span>';
        var headline =
            'Of <strong>1000 patients like this</strong> taking <span class="hl-med">' + esc(med.name) + '</span> for ' + H + ' years, about ' +
            benefitPhrase + (med.outcome.shortLabel === 'deaths' ? ' within the horizon' : ' who would otherwise have had them') + '.';

        var flags = '';
        if (out.contraHits.length) flags += '<div class="flagline f-danger"><span class="fl-icon">✕</span><div><strong>Possible contraindication:</strong> ' + out.contraHits.map(esc).join(' · ') + '.</div></div>';
        if (out.safety.beers) flags += '<div class="flagline f-danger"><span class="fl-icon">!</span><div><strong>Beers Criteria (' + esc(out.safety.beers.strength || 'listed') + '):</strong> ' + esc(out.safety.beers.concern || '') + ' — ' + esc(out.safety.beers.recommendation || '') + '</div></div>';
        out.safety.warnings.forEach(function (w) {
            flags += '<div class="flagline' + (w.severity === 'high' ? ' f-danger' : '') + '"><span class="fl-icon">±</span><div>' + esc(w.message) + ' (elderly-safety check from the original engine).</div></div>';
        });
        if (wf.ttbExceedsSurvival) {
            flags += '<div class="flagline f-danger"><span class="fl-icon">!</span><div><strong>Time-to-benefit exceeds median survival.</strong> Median survival ~' +
                out.life.median.toFixed(1) + ' y; this therapy needs ~' + med.ttb.displayYears + ' y (' + esc(med.ttb.display) + '). Most patients like this will carry the burden and harm risk without living to see the benefit (Holmes 2006).</div></div>';
        } else if (med.ttb.displayYears >= 1 && out.life.median < med.ttb.displayYears * 2) {
            flags += '<div class="flagline"><span class="fl-icon">±</span><div><strong>Time-to-benefit matters here.</strong> ' + esc(med.ttb.display) + ' (' + esc(med.ttb.source) + '); median survival ~' + out.life.median.toFixed(1) + ' y.</div></div>';
        }
        if (med.effect.ci && med.effect.ci[1] >= 1) {
            flags += '<div class="flagline"><span class="fl-icon">?</span><div><strong>The trial itself could not rule out "no benefit"</strong> (CI ' + med.effect.ci[0] + '–' + med.effect.ci[1] + ').</div></div>';
        }

        var absScale = Math.max(fin.cifUntreated, 0.02);
        function bar(frac, cls) {
            var w = Math.max(0.5, Math.min(100, frac * 100));
            return '<div class="p-bar"><div class="p-fill ' + cls + '" style="width:' + w.toFixed(1) + '%"></div></div>';
        }
        var benefitRows =
            '<div class="p-row"><div class="p-label"><strong>Without</strong> the drug: ' + esc(med.outcome.shortLabel) + ' over ' + H + ' y</div>' +
            '<div class="p-bar-wrap">' + bar(fin.cifUntreated / absScale, 'ghost') + '<span class="p-num">' + fmt1000(fin.cifUntreated) + ' <small>/1000</small></span></div></div>' +
            '<div class="p-row"><div class="p-label"><strong>With</strong> the drug</div>' +
            '<div class="p-bar-wrap">' + bar(fin.cifTreated / absScale, 'ghost') + '<span class="p-num">' + fmt1000(fin.cifTreated) + ' <small>/1000</small></span></div></div>' +
            '<div class="p-row"><div class="p-label"><strong>Prevented</strong> — the benefit</div>' +
            '<div class="p-bar-wrap">' + bar(fin.arr / absScale, 'benefit') + '<span class="p-num benefit">' + fmt1000(fin.arr) + ' <small>/1000</small></span></div></div>';

        var nntStrip =
            '<div class="nnt-strip">' +
            '<div class="stat"><span class="s-val benefit">' + fmtNNT(fin.nnt) + '</span><span class="s-lab">NNT over ' + H + ' y</span></div>' +
            '<div class="stat"><span class="s-val benefit">' + fmt1000(fin.arr) + '</span><span class="s-lab">prevented / 1000</span></div>' +
            '<div class="stat"><span class="s-val">' + fmtPct(fin.aliveAtHorizon, 0) + '</span><span class="s-lab">alive at ' + H + ' y (other causes)</span></div>' +
            '<div class="stat"><span class="s-val">' + out.life.le.toFixed(1) + ' y</span><span class="s-lab">life expectancy</span></div>' +
            '</div>';

        var otherStrip = '';
        if (res.mode === 'lifted' && res.outcomes.length > 1) {
            var rows = res.outcomes.slice(1).map(function (o) {
                var s = quickOutcome(o, currentAnchoredMult(res));
                return '<div class="stat"><span class="s-val benefit">' + fmt1000(s.arr) + '</span><span class="s-lab">' + esc(o.shortLabel) + ' prevented /1000</span></div>';
            }).join('');
            otherStrip = '<div class="nnt-strip" style="margin-top:8px">' + rows + '</div>' +
                '<p class="p-note">Additional outcomes from the same trials, run through the same adjustment model.</p>';
        }

        var wfScale = Math.max.apply(null, wf.steps.map(function (s) { return s.result.arr; }).concat([0.005]));
        var whyTexts = {
            trial: 'Replicates the published trial: its control-arm risk, its demographics, its adherence. Sanity check — this should match the published NNT.',
            baseline: 'Swaps the trial\'s average baseline risk for this patient\'s own (' + (med.baseline.type === 'pce' ? 'Pooled Cohort Equations' : med.baseline.type === 'chadsvasc' ? 'CHA₂DS₂-VASc' : 'anchored to the trial control arm at the chosen risk level') + '). Relative effects travel; absolute benefits don\'t (Kent & Hayward 2007; PATH 2020).',
            competing: 'Applies this patient\'s age, sex, and overall health: competing mortality means fewer patients survive long enough for prevention to pay off (' + esc(med.ttb.display) + ').',
            adherence: 'Dilutes the relative effect by expected real-world adherence versus in-trial adherence (~' + Math.round((med.trial.adherence || 0.9) * 100) + '%).'
        };
        var stepLabels = { trial: 'The trial said', baseline: 'Your baseline risk', competing: 'Your prognosis', adherence: 'Your adherence' };
        var prevArr = null;
        var wfRows = wf.steps.map(function (s, i) {
            var arr = s.result.arr;
            var multTxt = prevArr != null && prevArr > 1e-9 ? '×' + (arr / prevArr).toFixed(2) : '';
            prevArr = arr;
            var isFinal = i === wf.steps.length - 1;
            return '<div class="wf-row' + (isFinal ? ' wf-final' : '') + '">' +
                '<div class="wf-label"><span class="wf-step">' + (i + 1) + '. ' + stepLabels[s.key] + '</span>' +
                '<span class="wf-why">' + whyTexts[s.key] + '</span></div>' +
                '<div class="wf-bar-wrap">' +
                '<div class="wf-bar"><div class="wf-fill" style="width:' + Math.max(0.8, (arr / wfScale) * 100).toFixed(1) + '%"></div></div>' +
                '<span class="wf-num">' + fmt1000(arr) + '<small>/1000</small>' + (multTxt ? '<span class="wf-mult">' + multTxt + ' vs prior step</span>' : '<span class="wf-mult">trial replication</span>') + '</span>' +
                '</div></div>';
        }).join('');

        var t = med.trial;
        var subgroups = (med.subgroups || []).map(function (s) {
            return '<dt>' + esc(s.label) + '</dt><dd>' + esc(s.text) + '</dd>';
        }).join('');
        var repList = out.rep.reasons.length
            ? '<ul class="rep-reasons">' + out.rep.reasons.map(function (r) { return '<li>' + esc(r) + '</li>'; }).join('') + '</ul>'
            : '<p class="trialbox" style="margin:6px 0 0">A patient with this profile was reasonably represented in the underlying trials.</p>';

        var evidenceHtml =
            '<dl class="trialbox">' +
            '<dt>Effect estimate</dt><dd>HR/RR ' + med.effect.hr.toFixed(2) +
            (med.effect.ci ? ' (95% CI ' + med.effect.ci[0] + '–' + med.effect.ci[1] + ')' : ' (CI not carried in the upstream database entry)') +
            ' — ' + esc(med.effect.source) + (med.effect.note ? '<br>' + esc(med.effect.note) : '') + '</dd>' +
            '<dt>Source population</dt><dd>' + esc(t.name) + ' — mean age ' + (t.meanAge || '?') + (t.pctFemale != null ? ', ' + t.pctFemale + '% women' : '') + ', follow-up ' + t.medianFollowupYears + ' y, in-trial adherence ~' + Math.round((t.adherence || 0.9) * 100) + '%</dd>' +
            '<dt>Who was excluded</dt><dd>' + t.keyExclusions.map(esc).join(' · ') + '</dd>' +
            subgroups + '</dl>' +
            '<ul class="cites">' + med.citations.map(function (c) { return '<li>' + esc(c.label) + '</li>'; }).join('') + '</ul>';

        root.innerHTML =
            '<div class="panel"><div class="panel-body">' +
            '<div style="display:flex;justify-content:space-between;gap:12px;flex-wrap:wrap;align-items:center;margin-bottom:8px">' +
            '<span>' + badgeHtml(out.rep) + ' ' + provChip(res.mode) + '</span>' +
            '<span class="subline">' + esc(med.example) + ' · ' + esc(med.indication) + '</span></div>' +
            '<p class="headline">' + headline + '</p>' +
            '<p class="subline">' + out.base.display + ' · outcome: ' + esc(med.outcome.label) + '</p>' +
            flags + '</div></div>' +
            '<div class="panel"><div class="panel-head"><h2>Benefit, per 1000 patients over ' + H + ' years</h2></div>' +
            '<div class="panel-body"><div class="per1000">' + benefitRows + '</div>' + nntStrip + otherStrip + '</div></div>' +
            '<div class="panel"><div class="panel-head"><h2>From trial average to this patient</h2><span class="kicker">the adjustment, step by step</span></div>' +
            '<div class="panel-body"><div class="wf">' + wfRows + '</div>' +
            '<p class="wf-caption">Step 1 replicates the trial (calibration); steps 2–4 swap in this patient\'s baseline risk, prognosis, and adherence. <a href="methods.html">Methods</a>.</p></div></div>' +
            '<div class="panel"><div class="panel-head"><h2>Harms, per 1000 over the same ' + H + ' years</h2><span class="kicker">start immediately — no time-to-harm lag</span></div>' +
            '<div class="panel-body"><div class="harm-list">' + (out.harms.map(harmItemHtml).join('') || '<p class="subline">No serious-harm rates recorded for this entry.</p>') + '</div></div></div>' +
            '<div class="panel"><div class="panel-head"><h2>Treatment burden</h2><span class="kicker">the work of being a patient</span></div>' +
            '<div class="panel-body">' + burdenHtml(out.burden) + '</div></div>' +
            contraPanel(res) +
            '<div class="panel"><div class="panel-head"><h2>Evidence &amp; representativeness</h2></div>' +
            '<div class="panel-body">' + repList + evidenceHtml + '</div></div>';
    }

    function renderResults() {
        if (state.view === 'review') renderReview();
        else renderSingle();
    }

    // ==================================================================
    // EMR quick-import (ported from the original app — fully client-side)
    // ==================================================================
    var EMR_PROMPT = 'Extract the following patient information in JSON format for a medication benefit calculator:\n\n' + JSON.stringify({
        demographics: { age: '[number]', sex: '[male|female]', race: '[white|black|hispanic|asian|other]', weight_kg: '[number]', height_cm: '[number]' },
        vitals: { systolic_bp: '[mmHg]' },
        labs: { total_cholesterol: '[mg/dL]', ldl: '[mg/dL]', hdl: '[mg/dL]', creatinine: '[mg/dL]', egfr: '[mL/min]', a1c: '[%]' },
        cardiac: { ejection_fraction: '[%]', nyha_class: '[0-4, 0=no HF]', afib: '[true|false]', prior_stroke_tia: '[true|false]', prior_mi: '[true|false]', pvd: '[true|false]', heart_failure: '[true|false]' },
        diabetes: { status: '[none|prediabetes|type2|type1]' },
        bleeding_risks: { prior_major_bleed: '[t/f]', anemia: '[t/f]', liver_disease: '[t/f]', heavy_alcohol: '[t/f]', nsaid_use: '[t/f]', on_antiplatelet: '[t/f]', fall_risk: '[t/f]' },
        other_conditions: { hypertension_treated: '[t/f]', current_smoker: '[t/f]', copd: '[t/f]', dementia: '[t/f]', active_cancer: '[t/f]', frailty: '[t/f]', osteoporosis: '[t/f]', gout: '[t/f]', asthma: '[t/f]', neuropathy: '[t/f]', hypothyroidism: '[t/f]', depression: '[t/f]' },
        overall_health: '[excellent|good|average|fair|poor — vs age peers]',
        adherence: '[high|typical|low]',
        current_medications: '[array of generic names, e.g. "atorvastatin", "apixaban", "metformin"]'
    }, null, 2) + '\n\nUse null for unknown values. Extract from the most recent available data.';

    function applyExtracted(d) {
        var n = 0;
        function num(v) { var x = parseFloat(v); return isFinite(x) ? x : null; }
        var demo = d.demographics || d;
        if (num(demo.age)) { state.age = num(demo.age); n++; }
        if (demo.sex === 'male' || demo.sex === 'female') { state.sex = demo.sex; n++; }
        if (demo.race) { state.race = String(demo.race).toLowerCase(); n++; }
        if (num(demo.weight_kg || demo.weight)) { state.weightKg = num(demo.weight_kg || demo.weight); n++; }
        if (num(demo.height_cm || demo.height)) { state.heightCm = num(demo.height_cm || demo.height); n++; }
        var v = d.vitals || d;
        if (num(v.systolic_bp)) { state.sbp = num(v.systolic_bp); n++; }
        var labs = d.labs || d;
        if (num(labs.total_cholesterol)) { state.totalChol = num(labs.total_cholesterol); n++; }
        if (num(labs.hdl)) { state.hdl = num(labs.hdl); n++; }
        if (num(labs.ldl)) { state.ldl = num(labs.ldl); n++; }
        if (num(labs.creatinine)) { state.creatinine = num(labs.creatinine); n++; }
        if (num(labs.egfr)) { state.egfrOverride = num(labs.egfr); n++; }
        if (num(labs.a1c)) { state.a1c = num(labs.a1c); n++; }
        var c = d.cardiac || d;
        if (num(c.ejection_fraction)) { state.ef = num(c.ejection_fraction); n++; }
        if (c.nyha_class != null && isFinite(parseInt(c.nyha_class, 10))) { state.nyha = parseInt(c.nyha_class, 10); n++; }
        function setCond(id, val) { if (val) { state.conditions[id] = true; n++; } }
        setCond('afib', c.afib); setCond('priorStroke', c.prior_stroke_tia);
        setCond('priorMI', c.prior_mi); setCond('pad', c.pvd); setCond('hf', c.heart_failure);
        var dm = d.diabetes || {};
        if (dm.status) { state.diabetesStatus = dm.status; n++; }
        var b = d.bleeding_risks || {};
        setCond('priorBleed', b.prior_major_bleed); setCond('anemia', b.anemia);
        setCond('liverDisease', b.liver_disease); setCond('alcohol', b.heavy_alcohol);
        setCond('antiplatelet', b.nsaid_use || b.on_antiplatelet); setCond('fallRisk', b.fall_risk);
        var o = d.other_conditions || {};
        if (o.hypertension_treated != null) { state.bpTreated = !!o.hypertension_treated; if (o.hypertension_treated) state.conditions.htn = true; n++; }
        if (o.current_smoker != null) { state.smoker = !!o.current_smoker; n++; }
        setCond('copd', o.copd); setCond('dementia', o.dementia); setCond('cancer', o.active_cancer);
        setCond('osteoporosis', o.osteoporosis); setCond('gout', o.gout); setCond('asthma', o.asthma);
        setCond('neuropathy', o.neuropathy); setCond('hypothyroidism', o.hypothyroidism); setCond('depression', o.depression);
        if (o.frailty) { state.health = 'poor'; n++; }
        if (d.overall_health && ['excellent', 'good', 'average', 'fair', 'poor'].indexOf(d.overall_health) >= 0) { state.health = d.overall_health; n++; }
        if (d.adherence && ['high', 'typical', 'low'].indexOf(d.adherence) >= 0) { state.adherence = d.adherence; n++; }
        (d.current_medications || []).forEach(function (m) {
            var key = String(m).toLowerCase().replace(/[^a-z0-9_]/g, '_');
            if (catalogItem(key)) { state.currentMeds[key] = true; n++; }
        });
        return n;
    }

    function extractPlainText(text) {
        // Minimal regex fallback for pasted notes (ported concept)
        var d = {};
        var m;
        if ((m = text.match(/(\d{2,3})[- ]?(?:year|yo|y\/o|yr)/i))) d.age = m[1];
        if (/\bfemale\b|\bwoman\b/i.test(text)) d.sex = 'female';
        else if (/\bmale\b|\bman\b/i.test(text)) d.sex = 'male';
        if ((m = text.match(/creatinine[:\s]+([\d.]+)/i))) d.creatinine = m[1];
        if ((m = text.match(/egfr[:\s]+([\d.]+)/i))) d.egfr = m[1];
        if ((m = text.match(/a1c[:\s]+([\d.]+)/i))) d.a1c = m[1];
        if ((m = text.match(/(?:sbp|systolic|bp)[:\s]+(\d{2,3})/i))) d.systolic_bp = m[1];
        if ((m = text.match(/ef[:\s]+(\d{1,2})\s*%/i))) d.ejection_fraction = m[1];
        if (/atrial fibrillation|afib|a-fib/i.test(text)) d.afib = true;
        if (/heart failure|hfref|chf/i.test(text)) d.heart_failure = true;
        return Object.keys(d).length >= 2 ? d : null;
    }

    function wireEmr() {
        $('#emr-copy').addEventListener('click', function () {
            navigator.clipboard.writeText(EMR_PROMPT).then(function () {
                $('#emr-status').textContent = '✓ Prompt copied — paste it into your EMR AI, then paste the JSON back here.';
            }, function () {
                $('#emr-paste').value = EMR_PROMPT;
                $('#emr-status').textContent = 'Clipboard blocked — the prompt is in the box below; copy it manually, then clear and paste the JSON.';
            });
        });
        $('#emr-clear').addEventListener('click', function () {
            $('#emr-paste').value = ''; $('#emr-status').textContent = '';
        });
        $('#emr-extract').addEventListener('click', function () {
            var text = $('#emr-paste').value.trim();
            var status = $('#emr-status');
            if (!text) { status.textContent = 'Paste EMR-AI JSON (or note text) first.'; return; }
            var data = null;
            try {
                var jsonStart = text.indexOf('{');
                if (jsonStart >= 0) data = JSON.parse(text.slice(jsonStart, text.lastIndexOf('}') + 1));
            } catch (e) { /* fall through to text extraction */ }
            if (!data) data = extractPlainText(text);
            if (!data) { status.textContent = 'Could not parse that — paste the JSON produced by the extraction prompt.'; return; }
            var n = applyExtracted(data);
            syncFormFromState();
            update();
            status.textContent = '✓ Filled ' + n + ' fields — review them below before trusting the numbers.';
        });
    }

    // ==================================================================
    // LEFT RAIL
    // ==================================================================
    function renderHealthCards() {
        var wrap = $('#health-cards');
        wrap.innerHTML = '';
        L.HEALTH_LEVELS.forEach(function (h) {
            var lab = el('<label><input type="radio" name="health" value="' + h.id + '"' + (state.health === h.id ? ' checked' : '') + '><span class="rc-title">' + esc(h.label) + '</span><div class="rc-desc">' + esc(h.desc) + '</div></label>');
            lab.querySelector('input').addEventListener('change', function () { state.health = h.id; update(); });
            wrap.appendChild(lab);
        });
    }
    function renderAdherenceCards() {
        var wrap = $('#adh-cards');
        wrap.innerHTML = '';
        Lib.ADHERENCE_LEVELS.forEach(function (a) {
            var lab = el('<label><input type="radio" name="adh" value="' + a.id + '"' + (state.adherence === a.id ? ' checked' : '') + '><span class="rc-title">' + esc(a.label) + '</span><div class="rc-desc">' + esc(a.desc) + '</div></label>');
            lab.querySelector('input').addEventListener('change', function () { state.adherence = a.id; update(); });
            wrap.appendChild(lab);
        });
    }
    function renderGocCards() {
        var wrap = $('#goc-cards');
        wrap.innerHTML = '';
        Lift.GOC.forEach(function (g) {
            var lab = el('<label><input type="radio" name="goc" value="' + g.value + '"' + (state.goc === g.value ? ' checked' : '') + '><span class="rc-title">' + esc(g.name) + '</span><div class="rc-desc">' + esc(g.summary) + '</div></label>');
            lab.querySelector('input').addEventListener('change', function () { state.goc = g.value; update(); });
            wrap.appendChild(lab);
        });
    }
    function renderConditions() {
        Object.keys(COND_GROUPS).forEach(function (gridId) {
            var wrap = $('#' + gridId);
            wrap.innerHTML = '';
            COND_GROUPS[gridId].forEach(function (c) {
                var lab = el('<label><input type="checkbox" value="' + c.id + '"' + (state.conditions[c.id] ? ' checked' : '') + '><span>' + esc(c.label) + '</span></label>');
                lab.querySelector('input').addEventListener('change', function (e) {
                    if (e.target.checked) state.conditions[c.id] = true;
                    else delete state.conditions[c.id];
                    if (c.id === 'copdO2' && e.target.checked) state.conditions.copd = true;
                    update();
                });
                wrap.appendChild(lab);
            });
        });
    }

    var DOMAIN_ORDER = ['Heart failure', 'Anticoagulation & antiplatelets', 'Lipids & CV prevention', 'Blood pressure', 'Diabetes', 'Bone health', 'Respiratory', 'Gout', 'Symptom & replacement', 'Treatment strategies'];
    function domainOf(item) {
        if (item.isStrategy) return 'Treatment strategies';
        if (item.purpose === 'symptomatic' || item.purpose === 'replacement') return 'Symptom & replacement';
        var ids = item.indications.map(function (i) { return i.id; }).join(' ');
        if (/heart_failure/.test(ids)) return 'Heart failure';
        if (/afib|vte|mechanical|stroke_prevention/.test(ids) || /Anticoagulant|Antiplatelet/i.test(item.drugClass)) return 'Anticoagulation & antiplatelets';
        if (/Statin|PCSK9|Ezetimibe|Icosapent/i.test(item.drugClass) || /prevention/.test(ids)) return 'Lipids & CV prevention';
        if (/hypertension/.test(ids)) return 'Blood pressure';
        if (/diabetes|ckd/.test(ids)) return 'Diabetes';
        if (/osteoporosis|fracture/.test(ids)) return 'Bone health';
        if (/copd|asthma/.test(ids)) return 'Respiratory';
        if (/gout/.test(ids)) return 'Gout';
        return 'Symptom & replacement';
    }

    function renderCurrentMeds() {
        var wrap = $('#current-meds');
        var groups = {};
        CATALOG.forEach(function (item) {
            if (item.isStrategy) return;
            var d = domainOf(item);
            (groups[d] = groups[d] || []).push(item);
        });
        var html = '';
        DOMAIN_ORDER.forEach(function (d) {
            if (!groups[d]) return;
            html += '<details class="intake"><summary>' + esc(d) + ' <span class="cm-count" data-domain="' + esc(d) + '"></span></summary><div class="check-grid">';
            groups[d].sort(function (a, b) { return a.name.localeCompare(b.name); }).forEach(function (item) {
                html += '<label><input type="checkbox" data-cm="' + esc(item.key) + '"' + (state.currentMeds[item.key] ? ' checked' : '') + '><span>' + esc(item.name) + '</span></label>';
            });
            html += '</div></details>';
        });
        wrap.innerHTML = html;
        wrap.querySelectorAll('[data-cm]').forEach(function (inp) {
            inp.addEventListener('change', function () {
                if (this.checked) state.currentMeds[this.dataset.cm] = true;
                else delete state.currentMeds[this.dataset.cm];
                updateCmCounts();
                update();
            });
        });
        updateCmCounts();
    }
    function updateCmCounts() {
        document.querySelectorAll('.cm-count').forEach(function (span) {
            var d = span.dataset.domain;
            var n = 0;
            CATALOG.forEach(function (item) {
                if (!item.isStrategy && domainOf(item) === d && state.currentMeds[item.key]) n++;
            });
            span.textContent = n ? '· ' + n + ' selected' : '';
        });
    }

    function renderMedPicker() {
        var sel = $('#med-select');
        var groups = {};
        CATALOG.forEach(function (item) {
            var d = domainOf(item);
            (groups[d] = groups[d] || []).push(item);
        });
        var html = '<option value="">— choose a medication —</option>';
        DOMAIN_ORDER.forEach(function (d) {
            if (!groups[d]) return;
            html += '<optgroup label="' + esc(d) + '">';
            groups[d].sort(function (a, b) { return a.name.localeCompare(b.name); }).forEach(function (item) {
                var star = item.indications.some(function (i) { return i.deepId; }) ? ' ★' : '';
                html += '<option value="' + esc(item.key) + '"' + (state.selection && state.selection.key === item.key ? ' selected' : '') + '>' + esc(item.name) + star + '</option>';
            });
            html += '</optgroup>';
        });
        sel.innerHTML = html;
        renderIndicationPicker();
    }
    function renderIndicationPicker() {
        var wrap = $('#ind-wrap');
        var item = state.selection && catalogItem(state.selection.key);
        if (!item || item.indications.length <= 1) { wrap.hidden = true; return; }
        wrap.hidden = false;
        $('#ind-select').innerHTML = item.indications.map(function (i) {
            var mark = i.deepId ? ' ★' : (i.outcomes.length ? '' : ' (symptom-based)');
            return '<option value="' + esc(i.id) + '"' + (state.selection.indId === i.id ? ' selected' : '') + '>' + esc(i.label) + mark + '</option>';
        }).join('');
    }
    function defaultIndication(item) {
        var inds = applicableIndications();
        var best = item.indications.find(function (i) { return inds[i.id] && (i.deepId || i.outcomes.length); }) ||
                   item.indications.find(function (i) { return i.deepId; }) ||
                   item.indications.find(function (i) { return i.outcomes.length; }) ||
                   item.indications[0];
        return best ? best.id : null;
    }

    function renderBaselinePanel() {
        var res = resolve(state.selection);
        var panel = $('#baseline-panel'), body = $('#baseline-body');
        if (!res || res.mode === 'symptomatic' || state.view === 'review') { panel.hidden = true; return; }
        var med = res.med;
        panel.hidden = false;
        var b = med.baseline;
        var selKey = res.item.key + '.' + res.ind.id;
        if (b.type === 'pce' || b.type === 'chadsvasc') {
            body.innerHTML = '<p class="hint" style="margin:0" id="risk-out"></p><p class="hint">' +
                (b.type === 'pce' ? 'Computed from the vitals, labs, and smoking status in the patient panel.' :
                    'Score counts age, sex, and the ticked conditions (HF, hypertension, diabetes, stroke/TIA, MI/PAD).') + '</p>';
        } else {
            var cur = state.anchored[selKey] || defaultAnchoredOption(res);
            body.innerHTML = '<div class="radio-cards">' + b.options.map(function (o) {
                return '<label><input type="radio" name="anch" value="' + o.id + '"' + (o.id === cur ? ' checked' : '') + '><span class="rc-title">' + esc(o.label) + '</span></label>';
            }).join('') + '</div><p class="hint">' + esc(b.rateSource) +
                (res.ind.id === 'heart_failure' && state.nyha > 0 ? ' · default set from NYHA class' : '') + '</p>';
            body.querySelectorAll('input[name="anch"]').forEach(function (inp) {
                inp.addEventListener('change', function () { state.anchored[selKey] = this.value; update(true); });
            });
        }
        refreshBaselineReadout();
    }
    function refreshBaselineReadout() {
        var res = resolve(state.selection);
        if (!res || res.mode === 'symptomatic') return;
        var out = $('#risk-out');
        if (out) out.innerHTML = baselineHazard(res.med, res.item.key + '.' + res.ind.id, res).display;
    }

    function renderLifeReadout() {
        var life = E.lifeExpectancy(state.age, state.sex, healthMult());
        var eg = egfr();
        $('#life-readout').innerHTML =
            'With this profile: life expectancy ≈ <strong>' + life.le.toFixed(1) + ' y</strong>, median survival ≈ <strong>' + life.median.toFixed(1) + ' y</strong>.' +
            (eg ? '<br>eGFR: <strong>' + eg.egfr + '</strong> mL/min (' + eg.stage + ', ' + eg.source + ').' : '') +
            ' Prognosis gates how much slow-payoff prevention can deliver.';
    }

    function syncViewSeg() {
        document.querySelectorAll('[data-view]').forEach(function (b) {
            b.setAttribute('aria-pressed', String(b.dataset.view === state.view));
        });
    }

    function syncFormFromState() {
        $('#pt-age').value = state.age;
        document.querySelectorAll('[data-sex]').forEach(function (b) {
            b.setAttribute('aria-pressed', String(b.dataset.sex === state.sex));
        });
        $('#pt-race').value = state.race;
        $('#pt-sbp').value = state.sbp;
        if (state.weightKg) $('#pt-wt').value = state.weightKg;
        if (state.heightCm) $('#pt-ht').value = state.heightCm;
        $('#pt-tc').value = state.totalChol;
        $('#pt-hdl').value = state.hdl;
        if (state.ldl) $('#pt-ldl').value = state.ldl;
        if (state.creatinine) $('#pt-cr').value = state.creatinine;
        if (state.egfrOverride) $('#pt-egfr').value = state.egfrOverride;
        if (state.a1c) $('#pt-a1c').value = state.a1c;
        $('#pt-bptx').checked = state.bpTreated;
        $('#pt-smoker').checked = state.smoker;
        if (state.ef != null) $('#pt-ef').value = state.ef;
        $('#pt-nyha').value = String(state.nyha);
        $('#pt-dm').value = state.diabetesStatus;
        renderConditions();
        renderHealthCards();
        renderAdherenceCards();
        renderCurrentMeds();
    }

    function update(skipBaselineRebuild) {
        renderLifeReadout();
        if (!skipBaselineRebuild) renderBaselinePanel();
        else refreshBaselineReadout();
        renderResults();
    }

    function bindNum(id, key, transform) {
        $('#' + id).addEventListener('input', function () {
            var v = parseFloat(this.value);
            state[key] = isFinite(v) ? (transform ? transform(v) : v) : null;
            update();
        });
    }

    function init() {
        $('#foot-disclaimer').textContent = Lib.disclaimer;

        bindNum('pt-age', 'age', function (v) { return Math.min(105, Math.max(18, Math.round(v))); });
        bindNum('pt-sbp', 'sbp');
        bindNum('pt-wt', 'weightKg');
        bindNum('pt-ht', 'heightCm');
        bindNum('pt-tc', 'totalChol');
        bindNum('pt-hdl', 'hdl');
        bindNum('pt-ldl', 'ldl');
        bindNum('pt-cr', 'creatinine');
        bindNum('pt-egfr', 'egfrOverride');
        bindNum('pt-a1c', 'a1c');
        bindNum('pt-ef', 'ef');
        // guard rails for nullable numerics that must keep sane defaults
        $('#pt-age').addEventListener('input', function () { if (!state.age) state.age = 76; });
        $('#pt-sbp').addEventListener('input', function () { if (!state.sbp) state.sbp = 130; });
        $('#pt-tc').addEventListener('input', function () { if (!state.totalChol) state.totalChol = 200; });
        $('#pt-hdl').addEventListener('input', function () { if (!state.hdl) state.hdl = 50; });

        $('#pt-race').addEventListener('change', function () { state.race = this.value; update(); });
        $('#pt-nyha').addEventListener('change', function () {
            state.nyha = parseInt(this.value, 10) || 0;
            if (state.nyha > 0) state.conditions.hf = true;
            renderConditions();
            update();
        });
        $('#pt-dm').addEventListener('change', function () { state.diabetesStatus = this.value; update(); });
        $('#pt-bptx').addEventListener('change', function () { state.bpTreated = this.checked; update(); });
        $('#pt-smoker').addEventListener('change', function () { state.smoker = this.checked; update(); });

        document.querySelectorAll('[data-sex]').forEach(function (btn) {
            btn.addEventListener('click', function () {
                state.sex = btn.dataset.sex;
                document.querySelectorAll('[data-sex]').forEach(function (b2) {
                    b2.setAttribute('aria-pressed', String(b2 === btn));
                });
                update();
            });
        });
        document.querySelectorAll('[data-horizon]').forEach(function (btn) {
            btn.addEventListener('click', function () {
                state.horizon = parseInt(btn.dataset.horizon, 10);
                document.querySelectorAll('[data-horizon]').forEach(function (b2) {
                    b2.setAttribute('aria-pressed', String(b2 === btn));
                });
                update(true);
            });
        });
        document.querySelectorAll('[data-view]').forEach(function (btn) {
            btn.addEventListener('click', function () {
                state.view = btn.dataset.view;
                syncViewSeg();
                update();
            });
        });

        $('#pref-horizon').addEventListener('change', function () {
            var h = parseInt(this.value, 10);
            state.horizon = h === 1 ? 1 : h === 2 ? 2 : h === 10 ? 10 : 5;
            document.querySelectorAll('[data-horizon]').forEach(function (b2) {
                b2.setAttribute('aria-pressed', String(parseInt(b2.dataset.horizon, 10) === state.horizon));
            });
            update(true);
        });
        $('#pref-pills').addEventListener('change', function () { state.prefs.pills = this.value; update(true); });
        $('#pref-cost').addEventListener('change', function () { state.prefs.cost = this.value; update(true); });
        $('#pref-monitoring').addEventListener('change', function () { state.prefs.monitoring = this.value; update(true); });

        $('#med-select').addEventListener('change', function () {
            if (!this.value) { state.selection = null; update(); return; }
            var item = catalogItem(this.value);
            state.selection = { key: this.value, indId: defaultIndication(item) };
            state.view = 'single';
            syncViewSeg();
            renderIndicationPicker();
            update();
        });
        $('#ind-select').addEventListener('change', function () {
            if (state.selection) { state.selection.indId = this.value; update(); }
        });

        wireEmr();
        renderHealthCards();
        renderAdherenceCards();
        renderGocCards();
        renderConditions();
        renderCurrentMeds();
        renderMedPicker();
        update();
    }

    document.addEventListener('DOMContentLoaded', init);
})();
