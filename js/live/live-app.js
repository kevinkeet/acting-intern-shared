/**
 * Live Coworker: browser glue. Full-site door only (loaded by the guarded
 * loader at the end of js/components/ai-coworker.js).
 *
 * Connects the engine (LiveCore) to the chart (LiveChart via the app's
 * dataLoader), the memory (LiveMemory: the frozen full Deep Learn fixture if
 * present, else the patient's current AI memory), the AI route (ClaudeAPI's
 * endpoint and headers, so the full-site door uses /api/claude-full), the
 * inputs (room mic via DeepgramClient, browser speech, the Morrison demo
 * replay, the ask box), and the panel (LivePanel).
 */
(function () {
    'use strict';

    const STORE = 'live-coworker';
    // This file's own version query: files loaded later (the about sheet) use the same one.
    const SELF_Q = (() => { try { const src = document.currentScript && document.currentScript.src; return src && src.indexOf('?') > 0 ? src.split('?')[1] : 'v=' + Date.now(); } catch (e) { return ''; } })();
    const DEMO = { file: 'data/live/morrison-admission-01.json', patient: 'PAT001', title: 'Morrison admission' };
    const MODE_TO_OLD = { follow: 'reactive', abreast: 'active', lead: 'proactive' };
    const OLD_TO_MODE = { reactive: 'follow', active: 'abreast', proactive: 'lead' };
    const BRAIN_LABEL = { 'claude-sonnet-5-5': 'Sonnet 5.5', 'claude-opus-5-5': 'Opus 5.5' };
    const SPEAKER_LABEL = { doctor: 'Doctor', patient: 'Patient', other: 'Other', unknown: 'Voice', wife: 'Wife', nurse: 'Nurse', ehr: 'Order' };
    // A failed call's reason in a few plain words, for the "not checking" status.
    const plainError = (msg) => {
        const m = String(msg || '');
        if (/\b529\b|overload/i.test(m)) return 'the service is overloaded';
        if (/\b429\b|rate/i.test(m)) return 'rate limited';
        if (/\b40[13]\b|api key|auth/i.test(m)) return 'a key problem on the server';
        if (/reach|fetch|network|offline|cut off|stream error/i.test(m)) return 'no connection';
        return m ? m.replace(/^AI call failed\s*/i, '').slice(0, 60) : 'no reply';
    };

    const LiveApp = {
        enabled: false,
        engine: null,
        chart: null,
        memory: null,
        patientId: null,
        health: null,
        settings: null,
        view: null,
        _mic: null,
        _replay: null,
        _renderQueued: new Set(),
        _ticker: null,
        dictating: null,            // 'exam' while the doctor dictates the physical exam

        // ── start-up ─────────────────────────────────────────────────────
        init() {
            if (this._inited) return;
            this._inited = true;
            this.settings = Object.assign({ brain: 'claude-sonnet-5-5', mode: null, fast: false, source: 'room', chime: true, speakAloud: false, voice: '', glasses: false, replaySpeed: 2, classic: false, radarOpen: null }, this._load());
            if (!this.settings.mode) {
                let old = null;
                try { old = typeof AIModeConfig !== 'undefined' && AIModeConfig.getMode && AIModeConfig.getMode(); } catch (e) { /* ignore */ }
                this.settings.mode = OLD_TO_MODE[old && (old.id || old)] || 'abreast';
            }
            this.view = this._freshView();
            this._fetchHealth();
            if (typeof LiveVoice !== 'undefined' && LiveVoice.supported()) {
                this._applyVoice();
                LiveVoice.onError = (reason) => {
                    if (reason === 'not-allowed') this._flash('Click anywhere on the page once so the coworker can speak.');
                    if (reason === 'deepgram-unavailable') this._flash('The natural voice isn\'t available right now; using this computer\'s voice.');
                };
                // Browsers load their voice list late; refresh the settings when it arrives.
                window.speechSynthesis.addEventListener('voiceschanged', () => this.request('settings'));
            }
            const panel = document.getElementById('ai-panel');
            if (!panel) return;
            LivePanel.mount(panel, this._handlers());
            this.setEnabled(!this.settings.classic);
            this._hookApp();
            if (window.dataLoader && dataLoader.currentPatientId) this.onPatient(dataLoader.currentPatientId);
            this.renderAll();
            this._ticker = setInterval(() => this._tick(), 1000);
        },

        _freshView() {
            return {
                now: Date.now(), status: { state: 'idle', label: 'Ready', sub: '' }, mode: this.settings.mode,
                take: null, takeLoading: false, takeOpen: false, alerts: [], said: [], streaming: {}, held: [], heldOpen: false,
                wm: null, lines: [], interim: null, stats: null, calls: [], replay: null, settings: this.settings,
                memoryNote: '', deepgram: false, startedAt: null, note: null, noteWriting: false,
                actions: [], pendingPlan: [],
            };
        },

        _load() { try { return JSON.parse(localStorage.getItem(STORE) || '{}') || {}; } catch (e) { return {}; } },
        _save() { try { localStorage.setItem(STORE, JSON.stringify(this.settings)); } catch (e) { /* ignore */ } },

        async _fetchHealth() {
            try {
                this.health = await fetch('/api/health').then((r) => (r.ok ? r.json() : null));
            } catch (e) { this.health = null; }
            this.view.deepgram = !!(this.health && this.health.deepgramConfigured);
            this._applyVoice();
            this.request('head', 'settings');
        },

        _hookApp() {
            // The classic panel's auto-analysis would run the old pipeline on every
            // expand; in live mode the panel opening reads the chart for the live take.
            if (typeof AIPanel !== 'undefined' && AIPanel._autoLearnAndAnalyze && !AIPanel._liveWrapped) {
                const orig = AIPanel._autoLearnAndAnalyze;
                AIPanel._autoLearnAndAnalyze = function () {
                    if (LiveApp.enabled) { try { LiveApp.onPanelOpen(); } catch (e) { console.warn('Live Coworker:', e); } return; }
                    return orig.apply(this, arguments);
                };
                AIPanel._liveWrapped = true;
            }
            // Orders placed in the EHR (typed or dictated) get the same safety check
            // as spoken ones. trackOrder runs only for orders that actually go through.
            // An order signed from a radar item's form ticks that item off (the form
            // still holds the very values object the item filled in).
            if (typeof SimulationScoreTracker !== 'undefined' && SimulationScoreTracker.trackOrder && !SimulationScoreTracker._liveWrapped) {
                const origTrack = SimulationScoreTracker.trackOrder;
                SimulationScoreTracker.trackOrder = function (order) {
                    const r = origTrack.apply(this, arguments);
                    try {
                        if (LiveApp.enabled && LiveApp.engine && order) {
                            const f = LiveApp._actionForm;
                            const actionId = f && typeof OrderEntry !== 'undefined' && OrderEntry.formData === f.formData ? f.id : null;
                            if (actionId) LiveApp._actionForm = null;
                            if (!LiveApp.engine.running) LiveApp.onPanelOpen();
                            LiveApp._pendingLabel = 'EHR order';
                            LiveApp.engine.order({ name: order.name, details: order.details, priority: order.priority, category: order.category, actionId });
                            // "Review all orders": the next one opens once this form has closed.
                            if (actionId && LiveApp._queue) setTimeout(() => LiveApp._nextInQueue(), 450);
                        }
                    } catch (e) { console.warn('Live Coworker order hook:', e); }
                    return r;
                };
                SimulationScoreTracker._liveWrapped = true;
            }
            // A message sent to the nurse, or a note saved to the chart, from a radar item ticks it off.
            if (typeof NurseChat !== 'undefined' && NurseChat.sendMessage && !NurseChat._liveWrapped) {
                const origSend = NurseChat.sendMessage;
                NurseChat.sendMessage = function () {
                    try {
                        const m = LiveApp._actionMsg;
                        const input = document.getElementById('nurse-input');
                        const text = input ? input.value : '';
                        if (m && text && LiveApp.engine && LiveCore._overlap(text, m.text) >= 0.5) { LiveApp.engine.setActionStatus(m.id, 'done', 'sent'); LiveApp._actionMsg = null; }
                    } catch (e) { console.warn('Live Coworker message hook:', e); }
                    return origSend.apply(this, arguments);
                };
                NurseChat._liveWrapped = true;
            }
            if (typeof AICoworker !== 'undefined' && AICoworker.saveNoteToEHR && !AICoworker._liveNoteWrapped) {
                const origSave = AICoworker.saveNoteToEHR;
                AICoworker.saveNoteToEHR = function (type) {
                    const r = origSave.apply(this, arguments);
                    try {
                        const n = LiveApp._actionNote;
                        const modal = document.getElementById('ai-note-editor-modal');
                        if (n && type === n.type && !(modal && modal.classList.contains('visible')) && LiveApp.engine) { LiveApp.engine.setActionStatus(n.id, 'done', 'saved'); LiveApp._actionNote = null; }
                    } catch (e) { console.warn('Live Coworker note hook:', e); }
                    return r;
                };
                AICoworker._liveNoteWrapped = true;
            }
            window.addEventListener('patient:loaded', (ev) => {
                const id = ev && ev.detail && ev.detail.patientId;
                if (id) this.onPatient(id);
            });
        },

        setEnabled(on) {
            const panel = document.getElementById('ai-panel');
            this.enabled = !!on;
            if (panel) panel.classList.toggle('live-on', this.enabled);
            if (LivePanel.el) LivePanel.el.hidden = !this.enabled;
            this.settings.classic = !this.enabled;
            this._save();
            this._classicSwitch(!this.enabled);
            if (this.enabled) this.onPanelOpen();
            else this.stopListening();
        },

        _classicSwitch(show) {
            const panel = document.getElementById('ai-panel');
            let b = document.getElementById('lc-back-to-live');
            if (!show) { if (b) b.remove(); return; }
            if (b || !panel) return;
            b = document.createElement('button');
            b.id = 'lc-back-to-live';
            b.type = 'button';
            b.textContent = 'Switch to the live coworker';
            b.style.cssText = 'margin:8px 12px 0;padding:6px 10px;border:1px solid #b8c2cc;border-radius:6px;background:#f5f6f8;cursor:pointer;font:inherit;font-size:12.5px;';
            b.addEventListener('click', () => this.setEnabled(true));
            const topbar = panel.querySelector('.ai-panel-topbar');
            if (topbar) topbar.after(b); else panel.prepend(b);
        },

        // ── patient and session ──────────────────────────────────────────
        async onPatient(patientId) {
            if (this.patientId === patientId && this.chart) return;
            this.stopListening();
            this._stopReplay();
            if (this.engine) { this.engine.stop(); this.engine = null; }
            this.patientId = patientId;
            this.chart = null;
            this.memory = null;
            this.encounter = null;
            this._queue = this._actionForm = this._actionMsg = this._actionNote = null;
            this.dictating = null;
            this.view = Object.assign(this._freshView(), { deepgram: this.view.deepgram });
            this.renderAll();
            try {
                await this._prepare(patientId);
            } catch (e) {
                console.warn('Live Coworker: could not read the chart', e);
                this._status('error', 'Could not read the chart', e && e.message);
                return;
            }
            if (this._panelVisible()) this.onPanelOpen();
        },

        async _prepare(patientId) {
            // ?livefake: a scripted stand-in for the models (UI work, headless UI tests; no cost).
            this._fake = /[?&]livefake\b/.test(location.search);
            if (this._fake && typeof LiveFake === 'undefined') {
                await new Promise((resolve) => {
                    const s = document.createElement('script');
                    s.src = 'js/live/live-fake.js?v=' + Date.now();
                    s.onload = s.onerror = resolve;
                    document.head.appendChild(s);
                });
            }
            const dl = window.dataLoader;
            const base = dl.getBaseUrl() + '/' + patientId + '/';
            const chart = LiveChart.create({
                patientId,
                loadJSON: (rel) => dl.fetchJSON(base + rel),
                loadAllLabs: () => dl.loadAllLabs(patientId),
            });
            await chart.load();
            let md = null, facts = null, note = '', shape = null;
            try {
                const r = await fetch('data/live/' + patientId + '-deep-memory.json', { cache: 'no-store' });
                if (r.ok) {
                    const fx = await r.json();
                    md = fx.memoryDocument || null;
                    facts = fx.extractedFacts || null;
                    const dlState = fx.deepLearn || {};
                    note = 'Long-term memory: full chart review (' + (dlState.processedCount || (facts && facts.length) || '?') + ' of ' + (dlState.totalItems || '?') + ' documents)';
                    const dateOf = new Map((facts || []).map((x) => [x.documentId, x.date]));
                    const docs = (dlState.processedIds || []).map((id) => ({ d: dateOf.get(id) || null, k: /^LAB/.test(id) ? 'lab' : /^IMG/.test(id) ? 'imaging' : 'note' }));
                    const years = docs.map((x) => x.d && Number(String(x.d).slice(0, 4))).filter(Boolean);
                    shape = { docs, processed: dlState.processedCount || docs.length, total: dlState.totalItems || null, levels: dlState.totalLevels || null, first: years.length ? Math.min(...years) : null, last: years.length ? Math.max(...years) : null };
                }
            } catch (e) { /* no fixture */ }
            if (!md) {
                try { md = AICoworker.longitudinalDoc && AICoworker.longitudinalDoc.aiMemory && AICoworker.longitudinalDoc.aiMemory.memoryDocument; } catch (e) { md = null; }
                note = md ? 'Long-term memory: partial chart review only' : 'No long-term memory yet: working from the chart';
            }
            if (this.patientId !== patientId) return;
            this.chart = chart;
            this.memoryShape = shape;
            this.memory = LiveMemory.build({ chart, memoryDocument: md, extractedFacts: facts });
            const latest = (this.memory.digest.match(/CHART DATA THROUGH: (\S+)/) || [])[1];
            this.view.memoryNote = note + (latest ? '. Chart data through ' + latest + '.' : '.');
            this._newEngine();
        },

        _newEngine(extraConfig, clock) {
            if (this.engine) this.engine.stop();
            const transport = this._fake && window.LiveFake ? LiveFake.createTransport() : LiveTransport.createTransport({
                endpoint: () => (typeof ClaudeAPI !== 'undefined' ? ClaudeAPI._getEndpoint() : '/api/claude-full'),
                headers: () => (typeof ClaudeAPI !== 'undefined' ? ClaudeAPI._getHeaders() : { 'Content-Type': 'application/json' }),
                stream: () => !this.health || this.health.fullSiteStreaming !== false,
            });
            const cfg = Object.assign({ brainModel: this.settings.brain, mode: this.settings.mode, speed: this.settings.fast && this.settings.brain === 'claude-opus-5-5' ? 'fast' : null }, extraConfig || {});
            const cw = LiveCore.createCoworker({ transport, chart: this.chart, memory: this.memory, config: cfg, clock: clock || undefined });
            this.engine = cw;
            this._wire(cw);
            return cw;
        },

        _wire(cw) {
            const v = this.view;
            // Latency shown in the panel is real (wall-clock) time, even when the
            // demo runs the engine on a faster clock.
            const heardWall = {}, askedWall = {};
            cw.on('line', (l) => { heardWall[l.id] = Date.now(); });
            // Health: is it actually checking what it hears? Two failed calls in a
            // row, or heard lines with no successful ear call for 20 s, and the
            // panel says "not checking" (silence must never read as "all clear").
            const health = this._health = { failStreak: 0, lastError: '', pendingSince: null, lastHeardWall: null };
            cw.on('line', () => { const now = Date.now(); health.lastHeardWall = now; if (health.pendingSince == null) health.pendingSince = now; });
            cw.on('call', (c) => {
                if (!/^(ear|verify|answer|update|prime)$/.test(c.lane)) return;
                if (c.ok) { health.failStreak = 0; if (c.lane === 'ear') health.pendingSince = null; }
                else if (!/abort/i.test(c.error || '')) { health.failStreak++; health.lastError = c.error || ''; }
                this._checkHealth();
            });
            cw.on('thinking', (p) => { if (p.lane === 'answer' && p.id) askedWall[p.id] = Date.now(); });
            cw.on('line', (l) => {
                const display = this._pendingLabel || (l.typed ? 'You' : SPEAKER_LABEL[l.speaker] || l.speaker);
                v.lines.push({ id: l.id, t: l.t, speaker: l.speaker, label: display, text: l.text.replace(/^\((wife|nurse)\)\s*/i, ''), dictation: l.dictation, typed: !!l.typed });
                this._pendingLabel = null;
                v.interim = null;
                if (l.dictation) { LivePanel.setExamInterim(''); this.request('note'); }
                if (v.startedAt == null) v.startedAt = Date.now() - l.t;
                this.request('transcript');
            });
            cw.on('wm', () => { v.wm = cw.wm; v.held = cw.wm.held.slice(); this.request('tracking', 'said'); });
            cw.on('thinking', (p) => { if (p.lane === 'prime') { v.takeLoading = true; this.request('take'); } });
            cw.on('take', (t) => { v.take = Object.assign({}, t, { at: Date.now() }); v.takeLoading = false; this.request('take'); });
            cw.on('say-partial', (p) => {
                const had = !!v.streaming[p.id];
                v.streaming[p.id] = { text: p.text, status: p.status, question: p.question, via: p.via };
                if (!had || !LivePanel.streamText(p.id, p.text, p.status, p.question)) this.request('said');
            });
            cw.on('say', (s) => {
                delete v.streaming[s.id];
                const cue = s.cueLine && v.lines.find((l) => l.id === s.cueLine);
                const from = (s.cueLine && heardWall[s.cueLine]) || askedWall[s.id] || null;
                const item = Object.assign({}, s, { cueText: cue ? cue.text : '', latencyMs: from ? Date.now() - from : null, wallAt: Date.now() });
                v.said.unshift(item);
                if (s.kind === 'critical') {
                    // A new point about a problem already on screen goes onto that card, which comes back to the top.
                    const card = s.updateOf && v.alerts.find((a) => a.id === s.updateOf);
                    if (card) {
                        card.updates = (card.updates || []).concat([item]);
                        v.alerts = [card].concat(v.alerts.filter((a) => a !== card));
                    } else v.alerts.unshift(item);
                    this._chime();
                }
                if (this.settings.speakAloud && (s.kind === 'critical' || s.kind === 'answer')) this._speak(s);
                if (this.settings.glasses) this._toGlasses(s);
                this.request('said', 'alerts', 'transcript');
            });
            cw.on('held', () => { v.held = cw.wm.held.slice(); this.request('said'); });
            // Decisions (for tuning, in the Log tab): every safety check's verdict, and what was held back.
            const decide = (d) => { v.decisions = (v.decisions || []).concat([Object.assign({ at: cw.elapsed }, d)]).slice(-40); this.request('log'); };
            cw.on('verified', (p) => decide({ decision: p.decision, followUp: p.followUp, reason: p.reason, why: (p.out && p.out.why) || '', text: (p.out && p.out.text) || '' }));
            cw.on('suppressed', (p) => decide({ decision: 'suppressed', reason: p.reason || '', text: p.text || '', why: '' }));
            cw.on('call', () => { v.stats = cw.stats(); v.calls = cw.calls; this.request('log'); });
            // Failed calls show up as the "not checking" state (see _healthView), not as a flash.
            cw.on('error', (e) => {
                if (/prime|update/.test(e.lane)) { v.takeLoading = false; this.request('take'); }
                if (e.lane === 'note') { v.noteWriting = false; this.request('note'); }
            });
            // The live note: problem representation, HPI, assessment and plan, rewritten as people talk.
            cw.on('thinking', (p) => { if (p.lane === 'note') { v.noteWriting = true; this.request('note'); } });
            cw.on('note', (n) => { v.note = Object.assign({}, n, { wallAt: Date.now() }); v.noteWriting = false; this.request('note', 'take'); });
            // "How it thinks": pulses as each lane works, numbers as working memory grows (only while open).
            const about = (what) => { if (typeof LiveAbout !== 'undefined' && LiveAbout.isOpen()) LiveAbout.pulse(what); };
            cw.on('call-start', (c) => about(c.lane));
            cw.on('tool', (x) => about('tool:' + x.name));
            cw.on('say', (x) => about('say:' + (x.kind === 'critical' ? 'critical' : 'answer')));
            cw.on('wm', () => { if (typeof LiveAbout !== 'undefined' && LiveAbout.isOpen()) this.request('about'); });
            cw.on('call', () => { if (typeof LiveAbout !== 'undefined' && LiveAbout.isOpen()) this.request('about'); });
            // On my radar: the doctor's orders and to-dos, plus what was just heard and is being got ready.
            cw.on('actions', (list) => {
                v.actions = list.map((a) => Object.assign({}, a, { fields: Object.assign({}, a.fields), needs: this._formNeeds(a) }));
                v.pendingPlan = cw.wm.plan.filter((p) => p.radar !== true && p.kind !== 'cancel' && p.from !== 'ehr').map((p) => ({ id: p.id, t: p.t, text: p.text, kind: p.kind, line: p.line, failed: p.radar === 'failed' }));
                this.request('radar', 'transcript');
            });
        },

        _panelVisible() {
            const p = document.getElementById('ai-panel');
            if (!p || p.classList.contains('collapsed')) return false;
            const cs = getComputedStyle(p);
            return cs.display !== 'none' && cs.visibility !== 'hidden' && p.getClientRects().length > 0;
        },

        /** Panel opened (or patient ready while open): read the chart for a take, once per session. */
        onPanelOpen() {
            if (!this.enabled || !this.engine || this.engine.running) return;
            if (typeof ModeManager !== 'undefined' && ModeManager.isStudyLocked && ModeManager.isStudyLocked() !== false) return;
            this.engine.start();
            this.view.takeLoading = true;
            this.request('take');
        },

        // ── the encounter: start, pause and resume (the mic), end ────────
        /** Start: a fresh encounter if one already ran, then listen; the clock starts now. */
        async startEncounter() {
            if (!this.engine) { this._flash('Open a patient first.'); return; }
            if (this.encounter && this.encounter.state !== 'ended') return;
            this._stopReplay();
            if (this.encounter || this.view.lines.length || this.view.said.length) this.newEncounter();
            this.encounter = { state: 'live', kind: 'mic', startedWall: Date.now(), endedWall: null };
            await this.startListening();
            if (!this._mic && this.encounter) this.encounter.state = 'paused';   // the mic was refused
            this.request('head', 'note');
        },

        /** End: stop listening, write the final version of the note. */
        endEncounter() {
            const e = this.encounter;
            if (!e || e.state === 'ended') return;
            if (this._replay) this._stopReplay();
            this.stopListening();
            if (typeof LiveVoice !== 'undefined') LiveVoice.stop();
            e.state = 'ended';
            e.endedWall = Date.now();
            if (this.engine && this.engine.running) this.engine.note();
            this._status('idle', e.kind === 'demo' ? 'Demo finished' : 'Encounter ended');
            this.request('head', 'note');
        },

        /** The mic button: start an encounter, or pause and resume listening within one. */
        toggleMic() {
            const e = this.encounter;
            if (!e || e.state === 'ended') { this.startEncounter(); return; }
            if (e.kind === 'demo') { this.replay(this._replay && this._replay.playing ? 'pause' : 'play'); return; }
            if (this._mic) { this.stopListening(); e.state = 'paused'; }
            else { e.state = 'live'; this.startListening(); }
            this.request('head');
        },

        _noteText() {
            const n = this.view.note;
            if (!n) return '';
            const ex = n.exam || { vitals: '', systems: [] };
            const exam = (ex.vitals ? ['Vitals: ' + ex.vitals] : []).concat((ex.systems || []).map((x) => x.system + ': ' + x.findings));
            return ['Problem representation', n.problem_representation, '', 'HPI', n.hpi || '(none yet)', '', 'Physical exam'].concat(exam.length ? exam : ['(not dictated yet)'], ['', 'Assessment and plan'])
                .concat((n.problems || []).map((p, i) => [(i + 1) + '. ' + p.name + (p.assessment ? ': ' + p.assessment : '')].concat(p.plan.map((x) => '   - ' + x)).join('\n')))
                .join('\n');
        },

        copyNote() {
            if (!this.view.note) return;
            this._copy(this._noteText(), 'Note copied.');
        },

        _copy(text, ok) {
            const fail = () => this._flash('Could not copy (the browser blocked it).');
            try { navigator.clipboard.writeText(text).then(() => this._flash(ok || 'Copied.'), fail); } catch (err) { fail(); }
        },

        // ── how it thinks (the about sheet, loaded on first open) ─────────
        async openAbout(from) {
            if (!LivePanel.el) return;
            if (typeof LiveAbout === 'undefined') {
                const css = document.createElement('link');
                css.rel = 'stylesheet';
                css.href = 'css/live-about.css?' + SELF_Q;
                document.head.appendChild(css);
                await new Promise((resolve) => {
                    const sc = document.createElement('script');
                    sc.src = 'js/live/live-about.js?' + SELF_Q;
                    sc.onload = sc.onerror = resolve;
                    document.head.appendChild(sc);
                });
                if (typeof LiveAbout === 'undefined') { this._flash('Could not load that view.'); return; }
            }
            LivePanel.togglePop(false);
            LiveAbout.open(LivePanel.el, this._aboutState(), { returnFocus: from || null });
        },

        _aboutState() {
            const c = this.chart;
            const n = (x) => (Array.isArray(x) ? x.length : null);
            return {
                brain: BRAIN_LABEL[this.settings.brain] || this.settings.brain,
                mode: { follow: 'Follow', abreast: 'Abreast', lead: 'Lead' }[this.settings.mode] || '',
                listening: !!this._mic,
                wm: this.engine ? this.engine.wm : null,
                stats: this.engine ? this.engine.stats() : null,
                memory: this.memory ? this.memory.meta : null,
                memoryNote: this.view.memoryNote,
                shape: this.memoryShape || null,
                chart: c ? { allergies: n(c.allergies), meds: n(c.meds), problems: n(c.problems), labs: n(c.labs), encounters: n(c.encounters) } : null,
            };
        },

        // ── dictating the physical exam ──────────────────────────────────
        /**
         * "Dictate exam": listen (the same encounter and note, even after it ended),
         * and mark the doctor's words as exam dictation until "Done".
         */
        async startExamDictation() {
            if (!this.engine) { this._flash('Open a patient first.'); return; }
            if (this._replay || (this.encounter && this.encounter.kind === 'demo')) { this._flash('The demo is a recording: start an encounter to dictate. Typing works.'); return; }
            this.dictating = 'exam';
            LivePanel.showTab('note');
            this.request('note', 'head');
            if (!this._mic) {
                if (!this.encounter) this.encounter = { state: 'live', kind: 'mic', startedWall: Date.now(), endedWall: null };
                else { this.encounter.state = 'live'; this.encounter.endedWall = null; }
                await this.startListening();
                if (!this._mic) {
                    if (this.encounter) this.encounter.state = 'paused';
                    this._flash('No microphone: type the findings instead.');
                }
            }
            this.request('note', 'head');
        },

        stopDictation() {
            if (!this.dictating) return;
            this.dictating = null;
            LivePanel.setExamInterim('');
            this.request('note');
        },

        /** A typed exam finding goes in exactly like a dictated one. */
        typeExam(text) {
            if (!this.engine) { this._flash('Open a patient first.'); return; }
            if (!this.engine.running) this.onPanelOpen();
            if (!this.engine.running) { this._flash('The coworker is not running here.'); return; }
            this._pendingLabel = 'You';
            this.engine.hear({ speaker: 'doctor', text, mode: 'exam', typed: true });
        },

        /** Every final line from the mic: while the exam is dictated, the doctor's words are tagged as exam. */
        _heard(role, text) {
            if (!this.engine || !text) return;
            const exam = this.dictating === 'exam' && role !== 'patient';
            this.engine.hear({ speaker: exam ? 'doctor' : role, text, mode: exam ? 'exam' : undefined });
        },

        // ── on my radar: one click to act on what the doctor asked for ───
        _action(id) { return (this.view.actions || []).find((a) => a.id === id) || null; },

        /** The item's main button: the order form filled in, the nurse chat with the message typed, or the note draft. */
        openAction(id) {
            const a = this._action(id);
            if (!a || !this.engine) return;
            this._queue = null;
            if (a.kind === 'order' || a.kind === 'consult') return this._openOrder(a);
            if (a.kind === 'message' && /nurse/i.test(a.to || '')) return this._messageNurse(a);
            if (a.kind === 'note') return this._openNote(a);
            if (a.draft) return this._copy(a.draft, 'Copied. Paste it where it goes.');
            return undefined;
        },

        /** For an order or consult: the order form's required fields the item leaves empty ("dose", "frequency"). */
        _formNeeds(a) {
            if (a.kind !== 'order' && a.kind !== 'consult') return null;
            const type = a.kind === 'consult' ? 'consult' : a.orderType;
            const cfg = typeof OrderEntry !== 'undefined' && OrderEntry.orderTypes && type ? OrderEntry.orderTypes[type] : null;
            if (!cfg) return null;
            const form = LiveCore.toOrderForm(cfg.fields, a.fields);
            const WORD = { 'Medication Name': 'drug', 'Lab Panel/Test': 'test', 'Specimen Type': 'specimen', 'Clinical Indication': 'indication', 'Body Part/Region': 'body part', 'Procedure Name': 'procedure', 'Reason for Consult': 'reason', 'Order Type': 'order type', 'Order Details': 'details' };
            return cfg.fields.filter((f) => f.required && !form[f.name]).map((f) => WORD[f.label] || String(f.label).toLowerCase());
        },

        _openOrder(a, more) {
            if (typeof OrderEntry === 'undefined' || !OrderEntry.openWithPrefill) { this._flash('The order form is not available on this page.'); return; }
            const type = a.kind === 'consult' ? 'consult' : a.orderType;
            const cfg = type && OrderEntry.orderTypes && OrderEntry.orderTypes[type];
            if (!cfg) { OrderEntry.open(); this._actionForm = null; return; }
            OrderEntry.openWithPrefill(type, LiveCore.toOrderForm(cfg.fields, a.fields));
            this._actionForm = { id: a.id, formData: OrderEntry.formData, type };
            // Say where the form came from (and, in "Review all", how many are left).
            const title = document.querySelector('#order-entry-modal .order-entry-title');
            if (title) title.innerHTML = 'New Order <span style="font-size:12px;color:#c9dcf0;font-weight:normal;margin-left:6px;">From the coworker\'s radar' + (more ? ' · ' + more + ' more after this' : '') + '</span>';
        },

        _messageNurse(a) {
            const text = a.draft || a.title;
            if (typeof FloatingChat === 'undefined' || !FloatingChat.openChat) { this._copy(text, 'Copied. Paste it to the nurse.'); return; }
            FloatingChat.openChat('nurse');
            this._actionMsg = { id: a.id, text };
            setTimeout(() => {
                const input = document.getElementById('nurse-input');
                if (!input) return;
                input.value = text;
                input.dispatchEvent(new Event('input', { bubbles: true }));
                input.focus();
            }, 60);
        },

        _openNote(a) {
            const type = a.noteType || 'Note';
            // An admission note starts from the live note; any other from the radar's short draft.
            const content = /h\s*&\s*p|admission|history and physical/i.test(type) && this.view.note ? this._noteText() : (a.draft || '');
            if (typeof AICoworker === 'undefined' || !AICoworker.openNoteEditor) { this._copy(content || a.title, 'Copied the draft.'); return; }
            AICoworker.openNoteEditor(type, content);
            this._actionNote = { id: a.id, type };
        },

        /** "Review all orders": the order forms one after another; each signed one opens the next. */
        reviewOrders() {
            const ready = (this.view.actions || []).filter((a) => a.status === 'todo' && !a.flag && ((a.kind === 'order' && a.orderType) || a.kind === 'consult'));
            if (!ready.length) return;
            this._queue = ready.sort((x, y) => x.t - y.t || x.id.localeCompare(y.id, undefined, { numeric: true })).map((a) => a.id);
            this._nextInQueue();
        },

        _nextInQueue() {
            const q = this._queue;
            while (q && q.length) {
                const a = this._action(q.shift());
                if (a && a.status === 'todo') { this._openOrder(a, q.length); if (!q.length) this._queue = null; return; }
            }
            this._queue = null;
        },

        _actionClick(id, verb) {
            const a = this._action(id);
            if (!a || !this.engine) return;
            if (verb === 'open') {
                try { this.openAction(id); } catch (e) { console.warn('Live Coworker radar:', e); this._flash('Could not open that here. The details are on the radar.'); }
            }
            else if (verb === 'copy') this._copy(a.draft || a.title, 'Copied. Paste it where it goes.');
            else if (verb === 'toggle') this.engine.setActionStatus(id, a.status === 'todo' ? 'done' : 'todo', 'doctor');
            else if (verb === 'drop') this.engine.setActionStatus(id, 'dropped', 'doctor');
        },

        /** Side by side: widen the AI panel so the conversation and the note sit in two columns. */
        toggleWide() {
            const root = document.documentElement;
            const panel = document.getElementById('ai-panel');
            const now = panel ? panel.getBoundingClientRect().width : 440;
            let width;
            if (now >= 620) {
                width = Number(localStorage.getItem('live-narrow-width')) || 440;
            } else {
                try { localStorage.setItem('live-narrow-width', String(Math.round(now))); } catch (e) { /* ignore */ }
                width = Math.max(660, Math.min(900, window.innerWidth - 560));
            }
            root.style.setProperty('--ai-panel-width', width + 'px');
            try { localStorage.setItem('ai-panel-width', String(width)); } catch (e) { /* ignore */ }
            setTimeout(() => this.renderAll(), 260);
        },

        newEncounter(extraConfig, clock) {
            this.stopListening();
            if (typeof LiveVoice !== 'undefined') LiveVoice.stop();
            if (!clock) this._stopReplay();
            this._queue = this._actionForm = this._actionMsg = this._actionNote = null;
            this.dictating = null;
            const keep = { deepgram: this.view.deepgram, memoryNote: this.view.memoryNote };
            this.view = Object.assign(this._freshView(), keep);
            if (!this.chart) return null;
            const cw = this._newEngine(extraConfig, clock);
            cw.start();
            this.view.takeLoading = true;
            this._status('idle');
            this.renderAll();
            return cw;
        },

        // ── panel handlers ───────────────────────────────────────────────
        _handlers() {
            return {
                onMic: () => this.toggleMic(),
                onStart: () => this.startEncounter(),
                onEnd: () => this.endEncounter(),
                onCopyNote: () => this.copyNote(),
                onWide: () => this.toggleWide(),
                onMode: (m) => this.setMode(m),
                onAsk: (q) => this.ask(q),
                onAck: (id) => { this.view.alerts = this.view.alerts.filter((a) => a.id !== id); if (this.engine) this.engine.ack(id); this.request('alerts', 'said', 'take'); },
                onRetry: (q) => { if (q) this.ask(q); },
                onRerenderAlerts: () => this.request('alerts'),
                onUnfold: (id) => { this.view.openAlerts = Object.assign({}, this.view.openAlerts, { [id]: true }); this.request('alerts'); },
                onTellHeld: (topic) => { if (this.engine) this.engine.tell(topic); this.view.heldOpen = true; },
                onTakeToggle: () => { this.view.takeOpen = !this.view.takeOpen; this.request('take'); },
                onReplay: (cmd) => this.replay(cmd),
                onPrime: () => { if (!this.engine) return; if (!this.engine.running) this.onPanelOpen(); else { this.view.takeLoading = !this.view.take; this.engine.prime(); this.request('take'); } LivePanel.togglePop(false); },
                onReset: () => { this.encounter = null; this.newEncounter(); LivePanel.togglePop(false); },
                onClassic: () => { LivePanel.togglePop(false); this.setEnabled(false); },
                onSetting: (name, value) => this.setSetting(name, value),
                onOpenSettings: () => this.request('settings'),
                onVoiceTest: () => { if (typeof LiveVoice === 'undefined') return; this._applyVoice(); LiveVoice.stop(); LiveVoice.say('Safety. Hold the heparin drip: black stools and hemoglobin 10.2.', { urgent: true }); },
                onAction: (id, verb) => this._actionClick(id, verb),
                onReviewOrders: () => this.reviewOrders(),
                onRadarToggle: (open) => { this.settings.radarOpen = open; this._save(); this.request('radar'); },
                onRerenderRadar: () => this.request('radar'),
                onRadarRetry: () => { if (this.engine) this.engine.actions(); },
                onAbout: (btn) => this.openAbout(btn),
                onExamDictate: () => this.startExamDictation(),
                onExamDone: () => this.stopDictation(),
                onExamType: (text) => this.typeExam(text),
                onTab: () => {},
            };
        },

        setMode(m) {
            this.settings.mode = m;
            this.view.mode = m;
            this._save();
            if (this.engine) this.engine.setMode(m);
            try { if (typeof AIModeConfig !== 'undefined' && AIModeConfig.setMode) AIModeConfig.setMode(MODE_TO_OLD[m]); } catch (e) { /* ignore */ }
            this.request('head', 'take', 'said');
        },

        setSetting(name, value) {
            if (name === 'brain') {
                this.settings.brain = value;
                if (value !== 'claude-opus-5-5') this.settings.fast = false;
                if (this.engine) { this.engine.setBrainModel(value); this.engine.setSpeed(this.settings.fast ? 'fast' : null); }
            } else if (name === 'fast') {
                this.settings.fast = !!value && this.settings.brain === 'claude-opus-5-5';
                if (this.engine) this.engine.setSpeed(this.settings.fast ? 'fast' : null);
            } else if (name === 'replaySpeed') {
                this.settings.replaySpeed = parseFloat(value) || 1;
            } else if (name === 'source') {
                const was = !!this._mic;
                if (was) this.stopListening();
                this.settings.source = value;
                if (was) this.startListening();
            } else if (name === 'speakAloud') {
                this.settings.speakAloud = !!value;
                if (typeof LiveVoice !== 'undefined') {
                    if (value) LiveVoice.say('I\'ll read answers and safety alerts aloud.');   // the click also lets the page speak
                    else LiveVoice.stop();
                }
            } else if (name === 'voice') {
                this.settings.voice = value || '';
                if (typeof LiveVoice !== 'undefined') { this._applyVoice(); LiveVoice.stop(); LiveVoice.say('This is how I sound.'); }
            } else {
                this.settings[name] = value;
            }
            this._save();
            this.request('head', 'settings');
        },

        ask(q) {
            if (!this.engine) { this._flash('Open a patient first.'); return; }
            if (!this.engine.running) this.onPanelOpen();
            this.engine.ask(q, { via: 'typed' });
        },

        // ── listening ────────────────────────────────────────────────────
        async startListening() {
            if (!this.engine) { this._flash('Open a patient first.'); return; }
            this._stopReplay();
            if (!this.engine.running) this.onPanelOpen();
            this._quietOthers();
            if (this._health) this._health.pendingSince = null;
            const useRoom = this.settings.source === 'room' && this.view.deepgram && typeof DeepgramClient !== 'undefined';
            try {
                if (useRoom) await this._startDeepgram(); else this._startBrowserSpeech();
            } catch (e) {
                this._mic = null;
                this._status('error', 'Microphone unavailable', (e && e.message) || 'Permission denied');
            }
        },

        stopListening() {
            const m = this._mic;
            this._mic = null;
            if (!m) return;
            try { m.stop(); } catch (e) { /* ignore */ }
            this.view.interim = null;
            this.stopDictation();
            this._status('idle', 'Paused');
            this.request('transcript');
        },

        _quietOthers() {
            try { if (typeof DictationWidget !== 'undefined' && DictationWidget.isListening && DictationWidget.stop) DictationWidget.stop(); } catch (e) { /* ignore */ }
            try { if (typeof AmbientScribe !== 'undefined' && AmbientScribe.isActive && AmbientScribe.stop) AmbientScribe.stop(); } catch (e) { /* ignore */ }
            try { if (typeof AICoworker !== 'undefined' && AICoworker.stopHandsFree) AICoworker.stopHandsFree(); } catch (e) { /* ignore */ }
        },

        async _startDeepgram() {
            const DG = DeepgramClient;
            const prev = { onTranscript: DG.onTranscript, onStateChange: DG.onStateChange };
            let buf = null, timer = null;
            const flush = () => {
                clearTimeout(timer);
                if (!buf) return;
                const role = buf.role === 'unknown' ? 'other' : buf.role;
                const text = buf.parts.join(' ').trim();
                buf = null;
                if (text) this._heard(role, text);
            };
            const startedAt = Date.now();
            DG.onTranscript = (r) => {
                if (!this._mic) return;
                if (this._heardOwnVoice(r.transcript, r.isFinal)) return;
                if (!r.isFinal) {
                    this.view.interim = { speaker: SPEAKER_LABEL[r.speakerRole] || 'Voice', text: (buf && buf.role === r.speakerRole ? buf.parts.join(' ') + ' ' : '') + r.transcript };
                    if (!LivePanel.setInterim(this.view.interim)) this.request('transcript');
                    if (this.dictating === 'exam' && r.speakerRole !== 'patient') LivePanel.setExamInterim(this.view.interim.text);
                    return;
                }
                if (buf && buf.role !== r.speakerRole) flush();
                buf = buf || { role: r.speakerRole, parts: [] };
                buf.parts.push(r.transcript);
                if (r.speechFinal) flush();
                else { clearTimeout(timer); timer = setTimeout(flush, 1400); }
            };
            DG.onStateChange = (s) => {
                if (!this._mic) return;
                if (s === 'connected') this._status('listening');
                if (s === 'disconnected') {
                    const early = Date.now() - startedAt < 5000;
                    this._mic = null;
                    restore();
                    if (early) { this._flash('Room mic unavailable; using browser speech.'); this._startBrowserSpeech(); }
                    else this._status('idle', 'Mic disconnected');
                }
            };
            const restore = () => { DG.onTranscript = prev.onTranscript; DG.onStateChange = prev.onStateChange; };
            // Deepgram's medical model, listening for this patient's drug names
            // (?livemic=general keeps the general model, for side-by-side tests).
            const general = /[?&]livemic=general\b/.test(location.search);
            const mic = general ? {} : { model: 'medical', keyterms: this.chart && this.chart.speechTerms ? this.chart.speechTerms() : [] };
            this._mic = { kind: 'room', model: general ? 'general' : 'medical', stop: () => { flush(); restore(); DG.stop(); } };
            this._status('connecting');
            await DG.start(mic);
            if (this._mic) this._status('listening');
        },

        _startBrowserSpeech() {
            const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
            if (!SR) throw new Error('This browser has no speech recognition');
            const rec = new SR();
            rec.continuous = true;
            rec.interimResults = true;
            rec.lang = 'en-US';
            let stopped = false;
            rec.onresult = (ev) => {
                let interim = '';
                for (let i = ev.resultIndex; i < ev.results.length; i++) {
                    const res = ev.results[i];
                    if (this._heardOwnVoice(res[0].transcript, res.isFinal)) continue;
                    if (res.isFinal) { const t = res[0].transcript.trim(); if (t) this._heard('unknown', t); }
                    else interim += res[0].transcript;
                }
                this.view.interim = interim ? { speaker: 'Voice', text: interim } : null;
                if (!LivePanel.setInterim(this.view.interim)) this.request('transcript');
                if (this.dictating === 'exam') LivePanel.setExamInterim(interim);
            };
            rec.onerror = (e) => { if (e.error === 'not-allowed') { stopped = true; this._mic = null; this._status('error', 'Microphone blocked', 'Allow the mic for this site'); } };
            rec.onend = () => { if (!stopped && this._mic) { try { rec.start(); } catch (e) { /* ignore */ } } };
            this._mic = { kind: 'browser', stop: () => { stopped = true; try { rec.stop(); } catch (e) { /* ignore */ } } };
            rec.start();
            this._status('listening');
        },

        // ── demo replay ──────────────────────────────────────────────────
        async replay(cmd) {
            LivePanel.togglePop(false);
            const rp = this._replay;
            if (cmd === 'pause' && rp) { this._pauseReplay(); return; }
            if (cmd === 'stop') { if (this.encounter && this.encounter.kind === 'demo') this.endEncounter(); else { this._stopReplay(); this._status('idle'); } return; }
            if (cmd === 'restart') cmd = 'play-new';
            if (cmd === 'play' && rp && !rp.playing && rp.pos > 0 && rp.pos < rp.script.duration_s) { this._resumeReplay(); return; }
            if (cmd === 'play' && rp && rp.playing) return;
            // (Re)start from the beginning.
            if (this.patientId !== DEMO.patient) { this._flash('The demo uses Robert Morrison. Open his chart first.'); return; }
            let script;
            try { script = await fetch(DEMO.file, { cache: 'no-store' }).then((r) => r.json()); } catch (e) { this._flash('Could not load the demo script.'); return; }
            const speed = this.settings.replaySpeed || 1;
            this.stopListening();
            this._stopReplay();
            const run = { script, speed, playing: false, pos: 0, timers: [], startedWall: 0 };
            // The engine runs on the demo's clock, so times, heartbeats and the
            // speaking-rule intervals all line up with the script at any speed.
            const demoClock = {
                now: () => (run.playing ? ((Date.now() - run.startedWall) * run.speed) : run.pos * 1000),
                setTimeout: (fn, ms) => setTimeout(fn, ms / run.speed),
                clearTimeout: (h) => clearTimeout(h),
            };
            this.newEncounter(null, demoClock);
            this.encounter = { state: 'live', kind: 'demo', startedWall: Date.now(), endedWall: null };
            this._replay = run;
            this._resumeReplay();
        },

        _resumeReplay() {
            const rp = this._replay;
            if (!rp) return;
            rp.playing = true;
            rp.startedWall = Date.now() - (rp.pos * 1000) / rp.speed;
            if (this.encounter && this.encounter.kind === 'demo') this.encounter.state = 'live';
            if (this._health) this._health.pendingSince = null;
            for (const line of rp.script.lines) {
                const at = line.t + line.dur;
                if (at <= rp.pos) continue;
                rp.timers.push(setTimeout(() => this._replayLine(line), ((at - rp.pos) * 1000) / rp.speed));
            }
            rp.timers.push(setTimeout(() => {
                if (this._replay !== rp) return;
                rp.playing = false;
                rp.pos = rp.script.duration_s;
                const e = this.encounter;
                if (e && e.kind === 'demo' && e.state !== 'ended') { e.state = 'ended'; e.endedWall = Date.now(); if (this.engine) this.engine.note(); }
                this._status('idle', 'Demo finished');
                this.request('replay', 'head', 'note');
            }, ((rp.script.duration_s - rp.pos) * 1000) / rp.speed + 500));
            this._status('replaying');
            this.request('replay');
        },

        _replayLine(line) {
            if (!this.engine) return;
            const sp = line.speaker === 'doctor' || line.speaker === 'patient' ? line.speaker : 'other';
            this._pendingLabel = SPEAKER_LABEL[line.speaker] || line.speaker;
            this.engine.hear({ speaker: sp, text: (sp === 'other' ? '(' + line.speaker + ') ' : '') + line.text });
        },

        _pauseReplay() {
            const rp = this._replay;
            if (!rp || !rp.playing) return;
            rp.timers.forEach(clearTimeout);
            rp.timers = [];
            rp.pos = ((Date.now() - rp.startedWall) * rp.speed) / 1000;
            rp.playing = false;
            if (this.encounter && this.encounter.kind === 'demo') this.encounter.state = 'paused';
            this._status('idle', 'Demo paused');
            this.request('replay');
        },

        _stopReplay() {
            const rp = this._replay;
            if (!rp) return;
            rp.timers.forEach(clearTimeout);
            this._replay = null;
            this.request('replay');
        },

        // ── status, feedback, sound ──────────────────────────────────────
        _status(state, label, sub) {
            this.view.status = { state, label: label || '', sub: sub || '', explicit: !!label };
            this.request('head');
            this._checkHealth();   // pausing or stopping ends a "not checking" warning at once
        },

        _statusView() {
            const base = this._baseStatus();
            // A short message ("Open a patient first.") borrows the second line for 5 s.
            if (this._flashMsg && Date.now() < this._flashUntil && base.state !== 'degraded') return Object.assign({}, base, { sub: this._flashMsg, subHtml: null });
            return base;
        },

        _baseStatus() {
            const s = this.view.status;
            const brain = BRAIN_LABEL[this.settings.brain] || this.settings.brain;
            const elapsed = this.view.startedAt ? Date.now() - this.view.startedAt : 0;
            const clock = (ms) => { const x = Math.round(ms / 1000); return Math.floor(x / 60) + ':' + String(x % 60).padStart(2, '0'); };
            const hv = this._healthView();
            if (hv.degraded && (s.state === 'listening' || s.state === 'replaying')) {
                return { state: 'degraded', listening: s.state === 'listening', label: (s.state === 'listening' ? (this.encounter ? 'Encounter' : 'Listening') : 'Demo') + ', not checking', sub: hv.reason };
            }
            if (s.state === 'listening') {
                const since = hv.lastHeardWall ? Math.round((Date.now() - hv.lastHeardWall) / 1000) : null;
                const heard = since == null ? 'waiting for speech' : 'heard ' + (since < 5 ? 'just now' : since < 60 ? since + 's ago' : Math.round(since / 60) + 'm ago');
                const enc = this.encounter && this.encounter.kind === 'mic' ? this.encounter : null;
                return { state: 'listening', label: (enc ? 'Encounter · ' + clock(Date.now() - enc.startedWall) : 'Listening · ' + clock(elapsed)), sub: (this._mic && this._mic.kind === 'room' ? 'Room mic' : 'Browser speech') + ' · ' + heard + ' · ' + brain };
            }
            if (s.state === 'connecting') return { state: 'connecting', label: 'Connecting the mic…', sub: brain };
            if (s.state === 'replaying' && this._replay) return { state: 'replaying', label: 'Demo · ' + DEMO.title, sub: this._replay.speed + '× speed · ' + brain };
            if (s.state === 'error') return { state: 'error', label: s.label || 'Something went wrong', sub: s.sub };
            if (!this.patientId) return { state: 'idle', label: 'Ready', sub: 'Open a patient to start.' };
            const e = this.encounter;
            if (e && e.state === 'ended') {
                return { state: 'idle', label: (e.kind === 'demo' ? 'Demo finished' : 'Encounter ended') + ' · ' + clock((e.endedWall || Date.now()) - e.startedWall), sub: 'The note is ready · ' + brain };
            }
            if (e && e.state === 'paused' && e.kind === 'mic') {
                return { state: 'idle', label: 'Encounter paused · ' + clock(Date.now() - e.startedWall), sub: 'Tap the mic to keep listening · ' + brain };
            }
            // A paused demo: its own row has Resume, so no demo link here.
            if (this._replay) return { state: 'idle', label: s.label || 'Demo paused', sub: this._replay.speed + '× speed · ' + brain };
            const busy = this.view.lines.length > 0 || this.view.said.length > 0;
            return {
                state: 'idle', label: 'Ready', sub: '',
                subHtml: (this.patientId === DEMO.patient
                    ? 'Or <button type="button" data-act="demo"' + (busy ? ' data-confirm="clear this encounter and play the demo?"' : '') + '>play the Morrison demo</button>'
                    : 'Start when you are with the patient') + ' · ' + brain,
            };
        },

        /** Is the coworker checking what it hears? (See the health tracking in _wire.) */
        _healthView() {
            const h = this._health || {};
            const active = !!this._mic || !!(this._replay && this._replay.playing);
            let reason = '';
            if (h.failStreak >= 2) reason = 'The AI is not answering (' + plainError(h.lastError) + ').';
            else if (h.pendingSince != null && Date.now() - h.pendingSince > 20000) reason = 'No reply from the AI for over 20 seconds.';
            return { degraded: active && !!reason, reason, lastHeardWall: h.lastHeardWall || null };
        },

        _checkHealth() {
            const d = this._healthView().degraded;
            if (d === !!this._wasDegraded) return;
            this._wasDegraded = d;
            this.request('head', 'alerts');
        },

        _flash(msg) { this._flashMsg = msg; this._flashUntil = Date.now() + 5000; this.request('head'); setTimeout(() => this.request('head'), 5100); },

        _chime() {
            if (!this.settings.chime) return;
            try {
                const ctx = this._audio || (this._audio = new (window.AudioContext || window.webkitAudioContext)());
                const now = ctx.currentTime;
                [880, 660].forEach((f, i) => {
                    const o = ctx.createOscillator(), g = ctx.createGain();
                    o.frequency.value = f;
                    g.gain.setValueAtTime(0.0001, now + i * 0.16);
                    g.gain.exponentialRampToValueAtTime(0.12, now + i * 0.16 + 0.02);
                    g.gain.exponentialRampToValueAtTime(0.0001, now + i * 0.16 + 0.14);
                    o.connect(g).connect(ctx.destination);
                    o.start(now + i * 0.16);
                    o.stop(now + i * 0.16 + 0.15);
                });
            } catch (e) { /* no audio */ }
        },

        _toGlasses(s) {
            try {
                const G = window.GlassesBridge;
                if (!G || !G.isEnabled || !G.isEnabled()) return;
                const prefix = s.kind === 'critical' ? '⚠ ' : s.kind === 'insight' ? '💡 ' : '';
                G.pushEvent({ kind: 'dictation', text: G._compress ? G._compress(prefix + s.text, 140) : (prefix + s.text).slice(0, 140), glyph: s.kind === 'critical' ? '⚠' : '✓' });
            } catch (e) { /* glasses are optional */ }
        },

        // Read an answer or a safety alert aloud. A safety alert cuts in ahead of an answer.
        _speak(s) {
            try {
                if (typeof LiveVoice === 'undefined') return;
                this._applyVoice();
                LiveVoice.say((s.kind === 'critical' ? (s.updateOf ? 'Safety update. ' : 'Safety. ') : '') + s.text, { urgent: s.kind === 'critical' });
            } catch (e) { /* speaking is optional */ }
        },

        /**
         * Which voice: "dg:<Aura voice>" (Deepgram, natural, through the server), "os:<name>"
         * (this computer's), or unset (Deepgram's Athena when the server has a Deepgram key).
         */
        _applyVoice() {
            if (typeof LiveVoice === 'undefined') return;
            const v = this.settings.voice || '';
            const deepgram = v.startsWith('dg:') || (!v && this.view.deepgram);
            const engine = deepgram ? 'deepgram' : 'browser';
            const dgVoice = v.startsWith('dg:') ? v.slice(3) : 'aura-2-athena-en';
            if (LiveVoice.engine !== engine || LiveVoice.dgVoice !== dgVoice) LiveVoice.dgDown = false;   // a new choice gets a fresh try
            LiveVoice.engine = engine;
            LiveVoice.dgVoice = dgVoice;
            LiveVoice.voiceName = v.startsWith('os:') ? (v.slice(3) || null) : null;
        },

        /**
         * While it is speaking, the room mic hears it too. Its own words are dropped
         * (true); someone else talking over it stops it so it can listen (false).
         */
        _heardOwnVoice(text, isFinal) {
            if (typeof LiveVoice === 'undefined' || !LiveVoice.busy()) return false;
            if (LiveVoice.isEcho(text)) return true;
            const words = String(text || '').trim().split(/\s+/).filter(Boolean).length;
            if (words >= (isFinal ? 1 : 2)) LiveVoice.stop();
            return false;
        },

        // ── rendering ────────────────────────────────────────────────────
        request(...parts) {
            for (const p of parts) this._renderQueued.add(p);
            if (this._raf) return;
            // Animation frames pause in background tabs; a timer keeps the panel
            // current there too (whichever fires first does the render).
            const run = () => {
                if (!this._raf) return;
                cancelAnimationFrame(this._raf.frame);
                clearTimeout(this._raf.timer);
                this._raf = null;
                const q = this._renderQueued;
                this._renderQueued = new Set();
                this._render(q);
            };
            this._raf = { frame: requestAnimationFrame(run), timer: setTimeout(run, 120) };
        },

        renderAll() { this.request('head', 'replay', 'alerts', 'radar', 'take', 'said', 'note', 'tracking', 'transcript', 'log', 'settings'); },

        _render(q) {
            if (!LivePanel.el || !this.enabled) return;
            const v = this.view;
            v.now = Date.now();
            v.engineNow = this.engine ? this.engine.elapsed : null;
            v.mode = this.settings.mode;
            v.settings = this.settings;
            v.health = this._healthView();
            v.encounter = this.encounter ? Object.assign({}, this.encounter) : null;
            v.dictating = this.dictating;
            v.canStart = !!this.engine;
            v.wide = !!(LivePanel.el && LivePanel.el.getBoundingClientRect().width >= 620);
            v.canSpeak = typeof LiveVoice !== 'undefined' && LiveVoice.supported();
            v.voices = v.canSpeak ? LiveVoice.voices() : [];
            v.replay = this._replay ? { active: true, finished: !this._replay.playing && this._replay.pos >= this._replay.script.duration_s, playing: this._replay.playing, t: this._replay.playing ? Math.min(this._replay.script.duration_s, ((Date.now() - this._replay.startedWall) * this._replay.speed) / 1000) : this._replay.pos, duration: this._replay.script.duration_s, title: DEMO.title, speed: this._replay.speed } : null;
            try {
                if (q.has('head')) LivePanel.renderHead(Object.assign({}, v, { status: this._statusView() }));
                if (q.has('note')) LivePanel.renderNote(v);
                if (q.has('replay')) LivePanel.renderReplay(v);
                if (q.has('alerts')) LivePanel.renderAlerts(v);
                if (q.has('radar')) LivePanel.renderRadar(v);
                if (q.has('take')) LivePanel.renderTake(v);
                if (q.has('said') || q.has('transcript')) LivePanel.renderConversation(v);
                if (q.has('tracking')) LivePanel.renderTracking(v);
                if (q.has('log')) LivePanel.renderLog(v);
                if (q.has('settings')) LivePanel.renderSettings(v);
                if (q.has('about') && typeof LiveAbout !== 'undefined' && LiveAbout.isOpen()) LiveAbout.update(this._aboutState());
            } catch (e) { console.warn('Live Coworker render:', e); }
        },

        _tick() {
            if (!this.enabled || !this._panelVisible()) return;
            this._checkHealth();
            const parts = ['head'];
            if (this._replay && this._replay.playing) parts.push('replay');
            this.request(...parts);
            LivePanel.refreshTimes(Date.now());
        },
    };

    window.LiveApp = LiveApp;

    const boot = () => {
        try {
            if (typeof ModeManager === 'undefined' || !ModeManager.isStudyLocked || ModeManager.isStudyLocked() !== false) return;
            if (!document.getElementById('ai-panel') || typeof LivePanel === 'undefined' || typeof LiveCore === 'undefined') return;
            LiveApp.init();
        } catch (e) { console.warn('Live Coworker did not start:', e); }
    };
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
    else boot();
})();
