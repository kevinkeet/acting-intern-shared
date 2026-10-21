/**
 * Live Coworker: the panel UI (DOM only; no AI calls, no app state).
 *
 * Information architecture, top to bottom:
 *   1. Header: am I listening (mic + status), how much may I speak (mode).
 *   2. Safety alerts: pinned until acknowledged. The only loud thing.
 *   3. My take: the coworker's current read, one line first, detail on demand.
 *   4. Said | Tracking | Transcript | Log:
 *        Said: everything it said (answers, alerts, insights), newest first,
 *              plus thoughts it is holding until asked.
 *        Tracking: its working memory (what it heard, your thinking, the
 *              plan, what it is watching for).
 *        Transcript: the conversation as heard. Log: calls, latency, cost.
 *   5. Ask box.
 * When the panel is wide, talk (alerts, Said, ask) sits on the left and
 * thinking (take, tracking, transcript, log) on the right.
 *
 * LiveApp owns the state and calls render*(view) when something changes.
 */
(function (root) {
    'use strict';

    const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    const svg = (paths, cls) => '<svg class="' + (cls || '') + '" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + paths + '</svg>';
    const ICON = {
        mic: svg('<path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" x2="12" y1="19" y2="22"/>'),
        more: svg('<circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/><circle cx="5" cy="12" r="1"/>'),
        alert: svg('<path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3"/><path d="M12 9v4"/><path d="M12 17h.01"/>', 'is-critical'),
        bulb: svg('<path d="M15 14c.2-1 .7-1.7 1.5-2.5 1-.9 1.5-2.2 1.5-3.5A6 6 0 0 0 6 8c0 1 .2 2.2 1.5 3.5.7.7 1.3 1.5 1.5 2.5"/><path d="M9 18h6"/><path d="M10 22h4"/>', 'is-insight'),
        chat: svg('<path d="M7.9 20A9 9 0 1 0 4 16.1L2 22Z"/>'),
        chevron: svg('<path d="m6 9 6 6 6-6"/>'),
        play: svg('<polygon points="6 3 20 12 6 21 6 3"/>'),
    };
    const MODE_HINT = {
        follow: 'Answers when you ask. Speaks up only for safety.',
        abreast: 'Keeps pace with your thinking. Speaks up for safety and holds other thoughts until you ask.',
        lead: 'Thinks ahead. Speaks up for safety and volunteers what you may have missed.',
    };
    const fmt = (ms) => { const s = Math.max(0, Math.round((ms || 0) / 1000)); return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'); };
    const ago = (ms) => { if (ms == null) return ''; const s = Math.round(ms / 1000); return s < 10 ? 'just now' : s < 60 ? s + 's ago' : Math.round(s / 60) + 'm ago'; };
    const secs = (ms) => (ms == null ? '' : (ms / 1000).toFixed(1) + 's');

    const LivePanel = {
        el: null,
        refs: {},
        handlers: {},
        tab: 'said',
        seenSaid: 0,

        mount(panel, handlers) {
            this.handlers = handlers || {};
            const wrap = document.createElement('section');
            wrap.className = 'lc';
            wrap.id = 'live-coworker';
            wrap.setAttribute('aria-label', 'AI Coworker, live');
            wrap.innerHTML = [
                '<header class="lc-head">',
                '  <div class="lc-status">',
                '    <button type="button" class="lc-mic" data-act="mic" aria-pressed="false" title="Start listening">' + ICON.mic + '<span class="lc-sr">Listen</span></button>',
                '    <div class="lc-status-text"><span class="lc-state" data-ref="state">Ready</span><span class="lc-sub" data-ref="sub"></span></div>',
                '    <button type="button" class="lc-iconbtn" data-act="settings" aria-haspopup="true" aria-expanded="false" title="Coworker settings">' + ICON.more + '<span class="lc-sr">Settings</span></button>',
                '  </div>',
                '  <div class="lc-modes" role="radiogroup" aria-label="How much the coworker speaks up">',
                '    <button type="button" role="radio" data-mode="follow" aria-checked="false" title="' + MODE_HINT.follow + '">Follow</button>',
                '    <button type="button" role="radio" data-mode="abreast" aria-checked="true" title="' + MODE_HINT.abreast + '">Abreast</button>',
                '    <button type="button" role="radio" data-mode="lead" aria-checked="false" title="' + MODE_HINT.lead + '">Lead</button>',
                '  </div>',
                '  <p class="lc-mode-hint" data-ref="hint" hidden></p>',
                '  <div class="lc-replay" data-ref="replay" hidden></div>',
                '</header>',
                '<div class="lc-body">',
                '  <div class="lc-left">',
                '    <div class="lc-alerts" data-ref="alerts" aria-live="assertive"></div>',
                '    <div class="lc-pane is-active" data-pane="said" role="tabpanel" aria-label="Said"><h3 class="lc-pane-title">Said</h3><div data-ref="said" aria-live="polite"></div></div>',
                '    <form class="lc-ask" data-ref="ask" autocomplete="off">',
                '      <label class="lc-sr" for="lc-ask-input">Ask the coworker</label>',
                '      <input id="lc-ask-input" type="text" placeholder="Ask the coworker…" enterkeyhint="send">',
                '      <button type="submit" class="lc-btn lc-btn-primary">Ask</button>',
                '    </form>',
                '  </div>',
                '  <div class="lc-right">',
                '    <section class="lc-take" data-ref="take" data-open="true" aria-label="My take"></section>',
                '    <div class="lc-tabs" role="tablist" aria-label="Coworker views">',
                '      <button type="button" role="tab" data-tab="said" aria-selected="true">Said<span class="lc-count" data-ref="saidCount" hidden></span></button>',
                '      <button type="button" role="tab" data-tab="tracking" aria-selected="false">Tracking</button>',
                '      <button type="button" role="tab" data-tab="transcript" aria-selected="false">Transcript</button>',
                '      <button type="button" role="tab" data-tab="log" aria-selected="false">Log</button>',
                '    </div>',
                '    <div class="lc-pane" data-pane="tracking" role="tabpanel" aria-label="Tracking"><h3 class="lc-pane-title">Tracking</h3><div data-ref="tracking"></div></div>',
                '    <div class="lc-pane" data-pane="transcript" role="tabpanel" aria-label="Transcript"><h3 class="lc-pane-title">Transcript</h3><div data-ref="transcript" class="lc-lines"></div></div>',
                '    <div class="lc-pane" data-pane="log" role="tabpanel" aria-label="Log"><h3 class="lc-pane-title">Under the hood</h3><div data-ref="log"></div></div>',
                '  </div>',
                '</div>',
                '<div class="lc-pop" data-ref="pop" hidden role="dialog" aria-label="Coworker settings"></div>',
            ].join('\n');

            const topbar = panel.querySelector('.ai-panel-topbar');
            if (topbar && topbar.nextSibling) panel.insertBefore(wrap, topbar.nextSibling);
            else panel.appendChild(wrap);
            this.el = wrap;
            wrap.querySelectorAll('[data-ref]').forEach((n) => { this.refs[n.dataset.ref] = n; });
            this.refs.mic = wrap.querySelector('.lc-mic');
            this.refs.settingsBtn = wrap.querySelector('[data-act="settings"]');
            this.refs.input = wrap.querySelector('#lc-ask-input');
            this._bind();
            return wrap;
        },

        unmount() { if (this.el) this.el.remove(); this.el = null; this.refs = {}; },

        _bind() {
            const w = this.el;
            const h = this.handlers;
            w.addEventListener('click', (ev) => {
                const t = ev.target.closest('button, [data-act]');
                if (!t || !w.contains(t)) return;
                if (t.dataset.mode) return h.onMode && h.onMode(t.dataset.mode);
                if (t.dataset.tab) return this.showTab(t.dataset.tab);
                const act = t.dataset.act;
                if (!act) return;
                if (act === 'mic') return h.onMic && h.onMic();
                if (act === 'settings') return this.togglePop();
                if (act === 'ack') return h.onAck && h.onAck(t.dataset.id);
                if (act === 'ack-all') return h.onAckAll && h.onAckAll();
                if (act === 'unfold') return h.onUnfold && h.onUnfold(t.dataset.id);
                if (act === 'why') { const p = t.closest('.lc-alert'); const why = p && p.querySelector('.lc-alert-why'); if (why) { why.hidden = !why.hidden; t.textContent = why.hidden ? 'Why?' : 'Hide why'; } return; }
                if (act === 'take-toggle') return h.onTakeToggle && h.onTakeToggle();
                if (act === 'tell') return h.onTellHeld && h.onTellHeld(t.dataset.topic);
                if (act === 'demo') return h.onReplay && h.onReplay('play');
                if (act === 'replay') return h.onReplay && h.onReplay(t.dataset.cmd);
                if (act === 'prime') return h.onPrime && h.onPrime();
                if (act === 'reset') return h.onReset && h.onReset();
                if (act === 'classic') return h.onClassic && h.onClassic();
            });
            w.addEventListener('change', (ev) => {
                const t = ev.target;
                if (t.name && h.onSetting) h.onSetting(t.name, t.type === 'checkbox' ? t.checked : t.value);
            });
            this.refs.ask.addEventListener('submit', (ev) => {
                ev.preventDefault();
                const q = this.refs.input.value.trim();
                if (!q) return;
                this.refs.input.value = '';
                if (h.onAsk) h.onAsk(q);
                this.showTab('said');
            });
            w.addEventListener('keydown', (ev) => {
                if (ev.key === 'Escape' && !this.refs.pop.hidden) { this.togglePop(false); this.refs.settingsBtn.focus(); }
                if (ev.target.getAttribute('role') === 'tab' && (ev.key === 'ArrowRight' || ev.key === 'ArrowLeft')) {
                    const tabs = [...w.querySelectorAll('[role="tab"]')];
                    const i = tabs.indexOf(ev.target);
                    const n = tabs[(i + (ev.key === 'ArrowRight' ? 1 : tabs.length - 1)) % tabs.length];
                    n.focus();
                    this.showTab(n.dataset.tab);
                }
            });
            document.addEventListener('click', (ev) => {
                if (!this.el || this.refs.pop.hidden) return;
                if (!this.refs.pop.contains(ev.target) && !this.refs.settingsBtn.contains(ev.target)) this.togglePop(false);
            });
        },

        showTab(name) {
            this.tab = name;
            this.el.querySelectorAll('[role="tab"]').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.tab === name)));
            this.el.querySelectorAll('.lc-pane').forEach((p) => p.classList.toggle('is-active', p.dataset.pane === name));
            if (name === 'transcript') { const pane = this.refs.transcript.parentElement; pane.scrollTop = pane.scrollHeight; }
            if (name === 'said' && this.refs.saidCount) { this.refs.saidCount.hidden = true; this.refs.saidCount.classList.remove('is-new'); this.seenSaid = this._saidTotal || 0; }
            if (this.handlers.onTab) this.handlers.onTab(name);
        },

        togglePop(force) {
            const pop = this.refs.pop;
            const open = force == null ? pop.hidden : !!force;
            pop.hidden = !open;
            this.refs.settingsBtn.setAttribute('aria-expanded', String(open));
            if (open && this.handlers.onOpenSettings) this.handlers.onOpenSettings();
        },

        // ── header ───────────────────────────────────────────────────────
        renderHead(v) {
            const r = this.refs;
            r.state.textContent = v.status.label;
            r.sub.innerHTML = v.status.subHtml || esc(v.status.sub || '');
            r.mic.setAttribute('aria-pressed', String(v.status.state === 'listening'));
            r.mic.dataset.state = v.status.state;
            r.mic.title = v.status.state === 'listening' ? 'Stop listening' : 'Start listening';
            this.el.querySelectorAll('.lc-modes [role="radio"]').forEach((b) => b.setAttribute('aria-checked', String(b.dataset.mode === v.mode)));
            if (this._lastMode && this._lastMode !== v.mode) {
                r.hint.textContent = MODE_HINT[v.mode] || '';
                r.hint.hidden = false;
                clearTimeout(this._hintTimer);
                this._hintTimer = setTimeout(() => { r.hint.hidden = true; }, 4500);
            }
            this._lastMode = v.mode;
        },

        renderReplay(v) {
            const rp = v.replay;
            const el = this.refs.replay;
            if (!rp || !rp.active) { el.hidden = true; el.innerHTML = ''; return; }
            el.hidden = false;
            const pct = rp.duration ? Math.min(100, (rp.t / rp.duration) * 100) : 0;
            el.innerHTML = '<span class="lc-track" role="progressbar" aria-label="Demo progress" aria-valuemin="0" aria-valuemax="' + Math.round(rp.duration) + '" aria-valuenow="' + Math.round(rp.t) + '"><i style="width:' + pct.toFixed(1) + '%"></i></span><span>' + fmt(rp.t * 1000) + ' / ' + fmt(rp.duration * 1000) + '</span>'
                + '<button type="button" data-act="replay" data-cmd="' + (rp.playing ? 'pause' : 'play') + '">' + (rp.playing ? 'Pause' : 'Resume') + '</button>'
                + '<button type="button" data-act="replay" data-cmd="stop">Stop</button>';
        },

        // ── alerts ───────────────────────────────────────────────────────
        renderAlerts(v) {
            const el = this.refs.alerts;
            const items = v.alerts || [];
            // Newest alert in full; older ones fold to one line until opened.
            el.innerHTML = items.map((a, i) => {
                const folded = i > 0 && !(v.openAlerts && v.openAlerts[a.id]);
                return '<article class="lc-alert' + (folded ? ' is-folded' : '') + (this._seenAlerts && this._seenAlerts.has(a.id) ? ' is-seen' : '') + '" data-id="' + esc(a.id) + '" role="alert">'
                    + '<div class="lc-alert-top">' + ICON.alert + '<span>Safety</span><time>' + fmt(a.t) + '</time></div>'
                    + (folded
                        ? '<button type="button" class="lc-alert-line" data-act="unfold" data-id="' + esc(a.id) + '" title="Show this alert">' + esc(a.text) + '</button>'
                        : '<p class="lc-alert-text">' + esc(a.text) + '</p>'
                          + '<p class="lc-alert-why" hidden>' + esc(a.why || '') + (a.cueText ? ' Heard: <q>' + esc(a.cueText) + '</q>' : '') + '</p>'
                          + '<div class="lc-alert-actions"><button type="button" class="lc-btn lc-btn-primary" data-act="ack" data-id="' + esc(a.id) + '">Got it</button>'
                          + (a.why || a.cueText ? '<button type="button" class="lc-btn lc-btn-quiet" data-act="why">Why?</button>' : '')
                          + (items.length > 1 && i === 0 ? '<button type="button" class="lc-btn lc-btn-quiet" data-act="ack-all">Got all ' + items.length + '</button>' : '')
                          + '</div>')
                    + '</article>';
            }).join('');
            this._seenAlerts = new Set(items.map((a) => a.id));
        },

        // ── take ─────────────────────────────────────────────────────────
        renderTake(v) {
            const el = this.refs.take;
            const t = v.take;
            const open = v.takeOpen === true;
            el.dataset.open = String(open);
            const chip = t && v.mode !== 'follow'
                ? (t.differs ? '<span class="lc-chip is-differs">I see it differently</span>' : (t.doctor_view ? '<span class="lc-chip is-with">With you</span>' : ''))
                : '';
            const hasMore = t && v.mode !== 'follow' && (t.assessment || (t.next || []).length || (t.differs && v.mode !== 'lead') || ((v.alerts || []).length && (t.concerns || []).length));
            const head = '<div class="lc-take-head"><span class="lc-label">My take</span>'
                + (t ? '<time>' + esc(ago(v.now - t.at)) + '</time>' : '') + chip
                + (hasMore ? '<button type="button" class="lc-iconbtn" data-act="take-toggle" aria-expanded="' + String(open) + '" title="' + (open ? 'Show less' : 'Show more') + '">' + ICON.chevron + '</button>' : '')
                + '</div>';
            if (!t) {
                el.innerHTML = head + (v.takeLoading
                    ? '<span class="lc-skel"></span><span class="lc-skel"></span><span class="lc-skel"></span><p class="lc-take-empty">Reading the chart…</p>'
                    : '<p class="lc-take-empty">No take yet. It forms as soon as I read the chart. <button type="button" class="lc-btn lc-btn-quiet" data-act="prime">Read it now</button></p>');
                return;
            }
            const concerns = (t.concerns || []).slice(0, 4).map((c) => '<li><span class="lc-dot ' + esc(c.severity) + '" title="' + esc(c.severity) + '"></span><span>' + esc(c.text) + '</span></li>').join('');
            const next = (t.next || []).map((x) => '<li>' + esc(x) + '</li>').join('');
            const differs = t.differs ? '<p class="lc-differs"><b>Where I differ:</b> ' + esc(t.differs) + '</p>' : '';
            // Follow mode, or a safety alert waiting: one line only (more on request).
            if (v.mode === 'follow' || ((v.alerts || []).length && !open)) {
                el.innerHTML = head.replace('data-act="take-toggle"', 'data-act="take-toggle"') + '<p class="lc-one">' + esc(t.one_liner) + '</p>'
                    + (v.mode !== 'follow' && open ? '' : '');
                if (v.mode !== 'follow' && !hasMore && concerns) el.querySelector('.lc-take-head').insertAdjacentHTML('beforeend', '<button type="button" class="lc-iconbtn" data-act="take-toggle" aria-expanded="false" title="Show more">' + ICON.chevron + '</button>');
                return;
            }
            el.innerHTML = head
                + '<p class="lc-one">' + esc(t.one_liner) + '</p>'
                + (concerns ? '<ul class="lc-concerns" aria-label="What matters most">' + concerns + '</ul>' : '')
                + (v.mode === 'lead' ? differs : '')
                + '<div class="lc-take-more">'
                + (t.assessment ? '<p class="lc-assess">' + esc(t.assessment) + '</p>' : '')
                + (v.mode !== 'lead' ? differs : '')
                + (next ? '<div><span class="lc-label">Next I would</span><ul class="lc-next">' + next + '</ul></div>' : '')
                + '</div>';
        },

        // ── said stream ──────────────────────────────────────────────────
        renderSaid(v) {
            const el = this.refs.said;
            const pinned = new Set((v.alerts || []).map((a) => a.id));
            const items = (v.said || []).filter((s) => !pinned.has(s.id));
            this._saidTotal = items.length;
            const held = v.held || [];
            if (!items.length && !held.length && !Object.keys(v.streaming || {}).length) {
                el.innerHTML = '<p class="lc-empty">' + (v.mode === 'lead'
                    ? 'I\'ll answer when you ask (say <b>"Coworker, …"</b> or type below), flag anything unsafe, and point out what you might be missing.'
                    : 'I\'ll answer when you ask (say <b>"Coworker, …"</b> or type below) and speak up only for safety issues.') + '</p>';
                this._updateCount();
                return;
            }
            const parts = [];
            if (held.length) {
                parts.push('<details class="lc-held"' + (v.heldOpen ? ' open' : '') + '><summary>' + held.length + (held.length === 1 ? ' thought' : ' thoughts') + ' ready if you want them</summary><ul>'
                    + held.map((x) => '<li><span>' + esc(x.text) + '</span><button type="button" class="lc-btn" data-act="tell" data-topic="' + esc(x.topic) + '">Tell me</button></li>').join('')
                    + '</ul></details>');
            }
            for (const [id, s] of Object.entries(v.streaming || {})) {
                parts.push('<article class="lc-item is-answer" data-id="' + esc(id) + '">'
                    + (s.question ? '<p class="lc-q">' + esc(s.question) + '</p>' : '')
                    + (s.text ? '<p class="lc-a is-streaming">' + esc(s.text) + '</p>' : '<p class="lc-status-line">' + esc(s.status || 'Thinking…') + '</p>')
                    + '</article>');
            }
            for (const s of items) {
                const icon = s.kind === 'critical' ? ICON.alert : s.kind === 'insight' ? ICON.bulb : ICON.chat;
                const label = s.kind === 'critical' ? 'Safety' : s.kind === 'insight' ? 'Thought' : 'Answer';
                parts.push('<article class="lc-item is-' + esc(s.kind) + '" data-id="' + esc(s.id) + '">'
                    + '<div class="lc-item-meta">' + icon + '<span>' + label + '</span><span>·</span><time>' + fmt(s.t) + '</time>'
                    + (s.latencyMs != null ? '<span>·</span><span title="from what was said to the reply">' + secs(s.latencyMs) + '</span>' : '') + '</div>'
                    + (s.question ? '<p class="lc-q">' + esc(s.question) + '</p>' : '')
                    + '<p class="lc-a">' + esc(s.text) + '</p>'
                    + (s.why && s.kind !== 'answer' ? '<p class="lc-why">' + esc(s.why) + '</p>' : '')
                    + '</article>');
            }
            el.innerHTML = '<div class="lc-stream">' + parts.join('') + '</div>';
            this._updateCount();
        },

        /** Fast path while an answer streams in: touch only that item. */
        streamText(id, text, status, question) {
            const el = this.refs.said;
            let item = el.querySelector('.lc-item[data-id="' + CSS.escape(id) + '"]');
            if (!item) return false;
            const p = item.querySelector('.lc-a, .lc-status-line');
            if (text) {
                if (p && p.classList.contains('lc-a')) p.textContent = text;
                else if (p) { const n = document.createElement('p'); n.className = 'lc-a is-streaming'; n.textContent = text; p.replaceWith(n); }
            } else if (status && p) {
                p.className = 'lc-status-line';
                p.textContent = status;
            }
            return true;
        },

        _updateCount() {
            const c = this.refs.saidCount;
            if (!c) return;
            const unseen = (this._saidTotal || 0) - (this.seenSaid || 0);
            if (this.tab === 'said' || unseen <= 0) { c.hidden = true; if (this.tab === 'said') this.seenSaid = this._saidTotal || 0; return; }
            c.hidden = false;
            c.textContent = String(unseen);
            c.classList.add('is-new');
        },

        // ── tracking (working memory) ────────────────────────────────────
        renderTracking(v) {
            const wm = v.wm;
            const el = this.refs.tracking;
            if (!wm) { el.innerHTML = '<p class="lc-empty">Nothing yet.</p>'; return; }
            const fresh = (t) => (v.engineNow != null && v.engineNow - t < 5000 ? ' class="lc-new"' : '');
            const factGroup = (title, kinds) => {
                const fs = wm.facts.filter((f) => kinds.includes(f.kind));
                if (!fs.length) return '';
                return '<div class="lc-group"><h4>' + title + '</h4><ul>' + fs.map((f) => '<li' + fresh(f.t) + '><span class="lc-tag' + (f.from === 'patient' ? ' patient' : '') + '">' + esc(f.from === 'other' ? 'family' : f.from) + '</span><span>' + esc(f.text) + '</span></li>').join('') + '</ul></div>';
            };
            const parts = [];
            parts.push(factGroup('Story and symptoms', ['symptom', 'history', 'social', 'other']));
            parts.push(factGroup('Medicines and allergies', ['medication', 'allergy']));
            parts.push(factGroup('Exam and results', ['exam', 'data']));
            if (wm.thinking.length) parts.push('<div class="lc-group"><h4>Your thinking</h4><ul>' + wm.thinking.map((x) => '<li' + fresh(x.t) + '><span class="lc-tag">' + fmt(x.t) + '</span><span class="lc-quote">' + esc(x.text) + '</span></li>').join('') + '</ul></div>');
            if (wm.plan.length) parts.push('<div class="lc-group"><h4>Plan and orders</h4><ul>' + wm.plan.map((x) => '<li' + fresh(x.t) + '><span class="lc-tag ' + esc(x.kind) + '">' + esc(x.kind) + '</span><span>' + esc(x.text) + '</span></li>').join('') + '</ul></div>');
            if (wm.watch.length) parts.push('<div class="lc-group"><h4>Watching for</h4><ul>' + wm.watch.map((w) => '<li class="lc-watch" title="' + esc('If it happens: ' + w.alert) + '"><span class="lc-tag ' + esc(w.severity) + '">' + (w.severity === 'critical' ? 'safety' : 'note') + '</span><span>' + esc(w.trigger) + '</span></li>').join('') + '</ul></div>');
            const body = parts.filter(Boolean).join('');
            el.innerHTML = (body || '<p class="lc-empty">Nothing heard yet. Facts, your thinking and the plan collect here as you talk.</p>')
                + (v.memoryNote ? '<p class="lc-empty">' + esc(v.memoryNote) + '</p>' : '');
        },

        // ── transcript ───────────────────────────────────────────────────
        renderTranscript(v) {
            const el = this.refs.transcript;
            const lines = v.lines || [];
            if (!lines.length && !v.interim) { el.innerHTML = '<p class="lc-empty">The conversation will appear here as it is heard.</p>'; return; }
            const flagged = new Set((v.said || []).filter((s) => s.kind !== 'answer' && s.cueLine).map((s) => s.cueLine));
            const nearBottom = el.parentElement && (el.parentElement.scrollHeight - el.parentElement.scrollTop - el.parentElement.clientHeight < 60);
            el.innerHTML = lines.map((l) => '<div class="lc-line' + (flagged.has(l.id) ? ' is-flagged' : '') + '" data-speaker="' + esc(l.speaker) + '"><span class="lc-who">' + esc(l.label || l.speaker) + '</span><span class="lc-said">' + esc(l.text) + '</span></div>').join('')
                + (v.interim ? '<div class="lc-line is-interim" data-speaker="' + esc(v.interim.speaker) + '"><span class="lc-who">' + esc(v.interim.speaker) + '</span><span class="lc-said">' + esc(v.interim.text) + '</span></div>' : '');
            if (nearBottom && el.parentElement) el.parentElement.scrollTop = el.parentElement.scrollHeight;
        },

        // ── log ──────────────────────────────────────────────────────────
        renderLog(v) {
            const el = this.refs.log;
            const st = v.stats;
            if (!st || !st.calls) { el.innerHTML = '<p class="lc-empty">No AI calls yet.</p>' + (v.memoryNote ? '<p class="lc-empty">' + esc(v.memoryNote) + '</p>' : ''); return; }
            const med = (a) => { if (!a || !a.length) return null; const s = a.slice().sort((x, y) => x - y); return s[Math.floor(s.length / 2)]; };
            const LANE = { ear: 'Ear (listens)', answer: 'Answers', verify: 'Safety checks', update: 'Take updates', prime: 'Chart read', helper: 'Helpers' };
            const rows = Object.entries(st.byLane).map(([k, b]) => '<tr><td>' + esc(LANE[k] || k) + '</td><td>' + b.calls + (b.errors ? ' (' + b.errors + ' err)' : '') + '</td><td>' + secs(med(b.ms)) + '</td><td>$' + b.cost.toFixed(3) + '</td></tr>').join('');
            const calls = (v.calls || []).slice(-14).reverse().map((c) => {
                const u = c.usage || {};
                const cached = u.cache_read_input_tokens || 0;
                const inTok = (u.input_tokens || 0) + (u.cache_creation_input_tokens || 0) + cached;
                return '<div class="' + (c.ok ? '' : 'is-err') + '">' + fmt(c.at) + ' · ' + esc(c.lane) + ' · ' + esc(String(c.model).replace('claude-', '')) + ' · '
                    + (c.ok ? secs(c.ms.total) + ' · ' + Math.round(inTok / 100) / 10 + 'k in (' + (inTok ? Math.round((cached / inTok) * 100) : 0) + '% cached) · ' + (u.output_tokens || 0) + ' out · $' + (c.cost || 0).toFixed(4) + (c.fellBack ? ' · fallback ' + esc(c.servedBy) : '') + (c.refusal ? ' · declined (' + esc(c.refusal) + ')' : '') : 'failed: ' + esc(c.error)) + '</div>';
            }).join('');
            el.innerHTML = '<table class="lc-table"><thead><tr><th>Lane</th><th>Calls</th><th>Median</th><th>Cost</th></tr></thead><tbody>' + rows
                + '<tr><td><b>Total</b></td><td><b>' + st.calls + '</b></td><td></td><td><b>$' + st.cost.toFixed(3) + '</b></td></tr></tbody></table>'
                + '<div class="lc-calls">' + calls + '</div>'
                + (v.memoryNote ? '<p class="lc-empty">' + esc(v.memoryNote) + '</p>' : '');
        },

        // ── settings popover ─────────────────────────────────────────────
        renderSettings(v) {
            const s = v.settings;
            const radio = (name, value, label, hint) => '<label class="lc-opt"><input type="radio" name="' + name + '" value="' + value + '"' + (s[name] === value ? ' checked' : '') + '><span>' + label + (hint ? '<small>' + hint + '</small>' : '') + '</span></label>';
            const check = (name, label, hint, disabled) => '<label class="lc-opt"><input type="checkbox" name="' + name + '"' + (s[name] ? ' checked' : '') + (disabled ? ' disabled' : '') + '><span>' + label + (hint ? '<small>' + hint + '</small>' : '') + '</span></label>';
            this.refs.pop.innerHTML = [
                '<fieldset><legend>Thinking model</legend>',
                radio('brain', 'claude-sonnet-5-5', 'Sonnet 5.5', 'Faster and about half the cost. Default while testing.'),
                radio('brain', 'claude-opus-5-5', 'Opus 5.5', 'Deeper reasoning.'),
                check('fast', 'Opus fast mode', 'Up to 2.5× faster output at twice the price.', s.brain !== 'claude-opus-5-5'),
                '</fieldset>',
                '<fieldset><legend>Listening</legend>',
                radio('source', 'room', 'Room mic', v.deepgram ? 'Tells speakers apart (doctor, patient, family).' : 'Not available: the server has no speech key, so the browser\'s own recognition is used.'),
                radio('source', 'browser', 'Browser speech', 'No speaker labels; works without the server.'),
                '</fieldset>',
                '<fieldset><legend>When it speaks</legend>',
                check('chime', 'Chime on safety alerts'),
                check('speakAloud', 'Read answers and alerts aloud', 'Uses the computer\'s voice. Off by default with a patient in the room.'),
                '</fieldset>',
                '<fieldset><legend>Practice</legend><div class="lc-pop-row">',
                '<button type="button" class="lc-btn" data-act="replay" data-cmd="play">' + (v.replay && v.replay.active ? 'Restart' : 'Play') + ' Morrison demo</button>',
                '<select name="replaySpeed" class="lc-btn" aria-label="Demo speed">' + [1, 2, 4].map((x) => '<option value="' + x + '"' + (String(s.replaySpeed) === String(x) ? ' selected' : '') + '>' + x + '× speed</option>').join('') + '</select>',
                '</div></fieldset>',
                '<div class="lc-pop-row"><button type="button" class="lc-btn" data-act="prime">Re-read chart</button><button type="button" class="lc-btn" data-act="reset">New encounter</button><button type="button" class="lc-btn lc-btn-quiet" data-act="classic">Classic coworker</button></div>',
            ].join('');
        },
    };

    root.LivePanel = LivePanel;
})(typeof window !== 'undefined' ? window : globalThis);
