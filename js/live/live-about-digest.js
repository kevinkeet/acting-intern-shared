/**
 * Live Coworker, "Inside the coworker" → Digestion: how the chart becomes what the
 * brain holds in mind. Loaded by the about sheet (js/live/live-about.js) the
 * first time its tab opens; DOM only.
 *
 * One flowing picture, top to bottom: the raw chart, the fact cards Haiku wrote
 * from each record, the memory Sonnet wrote from the cards, the digest the brain
 * always has in mind, and (live) what each brain call reads. Each bar is a stage,
 * its width on a log scale of its size (so all stay visible), split into what it
 * is made of. The cards and the memory also go "on call" as the long-term memory
 * a helper reads. Numbers come from data/live/<patient>-memory-stats.json
 * (tools/live/memory-stats.mjs) and, live, from the engine's call log.
 */
(function (root) {
    'use strict';

    const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    const reduceMotion = () => !!(root.matchMedia && root.matchMedia('(prefers-reduced-motion: reduce)').matches);
    const num = (n) => Number(n || 0).toLocaleString('en-US');
    const size = (b) => (b >= 1048576 ? (b / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(b / 1024)) + ' KB');
    const ktok = (t) => (t >= 10000 ? Math.round(t / 1000) + 'K' : (Math.round(t / 100) / 10) + 'K');
    const pct = (a, b) => (b ? Math.round((a / b) * 100) : 0);
    const f1 = (n) => (Math.round(n * 10) / 10).toString();
    const median = (a) => { if (!a.length) return 0; const s = a.slice().sort((x, y) => x - y); return s[Math.floor(s.length / 2)]; };
    // "about 80 times": friendly rounding for a ratio said in words.
    const times = (r) => (r >= 100 ? Math.round(r / 10) * 10 : r >= 20 ? Math.round(r / 5) * 5 : r >= 10 ? Math.round(r) : Math.round(r * 10) / 10);
    const ratio = (a, b) => (b ? a / b : 0);
    const shrink = (r) => (r >= 10 ? Math.round(r) : f1(r));

    const W = 400, CX = 200, MAXW = 360, MINW = 30, TITLE = 20, BAR = 22, CONN = 42;
    const PITCH = TITLE + BAR + CONN;
    const BRAIN = ['verify', 'answer', 'update', 'prime'];
    const yTop = (i) => 6 + i * PITCH;
    const barTop = (i) => yTop(i) + TITLE;
    const barBottom = (i) => barTop(i) + BAR;
    const H = barBottom(4) + 30;

    // What each kind of part is called and how it is coloured (classes in css/live-about-digest.css).
    const FOLDERS = [['notes', 'notes', 'k-note'], ['labs', 'labs', 'k-lab'], ['imaging', 'imaging', 'k-img'], ['patient', 'patient folder', 'k-patient'],
        ['encounters', 'visits', 'k-enc'], ['vitals', 'vitals', 'k-vit']];
    const ITEM_CLS = { key_findings: 'k-find', lab_values: 'k-lab', problems_mentioned: 'k-prob', action_items: 'k-act', vital_signs: 'k-vit', safety_concerns: 'k-safe', medication_changes: 'k-img' };
    const SECTION_CLS = { labTrends: 'k-lab', problemAnalysis: 'k-find', pendingItems: 'k-act', safetyProfile: 'k-safe', patientOverview: 'k-prob', medicationRationale: 'k-img', changesSinceLastReview: 'k-soft', clinicalGestalt: 'k-deep' };
    const CALL_PARTS = [['tools', 'its tools', 'k-tools'], ['rules', 'its rules', 'k-rules'], ['digest', 'the digest', 'k-prob'], ['longterm', 'long-term memory', 'k-img'],
        ['memory', 'working memory', 'k-wm'], ['conversation', 'what it heard', 'k-conv'], ['lookups', 'lookups', 'k-look'], ['task', 'the task', 'k-task']];
    const CACHED = { tools: 1, rules: 1, digest: 1, longterm: 1 };

    /** The stages from the record's numbers (null when the stats are missing). */
    function stagesOf(ms) {
        if (!ms || !ms.chart || !ms.factCards || !ms.memoryDocument || !ms.digest) return null;
        const bf = ms.chart.byFolder || {};
        const named = FOLDERS.filter(([k]) => bf[k]);
        const other = Object.keys(bf).filter((k) => !FOLDERS.some(([f]) => f === k)).reduce((a, k) => a + bf[k], 0);
        const chartParts = named.map(([k, label, cls]) => ({ label, v: bf[k], cls, note: size(bf[k]) }))
            .concat(other ? [{ label: 'orders, medicines, problems, procedures', v: other, cls: 'k-other', note: size(other) }] : []);
        const cardParts = (ms.factCards.items || []).map((x) => ({ label: x.label.toLowerCase(), v: x.n, cls: ITEM_CLS[x.key] || 'k-other', note: num(x.n) }));
        const memParts = (ms.memoryDocument.sections || []).map((x) => ({ label: x.label.toLowerCase(), v: x.chars, cls: SECTION_CLS[x.key] || 'k-other', note: x.count != null && x.count > 1 ? num(x.count) : size(x.chars) }));
        const dgParts = (ms.digest.parts || []).map((x) => ({ label: x.label.toLowerCase(), v: x.chars, cls: x.from === 'memory' ? 'k-mem' : /allerg/i.test(x.label) ? 'k-safe' : 'k-chart', note: pct(x.chars, ms.digest.chars) + '%' }));
        return [
            { key: 'chart', name: 'The chart', tokens: ms.chart.tokens, parts: chartParts },
            { key: 'cards', name: 'Fact cards', tokens: ms.factCards.tokens || Math.round((ms.factCards.chars || 0) / 3), parts: cardParts },
            { key: 'memory', name: 'The memory', tokens: Math.round(ms.memoryDocument.chars / 3), parts: memParts },   // ~3 characters a token, like the cards
            { key: 'digest', name: 'Always in mind', tokens: ms.digest.tokens, parts: dgParts },
        ];
    }

    /** This encounter's brain calls: count, median tokens in and out, cached share, what they were made of. */
    function callsOf(calls) {
        const list = (calls || []).filter((c) => c && c.ok && c.usage && BRAIN.includes(c.lane));
        if (!list.length) return null;
        const inTok = (c) => (c.usage.input_tokens || 0) + (c.usage.cache_creation_input_tokens || 0) + (c.usage.cache_read_input_tokens || 0);
        const total = list.reduce((a, c) => a + inTok(c), 0);
        const cached = list.reduce((a, c) => a + (c.usage.cache_read_input_tokens || 0), 0);
        // Average make-up in characters, scaled to the median call's tokens.
        const sums = {};
        let chars = 0;
        for (const c of list) for (const [k] of CALL_PARTS) { const v = (c.parts && c.parts[k]) || 0; sums[k] = (sums[k] || 0) + v; chars += v; }
        const med = median(list.map(inTok));
        const parts = CALL_PARTS.filter(([k]) => sums[k] > 0).map(([k, label, cls]) => ({ key: k, label, cls, v: chars ? (sums[k] / chars) * med : 0, cached: !!CACHED[k] }));
        return { n: list.length, median: med, out: median(list.map((c) => c.usage.output_tokens || 0)), cachedPct: pct(cached, total), parts };
    }

    function widthOf(tokens, tMax) {
        const span = Math.log10(Math.max(tMax, 2000) / 1000);
        return Math.max(MINW, Math.min(MAXW, (MAXW * Math.log10(Math.max(tokens, 1100) / 1000)) / span));
    }

    /** A bar split into its parts; each part keeps a tooltip with its size. */
    function bar(x, y, w, parts, extraCls) {
        const total = parts.reduce((a, p) => a + p.v, 0) || 1;
        let at = x;
        const segs = parts.map((p) => {
            const pw = (p.v / total) * w;
            const r = '<rect class="dg-seg ' + p.cls + '" x="' + f1(at) + '" y="' + y + '" width="' + f1(Math.max(pw - (pw > 2 ? 0.8 : 0), 0.4)) + '" height="' + BAR + '"><title>' + esc(p.label + ': ' + p.note) + '</title></rect>';
            at += pw;
            return r;
        }).join('');
        return '<g class="dg-bar' + (extraCls ? ' ' + extraCls : '') + '"><clipPath id="dg-clip-' + Math.round(y) + '"><rect x="' + f1(x) + '" y="' + y + '" width="' + f1(w) + '" height="' + BAR + '" rx="4"/></clipPath>'
            + '<g clip-path="url(#dg-clip-' + Math.round(y) + ')">' + segs + '</g>'
            + '<rect class="dg-frame" x="' + f1(x) + '" y="' + y + '" width="' + f1(w) + '" height="' + BAR + '" rx="4"/></g>';
    }

    /** The flow from one bar down to the next (a trapezoid), with what happens on the way. */
    function flow(i, wTop, wBot, step, dots, dotCls) {
        const y0 = barBottom(i), y1 = barTop(i + 1);
        const path = 'M' + f1(CX - wTop / 2) + ' ' + y0 + ' L' + f1(CX + wTop / 2) + ' ' + y0 + ' L' + f1(CX + wBot / 2) + ' ' + y1 + ' L' + f1(CX - wBot / 2) + ' ' + y1 + ' Z';
        let particles = '';
        if (dots) {
            for (let k = 0; k < 4; k++) {
                const r = (k + 0.5) / 4 - 0.5;
                const sx = CX + r * wTop * 0.78, ex = CX + r * wBot * 0.7;
                const begin = (k * 0.65 + i * 0.35).toFixed(2) + 's';
                particles += '<circle class="dg-dot ' + (dotCls || '') + '" r="1.8" opacity="0"><animateMotion dur="2.6s" begin="' + begin + '" repeatCount="indefinite" path="M' + f1(sx) + ' ' + (y0 + 2) + ' L' + f1(ex) + ' ' + (y1 - 2) + '"/>'
                    + '<animate attributeName="opacity" values="0;0.8;0.8;0" keyTimes="0;0.15;0.8;1" dur="2.6s" begin="' + begin + '" repeatCount="indefinite"/></circle>';
            }
        }
        return '<path class="dg-flow" d="' + path + '"/>' + '<text class="dg-step" x="' + CX + '" y="' + (y0 + 17) + '">' + step + '</text>' + particles;
    }

    function title(i, name, tokensText) {
        return '<text class="dg-title" x="' + CX + '" y="' + (yTop(i) + 14) + '"><tspan class="dg-name">' + esc(name) + '</tspan><tspan class="dg-tok"> · ' + esc(tokensText) + '</tspan></text>';
    }

    /** The last stage, live: what each brain call reads (drawn again as calls come in). */
    function liveStage(st, call, tMax, dots) {
        const dg = st[3];
        const wDg = widthOf(dg.tokens, tMax);
        if (!call) {
            const w = wDg;
            return flow(3, wDg, w, 'Every call adds its rules, what it heard and the task', false)
                + title(4, 'Each brain call', 'waiting for the first one')
                + '<rect class="dg-empty" x="' + f1(CX - w / 2) + '" y="' + barTop(4) + '" width="' + f1(w) + '" height="' + BAR + '" rx="4"/>';
        }
        const w = widthOf(call.median, tMax);
        const grow = call.median - dg.tokens;
        const step = 'Every call adds its rules, what it heard and the task' + (grow > 0 ? '<tspan class="dg-ratio"> +' + esc(ktok(grow)) + '</tspan>' : '');
        // A bracket under the cached part (the fixed beginning of the prompt).
        const total = call.parts.reduce((a, p) => a + p.v, 0) || 1;
        const cachedW = (call.parts.filter((p) => p.cached).reduce((a, p) => a + p.v, 0) / total) * w;
        const x0 = CX - w / 2, yb = barBottom(4) + 5;
        const bracket = cachedW > 6 ? '<path class="dg-bracket" d="M' + f1(x0) + ' ' + yb + ' L' + f1(x0) + ' ' + (yb + 4) + ' L' + f1(x0 + cachedW) + ' ' + (yb + 4) + ' L' + f1(x0 + cachedW) + ' ' + yb + '"/>'
            + '<text class="dg-cached" x="' + f1(x0 + cachedW / 2) + '" y="' + (yb + 16) + '">cached ' + call.cachedPct + '%</text>' : '';
        return flow(3, wDg, w, step, dots, 'is-live')
            + (dots ? sideDots() : '')
            + title(4, 'Each brain call', '~' + ktok(call.median) + ' tokens in')
            + bar(x0, barTop(4), w, call.parts.map((p) => ({ label: p.label, v: p.v, cls: p.cls, note: '~' + ktok(p.v) + ' tokens' + (p.cached ? ', cached' : '') })), 'is-call')
            + bracket;
    }

    // What it heard joins the digest on its way into each call: two green dots from the sides.
    function sideDots() {
        const y0 = barBottom(3) + 14, y1 = barTop(4) - 3;
        return [[28, CX - 30], [W - 28, CX + 30]].map(([sx, ex], k) => {
            const begin = (0.9 + k * 1.3).toFixed(2) + 's';
            return '<circle class="dg-dot is-heard" r="2" opacity="0"><animateMotion dur="2.6s" begin="' + begin + '" repeatCount="indefinite" path="M' + sx + ' ' + y0 + ' Q' + f1((sx + ex) / 2) + ' ' + (y0 + 4) + ' ' + f1(ex) + ' ' + y1 + '"/>'
                + '<animate attributeName="opacity" values="0;0.9;0.9;0" keyTimes="0;0.15;0.8;1" dur="2.6s" begin="' + begin + '" repeatCount="indefinite"/></circle>';
        }).join('');
    }

    function figure(ms, st, call, dots) {
        const tMax = Math.max(st[0].tokens, (ms.longTerm && ms.longTerm.tokens) || 0);
        const w = st.map((x) => widthOf(x.tokens, tMax));
        const steps = [
            'Haiku 5.5 reads each record once<tspan class="dg-ratio"> ÷' + esc(shrink(ratio(st[0].tokens, st[1].tokens))) + '</tspan>',
            'Sonnet 5.5 writes the memory in ' + esc(ms.passes && ms.passes.levels ? ms.passes.levels + ' passes' : 'passes') + '<tspan class="dg-ratio"> ÷' + esc(shrink(ratio(st[1].tokens, st[2].tokens))) + '</tspan>',
            'It keeps the chart\'s lists and the memory\'s summary<tspan class="dg-ratio"> ÷' + esc(shrink(ratio(st[2].tokens, st[3].tokens))) + '</tspan>',
        ];
        let out = '';
        for (let i = 0; i < 3; i++) out += flow(i, w[i], w[i + 1], steps[i], dots);
        // On call: the cards and the memory, as text, for the helper that reads them when the brain asks.
        const lt = ms.longTerm && ms.longTerm.tokens;
        if (lt) {
            const px = W - 94, py = barTop(2) - 24, pw = 92, ph = 46;   // beside the memory, clear of the step text below it
            const xCards = CX + w[1] / 2, xMem = CX + w[2] / 2;
            out += '<g class="dg-oncall"><path class="dg-link" d="M' + f1(xCards - 2) + ' ' + barBottom(1) + ' C' + f1(xCards + 6) + ' ' + (barBottom(1) + 24) + ' ' + f1(px + pw / 2) + ' ' + (py - 18) + ' ' + f1(px + pw / 2) + ' ' + py + '"/>'
                + (xMem < px - 3 ? '<path class="dg-link" d="M' + f1(xMem) + ' ' + (barTop(2) + BAR / 2) + ' L' + px + ' ' + (barTop(2) + BAR / 2) + '"/>' : '')
                + '<rect class="dg-pill" x="' + px + '" y="' + py + '" width="' + pw + '" height="' + ph + '" rx="9"><title>The fact cards and the memory as text, kept on call: a helper reads them when the brain asks something the digest cannot answer.</title></rect>'
                + '<text class="dg-pill-t" x="' + (px + pw / 2) + '" y="' + (py + 15) + '">On call</text>'
                + '<text class="dg-pill-s" x="' + (px + pw / 2) + '" y="' + (py + 28) + '">~' + esc(ktok(lt)) + ' tokens</text>'
                + '<text class="dg-pill-s" x="' + (px + pw / 2) + '" y="' + (py + 39) + '">a helper reads it</text></g>';
        }
        for (let i = 0; i < 4; i++) out += title(i, st[i].name, '~' + ktok(st[i].tokens) + ' tokens') + bar(CX - w[i] / 2, barTop(i), w[i], st[i].parts, 'is-' + st[i].key);
        const desc = 'From the raw chart (about ' + ktok(st[0].tokens) + ' tokens) to fact cards (' + ktok(st[1].tokens) + '), the memory (' + ktok(st[2].tokens) + ') and the digest always in mind (' + ktok(st[3].tokens) + '), about '
            + times(ratio(st[0].tokens, st[3].tokens)) + ' times smaller than the chart. Bar widths use a log scale.';
        return '<svg class="dg-svg" viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-labelledby="dg-fig-t dg-fig-d">'
            + '<title id="dg-fig-t">How the chart is digested</title><desc id="dg-fig-d">' + esc(desc) + '</desc>'
            + out + '<g data-live="call">' + liveStage(st, call, tMax, dots) + '</g></svg>';
    }

    // ── the words beside the picture ───────────────────────────────────────
    const list = (parts, max) => {
        const top = parts.slice().sort((a, b) => b.v - a.v);
        const shown = top.slice(0, max);
        return shown.map((p) => esc(p.label) + ' ' + esc(p.note)).join(', ') + (top.length > max ? ' and ' + (top.length - max) + ' smaller' : '');
    };
    function words(ms, st, call) {
        const r = ms.records || {};
        const bk = r.byKind || {};
        const yrs = r.first && r.last ? ' from ' + String(r.first).slice(0, 4) + ' to ' + String(r.last).slice(0, 4) : '';
        const fc = ms.factCards, md = ms.memoryDocument, dg = ms.digest;
        const chartChars = (dg.parts || []).filter((p) => p.from !== 'memory').reduce((a, p) => a + p.chars, 0);
        const sec = (k) => (md.sections || []).find((x) => x.key === k);
        const cost = ms.passes && ms.passes.cost ? ', once, for about $' + Math.round(ms.passes.cost) : ', once';
        const items = [
            ['1', 'The chart', num(ms.chart.files) + ' files' + yrs + ', ' + size(ms.chart.bytes) + ': ' + list(st[0].parts, 4) + '.'],
            ['2', 'Fact cards', 'Haiku 5.5 read each of the ' + num(r.read) + ' records once (' + num(bk.note) + ' notes, ' + num(bk.lab) + ' lab panels, ' + num(bk.imaging) + ' imaging studies) and wrote a fact card for ' + num(fc.cards) + ' of them: '
                + num(fc.totalItems) + ' items in all, ' + (fc.items || []).map((x) => num(x.n) + ' ' + x.label.toLowerCase()).join(', ') + '.'],
            ['3', 'The memory', 'Sonnet 5.5 read the cards in ' + num(ms.passes && ms.passes.levels) + ' passes and wrote one ' + size(md.chars) + ' document' + cost + ': '
                + [md.problems ? num(md.problems) + ' problems with their course and dated evidence' : '', md.meds ? 'why each of ' + num(md.meds) + ' medicines' : '', md.pending ? num(md.pending) + ' open items' : '',
                    sec('labTrends') ? 'lab trends' : '', sec('safetyProfile') ? 'a safety profile' : '', sec('patientOverview') ? 'an overview' : '', sec('changesSinceLastReview') ? 'recent changes' : ''].filter(Boolean).join(', ') + '.'],
            ['call', 'On call', ms.longTerm ? 'The cards and the memory as text, about ' + ktok(ms.longTerm.tokens) + ' tokens. A helper reads them when the brain asks something the digest cannot answer ("why was warfarin stopped?"). They never sit in its mind.' : ''],
            ['4', 'Always in mind', 'About ' + ktok(dg.tokens) + ' tokens on every call, cached: the chart\'s own lists (' + pct(chartChars, dg.chars) + '%: ' + (dg.parts || []).filter((p) => p.from !== 'memory').map((p) => p.label.toLowerCase()).join(', ')
                + ') and the memory\'s summary (' + (100 - pct(chartChars, dg.chars)) + '%: ' + (dg.parts || []).filter((p) => p.from === 'memory').map((p) => p.label.toLowerCase()).join(', ') + ').'],
        ].filter((x) => x[2]);
        // Markers follow the picture top to bottom; the on-call branch gets the dashed amber of its box.
        return items.map(([n, name, text]) => '<li>' + marker(n) + '<div><b>' + esc(name) + '</b> ' + esc(text) + '</div></li>').join('')
            + '<li data-live="call-text">' + callWords(call) + '</li>';
    }
    function callWords(call) {
        const body = call
            ? num(call.n) + ' so far this encounter: about ' + ktok(call.median) + ' tokens in each (median), ' + call.cachedPct + '% of them cached (its rules, its tools and the digest); the rest is working memory, what it heard and the task. About ' + num(call.out) + ' tokens out.'
            : 'None yet this encounter. Each one reads its rules, the digest, working memory, the latest lines and the task.';
        return marker('5') + '<div><b>Each brain call</b> ' + esc(body) + '</div>';
    }
    const marker = (n) => (n === 'call' ? '<span class="dg-mark is-call" aria-hidden="true"></span>' : '<span class="dg-mark" data-n="' + n + '" aria-hidden="true"></span>');

    const DigestView = {
        render(el, s) {
            const ms = s && s.memStats;
            const st = stagesOf(ms);
            const dots = !reduceMotion();
            if (!st) {
                // The numbers are fetched when the sheet opens; if they have not come after a moment, there are none.
                el.innerHTML = '<div class="dg-wrap"><p class="dg-none">Loading the record’s numbers…</p></div>';
                el._dg = { ms: ms || null, waiting: true };
                setTimeout(() => {
                    const p = el._dg && el._dg.waiting && el.querySelector('.dg-none');
                    if (p) p.textContent = 'Not available for this patient yet: these numbers come from a one-time Deep Learn run of the whole chart.';
                }, 2500);
                return;
            }
            const call = callsOf(s.calls);
            const squeeze = times(ratio(st[0].tokens, st[3].tokens));
            el.innerHTML = '<div class="dg-wrap">'
                + '<p class="dg-squeeze">What the brain keeps in mind is <b>about ' + esc(squeeze) + ' times smaller</b> than the chart. The rest is on call.</p>'
                + '<div class="lc-about-body dg-body"><figure class="lc-about-fig dg-fig">' + figure(ms, st, call, dots) + '</figure>'
                + '<div class="lc-about-text"><h3>What each step keeps</h3><ul class="lc-about-list dg-list">' + words(ms, st, call) + '</ul>'
                + '<p class="lc-about-foot dg-foot">Bar widths use a log scale so every step stays visible. Sizes before the brain calls are estimates from the text (about 3 to 4 characters a token); the per-call numbers are the AI service’s own counts.</p></div></div></div>';
            el._dg = { ms, st, tMax: Math.max(st[0].tokens, (ms.longTerm && ms.longTerm.tokens) || 0), sig: callSig(s.calls), dots };
        },

        update(el, s) {
            const d = el._dg, ms = (s && s.memStats) || null;
            if (!d || ms !== d.ms) { this.render(el, s); return; }   // the record's numbers just arrived
            if (d.waiting) return;
            const sig = callSig(s.calls);
            if (sig === d.sig) return;
            d.sig = sig;
            const call = callsOf(s.calls);
            const g = el.querySelector('[data-live="call"]');
            if (g) g.innerHTML = liveStage(d.st, call, d.tMax, d.dots);
            const li = el.querySelector('[data-live="call-text"]');
            if (li) li.innerHTML = callWords(call);
        },

        /** A brain call or a long-term lookup starting lights up its place in the picture. */
        pulse(what, el) {
            const lane = String(what || '');
            const node = BRAIN.includes(lane) ? el.querySelector('.dg-bar.is-call, .dg-empty') : (lane === 'helper' || lane === 'tool:ask_long_term_memory') ? el.querySelector('.dg-pill') : null;
            if (!node) return;
            node.classList.remove('is-lit');
            void node.getBoundingClientRect();
            node.classList.add('is-lit');
            clearTimeout(node._dgLit);
            node._dgLit = setTimeout(() => node.classList.remove('is-lit'), 1500);
        },
    };
    function callSig(calls) {
        const list = (calls || []).filter((c) => c && c.ok && c.usage && BRAIN.includes(c.lane));
        return list.length;
    }

    if (root.LiveAbout && root.LiveAbout.register) root.LiveAbout.register('digest', DigestView);
    root.LiveAboutDigest = { stagesOf, callsOf, widthOf };
})(typeof window !== 'undefined' ? window : globalThis);
