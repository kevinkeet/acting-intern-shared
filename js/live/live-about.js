/**
 * Live Coworker: "Inside the coworker", the about sheet. DOM only; LiveApp loads it
 * the first time it is opened (full-site door only, like every live file).
 *
 * The memory is drawn as rings around the brain, from seconds to years:
 *   working memory (this visit: what it heard, your thinking, the plan),
 *   the chart digest (this admission, always in mind),
 *   long-term memory (every record Deep Learn read, one dot each, placed by date).
 * The ear feeds in from the top; alerts, answers, the note and the radar come
 * out at the bottom. While it is open, each lane pulses as it works, so the
 * picture shows the coworker thinking live.
 */
(function (root) {
    'use strict';

    const NS = 'http://www.w3.org/2000/svg';
    const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    const W = 400, H = 470, CX = 200, CY = 246;
    const R = { core: 31, wm: 60, dg: 98, lt: 140 };
    const GAP = 0.2;   // radians left open at 12 o'clock, where the ear comes in
    const reduceMotion = () => !!(root.matchMedia && root.matchMedia('(prefers-reduced-motion: reduce)').matches);
    // Angle 0 is 12 o'clock, clockwise.
    const polar = (r, a) => [CX + r * Math.sin(a), CY - r * Math.cos(a)];
    const f1 = (n) => (Math.round(n * 10) / 10).toString();
    const arc = (r, a0, a1, sweep) => {
        const [x0, y0] = polar(r, a0), [x1, y1] = polar(r, a1);
        return 'M' + f1(x0) + ' ' + f1(y0) + ' A' + r + ' ' + r + ' 0 ' + (Math.abs(a1 - a0) > Math.PI ? 1 : 0) + ' ' + (sweep == null ? 1 : sweep) + ' ' + f1(x1) + ' ' + f1(y1);
    };
    const OUT = [
        { id: 'alert', label: 'Alerts', x: 64 },
        { id: 'answer', label: 'Answers', x: 156 },
        { id: 'note', label: 'Note', x: 244 },
        { id: 'radar', label: 'Radar', x: 336 },
    ];
    const outPath = (o) => 'M' + CX + ' ' + (CY + R.core) + ' C' + CX + ' ' + (CY + 120) + ' ' + o.x + ' ' + (H - 104) + ' ' + o.x + ' ' + (H - 44);
    const EAR_PATH = 'M' + CX + ' 66 L' + CX + ' ' + (CY - R.core);
    const READER_A = -2.05;   // the long-term memory reader sits on the outer ring, lower left
    const readerPath = () => { const [x, y] = polar(R.lt, READER_A); return 'M' + CX + ' ' + CY + ' L' + f1(x) + ' ' + f1(y); };
    const NOW = {
        ear: 'The ear is reading new lines', verify: 'Checking a possible safety issue', answer: 'Answering you', update: 'Updating its take',
        prime: 'Reading the chart before the visit', note: 'The scribe is updating the note', actions: 'Updating your radar', helper: 'A helper is looking something up',
    };

    function memoryDots(shape) {
        // One dot per record, by date around the ring (2018 at the top, clockwise); same-day records stack outward.
        const docs = ((shape && shape.docs) || []).filter((d) => d.d).map((d) => ({ t: Date.parse(d.d), k: d.k })).filter((d) => isFinite(d.t)).sort((a, b) => a.t - b.t);
        if (!docs.length) return { dots: '', ticks: '', first: null, last: null };
        const t0 = docs[0].t, t1 = docs[docs.length - 1].t, span = Math.max(1, t1 - t0);
        const ang = (t) => GAP / 2 + ((t - t0) / span) * (2 * Math.PI - GAP);
        const perDay = new Map();
        const dots = docs.map((d) => {
            const day = Math.floor(d.t / 864e5);
            const j = perDay.get(day) || 0;
            perDay.set(day, j + 1);
            const [x, y] = polar(R.lt - 7 + Math.min(j, 6) * 3.1, ang(d.t));
            return '<circle class="lt-dot is-' + d.k + '" cx="' + f1(x) + '" cy="' + f1(y) + '" r="1.75"/>';
        }).join('');
        const y0 = new Date(t0).getUTCFullYear(), y1 = new Date(t1).getUTCFullYear();
        const [sx, sy] = polar(R.lt + 30, GAP / 2 + 0.06);
        let ticks = '<text class="lt-year" x="' + f1(sx) + '" y="' + f1(sy + 3) + '">' + y0 + '</text>';
        for (let yr = y0 + 1; yr <= y1; yr++) {
            const a = ang(Date.UTC(yr, 0, 1));
            const [ax, ay] = polar(R.lt + 15, a), [bx, by] = polar(R.lt + 20, a), [lx, ly] = polar(R.lt + 30, a);
            ticks += '<line class="lt-tick" x1="' + f1(ax) + '" y1="' + f1(ay) + '" x2="' + f1(bx) + '" y2="' + f1(by) + '"/>'
                + ((yr - y0) % 2 === 0 || yr === y1 ? '<text class="lt-year" x="' + f1(lx) + '" y="' + f1(ly + 3) + '">' + yr + '</text>' : '');
        }
        return { dots, ticks, first: y0, last: y1, n: docs.length };
    }

    function digestRing(chart) {
        const segs = [
            ['Allergies', chart && chart.allergies], ['Medicines', chart && chart.meds], ['Problems', chart && chart.problems],
            ['Labs', chart && chart.labs], ['Vitals', null], ['Visits', chart && chart.encounters], ['Its summary', null],
        ];
        const step = (2 * Math.PI - GAP) / segs.length;
        return segs.map((s, i) => {
            const a0 = GAP / 2 + i * step + 0.035, a1 = GAP / 2 + (i + 1) * step - 0.035;
            return '<path class="dg-seg is-' + i + '" d="' + arc(R.dg, a0, a1) + '"><title>' + esc(s[0] + (s[1] != null ? ': ' + s[1] : '')) + '</title></path>';
        }).join('');
    }

    function sweep() {
        const r = R.lt + 13, n = 9, step = 0.085;
        let out = '';
        for (let k = 0; k < n; k++) {
            const a1 = -k * step, a0 = a1 - step;
            const [x0, y0] = polar(r, a0), [x1, y1] = polar(r, a1);
            out += '<path d="M' + CX + ' ' + CY + ' L' + f1(x0) + ' ' + f1(y0) + ' A' + r + ' ' + r + ' 0 0 1 ' + f1(x1) + ' ' + f1(y1) + ' Z" opacity="' + (0.13 * (1 - k / n)).toFixed(3) + '"/>';
        }
        const [ex, ey] = polar(r, 0);
        return out + '<line x1="' + CX + '" y1="' + CY + '" x2="' + f1(ex) + '" y2="' + f1(ey) + '"/>';
    }

    function curvedLabel(id, r, a0, a1, text) {
        return '<path id="' + id + '" d="' + arc(r, a0, a1) + '" fill="none" stroke="none"/><text class="ring-name"><textPath href="#' + id + '" startOffset="50%" text-anchor="middle">' + esc(text) + '</textPath></text>';
    }

    function figure(s) {
        const lt = memoryDots(s.shape);
        const reader = polar(R.lt, READER_A);
        return '<svg class="lc-about-svg" viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-labelledby="lc-about-fig-t lc-about-fig-d">'
            + '<title id="lc-about-fig-t">The coworker\'s memory and how it thinks</title>'
            + '<desc id="lc-about-fig-d">Three rings of memory around the brain: working memory for this visit, the chart digest for this admission, and long-term memory with one dot per record from '
            + esc(lt.first || '') + ' to ' + esc(lt.last || '') + '. The ear feeds what it hears into working memory; alerts, answers, the note and the radar come out below.</desc>'
            // wires first, under everything
            + '<path class="wire" d="' + EAR_PATH + '"/>'
            + OUT.map((o) => '<path class="wire is-out" d="' + outPath(o) + '"/>').join('')
            + '<path class="wire is-reader" d="' + readerPath() + '"/>'
            // long-term memory: the radar sweep, the records, the years
            + '<g class="lt-sweep" aria-hidden="true">' + sweep() + '</g>'
            + '<circle class="ring is-lt" cx="' + CX + '" cy="' + CY + '" r="' + R.lt + '"/>'
            + '<g class="lt-dots">' + lt.dots + '</g><g class="lt-ticks">' + lt.ticks + '</g>'
            + curvedLabel('lc-about-lt-name', R.lt - 21, 0.3, 1.3, 'long-term memory')
            // the chart digest
            + '<g class="dg">' + digestRing(s.chart) + '</g>'
            + curvedLabel('lc-about-dg-name', R.dg + 9, -0.95, -0.2, 'chart digest')
            // working memory: one dot per thing heard this visit (drawn by update())
            + '<circle class="ring is-wm" cx="' + CX + '" cy="' + CY + '" r="' + R.wm + '"/>'
            + '<g class="wm-dots"></g>'
            + curvedLabel('lc-about-wm-name', R.wm + 8, -1.85, -0.1, 'working memory')
            // the brain
            + '<circle class="core-glow" cx="' + CX + '" cy="' + CY + '" r="' + (R.core + 4) + '"/>'
            + '<circle class="core" cx="' + CX + '" cy="' + CY + '" r="' + R.core + '"/>'
            + '<text class="core-name" x="' + CX + '" y="' + (CY - 2) + '">Brain</text>'
            + '<text class="core-model" x="' + CX + '" y="' + (CY + 11) + '" data-a="model">' + esc(s.brain) + '</text>'
            // the ear, at the top
            + '<g class="ear"><rect x="' + (CX - 58) + '" y="22" width="116" height="44" rx="10"/><text class="node-name" x="' + CX + '" y="40">Ear</text><text class="node-sub" x="' + CX + '" y="55">Haiku 5.5 · every few lines</text></g>'
            + '<g class="room" aria-hidden="true"><circle cx="' + (CX - 82) + '" cy="44" r="3"/><circle cx="' + (CX - 94) + '" cy="38" r="3"/><circle cx="' + (CX - 94) + '" cy="51" r="3"/><path d="M' + (CX - 76) + ' 44 L' + (CX - 62) + ' 44"/></g>'
            // the long-term memory reader (a helper) on the outer ring
            + '<g class="reader"><circle cx="' + f1(reader[0]) + '" cy="' + f1(reader[1]) + '" r="6.5"/><text class="node-sub is-left" x="' + f1(reader[0] - 11) + '" y="' + f1(reader[1] + 3) + '">reader</text></g>'
            // outputs, at the bottom
            + OUT.map((o) => '<g class="out is-' + o.id + '" data-out="' + o.id + '"><rect x="' + (o.x - 40) + '" y="' + (H - 44) + '" width="80" height="30" rx="15"/><text class="node-name" x="' + o.x + '" y="' + (H - 25) + '">' + o.label + '</text></g>').join('')
            + '<g class="pulses"></g>'
            + '</svg>';
    }

    // The views: the rings here; the others are their own files (js/live/live-about-<id>.js,
    // css/live-about-<id>.css), loaded the first time their tab opens, and register themselves.
    const TABS = [['memory', 'Memory'], ['digest', 'Digestion'], ['threads', 'Problems'], ['why', 'How it thinks'], ['calls', 'Each call']];
    const TAB_KEY = 'live-about-tab';

    const LiveAbout = {
        el: null,
        views: {},
        _onClose: null,
        _shownWm: 0,
        _state: null,
        _active: 'memory',
        _loader: null,
        _rendered: {},

        isOpen() { return !!this.el && !this.el.hidden; },

        /** A view module registers itself: { render(el, state), update?(el, state), pulse?(what, el) }. */
        register(id, view) { this.views[id] = view; },

        /** Open over the panel (container: the live panel's root). opts.load(id) loads a view's files. */
        open(container, state, opts) {
            this._onClose = (opts && opts.onClose) || null;
            this._returnFocus = (opts && opts.returnFocus) || null;
            this._loader = (opts && opts.load) || null;
            if (!this.el || !container.contains(this.el)) {
                this.el = document.createElement('section');
                this.el.className = 'lc-about';
                this.el.setAttribute('role', 'dialog');
                this.el.setAttribute('aria-label', 'Inside the coworker');
                container.appendChild(this.el);
                this.el.addEventListener('click', (ev) => {
                    if (ev.target.closest('[data-about=close]')) { this.close(); return; }
                    const tab = ev.target.closest('[data-about-tab]');
                    if (tab) this.show(tab.dataset.aboutTab);
                });
                this.el.addEventListener('keydown', (ev) => {
                    if (ev.key === 'Escape') { ev.stopPropagation(); this.close(); return; }
                    const tab = ev.target.closest && ev.target.closest('[data-about-tab]');
                    const step = { ArrowRight: 1, ArrowLeft: -1 }[ev.key];
                    if (!tab || !step) return;
                    ev.preventDefault();
                    ev.stopPropagation();   // the panel's own tabs listen for arrows too
                    const ids = TABS.map((t) => t[0]);
                    const next = ids[(ids.indexOf(tab.dataset.aboutTab) + step + ids.length) % ids.length];
                    this.show(next);
                    const b = this.el.querySelector('[data-about-tab="' + next + '"]');
                    if (b) b.focus();
                });
            }
            this._shownWm = 0;
            this._rendered = {};
            this._state = state;
            this.el.innerHTML = this._html(state);
            this.el.hidden = false;
            this.el.classList.toggle('is-still', reduceMotion());
            this.update(state);
            let last = 'memory';
            try { last = localStorage.getItem(TAB_KEY) || 'memory'; } catch (e) { /* ignore */ }
            this.show(TABS.some((t) => t[0] === last) ? last : 'memory');
            const btn = this.el.querySelector('[data-about=close]');
            if (btn) btn.focus();
        },

        /** Switch view; a view's files load the first time it is shown. */
        async show(id) {
            if (!this.el) return;
            this._active = id;
            try { localStorage.setItem(TAB_KEY, id); } catch (e) { /* ignore */ }
            this.el.querySelectorAll('[data-about-tab]').forEach((b) => { const on = b.dataset.aboutTab === id; b.setAttribute('aria-selected', String(on)); b.tabIndex = on ? 0 : -1; });
            this.el.querySelectorAll('.lc-about-view').forEach((v) => { v.hidden = v.dataset.view !== id; });
            const panel = this.el.querySelector('.lc-about-view[data-view="' + id + '"]');
            if (!panel || id === 'memory') return;
            if (!this.views[id] && this._loader) {
                panel.innerHTML = '<p class="lc-about-loading">Loading…</p>';
                try { await this._loader(id); } catch (e) { /* shown below */ }
            }
            if (this._active !== id) return;   // switched away while loading
            const view = this.views[id];
            if (!view) { panel.innerHTML = '<p class="lc-about-loading">This view could not load.</p>'; return; }
            if (!this._rendered[id]) {
                this._rendered[id] = true;
                try { view.render(panel, this._state || {}); } catch (e) { console.warn('Inside the coworker:', e); panel.innerHTML = '<p class="lc-about-loading">This view could not draw.</p>'; }
            } else if (view.update) {
                try { view.update(panel, this._state || {}); } catch (e) { console.warn('Inside the coworker:', e); }
            }
        },

        close() {
            if (!this.el) return;
            this.el.hidden = true;
            if (this._returnFocus) { try { this._returnFocus.focus(); } catch (e) { /* ignore */ } }
            if (this._onClose) this._onClose();
        },

        _html(s) {
            return '<header class="lc-about-head"><div class="lc-about-title"><div><h2>Inside the coworker</h2><p class="lc-about-sub" data-a="sub"></p></div>'
                + '<button type="button" class="lc-iconbtn" data-about="close" aria-label="Close" title="Close (Esc)"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg></button></div>'
                + '<nav class="lc-about-tabs" role="tablist" aria-label="Views">' + TABS.map(([id, label]) => '<button type="button" role="tab" data-about-tab="' + id + '" aria-selected="false" tabindex="-1">' + label + '</button>').join('') + '</nav></header>'
                + TABS.slice(1).map(([id, label]) => '<div class="lc-about-view" data-view="' + id + '" role="tabpanel" aria-label="' + label + '" hidden></div>').join('')
                + '<div class="lc-about-view" data-view="memory" role="tabpanel" aria-label="Memory"><div class="lc-about-body">'
                + '<figure class="lc-about-fig">' + figure(s) + '<figcaption class="lc-about-now" data-a="now" aria-live="polite">Listening for the next thing to do</figcaption></figure>'
                + '<div class="lc-about-text">'
                + '<h3>Memory, from seconds to years</h3><ul class="lc-about-list" data-a="layers"></ul>'
                + '<h3>Who does what</h3><ul class="lc-about-list" data-a="lanes"></ul>'
                + '<p class="lc-about-foot" data-a="foot"></p>'
                + '</div></div></div>';
        },

        /** Refresh the live parts: the subtitle, working memory's dots, the numbers. */
        update(s) {
            if (!this.isOpen() || !s) return;
            this._state = s;
            // The other views follow along while they are showing.
            const active = this._active !== 'memory' && this.views[this._active];
            if (active && this._rendered[this._active] && active.update) {
                try { active.update(this.el.querySelector('.lc-about-view[data-view="' + this._active + '"]'), s); } catch (e) { console.warn('Inside the coworker:', e); }
            }
            const q = (a) => this.el.querySelector('[data-a="' + a + '"]');
            const wm = s.wm || {};
            const facts = (wm.facts || []).length, thinking = (wm.thinking || []).length, plan = (wm.plan || []).length, watch = (wm.watch || []).length;
            const said = (wm.said || []).length, held = (wm.held || []).length;
            const sub = q('sub');
            if (sub) sub.textContent = [s.brain, s.mode, s.listening ? 'listening' : 'not listening'].filter(Boolean).join(' · ');
            const model = q('model');
            if (model) model.textContent = s.brain || '';
            // Working memory: a dot for each fact (green), thought of yours (navy), plan item (blue) and tripwire (amber).
            const items = [].concat(
                Array(facts).fill('fact'), Array(thinking).fill('thinking'), Array(plan).fill('plan'), Array(watch).fill('watch'));
            const g = this.el.querySelector('.wm-dots');
            if (g && items.length !== this._shownWm) {
                const per = 0.16, lapN = Math.floor((2 * Math.PI - GAP) / per);
                g.innerHTML = items.slice(0, lapN * 3).map((k, i) => {
                    const lap = Math.floor(i / lapN);
                    const a = GAP / 2 + (i % lapN) * per + lap * per / 2;
                    const [x, y] = polar(R.wm - 8 - lap * 7, a);
                    return '<circle class="wm-dot is-' + k + (i >= this._shownWm && this._shownWm > 0 ? ' is-new' : '') + '" cx="' + f1(x) + '" cy="' + f1(y) + '" r="2.6"/>';
                }).join('');
                this._shownWm = items.length;
            }
            const m = s.memory || {}, sh = s.shape || {}, ch = s.chart || {};
            const tok = (chars, per) => { const t = chars / per; return chars ? '~' + (t >= 10000 ? Math.round(t / 1000) + 'K' : (Math.round(t / 100) / 10) + 'K') + ' tokens' : ''; };
            const years = sh.first && sh.last ? sh.first + ' to ' + sh.last : '';
            const layers = q('layers');
            if (layers) {
                layers.innerHTML = [
                    ['wm', 'Working memory', 'This visit, rebuilt for every call: ' + facts + ' fact' + (facts === 1 ? '' : 's') + ' heard, ' + thinking + ' of your thoughts, ' + plan + ' plan item' + (plan === 1 ? '' : 's') + ', ' + watch + ' tripwire' + (watch === 1 ? '' : 's') + ' it is watching for.'],
                    ['dg', 'Chart digest', 'This admission, always in mind (cached): ' + [ch.allergies != null ? ch.allergies + ' allergies' : '', ch.meds != null ? ch.meds + ' medicines' : '', ch.problems != null ? ch.problems + ' problems' : ''].filter(Boolean).join(', ') + ', recent labs, vitals and visits, and its summary of the record' + (m.digestChars ? ' (' + tok(m.digestChars, 4) + ')' : '') + '.'],
                    ['lt', 'Long-term memory', sh.processed ? (sh.processed + ' records' + (years ? ', ' + years : '') + ', read once by Deep Learn in ' + (sh.levels || '?') + ' passes (Haiku read, Sonnet wrote)' + (m.longTermChars ? '; ' + tok(m.longTermChars, 2.25) : '') + '. A helper looks things up in it when the brain asks. Each dot is one record, by date:') : (s.memoryNote || 'Not built for this patient yet: the coworker works from the chart.'),
                        sh.processed ? ' <span class="lc-about-key"><i class="k-note"></i>notes</span> <span class="lc-about-key"><i class="k-lab"></i>labs</span> <span class="lc-about-key"><i class="k-img"></i>imaging</span>' : ''],
                ].map(([k, name, text, extra]) => '<li><span class="lc-about-sw is-' + k + '" aria-hidden="true"></span><div><b>' + esc(name) + '</b> ' + esc(text) + (extra || '') + '</div></li>').join('');
            }
            const st = s.stats || { byLane: {} };
            const med = (lane) => {
                const b = st.byLane && st.byLane[lane];
                if (!b || !b.ms || !b.ms.length) return '';
                const a = b.ms.slice().sort((x, y) => x - y);
                return ' (' + b.calls + ' call' + (b.calls === 1 ? '' : 's') + ', ' + (a[Math.floor(a.length / 2)] / 1000).toFixed(1) + ' s)';
            };
            const lanes = q('lanes');
            if (lanes) {
                lanes.innerHTML = [
                    ['ear', 'Ear', 'Haiku 5.5 reads every few lines: facts, your thinking, the plan, questions, tripwires' + med('ear') + '.'],
                    ['brain', 'Brain', (s.brain || 'Sonnet 5.5') + ' answers you (with exact lookups), checks possible safety issues (say now, wait for you, or stay quiet) and keeps its take' + med('verify') + '.'],
                    ['rules', 'Speaking rules', 'Plain code: a critical alert interrupts, anything else waits until you ask, nothing is said twice; ' + said + ' said, ' + held + ' held.'],
                    ['scribe', 'Scribe and radar', 'Haiku keeps the note and your to-do list current' + med('note') + '.'],
                    ['helper', 'Helpers', 'Haiku reads the long-term memory and checks medicines, only when the brain asks' + med('helper') + '.'],
                ].map(([k, name, text]) => '<li><span class="lc-about-sw is-' + k + '" aria-hidden="true"></span><div><b>' + esc(name) + '</b> ' + esc(text) + '</div></li>').join('');
            }
            const foot = q('foot');
            if (foot) foot.textContent = st.calls ? 'This encounter so far: ' + st.calls + ' AI calls, $' + st.cost.toFixed(2) + '.' : 'No AI calls yet this encounter.';
        },

        /** A lane just started (or something was said): send a pulse along its wire and light up what it touched. */
        pulse(what) {
            if (!this.isOpen()) return;
            if (this._active !== 'memory') {
                const v = this.views[this._active];
                if (v && v.pulse && this._rendered[this._active]) { try { v.pulse(what, this.el.querySelector('.lc-about-view[data-view="' + this._active + '"]')); } catch (e) { /* ignore */ } }
                return;
            }
            const now = this.el.querySelector('[data-a="now"]');
            const lane = String(what || '');
            const say = (t) => { if (now) now.textContent = t; };
            if (NOW[lane]) say(NOW[lane]);
            if (lane === 'ear') this._run(EAR_PATH, 'is-ear');
            else if (/^(verify|answer|update|prime)$/.test(lane)) this._glow('core-glow');
            else if (lane === 'note') this._run(outPath(OUT[2]), 'is-out');
            else if (lane === 'actions') this._run(outPath(OUT[3]), 'is-out');
            else if (lane === 'tool:ask_long_term_memory' || lane === 'helper') { say('Looking it up in the long-term memory'); this._run(readerPath(), 'is-reader'); this._glow('lt-sweep'); }
            else if (lane === 'tool:lookup_labs' || lane === 'tool:search_chart') { say('Looking it up in the chart'); this._glow('dg'); }
            else if (lane === 'say:critical') { say('Safety alert'); this._run(outPath(OUT[0]), 'is-alert'); this._glow('out is-alert'); }
            else if (lane === 'say:answer') { say('Answered'); this._run(outPath(OUT[1]), 'is-out'); this._glow('out is-answer'); }
        },

        _glow(cls) {
            const node = this.el.querySelector('.' + cls.split(' ').join('.'));
            if (!node) return;
            node.classList.remove('is-lit');
            void node.getBoundingClientRect();   // restart the animation
            node.classList.add('is-lit');
            clearTimeout(node._lcLit);
            node._lcLit = setTimeout(() => node.classList.remove('is-lit'), 1600);
        },

        _run(path, cls) {
            if (reduceMotion()) return;
            const g = this.el.querySelector('.pulses');
            if (!g) return;
            const dot = document.createElementNS(NS, 'circle');
            dot.setAttribute('r', '3.6');
            dot.setAttribute('class', 'pulse ' + cls);
            const anim = document.createElementNS(NS, 'animateMotion');
            anim.setAttribute('dur', '0.9s');
            anim.setAttribute('begin', 'indefinite');
            anim.setAttribute('fill', 'freeze');
            anim.setAttribute('path', path);
            anim.setAttribute('calcMode', 'spline');
            anim.setAttribute('keyTimes', '0;1');
            anim.setAttribute('keySplines', '0.25 1 0.5 1');
            dot.appendChild(anim);
            g.appendChild(dot);
            try { anim.beginElement(); } catch (e) { /* no SMIL: no pulse */ }
            setTimeout(() => dot.remove(), 1100);
        },
    };

    root.LiveAbout = LiveAbout;
})(typeof window !== 'undefined' ? window : globalThis);
