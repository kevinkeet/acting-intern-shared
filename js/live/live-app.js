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

        // ── start-up ─────────────────────────────────────────────────────
        init() {
            if (this._inited) return;
            this._inited = true;
            this.settings = Object.assign({ brain: 'claude-sonnet-5-5', mode: null, fast: false, source: 'room', chime: true, speakAloud: false, voice: '', glasses: false, replaySpeed: 2, classic: false }, this._load());
            if (!this.settings.mode) {
                let old = null;
                try { old = typeof AIModeConfig !== 'undefined' && AIModeConfig.getMode && AIModeConfig.getMode(); } catch (e) { /* ignore */ }
                this.settings.mode = OLD_TO_MODE[old && (old.id || old)] || 'abreast';
            }
            this.view = this._freshView();
            this._fetchHealth();
            if (typeof LiveVoice !== 'undefined' && LiveVoice.supported()) {
                LiveVoice.voiceName = this.settings.voice || null;
                LiveVoice.onError = (reason) => { if (reason === 'not-allowed') this._flash('Click anywhere on the page once so the coworker can speak.'); };
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
            };
        },

        _load() { try { return JSON.parse(localStorage.getItem(STORE) || '{}') || {}; } catch (e) { return {}; } },
        _save() { try { localStorage.setItem(STORE, JSON.stringify(this.settings)); } catch (e) { /* ignore */ } },

        async _fetchHealth() {
            try {
                this.health = await fetch('/api/health').then((r) => (r.ok ? r.json() : null));
            } catch (e) { this.health = null; }
            this.view.deepgram = !!(this.health && this.health.deepgramConfigured);
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
            if (typeof SimulationScoreTracker !== 'undefined' && SimulationScoreTracker.trackOrder && !SimulationScoreTracker._liveWrapped) {
                const origTrack = SimulationScoreTracker.trackOrder;
                SimulationScoreTracker.trackOrder = function (order) {
                    const r = origTrack.apply(this, arguments);
                    try {
                        if (LiveApp.enabled && LiveApp.engine && order) {
                            if (!LiveApp.engine.running) LiveApp.onPanelOpen();
                            LiveApp._pendingLabel = 'EHR order';
                            LiveApp.engine.order({ name: order.name, details: order.details, priority: order.priority, category: order.category });
                        }
                    } catch (e) { console.warn('Live Coworker order hook:', e); }
                    return r;
                };
                SimulationScoreTracker._liveWrapped = true;
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
            let md = null, facts = null, note = '';
            try {
                const r = await fetch('data/live/' + patientId + '-deep-memory.json', { cache: 'no-store' });
                if (r.ok) {
                    const fx = await r.json();
                    md = fx.memoryDocument || null;
                    facts = fx.extractedFacts || null;
                    const dlState = fx.deepLearn || {};
                    note = 'Long-term memory: full chart review (' + (dlState.processedCount || (facts && facts.length) || '?') + ' of ' + (dlState.totalItems || '?') + ' documents)';
                }
            } catch (e) { /* no fixture */ }
            if (!md) {
                try { md = AICoworker.longitudinalDoc && AICoworker.longitudinalDoc.aiMemory && AICoworker.longitudinalDoc.aiMemory.memoryDocument; } catch (e) { md = null; }
                note = md ? 'Long-term memory: partial chart review only' : 'No long-term memory yet: working from the chart';
            }
            if (this.patientId !== patientId) return;
            this.chart = chart;
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
                const display = this._pendingLabel || SPEAKER_LABEL[l.speaker] || l.speaker;
                v.lines.push({ id: l.id, t: l.t, speaker: l.speaker, label: display, text: l.text.replace(/^\((wife|nurse)\)\s*/i, '') });
                this._pendingLabel = null;
                v.interim = null;
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
                if (s.kind === 'critical') { v.alerts.unshift(item); this._chime(); }
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

        copyNote() {
            const n = this.view.note;
            if (!n) return;
            const text = ['Problem representation', n.problem_representation, '', 'HPI', n.hpi || '(none yet)', '', 'Assessment and plan']
                .concat((n.problems || []).map((p, i) => [(i + 1) + '. ' + p.name + (p.assessment ? ': ' + p.assessment : '')].concat(p.plan.map((x) => '   - ' + x)).join('\n')))
                .join('\n');
            const done = () => this._flash('Note copied.');
            try { navigator.clipboard.writeText(text).then(done, () => this._flash('Could not copy (the browser blocked it).')); } catch (err) { this._flash('Could not copy.'); }
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
                onAck: (id) => { this.view.alerts = this.view.alerts.filter((a) => a.id !== id); this.request('alerts', 'said', 'take'); },
                onRetry: (q) => { if (q) this.ask(q); },
                onUnfold: (id) => { this.view.openAlerts = Object.assign({}, this.view.openAlerts, { [id]: true }); this.request('alerts'); },
                onTellHeld: (topic) => { if (this.engine) this.engine.tell(topic); this.view.heldOpen = true; },
                onTakeToggle: () => { this.view.takeOpen = !this.view.takeOpen; this.request('take'); },
                onReplay: (cmd) => this.replay(cmd),
                onPrime: () => { if (!this.engine) return; if (!this.engine.running) this.onPanelOpen(); else { this.view.takeLoading = !this.view.take; this.engine.prime(); this.request('take'); } LivePanel.togglePop(false); },
                onReset: () => { this.encounter = null; this.newEncounter(); LivePanel.togglePop(false); },
                onClassic: () => { LivePanel.togglePop(false); this.setEnabled(false); },
                onSetting: (name, value) => this.setSetting(name, value),
                onOpenSettings: () => this.request('settings'),
                onVoiceTest: () => { if (typeof LiveVoice === 'undefined') return; LiveVoice.voiceName = this.settings.voice || null; LiveVoice.stop(); LiveVoice.say('Safety. Hold the heparin drip: black stools and hemoglobin 10.2.', { urgent: true }); },
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
                if (typeof LiveVoice !== 'undefined') { LiveVoice.voiceName = this.settings.voice || null; LiveVoice.stop(); LiveVoice.say('This is how I sound.'); }
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
                if (text && this.engine) this.engine.hear({ speaker: role, text });
            };
            const startedAt = Date.now();
            DG.onTranscript = (r) => {
                if (!this._mic) return;
                if (this._heardOwnVoice(r.transcript, r.isFinal)) return;
                if (!r.isFinal) {
                    this.view.interim = { speaker: SPEAKER_LABEL[r.speakerRole] || 'Voice', text: (buf && buf.role === r.speakerRole ? buf.parts.join(' ') + ' ' : '') + r.transcript };
                    if (!LivePanel.setInterim(this.view.interim)) this.request('transcript');
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
                    if (res.isFinal) { const t = res[0].transcript.trim(); if (t && this.engine) this.engine.hear({ speaker: 'unknown', text: t }); }
                    else interim += res[0].transcript;
                }
                this.view.interim = interim ? { speaker: 'Voice', text: interim } : null;
                if (!LivePanel.setInterim(this.view.interim)) this.request('transcript');
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
                LiveVoice.voiceName = this.settings.voice || null;
                LiveVoice.say((s.kind === 'critical' ? 'Safety. ' : '') + s.text, { urgent: s.kind === 'critical' });
            } catch (e) { /* speaking is optional */ }
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

        renderAll() { this.request('head', 'replay', 'alerts', 'take', 'said', 'note', 'tracking', 'transcript', 'log', 'settings'); },

        _render(q) {
            if (!LivePanel.el || !this.enabled) return;
            const v = this.view;
            v.now = Date.now();
            v.engineNow = this.engine ? this.engine.elapsed : null;
            v.mode = this.settings.mode;
            v.settings = this.settings;
            v.health = this._healthView();
            v.encounter = this.encounter ? Object.assign({}, this.encounter) : null;
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
                if (q.has('take')) LivePanel.renderTake(v);
                if (q.has('said') || q.has('transcript')) LivePanel.renderConversation(v);
                if (q.has('tracking')) LivePanel.renderTracking(v);
                if (q.has('log')) LivePanel.renderLog(v);
                if (q.has('settings')) LivePanel.renderSettings(v);
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
