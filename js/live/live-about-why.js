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
 *
 * Its picture of the patient: each time its take changes, a row in the same list
 * ("New worry: …"), and a strip above with every look along the encounter. For one
 * version: what was new since the version before, what changed (words added and
 * struck, worries new, more urgent or dropped), the picture as it stood, and the
 * live note's summary then. Data: wm.takes and wm.notePRs (live-core.js).
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
        picture: { label: 'Its picture', dot: 'is-picture' },
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
        const pics = pictureItems(s);
        const main = said.concat(held, pics.filter((x) => x.changed)).sort((a, b) => b.t - a.t);
        const quiet = (s.decisions || []).filter((d) => d.decision === 'quiet' || d.decision === 'suppressed')
            .map((d, i) => ({ key: 'Q:' + Math.round(d.at || 0) + ':' + i + ':' + clip(d.reason, 24), type: 'quiet', t: d.at || 0, title: clip(d.text || plainReason(d.reason), 140), src: d }))
            .sort((a, b) => b.t - a.t);
        return { main, quiet, pics };
    }

    // ── its picture of the patient over time ───────────────────────────
    const RANK = { critical: 3, important: 2, minor: 1 };
    const rankOf = (sv) => RANK[sv] || 1;
    const sevCls = (sv) => (sv === 'critical' ? 'critical' : sv === 'important' ? 'important' : 'minor');
    const norm = (t) => String(t || '').toLowerCase().replace(/[^a-z0-9.%/ ]+/g, ' ').replace(/\s+/g, ' ').trim();
    const LOOK = { prime: 'its first read of the chart, before the visit', heartbeat: 'its regular review, about every minute and a half', 'quick look': 'a quick look after something new' };
    const lookText = (w) => LOOK[w] || (w ? 'a review (' + w + ')' : 'a review');

    /** Word-level difference of two texts: [{op: '=' | '+' | '-', w}]. */
    function diffWords(a, b) {
        const A = String(a || '').trim().split(/\s+/).filter(Boolean), B = String(b || '').trim().split(/\s+/).filter(Boolean);
        const n = A.length, m = B.length;
        if (!n) return B.map((w) => ({ op: '+', w }));
        if (!m) return A.map((w) => ({ op: '-', w }));
        if (n * m > 60000) return A.map((w) => ({ op: '-', w })).concat(B.map((w) => ({ op: '+', w })));
        const k = (w) => w.toLowerCase().replace(/[^a-z0-9.%/]/g, '');
        const L = Array.from({ length: n + 1 }, () => new Uint16Array(m + 1));
        for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) L[i][j] = k(A[i]) === k(B[j]) ? L[i + 1][j + 1] + 1 : Math.max(L[i + 1][j], L[i][j + 1]);
        const out = [];
        let i = 0, j = 0;
        while (i < n && j < m) {
            if (k(A[i]) === k(B[j])) { out.push({ op: '=', w: B[j] }); i++; j++; }
            else if (L[i + 1][j] >= L[i][j + 1]) out.push({ op: '-', w: A[i++] });
            else out.push({ op: '+', w: B[j++] });
        }
        while (i < n) out.push({ op: '-', w: A[i++] });
        while (j < m) out.push({ op: '+', w: B[j++] });
        return out;
    }
    /** The new text, with added words marked and removed ones struck (runs grouped). */
    function diffHtml(a, b) {
        const parts = [];
        for (const d of diffWords(a, b)) {
            const last = parts[parts.length - 1];
            if (last && last.op === d.op) last.w.push(d.w); else parts.push({ op: d.op, w: [d.w] });
        }
        return parts.map((p) => { const t = esc(p.w.join(' ')); return p.op === '+' ? '<ins>' + t + '</ins>' : p.op === '-' ? '<del>' + t + '</del>' : t; }).join(' ');
    }
    const wordSet = (t) => new Set(norm(t).split(' ').filter((w) => w.length > 2));
    function alike(a, b) {
        const A = wordSet(a), B = wordSet(b);
        if (!A.size || !B.size) return 0;
        let n = 0;
        for (const w of A) if (B.has(w)) n++;
        return n / Math.min(A.size, B.size);
    }
    /** Each worry now against the version before: new, more or less urgent, reworded, the same, or dropped. */
    function worryChanges(before, now) {
        const P = Array.isArray(before) ? before : [], C = Array.isArray(now) ? now : [];
        const used = new Set();
        const rows = [];
        for (const c of C) {
            let j = P.findIndex((p, i) => !used.has(i) && p.topic && c.topic && norm(p.topic) === norm(c.topic));
            if (j < 0) j = P.findIndex((p, i) => !used.has(i) && alike(p.text, c.text) >= 0.6);
            if (j < 0) { rows.push({ kind: 'new', c }); continue; }
            used.add(j);
            const p = P[j];
            const d = rankOf(c.severity) - rankOf(p.severity);
            rows.push({ kind: d > 0 ? 'up' : d < 0 ? 'down' : norm(p.text) !== norm(c.text) ? 'reworded' : 'same', c, p });
        }
        P.forEach((p, i) => { if (!used.has(i)) rows.push({ kind: 'dropped', c: p }); });
        return rows;
    }
    /** In a few words, what changed from the version before (null: the same picture). */
    function summarize(v, prev) {
        const a = (prev && prev.take) || {}, b = v.take || {};
        const ch = worryChanges(a.concerns, b.concerns);
        const of = (kind) => ch.filter((x) => x.kind === kind);
        // The most urgent change names the version: a new critical worry, one raised to critical,
        // another new or raised worry, one let go of, one less urgent.
        const crit = (x) => x.c.severity === 'critical';
        const events = [].concat(
            of('new').filter(crit).map((x) => ['New worry: ', x]), of('up').filter(crit).map((x) => ['More urgent: ', x]),
            of('new').filter((x) => !crit(x)).map((x) => ['New worry: ', x]), of('up').filter((x) => !crit(x)).map((x) => ['More urgent: ', x]),
            of('dropped').map((x) => ['Let go of: ', x]), of('down').map((x) => ['Less urgent: ', x]));
        if (events.length) return events[0][0] + clip(events[0][1].c.text, 80) + (events.length > 1 ? ' (and ' + (events.length - 1) + ' more)' : '');
        if (norm(a.assessment) !== norm(b.assessment)) return 'Rethought the assessment';
        if (norm(a.one_liner) !== norm(b.one_liner)) return 'New one-line summary';
        if (norm(a.differs) !== norm(b.differs)) return b.differs ? 'Now sees it differently from you' : 'No longer differs from you';
        if (of('reworded').length) return 'Reworded a worry';
        const nx = (b.next || []).filter((x) => !(a.next || []).some((y) => norm(y) === norm(x)));
        if (nx.length) return 'New next step: ' + clip(nx[0], 70);
        return null;
    }
    /** How much a version matters on the strip: a new or more urgent critical worry, an important one, another change, or none. */
    function levelOf(v, prev) {
        if (!prev) return 'chg';
        const ch = worryChanges(prev.take && prev.take.concerns, v.take && v.take.concerns).filter((x) => x.kind === 'new' || x.kind === 'up');
        if (ch.some((x) => x.c.severity === 'critical')) return 'crit';
        if (ch.length) return 'imp';
        return summarize(v, prev) ? 'chg' : 'same';
    }
    /** Every version of the take: changed ones go in the list; all of them go on the strip. */
    function pictureItems(s) {
        const takes = s.wm && Array.isArray(s.wm.takes) ? s.wm.takes.filter((v) => v && v.take) : [];
        return takes.map((v, i) => {
            const prev = i ? takes[i - 1] : null;
            const sum = prev ? summarize(v, prev) : v.why === 'prime' ? 'First picture, from the chart' : 'First picture';
            return { key: 'P:' + v.n, type: 'picture', t: v.t || 0, title: sum || 'Looked again, same picture', changed: !!sum, level: levelOf(v, prev), src: v, prev, next: takes[i + 1] || null };
        });
    }
    /** The live note's summary in force at a moment (the last one written before it). */
    function noteAt(prs, t) {
        let r = null;
        for (const p of prs) { if ((p.t || 0) <= t) r = p; else break; }
        return r;
    }

    const kv = (k, html) => '<div class="why-pic-row"><span class="why-pic-k">' + esc(k) + '</span><div class="why-pic-v">' + html + '</div></div>';
    const BADGE = { new: 'new', up: 'more urgent', down: 'less urgent', reworded: 'reworded', dropped: 'dropped' };

    function pictureSteps(item, s) {
        const v = item.src, prev = item.prev;
        const a = (prev && prev.take) || {}, b = v.take || {};
        const steps = [];
        // 1. What was new.
        if (!prev) {
            steps.push(step('is-heard', v.why === 'prime' ? 'Before the visit' : 'Heard so far', null, v.why === 'prime'
                ? 'Nothing heard yet: it read the chart digest and its long-term memory of the record.'
                : newSince(v, null)));
        } else {
            steps.push(step('is-heard', 'New since ' + mmss(prev.t), null, newSince(v, prev)));
        }
        // 2. What changed.
        if (!prev) {
            steps.push(step('is-check', 'What changed', null, 'Its first picture of him' + (v.why === 'prime' ? ', from the chart alone.' : '.')));
        } else {
            const rows = [];
            if (norm(a.one_liner) !== norm(b.one_liner)) rows.push(kv('Summary', diffHtml(a.one_liner, b.one_liner)));
            if (norm(a.assessment) !== norm(b.assessment)) rows.push(kv('Assessment', diffHtml(a.assessment, b.assessment)));
            const ch = worryChanges(a.concerns, b.concerns).filter((x) => x.kind !== 'same');
            if (ch.length) {
                rows.push(kv('Worries', '<ul class="why-pic-list">' + ch.map((x) => '<li class="is-pair"><span class="why-pic-badge is-' + x.kind + '">' + BADGE[x.kind] + '</span><span>'
                    + (x.kind === 'dropped' ? '<del>' + esc(x.c.text) + '</del>' : x.kind === 'reworded' ? diffHtml(x.p.text, x.c.text) : esc(x.c.text))
                    + (x.kind === 'up' || x.kind === 'down' ? ' <span class="why-muted">(' + esc(sevCls(x.p.severity)) + ' to ' + esc(sevCls(x.c.severity)) + ')</span>' : '') + '</span></li>').join('') + '</ul>'));
            }
            const nx = (b.next || []).filter((x) => !(a.next || []).some((y) => norm(y) === norm(x)));
            if (nx.length) rows.push(kv('Next', '<ul class="why-pic-list">' + nx.map((x) => '<li class="is-pair"><span class="why-pic-badge is-new">new</span><span>' + esc(x) + '</span></li>').join('') + '</ul>'));
            if (norm(a.differs) !== norm(b.differs)) rows.push(kv('Differs', b.differs ? esc(b.differs) : '<span class="why-muted">No longer differs from you.</span>'));
            steps.push(step('is-check', 'What changed', null, rows.length ? rows.join('') : '<span class="why-muted">Nothing: the same picture as at ' + mmss(prev.t) + '.</span>'));
        }
        // 3. The picture as it stood.
        const worries = (b.concerns || []);
        steps.push(step('is-said is-picture', 'Its picture', v.t,
            '<span class="why-said"><b>' + esc(b.one_liner || '') + '</b></span>'
            + (b.assessment ? '<span class="why-why">' + esc(b.assessment) + '</span>' : '')
            + (worries.length ? '<ul class="why-pic-list is-now">' + worries.map((c) => '<li class="is-pair"><span class="why-sev is-' + sevCls(c.severity) + '" title="' + esc(sevCls(c.severity)) + '"></span><span>' + esc(c.text) + '</span></li>').join('') + '</ul>' : '')
            + ((b.next || []).length ? '<span class="why-meta">Next: ' + esc(b.next.join('; ')) + '</span>' : '')
            + (b.doctor_view ? '<span class="why-meta">Your view, as it heard it: ' + esc(b.doctor_view) + '</span>' : '')
            + (b.differs ? '<span class="why-meta"><b>Where it differs from you:</b> ' + esc(b.differs) + '</span>' : '')));
        // 4. The live note's summary then (rewritten a few seconds after each new take).
        const prs = (s.wm && Array.isArray(s.wm.notePRs)) ? s.wm.notePRs : [];
        const until = item.next ? item.next.t - 1 : Infinity;
        const pr = noteAt(prs, until), before = noteAt(prs, v.t - 1);
        steps.push(step('is-led', 'The live note', pr ? pr.t : null, pr
            ? '<span class="why-note-pr">' + (before && before !== pr ? diffHtml(before.text, pr.text) : esc(pr.text)) + '</span>'
              + (before && before !== pr ? '<span class="why-meta">Changes since ' + mmss(before.t) + ' marked</span>' : '')
            : '<span class="why-muted">The note had no summary yet.</span>'));
        return steps;
    }

    function newSince(v, prev) {
        const parts = [];
        const facts = v.facts || [], think = v.thinking || [], plan = v.plan || [], said = v.said || [];
        // The most recent few of each: what changed is the point, so this stays short.
        const earlier = (n, cap) => (n > cap ? '<li class="why-muted">and ' + (n - cap) + ' earlier</li>' : '');
        if (facts.length) {
            parts.push('<ul class="why-facts">' + facts.slice(-5).map((f) => '<li><span class="why-tag">' + esc(f.kind || 'fact') + '</span>' + esc(clip(f.text, 140)) + '</li>').join('')
                + earlier(facts.length, 5) + '</ul>');
        }
        if (think.length) parts.push('<p class="why-pic-sub">Your thinking</p><ul class="why-pic-list">' + think.slice(-3).map((x) => '<li><q>' + esc(clip(x.text, 200)) + '</q></li>').join('') + earlier(think.length, 3) + '</ul>');
        if (plan.length) parts.push('<p class="why-pic-sub">Your plan</p><ul class="why-pic-list">' + plan.slice(-3).map((x) => '<li>' + esc(clip(x.text, 160)) + '</li>').join('') + earlier(plan.length, 3) + '</ul>');
        if (said.length) parts.push('<p class="why-pic-sub">It said</p><ul class="why-pic-list">' + said.slice(-3).map((x) => '<li>' + esc(firstSentence(x.text)) + '</li>').join('') + earlier(said.length, 3) + '</ul>');
        const how = '<span class="why-meta">Then it looked again: ' + esc(lookText(v.why)) + '.</span>';
        if (!parts.length) return '<span class="why-muted">Nothing new heard' + (prev ? ' since ' + mmss(prev.t) : '') + '.</span>' + how;
        return parts.join('') + how;
    }

    /** The strip: every look along the encounter, coloured by what changed. */
    function stripHtml(s, pics, sel) {
        if (!pics.length) return '';
        const lines = (s.wm && s.wm.lines) || s.lines || [];
        const lastLine = lines.length ? Math.max(...lines.map((l) => l.t || 0)) : 0;
        const end = Math.max(60000, lastLine, ...pics.map((p) => p.t));
        const changes = pics.filter((p) => p.changed).length;
        const ticks = pics.map((p) => '<span class="why-tick is-' + p.level + (p.key === sel ? ' is-on' : '') + '" data-pick="' + esc(p.key) + '" style="left:' + (100 * p.t / end).toFixed(2) + '%" title="'
            + esc(mmss(p.t) + ' · ' + p.title) + '"></span>').join('');
        return '<div class="why-strip-head"><span class="why-strip-label">Its picture of the patient</span><span class="why-strip-count">'
            + changes + (changes === 1 ? ' change' : ' changes') + ' in ' + pics.length + (pics.length === 1 ? ' look' : ' looks') + '</span></div>'
            + '<div class="why-strip-track" aria-hidden="true">' + ticks + '</div>'
            + '<div class="why-strip-axis" aria-hidden="true"><span>0:00</span><span>' + mmss(end) + '</span></div>';
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

        if (item.type === 'picture') return pictureSteps(item, s);

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
    const EMPTY = '<div class="why-empty"><p><b>Nothing said yet.</b> Each time the coworker speaks up, answers, decides to keep quiet, or changes its picture of the patient, it appears here with its chain of reasons:</p>'
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
            el.innerHTML = '<div class="why"><div class="why-strip" hidden></div><div class="why-left"><div class="why-list" role="listbox" aria-label="What it said or did" tabindex="-1"></div></div>'
                + '<section class="why-chain" aria-live="polite" aria-label="How it thought"></section></div>';
            const list = el.querySelector('.why-list');
            el.querySelector('.why-strip').addEventListener('click', (ev) => {
                const t = ev.target.closest('[data-pick]');
                if (t) this._pick(t.dataset.pick, true);
            });
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
            const { main, quiet, pics } = itemsOf(s);
            const all = main.concat(quiet);
            this._items = all.concat(pics.filter((x) => !x.changed));   // a same-picture look can be picked on the strip
            this._pics = pics;
            const list = el.querySelector('.why-list');
            const chain = el.querySelector('.why-chain');
            if (!all.length) {
                if (this._listSig !== 'empty') { list.hidden = true; chain.innerHTML = EMPTY; this._listSig = 'empty'; this._chainSig = ''; }
                this._renderStrip(s);
                return;
            }
            list.hidden = false;
            if (this._auto || !this._items.some((x) => x.key === this._sel)) this._sel = (main[0] || quiet[0]).key;
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
            this._renderStrip(s);
            this._renderChain(chain, s);
        },

        _renderStrip(s) {
            const el = this._el && this._el.querySelector('.why-strip');
            if (!el) return;
            const pics = this._pics || [];
            const html = stripHtml(s, pics, this._sel);
            if (html === this._stripSig) return;
            this._stripSig = html;
            el.hidden = !html;
            el.innerHTML = html;
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
            el.querySelectorAll('.why-strip [data-pick]').forEach((t) => t.classList.toggle('is-on', t.dataset.pick === this._sel));
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
            const head = '<header class="why-head"><span class="why-chip ' + T.dot + '">' + esc(T.label) + (item.type === 'picture' ? ' · version ' + esc(item.src.n) : '') + '</span><time>' + mmss(item.t) + ' into the encounter</time>'
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
    // For tests: the reason decoder and the picture's pieces.
    view._decodeReason = decodeReason;
    view._picture = { diffWords, diffHtml, worryChanges, summarize, pictureItems };
})(typeof window !== 'undefined' ? window : globalThis);
