/**
 * Live Coworker: "Inside the coworker", the about sheet. DOM only; LiveApp loads it
 * the first time it is opened (full-site door only, like every live file).
 *
 * The Memory view draws how information flows, top to bottom:
 *   in the room (the latest words heard) -> the ear (Haiku, every few lines) ->
 *   working memory (this visit: what the ear filed, your thinking, the plan; the note
 *   and the radar are written from here) -> the brain, which always has the chart
 *   digest in mind and reaches into long-term memory (every record, by year) only
 *   when it looks something up -> what it says (alerts, answers). A saved H&P goes
 *   into the chart, so it joins long-term memory.
 * Nothing moves for show: a pulse runs along a path only when that part works, and
 * one line under the figure says what just happened.
 */
(function (root) {
    'use strict';

    const NS = 'http://www.w3.org/2000/svg';
    const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    const clip = (s, n) => { s = String(s == null ? '' : s).replace(/\s+/g, ' ').trim(); return s.length > n ? s.slice(0, n - 1).replace(/[\s,;:.]+\S*$/, '') + '…' : s; };
    const reduceMotion = () => !!(root.matchMedia && root.matchMedia('(prefers-reduced-motion: reduce)').matches);
    const f1 = (n) => (Math.round(n * 10) / 10).toString();

    // ── the figure's layout (viewBox 400 x 398); the flow runs down the line x = FX ──
    const W = 400, H = 398, FX = 155;
    const ROOM = { x: 10, y: 6, w: 380, h: 74 };
    const EAR = { x: FX - 54, y: 94, w: 108, h: 34 };
    const WM = { x: 10, y: 142, w: 284, h: 98 };
    const SIDE_X = 316, SIDE_W = 72, PILL_H = 26, RADAR_Y = 150, NOTE_Y = 198;
    const BRAIN = { x: FX, y: 300, r: 27 };
    const DG = { x: 10, y: 266, w: 88, h: 68 };
    const LT = { x: 214, y: 258, w: 176, h: 82 };
    const OUT_Y = 364;
    const SAYS = [{ id: 'alert', label: 'Alerts', x: 95 }, { id: 'answer', label: 'Answers', x: 215 }];
    // Working memory, in the Tracking pane's groups.
    const BINS = [
        { id: 'story', label: 'Story', dot: 'fact', kinds: ['symptom', 'history', 'social', 'other'] },
        { id: 'meds', label: 'Meds', dot: 'fact', kinds: ['medication', 'allergy'] },
        { id: 'exam', label: 'Exam, labs', dot: 'fact', kinds: ['exam', 'data'] },
        { id: 'thinking', label: 'Thinking', dot: 'thinking' },
        { id: 'plan', label: 'Plan', dot: 'plan' },
    ];
    const BIN_W = (WM.w - 16) / BINS.length;
    const binX = (i) => WM.x + 8 + i * BIN_W;
    const PER_ROW = 8, ROWS = 8, STEP = 6.2, DOT_Y0 = 182;
    const binOf = (kind) => Math.max(0, BINS.findIndex((b) => b.kinds && b.kinds.includes(kind)));

    const PATH = {
        roomEar: 'M' + FX + ' ' + (ROOM.y + ROOM.h - 6) + ' L' + FX + ' ' + (EAR.y + 1),   // stops at the ear's edge, clear of its name
        earBin: (i) => { const cx = f1(binX(i) + 24); return 'M' + FX + ' ' + (EAR.y + EAR.h) + ' C' + FX + ' ' + (WM.y + 8) + ' ' + cx + ' ' + (WM.y + 2) + ' ' + cx + ' ' + (DOT_Y0 + 4); },
        wmBrain: 'M' + FX + ' ' + (WM.y + WM.h - 10) + ' L' + FX + ' ' + (BRAIN.y - BRAIN.r),
        digestBrain: 'M' + (DG.x + DG.w - 6) + ' ' + BRAIN.y + ' L' + (FX - BRAIN.r) + ' ' + BRAIN.y,
        brainDigest: 'M' + (FX - BRAIN.r) + ' ' + BRAIN.y + ' L' + (DG.x + DG.w - 6) + ' ' + BRAIN.y,
        brainLt: 'M' + (FX + BRAIN.r) + ' ' + BRAIN.y + ' L' + (LT.x + 12) + ' ' + BRAIN.y,
        ltBrain: 'M' + (LT.x + 12) + ' ' + BRAIN.y + ' L' + (FX + BRAIN.r) + ' ' + BRAIN.y,
        wmRadar: 'M' + (WM.x + WM.w - 28) + ' ' + (RADAR_Y + PILL_H / 2) + ' L' + (SIDE_X + 6) + ' ' + (RADAR_Y + PILL_H / 2),
        wmNote: 'M' + (WM.x + WM.w - 28) + ' ' + (NOTE_Y + PILL_H / 2) + ' L' + (SIDE_X + 6) + ' ' + (NOTE_Y + PILL_H / 2),
        noteLt: 'M' + (SIDE_X + SIDE_W / 2) + ' ' + (NOTE_Y + PILL_H) + ' L' + (SIDE_X + SIDE_W / 2) + ' ' + (LT.y + 6),
        say: (o) => 'M' + FX + ' ' + (BRAIN.y + BRAIN.r) + ' C' + FX + ' ' + (BRAIN.y + BRAIN.r + 20) + ' ' + o.x + ' ' + (OUT_Y - 20) + ' ' + o.x + ' ' + OUT_Y,
    };
    const NOW = {
        ear: 'The ear is reading the latest lines', verify: 'The brain is checking a possible safety issue', answer: 'The brain is answering you', update: 'The brain is updating its take',
        prime: 'Reading the chart digest before the visit', note: 'The scribe is writing the note from working memory', actions: 'Updating your radar from working memory', helper: 'A helper is looking it up in long-term memory',
    };

    const wire = (d, cls) => '<path class="wire' + (cls ? ' ' + cls : '') + '" d="' + d + '"/>';
    const box = (r, cls, rx) => '<rect class="box' + (cls ? ' ' + cls : '') + '" x="' + r.x + '" y="' + r.y + '" width="' + r.w + '" height="' + r.h + '" rx="' + (rx || 8) + '"/>';

    /** Long-term memory as a store: every record Deep Learn read, one bar per year (notes, labs, imaging stacked). */
    function ltStore(shape) {
        const docs = ((shape && shape.docs) || []).map((d) => ({ y: new Date(Date.parse(d.d)).getUTCFullYear(), k: d.k })).filter((d) => isFinite(d.y));
        if (!docs.length) return { bars: '', years: '', n: 0, first: null, last: null };
        const first = Math.min(...docs.map((d) => d.y)), last = Math.max(...docs.map((d) => d.y));
        const per = new Map();
        for (const d of docs) { const c = per.get(d.y) || { note: 0, lab: 0, imaging: 0 }; c[d.k] = (c[d.k] || 0) + 1; per.set(d.y, c); }
        const count = (c) => (c.note || 0) + (c.lab || 0) + (c.imaging || 0);
        const n = last - first + 1, x0 = LT.x + 12, w = LT.w - 24, step = w / n, bw = Math.max(4, Math.min(12, step - 4));
        const max = Math.max(1, ...[...per.values()].map(count));
        const base = LT.y + 64, hMax = 30;
        let bars = '', years = '';
        for (let yr = first; yr <= last; yr++) {
            const c = per.get(yr) || { note: 0, lab: 0, imaging: 0 };
            const x = x0 + (yr - first) * step + (step - bw) / 2;
            let top = base;
            for (const k of ['note', 'lab', 'imaging']) {
                if (!c[k]) continue;
                const h = Math.max(1.2, (c[k] / max) * hMax);
                top -= h;
                bars += '<rect class="lt-bar is-' + k + '" x="' + f1(x) + '" y="' + f1(top) + '" width="' + f1(bw) + '" height="' + f1(h) + '"/>';
            }
            const t = count(c);
            bars += '<rect class="lt-hit" x="' + f1(x - 1) + '" y="' + (base - hMax) + '" width="' + f1(bw + 2) + '" height="' + hMax + '"><title>' + yr + ': ' + t + ' record' + (t === 1 ? '' : 's')
                + (t ? ' (' + ['note', 'lab', 'imaging'].filter((k) => c[k]).map((k) => c[k] + ' ' + (k === 'imaging' ? 'imaging' : k + (c[k] === 1 ? '' : 's'))).join(', ') + ')' : '') + '</title></rect>';
            if (yr === first || yr === last || (n > 4 && yr === first + Math.round((n - 1) / 2))) years += '<text class="lt-year" x="' + f1(x + bw / 2) + '" y="' + (base + 9) + '">' + yr + '</text>';
        }
        return { bars, years, n: docs.length, first, last };
    }

    /** The chart digest: what the brain always has in mind, as a strip of its parts. */
    function digestBar(chart) {
        const segs = [['Allergies', chart && chart.allergies], ['Medicines', chart && chart.meds], ['Problems', chart && chart.problems], ['Labs', chart && chart.labs], ['Vitals', null], ['Visits', chart && chart.encounters], ['Its summary of the record', null]];
        const x0 = DG.x + 9, w = DG.w - 18, gap = 1.6, sw = (w - gap * (segs.length - 1)) / segs.length;
        return segs.map((s, i) => '<rect class="dg-seg is-' + i + '" x="' + f1(x0 + i * (sw + gap)) + '" y="' + (DG.y + 36) + '" width="' + f1(sw) + '" height="9" rx="1.5"><title>' + esc(s[0] + (s[1] != null ? ': ' + s[1] : '')) + '</title></rect>').join('');
    }

    function figure(s) {
        const lt = ltStore(s.shape);
        const ltSub = lt.n ? ((s.shape && s.shape.processed) || lt.n) + ' records, ' + lt.first + ' to ' + lt.last : 'not built for this patient';
        const midR = RADAR_Y + PILL_H / 2, midN = NOTE_Y + PILL_H / 2;
        return '<svg class="lc-about-svg" viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-labelledby="lc-about-fig-t lc-about-fig-d">'
            + '<title id="lc-about-fig-t">How information flows through the coworker</title>'
            + '<desc id="lc-about-fig-d">Words heard in the room go to the ear, which files them in working memory for this visit. The note and the radar are written from working memory. '
            + 'The brain works from working memory with the chart digest always in mind, and looks things up in long-term memory (' + esc(ltSub) + ') only when it needs to. It says what matters as alerts and answers. A saved H&amp;P goes into the chart.</desc>'
            // the wires, under everything
            + wire('M' + FX + ' ' + (ROOM.y + ROOM.h) + ' L' + FX + ' ' + EAR.y)
            + wire('M' + FX + ' ' + (EAR.y + EAR.h) + ' L' + FX + ' ' + WM.y)
            + wire('M' + FX + ' ' + (WM.y + WM.h) + ' L' + FX + ' ' + (BRAIN.y - BRAIN.r))
            + wire('M' + (DG.x + DG.w) + ' ' + BRAIN.y + ' L' + (FX - BRAIN.r) + ' ' + BRAIN.y)
            + wire('M' + (FX + BRAIN.r) + ' ' + BRAIN.y + ' L' + LT.x + ' ' + BRAIN.y, 'is-dashed')
            + wire('M' + (WM.x + WM.w) + ' ' + midR + ' L' + SIDE_X + ' ' + midR)
            + wire('M' + (WM.x + WM.w) + ' ' + midN + ' L' + SIDE_X + ' ' + midN)
            + wire('M' + (SIDE_X + SIDE_W / 2) + ' ' + (NOTE_Y + PILL_H) + ' L' + (SIDE_X + SIDE_W / 2) + ' ' + LT.y, 'is-dashed')
            + SAYS.map((o) => wire(PATH.say(o), 'is-out')).join('')
            + '<text class="wire-label" x="' + f1((FX + BRAIN.r + LT.x) / 2) + '" y="' + (BRAIN.y - 5) + '">looks up</text>'
            + '<text class="wire-label t-start" x="' + (SIDE_X + SIDE_W / 2 + 5) + '" y="' + (LT.y - 13) + '">H&amp;P saved</text>'
            // in the room: the latest words heard (drawn by update())
            + '<g class="room">' + box(ROOM, 'is-room', 9) + '<text class="box-name t-start" x="' + (ROOM.x + 12) + '" y="' + (ROOM.y + 15) + '">In the room</text><g class="room-lines"></g></g>'
            // the ear
            + '<g class="ear">' + box(EAR, 'is-ear', 9) + '<text class="node-name" x="' + FX + '" y="' + (EAR.y + 15) + '">Ear</text><text class="node-sub" x="' + FX + '" y="' + (EAR.y + 27) + '">Haiku 5.5 · every few lines</text></g>'
            // working memory: what the ear filed this visit, by kind (drawn by update())
            + '<g class="wm">' + box(WM, 'is-wm', 9) + '<text class="box-name t-start" x="' + (WM.x + 12) + '" y="' + (WM.y + 15) + '">Working memory <tspan class="box-sub">this visit</tspan></text><g class="wm-bins"></g></g>'
            // the chart digest, always in mind
            + '<g class="dg">' + box(DG, 'is-dg', 8) + '<text class="node-name t-start" x="' + (DG.x + 9) + '" y="' + (DG.y + 16) + '">Chart digest</text><text class="node-sub t-start" x="' + (DG.x + 9) + '" y="' + (DG.y + 28) + '">always in mind</text>'
            + digestBar(s.chart) + '<text class="node-sub t-start" x="' + (DG.x + 9) + '" y="' + (DG.y + 60) + '" data-a="dgsize"></text></g>'
            // the brain
            + '<circle class="core-glow" cx="' + FX + '" cy="' + BRAIN.y + '" r="' + (BRAIN.r + 4) + '"/>'
            + '<circle class="core" cx="' + FX + '" cy="' + BRAIN.y + '" r="' + BRAIN.r + '"/>'
            + '<text class="core-name" x="' + FX + '" y="' + (BRAIN.y - 1) + '">Brain</text>'
            + '<text class="core-model" x="' + FX + '" y="' + (BRAIN.y + 11) + '" data-a="model">' + esc(s.brain) + '</text>'
            // long-term memory: a store it reaches into
            + '<g class="lt">' + box(LT, 'is-lt', 8) + '<text class="node-name t-start" x="' + (LT.x + 12) + '" y="' + (LT.y + 16) + '">Long-term memory</text>'
            + '<text class="node-sub t-start" x="' + (LT.x + 12) + '" y="' + (LT.y + 28) + '">' + esc(ltSub) + '</text><g class="lt-bars">' + lt.bars + '</g>' + lt.years + '</g>'
            // what comes out: alerts and answers from the brain; the note and the radar, written from working memory
            + SAYS.map((o) => '<g class="out is-' + o.id + '" data-out="' + o.id + '"><rect class="pill" x="' + (o.x - 41) + '" y="' + OUT_Y + '" width="82" height="' + PILL_H + '" rx="13"/><text class="node-name" x="' + o.x + '" y="' + (OUT_Y + 17) + '">' + o.label + '</text></g>').join('')
            + [['note', 'Note', NOTE_Y], ['radar', 'Radar', RADAR_Y]].map(([id, label, y]) => '<g class="out is-' + id + '" data-out="' + id + '"><rect class="pill" x="' + SIDE_X + '" y="' + y + '" width="' + SIDE_W + '" height="' + PILL_H + '" rx="13"/><text class="node-name" x="' + (SIDE_X + SIDE_W / 2) + '" y="' + (y + 17) + '">' + label + '</text></g>').join('')
            + '<g class="pulses"></g>'
            + '</svg>';
    }

    // The views: the flow here; the others are their own files (js/live/live-about-<id>.js,
    // css/live-about-<id>.css), loaded the first time their tab opens, and register themselves.
    const TABS = [['memory', 'Memory'], ['digest', 'Digestion'], ['threads', 'Problems'], ['why', 'How it thinks'], ['calls', 'Each call']];
    const TAB_KEY = 'live-about-tab';

    const LiveAbout = {
        el: null,
        views: {},
        _onClose: null,
        _state: null,
        _active: 'memory',
        _loader: null,
        _rendered: {},

        isOpen() { return !!this.el && !this.el.hidden; },

        /** A view module registers itself: { render(el, state), update?(el, state), pulse?(what, el) }. */
        register(id, view) { this.views[id] = view; },

        /**
         * Open over the panel (container: the live panel's root), or, in full screen, docked over the live note
         * (opts.docked) so the rest stays in view while it works. opts.load(id) loads a view's files.
         */
        open(container, state, opts) {
            this._onClose = (opts && opts.onClose) || null;
            this._returnFocus = (opts && opts.returnFocus) || null;
            this._loader = (opts && opts.load) || null;
            if (this.el && !container.contains(this.el)) { this.el.remove(); this.el = null; }   // moving to another place
            if (!this.el) {
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
            // What the figure has already shown: on opening, the story so far is drawn, not replayed.
            this._roomKey = null;
            this._binsKey = null;
            this._seen = null;
            this._savedNotes = null;
            this._rendered = {};
            this._state = state;
            this.el.innerHTML = this._html(state);
            const docked = !!(opts && opts.docked);
            this.el.classList.toggle('is-docked', docked);
            const closeBtn = this.el.querySelector('[data-about=close]');
            if (closeBtn) { closeBtn.title = docked ? 'Back to the live note (Esc)' : 'Close (Esc)'; closeBtn.setAttribute('aria-label', docked ? 'Back to the live note' : 'Close'); }
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
                + '<figure class="lc-about-fig">' + figure(s) + '<figcaption class="lc-about-now" data-a="now" aria-live="polite">Waiting for the next words</figcaption></figure>'
                + '<div class="lc-about-text">'
                + '<h3>Memory, from seconds to years</h3><ul class="lc-about-list" data-a="layers"></ul>'
                + '<h3>Who does what</h3><ul class="lc-about-list" data-a="lanes"></ul>'
                + '<p class="lc-about-foot" data-a="foot"></p>'
                + '</div></div></div>';
        },

        /** Refresh the live parts: the room, working memory, what just arrived, the words and numbers. */
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
            this._drawRoom(s);
            this._drawBins(wm);
            this._arrivals(s);
            const m = s.memory || {}, sh = s.shape || {}, ch = s.chart || {};
            const tok = (chars, per) => { const t = chars / per; return chars ? '~' + (t >= 10000 ? Math.round(t / 1000) + 'K' : (Math.round(t / 100) / 10) + 'K') + ' tokens' : ''; };
            const dgsize = q('dgsize');
            if (dgsize) dgsize.textContent = m.digestChars ? tok(m.digestChars, 4) : '';
            const years = sh.first && sh.last ? sh.first + ' to ' + sh.last : '';
            const layers = q('layers');
            if (layers) {
                layers.innerHTML = [
                    ['wm', 'Working memory', 'This visit: what the ear filed from the room, rebuilt for every call: ' + facts + ' fact' + (facts === 1 ? '' : 's') + ' heard, ' + thinking + ' of your thoughts, ' + plan + ' plan item' + (plan === 1 ? '' : 's') + ', ' + watch + ' tripwire' + (watch === 1 ? '' : 's') + ' it is watching for. The note and the radar are written from it.'],
                    ['dg', 'Chart digest', 'This admission, always in mind (cached): ' + [ch.allergies != null ? ch.allergies + ' allergies' : '', ch.meds != null ? ch.meds + ' medicines' : '', ch.problems != null ? ch.problems + ' problems' : ''].filter(Boolean).join(', ') + ', recent labs, vitals and visits, and its summary of the record' + (m.digestChars ? ' (' + tok(m.digestChars, 4) + ')' : '') + '.'],
                    ['lt', 'Long-term memory', sh.processed ? (sh.processed + ' records' + (years ? ', ' + years : '') + ', read once by Deep Learn in ' + (sh.levels || '?') + ' passes (Haiku read, Sonnet wrote)' + (m.longTermChars ? '; ' + tok(m.longTermChars, 2.25) : '') + '. The brain reaches into it only to look something up. Each bar is a year of records:') : (s.memoryNote || 'Not built for this patient yet: the coworker works from the chart.'),
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
                    ['ear', 'Ear', 'Haiku 5.5 reads every few lines and files what matters in working memory: facts, your thinking, the plan, questions, tripwires' + med('ear') + '.'],
                    ['brain', 'Brain', (s.brain || 'Sonnet 5.5') + ' answers you (with exact lookups), checks possible safety issues (say now, wait for you, or stay quiet) and keeps its take' + med('verify') + '.'],
                    ['rules', 'Speaking rules', 'Plain code: a critical alert interrupts, anything else waits until you ask, nothing is said twice; ' + said + ' said, ' + held + ' held.'],
                    ['scribe', 'Scribe and radar', 'Haiku writes the note and your to-do list from working memory' + med('note') + '.'],
                    ['helper', 'Helpers', 'Haiku reads the long-term memory and checks medicines, only when the brain asks' + med('helper') + '.'],
                ].map(([k, name, text]) => '<li><span class="lc-about-sw is-' + k + '" aria-hidden="true"></span><div><b>' + esc(name) + '</b> ' + esc(text) + '</div></li>').join('');
            }
            const foot = q('foot');
            if (foot) foot.textContent = st.calls ? 'This encounter so far: ' + st.calls + ' AI calls, $' + st.cost.toFixed(2) + '.' : 'No AI calls yet this encounter.';
        },

        /** In the room: the last three things heard, newest at the bottom; a new one fades in. */
        _drawRoom(s) {
            const g = this.el.querySelector('.room-lines');
            if (!g) return;
            const last = (s.lines || []).filter((l) => l && l.text).slice(-3);
            const key = last.map((l) => l.id).join('|');
            if (key === this._roomKey) return;
            const before = new Set(String(this._roomKey || '').split('|'));
            const first = this._roomKey == null;
            this._roomKey = key;
            if (!last.length) {
                g.innerHTML = '<text class="room-empty" x="' + (ROOM.x + ROOM.w / 2) + '" y="' + (ROOM.y + 47) + '">Nothing heard yet: start the encounter, or play the demo.</text>';
                return;
            }
            const NAMES = { doctor: 'Doctor', patient: 'Patient', other: 'Other', ehr: 'Order' };
            g.innerHTML = last.map((l, i) => {
                const y = ROOM.y + 33 + (3 - last.length + i) * 16;
                const who = clip(l.label || NAMES[l.speaker] || l.speaker || '', 12);
                return '<g class="room-line is-age-' + (last.length - 1 - i) + (!first && !before.has(String(l.id)) ? ' is-new' : '') + '">'
                    + '<text class="room-who t-end" x="' + (ROOM.x + 64) + '" y="' + y + '">' + esc(who) + '</text>'
                    + '<text class="room-said t-start" x="' + (ROOM.x + 70) + '" y="' + y + '">' + esc(clip(l.text, 60)) + '</text></g>';
            }).join('');
        },

        /** Working memory: one dot per thing filed this visit, in the Tracking pane's groups; a new one pops in. */
        _drawBins(wm) {
            const g = this.el.querySelector('.wm-bins');
            if (!g) return;
            const counts = BINS.map((b) => (b.kinds ? (wm.facts || []).filter((f) => b.kinds.includes(f.kind)).length : ((b.id === 'thinking' ? wm.thinking : wm.plan) || []).length));
            const key = counts.join(',');
            if (key === this._binsKey) return;
            const prev = this._binsKey ? this._binsKey.split(',').map(Number) : null;
            this._binsKey = key;
            g.innerHTML = BINS.map((b, i) => {
                const n = counts[i], x0 = binX(i), shown = Math.min(n, PER_ROW * ROWS);
                let dots = '';
                for (let j = 0; j < shown; j++) {
                    const cx = x0 + 3 + (j % PER_ROW) * STEP, cy = DOT_Y0 + Math.floor(j / PER_ROW) * STEP;
                    dots += '<circle class="wm-dot is-' + b.dot + (prev && j >= prev[i] ? ' is-new' : '') + '" cx="' + f1(cx) + '" cy="' + f1(cy) + '" r="2.3"/>';
                }
                return '<g class="wm-bin is-' + b.id + '"><text class="bin-name t-start" x="' + f1(x0) + '" y="' + (WM.y + 29) + '">' + esc(b.label) + ' <tspan class="bin-n">' + n + '</tspan></text>' + dots
                    + (n > shown ? '<text class="bin-more t-start" x="' + f1(x0) + '" y="' + (DOT_Y0 + ROWS * STEP + 4) + '">+' + (n - shown) + ' more</text>' : '') + '</g>';
            }).join('');
        },

        /** What just arrived in working memory goes from the ear into its group, and the line under the figure says so. */
        _arrivals(s) {
            const wm = s.wm || {};
            const counts = { facts: (wm.facts || []).length, thinking: (wm.thinking || []).length, plan: (wm.plan || []).length };
            const saved = (s.actions || []).filter((a) => a.kind === 'note' && a.statusBy === 'saved').length;
            if (!this._seen) { this._seen = counts; this._savedNotes = saved; return; }   // just opened: nothing to replay
            const fresh = []
                .concat((wm.facts || []).slice(this._seen.facts).map((f) => ({ bin: binOf(f.kind), text: f.text })))
                .concat((wm.thinking || []).slice(this._seen.thinking).map((x) => ({ bin: 3, text: x.text })))
                .concat((wm.plan || []).slice(this._seen.plan).map((x) => ({ bin: 4, text: x.text })));
            this._seen = counts;
            fresh.slice(-3).forEach((x, k) => setTimeout(() => this._file(x), k * 320));
            if (saved > (this._savedNotes || 0)) this._savedNote();
            this._savedNotes = saved;
        },
        _file(x) {
            if (!this.isOpen() || this._active !== 'memory') return;
            this._say('The ear filed “' + clip(x.text, 70) + '” under ' + BINS[x.bin].label);
            this._run(PATH.earBin(x.bin), 'is-ear');
            this._glow('wm-bin is-' + BINS[x.bin].id);
        },
        _savedNote() {
            if (!this.isOpen() || this._active !== 'memory') return;
            this._say('The H&P went into the chart: it is part of long-term memory now');
            this._run(PATH.noteLt, 'is-out');
            this._glow('lt');
        },
        _say(t) {
            const now = this.el && this.el.querySelector('[data-a="now"]');
            if (now) now.textContent = t;
        },

        /** A lane just started (or something was said or looked up): a pulse along its path, and what it touched lights up. */
        pulse(what) {
            if (!this.isOpen()) return;
            if (this._active !== 'memory') {
                const v = this.views[this._active];
                if (v && v.pulse && this._rendered[this._active]) { try { v.pulse(what, this.el.querySelector('.lc-about-view[data-view="' + this._active + '"]')); } catch (e) { /* ignore */ } }
                return;
            }
            const lane = String(what || '');
            if (NOW[lane]) this._say(NOW[lane]);
            if (lane === 'ear') { this._run(PATH.roomEar, 'is-ear'); this._glow('ear'); }
            else if (/^(verify|answer|update)$/.test(lane)) { this._run(PATH.wmBrain, 'is-read'); this._glow('core-glow'); this._glow('dg'); }
            else if (lane === 'prime') { this._run(PATH.digestBrain, 'is-read'); this._glow('dg'); this._glow('core-glow'); }
            else if (lane === 'note') { this._run(PATH.wmNote, 'is-out'); this._glow('out is-note'); }
            else if (lane === 'actions') { this._run(PATH.wmRadar, 'is-out'); this._glow('out is-radar'); }
            else if (lane === 'helper' || /^tool:(ask_long_term_memory|lookup_labs|search_chart)$/.test(lane)) {
                this._say({ 'tool:lookup_labs': 'The brain is looking up labs in long-term memory', 'tool:search_chart': 'The brain is searching the record in long-term memory' }[lane] || 'A helper is looking it up in long-term memory');
                this._run(PATH.brainLt, 'is-reader');
                setTimeout(() => this._run(PATH.ltBrain, 'is-reader'), 700);   // and what it found comes back
                this._glow('lt');
            }
            else if (lane === 'tool:check_medication') { this._say('Checking the medicine against the chart digest'); this._run(PATH.brainDigest, 'is-reader'); this._glow('dg'); }
            else if (lane === 'say:critical') { this._say('A safety alert went out'); this._run(PATH.say(SAYS[0]), 'is-alert'); this._glow('out is-alert'); }
            else if (lane === 'say:answer') { this._say('Answered'); this._run(PATH.say(SAYS[1]), 'is-out'); this._glow('out is-answer'); }
            else if (lane === 'saved:note') this._savedNote();
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
            dot.setAttribute('r', '3.4');
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
