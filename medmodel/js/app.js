/**
 * MedModel — application wiring.
 *
 * Data flows: patient state → Lift.buildCatalog() (medeval 60-med database +
 * MedModel deep entries + strategies) → resolve() picks deep / lifted /
 * symptomatic presentation → BenefitModel engine → rendered results.
 *
 * Two views: single-medication deep dive, and regimen review (severity-
 * weighted ranking across every medication applicable to this patient).
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
    // Conditions: one unified checklist feeding risk scores, harm scaling,
    // representativeness, mortality multipliers, and indication matching.
    // ------------------------------------------------------------------
    var COND_DEFS = [
        { id: 'htn',          label: 'Hypertension' },
        { id: 'diabetes',     label: 'Type 2 diabetes' },
        { id: 'prediabetes',  label: 'Prediabetes' },
        { id: 'afib',         label: 'Atrial fibrillation' },
        { id: 'hf',           label: 'Heart failure' },
        { id: 'efLow',        label: 'EF <40% (HFrEF)' },
        { id: 'vascular',     label: 'Prior MI / PAD' },
        { id: 'priorStroke',  label: 'Prior stroke / TIA' },
        { id: 'priorBleed',   label: 'Prior major bleed' },
        { id: 'osteoporosis', label: 'Osteoporosis' },
        { id: 'copd',         label: 'COPD' },
        { id: 'copdO2',       label: 'COPD on home O₂' },
        { id: 'ckd45',        label: 'CKD 4–5 (eGFR <30)' },
        { id: 'dementia',     label: 'Dementia' },
        { id: 'cancer',       label: 'Metastatic cancer' },
        { id: 'antiplatelet', label: 'On antiplatelet / NSAID' },
        { id: 'alcohol',      label: '≥8 alcohol drinks/wk' },
        { id: 'asian',        label: 'East / SE Asian ancestry' }
    ];

    var HEALTH_RANK = { excellent: 0, good: 1, average: 2, fair: 3, poor: 4 };

    var state = {
        age: 76, sex: 'female', health: 'average',
        conditions: {},
        adherence: 'typical',
        creatinine: null,
        horizon: 5,
        view: 'single',                      // 'single' | 'regimen'
        selection: null,                     // { key, indId }
        pce: { totalChol: 200, hdl: 50, sbp: 138, bpTreated: false, smoker: false, race: 'other' },
        anchored: {},                        // "key.indId" -> option id
        regimenAdded: {}                     // key -> true (manually added)
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
    function has(id) { return !!state.conditions[id]; }
    function adhValue() {
        var lv = Lib.ADHERENCE_LEVELS.find(function (a) { return a.id === state.adherence; });
        return lv ? lv.value : 0.65;
    }
    function healthMult() {
        return L.totalMultiplier(state.health, Object.keys(state.conditions).filter(has));
    }
    function egfr() {
        if (!state.creatinine) return null;
        var r = R.egfrCkdEpi2021(state.creatinine, state.age, state.sex);
        return r ? r : null;
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

    // ------------------------------------------------------------------
    // HAS-BLED from patient state (uncontrolled-HTN criterion approximated
    // as false — we don't track current SBP outside the PCE panel; labile
    // INR proxied by poor adherence for warfarin only).
    // ------------------------------------------------------------------
    function hasbledFor(medKey) {
        var eg = egfr();
        return R.hasbled({
            age: state.age,
            sbpOver160: false,
            renalImpaired: has('ckd45') || (eg && eg.egfr < 30) || (state.creatinine && state.creatinine > 2.3),
            liverDisease: false,
            priorStroke: has('priorStroke'),
            priorBleed: has('priorBleed'),
            labileINR: medKey === 'warfarin' && state.adherence === 'low',
            antiplateletOrNSAID: has('antiplatelet'),
            alcohol: has('alcohol')
        });
    }

    // ------------------------------------------------------------------
    // Selection resolution: deep entry, lifted entry, or symptomatic card.
    // ------------------------------------------------------------------
    function catalogItem(key) {
        return CATALOG.find(function (c) { return c.key === key; });
    }
    function deepEntry(id) {
        return Lib.meds.find(function (m) { return m.id === id; });
    }

    function resolve(sel) {
        if (!sel) return null;
        var item = catalogItem(sel.key);
        if (!item) return null;
        var ind = item.indications.find(function (i) { return i.id === sel.indId; }) || item.indications[0];
        if (!ind) return null;

        // Deep overlay (aspirin primary prevention → ASPREE entry only at ≥70)
        var deepId = ind.deepId;
        if (item.key === 'aspirin' && ind.id === 'primary_prevention' && state.age >= 70) {
            deepId = 'aspirin-primary-elderly';
        }
        if (deepId) {
            var med = deepEntry(deepId);
            if (med) return { mode: 'deep', med: med, item: item, ind: ind };
        }

        if (ind.outcomes.length === 0) {
            return { mode: 'symptomatic', item: item, ind: ind };
        }

        // Lifted: model the most severe outcome; others shown as a strip.
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
            burden: null,          // rendered from the medeval tier instead
            citations: [{ label: primary.source + ' (via meds.kevinkeet.com database)' }],
            provenance: 'lifted'
        };
        return { mode: 'lifted', med: med2, item: item, ind: ind, outcomes: outcomes };
    }

    // ------------------------------------------------------------------
    // Baseline hazard for a resolved med (deep or lifted)
    // ------------------------------------------------------------------
    function baselineHazard(med, selKey) {
        var b = med.baseline;
        if (b.type === 'pce') {
            var r10 = R.pce10y({
                age: state.age, sex: state.sex, race: state.pce.race,
                totalChol: state.pce.totalChol, hdl: state.pce.hdl,
                sbp: state.pce.sbp, bpTreated: state.pce.bpTreated,
                smoker: state.pce.smoker, diabetes: has('diabetes')
            });
            return { hazard: E.cumRiskToAnnualHazard(r10, 10), display: 'Pooled Cohort Equations 10-year ASCVD risk: <strong>' + fmtPct(r10) + '</strong>' };
        }
        if (b.type === 'chadsvasc') {
            var f = R.chadsvasc({
                age: state.age, sex: state.sex,
                chf: has('hf'), htn: has('htn'), diabetes: has('diabetes'),
                priorStroke: has('priorStroke'), vascular: has('vascular')
            });
            var annual = f.annualRatePct / 100;
            return {
                hazard: E.cumRiskToAnnualHazard(annual, 1),
                display: 'CHA₂DS₂-VASc <strong>' + f.score + '</strong> → untreated stroke/embolism rate ≈ <strong>' + f.annualRatePct + '%/year</strong> (Friberg 2012)'
            };
        }
        var optKey = selKey || med.id;
        var optId = state.anchored[optKey] ||
            (b.options.find(function (o) { return o.id === 'typical'; }) || b.options[0]).id;
        var opt = b.options.find(function (o) { return o.id === optId; }) || b.options[0];
        var h = E.cumRiskToAnnualHazard(b.trialControlRate.risk, b.trialControlRate.years) * opt.mult;
        return {
            hazard: h,
            display: esc(b.label) + ': <strong>' + fmtPct(E.annualHazardToCumRisk(h, 1), 1) + '/year</strong> untreated (' + esc(opt.label) + ')'
        };
    }

    // ------------------------------------------------------------------
    // Representativeness
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
            if (matchWhen(r.when)) {
                level = Math.max(level, LEVELS[r.level] || 0);
                reasons.push(r.text);
            }
        });
        if (med.trial.maxAge && state.age > med.trial.maxAge) {
            level = Math.max(level, 1);
            reasons.push('At ' + state.age + ', this patient is older than the oldest participants (~' + med.trial.maxAge + ') in the underlying trials.');
        }
        if (state.health === 'poor' && level < 1) {
            level = Math.max(level, 1);
            reasons.push('Frail patients were rarely enrolled: most RCTs exclude by comorbidity, age, or functional status (Van Spall JAMA 2007 — only 47% of exclusion criteria are strongly justified).');
        }
        if (med.provenance === 'lifted' && level < 1 && state.age >= 80) {
            level = 1;
            reasons.push('Lifted database entry without curated trial demographics — at ' + state.age + ', assume the trials skewed younger than this patient.');
        }
        var names = ['in', 'extrapolated', 'outside'];
        return { level: names[level], reasons: reasons };
    }

    // ------------------------------------------------------------------
    // Harms (static excess rates with scaling, plus HAS-BLED dynamic
    // bleeding for anticoagulants)
    // ------------------------------------------------------------------
    function computeHarms(med, item) {
        var isAnticoag = item && item.bleedFactors;
        var list = [];

        if (isAnticoag) {
            var hb = hasbledFor(item.key);
            var onDrugMajor = (hb.annualBleedPct / 100) * item.bleedFactors.major;
            // Excess vs no antithrombotic: anticoagulation roughly doubles
            // major bleeding (Hart 2007), so ~55% of the on-drug rate is
            // attributable (est.; see methods).
            var excessMajor = onDrugMajor * 0.55;
            var excessIch = (hb.annualBleedPct / 100) * 0.12 * item.bleedFactors.ich;
            list.push({
                def: {
                    id: 'majorbleed_dyn', label: 'Major bleeding (excess vs no anticoagulant)', severity: 'serious',
                    source: 'HAS-BLED ' + hb.score + ' → ' + hb.annualBleedPct + '%/y on warfarin (Pisters 2010) × agent factor ' + item.bleedFactors.major + ' (vs-warfarin trials); ~55% attributable vs none (est.)',
                    weight: 0.15
                },
                cif: E.runHarm({
                    horizonYears: state.horizon, excessAnnualRate: excessMajor, multiplier: 1,
                    patientAdherence: adhValue(), age: state.age, sex: state.sex, healthMult: healthMult()
                }).cif,
                mult: 1, why: []
            });
            list.push({
                def: {
                    id: 'ich_dyn', label: 'Intracranial hemorrhage (excess)', severity: 'serious',
                    source: '≈12% of major bleeds are intracranial on warfarin; agent ICH factor ' + item.bleedFactors.ich + ' (Ruff 2014 class RR 0.48 for DOACs)',
                    weight: 0.6
                },
                cif: E.runHarm({
                    horizonYears: state.horizon, excessAnnualRate: excessIch, multiplier: 1,
                    patientAdherence: adhValue(), age: state.age, sex: state.sex, healthMult: healthMult()
                }).cif,
                mult: 1, why: []
            });
        }

        (med.harms || []).forEach(function (h) {
            if (isAnticoag && /bleed|ich|intracranial/i.test(h.id)) return; // replaced by dynamic
            var mult = 1, why = [];
            (h.scaling || []).forEach(function (s) {
                if (matchWhen(s.when)) { mult *= s.mult; why.push(s.why); }
            });
            var res = E.runHarm({
                horizonYears: state.horizon,
                excessAnnualRate: h.excessAnnualRate,
                multiplier: mult,
                patientAdherence: adhValue(),
                age: state.age, sex: state.sex, healthMult: healthMult()
            });
            list.push({ def: h, cif: res.cif, mult: mult, why: why });
        });

        return list.sort(function (a, b) {
            var rank = { serious: 0, moderate: 1, nuisance: 2 };
            return (rank[a.def.severity] - rank[b.def.severity]) || (b.cif - a.cif);
        });
    }

    // ------------------------------------------------------------------
    // Burden
    // ------------------------------------------------------------------
    function computeBurden(med, item) {
        if (med && med.burden) {
            var b = med.burden, pts = 0, facts = [];
            if (b.dosesPerDay >= 3) pts += 2.5;
            else if (b.dosesPerDay >= 2) pts += 1.5;
            else if (b.dosesPerDay >= 1) pts += 0.5;
            facts.push('<strong>' + (b.dosesPerDay < 1 ? 'Weekly' : b.dosesPerDay + '×/day') + '</strong> — ' + esc(b.route));
            var labs = b.labsPerYear || 0, visits = b.extraVisitsPerYear || 0;
            if (labs + visits >= 4) pts += 1.5; else if (labs + visits >= 2) pts += 1; else if (labs + visits >= 1) pts += 0.5;
            if (labs || visits) facts.push('<strong>Monitoring:</strong> ~' + labs + ' lab draw' + (labs === 1 ? '' : 's') + (visits ? ' + ' + visits + ' extra visit' + (visits === 1 ? '' : 's') : '') + ' per year');
            else facts.push('<strong>Monitoring:</strong> none routinely');
            var cn = (b.constraints || []).length;
            pts += Math.min(2.5, cn * 0.8);
            (b.constraints || []).forEach(function (c) { facts.push(esc(c)); });
            pts += b.costTier === 3 ? 1.5 : (b.costTier === 2 ? 0.75 : 0);
            facts.push('<strong>Cost:</strong> ' + ['$', '$$', '$$$'][b.costTier - 1] + (b.costTier === 1 ? ' (generic/cheap)' : ''));
            pts += b.interactions === 'high' ? 1 : (b.interactions === 'moderate' ? 0.5 : 0);
            facts.push('<strong>Interaction potential:</strong> ' + esc(b.interactions));
            (b.notes || []).forEach(function (n) { facts.push(esc(n)); });
            var score = Math.min(10, Math.round(pts * 10) / 10);
            return { score: score, cat: score < 2 ? 'low' : (score <= 4.5 ? 'moderate' : 'high'), facts: facts, penalty: null };
        }
        // Lifted: medeval qualitative tier + details
        var tier = item.burdenTier || 'low';
        var facts2 = [];
        if (item.burdenDetails) facts2.push(esc(item.burdenDetails));
        if (item.monitoring) facts2.push('<strong>Monitoring:</strong> ' + esc(item.monitoring));
        if (item.annualCost != null) facts2.push('<strong>Cost:</strong> ~$' + item.annualCost + '/year (' + ['$', '$$', '$$$'][Lift.costTier(item.annualCost) - 1] + ')');
        facts2.push('Tier from the meds.kevinkeet.com database (includes common minor side effects)');
        return {
            score: Lift.burdenScoreFromTier(tier),
            cat: tier, facts: facts2,
            penalty: Lift.BURDEN_PENALTIES[tier]
        };
    }

    // ------------------------------------------------------------------
    // Single-med computation
    // ------------------------------------------------------------------
    function computeSingle(res) {
        var med = res.med;
        var base = baselineHazard(med, res.item.key + '.' + res.ind.id);
        var wf = E.waterfall({
            horizonYears: state.horizon,
            trial: {
                annualControlHazard: E.cumRiskToAnnualHazard(med.trial.annualControlRate, 1),
                hr: med.effect.hr,
                meanAge: med.trial.meanAge,
                sex: med.trial.sex,
                adherence: med.trial.adherence,
                ttbYears: med.ttb.rampYears,
                healthMult: 0.85
            },
            patient: {
                annualEventHazard: base.hazard,
                age: state.age, sex: state.sex,
                healthMult: healthMult(),
                adherence: adhValue()
            }
        });
        return {
            med: med, base: base, wf: wf,
            harms: computeHarms(med, res.item),
            burden: computeBurden(med, res.item),
            rep: representativeness(med),
            life: wf.life,
            contraHits: Lift.contraindicationCheck(res.item.contraindications, contraCtx())
        };
    }

    function contraCtx() {
        var eg = egfr();
        return {
            ckd45: has('ckd45'),
            egfr: eg ? eg.egfr : null,
            dialysis: false,
            priorBleed: has('priorBleed'),
            adherenceLow: state.adherence === 'low',
            hfSevere: has('hf') && state.health === 'poor'
        };
    }

    // Quick secondary-outcome estimate for lifted entries
    function quickOutcome(o, scaleMult) {
        var haz = o.baselineType === 'chadsvasc'
            ? E.cumRiskToAnnualHazard(R.chadsvasc({
                age: state.age, sex: state.sex, chf: has('hf'), htn: has('htn'),
                diabetes: has('diabetes'), priorStroke: has('priorStroke'), vascular: has('vascular')
            }).annualRatePct / 100, 1)
            : E.cumRiskToAnnualHazard(o.annualControlRate, 1) * (scaleMult || 1);
        var s = E.runScenario({
            horizonYears: state.horizon, annualEventHazard: haz, hr: o.hr,
            ttbYears: 0.5, patientAdherence: adhValue(), trialAdherence: Lift.DEFAULT_TRIAL_ADHERENCE,
            age: state.age, sex: state.sex, healthMult: healthMult()
        });
        return s;
    }

    // ==================================================================
    // RENDER — results (single view)
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
            : '<span class="prov-chip p-lift">lifted from meds.kevinkeet.com</span>';
    }

    function renderSymptomatic(res) {
        var item = res.item, ind = res.ind;
        var raws = [];
        for (var ok in (ind.raw || {})) {
            var d = ind.raw[ok];
            raws.push('<div class="harm-item sev-nuisance"><div class="h-name">' + esc(Lift.outcomeMeta(ok).label) + '</div>' +
                '<div class="h-num negligible">' + (d.nnt ? 'NNT ' + d.nnt : (d.absolute != null ? Math.round(d.absolute * 100) + '% respond' : '—')) + '</div>' +
                '<div class="h-src">' + esc(d.endpoint || '') + (d.source ? ' — ' + esc(d.source) : '') + ' · quality: ' + esc(d.quality || 'unknown') + '</div></div>');
        }
        var harms = computeHarms({ harms: item.harms }, item);
        var harmRows = harms.map(function (h) { return harmItemHtml(h); }).join('');
        var burden = computeBurden(null, item);

        $('#results').innerHTML =
            '<div class="panel"><div class="panel-body">' +
            '<div style="display:flex;justify-content:space-between;gap:12px;flex-wrap:wrap;align-items:center;margin-bottom:8px">' +
            '<span class="prov-chip p-symp">' + (item.purpose === 'replacement' ? 'replacement therapy' : 'symptomatic therapy') + '</span>' +
            '<span class="subline">' + esc(item.name) + ' · ' + esc(ind.label) + '</span></div>' +
            '<p class="headline">This medicine is judged by <strong>how the patient feels</strong>, not by events prevented.</p>' +
            '<p class="subline">The prevention model deliberately does not apply: its benefit is ' + (item.purpose === 'replacement' ? 'replacing something missing' : 'symptom relief') + ', felt in days-to-weeks. Weigh that felt benefit directly against the harms and burden below — and stop it if it isn\'t helping.</p>' +
            '</div></div>' +
            '<div class="panel"><div class="panel-head"><h2>Reported benefit (from the meds.kevinkeet.com database)</h2></div>' +
            '<div class="panel-body"><div class="harm-list">' + (raws.join('') || '<p class="subline">No benefit data recorded.</p>') + '</div></div></div>' +
            '<div class="panel"><div class="panel-head"><h2>Harms, per 1000 over ' + state.horizon + ' years</h2></div>' +
            '<div class="panel-body"><div class="harm-list">' + (harmRows || '<p class="subline">No serious-harm rates recorded.</p>') + '</div></div></div>' +
            '<div class="panel"><div class="panel-head"><h2>Treatment burden</h2></div>' +
            '<div class="panel-body">' + burdenHtml(burden) + '</div></div>' +
            contraPanel(res);
    }

    function harmItemHtml(h) {
        var d = h.def;
        var negligible = h.cif * 1000 < 0.1;
        var scaleNote = h.mult !== 1
            ? '<div class="h-scale">Scaled ×' + h.mult.toFixed(1) + ' for this patient: ' + h.why.map(esc).join('; ') + '.</div>' : '';
        var oneTime = d.oneTimeExtra
            ? '<div class="h-src">Plus ~' + Math.round(d.oneTimeExtra * 100) + '% affected at or soon after starting (not shown in the per-1000 count).</div>' : '';
        return '<div class="harm-item sev-' + d.severity + '">' +
            '<div class="h-name">' + esc(d.label) + '<span class="sev-tag ' + d.severity + '">' + d.severity + '</span></div>' +
            '<div class="h-num' + (negligible ? ' negligible' : '') + '">' + (negligible ? '<0.1' : '+' + fmt1000(h.cif)) + ' /1000</div>' +
            scaleNote + oneTime +
            '<div class="h-src">' + esc(d.source) + '</div></div>';
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
        return '<div class="panel"><div class="panel-head"><h2>Contraindications (from the meds.kevinkeet.com database)</h2></div><div class="panel-body">' +
            (hits.length ? '<div class="flagline f-danger"><span class="fl-icon">✕</span><div><strong>This patient may hit: </strong>' + hits.map(esc).join(' · ') + '</div></div>' : '') +
            '<p class="trialbox" style="margin:' + (hits.length ? '10px' : '0') + ' 0 0">Check: ' + all.map(function (t) { return esc(t.replace(/_/g, ' ')); }).join(' · ') + '</p>' +
            '</div></div>';
    }

    function renderResults() {
        var root = $('#results');
        if (state.view === 'regimen') { renderRegimen(); return; }
        var res = resolve(state.selection);
        if (!res) {
            root.innerHTML = '<div class="panel"><div class="results-empty">Choose a medication to see individualized numbers.</div></div>';
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
        if (out.contraHits.length) {
            flags += '<div class="flagline f-danger"><span class="fl-icon">✕</span><div><strong>Possible contraindication:</strong> ' + out.contraHits.map(esc).join(' · ') + '.</div></div>';
        }
        if (wf.ttbExceedsSurvival) {
            flags += '<div class="flagline f-danger"><span class="fl-icon">!</span><div><strong>Time-to-benefit exceeds median survival.</strong> Median survival for this patient is ~' +
                out.life.median.toFixed(1) + ' y, but this therapy needs ~' + med.ttb.displayYears + ' y to deliver meaningful benefit (' + esc(med.ttb.display) + '). Most patients like this will carry the burden and harm risk without living to see the benefit (Holmes, Arch Intern Med 2006).</div></div>';
        } else if (med.ttb.displayYears >= 1 && out.life.median < med.ttb.displayYears * 2) {
            flags += '<div class="flagline"><span class="fl-icon">±</span><div><strong>Time-to-benefit is a real consideration here.</strong> ' + esc(med.ttb.display) + ' (' + esc(med.ttb.source) + '); median survival for this patient is ~' + out.life.median.toFixed(1) + ' y.</div></div>';
        }
        if (med.effect.ci && med.effect.ci[1] >= 1) {
            flags += '<div class="flagline"><span class="fl-icon">?</span><div><strong>The trial itself could not rule out "no benefit"</strong> (CI ' + med.effect.ci[0] + '–' + med.effect.ci[1] + '). Treat the benefit bar as fragile.</div></div>';
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

        // other outcomes strip (lifted multi-outcome entries)
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
            baseline: 'Swaps the trial\'s average baseline risk for this patient\'s own risk (' + (med.baseline.type === 'pce' ? 'Pooled Cohort Equations' : med.baseline.type === 'chadsvasc' ? 'CHA₂DS₂-VASc' : 'anchored to the trial control arm, scaled by the risk level you chose') + '). Relative effects travel across risk groups; absolute benefits don\'t (Kent & Hayward JAMA 2007; PATH 2020).',
            competing: 'Applies this patient\'s age, sex, and overall health: competing mortality means fewer patients survive long enough for prevention to pay off, especially with a time-to-benefit ramp (' + esc(med.ttb.display) + ').',
            adherence: 'Dilutes the relative effect by expected real-world adherence versus in-trial adherence (~' + Math.round((med.trial.adherence || 0.9) * 100) + '%). Trials overstate what a half-taken prescription delivers.'
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

        var harmRows = out.harms.map(harmItemHtml).join('');
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
            subgroups +
            '</dl>' +
            '<ul class="cites">' + med.citations.map(function (c) { return '<li>' + esc(c.label) + '</li>'; }).join('') + '</ul>';

        root.innerHTML =
            '<div class="panel"><div class="panel-body">' +
            '<div style="display:flex;justify-content:space-between;gap:12px;flex-wrap:wrap;align-items:center;margin-bottom:8px">' +
            '<span>' + badgeHtml(out.rep) + ' ' + provChip(res.mode) + '</span>' +
            '<span class="subline">' + esc(med.example) + ' · ' + esc(med.indication) + '</span></div>' +
            '<p class="headline">' + headline + '</p>' +
            '<p class="subline">' + out.base.display + ' · outcome: ' + esc(med.outcome.label) + '</p>' +
            flags +
            '</div></div>' +

            '<div class="panel"><div class="panel-head"><h2>Benefit, per 1000 patients over ' + H + ' years</h2></div>' +
            '<div class="panel-body"><div class="per1000">' + benefitRows + '</div>' + nntStrip + otherStrip + '</div></div>' +

            '<div class="panel"><div class="panel-head"><h2>From trial average to this patient</h2><span class="kicker">the adjustment, step by step</span></div>' +
            '<div class="panel-body"><div class="wf">' + wfRows + '</div>' +
            '<p class="wf-caption">Bars show events prevented per 1000 over ' + H + ' years at each stage. Step 1 replicates the trial itself (calibration). Steps 2–4 swap in this patient\'s baseline risk, prognosis, and adherence, in that fixed order — each multiplier shows how much that difference matters. Method &amp; citations: <a href="methods.html">methods</a>.</p>' +
            '</div></div>' +

            '<div class="panel"><div class="panel-head"><h2>Harms, per 1000 over the same ' + H + ' years</h2><span class="kicker">start immediately — no time-to-harm lag</span></div>' +
            '<div class="panel-body"><div class="harm-list">' + (harmRows || '<p class="subline">No serious-harm rates recorded for this entry.</p>') + '</div>' +
            '<p class="wf-caption">Excess events attributable to the drug, scaled to this patient\'s risk factors and expected exposure. Benefit and harm counts share the per-1000-over-' + H + '-years currency — but weigh severity before netting them.</p></div></div>' +

            '<div class="panel"><div class="panel-head"><h2>Treatment burden</h2><span class="kicker">the work of being a patient</span></div>' +
            '<div class="panel-body">' + burdenHtml(out.burden) +
            '<p class="wf-caption">Burden rubric in methods — the "workload" side of minimally disruptive medicine (May, Montori &amp; Mair, BMJ 2009).</p></div></div>' +

            contraPanel(res) +

            '<div class="panel"><div class="panel-head"><h2>Evidence &amp; representativeness</h2></div>' +
            '<div class="panel-body">' + repList + evidenceHtml + '</div></div>';
    }

    function currentAnchoredMult(res) {
        var med = res.med;
        if (!med || med.baseline.type !== 'anchored') return 1;
        var key = res.item.key + '.' + res.ind.id;
        var optId = state.anchored[key] || 'typical';
        var opt = med.baseline.options.find(function (o) { return o.id === optId; });
        return opt ? opt.mult : 1;
    }

    // ==================================================================
    // REGIMEN VIEW — severity-weighted ranking across applicable meds
    // ==================================================================
    function applicableIndications() {
        var eg = egfr();
        var inds = {};
        if (has('hf') && has('efLow')) inds.heart_failure = true;
        if (has('afib')) inds.afib_stroke_prevention = true;
        if (has('vascular') || has('priorStroke')) { inds.secondary_prevention = true; if (has('vascular')) inds.post_mi = true; }
        if (has('htn')) inds.hypertension = true;
        if (has('diabetes')) {
            inds.diabetes = true; inds.diabetes_cv = true;
            if (has('vascular')) inds.diabetes_with_cvd = true;
        }
        if (has('ckd45') || (eg && eg.egfr < 60)) inds.ckd = true;
        if (has('osteoporosis')) inds.osteoporosis = true;
        if (has('copd') || has('copdO2')) inds.copd = true;
        if (!has('vascular') && !has('priorStroke') && state.age >= 40 && state.age <= 79) {
            inds.primary_prevention = true; inds.primary_prevention_high_risk = true; inds.ascvd_prevention = true;
        }
        return inds;
    }

    function regimenCandidates() {
        var inds = applicableIndications();
        var list = [];
        CATALOG.forEach(function (item) {
            item.indications.forEach(function (ind) {
                var applies = inds[ind.id] ||
                    (item.isStrategy && (
                        (ind.deepId === 'bp-standard' || ind.deepId === 'bp-intensive') && has('htn') ||
                        ind.deepId === 'tight-glucose' && has('diabetes')
                    )) ||
                    state.regimenAdded[item.key + '.' + ind.id];
                if (!applies) return;
                if (!ind.outcomes.length && !ind.deepId) return; // symptomatic — listed separately
                list.push({ key: item.key, indId: ind.id, item: item, ind: ind });
            });
        });
        return list;
    }

    function scoreRegimenEntry(cand) {
        var res = resolve({ key: cand.key, indId: cand.indId });
        if (!res || res.mode === 'symptomatic') return null;
        var out = computeSingle(res);
        var H = state.horizon;

        // Primary-outcome weighted benefit (per-1000 QALY-points over horizon)
        var primaryWeight = res.mode === 'lifted'
            ? res.outcomes[0].weight
            : (Lift.OUTCOME_WEIGHTS[guessWeightKey(out.med)] != null ? Lift.OUTCOME_WEIGHTS[guessWeightKey(out.med)] : 0.35);
        var benefitScore = out.wf.final.arr * primaryWeight * 1000;

        // Secondary outcomes for lifted entries
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

        // Burden penalty: use the medeval tier for EVERY row so deep and
        // lifted entries score on the same scale (deep-dive rubric is display
        // only). medeval annual QALY decrement × horizon, tempered ×0.2 so
        // burden tiebreaks rather than dominates hard outcomes; see methods.
        var tierPenalty = res.item.burdenTier
            ? Lift.BURDEN_PENALTIES[res.item.burdenTier]
            : (out.burden.penalty != null ? out.burden.penalty : out.burden.score * 0.01 - 0.005);
        var burdenPenalty = Math.max(0, tierPenalty) * H * 1000 * 0.2;

        var flags = [];
        if (out.contraHits.length) flags.push({ cls: 'f-red', txt: 'contraindication?' });
        if (out.rep.level === 'outside') flags.push({ cls: 'f-red', txt: 'outside evidence' });
        else if (out.rep.level === 'extrapolated') flags.push({ cls: 'f-amber', txt: 'extrapolated' });
        if (out.wf.ttbExceedsSurvival) flags.push({ cls: 'f-amber', txt: 'TTB > survival' });
        if (out.med.effect.ci && out.med.effect.ci[1] >= 1) flags.push({ cls: 'f-grey', txt: 'benefit unproven' });

        return {
            cand: cand, res: res, out: out,
            benefitScore: benefitScore, harmScore: harmScore, burdenPenalty: burdenPenalty,
            net: benefitScore - harmScore - burdenPenalty,
            prevented1000: out.wf.final.arr * 1000,
            flags: flags
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

    function rgRowHtml(s, maxAbs) {
        var flags = s.flags.map(function (f) {
            return '<span class="rg-flag ' + f.cls + '">' + f.txt + '</span>';
        }).join('');
        var w = Math.min(100, Math.abs(s.net) / maxAbs * 100);
        var barCls = s.net >= 0 ? 'benefit' : 'harm';
        return '<button type="button" class="rg-row" data-key="' + esc(s.cand.key) + '" data-ind="' + esc(s.cand.indId) + '">' +
            '<div class="rg-name">' + provDot(s.res.mode) + esc(s.cand.item.name) + '<span class="rg-ind">' + esc(s.cand.ind.label) + '</span>' + (flags ? '<span class="rg-flags">' + flags + '</span>' : '') + '</div>' +
            '<div class="rg-nums"><span class="rg-benefit">' + fmt1000(s.out.wf.final.arr) + '/1000 ' + esc(s.res.mode === 'lifted' ? s.res.outcomes[0].shortLabel : s.out.med.outcome.shortLabel) + ' (+' + s.benefitScore.toFixed(1) + ')</span>' +
            '<span class="rg-harm">' + (s.harmScore > 0.05 ? 'harms −' + s.harmScore.toFixed(1) : 'minimal harms') + ' · burden −' + s.burdenPenalty.toFixed(0) + '</span></div>' +
            '<div class="rg-bar-wrap"><div class="rg-bar"><div class="rg-fill ' + barCls + '" style="width:' + w.toFixed(1) + '%"></div></div>' +
            '<span class="rg-net ' + (s.net >= 0 ? 'benefit' : 'harm') + '">' + (s.net >= 0 ? '+' : '') + s.net.toFixed(1) + '</span></div>' +
            '</button>';
    }

    function renderRegimen() {
        var root = $('#results');
        var cands = regimenCandidates();
        var allScored = cands.map(scoreRegimenEntry).filter(Boolean)
            .sort(function (a, b) { return b.net - a.net; });
        // Rows with a matched contraindication are not ranked alongside the
        // clean ones — verify-first, then compare.
        var scored = allScored.filter(function (s) { return !s.out.contraHits.length; });
        var contra = allScored.filter(function (s) { return s.out.contraHits.length; });

        var maxAbs = Math.max.apply(null, allScored.map(function (s) { return Math.abs(s.net); }).concat([1]));
        var rows = scored.map(function (s) { return rgRowHtml(s, maxAbs); }).join('');
        var contraRows = contra.map(function (s) { return rgRowHtml(s, maxAbs); }).join('');

        // symptomatic meds applicable by indication, listed separately
        var inds = applicableIndications();
        var symp = [];
        CATALOG.forEach(function (item) {
            if (item.purpose !== 'symptomatic' && item.purpose !== 'replacement') return;
            item.indications.forEach(function (ind) {
                if (inds[ind.id] || state.regimenAdded[item.key + '.' + ind.id]) {
                    symp.push('<button type="button" class="rg-symp" data-key="' + esc(item.key) + '" data-ind="' + esc(ind.id) + '">' + esc(item.name) + ' <span>' + esc(ind.label) + ' — judge by symptoms</span></button>');
                }
            });
        });

        var addOptions = CATALOG.map(function (item) {
            return item.indications.map(function (ind) {
                return '<option value="' + esc(item.key + '.' + ind.id) + '">' + esc(item.name) + ' — ' + esc(ind.label) + '</option>';
            }).join('');
        }).join('');

        root.innerHTML =
            '<div class="panel"><div class="panel-body">' +
            '<p class="headline">Every applicable therapy for this patient, <strong>ranked by severity-weighted net benefit</strong> over ' + state.horizon + ' years.</p>' +
            '<p class="subline">Net score = Σ(events prevented ×severity) − Σ(harms ×severity) − burden, per 1000 patients. Severity weights are the QALY-utility estimates from the meds.kevinkeet.com engine; the per-1000 event counts come from the competing-hazards model. Ranking is a screen, not a verdict — click any row for the full workup.</p>' +
            '</div></div>' +
            '<div class="panel"><div class="panel-head"><h2>Ranked net benefit</h2><span class="kicker">' + scored.length + ' modelable therapies</span></div>' +
            '<div class="panel-body"><div class="rg-list">' + (rows || '<p class="subline">Tick the patient\'s conditions to populate candidate therapies.</p>') + '</div>' +
            '<div class="field" style="margin-top:14px"><label for="rg-add">Add another therapy to the comparison</label>' +
            '<select id="rg-add"><option value="">— choose —</option>' + addOptions + '</select></div>' +
            '</div></div>' +
            (contraRows ? '<div class="panel"><div class="panel-head"><h2>Held out — possible contraindication for this patient</h2><span class="kicker">verify before comparing</span></div>' +
                '<div class="panel-body"><div class="rg-list">' + contraRows + '</div>' +
                '<p class="wf-caption">These matched a contraindication token from the meds.kevinkeet.com database against this patient\'s profile (details on each medication\'s page). They are scored but deliberately not ranked with the rest.</p></div></div>' : '') +
            (symp.length ? '<div class="panel"><div class="panel-head"><h2>Symptom-directed &amp; replacement therapies</h2><span class="kicker">not rankable by events</span></div>' +
                '<div class="panel-body"><div class="rg-list">' + symp.join('') + '</div>' +
                '<p class="wf-caption">These are judged by felt benefit against harms and burden — the prevention model deliberately abstains.</p></div></div>' : '');

        root.querySelectorAll('.rg-row, .rg-symp').forEach(function (btn) {
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
            renderResults();
        });
    }

    function provDot(mode) {
        return mode === 'deep' ? '<span class="prov-dot" title="verified deep entry">★</span>' : '';
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

    function renderConditions() {
        var wrap = $('#cond-grid');
        wrap.innerHTML = '';
        COND_DEFS.forEach(function (c) {
            var lab = el('<label><input type="checkbox" value="' + c.id + '"' + (has(c.id) ? ' checked' : '') + '><span>' + esc(c.label) + '</span></label>');
            lab.querySelector('input').addEventListener('change', function (e) {
                if (e.target.checked) state.conditions[c.id] = true;
                else delete state.conditions[c.id];
                if (c.id === 'copdO2' && e.target.checked) state.conditions.copd = true;
                update();
            });
            wrap.appendChild(lab);
        });
    }

    // Grouped med picker
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
        if (!item || item.indications.length <= 1) {
            wrap.hidden = true;
            return;
        }
        wrap.hidden = false;
        var sel = $('#ind-select');
        sel.innerHTML = item.indications.map(function (i) {
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
        if (!res || res.mode === 'symptomatic' || state.view === 'regimen') { panel.hidden = true; return; }
        var med = res.med;
        panel.hidden = false;
        var b = med.baseline;
        var selKey = res.item.key + '.' + res.ind.id;

        if (b.type === 'pce') {
            body.innerHTML =
                '<div class="inline-fields">' +
                '<div class="field"><label for="pce-tc">Total chol</label><input id="pce-tc" type="number" min="120" max="320" value="' + state.pce.totalChol + '"></div>' +
                '<div class="field"><label for="pce-hdl">HDL</label><input id="pce-hdl" type="number" min="20" max="100" value="' + state.pce.hdl + '"></div>' +
                '<div class="field"><label for="pce-sbp">SBP</label><input id="pce-sbp" type="number" min="90" max="200" value="' + state.pce.sbp + '"></div>' +
                '</div>' +
                '<div class="field" style="margin-top:12px"><label for="pce-race">PCE cohort</label><select id="pce-race"><option value="other"' + (state.pce.race === 'other' ? ' selected' : '') + '>White / other</option><option value="black"' + (state.pce.race === 'black' ? ' selected' : '') + '>Black / African American</option></select></div>' +
                '<div class="check-grid" style="margin-top:8px">' +
                '<label><input type="checkbox" id="pce-tx"' + (state.pce.bpTreated ? ' checked' : '') + '><span>On BP treatment</span></label>' +
                '<label><input type="checkbox" id="pce-smoke"' + (state.pce.smoker ? ' checked' : '') + '><span>Current smoker</span></label>' +
                '</div>' +
                '<p class="hint" id="pce-out"></p>';
            ['pce-tc', 'pce-hdl', 'pce-sbp'].forEach(function (id) {
                $('#' + id).addEventListener('input', function () {
                    var v = parseFloat(this.value);
                    if (!isFinite(v)) return;
                    if (id === 'pce-tc') state.pce.totalChol = v;
                    if (id === 'pce-hdl') state.pce.hdl = v;
                    if (id === 'pce-sbp') state.pce.sbp = v;
                    update(true);
                });
            });
            $('#pce-race').addEventListener('change', function () { state.pce.race = this.value; update(true); });
            $('#pce-tx').addEventListener('change', function () { state.pce.bpTreated = this.checked; update(true); });
            $('#pce-smoke').addEventListener('change', function () { state.pce.smoker = this.checked; update(true); });
        } else if (b.type === 'chadsvasc') {
            body.innerHTML = '<p class="hint" style="margin:0" id="cv-out"></p><p class="hint">Score counts age, sex, and the ticked conditions (heart failure, hypertension, diabetes, prior stroke/TIA, prior MI/PAD).</p>';
        } else {
            var cur = state.anchored[selKey] || 'typical';
            body.innerHTML = '<div class="radio-cards">' + b.options.map(function (o) {
                return '<label><input type="radio" name="anch" value="' + o.id + '"' + (o.id === cur ? ' checked' : '') + '><span class="rc-title">' + esc(o.label) + '</span></label>';
            }).join('') + '</div><p class="hint">' + esc(b.rateSource) + '</p>';
            body.querySelectorAll('input[name="anch"]').forEach(function (inp) {
                inp.addEventListener('change', function () {
                    state.anchored[selKey] = this.value; update(true);
                });
            });
        }
        refreshBaselineReadout();
    }

    function refreshBaselineReadout() {
        var res = resolve(state.selection);
        if (!res || res.mode === 'symptomatic') return;
        var out = $('#pce-out') || $('#cv-out');
        if (out) out.innerHTML = baselineHazard(res.med, res.item.key + '.' + res.ind.id).display;
    }

    function renderLifeReadout() {
        var life = E.lifeExpectancy(state.age, state.sex, healthMult());
        var eg = egfr();
        $('#life-readout').innerHTML =
            'With this profile: life expectancy ≈ <strong>' + life.le.toFixed(1) + ' y</strong>, median survival ≈ <strong>' + life.median.toFixed(1) + ' y</strong>.' +
            (eg ? '<br>eGFR (CKD-EPI 2021): <strong>' + eg.egfr + '</strong> mL/min (' + eg.stage + ').' : '') +
            ' Prognosis gates how much slow-payoff prevention can deliver.';
    }

    function syncViewSeg() {
        document.querySelectorAll('[data-view]').forEach(function (b) {
            b.setAttribute('aria-pressed', String(b.dataset.view === state.view));
        });
    }

    // ------------------------------------------------------------------
    function update(skipBaselineRebuild) {
        renderLifeReadout();
        if (!skipBaselineRebuild) renderBaselinePanel();
        else refreshBaselineReadout();
        renderResults();
    }

    function init() {
        $('#foot-disclaimer').textContent = Lib.disclaimer;

        $('#pt-age').addEventListener('input', function () {
            var v = parseInt(this.value, 10);
            if (isFinite(v) && v >= 18 && v <= 105) { state.age = v; update(); }
        });
        $('#pt-cr').addEventListener('input', function () {
            var v = parseFloat(this.value);
            state.creatinine = isFinite(v) && v > 0.2 ? v : null;
            var eg = egfr();
            if (eg && eg.egfr < 30) state.conditions.ckd45 = true;
            renderConditions();
            update();
        });
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

        renderHealthCards();
        renderAdherenceCards();
        renderConditions();
        renderMedPicker();
        update();
    }

    document.addEventListener('DOMContentLoaded', init);
})();
