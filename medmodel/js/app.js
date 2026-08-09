/**
 * MedModel — application wiring.
 * State → engine (BenefitModel) → rendered results.
 * All computation lives in engine.js; all evidence in data/*.js.
 */
(function () {
    'use strict';

    var E = window.BenefitModel;
    var L = window.LifeTables;
    var R = window.RiskModels;
    var Lib = window.MedLibrary;

    // ------------------------------------------------------------------
    // Condition checklist: one unified list feeding risk scores (CHA2DS2-VASc),
    // harm scaling, representativeness rules, and mortality multipliers.
    // ------------------------------------------------------------------
    var COND_DEFS = [
        { id: 'htn',        label: 'Hypertension' },
        { id: 'diabetes',   label: 'Type 2 diabetes' },
        { id: 'prediabetes', label: 'Prediabetes' },
        { id: 'hf',         label: 'Heart failure' },
        { id: 'vascular',   label: 'Prior MI / PAD' },
        { id: 'priorStroke', label: 'Prior stroke / TIA' },
        { id: 'priorBleed', label: 'Prior major bleed' },
        { id: 'ckd45',      label: 'CKD 4–5 (eGFR <30)' },
        { id: 'copdO2',     label: 'COPD on home O₂' },
        { id: 'dementia',   label: 'Dementia' },
        { id: 'cancer',     label: 'Metastatic cancer' },
        { id: 'asian',      label: 'East / SE Asian ancestry' }
    ];

    var HEALTH_RANK = { excellent: 0, good: 1, average: 2, fair: 3, poor: 4 };

    var state = {
        age: 76, sex: 'female', health: 'average',
        conditions: {},          // id -> true
        adherence: 'typical',
        horizon: 5,
        medId: null,
        pce: { totalChol: 200, hdl: 50, sbp: 138, bpTreated: false, smoker: false, race: 'other' },
        anchored: {}             // medId -> option id
    };

    function $(sel) { return document.querySelector(sel); }
    function el(html) {
        var t = document.createElement('template');
        t.innerHTML = html.trim();
        return t.content.firstChild;
    }
    function esc(s) {
        return String(s).replace(/[&<>"']/g, function (c) {
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
    // Baseline risk per medication
    // ------------------------------------------------------------------
    function baselineHazard(med) {
        var b = med.baseline;
        if (b.type === 'pce') {
            var r10 = R.pce10y({
                age: state.age, sex: state.sex, race: state.pce.race,
                totalChol: state.pce.totalChol, hdl: state.pce.hdl,
                sbp: state.pce.sbp, bpTreated: state.pce.bpTreated,
                smoker: state.pce.smoker,
                diabetes: has('diabetes')
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
                display: 'CHA₂DS₂-VASc <strong>' + f.score + '</strong> → untreated stroke/embolism rate ≈ <strong>' + f.annualRatePct + '%/year</strong> (Friberg 2012)',
                score: f.score
            };
        }
        // anchored
        var optId = state.anchored[med.id] ||
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
        var names = ['in', 'extrapolated', 'outside'];
        return { level: names[level], reasons: reasons };
    }

    // ------------------------------------------------------------------
    // Harms
    // ------------------------------------------------------------------
    function computeHarms(med) {
        return (med.harms || []).map(function (h) {
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
            return { def: h, cif: res.cif, mult: mult, why: why };
        }).sort(function (a, b) {
            var rank = { serious: 0, moderate: 1, nuisance: 2 };
            return (rank[a.def.severity] - rank[b.def.severity]) || (b.cif - a.cif);
        });
    }

    // ------------------------------------------------------------------
    // Burden (rubric documented in methods.html)
    // ------------------------------------------------------------------
    function computeBurden(med) {
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
        var cat = score < 2 ? 'low' : (score <= 4.5 ? 'moderate' : 'high');
        return { score: score, cat: cat, facts: facts };
    }

    // ------------------------------------------------------------------
    // Main computation
    // ------------------------------------------------------------------
    function compute() {
        var med = Lib.meds.find(function (m) { return m.id === state.medId; });
        if (!med) return null;

        var base = baselineHazard(med);
        var wf = E.waterfall({
            horizonYears: state.horizon,
            trial: {
                annualControlHazard: E.cumRiskToAnnualHazard(med.trial.annualControlRate, 1),
                hr: med.effect.hr,
                meanAge: med.trial.meanAge,
                sex: med.trial.sex,
                adherence: med.trial.adherence,
                ttbYears: med.ttb.rampYears,
                healthMult: 0.85 // trial populations are screened healthier than average
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
            harms: computeHarms(med),
            burden: computeBurden(med),
            rep: representativeness(med),
            life: wf.life
        };
    }

    // ------------------------------------------------------------------
    // Renderers
    // ------------------------------------------------------------------
    function badgeHtml(rep) {
        var map = {
            in: ['b-in', 'Patients like this were in the trials'],
            extrapolated: ['b-ex', 'Extrapolated beyond the trial population'],
            outside: ['b-out', 'Outside the trial evidence']
        };
        var m = map[rep.level];
        return '<span class="badge ' + m[0] + '">' + m[1] + '</span>';
    }

    function renderResults() {
        var out = compute();
        var root = $('#results');
        if (!out) {
            root.innerHTML = '<div class="panel"><div class="results-empty">Choose a medication to see individualized numbers.</div></div>';
            return;
        }
        var med = out.med, wf = out.wf, fin = wf.final;
        var H = state.horizon;
        var per1000Prevented = fin.arr * 1000;

        // ---- headline ----
        var headline =
            'Of <strong>1000 patients like this</strong> taking <span class="hl-med">' + esc(med.name) + '</span> for ' + H + ' years, about ' +
            '<span class="hl-benefit">' + fmt1000(fin.arr) + ' avoid ' + esc(med.outcome.shortLabel) + '</span>' +
            ' who would otherwise have had them.';

        var flags = '';
        if (wf.ttbExceedsSurvival) {
            flags += '<div class="flagline f-danger"><span class="fl-icon">!</span><div><strong>Time-to-benefit exceeds median survival.</strong> Median survival for this patient is ~' +
                out.life.median.toFixed(1) + ' y, but this therapy needs ~' + med.ttb.displayYears + ' y to deliver meaningful benefit (' + esc(med.ttb.display) + '). Most patients like this will carry the burden and harm risk without living to see the benefit (Holmes, Arch Intern Med 2006).</div></div>';
        } else if (med.ttb.displayYears >= 1 && out.life.median < med.ttb.displayYears * 2) {
            flags += '<div class="flagline"><span class="fl-icon">±</span><div><strong>Time-to-benefit is a real consideration here.</strong> ' + esc(med.ttb.display) + ' (' + esc(med.ttb.source) + '); median survival for this patient is ~' + out.life.median.toFixed(1) + ' y.</div></div>';
        }
        if (med.effect.ci && med.effect.ci[1] >= 1) {
            flags += '<div class="flagline"><span class="fl-icon">?</span><div><strong>The trial itself could not rule out "no benefit"</strong> (CI ' + med.effect.ci[0] + '–' + med.effect.ci[1] + '). Treat the benefit bar as fragile.</div></div>';
        }

        // ---- benefit bars ----
        var absScale = Math.max(fin.cifUntreated, 0.02);
        var deltaScale = Math.max(fin.arr, 0.01);
        out.harms.forEach(function (h) { deltaScale = Math.max(deltaScale, h.cif); });

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

        // ---- waterfall ----
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
            var multTxt = prevArr != null && prevArr > 1e-9
                ? '×' + (arr / prevArr).toFixed(2)
                : '';
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

        // ---- harms ----
        var harmRows = out.harms.map(function (h) {
            var d = h.def;
            var negligible = h.cif * 1000 < 0.1;
            var scaleNote = h.mult !== 1
                ? '<div class="h-scale">Scaled ×' + h.mult.toFixed(1) + ' for this patient: ' + h.why.map(esc).join('; ') + '.</div>'
                : '';
            var oneTime = d.oneTimeExtra
                ? '<div class="h-src">Plus ~' + Math.round(d.oneTimeExtra * 100) + '% affected at or soon after starting (not shown in the per-1000 count).</div>'
                : '';
            return '<div class="harm-item sev-' + d.severity + '">' +
                '<div class="h-name">' + esc(d.label) + '<span class="sev-tag ' + d.severity + '">' + d.severity + '</span></div>' +
                '<div class="h-num' + (negligible ? ' negligible' : '') + '">' + (negligible ? '<0.1' : '+' + fmt1000(h.cif)) + ' /1000</div>' +
                scaleNote + oneTime +
                '<div class="h-src">' + esc(d.source) + '</div>' +
                '</div>';
        }).join('');

        // ---- burden ----
        var b = out.burden;
        var burdenHtml =
            '<div class="burden-wrap"><div class="burden-dial">' +
            '<div class="b-score">' + b.score.toFixed(1) + '<small style="font-size:15px;color:var(--ink-faint)">/10</small></div>' +
            '<div class="b-cat" style="color:' + (b.cat === 'low' ? 'var(--benefit)' : b.cat === 'moderate' ? 'var(--caution)' : 'var(--harm)') + '">' + b.cat + ' burden</div>' +
            '<div class="b-track"><div class="b-fill" style="width:' + (b.score * 10) + '%"></div></div>' +
            '</div><ul class="burden-facts">' + b.facts.map(function (f) { return '<li>' + f + '</li>'; }).join('') + '</ul></div>';

        // ---- evidence ----
        var t = med.trial;
        var subgroups = (med.subgroups || []).map(function (s) {
            return '<dt>' + esc(s.label) + '</dt><dd>' + esc(s.text) + '</dd>';
        }).join('');
        var repList = out.rep.reasons.length
            ? '<ul class="rep-reasons">' + out.rep.reasons.map(function (r) { return '<li>' + esc(r) + '</li>'; }).join('') + '</ul>'
            : '<p class="trialbox" style="margin:6px 0 0">A patient with this profile was reasonably represented in the underlying trials.</p>';

        var evidenceHtml =
            '<dl class="trialbox">' +
            '<dt>Effect estimate</dt><dd>HR/RR ' + med.effect.hr + ' (95% CI ' + med.effect.ci[0] + '–' + med.effect.ci[1] + ') — ' + esc(med.effect.source) + (med.effect.note ? '<br>' + esc(med.effect.note) : '') + '</dd>' +
            '<dt>Source population</dt><dd>' + esc(t.name) + ' — mean age ' + t.meanAge + ', ' + t.pctFemale + '% women, median follow-up ' + t.medianFollowupYears + ' y, in-trial adherence ~' + Math.round((t.adherence || 0.9) * 100) + '%' + '</dd>' +
            '<dt>Who was excluded</dt><dd>' + t.keyExclusions.map(esc).join(' · ') + '</dd>' +
            subgroups +
            '</dl>' +
            '<ul class="cites">' + med.citations.map(function (c) { return '<li>' + esc(c.label) + '</li>'; }).join('') + '</ul>';

        root.innerHTML =
            '<div class="panel"><div class="panel-body">' +
            '<div style="display:flex;justify-content:space-between;gap:12px;flex-wrap:wrap;align-items:center;margin-bottom:8px">' +
            badgeHtml(out.rep) +
            '<span class="subline">' + esc(med.example) + ' · ' + esc(med.indication) + '</span></div>' +
            '<p class="headline">' + headline + '</p>' +
            '<p class="subline">' + out.base.display + ' · outcome: ' + esc(med.outcome.label) + '</p>' +
            flags +
            '</div></div>' +

            '<div class="panel"><div class="panel-head"><h2>Benefit, per 1000 patients over ' + H + ' years</h2></div>' +
            '<div class="panel-body"><div class="per1000">' + benefitRows + '</div>' + nntStrip + '</div></div>' +

            '<div class="panel"><div class="panel-head"><h2>From trial average to this patient</h2><span class="kicker">the adjustment, step by step</span></div>' +
            '<div class="panel-body"><div class="wf">' + wfRows + '</div>' +
            '<p class="wf-caption">Bars show events prevented per 1000 over ' + H + ' years at each stage. Step 1 replicates the trial itself (calibration). Steps 2–4 swap in this patient\'s baseline risk, prognosis, and adherence, in that fixed order — each multiplier shows how much that difference matters. Method &amp; citations: <a href="methods.html">methods</a>.</p>' +
            '</div></div>' +

            '<div class="panel"><div class="panel-head"><h2>Harms, per 1000 over the same ' + H + ' years</h2><span class="kicker">start immediately — no time-to-harm lag</span></div>' +
            '<div class="panel-body"><div class="harm-list">' + harmRows + '</div>' +
            '<p class="wf-caption">Excess events attributable to the drug (beyond what similar patients experience without it), scaled to this patient\'s risk factors and expected exposure. Benefit and harm counts are per-1000 over the same horizon and can be compared directly — but weigh severity: a prevented stroke and a genital yeast infection are not the same currency.</p></div></div>' +

            '<div class="panel"><div class="panel-head"><h2>Treatment burden</h2><span class="kicker">the work of being a patient</span></div>' +
            '<div class="panel-body">' + burdenHtml +
            '<p class="wf-caption">Burden is scored from dosing, monitoring, constraints, cost, and interactions (rubric in methods) — the "workload" side of minimally disruptive medicine (May, Montori &amp; Mair, BMJ 2009).</p></div></div>' +

            '<div class="panel"><div class="panel-head"><h2>Evidence &amp; representativeness</h2></div>' +
            '<div class="panel-body">' + repList + evidenceHtml + '</div></div>';
    }

    // ------------------------------------------------------------------
    // Left rail rendering
    // ------------------------------------------------------------------
    function renderHealthCards() {
        var wrap = $('#health-cards');
        wrap.innerHTML = '';
        L.HEALTH_LEVELS.forEach(function (h) {
            var lab = el('<label><input type="radio" name="health" value="' + h.id + '"' + (state.health === h.id ? ' checked' : '') + '><span class="rc-title">' + esc(h.label) + '</span><div class="rc-desc">' + esc(h.desc) + '</div></label>');
            lab.querySelector('input').addEventListener('change', function () {
                state.health = h.id; update();
            });
            wrap.appendChild(lab);
        });
    }

    function renderAdherenceCards() {
        var wrap = $('#adh-cards');
        wrap.innerHTML = '';
        Lib.ADHERENCE_LEVELS.forEach(function (a) {
            var lab = el('<label><input type="radio" name="adh" value="' + a.id + '"' + (state.adherence === a.id ? ' checked' : '') + '><span class="rc-title">' + esc(a.label) + '</span><div class="rc-desc">' + esc(a.desc) + '</div></label>');
            lab.querySelector('input').addEventListener('change', function () {
                state.adherence = a.id; update();
            });
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
                update();
            });
            wrap.appendChild(lab);
        });
    }

    function renderMedList() {
        var wrap = $('#med-list');
        wrap.innerHTML = '';
        Lib.meds.forEach(function (m) {
            var btn = el('<button type="button" class="med-item" aria-pressed="' + (state.medId === m.id) + '"><div class="mi-name">' + esc(m.name) + '</div><div class="mi-class">' + esc(m.tagline) + '</div></button>');
            btn.addEventListener('click', function () {
                state.medId = m.id;
                renderMedList();
                update();
            });
            wrap.appendChild(btn);
        });
    }

    function renderBaselinePanel() {
        var med = Lib.meds.find(function (m) { return m.id === state.medId; });
        var panel = $('#baseline-panel'), body = $('#baseline-body');
        if (!med) { panel.hidden = true; return; }
        panel.hidden = false;
        var b = med.baseline;

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
            var cur = state.anchored[med.id] || (b.options.find(function (o) { return o.id === 'typical'; }) || b.options[0]).id;
            body.innerHTML = '<div class="radio-cards">' + b.options.map(function (o) {
                return '<label><input type="radio" name="anch" value="' + o.id + '"' + (o.id === cur ? ' checked' : '') + '><span class="rc-title">' + esc(o.label) + '</span></label>';
            }).join('') + '</div><p class="hint">' + esc(b.rateSource) + '</p>';
            body.querySelectorAll('input[name="anch"]').forEach(function (inp) {
                inp.addEventListener('change', function () {
                    state.anchored[med.id] = this.value; update(true);
                });
            });
        }
        refreshBaselineReadout();
    }

    function refreshBaselineReadout() {
        var med = Lib.meds.find(function (m) { return m.id === state.medId; });
        if (!med) return;
        if (med.baseline.type === 'pce' && $('#pce-out')) {
            $('#pce-out').innerHTML = baselineHazard(med).display;
        }
        if (med.baseline.type === 'chadsvasc' && $('#cv-out')) {
            $('#cv-out').innerHTML = baselineHazard(med).display;
        }
    }

    function renderLifeReadout() {
        var life = E.lifeExpectancy(state.age, state.sex, healthMult());
        $('#life-readout').innerHTML =
            'With this profile: life expectancy ≈ <strong>' + life.le.toFixed(1) + ' y</strong>, median survival ≈ <strong>' + life.median.toFixed(1) + ' y</strong>. Prognosis gates how much slow-payoff prevention can deliver.';
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

        renderHealthCards();
        renderAdherenceCards();
        renderConditions();
        renderMedList();
        update();
    }

    document.addEventListener('DOMContentLoaded', init);
})();
