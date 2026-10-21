/**
 * Live Coworker: the panel UI (DOM only; no AI calls, no app state).
 *
 * Information architecture, top to bottom:
 *   1. Header: am I listening, am I checking (mic + status), how much may I
 *      speak (mode). When calls fail it says "not checking": silence must
 *      never look like "all clear".
 *   2. Safety alerts: pinned until acknowledged, newest in full, older ones
 *      folded to their first sentence. The only loud thing.
 *   3. My take: what matters most first; its summary and plan on request.
 *      It shrinks to one line while an alert waits.
 *   4. Conversation | Tracking | Log:
 *        Conversation: what it heard and what it said, in order, newest at the
 *              bottom, with a live caption of what it is hearing right now and
 *              the thoughts it is holding until asked.
 *        Tracking: its working memory (facts heard, your thinking, the plan,
 *              what it is watching for). Log: decisions, calls, cost.
 *   5. Ask box.
 * When the panel is wide, talk (alerts, conversation, ask) sits on the left and
 * thinking (take, tracking, log) on the right.
 *
 * LiveApp owns the state and calls render*(view) when something changes;
 * refreshTimes() keeps the "2m ago" labels current without re-rendering.
 */
(function (root) {
    'use strict';

    const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    // Model text: escape everything, then allow **bold** only.
    const rich = (s) => esc(s).replace(/\*\*([^*\n]{1,200})\*\*/g, '<b>$1</b>').replace(/(^|\s)\*([^*\n]{1,120})\*(?=\s|[.,;:!?]|$)/g, '$1$2');
    const svg = (paths, cls) => '<svg class="' + (cls || '') + '" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + paths + '</svg>';
    const ICON = {
        mic: svg('<path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" x2="12" y1="19" y2="22"/>'),
        more: svg('<circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/><circle cx="5" cy="12" r="1"/>'),
        alert: svg('<path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3"/><path d="M12 9v4"/><path d="M12 17h.01"/>', 'is-critical'),
        warn: svg('<circle cx="12" cy="12" r="10"/><line x1="12" x2="12" y1="8" y2="12"/><line x1="12" x2="12.01" y1="16" y2="16"/>'),
        bulb: svg('<path d="M15 14c.2-1 .7-1.7 1.5-2.5 1-.9 1.5-2.2 1.5-3.5A6 6 0 0 0 6 8c0 1 .2 2.2 1.5 3.5.7.7 1.3 1.5 1.5 2.5"/><path d="M9 18h6"/><path d="M10 22h4"/>', 'is-insight'),
        chat: svg('<path d="M7.9 20A9 9 0 1 0 4 16.1L2 22Z"/>'),
        chevron: svg('<path d="m6 9 6 6 6-6"/>'),
    };
    const MODE_HINT = {
        follow: 'Answers when you ask. Speaks up only for safety.',
        abreast: 'Keeps pace with you. Speaks up for safety; saves other thoughts.',
        lead: 'Thinks ahead. Speaks up for safety and for what you may have missed.',
    };
    const fmt = (ms) => { const s = Math.max(0, Math.round((ms || 0) / 1000)); return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'); };
    const ago = (ms) => {
        if (ms == null || !isFinite(ms)) return '';
        const s = Math.max(0, Math.round(ms / 1000));
        if (s < 10) return 'just now';
        if (s < 60) return s + 's ago';
        const m = Math.round(s / 60);
        return m < 60 ? m + 'm ago' : Math.round(m / 60) + 'h ago';
    };
    const secs = (ms) => (ms == null ? '' : (ms / 1000).toFixed(1) + ' s');
    const clockTime = (wall) => { try { return new Date(wall).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }); } catch (e) { return ''; } };
    // When something happened: "2m ago" on screen; the encounter clock, the
    // time of day and any detail (latency) in the tooltip.
    const when = (wall, t, extra) => {
        const title = [t != null ? fmt(t) + ' into the encounter' : '', wall ? clockTime(wall) : '', extra || ''].filter(Boolean).join(' · ');
        return '<time' + (wall ? ' data-wall="' + wall + '"' : '') + ' title="' + esc(title) + '">' + esc(wall ? ago(Date.now() - wall) : fmt(t)) + '</time>';
    };
    // An alert's first sentence is the action; the rest is the supporting fact.
    const splitLead = (s) => {
        const t = String(s || '').replace(/\*\*/g, '').trim();
        const m = t.match(/^(.{8,}?[.!?])\s+(?=["“(]?[A-Z0-9])/);
        return m ? [m[1], t.slice(m[0].length).trim()] : [t, ''];
    };

    // Note helpers: sentences, and a loose comparison key.
    const sentences = (t) => String(t || '').split(/(?<=[.!?])\s+(?=["“(]?[A-Z0-9])/).map((x) => x.trim()).filter(Boolean);
    const normText = (t) => String(t || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

    // Conversation pieces.
    const lineHtml = (l, flagged) => '<div class="lc-line' + (flagged ? ' is-flagged' : '') + '" data-speaker="' + esc(l.speaker) + '"><span class="lc-who">' + esc(l.label || l.speaker) + '</span><span class="lc-said">' + esc(l.text) + '</span></div>';
    const typedHtml = (q) => '<div class="lc-line is-typed" data-speaker="doctor"><span class="lc-who">You</span><span class="lc-said">' + esc(q) + '</span></div>';
    const interimHtml = (it) => '<div class="lc-line is-interim"' + (it ? '' : ' hidden') + ' data-speaker="' + esc(it ? it.speaker : '') + '"><span class="lc-who">' + esc(it ? it.speaker : '') + '</span><span class="lc-said">' + esc(it ? it.text : '') + '</span></div>';
    function itemHtml(s, isPinned) {
        const icon = s.kind === 'critical' ? ICON.alert : s.kind === 'insight' ? ICON.bulb : ICON.chat;
        const label = s.kind === 'critical' ? 'Safety' : s.kind === 'insight' ? 'Thought' : 'Coworker';
        const lat = s.latencyMs == null ? '' : (s.kind === 'answer' ? 'answered in ' : 'flagged ') + secs(s.latencyMs) + (s.kind === 'answer' ? '' : ' after it was said');
        return (s.via === 'typed' && s.question ? typedHtml(s.question) : '')
            + '<article class="lc-item is-' + esc(s.kind) + (isPinned ? ' is-pinned' : '') + '" data-id="' + esc(s.id) + '">'
            + '<div class="lc-item-meta">' + icon + '<span>' + label + '</span><span aria-hidden="true">·</span>' + when(s.wallAt, s.t, lat) + '</div>'
            + (isPinned
                ? '<p class="lc-a"><b>' + esc(splitLead(s.text)[0]) + '</b> <span class="lc-pin-note">Pinned above</span></p>'
                : '<p class="lc-a">' + rich(s.text) + '</p>' + (s.why && s.kind !== 'answer' ? '<p class="lc-why">' + esc(s.why) + '</p>' : ''))
            + (s.error && s.question ? '<button type="button" class="lc-btn" data-act="retry" data-q="' + esc(s.question) + '">Try again</button>' : '')
            + '</article>';
    }

    const LivePanel = {
        el: null,
        refs: {},
        handlers: {},
        tab: 'said',
        seenSaid: 0,

        mount(panel, handlers) {
            this.handlers = handlers || {};
            this._shown = new WeakSet();      // alerts already on screen (no entrance animation)
            this._announced = new WeakSet();  // items already read out to screen readers
            this._whyOpen = new Set();
            const radio = (mode, label) => '    <button type="button" role="radio" data-mode="' + mode + '" aria-checked="false" tabindex="-1" title="' + esc(MODE_HINT[mode]) + '">' + label + '</button>';
            const wrap = document.createElement('section');
            wrap.className = 'lc';
            wrap.id = 'live-coworker';
            wrap.setAttribute('aria-label', 'AI Coworker, live');
            wrap.innerHTML = [
                '<header class="lc-head">',
                '  <button type="button" class="lc-mic" data-act="mic" aria-pressed="false" title="Start listening">' + ICON.mic + '<span class="lc-sr">Listen</span></button>',
                '  <div class="lc-status-text"><span class="lc-state" data-ref="state">Ready</span><span class="lc-sub" data-ref="sub"></span></div>',
                '  <button type="button" class="lc-btn lc-end" data-act="end" data-ref="end" hidden>End encounter</button>',
                '  <button type="button" class="lc-iconbtn" data-act="settings" aria-haspopup="dialog" aria-expanded="false" title="Coworker settings">' + ICON.more + '<span class="lc-sr">Settings</span></button>',
                '  <div class="lc-enc" data-ref="enc"></div>',
                '  <div class="lc-modes" role="radiogroup" aria-label="How much the coworker speaks up">',
                radio('follow', 'Follow'),
                radio('abreast', 'Abreast'),
                radio('lead', 'Lead'),
                '  </div>',
                '  <p class="lc-mode-hint" data-ref="hint"></p>',
                '  <div class="lc-replay" data-ref="replay" hidden></div>',
                '</header>',
                '<div class="lc-sr" aria-live="assertive" data-ref="sayAlert"></div>',
                '<div class="lc-sr" aria-live="polite" data-ref="sayPolite"></div>',
                '<div class="lc-body">',
                '  <div class="lc-left">',
                '    <div class="lc-alerts" data-ref="alerts"></div>',
                '    <div class="lc-pane is-active" data-pane="said" role="tabpanel" aria-label="Conversation"><h3 class="lc-pane-title">Conversation</h3><div data-ref="said"></div><button type="button" class="lc-jump" data-act="jump" hidden>Latest ↓</button></div>',
                '    <form class="lc-ask" data-ref="ask" autocomplete="off">',
                '      <label class="lc-sr" for="lc-ask-input">Ask the coworker</label>',
                '      <input id="lc-ask-input" type="text" placeholder="Ask, or say “Coworker, …”" enterkeyhint="send">',
                '      <button type="submit" class="lc-btn lc-btn-primary">Ask</button>',
                '    </form>',
                '  </div>',
                '  <div class="lc-right">',
                '    <section class="lc-take" data-ref="take" data-open="false" aria-label="My take"></section>',
                '    <div class="lc-tabs" role="tablist" aria-label="Coworker views">',
                '      <button type="button" role="tab" data-tab="said" aria-selected="true">Conversation<span class="lc-count" data-ref="saidCount" hidden></span></button>',
                '      <button type="button" role="tab" data-tab="note" aria-selected="false" tabindex="-1">Note</button>',
                '      <button type="button" role="tab" data-tab="tracking" aria-selected="false" tabindex="-1">Tracking</button>',
                '      <button type="button" role="tab" data-tab="log" aria-selected="false" tabindex="-1">Log</button>',
                '    </div>',
                '    <div class="lc-pane" data-pane="note" role="tabpanel" aria-label="Live note"><h3 class="lc-pane-title">Live note</h3><div data-ref="note"></div></div>',
                '    <div class="lc-pane" data-pane="tracking" role="tabpanel" aria-label="Tracking"><h3 class="lc-pane-title">Tracking</h3><div data-ref="tracking"></div></div>',
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
                if (t.dataset.confirm && !this._confirm(t)) return;
                switch (act) {
                    case 'mic': return h.onMic && h.onMic();
                    case 'start': return h.onStart && h.onStart();
                    case 'end': return h.onEnd && h.onEnd();
                    case 'copy-note': return h.onCopyNote && h.onCopyNote();
                    case 'wide': return h.onWide && h.onWide();
                    case 'settings': return this.togglePop();
                    case 'ack': return h.onAck && h.onAck(t.dataset.id);
                    case 'unfold': return h.onUnfold && h.onUnfold(t.dataset.id);
                    case 'why': return this._toggleWhy(t);
                    case 'take-toggle': return h.onTakeToggle && h.onTakeToggle();
                    case 'tell': return h.onTellHeld && h.onTellHeld(t.dataset.topic);
                    case 'retry': return h.onRetry && h.onRetry(t.dataset.q);
                    case 'demo': return h.onReplay && h.onReplay('play');
                    case 'replay': return h.onReplay && h.onReplay(t.dataset.cmd);
                    case 'prime': return h.onPrime && h.onPrime();
                    case 'reset': return h.onReset && h.onReset();
                    case 'classic': return h.onClassic && h.onClassic();
                    case 'voice-test': return h.onVoiceTest && h.onVoiceTest();
                    case 'jump': { const pane = this.refs.said.parentElement; pane.scrollTop = pane.scrollHeight; this._jump(false); return undefined; }
                    default: return undefined;
                }
            });
            w.addEventListener('change', (ev) => {
                const t = ev.target;
                if (t.name && h.onSetting) h.onSetting(t.name, t.type === 'checkbox' ? t.checked : t.value);
            });
            this.refs.said.parentElement.addEventListener('scroll', (ev) => {
                const pane = ev.currentTarget;
                if (pane.scrollHeight - pane.scrollTop - pane.clientHeight < 80) this._jump(false);
            }, { passive: true });
            this.refs.ask.addEventListener('submit', (ev) => {
                ev.preventDefault();
                const q = this.refs.input.value.trim();
                if (!q) return;
                this.refs.input.value = '';
                if (h.onAsk) h.onAsk(q);
                this.showTab('said');
            });
            w.addEventListener('keydown', (ev) => {
                if (ev.key === 'Escape' && !this.refs.pop.hidden) { this.togglePop(false); this.refs.settingsBtn.focus(); return; }
                const role = ev.target.getAttribute && ev.target.getAttribute('role');
                const step = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[ev.key];
                if (!step || (role !== 'tab' && role !== 'radio')) return;
                if (role === 'tab' && (ev.key === 'ArrowUp' || ev.key === 'ArrowDown')) return;
                ev.preventDefault();
                const group = [...w.querySelectorAll(role === 'tab' ? '[role="tab"]' : '.lc-modes [role="radio"]')];
                const n = group[(group.indexOf(ev.target) + step + group.length) % group.length];
                n.focus();
                if (role === 'tab') this.showTab(n.dataset.tab);
                else if (h.onMode) h.onMode(n.dataset.mode);
            });
            document.addEventListener('click', (ev) => {
                if (!this.el || this.refs.pop.hidden) return;
                if (!this.refs.pop.contains(ev.target) && !this.refs.settingsBtn.contains(ev.target)) this.togglePop(false);
            });
        },

        // Anything that clears an encounter asks once, inline: the first click arms the button.
        _confirm(t) {
            if (t.classList.contains('is-armed')) {
                clearTimeout(t._lcArm);
                t.classList.remove('is-armed');
                if (t.dataset.label) t.innerHTML = t.dataset.label;
                return true;
            }
            t.dataset.label = t.innerHTML;
            t.textContent = t.dataset.confirm;
            t.classList.add('is-armed');
            t._lcArm = setTimeout(() => { t.classList.remove('is-armed'); t.innerHTML = t.dataset.label; }, 4000);
            return false;
        },

        _toggleWhy(btn) {
            const id = btn.dataset.id;
            if (this._whyOpen.has(id)) this._whyOpen.delete(id); else this._whyOpen.add(id);
            const box = btn.closest('.lc-alert');
            const why = box && box.querySelector('.lc-alert-why');
            const open = this._whyOpen.has(id);
            if (why) why.hidden = !open;
            btn.textContent = open ? 'Hide why' : 'Why?';
            btn.setAttribute('aria-expanded', String(open));
        },

        _announce(kind, text) {
            const n = kind === 'alert' ? this.refs.sayAlert : this.refs.sayPolite;
            if (!n || !text) return;
            n.textContent = '';
            setTimeout(() => { n.textContent = text; }, 60);
        },

        showTab(name) {
            this.tab = name;
            this.el.querySelectorAll('[role="tab"]').forEach((b) => { const on = b.dataset.tab === name; b.setAttribute('aria-selected', String(on)); b.tabIndex = on ? 0 : -1; });
            this.el.querySelectorAll('.lc-pane').forEach((p) => p.classList.toggle('is-active', p.dataset.pane === name));
            if (name === 'said') { const pane = this.refs.said.parentElement; pane.scrollTop = pane.scrollHeight; this._jump(false); }
            if (name === 'said' && this.refs.saidCount) { this.refs.saidCount.hidden = true; this.seenSaid = this._saidTotal || 0; }
            if (this.handlers.onTab) this.handlers.onTab(name);
        },

        togglePop(force) {
            const pop = this.refs.pop;
            const open = force == null ? pop.hidden : !!force;
            pop.hidden = !open;
            this.refs.settingsBtn.setAttribute('aria-expanded', String(open));
            if (open) { this._focusPop = true; if (this.handlers.onOpenSettings) this.handlers.onOpenSettings(); }
        },

        /** Keep "2m ago" labels current (called once a second; touches text only). */
        refreshTimes(now) {
            if (!this.el) return;
            const t0 = now || Date.now();
            this.el.querySelectorAll('time[data-wall]').forEach((n) => {
                const s = ago(t0 - Number(n.dataset.wall));
                if (s && n.textContent !== s) n.textContent = s;
            });
        },

        // ── header ───────────────────────────────────────────────────────
        renderHead(v) {
            const r = this.refs;
            const st = v.status;
            if (r.state.textContent !== st.label) r.state.textContent = st.label;
            r.state.classList.toggle('is-degraded', st.state === 'degraded');
            // Rewrite the line only when it changes, so an armed link keeps its state.
            const subHtml = st.subHtml || esc(st.sub || '');
            if (r.sub._lcHtml !== subHtml) { r.sub.innerHTML = subHtml; r.sub._lcHtml = subHtml; }
            r.sub.title = st.sub || '';
            const on = st.state === 'listening' || (st.state === 'degraded' && !!st.listening);
            const e = v.encounter;
            const live = !!e && e.state !== 'ended';
            r.mic.setAttribute('aria-pressed', String(on));
            r.mic.dataset.state = st.state;
            r.mic.title = !live ? 'Start the encounter' : e.kind === 'demo' ? (on || st.state === 'replaying' ? 'Pause the demo' : 'Resume the demo') : on ? 'Pause listening' : 'Resume listening';
            // The encounter: one clear way in ("Start encounter"), and a way out ("End").
            r.end.hidden = !live;
            r.end.textContent = e && e.kind === 'demo' ? 'Stop demo' : 'End encounter';
            const startHtml = live ? '' : '<button type="button" class="lc-start" data-act="start"' + (v.canStart ? '' : ' disabled')
                + (e && e.state === 'ended' && v.note ? ' data-confirm="Clear this note and start over?"' : '') + '>' + ICON.mic
                + '<span>' + (e && e.state === 'ended' ? 'Start a new encounter' : 'Start encounter') + '</span></button>';
            if (r.enc._lcHtml !== startHtml) { r.enc.innerHTML = startHtml; r.enc._lcHtml = startHtml; }
            r.enc.hidden = !startHtml;
            this.el.querySelectorAll('.lc-modes [role="radio"]').forEach((b) => {
                const sel = b.dataset.mode === v.mode;
                b.setAttribute('aria-checked', String(sel));
                b.tabIndex = sel ? 0 : -1;
            });
            const hint = MODE_HINT[v.mode] || '';
            if (r.hint.textContent !== hint) r.hint.textContent = hint;
        },

        renderReplay(v) {
            const rp = v.replay;
            const el = this.refs.replay;
            if (!rp || !rp.active) { el.hidden = true; el.innerHTML = ''; return; }
            el.hidden = false;
            const pct = rp.duration ? Math.min(100, (rp.t / rp.duration) * 100) : 0;
            el.innerHTML = '<span class="lc-track" role="progressbar" aria-label="Demo progress" aria-valuemin="0" aria-valuemax="' + Math.round(rp.duration) + '" aria-valuenow="' + Math.round(rp.t) + '"><i style="width:' + pct.toFixed(1) + '%"></i></span><span>' + fmt(rp.t * 1000) + ' / ' + fmt(rp.duration * 1000) + '</span>'
                + (rp.finished
                    ? '<button type="button" data-act="replay" data-cmd="restart">Play again</button><button type="button" data-act="replay" data-cmd="stop">Close</button>'
                    : '<button type="button" data-act="replay" data-cmd="' + (rp.playing ? 'pause' : 'play') + '">' + (rp.playing ? 'Pause' : 'Resume') + '</button>'
                      + '<button type="button" data-act="replay" data-cmd="stop">Stop</button>');
        },

        // ── alerts (and the "not checking" warning) ──────────────────────
        renderAlerts(v) {
            const el = this.refs.alerts;
            const items = v.alerts || [];
            const hv = v.health || {};
            const parts = [];
            if (hv.degraded) {
                parts.push('<div class="lc-warn" role="status">' + ICON.warn + '<p><b>Not checking right now.</b> ' + esc(hv.reason || '')
                    + ' Still listening; safety checks resume when the AI answers again.</p></div>');
            }
            if (!items.length) this._whyOpen.clear();
            items.forEach((a, i) => {
                // Newest in full; older ones fold to their first sentence until opened.
                const folded = i > 0 && !(v.openAlerts && v.openAlerts[a.id]);
                const [lead, rest] = splitLead(a.text);
                const hasWhy = !!(a.why || a.cueText);
                const whyOpen = this._whyOpen.has(a.id);
                const lat = a.latencyMs != null ? 'flagged ' + secs(a.latencyMs) + ' after it was said' : '';
                const open = '<article class="lc-alert' + (folded ? ' is-folded' : '') + (this._shown.has(a) ? ' is-seen' : '') + '" data-id="' + esc(a.id) + '" aria-label="Safety alert">';
                if (folded) {
                    parts.push(open + '<button type="button" class="lc-alert-line" data-act="unfold" data-id="' + esc(a.id) + '" title="' + esc(a.text) + '">'
                        + ICON.alert + '<span>' + esc(lead) + '</span>' + when(a.wallAt, a.t, lat) + '</button></article>');
                    return;
                }
                parts.push(open
                    + '<div class="lc-alert-top">' + ICON.alert + '<span>Safety</span>' + when(a.wallAt, a.t, lat) + '</div>'
                    + '<div class="lc-alert-body">'
                    + '<p class="lc-alert-text"><strong>' + esc(lead) + '</strong> ' + esc(rest) + '</p>'
                    + (hasWhy ? '<p class="lc-alert-why"' + (whyOpen ? '' : ' hidden') + '>' + esc(a.why || '') + (a.cueText ? ' Heard: <q>' + esc(a.cueText) + '</q>' : '') + '</p>' : '')
                    + '<div class="lc-alert-actions"><button type="button" class="lc-btn lc-btn-primary" data-act="ack" data-id="' + esc(a.id) + '">Got it</button>'
                    + (hasWhy ? '<button type="button" class="lc-btn lc-btn-quiet" data-act="why" data-id="' + esc(a.id) + '" aria-expanded="' + whyOpen + '">' + (whyOpen ? 'Hide why' : 'Why?') + '</button>' : '')
                    + '</div></div></article>');
            });
            el.innerHTML = parts.join('');
            for (const a of items) {
                if (!this._announced.has(a)) { this._announced.add(a); this._announce('alert', 'Safety alert. ' + a.text); }
                this._shown.add(a);
            }
        },

        // ── take ─────────────────────────────────────────────────────────
        renderTake(v) {
            const el = this.refs.take;
            const t = v.take;
            const open = v.takeOpen === true;
            const follow = v.mode === 'follow';
            const lead = v.mode === 'lead';
            // One line only in Follow, and while a safety alert waits (more on request).
            const quiet = !!t && (follow || ((v.alerts || []).length > 0 && !open));
            el.dataset.open = String(open);
            el.classList.toggle('is-quiet', quiet);
            const concerns = t ? (t.concerns || []).slice(0, 4) : [];
            const next = t ? (t.next || []) : [];
            // The problem representation from the live note, once there is one (fuller than the one-liner).
            const pr = v.note && v.note.problem_representation ? v.note.problem_representation : '';
            const prChanged = !!pr && !!this._takePr && this._takePr !== pr;
            this._takePr = pr || this._takePr;
            // A difference only means something once the doctor has said what they think.
            const differs = t && t.doctor_view && t.differs ? t.differs : '';
            // Behind the toggle: the summary line (when concerns lead), the assessment, the plan.
            const more = t && !follow ? [
                !pr && concerns.length && t.one_liner ? '<p class="lc-one">' + esc(t.one_liner) + '</p>' : '',
                t.assessment ? '<p class="lc-assess">' + esc(t.assessment) + '</p>' : '',
                !lead && differs ? '<p class="lc-differs"><b>Where I differ:</b> ' + esc(differs) + '</p>' : '',
                next.length ? '<div><span class="lc-label">Next I would</span><ul class="lc-next">' + next.map((x) => '<li>' + esc(x) + '</li>').join('') + '</ul></div>' : '',
            ].join('') : '';
            const hasMore = !follow && (!!more || (quiet && concerns.length > 0));
            const chip = t && !follow
                ? (differs ? '<span class="lc-chip is-differs">I see it differently</span>' : (t.doctor_view ? '<span class="lc-chip">With you</span>' : ''))
                : '';
            const head = '<div class="lc-take-head"><span class="lc-label">My take</span>'
                + (t ? when(t.at, null) : '') + chip
                + (hasMore ? '<button type="button" class="lc-iconbtn" data-act="take-toggle" aria-expanded="' + open + '" title="' + (open ? 'Show less' : 'Show more') + '">' + ICON.chevron + '<span class="lc-sr">' + (open ? 'Show less' : 'Show more') + '</span></button>' : '')
                + '</div>';
            if (!t) {
                el.innerHTML = head + (v.takeLoading
                    ? '<span class="lc-skel"></span><span class="lc-skel"></span><span class="lc-skel"></span><p class="lc-take-empty">Reading the chart…</p>'
                    : '<p class="lc-take-empty">No take yet. It forms as soon as I read the chart. <button type="button" class="lc-btn lc-btn-quiet" data-act="prime">Read it now</button></p>');
                return;
            }
            if (quiet) {
                // Side by side, the note already shows the problem representation: lead with the top worry.
                const line = v.wide && concerns.length ? concerns[0].text : (pr || t.one_liner);
                el.innerHTML = head + '<p class="lc-one" title="' + esc(line) + '">' + esc(line) + '</p>';
                return;
            }
            const list = concerns.map((c) => '<li><span class="lc-dot ' + esc(c.severity) + '" title="' + esc(c.severity) + '"></span><span title="' + esc(c.text) + '">' + esc(c.text) + '</span></li>').join('');
            el.innerHTML = head
                + (pr ? '<p class="lc-take-pr' + (prChanged ? ' lc-changed' : '') + '">' + esc(pr) + '</p>' : '')
                + (lead && differs ? '<p class="lc-differs"><b>Where I differ:</b> ' + esc(differs) + '</p>' : '')
                + (list ? '<ul class="lc-concerns" aria-label="What matters most">' + list + '</ul>' : (pr ? '' : '<p class="lc-one">' + esc(t.one_liner) + '</p>'))
                + (more ? '<div class="lc-take-more">' + more + '</div>' : '');
        },

        // ── conversation: what it heard and what it said, in order ──────
        // Oldest at the top, newest at the bottom (like a chat), with the line
        // being heard right now as a live caption. Follows the latest unless the
        // doctor has scrolled up; then a "Latest" button appears.
        renderSaid(v) { this.renderConversation(v); },
        renderTranscript(v) { this.renderConversation(v); },

        renderConversation(v) {
            const el = this.refs.said;
            const pane = el.parentElement;
            const atBottom = pane.scrollHeight - pane.scrollTop - pane.clientHeight < 80;
            const pinned = new Set((v.alerts || []).map((a) => a.id));
            const said = v.said || [];          // newest first
            const lines = v.lines || [];
            const streaming = Object.entries(v.streaming || {});
            const held = v.held || [];
            this._saidTotal = said.length;
            for (const s of said) {             // screen readers hear each new answer or thought once
                if (s.kind === 'critical' || this._announced.has(s)) continue;
                this._announced.add(s);
                this._announce('polite', (s.kind === 'answer' ? 'Answer. ' : 'Thought. ') + s.text);
            }
            if (!lines.length && !said.length && !streaming.length && !held.length && !v.interim) {
                el.innerHTML = '<p class="lc-empty">' + (v.mode === 'lead'
                    ? 'I’ll answer when you ask (say <b>“Coworker, …”</b> or type below), flag anything unsafe, and point out what you might be missing.'
                    : 'I’ll answer when you ask (say <b>“Coworker, …”</b> or type below) and speak up only for safety issues.')
                    + ' What I hear and what I say show up here, in order.</p>';
                this._lastConvo = 0;
                this._jump(false);
                this._updateCount();
                return;
            }
            const flagged = new Set(said.filter((s) => s.kind !== 'answer' && s.cueLine).map((s) => s.cueLine));
            const events = lines.map((l, i) => ({ t: l.t || 0, order: 0, seq: i, html: lineHtml(l, flagged.has(l.id)) }))
                .concat(said.map((s, i) => ({ t: s.t || 0, order: 1, seq: said.length - i, html: itemHtml(s, pinned.has(s.id)) })));
            events.sort((a, b) => (a.t - b.t) || (a.order - b.order) || (a.seq - b.seq));
            const parts = events.map((e) => e.html);
            for (const [id, st] of streaming) {
                parts.push((st.via === 'typed' && st.question ? typedHtml(st.question) : '')
                    + '<article class="lc-item is-answer" data-id="' + esc(id) + '"><div class="lc-item-meta">' + ICON.chat + '<span>Coworker</span></div>'
                    + (st.text ? '<p class="lc-a is-streaming">' + esc(st.text) + '</p>' : '<p class="lc-status-line">' + esc(st.status || 'Thinking…') + '</p>')
                    + '</article>');
            }
            parts.push(interimHtml(v.interim));
            el.innerHTML = '<div class="lc-convo">' + parts.join('') + '</div>'
                + (held.length
                    ? '<details class="lc-held"' + (v.heldOpen ? ' open' : '') + '><summary>' + (held.length === 1 ? '1 thought ready if you want it' : held.length + ' thoughts ready if you want them') + '</summary><ul>'
                      + held.map((x) => '<li><span>' + esc(x.text) + '</span><button type="button" class="lc-btn" data-act="tell" data-topic="' + esc(x.topic) + '">Tell me</button></li>').join('')
                      + '</ul></details>'
                    : '');
            const count = lines.length + said.length + streaming.length;
            const grew = count > (this._lastConvo || 0);
            this._lastConvo = count;
            if (atBottom || !this._convoShown) { pane.scrollTop = pane.scrollHeight; this._jump(false); }
            else if (grew) this._jump(true);
            this._convoShown = true;
            this._updateCount();
        },

        /** Live caption: update only the line being heard right now (several times a second). */
        setInterim(it) {
            const el = this.refs.said && this.refs.said.querySelector('.lc-line.is-interim');
            if (!el) return false;
            const pane = this.refs.said.parentElement;
            const atBottom = pane.scrollHeight - pane.scrollTop - pane.clientHeight < 80;
            el.hidden = !it;
            if (it) { el.dataset.speaker = it.speaker; el.firstChild.textContent = it.speaker; el.lastChild.textContent = it.text; }
            if (atBottom) pane.scrollTop = pane.scrollHeight;
            return true;
        },

        _jump(show) { const b = this.el && this.el.querySelector('.lc-jump'); if (b) b.hidden = !show; },

        /** Fast path while an answer streams in: touch only that item. */
        streamText(id, text, status) {
            const el = this.refs.said;
            const item = el.querySelector('.lc-item[data-id="' + CSS.escape(id) + '"]');
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
                return '<div class="lc-group"><h4>' + title + '</h4><ul>' + fs.map((f) => '<li' + fresh(f.t) + '><span class="lc-tag">' + esc(f.from === 'other' ? 'family' : f.from) + '</span><span>' + esc(f.text) + '</span></li>').join('') + '</ul></div>';
            };
            const parts = [];
            parts.push(factGroup('Story and symptoms', ['symptom', 'history', 'social', 'other']));
            parts.push(factGroup('Medicines and allergies', ['medication', 'allergy']));
            parts.push(factGroup('Exam and results', ['exam', 'data']));
            if (wm.thinking.length) parts.push('<div class="lc-group"><h4>Your thinking</h4><ul>' + wm.thinking.map((x) => '<li' + fresh(x.t) + '><span class="lc-tag">' + fmt(x.t) + '</span><span class="lc-quote">' + esc(x.text) + '</span></li>').join('') + '</ul></div>');
            if (wm.plan.length) parts.push('<div class="lc-group"><h4>Plan and orders</h4><ul>' + wm.plan.map((x) => '<li' + fresh(x.t) + '><span class="lc-tag">' + esc(x.kind) + '</span><span>' + esc(x.text) + '</span></li>').join('') + '</ul></div>');
            if (wm.watch.length) parts.push('<div class="lc-group"><h4>Watching for</h4><ul>' + wm.watch.map((w) => '<li title="' + esc('If it happens: ' + w.alert) + '"><span class="lc-tag ' + (w.severity === 'critical' ? 'critical' : '') + '">' + (w.severity === 'critical' ? 'safety' : 'note') + '</span><span>' + esc(w.trigger) + '</span></li>').join('') + '</ul></div>');
            const body = parts.filter(Boolean).join('');
            el.innerHTML = (body || '<p class="lc-empty">Nothing heard yet. Facts, your thinking and the plan collect here as you talk.</p>')
                + (v.memoryNote ? '<p class="lc-empty">' + esc(v.memoryNote) + '</p>' : '');
        },

        // ── live note ────────────────────────────────────────────────────
        // Problem representation, HPI, assessment and plan by problem, rewritten as
        // people talk. Whatever is new since the last version lights up briefly.
        renderNote(v) {
            const el = this.refs.note;
            const n = v.note;
            const status = v.noteWriting ? '<span class="lc-writing">Updating…</span>' : (n ? 'Updated ' + when(n.wallAt, null) : '');
            const head = '<div class="lc-note-head"><span class="lc-note-status" data-ref-note-status>' + status + '</span><span class="lc-note-tools">'
                + (n ? '<button type="button" class="lc-btn lc-btn-quiet" data-act="copy-note">Copy note</button>' : '')
                + '<button type="button" class="lc-btn lc-btn-quiet" data-act="wide">' + (v.wide ? 'Narrow panel' : 'Side by side') + '</button></span></div>';
            if (n && n === this._shownNote) {   // same note: only the status changed; keep the highlights running
                const st = el.querySelector('[data-ref-note-status]');
                const wb = el.querySelector('[data-act="wide"]');
                if (wb) wb.textContent = v.wide ? 'Narrow panel' : 'Side by side';
                if (st) { st.innerHTML = status; return; }
            }
            if (!n) {
                const e = v.encounter;
                el.innerHTML = head + '<p class="lc-empty">' + (e
                    ? 'Writing the first version…'
                    : 'Start the encounter and the note writes itself as you talk: a problem representation, the HPI, and assessment and plan by problem.') + '</p>';
                this._shownNote = null;
                return;
            }
            const was = this._shownNote;
            const isNew = (set, x) => !!was && !set.has(normText(x));
            const prBefore = new Set(was ? sentences(was.problem_representation).map(normText) : []);
            const hpiBefore = new Set(was ? sentences(was.hpi).map(normText) : []);
            const mark = (list, before) => list.map((x) => '<span' + (isNew(before, x) ? ' class="lc-changed"' : '') + '>' + esc(x) + '</span>').join(' ');
            const oldProblems = new Map((was ? was.problems || [] : []).map((p) => [normText(p.name), p]));
            const problems = (n.problems || []).map((p, i) => {
                const old = oldProblems.get(normText(p.name));
                const fresh = !!was && !old;
                const planBefore = new Set(old ? (old.plan || []).map(normText) : []);
                const considerBefore = new Set(old ? (old.consider || []).map(normText) : []);
                const plan = p.plan || [], consider = p.consider || [];
                return '<li class="lc-problem' + (fresh ? ' lc-changed' : '') + '"><div class="lc-problem-name"><span class="lc-problem-num">' + (i + 1) + '</span><span>' + esc(p.name) + '</span></div>'
                    + (p.assessment ? '<p class="lc-problem-assess' + (old && normText(old.assessment) !== normText(p.assessment) ? ' lc-changed' : '') + '">' + esc(p.assessment) + '</p>' : '')
                    + (plan.length
                        ? '<ul class="lc-plan">' + plan.map((x) => '<li' + (!fresh && isNew(planBefore, x) ? ' class="lc-changed"' : '') + '>' + esc(x) + '</li>').join('') + '</ul>'
                        : '<p class="lc-plan-empty">No plan stated yet</p>')
                    + (consider.length ? '<ul class="lc-consider">' + consider.map((x) => '<li' + (!fresh && isNew(considerBefore, x) ? ' class="lc-changed"' : '') + '><b>Consider</b> ' + esc(x) + '</li>').join('') + '</ul>' : '')
                    + '</li>';
            }).join('');
            el.innerHTML = head
                + '<section class="lc-note-sec"><h4>Problem representation</h4><p class="lc-pr">' + mark(sentences(n.problem_representation), prBefore) + '</p></section>'
                + '<section class="lc-note-sec"><h4>History of present illness</h4>' + (n.hpi ? '<p class="lc-hpi">' + mark(sentences(n.hpi), hpiBefore) + '</p>' : '<p class="lc-empty">Fills in as the history is told.</p>') + '</section>'
                + '<section class="lc-note-sec"><h4>Assessment and plan</h4>' + (problems ? '<ol class="lc-problems">' + problems + '</ol>' : '<p class="lc-empty">Problems and plans appear as you discuss them.</p>') + '</section>';
            this._shownNote = n;
        },

        // ── log ──────────────────────────────────────────────────────────
        renderLog(v) {
            const el = this.refs.log;
            const st = v.stats;
            if (!st || !st.calls) { el.innerHTML = '<p class="lc-empty">No AI calls yet.</p>' + (v.memoryNote ? '<p class="lc-empty">' + esc(v.memoryNote) + '</p>' : ''); return; }
            const med = (a) => { if (!a || !a.length) return null; const s = a.slice().sort((x, y) => x - y); return s[Math.floor(s.length / 2)]; };
            const LANE = { ear: 'Ear (listens)', answer: 'Answers', verify: 'Safety checks', update: 'Take updates', prime: 'Chart read', helper: 'Helpers' };
            const rows = Object.entries(st.byLane).map(([k, b]) => '<tr><td>' + esc(LANE[k] || k) + '</td><td>' + b.calls + (b.errors ? ' (' + b.errors + ' failed)' : '') + '</td><td>' + secs(med(b.ms)) + '</td><td>$' + b.cost.toFixed(3) + '</td></tr>').join('');
            const calls = (v.calls || []).slice(-14).reverse().map((c) => {
                const u = c.usage || {};
                const cached = u.cache_read_input_tokens || 0;
                const inTok = (u.input_tokens || 0) + (u.cache_creation_input_tokens || 0) + cached;
                return '<div class="' + (c.ok ? '' : 'is-err') + '">' + fmt(c.at) + ' · ' + esc(c.lane) + ' · ' + esc(String(c.model).replace('claude-', '')) + ' · '
                    + (c.ok ? secs(c.ms.total) + ' · ' + Math.round(inTok / 100) / 10 + 'k in (' + (inTok ? Math.round((cached / inTok) * 100) : 0) + '% cached) · ' + (u.output_tokens || 0) + ' out · $' + (c.cost || 0).toFixed(4) + (c.fellBack ? ' · fallback ' + esc(c.servedBy) : '') + (c.refusal ? ' · declined (' + esc(c.refusal) + ')' : '') : 'failed: ' + esc(c.error)) + '</div>';
            }).join('');
            const DEC = { say: 'Said', wait: 'Waited', quiet: 'Kept quiet', suppressed: 'Held back' };
            const decisions = (v.decisions || []).slice(-12).reverse().map((d) => '<li><span class="lc-tag ' + (d.decision === 'say' ? 'critical' : '') + '">' + esc(DEC[d.decision] || d.decision) + (d.followUp ? ' (2nd look)' : '') + '</span><span><b>' + fmt(d.at) + '</b> ' + esc(String(d.reason).slice(0, 140)) + (d.why ? '<br><span class="lc-why">' + esc(String(d.why).slice(0, 200)) + '</span>' : '') + '</span></li>').join('');
            el.innerHTML = (decisions ? '<div class="lc-group"><h4>Recent decisions</h4><ul>' + decisions + '</ul></div><div class="lc-group"><h4>Calls</h4></div>' : '')
                + '<table class="lc-table"><thead><tr><th>Lane</th><th>Calls</th><th>Median</th><th>Cost</th></tr></thead><tbody>' + rows
                + '<tr><td><b>Total</b></td><td><b>' + st.calls + '</b></td><td></td><td><b>$' + st.cost.toFixed(3) + '</b></td></tr></tbody></table>'
                + '<div class="lc-calls">' + calls + '</div>'
                + (v.memoryNote ? '<p class="lc-empty">' + esc(v.memoryNote) + '</p>' : '');
        },

        // ── settings popover ─────────────────────────────────────────────
        renderSettings(v) {
            const s = v.settings;
            const busy = (v.lines || []).length > 0 || (v.said || []).length > 0;
            const confirm = (text) => (busy ? ' data-confirm="' + esc(text) + '"' : '');
            const radio = (name, value, label, hint) => '<label class="lc-opt"><input type="radio" name="' + name + '" value="' + value + '"' + (s[name] === value ? ' checked' : '') + '><span>' + label + (hint ? '<small>' + hint + '</small>' : '') + '</span></label>';
            const check = (name, label, hint, disabled) => '<label class="lc-opt"><input type="checkbox" name="' + name + '"' + (s[name] ? ' checked' : '') + (disabled ? ' disabled' : '') + '><span>' + label + (hint ? '<small>' + hint + '</small>' : '') + '</span></label>';
            this.refs.pop.innerHTML = [
                '<fieldset><legend>Thinking model</legend>',
                radio('brain', 'claude-sonnet-5-5', 'Sonnet 5.5', 'Faster and about half the cost. Default while testing.'),
                radio('brain', 'claude-opus-5-5', 'Opus 5.5', 'Deeper reasoning.'),
                check('fast', 'Opus fast mode', 'Up to 2.5× faster output at twice the price.', s.brain !== 'claude-opus-5-5'),
                '</fieldset>',
                '<fieldset><legend>Listening</legend>',
                radio('source', 'room', 'Room mic', v.deepgram ? 'Medical speech model: tells speakers apart and listens for this patient’s drug names.' : 'Not available: the server has no speech key, so the browser’s own recognition is used.'),
                radio('source', 'browser', 'Browser speech', 'No speaker labels; works without the server.'),
                '</fieldset>',
                '<fieldset><legend>When it speaks</legend>',
                check('chime', 'Chime on safety alerts'),
                check('speakAloud', 'Read answers and alerts aloud', v.canSpeak ? 'Uses this computer’s voice. Stops when you start talking; the mic ignores it. Off by default with a patient in the room.' : 'This browser can’t speak.', !v.canSpeak),
                (v.canSpeak && s.speakAloud
                    ? '<div class="lc-pop-row lc-voice"><select name="voice" class="lc-btn" aria-label="Voice"><option value="">Best voice' + (v.voices && v.voices[0] ? ' (' + esc(v.voices[0].name) + ')' : '') + '</option>'
                      + (v.voices || []).slice(0, 25).map((x) => '<option value="' + esc(x.name) + '"' + (s.voice === x.name ? ' selected' : '') + '>' + esc(x.name) + '</option>').join('')
                      + '</select><button type="button" class="lc-btn" data-act="voice-test">Test</button></div>'
                    : ''),
                check('glasses', 'Show them on the G2 glasses', 'Through the glasses bridge, when it is set up.'),
                '</fieldset>',
                '<fieldset><legend>Practice</legend><div class="lc-pop-row">',
                '<button type="button" class="lc-btn" data-act="replay" data-cmd="play"' + confirm('Clear and play?') + '>' + (v.replay && v.replay.active ? 'Restart' : 'Play') + ' Morrison demo</button>',
                '<select name="replaySpeed" class="lc-btn" aria-label="Demo speed">' + [1, 2, 4].map((x) => '<option value="' + x + '"' + (String(s.replaySpeed) === String(x) ? ' selected' : '') + '>' + x + '× speed</option>').join('') + '</select>',
                '</div></fieldset>',
                '<div class="lc-pop-row"><button type="button" class="lc-btn" data-act="prime">Re-read chart</button><button type="button" class="lc-btn" data-act="reset"' + confirm('Clear this encounter?') + '>New encounter</button><button type="button" class="lc-btn lc-btn-quiet" data-act="classic">Classic coworker</button></div>',
            ].join('');
            if (this._focusPop && !this.refs.pop.hidden) {
                this._focusPop = false;
                const first = this.refs.pop.querySelector('input:checked, input, button');
                if (first) first.focus();
            }
        },
    };

    root.LivePanel = LivePanel;
})(typeof window !== 'undefined' ? window : globalThis);
