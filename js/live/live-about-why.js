/**
 * Live Coworker, "Inside the coworker" › How it thinks: working memory as a chain of
 * reasons. Loaded by the host (live-about.js) the first time its tab opens.
 *
 * Left (or top): what it said or did this encounter, newest first, plus what it
 * kept for later and what it checked and kept quiet about. Right (or below):
 * for the one selected, the chain read top to bottom: the words it heard, what
 * the ear wrote down, what set it off (a tripwire it set from the chart before
 * the visit, the ear's alarm, its own take update, or your question), how it
 * checked, what it said, and what that led to. Where a link was not recorded it
 * says so, rather than guess.
 */
(function (root) {
    'use strict';

    const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    const mmss = (ms) => { const s = Math.max(0, Math.round((ms || 0) / 1000)); return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'); };
    const secs = (ms) => (ms == null || !isFinite(ms) ? '' : (ms < 10000 ? (ms / 1000).toFixed(1) : String(Math.round(ms / 1000))) + ' s');
    const clip = (s, n) => { s = String(s || '').replace(/\s+/g, ' ').trim(); return s.length > n ? s.slice(0, n - 1) + '…' : s; };
    const plain = (t) => String(t || '').replace(/\*\*/g, '');
    const firstSentence = (t) => { const s = plain(t).trim(); const m = s.match(/^(.{8,}?[.!?])\s+(?=["“(]?[A-Z0-9])/); return m ? m[1] : s; };
    const restAfterFirst = (t) => { const s = plain(t).trim(); const f = firstSentence(s); return s.slice(f.length).trim(); };
    const lineNum = (id) => Number(String(id || '').replace(/^L/, '')) || 0;

    // What each kind of item is called, and its dot.
    const TYPE = {
        alert: { label: 'Safety alert', dot: 'is-alert' },
        update: { label: 'Safety update', dot: 'is-update' },
        answer: { label: 'Answer', dot: 'is-answer' },
        thought: { label: 'Thought', dot: 'is-thought' },
        held: { label: 'Kept for when you ask', dot: 'is-held' },
        quiet: { label: 'Checked, kept quiet', dot: 'is-quiet' },
    };
    const WHO = { doctor: 'You', patient: 'The patient', ehr: 'The EHR', other: 'Someone else', unknown: 'Someone' };
    const TOOL = {
        lookup_labs: (i) => 'Looked up labs' + (Array.isArray(i.tests) && i.tests.length ? ': ' + i.tests.join(', ') : ''),
        search_chart: (i) => 'Searched the chart' + (i.query ? ' for “' + i.query + '”' : ''),
        ask_long_term_memory: (i) => 'Asked the long-term memory' + (i.question ? ': “' + i.question + '”' : ''),
        check_medication: (i) => 'Asked the pharmacist helper about ' + [i.drug, i.dose].filter(Boolean).join(' '),
    };
    const SUPPRESSED = {
        repeat: 'it had already said this',
        'nothing new for an alert already on screen': 'an alert already on screen covers it',
        'waiting for the doctor': 'it was already waiting to see what you would say about it',
        'wake word with no question': 'it heard its name but no question',
    };

    /** Everything it said or did, as list items (newest first). */
    function itemsOf(s) {
        const said = (s.said || []).map((x) => ({
            key: 'S:' + x.id,
            type: x.kind === 'answer' ? 'answer' : x.kind === 'critical' ? (x.updateOf ? 'update' : 'alert') : 'thought',
            t: x.t || 0, title: x.kind === 'answer' && x.question ? x.question : firstSentence(x.text), src: x,
        }));
        const held = ((s.wm && s.wm.held) || []).map((h) => ({ key: 'H:' + h.topic, type: 'held', t: h.t || 0, title: firstSentence(h.text), src: h }));
        const main = said.concat(held).sort((a, b) => b.t - a.t);
        const quiet = (s.decisions || []).filter((d) => d.decision === 'quiet' || d.decision === 'suppressed')
            .map((d, i) => ({ key: 'Q:' + Math.round(d.at || 0) + ':' + i + ':' + clip(d.reason, 24), type: 'quiet', t: d.at || 0, title: clip(d.text || plainReason(d.reason), 140), src: d }))
            .sort((a, b) => b.t - a.t);
        return { main, quiet };
    }

    /** Take the safety check's reason apart: tripwires it set from the chart, the ear's alarms, its own take, an EHR order. */
    function decodeReason(reason, wm) {
        const out = { tripwires: [], alarms: [], update: null, order: null, takeWanted: null };
        let rest = String(reason || '');
        rest = rest.replace(/watch item "([^"]+)" fired: (.*?) \(prepared alert: (.*?)\)(?:; |$)/g, (m, id, trigger, alert) => {
            const now = ((wm && wm.watch) || []).find((w) => w.id === id);
            out.tripwires.push({ id, trigger, alert, severity: now ? now.severity : '' });
            return '';
        });
        let m;
        if ((m = rest.match(/^its take update \(([^)]*)\)\s*$/))) { out.update = m[1]; rest = ''; }
        else if ((m = rest.match(/^a new order was just placed in the EHR: (.*)$/))) { out.order = m[1]; rest = ''; }
        else if ((m = rest.match(/^your take update wanted to say: (.*)$/))) { out.takeWanted = m[1]; rest = ''; }
        rest.split(/;\s+/).map((x) => x.trim()).filter(Boolean).forEach((x) => out.alarms.push(x));
        return out;
    }
    const plainReason = (r) => {
        const d = decodeReason(r, null);
        if (d.tripwires.length) return 'Tripwire: ' + d.tripwires[0].trigger;
        if (d.order) return 'An order: ' + d.order;
        return d.alarms[0] || r || '';
    };

    // ── the chain for one item ─────────────────────────────────────────
    const step = (cls, label, at, body) => ({ cls, label, at, body });

    function chainOf(item, s) {
        const x = item.src;
        const lines = s.lines || [];
        const wm = s.wm || {};
        const lineById = (id) => lines.find((l) => l.id === id) || ((wm.lines || []).find((l) => l.id === id)) || null;
        const quote = (l) => {
            const lab = String(l.label || '').toLowerCase();
            const who = lab === 'doctor' || lab === 'you' || l.speaker === 'doctor' ? 'You' : (l.label || WHO[String(l.speaker || '').toLowerCase()] || 'Someone');
            return '<b>' + esc(who) + '</b>' + (l.dictation === 'exam' ? ' (dictating the exam)' : '') + ': <q>' + esc(clip(l.text, 260)) + '</q>';
        };
        const steps = [];

        if (item.type === 'held') {
            steps.push(step('is-set', 'Set off by', null, '<span class="why-muted">Not recorded: a thought it keeps for later does not keep the check or update that produced it.</span>'));
            steps.push(step('is-check', 'Weighed', null, 'Rated <b>important</b>, not critical, so it waits until you ask instead of interrupting.'));
            steps.push(step('is-held', 'Kept', x.t, esc(plain(x.text)) + (x.why ? '<span class="why-why">' + esc(x.why) + '</span>' : '')));
            steps.push(step('is-led', 'What next', null, 'Ask it, press <b>Tell me</b> in Conversation, or switch to Lead and it will offer one thought every two minutes.'));
            return steps;
        }

        if (item.type === 'quiet') {
            const d = decodeReason(x.reason, wm);
            if (x.decision === 'suppressed') {
                steps.push(step('is-said', 'It wanted to say', x.at, esc(clip(x.text, 300)) || '<span class="why-muted">(the words were not recorded)</span>'));
                steps.push(step('is-check', 'Held back', x.at, 'It kept quiet because ' + esc(SUPPRESSED[x.reason] || x.reason || 'a speaking rule stopped it') + '.'));
                return steps;
            }
            steps.push(step('is-set', 'Set off by', x.at, setOffHtml(d, null)));
            steps.push(step('is-check', 'Checked', x.at, 'It looked again and decided this was <b>not worth interrupting</b> for.' + (x.why ? '<span class="why-why">' + esc(x.why) + '</span>' : '')));
            return steps;
        }

        if (item.type === 'answer') {
            const cue = x.cueLine ? lineById(x.cueLine) : null;
            const how = x.via === 'wake word' ? 'You asked it out loud' : x.via === 'ear' ? 'The ear heard a question meant for it' : x.via === 'typed' ? 'You typed' : 'You asked';
            steps.push(step('is-heard', 'Asked', cue ? cue.t : x.t, how + ': <q>' + esc(clip(x.question || (cue && cue.text) || '', 260)) + '</q>'));
            const tools = x.tools || [];
            steps.push(step('is-filed', 'Looked up', null, tools.length
                ? '<ul class="why-tools">' + tools.map((u) => '<li><b>' + esc((TOOL[u.name] || ((i) => u.name))(u.input || {})) + '</b>' + (u.result ? '<span class="why-snip">' + esc(clip(u.result, 180)) + '</span>' : '') + (u.error ? ' <span class="why-muted">(the lookup failed)</span>' : '') + '</li>').join('') + '</ul>'
                : 'No lookups: it answered from what it already had in mind (the chart digest and working memory).'));
            steps.push(step('is-said is-answer', 'Answered', x.t, '<span class="why-said">' + esc(plain(x.text)) + '</span>' + (x.latencyMs != null ? '<span class="why-meta">' + secs(x.latencyMs) + ' after you asked</span>' : '')));
            return steps;
        }

        // An alert, an update or a thought it spoke.
        const cue = x.cueLine ? lineById(x.cueLine) : null;
        if (cue) {
            steps.push(step('is-heard', 'Heard', cue.t, quote(cue)));
            const filed = (wm.facts || []).filter((f) => f.line === cue.id).map((f) => ({ k: f.kind, text: f.text }))
                .concat((wm.plan || []).filter((p) => p.line === cue.id).map((p) => ({ k: p.kind === 'cancel' ? 'cancel' : 'plan', text: p.text })));
            steps.push(step('is-filed', 'Wrote down', null, filed.length
                ? '<ul class="why-facts">' + filed.slice(0, 6).map((f) => '<li><span class="why-tag">' + esc(f.k) + '</span>' + esc(clip(f.text, 160)) + '</li>').join('') + (filed.length > 6 ? '<li class="why-muted">and ' + (filed.length - 6) + ' more</li>' : '') + '</ul>'
                : '<span class="why-muted">Nothing new went into working memory from these words; the check ran on the words themselves.</span>'));
        } else if (x.via === 'update' || /take update/.test(x.reason || '')) {
            steps.push(step('is-heard', 'Heard', null, '<span class="why-muted">Not one line: its take update reviews everything heard so far.</span>'));
        }
        const d = decodeReason(x.reason, wm);
        steps.push(step('is-set', 'Set off by', null, setOffHtml(d, x)));
        steps.push(step('is-check', 'Checked', null, checkHtml(x, s)));
        const said = esc(firstSentence(x.text)), rest = restAfterFirst(x.text);
        steps.push(step('is-said' + (item.type === 'thought' ? ' is-thought' : ''), item.type === 'update' ? 'Updated the alert' : item.type === 'thought' ? 'Offered' : 'Said', x.t,
            '<span class="why-said"><b>' + said + '</b>' + (rest ? ' ' + esc(rest) : '') + '</span>'
            + (x.why ? '<span class="why-why">Why: ' + esc(x.why) + '</span>' : '')
            + (x.latencyMs != null ? '<span class="why-meta">' + secs(x.latencyMs) + ' after the words were said</span>' : '')));
        const led = ledToHtml(x, s);
        if (led) steps.push(step('is-led', 'Led to', null, led));
        return steps;
    }

    function setOffHtml(d, x) {
        const parts = [];
        for (const t of d.tripwires) {
            parts.push('A <b>tripwire</b> it set when it read the chart, before the visit: <q>' + esc(t.trigger) + '</q>.'
                + (t.alert ? '<span class="why-snip">It had an alert ready: ' + esc(t.alert) + '</span>' : ''));
        }
        for (const a of d.alarms) parts.push('The <b>ear</b> flagged it as possibly critical: <q>' + esc(clip(a, 220)) + '</q>.');
        if (d.order) parts.push('An <b>order placed in the EHR</b>: ' + esc(d.order) + '. Every order gets the same safety check as a spoken one.');
        if (d.update) parts.push('Its own <b>take update</b> (' + esc(d.update === 'heartbeat' ? 'the regular review every minute or so' : d.update === 'quick look' ? 'a quick look after something new' : d.update) + '), which re-reads everything heard so far.');
        if (d.takeWanted) parts.push('Its <b>take update</b> wanted to raise it, but the words had come from someone other than you, so it gave you a turn first.');
        if (!parts.length) parts.push('<span class="why-muted">Not recorded for this one.</span>');
        return parts.join('');
    }

    function checkHtml(x, s) {
        const ds = (s.decisions || []).filter((d) => d.reason && x.reason && d.reason === x.reason && (d.decision === 'say' || d.decision === 'wait'));
        const waited = x.via === 'after waiting' || x.waited > 0 || ds.some((d) => d.decision === 'wait');
        const sev = x.severity === 'critical' || (x.kind === 'critical' && !x.severity) ? 'critical' : x.severity === 'important' || x.kind === 'insight' ? 'important' : '';
        let html;
        if (x.via === 'update') html = 'Its take update decided this needed saying' + (sev ? ', rated <b>' + sev + '</b>' : '') + '.';
        else if (waited) html = 'It looked once and <b>waited</b> to see whether you would address it; after your next words it looked again and decided to speak' + (sev ? ' (rated <b>' + sev + '</b>)' : '') + '.';
        else html = 'It looked right away and decided to <b>speak now</b>' + (sev ? ', rated <b>' + sev + '</b>' : '') + (sev === 'critical' ? ': critical alerts interrupt in every mode' : '') + '.';
        // The check's own length is encounter time; on the demo's faster clock it would read long, so it shows only when it fits inside the wall-clock wait.
        if (x.checkWallMs != null) html += '<span class="why-meta">The check took ' + secs(x.checkWallMs) + '</span>';
        else if (x.checkMs != null && x.latencyMs != null && x.checkMs <= x.latencyMs) html += '<span class="why-meta">The check took ' + secs(x.checkMs) + '</span>';
        if (!ds.length && !x.decision && x.via !== 'update') html += '<span class="why-muted why-note">The check\'s own verdict has dropped out of the recent log; this is from the alert itself.</span>';
        return html;
    }

    function ledToHtml(x, s) {
        const out = [];
        const flags = (s.actions || []).filter((a) => a.alert === x.id || (x.updateOf && a.alert === x.updateOf));
        for (const a of flags) out.push('<li>Flagged on your radar: <b>' + esc(a.title) + '</b>' + (a.status !== 'todo' ? ' <span class="why-muted">(' + esc(a.status === 'done' ? 'done' : 'removed') + ')</span>' : '') + '</li>');
        if (x.updateOf) {
            const base = (s.said || []).find((y) => y.id === x.updateOf);
            if (base) out.push('<li>Added to the alert from ' + mmss(base.t) + ': <q>' + esc(firstSentence(base.text)) + '</q></li>');
        }
        for (const u of (s.said || []).filter((y) => y.updateOf === x.id).sort((a, b) => a.t - b.t)) out.push('<li>Updated at ' + mmss(u.t) + ': <q>' + esc(firstSentence(u.text)) + '</q></li>');
        const eng = ((s.wm && s.wm.said) || []).find((y) => y.id === x.id);
        if (eng && eng.acked) out.push('<li>You pressed <b>Got it</b>.</li>');
        return out.length ? '<ul class="why-led">' + out.join('') + '</ul>' : '';
    }

    // ── the view ───────────────────────────────────────────────────────
    const EMPTY = '<div class="why-empty"><p><b>Nothing said yet.</b> Each time the coworker speaks up, answers, or decides to keep quiet, it appears here with its chain of reasons:</p>'
        + '<ol class="why-preview" aria-hidden="true"><li>Heard</li><li>Wrote down</li><li>Set off by</li><li>Checked</li><li>Said</li><li>Led to</li></ol>'
        + '<p class="why-muted">Start an encounter, or play the Morrison demo, and keep this open.</p></div>';

    const view = {
        _sel: null,       // the key the user picked (kept across updates)
        _auto: true,      // follow the newest until the user picks one
        _listSig: '',
        _chainSig: '',
        _items: null,

        render(el, s) {
            this._el = el;
            this._listSig = this._chainSig = '';
            el.innerHTML = '<div class="why"><div class="why-left"><div class="why-list" role="listbox" aria-label="What it said or did" tabindex="-1"></div></div>'
                + '<section class="why-chain" aria-live="polite" aria-label="How it thought"></section></div>';
            const list = el.querySelector('.why-list');
            list.addEventListener('click', (ev) => {
                const o = ev.target.closest('[data-key]');
                if (o) this._pick(o.dataset.key, true);
            });
            list.addEventListener('keydown', (ev) => {
                const opts = [...list.querySelectorAll('[data-key]')];
                const i = opts.findIndex((o) => o.dataset.key === this._sel);
                const go = { ArrowDown: i + 1, ArrowUp: i - 1, Home: 0, End: opts.length - 1 }[ev.key];
                if (go == null || !opts.length) return;
                ev.preventDefault();
                const n = opts[Math.max(0, Math.min(opts.length - 1, go))];
                this._pick(n.dataset.key, true);
            });
            this.update(el, s);
        },

        update(el, s) {
            if (!el || !el.querySelector('.why')) return;
            this._el = el;
            this._s = s;
            const { main, quiet } = itemsOf(s);
            const all = main.concat(quiet);
            this._items = all;
            const list = el.querySelector('.why-list');
            const chain = el.querySelector('.why-chain');
            if (!all.length) {
                if (this._listSig !== 'empty') { list.hidden = true; chain.innerHTML = EMPTY; this._listSig = 'empty'; this._chainSig = ''; }
                return;
            }
            list.hidden = false;
            if (this._auto || !all.some((x) => x.key === this._sel)) this._sel = (main[0] || quiet[0]).key;
            // The list: rewritten only when something is new or changed; scroll and focus stay put.
            const sig = all.map((x) => x.key + '|' + x.title).join('\n');
            if (sig !== this._listSig) {
                const top = list.scrollTop;
                const hadFocus = list.contains(document.activeElement);
                const seen = new Set((this._listSig || '').split('\n').map((r) => r.split('|')[0]));
                const row = (x) => {
                    const T = TYPE[x.type];
                    const on = x.key === this._sel;
                    return '<div class="why-item' + (this._listSig && this._listSig !== 'empty' && !seen.has(x.key) ? ' is-new' : '') + '" role="option" data-key="' + esc(x.key) + '" aria-selected="' + on + '" tabindex="' + (on ? 0 : -1) + '">'
                        + '<span class="why-dot ' + T.dot + '" title="' + esc(T.label) + '"></span><span class="why-item-text"><span class="why-kind">' + esc(T.label) + '</span>' + esc(x.title) + '</span>'
                        + '<time>' + mmss(x.t) + '</time></div>';
                };
                list.innerHTML = main.map(row).join('')
                    + (quiet.length ? '<div class="why-group" role="presentation">Checked and kept quiet (' + quiet.length + ')</div>' + quiet.map(row).join('') : '');
                list.scrollTop = top;
                if (hadFocus) { const f = list.querySelector('[aria-selected="true"]'); if (f) f.focus({ preventScroll: true }); }
                this._listSig = sig;
            }
            this._markSelected(false);
            this._renderChain(chain, s);
        },

        _markSelected(focus) {
            const el = this._el;
            if (!el) return;
            el.querySelectorAll('.why-list [data-key]').forEach((o) => {
                const on = o.dataset.key === this._sel;
                o.setAttribute('aria-selected', String(on));
                o.tabIndex = on ? 0 : -1;
                if (on && focus) { o.focus({ preventScroll: true }); o.scrollIntoView({ block: 'nearest' }); }
            });
        },

        _pick(key, byUser) {
            if (!key || !this._el) return;
            this._sel = key;
            if (byUser) this._auto = false;
            this._markSelected(true);
            this._renderChain(this._el.querySelector('.why-chain'), this._s || {});
        },

        _renderChain(chain, s) {
            const item = (this._items || []).find((x) => x.key === this._sel);
            if (!item) return;
            const steps = chainOf(item, s);
            const T = TYPE[item.type];
            const head = '<header class="why-head"><span class="why-chip ' + T.dot + '">' + esc(T.label) + '</span><time>' + mmss(item.t) + ' into the encounter</time>'
                + (this._auto ? '<span class="why-follow">following the newest</span>' : '<button type="button" class="why-follow is-btn" data-why="newest">Follow the newest</button>') + '</header>';
            const html = head + '<ol class="why-steps">' + steps.map((st) => '<li class="why-step ' + st.cls + '"><span class="why-node" aria-hidden="true"></span><div><p class="why-label">' + esc(st.label)
                + (st.at != null ? ' <time>' + mmss(st.at) + '</time>' : '') + '</p><div class="why-text">' + st.body + '</div></div></li>').join('') + '</ol>';
            if (html === this._chainSig) return;
            this._chainSig = html;
            const top = chain.scrollTop;
            chain.innerHTML = html;
            chain.scrollTop = top;
            const btn = chain.querySelector('[data-why=newest]');
            if (btn) btn.addEventListener('click', () => { this._auto = true; this.update(this._el, this._s || {}); });
        },
    };

    root.LiveAbout.register('why', view);
    // For tests: the reason decoder.
    view._decodeReason = decodeReason;
})(typeof window !== 'undefined' ? window : globalThis);
