/**
 * Live Coworker, "How it thinks": Each call. What the coworker actually reads on
 * every AI call, live. One bar per call, split into the parts of its prompt:
 * the fixed parts it can read from the cache (its lookups, its instructions, the
 * chart digest or the long-term record), then what changes each time (working
 * memory, the latest lines, lookup results, the task), then what it wrote back.
 * Loaded the first time the tab opens (js/live/live-about.js hosts it).
 */
(function (root) {
    'use strict';
    if (!root.LiveAbout) return;

    const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    const LANES = {
        ear: { name: 'Ear', group: 'ear' }, verify: { name: 'Safety check', group: 'brain' }, answer: { name: 'Answer', group: 'brain' },
        update: { name: 'Take update', group: 'brain' }, prime: { name: 'Chart read', group: 'brain' },
        note: { name: 'Scribe', group: 'scribe' }, actions: { name: 'Radar', group: 'scribe' }, helper: { name: 'Helper', group: 'helper' },
    };
    const LANE_ORDER = ['ear', 'verify', 'answer', 'update', 'prime', 'note', 'actions', 'helper'];
    // [key, name, what it is, fixed (cacheable) part?]
    const PARTS = [
        ['tools', 'Lookups it can use', 'the tools it may call (labs, chart search, the record, the pharmacist)', true],
        ['rules', 'Instructions', 'its standing rules for this job', true],
        ['digest', 'Chart digest', 'the chart summary it always has in mind', true],
        ['longterm', 'Long-term record', 'the whole Deep Learn record (only helper calls read it)', true],
        ['memory', 'Working memory', 'what it has heard and decided this visit', false],
        ['conversation', 'Latest lines', 'what was just said in the room', false],
        ['lookups', 'Lookup results', 'what its lookups brought back while answering', false],
        ['task', 'Task', 'what this call is for', false],
    ];
    const RECENT = 30;

    const n0 = (n) => Math.round(n).toLocaleString('en-US');
    const kTok = (n) => (n >= 1e6 ? (n / 1e6).toFixed(1) + 'M' : n >= 1e4 ? Math.round(n / 1e3) + 'K' : n >= 1e3 ? (n / 1e3).toFixed(1) + 'K' : String(Math.round(n)));
    const clock = (ms) => { const x = Math.max(0, Math.round((ms || 0) / 1000)); return Math.floor(x / 60) + ':' + String(x % 60).padStart(2, '0'); };
    const secs = (ms) => (ms == null ? '' : (ms / 1000).toFixed(1) + ' s');
    const money = (c) => (c == null ? '' : c >= 0.1 ? '$' + c.toFixed(2) : c > 0 ? '$' + c.toFixed(3) : '$0');
    const pct = (a, b) => (b ? Math.round((a / b) * 100) : 0);
    const median = (a) => { if (!a.length) return null; const s = a.slice().sort((x, y) => x - y); return s[Math.floor(s.length / 2)]; };
    const lane = (c) => LANES[c.lane] || { name: c.lane, group: 'brain' };

    /** A call's prompt in tokens: its real input, split by the parts' share of the characters. */
    function anatomy(c) {
        const u = c.usage || {};
        const cached = u.cache_read_input_tokens || 0, written = u.cache_creation_input_tokens || 0;
        const input = (u.input_tokens || 0) + written + cached;
        const p = c.parts || {};
        const chars = PARTS.reduce((a, [k]) => a + (p[k] || 0), 0);
        const seg = PARTS.map(([k]) => ({ k, tokens: chars ? (input * (p[k] || 0)) / chars : 0 })).filter((x) => x.tokens > 0);
        if (!seg.length && input) seg.push({ k: 'task', tokens: input });
        return { input, cached: Math.min(cached, input), written, output: u.output_tokens || 0, seg };
    }

    // One shared scale for the bars; a call far beyond the rest (the ~320K-token record) is drawn broken, to its own proportions.
    const nice = (n) => { const p = Math.pow(10, Math.floor(Math.log10(Math.max(n, 1)))); for (const s of [1, 2, 2.5, 5, 10]) if (s * p >= n) return s * p; return 10 * p; };
    function scaleFor(calls) {
        const tot = calls.filter((c) => c.ok && c.usage).map((c) => { const a = anatomy(c); return a.input + a.output; }).sort((x, y) => x - y);
        if (!tot.length) return 10000;
        const limit = Math.max(60000, median(tot) * 6);
        const inside = tot.filter((t) => t <= limit);
        return nice(Math.max(1000, inside.length ? inside[inside.length - 1] : tot[0]));
    }

    /** The bar: input parts stacked from the left, the cached share hatched over them, then a gap, then the output. */
    function barHtml(c, cap) {
        if (!c.ok || !c.usage) return '<div class="lcc-track is-failed"><span class="lcc-fail">' + esc('Failed: ' + String(c.error || 'no reply').replace(/^AI call failed\s*/i, '').slice(0, 70)) + '</span></div>';
        const a = anatomy(c);
        const broken = a.input + a.output > cap;
        const scale = broken ? (a.input + a.output) * 1.04 : cap;
        let x = 0;
        const w = (t) => (t / scale) * 100;
        const segs = a.seg.map((s) => {
            const part = PARTS.find((p) => p[0] === s.k);
            const html = '<i class="lcc-seg is-' + s.k + '" style="left:' + x.toFixed(3) + '%;width:' + w(s.tokens).toFixed(3) + '%" title="' + esc(part[1] + ': ~' + n0(s.tokens) + ' tokens') + '"></i>';
            x += w(s.tokens);
            return html;
        }).join('');
        const cached = a.cached ? '<i class="lcc-cached" style="width:' + w(a.cached).toFixed(3) + '%" title="' + esc(n0(a.cached) + ' tokens read from the cache') + '"></i>' : '';
        const out = a.output ? '<i class="lcc-out" style="left:calc(' + x.toFixed(3) + '% + 3px);width:max(2px, ' + w(a.output).toFixed(3) + '%)" title="' + esc('Wrote back ' + n0(a.output) + ' tokens') + '"></i>' : '';
        const brk = broken ? '<b class="lcc-break" aria-hidden="true"></b>' : '';
        return '<div class="lcc-track' + (broken ? ' is-broken' : '') + '">' + segs + cached + out + brk + '</div>';
    }

    function rowHtml(c, i, cap, isNew) {
        const L = lane(c);
        const a = anatomy(c);
        const label = L.name + ' at ' + clock(c.at) + (c.ok && c.usage
            ? ': ' + n0(a.input) + ' tokens in, ' + pct(a.cached, a.input) + '% from the cache, ' + n0(a.output) + ' out, ' + secs(c.ms && c.ms.total) + ', ' + money(c.cost)
            : ': failed');
        const meta = c.ok && c.usage
            ? '<span class="lcc-num">' + kTok(a.input) + '</span><span class="lcc-dim">in</span><span class="lcc-num">' + pct(a.cached, a.input) + '%</span><span class="lcc-dim">cached</span><span class="lcc-num">' + secs(c.ms && c.ms.total) + '</span><span class="lcc-num">' + money(c.cost) + '</span>'
            : '<span class="lcc-dim">failed</span>';
        return '<li class="lcc-row' + (isNew ? ' is-new' : '') + '" data-i="' + i + '">'
            + '<button type="button" class="lcc-row-btn" aria-expanded="false" aria-label="' + esc(label) + '">'
            + '<span class="lcc-who"><i class="lcc-dot is-' + L.group + '"></i><span class="lcc-name">' + esc(L.name) + '</span><span class="lcc-at">' + clock(c.at) + '</span></span>'
            + '<span class="lcc-bar">' + barHtml(c, cap) + '</span>'
            + '<span class="lcc-meta">' + meta + '</span>'
            + '</button><div class="lcc-detail" hidden></div></li>';
    }

    function detailHtml(c) {
        if (!c.ok || !c.usage) return '<p class="lcc-note">' + esc(String(c.error || 'The call failed.')) + '</p>';
        const a = anatomy(c);
        const rows = a.seg.map((s) => {
            const part = PARTS.find((p) => p[0] === s.k);
            return '<tr><th scope="row"><i class="lcc-sw is-' + s.k + '"></i>' + esc(part[1]) + '</th><td>' + n0(s.tokens) + '</td><td>' + pct(s.tokens, a.input) + '%</td><td>' + (part[3] ? 'fixed' : 'this call') + '</td></tr>';
        }).join('');
        const facts = [
            ['Read from the cache', n0(a.cached) + ' tokens (' + pct(a.cached, a.input) + '%)'],
            a.written ? ['Written to the cache', n0(a.written) + ' tokens (the first call pays to store the fixed parts)'] : null,
            ['Wrote back', n0(a.output) + ' tokens'],
            ['First words after', secs(c.ms && c.ms.ttft)],
            ['Whole call', secs(c.ms && c.ms.total)],
            ['Model', String(c.model || '').replace(/^claude-/, '') + (c.fellBack ? ' (fallback: ' + c.servedBy + ')' : '')],
            ['Cost', c.cost != null ? '$' + c.cost.toFixed(4) : ''],
        ].filter(Boolean);
        return '<table class="lcc-parts"><thead><tr><th scope="col">Part of the prompt</th><th scope="col">Tokens</th><th scope="col">Share</th><th scope="col"></th></tr></thead><tbody>' + rows
            + '<tr class="is-total"><th scope="row">All input</th><td>' + n0(a.input) + '</td><td>100%</td><td></td></tr></tbody></table>'
            + '<dl class="lcc-facts">' + facts.map(([k, v]) => '<div><dt>' + esc(k) + '</dt><dd>' + esc(v) + '</dd></div>').join('') + '</dl>'
            + '<p class="lcc-note">Parts are split by their share of the prompt\'s characters, so they are close, not exact.</p>';
    }

    function summaryHtml(calls, stats) {
        const done = calls.filter((c) => c.ok && c.usage);
        if (!calls.length) return '';
        const sum = (f) => done.reduce((acc, c) => acc + f(c), 0);
        const input = sum((c) => anatomy(c).input), cached = sum((c) => anatomy(c).cached), output = sum((c) => anatomy(c).output);
        const by = (stats && stats.byLane) || {};
        const lanes = LANE_ORDER.filter((k) => by[k] || calls.some((c) => c.lane === k)).concat(Object.keys(by).filter((k) => !LANE_ORDER.includes(k)));
        const rows = lanes.map((k) => {
            const L = LANES[k] || { name: k, group: 'brain' };
            const mine = done.filter((c) => c.lane === k);
            const b = by[k] || { calls: 0, errors: 0, cost: 0, ms: [] };
            const inMed = median(mine.map((c) => anatomy(c).input));
            const cIn = mine.reduce((acc, c) => acc + anatomy(c).input, 0), cC = mine.reduce((acc, c) => acc + anatomy(c).cached, 0);
            return '<tr data-lane="' + esc(k) + '"><th scope="row"><i class="lcc-dot is-' + L.group + '"></i>' + esc(L.name) + '</th><td>' + b.calls + (b.errors ? ' <span class="lcc-err">(' + b.errors + ' failed)</span>' : '') + '</td>'
                + '<td>' + (inMed != null ? kTok(inMed) : '–') + '</td><td>' + (cIn ? pct(cC, cIn) + '%' : '–') + '</td><td>' + (b.ms && b.ms.length ? secs(median(b.ms)) : '–') + '</td><td>' + money(b.cost) + '</td></tr>';
        }).join('');
        const cost = stats && stats.cost != null ? stats.cost : sum((c) => c.cost || 0);
        return '<p class="lcc-total"><b>' + calls.length + ' calls</b> so far: <b>' + kTok(input) + '</b> tokens read, <b>' + pct(cached, input) + '%</b> of them from the cache; <b>' + kTok(output) + '</b> written back; <b>' + money(cost) + '</b>.</p>'
            + '<table class="lcc-lanes"><thead><tr><th scope="col">Who</th><th scope="col">Calls</th><th scope="col">Typical input</th><th scope="col">Cached</th><th scope="col">Typical time</th><th scope="col">Cost</th></tr></thead><tbody>' + rows + '</tbody></table>';
    }

    function legendHtml() {
        const fixed = PARTS.filter((p) => p[3]), fresh = PARTS.filter((p) => !p[3]);
        const chip = (p) => '<span class="lcc-chip" title="' + esc(p[2]) + '"><i class="lcc-sw is-' + p[0] + '"></i>' + esc(p[1]) + '</span>';
        const out = ['out', 'Written back', 'its reply, after the small gap'];
        const item = (p) => '<li><i class="lcc-sw is-' + p[0] + '"></i><span><b>' + esc(p[1]) + '</b> ' + esc(p[2]) + '</span></li>';
        return '<div class="lcc-legend">'
            + '<p class="lcc-chips"><span class="lcc-group">Same every call</span>' + fixed.map(chip).join('') + '</p>'
            + '<p class="lcc-chips"><span class="lcc-group">New each call</span>' + fresh.map(chip).join('') + chip(out) + '</p>'
            + '<p class="lcc-key"><i class="lcc-sw is-cachekey"></i><span>Hatched: read from the cache, at a tenth of the price and much faster. The fixed parts go first so they can be cached.</span></p>'
            + '<p class="lcc-key"><i class="lcc-sw is-breakkey"></i><span>One scale for all bars. A call far bigger than the rest (a helper reading the ~320K-token record) is drawn broken, to its own proportions.</span></p>'
            + '<details class="lcc-what"><summary>What each part is</summary><ul>' + fixed.concat(fresh, [out]).map(item).join('') + '</ul></details>'
            + '</div>';
    }

    function axisHtml(cap) {
        const ticks = [0, 0.2, 0.4, 0.6, 0.8, 1].map((f) => '<span style="left:' + (f * 100) + '%">' + (f === 0 ? '0' : kTok(cap * f)) + '</span>').join('');
        return '<div class="lcc-axis" aria-hidden="true"><span class="lcc-axis-who">Tokens per call</span><span class="lcc-axis-track">' + ticks + '</span></div>';
    }

    function render(el, s) {
        const calls = (s && s.calls) || [];
        const cap = scaleFor(calls);
        el.innerHTML = '<div class="lcc">'
            + '<p class="lcc-lead">Every time the coworker thinks, it sends one prompt and gets one reply. Here is what each prompt carried, newest first. Tap a call to see its parts.</p>'
            + '<div class="lcc-summary" data-c="summary">' + summaryHtml(calls, s && s.stats) + '</div>'
            + legendHtml()
            + '<div class="lcc-calls">' + axisHtml(cap)
            + '<ul class="lcc-list" data-c="list"></ul>'
            + '<p class="lcc-empty" data-c="empty"' + (calls.length ? ' hidden' : '') + '>No AI calls yet. Start the encounter or play the demo: each call appears here as it happens.</p>'
            + '<button type="button" class="lcc-more" data-c="more" hidden></button>'
            + '</div></div>';
        const st = el._lcc = { calls, shown: 0, cap, showAll: false, open: new Set() };
        if (!el._lccBound) {   // one listener per panel, whatever encounter it is showing
            el._lccBound = true;
            el.addEventListener('click', (ev) => {
                const cur = el._lcc;
                if (!cur) return;
                const more = ev.target.closest('[data-c="more"]');
                if (more) { cur.showAll = !cur.showAll; applyFold(el, cur); return; }
                const btn = ev.target.closest('.lcc-row-btn');
                if (!btn) return;
                const li = btn.closest('.lcc-row');
                const i = Number(li.dataset.i);
                const det = li.querySelector('.lcc-detail');
                const opening = det.hidden;
                if (opening) { det.innerHTML = detailHtml(cur.calls[i]); cur.open.add(i); } else cur.open.delete(i);
                det.hidden = !opening;
                btn.setAttribute('aria-expanded', String(opening));
            });
        }
        addRows(el, st, false);
    }

    /** New calls go on top; the rest keep their place (and the reader's scroll). */
    function addRows(el, st, animate) {
        const list = el.querySelector('[data-c="list"]');
        const quiet = !animate || (root.matchMedia && root.matchMedia('(prefers-reduced-motion: reduce)').matches);
        for (let i = st.shown; i < st.calls.length; i++) {
            const at = st.calls[i].at || 0;
            // Newest first by when the call started: go above the first row that started earlier.
            const after = [...list.children].find((r) => (st.calls[Number(r.dataset.i)].at || 0) < at || ((st.calls[Number(r.dataset.i)].at || 0) === at && Number(r.dataset.i) < i));
            if (after) after.insertAdjacentHTML('beforebegin', rowHtml(st.calls[i], i, st.cap, !quiet));
            else list.insertAdjacentHTML('beforeend', rowHtml(st.calls[i], i, st.cap, !quiet));
        }
        st.shown = st.calls.length;
        applyFold(el, st);
    }

    function applyFold(el, st) {
        const rows = el.querySelectorAll('.lcc-row');
        rows.forEach((r, k) => { r.hidden = !st.showAll && k >= RECENT && !st.open.has(Number(r.dataset.i)); });
        const more = el.querySelector('[data-c="more"]');
        const older = Math.max(0, rows.length - RECENT);
        more.hidden = older === 0;
        more.textContent = st.showAll ? 'Show only the latest ' + RECENT : 'Show ' + older + ' older call' + (older === 1 ? '' : 's');
        const empty = el.querySelector('[data-c="empty"]');
        if (empty) empty.hidden = rows.length > 0;
    }

    function update(el, s) {
        const st = el._lcc;
        const calls = (s && s.calls) || [];
        if (!st || calls !== st.calls || calls.length < st.shown) { render(el, s); return; }   // a new encounter: start over
        if (calls.length === st.shown) return;
        const cap = scaleFor(calls);
        if (cap !== st.cap) {
            // The scale grew: redraw the existing bars in place (rows, scroll and open details stay).
            st.cap = cap;
            el.querySelectorAll('.lcc-row').forEach((r) => { const b = r.querySelector('.lcc-bar'); if (b) b.innerHTML = barHtml(calls[Number(r.dataset.i)], cap); });
            const ax = el.querySelector('.lcc-axis');
            if (ax) ax.outerHTML = axisHtml(cap);
        }
        addRows(el, st, true);
        const sum = el.querySelector('[data-c="summary"]');
        if (sum) sum.innerHTML = summaryHtml(calls, s.stats);
    }

    root.LiveAbout.register('calls', { render, update, _anatomy: anatomy, _scaleFor: scaleFor });
})(typeof window !== 'undefined' ? window : globalThis);
