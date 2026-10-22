/**
 * Live Coworker, "How it thinks" → Problems: how the long-term memory files
 * years of records under the patient's problems. One lane per problem (in the
 * memory's own order), one dot per record that mentions it, by date, coloured
 * by kind (note, lab, imaging); hospital stays are faint bands where many lanes
 * light up together. Choosing a lane shows the memory's own words for it: its
 * status, its course, its plan and the dated evidence.
 *
 * Data: s.memStats.threads / admissions / records (tools/live/memory-stats.mjs)
 * and s.memDoc.problemAnalysis (same order). Loaded by the host on first use.
 */
(function (root) {
    'use strict';

    const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    const f1 = (n) => (Math.round(n * 10) / 10).toString();
    const W = 400, ROW = 28, X0 = 6, X1 = W - 6;
    const KIND = { note: 'note', lab: 'lab', imaging: 'imaging' };
    const KIND_WORD = { note: 'notes', lab: 'labs', imaging: 'imaging' };
    const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const STATUS = { active: 'is-active', chronic: 'is-chronic', stable: 'is-stable', resolved: 'is-resolved' };
    const STAY_WORDS = [[/pneumonia/i, 'Pneumonia'], [/heart failure|hfref|\badhf\b|\bchf\b/i, 'Heart failure'], [/gastrointestinal|gi bleed|hemorrhage/i, 'GI bleed']];

    /** "HFrEF / ischemic cardiomyopathy, EF 30-35%" -> "HFrEF": the memory's own name, cut at its first qualifier. */
    function shortName(p) {
        let s = String(p || '').split(/,|\(|;| \/ /)[0].trim();
        if (s.length > 44) s = s.slice(0, 43).trim() + '…';
        return s || String(p || '');
    }
    const stayName = (label) => { const hit = STAY_WORDS.find(([re]) => re.test(label || '')); return hit ? hit[1] : String(label || '').split(/\s+/).slice(0, 2).join(' '); };
    const dayMs = (d) => Date.parse(String(d).slice(0, 10) + 'T12:00:00Z');
    const monthYear = (d) => { const x = new Date(dayMs(d)); return (x.getUTCMonth() + 1) + '/' + x.getUTCFullYear(); };
    const longDay = (d) => { const x = new Date(dayMs(d)); return x.getUTCDate() + ' ' + MONTHS[x.getUTCMonth()] + ' ' + x.getUTCFullYear(); };

    /** Dots along a lane: by date, nudged up or down where they would land on each other. */
    function swarm(mentions, sx) {
        const placed = [];
        const SLOTS = [0, -3, 3, -6, 6];
        return mentions.map((m) => {
            const x = sx(dayMs(m.d));
            let dy = 0;
            for (const s of SLOTS) {
                if (!placed.some((p) => p.dy === s && Math.abs(p.x - x) < 3.3)) { dy = s; break; }
            }
            placed.push({ x, dy });
            if (placed.length > 40) placed.shift();   // only the recent neighbours can collide (they are in date order)
            return { m, x, dy };
        });
    }

    function lanes(st, sel) {
        const threads = st.threads || [];
        const first = (st.records && st.records.first) || '2018-01-01', last = (st.records && st.records.last) || new Date().toISOString().slice(0, 10);
        const y0 = new Date(dayMs(first)).getUTCFullYear(), y1 = new Date(dayMs(last)).getUTCFullYear();
        const t0 = Date.UTC(y0, 0, 1), t1 = Math.max(Date.UTC(y1, 2, 1), dayMs(last) + 30 * 864e5);
        const sx = (t) => X0 + ((t - t0) / (t1 - t0)) * (X1 - X0);
        // Stay names go on as few rows as they fit without overlapping (about 5.2 units a character).
        const rowEnds = [];
        const named = (st.admissions || []).map((a) => {
            const xa = sx(dayMs(a.start)), xb = sx(dayMs(a.end || a.start));
            const cx = (xa + xb) / 2, text = stayName(a.label) + ' ' + monthYear(a.start), half = text.length * 2.6 + 4;
            let row = 0;
            while (rowEnds[row] != null && rowEnds[row] > cx - half) row++;
            rowEnds[row] = cx + half;
            return { a, xa, xb, cx, text, row };
        });
        const TOP = 12 + 10.5 * Math.max(2, rowEnds.length);
        const H = TOP + threads.length * ROW + 26;
        const bottom = TOP + threads.length * ROW;
        let grid = '';
        for (let y = y0; y <= y1; y++) {
            const x = sx(Date.UTC(y, 0, 1));
            const last = x > X1 - 22;   // the last year's label stays inside the frame
            grid += '<line class="th-grid" x1="' + f1(x) + '" y1="' + (TOP - 4) + '" x2="' + f1(x) + '" y2="' + bottom + '"/>'
                + '<text class="th-year' + (last ? ' is-end' : '') + '" x="' + f1(last ? X1 : x + 2) + '" y="' + (bottom + 14) + '">' + y + '</text>';
        }
        // Hospital stays: at least 7 units wide so a five-day stay is visible across eight years.
        const stays = named.map(({ a, xa, xb, cx, text, row }) => {
            const w = Math.max(7, xb - xa);
            return '<g class="th-stay"><title>' + esc('Hospital stay ' + longDay(a.start) + (a.end ? ' to ' + longDay(a.end) : '') + ': ' + a.label) + '</title>'
                + '<rect x="' + f1(cx - w / 2) + '" y="' + (TOP - 4) + '" width="' + f1(w) + '" height="' + (bottom - TOP + 4) + '" rx="2"/>'
                + '<text class="th-stay-name" x="' + f1(Math.min(X1 - text.length * 2.6, Math.max(X0 + text.length * 2.6, cx))) + '" y="' + f1(10 + row * 10.5) + '">' + esc(text) + '</text></g>';
        }).join('');
        const rows = threads.map((t, i) => {
            const top = TOP + i * ROW;
            const n = t.mentions.length;
            const dots = swarm(t.mentions, sx).map(({ m, x, dy }) => '<circle class="th-dot is-' + (KIND[m.k] || 'note') + '" cx="' + f1(x) + '" cy="' + f1(top + 19 + dy) + '" r="1.7"><title>' + esc(longDay(m.d) + ' · ' + (m.t || KIND_WORD[m.k] || 'record')) + '</title></circle>').join('');
            return '<g class="th-row' + (i === sel ? ' is-sel' : '') + (n < 5 ? ' is-sparse' : '') + '" data-i="' + i + '" role="button" tabindex="' + (i === sel ? 0 : -1) + '" aria-pressed="' + (i === sel) + '" aria-label="' + esc(shortName(t.problem) + ', ' + n + ' record' + (n === 1 ? '' : 's')) + '">'
                + '<rect class="th-hit" x="1" y="' + (top + 1) + '" width="' + (W - 2) + '" height="' + (ROW - 2) + '" rx="5"/>'
                + '<text class="th-label" x="' + (X0 + 2) + '" y="' + (top + 10) + '">' + esc(shortName(t.problem)) + '</text>'
                + '<text class="th-count" x="' + (X1 - 2) + '" y="' + (top + 10) + '">' + n + '</text>'
                + '<line class="th-lane" x1="' + X0 + '" y1="' + (top + 19) + '" x2="' + X1 + '" y2="' + (top + 19) + '"/>'
                + '<g class="th-dots">' + dots + '</g></g>';
        }).join('');
        const total = threads.reduce((a, t) => a + t.mentions.length, 0);
        return '<svg class="th-svg" viewBox="0 0 ' + W + ' ' + H + '" role="group" aria-labelledby="th-svg-t th-svg-d">'
            + '<title id="th-svg-t">Problems over time</title>'
            + '<desc id="th-svg-d">' + esc(threads.length + ' problems from the long-term memory, one lane each, from ' + y0 + ' to ' + y1 + '; ' + total + ' dots, one per record that mentions the problem; ' + (st.admissions || []).length + ' hospital stays shown as bands.') + '</desc>'
            + stays + grid + rows + '</svg>';
    }

    /** The memory's own words for one problem. */
    function detail(st, md, i) {
        const t = (st.threads || [])[i];
        if (!t) return '';
        const pa = md && Array.isArray(md.problemAnalysis) ? md.problemAnalysis[i] : null;
        const byKind = { note: 0, lab: 0, imaging: 0 };
        for (const m of t.mentions) byKind[m.k] = (byKind[m.k] || 0) + 1;
        const n = t.mentions.length;
        const kinds = Object.entries(byKind).filter(([, c]) => c).map(([k, c]) => c + ' ' + (c === 1 && k !== 'imaging' ? k : KIND_WORD[k])).join(', ');
        const span = n ? 'first ' + monthYear(t.mentions[0].d) + (n > 1 ? ', latest ' + monthYear(t.mentions[n - 1].d) : '') : '';
        const status = (pa && pa.status) || t.status || '';
        const list = (v) => [].concat(v || []).map(String).filter(Boolean);
        const dated = (x) => esc(x).replace(/^((?:\d{1,2}\/)?(?:\d{1,2}\/)?\d{4}(?:-\d{1,2}\/(?:\d{1,2}\/)?\d{4})?)(:?)/, '<b>$1</b>$2');
        const course = pa && pa.trajectory && String(pa.trajectory).trim();
        const plan = pa && list(pa.plan).join(' ');
        const evidence = pa ? list(pa.keyData) : [];
        return '<div class="th-d-head"><h3>' + esc((pa && pa.problem) || t.problem) + '</h3>' + (status ? '<span class="th-status ' + (STATUS[status] || '') + '">' + esc(status) + '</span>' : '') + '</div>'
            + '<p class="th-d-meta">' + (n ? n + ' record' + (n === 1 ? '' : 's') + ' mention it (' + esc(kinds) + '); ' + esc(span) + '.' : 'No dated record names it; the memory knows it from summaries.') + '</p>'
            + (pa ? '<dl class="th-d-list">'
                + (course ? '<dt>Course</dt><dd>' + esc(course) + '</dd>' : '')
                + (plan ? '<dt>Plan</dt><dd>' + esc(plan) + '</dd>' : '')
                + '</dl>'
                + (evidence.length ? '<h4>Dated evidence <span>' + evidence.length + '</span></h4><ul class="th-evidence">' + evidence.map((x) => '<li>' + dated(x) + '</li>').join('') + '</ul>' : '')
                : '<p class="th-d-meta">The memory document is not loaded for this patient.</p>');
    }

    const view = {
        render(el, s) {
            this._el = el;
            const st = s && s.memStats;
            const md = s && s.memDoc;
            this._md = md || null;
            if (!st || !Array.isArray(st.threads) || !st.threads.length) {
                this._st = null;
                el.innerHTML = '<div class="th"><p class="th-wait" data-th="wait">Reading the record…</p></div>';
                clearTimeout(this._waitT);
                this._waitT = setTimeout(() => {
                    const w = el.querySelector('[data-th="wait"]');
                    if (w && !this._st) w.textContent = 'The problem map is not available for this patient yet: it needs a full chart review (Deep Learn).';
                }, 4000);
                return;
            }
            clearTimeout(this._waitT);
            this._st = st;
            if (this._sel == null || this._sel >= st.threads.length) this._sel = 0;
            const total = st.threads.reduce((a, t) => a + t.mentions.length, 0);
            const years = st.records && st.records.first ? String(st.records.first).slice(0, 4) + ' to ' + String(st.records.last).slice(0, 4) : '';
            el.innerHTML = '<div class="th">'
                + '<p class="th-intro">How the long-term memory files ' + (st.records && st.records.read ? st.records.read + ' records' : 'the record') + (years ? ' from ' + years : '') + ' under ' + st.threads.length + ' problems, in its own order of importance. '
                + 'Each dot is a record that names the problem (' + total + ' in all); bands are hospital stays.</p>'
                + '<p class="th-key"><span><i class="is-note"></i>notes</span><span><i class="is-lab"></i>labs</span><span><i class="is-imaging"></i>imaging</span><span><i class="is-stay"></i>hospital stay</span></p>'
                + '<div class="th-wrap"><div class="th-lanes" data-th="lanes">' + lanes(st, this._sel) + '</div>'
                + '<section class="th-detail" data-th="detail" aria-live="polite" aria-label="What the memory says">' + detail(st, md, this._sel) + '</section></div>'
                + '</div>';
            this._bind(el);
        },

        update(el, s) {
            // Only the record's data matters here, and it does not change during an encounter:
            // draw once it arrives (or when the memory document turns up), never on every event.
            const st = s && s.memStats;
            if (st && st !== this._st) this.render(el, s);
            else if (s && s.memDoc && !this._md && this._st) { this._md = s.memDoc; this._select(this._sel, false); }
        },

        _bind(el) {
            const svg = el.querySelector('.th-svg');
            if (!svg) return;
            svg.addEventListener('click', (ev) => {
                const row = ev.target.closest('.th-row');
                if (row) this._select(Number(row.dataset.i), true);
            });
            svg.addEventListener('keydown', (ev) => {
                const row = ev.target.closest && ev.target.closest('.th-row');
                if (!row) return;
                const i = Number(row.dataset.i), n = (this._st.threads || []).length;
                const step = { ArrowDown: 1, ArrowUp: -1, Home: -i, End: n - 1 - i }[ev.key];
                if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); this._select(i, true); return; }
                if (step == null) return;
                ev.preventDefault();
                this._select((i + step + n) % n, true, true);
            });
        },

        /** Choose a lane: highlight it, show what the memory says about it. */
        _select(i, fromUser, focus) {
            const el = this._el;
            if (!el || !this._st) return;
            this._sel = i;
            el.querySelectorAll('.th-row').forEach((r) => {
                const on = Number(r.dataset.i) === i;
                r.classList.toggle('is-sel', on);
                r.setAttribute('aria-pressed', String(on));
                r.setAttribute('tabindex', on ? '0' : '-1');
            });
            if (fromUser) el.querySelector('.th-svg').classList.add('has-sel');   // once chosen, the other lanes step back
            const d = el.querySelector('[data-th="detail"]');
            if (d) { d.innerHTML = detail(this._st, this._md, i); d.scrollTop = 0; }
            if (focus) { const r = el.querySelector('.th-row[data-i="' + i + '"]'); if (r && r.focus) r.focus({ preventScroll: false }); }
            if (fromUser && !focus && d && d.getBoundingClientRect) {
                // Narrow panel: the words sit under the lanes. A click scrolls just far enough to show
                // their start (keyboard moves never scroll, so the lanes stay put while browsing).
                const box = d.getBoundingClientRect();
                const sheet = el.closest('.lc-about');
                const view = sheet ? sheet.getBoundingClientRect() : null;
                const delta = view ? box.top - (view.bottom - 190) : 0;
                if (delta > 0 && sheet.scrollTo) {
                    const still = sheet.classList.contains('is-still') || (root.matchMedia && root.matchMedia('(prefers-reduced-motion: reduce)').matches);
                    sheet.scrollTo({ top: sheet.scrollTop + delta, behavior: still ? 'auto' : 'smooth' });
                }
            }
        },
    };

    if (root.LiveAbout && root.LiveAbout.register) root.LiveAbout.register('threads', view);
})(typeof window !== 'undefined' ? window : globalThis);
