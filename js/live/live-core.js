/**
 * Live Coworker: the real-time engine.
 *
 *   lines in ──► EAR (Haiku, every few lines) ──► WORKING MEMORY (small, always current)
 *                   │ question / tripwire / alarm / "worth a look"
 *                   ▼
 *               BRAIN (Sonnet or Opus): answer · verify · update (heartbeat) · prime
 *                   │ tools: lookup_labs, search_chart (exact) · ask_long_term_memory,
 *                   │        check_medication (cheap helper models)
 *                   ▼
 *               SPEAKING RULES (code, not prompt): answers always; critical always;
 *               insights only in Lead (rate-limited); never repeat; else hold.
 *
 * No DOM here: the browser panel and the Node replay harness both drive this
 * same object and listen to its events.
 */
(function (root) {
    'use strict';

    const isNode = typeof module !== 'undefined' && module.exports;
    const P = isNode ? require('./live-prompts.js') : root.LivePrompts;

    const DEFAULTS = {
        earModel: 'claude-haiku-5-5',
        brainModel: 'claude-sonnet-5-5',
        helperModel: 'claude-haiku-5-5',
        mode: 'abreast',              // follow | abreast | lead
        speed: null,                  // 'fast' = Opus fast mode
        noteModel: 'claude-haiku-5-5',  // the scribe that keeps the live note current
        actionsModel: 'claude-haiku-5-5', // keeps the doctor's orders and to-dos ("On my radar")
        effort: { ear: 'low', answer: 'low', verify: 'low', update: 'low', prime: 'medium', helper: 'medium', memory: 'low', note: 'low', actions: 'low' },
        maxTokens: { ear: 2000, answer: 6000, verify: 3000, update: 9000, prime: 9000, helper: 3000, note: 4000, actions: 4000 },
        noteGapMs: 12000,             // the live note is rewritten at most this often
        noteDelayMs: 3000,            // after new speech, wait this long so a few lines go in together
        actionsDelayMs: 1200,         // after a plan item is heard, wait this long so a dictated plan goes in together
        dictationNoteDelayMs: 1500,   // while the doctor dictates the exam, the note catches up sooner
        dictationNoteGapMs: 5000,
        maxActions: 40,
        earThinking: 'disabled',      // Haiku 5.5 accepts disabled at low..high effort
        memoryThinking: 'disabled',   // the long-term memory helper: lookup, not reasoning (2-5 s instead of 6-9 s on a 319K-token record)
        heartbeatMs: 90000,           // refresh the take this often while things change
        quickLookMs: 20000,           // sooner after something "worth a look"
        minUpdateGapMs: 60000,        // but never two take updates closer than this (cost)
        insightGapMs: 120000,         // Lead: at most one unprompted insight per 2 minutes
        repeatWindowMs: 15 * 60000,   // never repeat a topic within this window
        recentLines: 12,              // verbatim lines the ear sees as context
        brainLines: 24,               // verbatim lines the brain sees
        maxToolRounds: 3,
        wakeWords: /\b(?:hey\s+)?(?:co-?worker|claude)\b[,:]?\s*/i,
        wakeSettleMs: 900,            // a finished-sounding question waits this long for more words
        wakeJoinMs: 3500,             // an unfinished one ("Coworker, um...") waits up to this long
    };

    const realClock = {
        now: () => Date.now(),
        setTimeout: (fn, ms) => setTimeout(fn, ms),
        clearTimeout: (h) => clearTimeout(h),
    };

    const normText = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();
    const words = (s) => new Set(normText(s).split(' ').filter((w) => w.length > 2));
    function overlap(a, b) {
        const A = words(a), B = words(b);
        if (!A.size || !B.size) return 0;
        let n = 0;
        for (const w of A) if (B.has(w)) n++;
        return n / Math.min(A.size, B.size);
    }
    /** Shared words over all words: tells "Magnesium in the morning" closer to itself than to "BMP and magnesium in the morning". */
    function sameness(a, b) {
        const A = words(a), B = words(b);
        let n = 0;
        for (const w of A) if (B.has(w)) n++;
        return n / Math.max(1, new Set([...A, ...B]).size);
    }
    const clip = (s, n) => { s = String(s || ''); return s.length > n ? s.slice(0, n - 1) + '…' : s; };
    const mmss = (ms) => { const s = Math.max(0, Math.round(ms / 1000)); return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'); };

    // ── radar guards (code, not prompt) ──────────────────────────────────
    // "Hold spironolactone tonight" is a nursing order: as a medication order, signing it would give the drug.
    const HOLD_RE = /^(?:hold|stop|discontinue|d\/c|no|do not|don'?t)\b/i;
    // The doctor taking up the coworker's suggestion ("let's do that").
    // It must point back at the suggestion: "Okay, let's push diltiazem" is a new order, not a yes.
    const ACCEPT_RE = /\b(?:let'?s do (?:that|it|this)|do (?:that|it)|go ahead|sounds good|that works|agreed|please do|(?:go|let'?s go) with (?:that|it|this|yours?)|(?:use|start|order|give) (?:that|it|this))\b/i;
    // Names said for the same drug (brand, generic, short forms), so "Lasix" heard counts for "Furosemide" on the radar.
    const DRUG_NAMES = [
        ['furosemide', 'lasix'], ['bumetanide', 'bumex'], ['torsemide', 'demadex'], ['piperacillin', 'tazobactam', 'zosyn'], ['diltiazem', 'cardizem', 'dilt'],
        ['metoprolol', 'lopressor', 'toprol'], ['carvedilol', 'coreg'], ['spironolactone', 'aldactone'], ['sacubitril', 'valsartan', 'entresto'],
        ['warfarin', 'coumadin'], ['apixaban', 'eliquis'], ['rivaroxaban', 'xarelto'], ['enoxaparin', 'lovenox'], ['pantoprazole', 'protonix'],
        ['ceftriaxone', 'rocephin'], ['azithromycin', 'zithromax', 'azithro', 'zpack'], ['vancomycin', 'vanc', 'vanco'], ['cefepime', 'maxipime'],
        ['gabapentin', 'neurontin'], ['metformin', 'glucophage'], ['naproxen', 'aleve', 'naprosyn'], ['ibuprofen', 'motrin', 'advil'],
        ['acetaminophen', 'tylenol'], ['ketorolac', 'toradol'], ['potassium', 'kcl'], ['empagliflozin', 'jardiance'], ['dapagliflozin', 'farxiga'],
        ['atorvastatin', 'lipitor'], ['clopidogrel', 'plavix'], ['nitroglycerin', 'nitro'], ['amiodarone', 'amio', 'cordarone', 'pacerone'], ['digoxin', 'lanoxin'],
        ['insulin', 'lantus', 'glargine', 'humalog', 'lispro', 'novolog', 'aspart'], ['ondansetron', 'zofran'], ['lorazepam', 'ativan'], ['haloperidol', 'haldol'],
    ];
    const NOT_A_NAME = new Set(['hydrochloride', 'succinate', 'tartrate', 'sodium', 'calcium', 'chloride', 'mesylate', 'besylate', 'maleate', 'extended', 'release', 'tablet', 'injection', 'solution', 'drip', 'push', 'infusion', 'oral', 'tonight', 'today', 'daily']);
    /** The words that name a drug: "Piperacillin-tazobactam (Zosyn)" -> piperacillin, tazobactam, zosyn. */
    const drugWords = (name) => normText(name).split(' ').filter((w) => w.length >= 4 && !/^\d/.test(w) && !NOT_A_NAME.has(w));

    function newMemory() {
        return {
            startedAt: null,
            lines: [],            // {id, t, speaker, text, viaAi?}
            facts: [],            // {id, t, text, kind, from, line}
            thinking: [],         // doctor's reasoning: {t, text}
            plan: [],             // {id, t, text, kind, line, from?, radar?}
            actions: [],          // "On my radar": {id, t, kind, title, orderType, fields, to, noteType, draft, next, status, flag, flagLevel, alert, line, statusBy}
            take: null,           // brain's current take + t
            takes: [],            // each version of the take, and what was new since the one before:
                                  // {n, t, why, take, facts[], thinking[], plan[], said[]} (the first and the latest 39)
            notePRs: [],          // the live note's problem representation each time it changed: {t, text}
            noteRaw: null,        // the scribe's own version; wm.note is this with the doctor's edits laid over it
            noteEdits: { pr: null, hpi: null, problems: [] },   // what the doctor wrote: kept over every rewrite
                                  // problems: {key, name, assessment, plan, removed[], added[]} (null = the scribe's)
            watch: [],            // tripwires for the ear
            said: [],             // {id, t, kind, topic, text, why, latencyMs, cueLine}
            held: [],             // thoughts kept for when asked: {t, topic, text, why, kind}
            note: null,           // live note: {problem_representation, hpi, problems[], t}
            version: 0,
        };
    }

    function createCoworker(opts) {
        const o = opts || {};
        const cfg = Object.assign({}, DEFAULTS, o.config || {});
        cfg.effort = Object.assign({}, DEFAULTS.effort, (o.config || {}).effort || {});
        cfg.maxTokens = Object.assign({}, DEFAULTS.maxTokens, (o.config || {}).maxTokens || {});
        const transport = o.transport;
        const chart = o.chart;
        const clock = o.clock || realClock;
        const memory = o.memory || { digest: '', longTerm: '' };
        const listeners = new Map();

        const wm = newMemory();
        let lineSeq = 0, factSeq = 0, saidSeq = 0, planSeq = 0, actionSeq = 0;
        let running = false;
        let earBusy = false;
        let earQueue = [];            // lines waiting for the ear
        let updateBusy = false, updateAgain = false;
        let dirtySince = null;        // time of the first change the brain has not seen
        let heartbeatTimer = null, quickTimer = null;
        let lastInsightAt = -Infinity;
        const inflightVerify = new Set();
        const calls = [];             // per-call log for meters and the harness
        const aborters = new Set();
        const handledLines = new Set(); // lines already answered via the wake-word path
        const pending = new Set();    // promises of work in flight (harness waits on these)

        // ── events ────────────────────────────────────────────────────────
        function on(name, fn) {
            if (!listeners.has(name)) listeners.set(name, new Set());
            listeners.get(name).add(fn);
            return () => listeners.get(name).delete(fn);
        }
        function emit(name, payload) {
            for (const fn of listeners.get(name) || []) { try { fn(payload); } catch (e) { /* a listener's bug is not ours */ } }
            for (const fn of listeners.get('*') || []) { try { fn(name, payload); } catch (e) { /* ignore */ } }
        }
        const elapsed = () => (wm.startedAt == null ? 0 : clock.now() - wm.startedAt);
        function touch() { wm.version++; emit('wm', wm); }
        function track(p) { pending.add(p); p.finally(() => pending.delete(p)); return p; }

        // ── static context ────────────────────────────────────────────────
        function patientHeader() {
            if (!chart || !chart.loaded) return 'PATIENT: (chart not loaded)';
            const d = chart.demographics || {};
            const age = chart.age();
            const sex = (d.sex || d.gender || '').charAt(0);
            const allergies = chart.allergies.map((a) => a.substance + (a.reaction ? ' (' + a.reaction + ')' : '')).join('; ') || 'none recorded';
            const meds = chart.meds.map((m) => [m.name, m.dose, m.frequency].filter(Boolean).join(' ')).join('; ');
            const probs = chart.problems.map((p) => p.name).join('; ');
            return [
                'PATIENT: ' + [d.firstName, d.lastName].filter(Boolean).join(' ') + ', ' + (age != null ? age : '?') + sex,
                'ALLERGIES: ' + allergies,
                'PROBLEMS: ' + probs,
                'HOME MEDICATIONS: ' + meds,
            ].join('\n');
        }
        let earSystemCache = null;
        function earSystem() {
            if (!earSystemCache) {
                earSystemCache = [
                    { type: 'text', text: P.EAR_SYSTEM },
                    { type: 'text', text: patientHeader(), cache_control: { type: 'ephemeral' } },
                ];
            }
            return earSystemCache;
        }
        let brainSystemCache = null;
        function brainSystem() {
            if (!brainSystemCache) {
                const digest = memory.digest || patientHeader();
                brainSystemCache = [
                    { type: 'text', text: P.BRAIN_SYSTEM },
                    { type: 'text', text: 'PATIENT CHART DIGEST (chart plus the coworker\'s long-term memory; may be out of date for today):\n\n' + digest, cache_control: { type: 'ephemeral' } },
                ];
            }
            return brainSystemCache;
        }

        // ── working memory renderings ────────────────────────────────────
        const lineText = (l) => l.id + ' [' + mmss(l.t) + '] ' + l.speaker.toUpperCase() + (l.dictation === 'exam' ? ' (dictating the exam)' : l.via === 'note' ? ' (in the note)' : '') + ': ' + l.text;

        function renderForEar(newLines) {
            const newIds = new Set(newLines.map((l) => l.id));
            const ctx = wm.lines.filter((l) => !newIds.has(l.id)).slice(-cfg.recentLines);
            return [
                '<working_memory>',
                'Facts so far: ' + (wm.facts.length ? wm.facts.map((f) => f.text).join(' | ') : '(none)'),
                'Doctor\'s thinking: ' + (wm.thinking.length ? wm.thinking.map((x) => x.text).join(' | ') : '(none)'),
                'Plan so far: ' + (wm.plan.length ? wm.plan.map((x) => x.text).join(' | ') : '(none)'),
                '</working_memory>',
                '<watch_list>',
                wm.watch.length ? wm.watch.map((w) => w.id + ': ' + w.trigger).join('\n') : '(empty)',
                '</watch_list>',
                '<earlier_lines>',
                ctx.length ? ctx.map(lineText).join('\n') : '(start of encounter)',
                '</earlier_lines>',
                '<new_lines>',
                newLines.map(lineText).join('\n'),
                '</new_lines>',
            ].join('\n');
        }

        function renderForBrain() {
            const take = wm.take;
            const out = [
                'MODE: ' + cfg.mode.toUpperCase(),
                'ENCOUNTER TIME: ' + mmss(elapsed()),
                '<working_memory>',
                'FACTS HEARD THIS VISIT:',
                wm.facts.length ? wm.facts.map((f) => '- [' + f.from + '] ' + f.text).join('\n') : '- (none yet)',
                'DOCTOR\'S THINKING (weigh this most):',
                wm.thinking.length ? wm.thinking.map((x) => '- ' + x.text).join('\n') : '- (not stated yet)',
                'PLAN AND ORDERS SAID:',
                wm.plan.length ? wm.plan.map((x) => '- (' + x.kind + ') ' + x.text).join('\n') : '- (none yet)',
            ];
            // The doctor's to-do list, so "what do I still need to order?" has an answer.
            if (wm.actions.length) {
                const st = (a) => (a.status === 'todo' ? 'to do' + (a.flag ? (a.flagLevel === 'check' ? ', check first: ' : ', flagged: ') + a.flag : '') : a.status === 'done' ? 'done' : 'removed');
                out.push('ON THE DOCTOR\'S RADAR (what the doctor asked for, ready to sign; the doctor sees this list):');
                out.push(wm.actions.filter((a) => a.status !== 'dropped').slice(-25).map((a) => '- [' + st(a) + '] ' + a.kind + ': ' + a.title).join('\n') || '- (nothing open)');
            }
            out.push(
                'YOUR CURRENT TAKE' + (take ? ' (from ' + mmss(take.t) + ')' : '') + ':',
                take ? ['- ' + take.one_liner, '- ' + take.assessment].concat((take.concerns || []).map((c) => '- concern [' + c.topic + ', ' + c.severity + ']: ' + c.text)).join('\n') : '- (none yet)',
                'WATCH LIST:',
                wm.watch.length ? wm.watch.map((w) => '- ' + w.id + ' (' + w.severity + '): ' + w.trigger).join('\n') : '- (empty)',
                'OPEN SAFETY ALERTS (on the doctor\'s screen until acknowledged; a new point about the same problem is an update to that id):',
                openAlerts().length ? openAlerts().map((x) => '- ' + x.s.id + ' [' + mmss(x.s.t) + ', ' + x.s.topic + '] ' + x.s.text + x.updates.map((u) => ' | update [' + mmss(u.t) + ']: ' + u.text).join('')).join('\n') : '- (none)',
                'ALREADY SAID (do not repeat):',
                wm.said.length ? wm.said.map((s) => '- [' + mmss(s.t) + ', ' + s.kind + (s.updateOf ? ', update to ' + s.updateOf : '') + (s.acked ? ', acknowledged' : '') + ', ' + s.topic + '] ' + s.text).join('\n') : '- (nothing yet)',
                'HELD FOR WHEN ASKED:',
                wm.held.length ? wm.held.map((h) => '- [' + h.topic + '] ' + h.text).join('\n') : '- (nothing)',
                '</working_memory>',
                '<recent_conversation>',
                wm.lines.length ? wm.lines.slice(-cfg.brainLines).map(lineText).join('\n') : '(no conversation yet)',
                '</recent_conversation>',
            );
            return out.join('\n');
        }

        // ── model calls ──────────────────────────────────────────────────
        /** What a prompt is made of, in characters: fixed parts first (cacheable), then what changes per call. */
        function partsOf(lane, body) {
            const sys = Array.isArray(body.system) ? body.system : body.system ? [{ text: String(body.system) }] : [];
            const p = { tools: body.tools ? JSON.stringify(body.tools).length : 0, rules: sys[0] ? String(sys[0].text || '').length : 0, digest: 0, longterm: 0, memory: 0, conversation: 0, lookups: 0, task: 0 };
            const ctx = sys.slice(1).reduce((a, b) => a + String(b.text || '').length, 0);
            if (lane === 'helper' && ctx > 60000) p.longterm = ctx; else p.digest = ctx;
            const textOf = (m) => (typeof m.content === 'string' ? m.content : (m.content || []).map((b) => (b.type === 'tool_result' ? String(b.content || '') : b.type === 'tool_use' ? JSON.stringify(b.input || {}) : b.text || '')).join(''));
            (body.messages || []).forEach((m, i) => {
                const t = textOf(m);
                if (i > 0) { p.lookups += t.length; return; }
                let rest = t.replace(/<(recent_conversation|conversation|earlier_lines|new_lines)>[\s\S]*?<\/\1>/g, (x) => { p.conversation += x.length; return ''; });
                rest = rest.replace(/<([a-z_]+)>[\s\S]*?<\/\1>/g, (x) => { p.memory += x.length; return ''; });
                p.task += rest.length;
            });
            return p;
        }

        async function modelCall(lane, model, body, hooks) {
            const ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
            if (ctrl) aborters.add(ctrl);
            const entry = { lane, model, at: elapsed(), ok: false, parts: partsOf(lane, body) };
            emit('call-start', entry);
            try {
                const res = await transport.callWithRetry({ model, body, speed: lane === 'ear' || lane === 'helper' ? null : cfg.speed, label: lane },
                    Object.assign({}, hooks || {}, { signal: ctrl && ctrl.signal }));
                Object.assign(entry, { ok: true, ms: res.ms, usage: res.usage, cost: res.cost, servedBy: res.servedBy, fellBack: res.fellBack, stop: res.message.stop_reason });
                if (res.message.stop_reason === 'refusal') entry.refusal = (res.message.stop_details && res.message.stop_details.category) || 'unknown';
                calls.push(entry);
                emit('call', entry);
                return res;
            } catch (e) {
                Object.assign(entry, { ok: false, error: (e && e.message) || String(e) });
                calls.push(entry);
                emit('call', entry);
                if (!(e && e.name === 'AbortError')) emit('error', { lane, message: entry.error });
                throw e;
            } finally {
                if (ctrl) aborters.delete(ctrl);
            }
        }

        function parseJSON(res) {
            if (res.message.stop_reason === 'refusal') return null;
            const txt = res.text.trim();
            try { return JSON.parse(txt); } catch (e) {
                const a = txt.indexOf('{'), b = txt.lastIndexOf('}');
                if (a >= 0 && b > a) { try { return JSON.parse(txt.slice(a, b + 1)); } catch (e2) { /* fall through */ } }
                return null;
            }
        }

        const thinkingFor = (lane, model) => {
            if (lane === 'ear') return model === 'claude-haiku-5-5' && cfg.earThinking === 'disabled' ? { type: 'disabled' } : { type: 'adaptive' };
            if (lane === 'update' || lane === 'prime') return { type: 'adaptive', display: 'summarized' };
            return { type: 'adaptive' };
        };

        function brainBody(lane, userText, extra) {
            const body = {
                max_tokens: cfg.maxTokens[lane],
                system: brainSystem(),
                tools: P.BRAIN_TOOLS,
                tool_choice: { type: (extra && extra.toolChoice) || 'none' },
                thinking: thinkingFor(lane, cfg.brainModel),
                output_config: { effort: cfg.effort[lane] },
                messages: [{ role: 'user', content: [{ type: 'text', text: userText }] }],
            };
            if (extra && extra.schema) body.output_config.format = { type: 'json_schema', schema: extra.schema };
            return body;
        }

        // ── the ear ─────────────────────────────────────────────────────
        function hear(utt) {
            const text = String((utt && utt.text) || '').trim();
            if (!text) return null;
            if (wm.startedAt == null) wm.startedAt = clock.now();
            const line = { id: 'L' + (++lineSeq), t: elapsed(), speaker: (utt.speaker || 'unknown').toLowerCase(), text };
            // The doctor dictating the physical exam (the panel's "Dictate exam", or typed): findings for the note.
            if (utt.mode === 'exam') { line.dictation = 'exam'; lastDictationAt = line.t; }
            if (utt.typed) line.typed = true;
            wm.lines.push(line);
            emit('line', line);
            touch();
            if (line.dictation) scheduleNote(cfg.dictationNoteDelayMs, cfg.dictationNoteGapMs);

            // Fast path: "Coworker, what was his last potassium?" goes straight to the brain,
            // once the question sounds finished. Speech arrives in pieces, so "Coworker,
            // um..." waits for the rest, and a finished-sounding question still waits a
            // beat in case the doctor keeps going.
            const m = text.match(cfg.wakeWords);
            const w = pendingWake;
            if (w && line.speaker === w.speaker && elapsed() - w.lastAt <= cfg.wakeJoinMs) {
                const rest = m ? text.slice(m.index + m[0].length) : text;
                w.text = (w.text + ' ' + rest).trim();
                w.lastAt = elapsed();
                handledLines.add(line.id);
                settleWake();
            } else if (m && line.speaker !== 'patient') {
                if (w) askWake();   // a new question; the one before goes as it stands
                pendingWake = { speaker: line.speaker, text: text.slice(m.index + m[0].length).trim(), cue: line, lastAt: elapsed(), timer: null };
                handledLines.add(line.id);
                settleWake();
            }
            earQueue.push(line);
            pumpEar();
            return line;
        }

        // ── the question after a wake word ───────────────────────────────
        let pendingWake = null;
        const FILLER = /,?\s*\b(?:uh[- ]huh|mm[- ]hmm|u+m+|u+h+|e+r+m*|a+h+|h+m+|m+h*m+|you know|i mean)\b[,.…]*/gi;
        const UNFINISHED = /\b(?:and|or|but|so|the|a|an|his|her|their|of|to|for|with|about|on|in|at|from|is|was|are|were|what|what's|whats|how|when|where|which|who|why|should|can|could|would|do|does|did|we|i|he|she|it|any|like|then)[,.…]*$/i;
        function cleanQuestion(text) {
            const q = String(text || '').replace(FILLER, ' ').replace(/^[\s,.;:…-]*(?:so|okay|ok|well|like|and)\b[,.]?\s*/i, '').replace(/\s+([,.?!])/g, '$1').replace(/\s+/g, ' ').replace(/^[\s,.;:…-]+/, '').trim();
            return q ? q.charAt(0).toUpperCase() + q.slice(1) : '';
        }
        /** Does it sound like the doctor finished asking? */
        function soundsDone(text) {
            const q = cleanQuestion(text);
            const words = q.split(/\s+/).filter((x) => /[a-z0-9]/i.test(x));
            if (!words.length) return false;
            if (/\?\s*$/.test(q)) return true;
            return words.length >= 3 && !UNFINISHED.test(q) && !/[,…-]\s*$/.test(q);
        }
        function settleWake() {
            const w = pendingWake;
            if (!w) return;
            if (w.timer) clock.clearTimeout(w.timer);
            w.timer = clock.setTimeout(askWake, soundsDone(w.text) ? cfg.wakeSettleMs : cfg.wakeJoinMs);
        }
        function askWake() {
            const w = pendingWake;
            pendingWake = null;
            if (!w) return;
            if (w.timer) clock.clearTimeout(w.timer);
            const q = cleanQuestion(w.text);
            if (!q) { emit('suppressed', { reason: 'wake word with no question', text: w.text }); return; }
            ask(q, { cueLine: w.cue.id, heardAt: w.cue.t, via: 'wake word' });
        }

        function pumpEar() {
            if (earBusy || !earQueue.length || !running) return;
            const batch = earQueue;
            earQueue = [];
            earBusy = true;
            const p = runEar(batch).catch(() => { /* logged in modelCall */ }).finally(() => { earBusy = false; pumpEar(); });
            track(p);
        }

        async function runEar(batch) {
            const body = {
                max_tokens: cfg.maxTokens.ear,
                system: earSystem(),
                thinking: thinkingFor('ear', cfg.earModel),
                output_config: { effort: cfg.effort.ear, format: { type: 'json_schema', schema: P.EAR_SCHEMA } },
                messages: [{ role: 'user', content: renderForEar(batch) }],
            };
            const res = await modelCall('ear', cfg.earModel, body);
            const out = parseJSON(res);
            if (!out) return;
            emit('ear', { lines: batch.map((l) => l.id), out, ms: res.ms });
            applyEar(out, batch);
        }

        function addFact(f, lineId) {
            const text = clip(f.text, 160);
            if (!text) return false;
            if (wm.facts.some((x) => normText(x.text) === normText(text) || overlap(x.text, text) >= 0.85)) return false;
            wm.facts.push({ id: 'F' + (++factSeq), t: elapsed(), text, kind: f.kind || 'other', from: f.from || 'other', line: lineId });
            return true;
        }

        function applyEar(out, batch) {
            const lastLine = batch[batch.length - 1];
            let changed = false;
            for (const fix of out.speaker_fix || []) {
                const l = wm.lines.find((x) => x.id === fix.line);
                if (l && fix.speaker && l.speaker !== fix.speaker) { l.speaker = fix.speaker; changed = true; }
            }
            for (const f of out.facts || []) changed = addFact(f, lastLine.id) || changed;
            for (const t of out.doctor_thinking || []) {
                if (t && !wm.thinking.some((x) => overlap(x.text, t) >= 0.85)) { wm.thinking.push({ t: elapsed(), text: clip(t, 200), line: lastLine.id }); changed = true; }
            }
            let newPlan = 0;
            for (const p of out.plan || []) {
                if (p && p.text && !wm.plan.some((x) => overlap(x.text, p.text) >= 0.85)) { wm.plan.push({ id: 'P' + (++planSeq), t: elapsed(), text: clip(p.text, 160), kind: p.kind || 'plan', line: lastLine.id }); newPlan++; changed = true; }
            }
            if (changed) { markDirty(); touch(); }
            if (newPlan) { emit('actions', wm.actions); scheduleActions(); }   // shown at once as "heard"; the radar lane gets it ready

            // Questions for the coworker (unless the wake-word path already took them).
            const askedHere = batch.some((l) => handledLines.has(l.id));
            if (out.to_coworker && out.question && !askedHere) {
                ask(out.question, { cueLine: lastLine.id, heardAt: lastLine.t, via: 'ear' });
            }
            // A question to the coworker gets an answer; a separate alert about the
            // same lines would only repeat it.
            scheduleNote();
            if (askedHere || out.to_coworker) {
                if (out.worth_a_look) scheduleQuickLook();
                if (batch.some((l) => l.speaker === 'doctor') && pendingChecks.length) onDoctorSpoke();
                return;
            }
            // Tripwires and alarms -> one safety check for these lines; the brain decides whether to interrupt.
            const reasons = [];
            for (const id of out.watch_hits || []) {
                const w = wm.watch.find((x) => x.id === id);
                if (w) reasons.push('watch item "' + w.id + '" fired: ' + w.trigger + ' (prepared alert: ' + w.alert + ')');
            }
            if (out.alarm === 'possible_critical') reasons.push(out.alarm_reason || 'possible safety issue');
            const check = reasons.length ? verify(reasons.join('; '), lastLine, 'lines:' + batch.map((l) => l.id).join(',')) : null;
            if (out.worth_a_look) scheduleQuickLook();
            // A held point gets its second look after this batch's own check: the doctor's
            // words often set off both about the same issue (a dismissed TIA, the diltiazem
            // that answers a fast heart rate), and the second look must see what was just said.
            if (batch.some((l) => l.speaker === 'doctor') && pendingChecks.length) {
                if (check) track(check.then(() => onDoctorSpoke())); else onDoctorSpoke();
            }
        }

        // ── brain: answer ────────────────────────────────────────────────
        function ask(question, meta) {
            const m = meta || {};
            const id = 'S' + (++saidSeq);
            const p = (async () => {
                emit('thinking', { lane: 'answer', id, question });
                const user = renderForBrain() + '\n\n' + P.taskAnswer(question);
                const messages = [{ role: 'user', content: [{ type: 'text', text: user }] }];
                let answer = '';
                const used = [];   // the lookups behind this answer
                for (let round = 0; round <= cfg.maxToolRounds; round++) {
                    const body = brainBody('answer', '', { toolChoice: round < cfg.maxToolRounds ? 'auto' : 'none' });
                    body.messages = messages;
                    let streamed = '';
                    const res = await modelCall('answer', cfg.brainModel, body, {
                        onText: (d) => { streamed += d; emit('say-partial', { id, text: streamed, question, via: m.via }); },
                    });
                    if (res.message.stop_reason === 'refusal') { answer = 'I can\'t help with that one.'; break; }
                    const uses = res.message.content.filter((b) => b.type === 'tool_use');
                    if (!uses.length || res.message.stop_reason !== 'tool_use') { answer = res.text.trim(); break; }
                    messages.push({ role: 'assistant', content: res.message.content });
                    emit('say-partial', { id, text: '', question, via: m.via, status: toolStatus(uses) });
                    const results = await Promise.all(uses.map((u) => runTool(u)));
                    uses.forEach((u, i) => used.push({ name: u.name, input: u.input || {}, result: clip(typeof results[i].content === 'string' ? results[i].content : '', 300), error: !!results[i].is_error }));
                    messages.push({ role: 'user', content: results });
                }
                deliver({ id, kind: 'answer', topic: 'answer', text: answer || 'Sorry, I lost that one.', why: '', question, cueLine: m.cueLine, heardAt: m.heardAt, via: m.via, tools: used });
            })().catch((e) => {
                if (e && e.name === 'AbortError') return;
                // Plain words for the doctor; the exact error is in the call log.
                const msg = String((e && e.message) || '');
                const why = /\b529\b|overload/i.test(msg) ? 'the AI service is overloaded'
                    : /\b429\b|rate/i.test(msg) ? 'too many requests right now'
                        : /reach|fetch|network|cut off|stream error/i.test(msg) ? 'the connection dropped' : 'the AI call failed';
                deliver({ id, kind: 'answer', topic: 'answer', text: 'Sorry, I couldn’t answer that just now (' + why + ').', why: '', question, cueLine: m.cueLine, heardAt: m.heardAt, error: true });
            });
            return track(p);
        }

        // ── brain: tools ─────────────────────────────────────────────────
        // What the panel shows while tools run, in plain words ("Checking labs…").
        const TOOL_WORDS = { lookup_labs: 'checking labs', search_chart: 'searching the chart', ask_long_term_memory: 'checking the history', check_medication: 'checking the medicine' };
        function toolStatus(uses) {
            const words = [...new Set(uses.map((u) => TOOL_WORDS[u.name] || 'looking it up'))];
            const s = words.length > 1 ? words.slice(0, -1).join(', ') + ' and ' + words[words.length - 1] : words[0] || 'looking it up';
            return s.charAt(0).toUpperCase() + s.slice(1) + '…';
        }

        async function runTool(use) {
            const input = use.input || {};
            let content;
            try {
                if (use.name === 'lookup_labs') {
                    content = JSON.stringify(chart.lookupLabs(Array.isArray(input.tests) ? input.tests : [String(input.tests || '')], input.how_many || 3));
                } else if (use.name === 'search_chart') {
                    const hits = await chart.search(String(input.query || ''), 6);
                    content = hits.length ? hits.map((h) => '[' + h.date + '] ' + h.title + ': ' + h.snippet).join('\n\n') : 'No matches.';
                } else if (use.name === 'ask_long_term_memory') {
                    content = await helperMemory(String(input.question || ''));
                } else if (use.name === 'check_medication') {
                    content = await helperMedCheck(input);
                } else {
                    return { type: 'tool_result', tool_use_id: use.id, content: 'Unknown tool ' + use.name + '. Available: lookup_labs, search_chart, ask_long_term_memory, check_medication.', is_error: true };
                }
            } catch (e) {
                return { type: 'tool_result', tool_use_id: use.id, content: 'Lookup failed: ' + clip(e && e.message, 120), is_error: true };
            }
            emit('tool', { name: use.name, input, result: clip(content, 400) });
            return { type: 'tool_result', tool_use_id: use.id, content: clip(content, 12000) };
        }

        async function helperMemory(question) {
            if (!memory.longTerm) return 'No long-term memory is loaded for this patient.';
            const body = {
                max_tokens: cfg.maxTokens.helper,
                system: [{ type: 'text', text: P.MEMORY_SYSTEM }, { type: 'text', text: 'LONG-TERM RECORD SUMMARY:\n\n' + memory.longTerm, cache_control: { type: 'ephemeral' } }],
                thinking: cfg.helperModel === 'claude-haiku-5-5' && cfg.memoryThinking === 'disabled' ? { type: 'disabled' } : { type: 'adaptive' },
                output_config: { effort: cfg.effort.memory || cfg.effort.helper },
                messages: [{ role: 'user', content: question }],
            };
            const res = await modelCall('helper', cfg.helperModel, body);
            return res.text.trim() || 'Not in the record.';
        }

        async function helperMedCheck(input) {
            const v = chart.lastVitals();
            const labs = chart.lookupLabs(['potassium', 'creatinine', 'egfr', 'sodium', 'glucose', 'magnesium', 'inr', 'hemoglobin', 'platelets'], 2)
                .filter((x) => x.found).map((x) => x.test + ': ' + x.results.map((r) => r.value + (r.flag ? ' ' + r.flag : '') + ' (' + r.date + ')').join(', '));
            const ctx = [
                patientHeader(),
                'RECENT LABS: ' + labs.join('; '),
                v ? 'LAST VITALS: BP ' + v.systolic + '/' + v.diastolic + ', HR ' + v.heartRate + ', SpO2 ' + v.spO2 + ' (' + String(v.date).slice(0, 10) + ')' : '',
                wm.facts.length ? 'TODAY: ' + wm.facts.map((f) => f.text).join(' | ') : '',
            ].filter(Boolean).join('\n');
            const body = {
                max_tokens: cfg.maxTokens.helper,
                system: [{ type: 'text', text: P.MEDCHECK_SYSTEM }],
                output_config: { effort: cfg.effort.helper, format: { type: 'json_schema', schema: P.MEDCHECK_SCHEMA } },
                messages: [{ role: 'user', content: ctx + '\n\nCHECK: ' + [input.drug, input.dose].filter(Boolean).join(' ') + (input.context ? '\nContext: ' + input.context : '') }],
            };
            const res = await modelCall('helper', cfg.helperModel, body);
            const out = parseJSON(res);
            return out ? JSON.stringify(out) : res.text;
        }

        // ── brain: verify a possible critical ───────────────────────────
        // Concerns the brain is holding to see whether the doctor addresses them.
        const pendingChecks = [];

        // ── open alerts: on the doctor's screen until "Got it" ───────────
        // A new remark about a problem already on screen becomes an update to that
        // card, not a new alert. The brain says so itself (update_of: it sees the open
        // alerts). Speech arrives in pieces, so two checks can also run side by side
        // and neither sees what the other is about to say: alerts that went up while
        // this check ran get a quick look from the helper instead.
        function openAlerts() {
            const now = elapsed();
            return wm.said.filter((s) => s.kind === 'critical' && !s.updateOf && !s.acked)
                .map((s) => ({ s, updates: wm.said.filter((u) => u.updateOf === s.id) }))
                .filter((x) => now - Math.max(x.s.t, ...x.updates.map((u) => u.t)) < cfg.repeatWindowMs);
        }

        /** The doctor pressed "Got it": the alert and its updates are closed. */
        function ack(id) {
            for (const s of wm.said) if (s.id === id || s.updateOf === id) s.acked = true;
            touch();
        }

        /** Place a critical remark: an update to an open alert, a new alert (true), or nothing new (false). */
        async function placeAlert(c, updateOf, since) {
            const open = openAlerts();
            if (updateOf && open.some((x) => x.s.id === updateOf)) c.updateOf = updateOf;
            const fresh = open.filter((x) => x.s.t >= since || x.updates.some((u) => u.t >= since));
            if (!fresh.length) return true;
            try {
                const listing = fresh.map((x) => '- ' + x.s.id + ': ' + x.s.text + x.updates.map((u) => ' Update: ' + u.text).join('')).join('\n');
                const body = {
                    max_tokens: 300,
                    system: P.RELATE_SYSTEM,
                    thinking: cfg.helperModel === 'claude-haiku-5-5' ? { type: 'disabled' } : { type: 'adaptive' },
                    output_config: { effort: 'low', format: { type: 'json_schema', schema: P.RELATE_SCHEMA } },
                    messages: [{ role: 'user', content: 'On the doctor\'s screen:\n' + listing + '\n\nNew alert:\n' + c.text }],
                };
                const out = parseJSON(await modelCall('helper', cfg.helperModel, body));
                const same = out && out.same_as && fresh.find((x) => x.s.id === out.same_as);
                if (same) {
                    if (!out.adds_new) return false;
                    c.updateOf = same.s.id;
                }
            } catch (e) { /* when unsure, speak */ }
            return true;
        }

        function verify(reason, cueLine, key, followUp) {
            if (inflightVerify.has(key)) return null;
            inflightVerify.add(key);
            const startedAt = elapsed();
            const wall0 = Date.now();   // real seconds (the demo's clock runs faster)
            const p = (async () => {
                emit('thinking', { lane: 'verify', reason });
                const body = brainBody('verify', renderForBrain() + '\n\n' + P.taskVerify(reason, followUp), { schema: P.VERIFY_SCHEMA });
                const res = await modelCall('verify', cfg.brainModel, body);
                const out = parseJSON(res);
                if (!out) return;
                const decision = out.decision || (out.should_say ? 'say' : 'quiet');
                emit('verified', { reason, out, decision, followUp: !!followUp, ms: elapsed() - startedAt });
                const cue = followUp ? followUp.cue : cueLine;
                if (decision === 'say' && out.text) {
                    const kind = out.severity === 'important' ? 'insight' : 'critical';
                    const c = { kind, topic: out.topic || key, text: out.text, why: out.why, cueLine: cue && cue.id, heardAt: cue && cue.t, via: followUp ? 'after waiting' : 'verify',
                        reason, checkMs: elapsed() - startedAt, checkWallMs: Date.now() - wall0, severity: out.severity, decision, waited: followUp ? followUp.rounds : 0 };
                    if (kind === 'critical' && !(await placeAlert(c, out.update_of, startedAt))) {
                        emit('suppressed', { reason: 'nothing new for an alert already on screen', topic: c.topic, text: c.text });
                        return;
                    }
                    consider(c);
                } else if (decision === 'wait' && (!followUp || followUp.rounds < 2)) {
                    holdForDoctor({ reason, key, topic: out.topic || '', text: out.text || out.why || reason, cue, rounds: followUp ? followUp.rounds + 1 : 1 });
                }
            })().catch(() => { /* logged */ }).finally(() => inflightVerify.delete(key));
            return track(p);
        }

        /** Look again after the doctor's next words, or after 30 s (script time) if they say nothing. */
        function holdForDoctor(item) {
            const entry = Object.assign({ at: elapsed(), lastLine: lineSeq }, item);
            entry.timer = clock.setTimeout(() => followUpCheck(entry), 30000);
            pendingChecks.push(entry);
            emit('waiting', { reason: item.reason, text: item.text });
        }

        function followUpCheck(entry) {
            const i = pendingChecks.indexOf(entry);
            if (i < 0) return;
            pendingChecks.splice(i, 1);
            clock.clearTimeout(entry.timer);
            if (!running) return;
            verify(entry.reason, entry.cue, 'follow:' + entry.key + ':' + entry.rounds, entry);
        }

        function onDoctorSpoke() {
            for (const entry of pendingChecks.slice()) {
                if (lineSeq > entry.lastLine) followUpCheck(entry);
            }
        }

        // ── brain: heartbeat update / prime ─────────────────────────────
        function markDirty() { if (dirtySince == null) dirtySince = elapsed(); }

        let lastUpdateAt = -Infinity;
        function scheduleQuickLook() {
            if (!running || quickTimer) return;
            const wait = Math.max(cfg.quickLookMs, lastUpdateAt + cfg.minUpdateGapMs - elapsed());
            quickTimer = clock.setTimeout(() => { quickTimer = null; update('quick look'); }, wait);
        }

        function startHeartbeat() {
            const beat = () => {
                heartbeatTimer = clock.setTimeout(() => {
                    if (!running) return;
                    if (dirtySince != null && elapsed() - lastUpdateAt >= cfg.minUpdateGapMs) update('heartbeat');
                    beat();
                }, cfg.heartbeatMs);
            };
            beat();
        }

        function applyTake(out, why) {
            if (out.take) {
                wm.take = Object.assign({}, out.take, { t: elapsed(), why });
                // Its picture of the patient over time: each version, with what it heard, the doctor's
                // thinking, the plan and its own alerts since the version before.
                const since = wm.takes.length ? wm.takes[wm.takes.length - 1].t : -1;
                const after = (list, n) => list.filter((x) => x.t > since).slice(-n);
                wm.takes.push({
                    n: wm.takes.length ? wm.takes[wm.takes.length - 1].n + 1 : 1, t: wm.take.t, why,
                    take: JSON.parse(JSON.stringify(out.take)),
                    facts: after(wm.facts, 14).map((f) => ({ id: f.id, t: f.t, text: f.text, kind: f.kind })),
                    thinking: after(wm.thinking, 6).map((x) => ({ t: x.t, text: x.text })),
                    plan: after(wm.plan, 8).map((x) => ({ t: x.t, text: x.text, kind: x.kind })),
                    said: after(wm.said, 6).filter((x) => x.kind !== 'answer').map((x) => ({ id: x.id, t: x.t, kind: x.kind, text: x.text })),
                });
                if (wm.takes.length > 40) wm.takes.splice(1, 1);   // keep the first and the latest
                emit('take', wm.take);
                scheduleNote(why === 'prime' ? 0 : null);
            }
            if (Array.isArray(out.watch)) {
                wm.watch = out.watch.slice(0, 10);
                emit('watch', wm.watch);
            }
            touch();
        }

        function update(why) {
            if (!running) return null;
            if (updateBusy) { updateAgain = true; return null; }
            updateBusy = true;
            lastUpdateAt = elapsed();
            const seenUpTo = elapsed();
            dirtySince = null;
            const p = (async () => {
                emit('thinking', { lane: 'update', why });
                const body = brainBody('update', renderForBrain() + '\n\n' + P.TASK_UPDATE, { schema: P.TAKE_SCHEMA });
                const res = await modelCall('update', cfg.brainModel, body);
                const out = parseJSON(res);
                if (!out) return;
                applyTake(out, why);
                const thoughts = res.message.content.filter((b) => b.type === 'thinking' && b.thinking).map((b) => b.thinking).join('\n');
                if (thoughts) emit('reasoning', { lane: 'update', text: thoughts, at: seenUpTo });
                if (out.say && out.say.should_say && out.say.text) {
                    // A concern already being held for the doctor's next words is left to that check.
                    const held = pendingChecks.some((p) => (p.topic && p.topic === out.say.topic) || overlap(p.text + ' ' + p.reason, out.say.text) >= 0.35);
                    const last = wm.lines[wm.lines.length - 1];
                    const c = { kind: out.say.kind === 'critical' ? 'critical' : 'insight', topic: out.say.topic, text: out.say.text, why: out.say.why, via: 'update', reason: 'its take update (' + why + ')' };
                    if (held) emit('suppressed', { reason: 'waiting for the doctor', kind: c.kind, topic: c.topic, text: c.text });
                    else if (c.kind === 'critical' && !(await placeAlert(c, out.say.update_of, seenUpTo))) {
                        // An update takes several seconds; an alert that went up meanwhile may already say it.
                        emit('suppressed', { reason: 'nothing new for an alert already on screen', kind: c.kind, topic: c.topic, text: c.text });
                    } else if (c.kind === 'critical' && last && last.speaker !== 'doctor' && !alreadySaid(c.topic, c.text)) {
                        // Something just raised by the patient, family or nurse: give the doctor a turn first.
                        holdForDoctor({ reason: 'your take update wanted to say: ' + c.text, key: 'update:' + (c.topic || last.id), topic: c.topic, text: c.text, cue: last, rounds: 1 });
                    } else consider(c);
                }
                wm.held = wm.held.filter((h) => !alreadySaid(h.topic, h.text)).slice(-8);
                touch();
            })().catch(() => { dirtySince = dirtySince == null ? seenUpTo : dirtySince; })
                .finally(() => {
                    updateBusy = false;
                    if (updateAgain) { updateAgain = false; scheduleQuickLook(); }
                });
            return track(p);
        }

        function prime() {
            const p = (async () => {
                emit('thinking', { lane: 'prime' });
                const body = brainBody('prime', renderForBrain() + '\n\n' + P.TASK_PRIME, { schema: P.TAKE_SCHEMA });
                const res = await modelCall('prime', cfg.brainModel, body);
                const out = parseJSON(res);
                if (out) applyTake(out, 'prime');
            })().catch(() => { /* logged */ });
            return track(p);
        }

        // ── the live note (scribe) ───────────────────────────────────────
        // A cheap, fast model rewrites the whole note a few seconds after new
        // speech (at most every noteGapMs), after each take update, and on demand
        // (end of the encounter). The doctor watches it take shape.
        let noteBusy = false, noteAgain = false, noteTimer = null, noteTimerAt = 0, lastNoteAt = -Infinity, lastDictationAt = null;
        let noteSystemCache = null;
        function noteSystem() {
            if (!noteSystemCache) {
                noteSystemCache = [
                    { type: 'text', text: P.NOTE_SYSTEM },
                    { type: 'text', text: 'PATIENT CHART DIGEST:\n\n' + (memory.digest || patientHeader()), cache_control: { type: 'ephemeral' } },
                ];
            }
            return noteSystemCache;
        }
        function renderForNote() {
            const t = wm.take;
            return [
                '<conversation>',
                wm.lines.length ? wm.lines.slice(-300).map(lineText).join('\n') : '(nothing heard yet)',
                '</conversation>',
                '<doctor_thinking>' + (wm.thinking.length ? wm.thinking.map((x) => x.text).join(' | ') : '(none stated)') + '</doctor_thinking>',
                '<plan_heard>' + (wm.plan.length ? wm.plan.map((x) => '[' + x.kind + '] ' + x.text).join(' | ') : '(none yet)') + '</plan_heard>',
                '<coworker_take>' + (t ? [t.assessment, (t.concerns || []).map((c) => c.text).join('; '), (t.next || []).join('; ')].filter(Boolean).join(' || ') : '(none yet)') + '</coworker_take>',
                '<previous_note>' + (wm.note ? JSON.stringify({ problem_representation: wm.note.problem_representation, hpi: wm.note.hpi, exam: wm.note.exam, problems: wm.note.problems }) : '(none yet)') + '</previous_note>',
                '<doctor_edits>' + (editsText() || '(none)') + '</doctor_edits>',
            ].join('\n');
        }
        /** What the doctor wrote in the note, for the scribe (it keeps the rest consistent; code keeps these as written). */
        function editsText() {
            const e = wm.noteEdits, out = [];
            if (e.pr != null) out.push('Problem representation (the doctor\'s): ' + e.pr);
            if (e.hpi != null) out.push('HPI (the doctor\'s): ' + e.hpi);
            for (const pe of e.problems) {
                const name = pe.name || pe.key;
                if (pe.name != null) out.push('Problem renamed by the doctor: ' + pe.name);
                if (pe.assessment != null) out.push(name + ', assessment (the doctor\'s): ' + pe.assessment);
                if (pe.plan != null) out.push(name + ', plan (the doctor\'s): ' + (pe.plan.join('; ') || '(empty)'));
                if (pe.removed.length) out.push(name + ', taken out of the plan by the doctor (do not put back): ' + pe.removed.join('; '));
                if (pe.added.length) out.push(name + ', added to the plan by the doctor from your suggestions: ' + pe.added.join('; '));
            }
            return out.join('\n');
        }
        const sameItem = (a, b) => normText(a) === normText(b) || overlap(a, b) >= 0.8;
        const hasItem = (list, x) => (list || []).some((y) => sameItem(x, y));
        /** The doctor's edits win: laid over each version the scribe writes. */
        function withEdits(raw) {
            const e = wm.noteEdits;
            const note = Object.assign({}, raw, { edited: { pr: e.pr != null, hpi: e.hpi != null, problems: {} } });
            if (e.pr != null) note.problem_representation = e.pr;
            if (e.hpi != null) note.hpi = e.hpi;
            const problems = (raw.problems || []).map((p) => Object.assign({}, p, { plan: (p.plan || []).slice(), consider: (p.consider || []).slice() }));
            for (const pe of e.problems) {
                let p = problems.find((x) => normText(x.name) === pe.key || (pe.name && normText(x.name) === normText(pe.name)));
                if (!p) { p = { name: pe.name || pe.key, assessment: '', plan: [], consider: [] }; problems.push(p); }   // the scribe dropped it; the doctor's stays
                if (pe.name != null) p.name = pe.name;
                if (pe.assessment != null) p.assessment = pe.assessment;
                // A plan the doctor edited is theirs; what is said later still comes in, what they took out stays out.
                const base = pe.plan != null ? pe.plan.slice() : p.plan.filter((x) => !hasItem(pe.removed, x));
                const later = pe.plan != null ? p.plan.filter((x) => !hasItem(pe.plan, x) && !hasItem(pe.removed, x)) : [];
                const plan = base.concat(later);
                for (const x of pe.added) if (!hasItem(plan, x)) plan.push(x);
                p.plan = plan.slice(0, 12);
                p.consider = p.consider.filter((x) => !hasItem(pe.added, x) && !hasItem(p.plan, x));
                note.edited.problems[normText(p.name)] = { name: pe.name != null, assessment: pe.assessment != null, plan: pe.plan != null };
            }
            note.problems = problems;
            return note;
        }
        function refreshNote() {
            if (!wm.noteRaw) return;
            wm.note = Object.assign(withEdits(wm.noteRaw), { t: wm.noteRaw.t, upToLine: wm.noteRaw.upToLine });
            emit('note', wm.note);
            touch();
        }
        function problemEdit(name, create) {
            const k = normText(name);
            let pe = wm.noteEdits.problems.find((x) => x.key === k || (x.name && normText(x.name) === k));
            if (!pe && create && k) { pe = { key: k, name: null, assessment: null, plan: null, removed: [], added: [] }; wm.noteEdits.problems.push(pe); }
            return pe || null;
        }
        /**
         * The doctor edited part of the note ("pr", "hpi", or a problem's "name", "assessment" or "plan"):
         * it stays theirs over every rewrite. value null hands it back to the scribe.
         */
        function editNote(part, value, problem) {
            const text = (v, n) => (v == null ? null : clip(String(v).trim(), n));
            if (part === 'pr' || part === 'hpi') wm.noteEdits[part] = text(value, 1500);
            else if (part === 'name' || part === 'assessment') {
                const pe = problemEdit(problem, value != null);
                if (pe) pe[part] = part === 'name' && value != null && !String(value).trim() ? null : text(value, part === 'name' ? 80 : 500);
            } else if (part === 'plan') {
                const pe = problemEdit(problem, value != null);
                if (pe) {
                    const list = value == null ? null : (Array.isArray(value) ? value : String(value).split('\n'))
                        .map((x) => clip(String(x).replace(/^\s*(?:[-•*]|\d{1,2}[.)])\s+/, '').trim(), 160)).filter(Boolean).slice(0, 12);
                    const shown = ((wm.note && wm.note.problems) || []).find((x) => normText(x.name) === normText(problem) || normText(x.name) === normText(pe.name || pe.key));
                    pe.removed = list == null ? [] : pe.removed.concat(((shown && shown.plan) || []).filter((x) => !hasItem(list, x) && !hasItem(pe.removed, x)));
                    pe.added = list == null ? pe.added : pe.added.filter((x) => hasItem(list, x));
                    pe.plan = list;
                }
            } else return null;
            refreshNote();
            return wm.note;
        }
        /**
         * The doctor took up one of the note's "consider" items: it goes into that problem's plan, into the
         * conversation as the doctor's (so the scribe, the brain and the radar's checks see it), and onto the
         * radar at once. Returns the new line's id (the radar's items cite it).
         */
        function acceptSuggestion(problem, suggestion) {
            const what = clip(String(suggestion || '').trim(), 200);
            if (!what) return null;
            const pe = problemEdit(problem, true);
            if (pe && !hasItem(pe.added, what)) pe.added.push(what);
            refreshNote();
            if (wm.startedAt == null) wm.startedAt = clock.now();
            const line = { id: 'L' + (++lineSeq), t: elapsed(), speaker: 'doctor', text: 'Add to the plan' + (problem ? ' for ' + clip(problem, 60) : '') + ': ' + what, via: 'note' };
            wm.lines.push(line);
            emit('line', line);
            wm.plan.push({ id: 'P' + (++planSeq), t: elapsed(), text: what, kind: 'order', line: line.id, from: 'note' });
            emit('actions', wm.actions);   // shown at once as "heard"
            markDirty();
            touch();
            scheduleActions(0);
            scheduleNote();
            return line.id;
        }
        /** Rewrite the note after delayMs (default: a few seconds), at most once per gapMs; a sooner request moves the rewrite up. */
        function scheduleNote(delayMs, gapMs) {
            if (!running) return;
            const wait = Math.max(delayMs == null ? cfg.noteDelayMs : delayMs, lastNoteAt + (gapMs == null ? cfg.noteGapMs : gapMs) - elapsed(), 0);
            const at = elapsed() + wait;
            if (noteTimer) {
                if (noteTimerAt <= at) return;
                clock.clearTimeout(noteTimer);
            }
            noteTimerAt = at;
            noteTimer = clock.setTimeout(() => { noteTimer = null; writeNote(); }, wait);
        }
        const dictatingNow = () => lastDictationAt != null && elapsed() - lastDictationAt < 20000;
        function writeNote() {
            if (!running) return null;
            if (noteBusy) { noteAgain = true; return null; }
            if (noteTimer) { clock.clearTimeout(noteTimer); noteTimer = null; }
            noteBusy = true;
            lastNoteAt = elapsed();
            const upToLine = lineSeq;   // lines after this one are not in this version yet
            const p = (async () => {
                emit('thinking', { lane: 'note' });
                const body = {
                    max_tokens: cfg.maxTokens.note,
                    system: noteSystem(),
                    thinking: cfg.noteModel === 'claude-haiku-5-5' ? { type: 'disabled' } : { type: 'adaptive' },
                    output_config: { effort: cfg.effort.note, format: { type: 'json_schema', schema: P.NOTE_SCHEMA } },
                    messages: [{ role: 'user', content: renderForNote() + '\n\n' + P.TASK_NOTE }],
                };
                const out = parseJSON(await modelCall('note', cfg.noteModel, body));
                if (!out || typeof out.problem_representation !== 'string') return;
                // Glanceable by construction: at most 6 problems, 8 plan items and 2 "consider" items each.
                const problems = (out.problems || []).slice(0, 6).map((x) => ({
                    name: String(x.name || ''), assessment: String(x.assessment || ''),
                    plan: (x.plan || []).map(String).slice(0, 8), consider: (x.consider || []).map(String).slice(0, 2),
                }));
                // The exam: vitals and at most 14 systems, as stated.
                const ex = out.exam && typeof out.exam === 'object' ? out.exam : {};
                const exam = {
                    vitals: clip(String(ex.vitals || '').trim(), 300),
                    systems: (Array.isArray(ex.systems) ? ex.systems : []).filter((x) => x && x.system && x.findings)
                        .slice(0, 14).map((x) => ({ system: clip(String(x.system).trim(), 30), findings: clip(String(x.findings).trim(), 400) })),
                };
                wm.noteRaw = { problem_representation: out.problem_representation, hpi: out.hpi || '', exam, problems, t: elapsed(), upToLine };
                wm.note = Object.assign(withEdits(wm.noteRaw), { t: wm.noteRaw.t, upToLine });
                const lastPR = wm.notePRs.length ? wm.notePRs[wm.notePRs.length - 1].text : '';
                if (out.problem_representation && normText(out.problem_representation) !== normText(lastPR)) {
                    wm.notePRs.push({ t: wm.note.t, text: String(out.problem_representation) });
                    if (wm.notePRs.length > 40) wm.notePRs.splice(1, 1);
                }
                emit('note', wm.note);
            })().catch(() => { /* logged in modelCall */ })
                .finally(() => {
                    noteBusy = false;
                    if (noteAgain) { noteAgain = false; if (dictatingNow()) scheduleNote(cfg.dictationNoteDelayMs, cfg.dictationNoteGapMs); else scheduleNote(); }
                });
            return track(p);
        }

        // ── on my radar: the doctor's orders and to-dos ──────────────────
        // The ear hears a plan item ("Repeat BMP and magnesium in the morning"); a
        // cheap model turns it into items ready to act on (order form fields, a
        // drafted message, the next step) and flags the ones a safety alert is
        // about. It returns only what changed; the doctor's own ticks win.
        let actionsBusy = false, actionsAgain = false, actionsTimer = null, actionsRuns = 0, actionsFails = 0;
        let actionsSystemCache = null;
        function actionsSystem() {
            if (!actionsSystemCache) {
                actionsSystemCache = [
                    { type: 'text', text: P.ACTIONS_SYSTEM },
                    { type: 'text', text: patientHeader(), cache_control: { type: 'ephemeral' } },
                ];
            }
            return actionsSystemCache;
        }
        const BY = { doctor: 'set by the doctor', ehr: 'placed in the EHR', sent: 'message sent', saved: 'note saved' };
        const actionLine = (a) => a.id + ' [' + a.status + (a.statusBy !== 'model' ? ' (' + (BY[a.statusBy] || a.statusBy) + ')' : '')
            + (a.flag ? (a.flagLevel === 'check' ? ', check first: ' : ', flag: ') + a.flag + (a.alert ? ' (' + a.alert + ')' : '') : '') + '] ' + a.kind + (a.orderType ? ' (' + a.orderType + ')' : '') + ': ' + a.title + (a.line ? ' · said ' + a.line : '') + (a.next ? ' · next: ' + a.next : '');
        function renderForActions(newPlan) {
            const alerts = openAlerts();
            const said = wm.said.slice(-8);
            return [
                '<on_my_radar>',
                wm.actions.length ? wm.actions.map(actionLine).join('\n') : '(empty)',
                '</on_my_radar>',
                '<open_safety_alerts>',
                alerts.length ? alerts.map((x) => '- ' + x.s.id + ' [' + mmss(x.s.t) + '] ' + x.s.text + x.updates.map((u) => ' | update ' + u.id + ': ' + u.text).join('')).join('\n') : '(none)',
                '</open_safety_alerts>',
                '<coworker_said>',
                said.length ? said.map((s) => '- ' + s.id + ' [' + mmss(s.t) + ', ' + s.kind + (s.acked ? ', acknowledged' : '') + '] ' + (s.question ? '(asked: ' + s.question + ') ' : '') + s.text).join('\n') : '(nothing yet)',
                '</coworker_said>',
                '<conversation>',
                wm.lines.length ? wm.lines.slice(-30).map(lineText).join('\n') : '(nothing heard yet)',
                '</conversation>',
                '<new_plan_items>',
                newPlan.length ? newPlan.map((p) => p.id + ' [' + p.kind + ', heard by ' + p.line + '] ' + p.text).join('\n') : '(none: check flags and statuses only)',
                '</new_plan_items>',
            ].join('\n');
        }
        function scheduleActions(delayMs) {
            if (!running) return;
            const wait = delayMs == null ? cfg.actionsDelayMs : delayMs;
            if (actionsTimer) {
                if (wait > 0) return;      // a debounce is already waiting; it will take this too
                clock.clearTimeout(actionsTimer);
            }
            actionsTimer = clock.setTimeout(() => { actionsTimer = null; writeActions(); }, wait);
        }
        function writeActions() {
            if (!running) return null;
            if (actionsBusy) { actionsAgain = true; return null; }
            if (actionsTimer) { clock.clearTimeout(actionsTimer); actionsTimer = null; }
            const newPlan = wm.plan.filter((p) => p.radar !== true && p.radar !== 'pending');
            if (!newPlan.length && !wm.actions.some((a) => a.status === 'todo')) return null;   // nothing to place or re-check
            newPlan.forEach((p) => { p.radar = 'pending'; });
            actionsBusy = true;
            const p = (async () => {
                emit('thinking', { lane: 'actions' });
                const body = {
                    max_tokens: cfg.maxTokens.actions,
                    system: actionsSystem(),
                    thinking: cfg.actionsModel === 'claude-haiku-5-5' ? { type: 'disabled' } : { type: 'adaptive' },
                    output_config: { effort: cfg.effort.actions, format: { type: 'json_schema', schema: P.ACTIONS_SCHEMA } },
                    messages: [{ role: 'user', content: renderForActions(newPlan) + '\n\n' + P.TASK_ACTIONS }],
                };
                const out = parseJSON(await modelCall('actions', cfg.actionsModel, body));
                if (!out) throw new Error('no list');
                applyActions(out, ++actionsRuns);
                newPlan.forEach((x) => { x.radar = true; });
                actionsFails = 0;
                emit('actions', wm.actions);
                touch();
            })().catch(() => {
                // Busy or unreachable: try again a little later (three times), then show them as heard but not ready.
                actionsFails++;
                newPlan.forEach((x) => { if (x.radar === 'pending') x.radar = actionsFails >= 3 ? 'failed' : false; });
                if (actionsFails < 3) actionsAgain = true;
                emit('actions', wm.actions);
            }).finally(() => {
                actionsBusy = false;
                if (actionsAgain) { actionsAgain = false; scheduleActions(actionsFails ? 4000 * actionsFails : 0); }
            });
            return track(p);
        }

        const ACTION_KINDS = ['order', 'consult', 'referral', 'message', 'note', 'task'];
        const ACTION_STATUS = ['todo', 'done', 'dropped'];
        /** Only the order form's own field keys survive, each value trimmed. */
        function cleanFields(orderType, list) {
            const allowed = P.ORDER_FIELDS[orderType];
            const out = {};
            if (!allowed) return out;
            for (const f of Array.isArray(list) ? list : []) {
                const k = String((f && f.key) || '').trim();
                const v = String((f && f.value) || '').trim();
                if (v && Object.prototype.hasOwnProperty.call(allowed, k)) out[k] = clip(v, 200);
            }
            return out;
        }
        /** Every word heard (the room and the EHR), plus the other names of each drug heard. */
        function heardDrugWords() {
            const set = new Set();
            for (const l of wm.lines) for (const w of normText(l.text).split(' ')) if (w.length > 2) set.add(w);
            const chartNames = ((chart && chart.meds) || []).map((m) => drugWords(m.name).concat(drugWords(m.genericName)));
            for (const g of DRUG_NAMES.concat(chartNames)) if (g.some((w) => set.has(w))) g.forEach((w) => set.add(w));
            return set;
        }
        /** A medicine only the coworker named (no one said it, and the doctor did not take it up): not the doctor's order. */
        function coworkerOnlyDrug(c, heard) {
            if (c.kind !== 'order' || c.order_type !== 'medication') return false;
            const name = (Array.isArray(c.fields) ? c.fields : []).find((f) => f && f.key === 'name' && f.value);
            const ws = drugWords(name ? name.value : String(c.title || '').split(/\s+/)[0]);
            if (!ws.length) return false;
            const said = (w) => heard.has(w) || [...heard].some((h) => h.length >= 4 && w.startsWith(h));   // "amio", "vanc"
            if (ws.some(said)) return false;
            if (!wm.said.some((x) => { const t = normText(x.text).split(' '); return ws.some((w) => t.includes(w)); })) return false;   // a name we cannot place: the model decides
            const recent = wm.lines.slice(-4).concat(c.line ? wm.lines.filter((l) => l.id === c.line) : []);
            return !recent.some((l) => l.speaker !== 'ehr' && ACCEPT_RE.test(l.text));
        }
        /** An alert that also says to hold this drug agrees with the hold: it is not a reason to flag it. */
        function alertAgreesWithHold(a) {
            if (!HOLD_RE.test(a.title)) return false;
            const drug = drugWords(a.title.replace(HOLD_RE, ''))[0];
            if (!drug) return false;
            const re = new RegExp('\\b(?:hold|stop|skip|no)\\b[^.:;]{0,60}\\b' + drug, 'i');
            const agrees = (text) => { const m = re.exec(String(text || '')); return !!m && !/(?:n't|not|never)\s*$/i.test(String(text).slice(0, m.index)); };
            const s = a.alert && wm.said.find((x) => x.id === a.alert);
            return agrees(a.flag) || agrees(s && s.text);
        }

        function applyActions(out, batch) {
            const heard = heardDrugWords();
            for (const c of (out && Array.isArray(out.changes) ? out.changes : []).slice(0, 24)) {
                if (!c || !ACTION_KINDS.includes(c.kind)) continue;
                if (coworkerOnlyDrug(c, heard)) continue;   // the coworker's idea, not the doctor's order
                const title = clip(String(c.title || '').trim(), 90);
                let a = c.id ? wm.actions.find((x) => x.id === c.id) : null;
                // The same thing listed again (or under a made-up id) updates the item already there: the
                // closest title wins. Two items side by side in one reply are two things ("BMP and magnesium
                // in the morning" and "Magnesium in the morning"), unless their titles are the same.
                if (!a && title) {
                    let best = 0;
                    for (const x of wm.actions) {
                        if (x.kind !== c.kind || x.status === 'dropped') continue;
                        if (x.batch === batch && normText(x.title) !== normText(title)) continue;
                        const o = overlap(x.title, title);
                        if (o >= 0.8 && o + sameness(x.title, title) > best) { best = o + sameness(x.title, title); a = x; }
                    }
                }
                if (!a) {
                    if (!title) continue;
                    a = { id: 'A' + (++actionSeq), t: elapsed(), batch: batch || 0, kind: c.kind, title, orderType: '', fields: {}, to: '', noteType: '', draft: '', next: '', status: 'todo', flag: '', flagLevel: '', alert: '', line: '', statusBy: 'model' };
                    wm.actions.push(a);
                }
                const retitled = !!title && normText(title) !== normText(a.title);
                a.kind = c.kind;
                if (title) a.title = title;
                let type = c.kind === 'consult' ? 'consult' : c.kind === 'order' && P.ORDER_FIELDS[c.order_type] ? c.order_type : c.kind === 'order' ? a.orderType : '';
                let given = c.fields;
                if (type === 'medication' && HOLD_RE.test(a.title)) {   // a hold, never an order for the drug
                    type = 'nursing';
                    given = [{ key: 'orderType', value: 'Other' }, { key: 'details', value: a.title }, { key: 'priority', value: 'Routine' }];
                }
                if (type !== a.orderType) a.fields = {};
                a.orderType = type;
                const fields = cleanFields(type, given);
                if (Object.keys(fields).length) a.fields = fields;
                if (c.to) a.to = clip(String(c.to).trim(), 60);
                if (c.note_type) a.noteType = clip(String(c.note_type).replace(/[^A-Za-z0-9 &/-]+/g, ' ').replace(/\s+/g, ' ').trim(), 40);
                if (c.draft) a.draft = clip(String(c.draft).trim(), 800);
                if (c.next) a.next = clip(String(c.next).trim(), 140);
                // A safety flag stays until the order itself changes (a new title) or it is done or dropped.
                // Two levels: "stop" (do not give it as it is; left out of "Review all") and "check" (it can go
                // ahead once something is checked first; signed with the rest, the check shown). No level means stop.
                if (c.flag) {
                    const alert = c.alert && wm.said.some((s) => s.id === c.alert) ? c.alert : '';
                    const level = c.flag_level === 'check' ? 'check' : 'stop';
                    // A red flag never turns amber for the same alert: a routine reply must not soften it.
                    a.flagLevel = a.flag && a.flagLevel === 'stop' && level === 'check' && alert && alert === a.alert ? 'stop' : level;
                    a.flag = clip(String(c.flag).replace(/\s*\((?:S\d+[,\s]*)+\)/g, '').replace(/^check(?: first)?:\s*/i, '').trim(), 120);   // the alert id goes in its own field
                    a.alert = alert;
                } else if (retitled) { a.flag = ''; a.flagLevel = ''; a.alert = ''; }
                if (a.flag && alertAgreesWithHold(a)) { a.flag = ''; a.flagLevel = ''; a.alert = ''; }
                if (c.line && wm.lines.some((l) => l.id === c.line)) a.line = c.line;
                // "done" needs an order seen in the EHR; the doctor's own tick (or the EHR's) stands unless the model saw it placed.
                const placed = c.status === 'done' && wm.lines.some((l) => l.speaker === 'ehr');
                if (ACTION_STATUS.includes(c.status) && (c.status !== 'done' || placed) && (a.statusBy === 'model' || c.status === 'done') && c.status !== a.status) {
                    a.status = c.status;
                    a.statusBy = 'model';
                }
                a.updatedAt = elapsed();
            }
            // Keep the list bounded: the oldest closed items go first.
            while (wm.actions.length > cfg.maxActions) {
                const i = wm.actions.findIndex((x) => x.status !== 'todo');
                wm.actions.splice(i >= 0 ? i : 0, 1);
            }
        }

        /** The doctor ticked an item (done), removed it (dropped) or put it back (todo); "by" says who. */
        function setActionStatus(id, status, by) {
            const a = wm.actions.find((x) => x.id === id);
            if (!a || !ACTION_STATUS.includes(status)) return null;
            a.status = status;
            a.statusBy = by || 'doctor';
            a.updatedAt = elapsed();
            emit('actions', wm.actions);
            touch();
            return a;
        }

        // ── speaking rules ───────────────────────────────────────────────
        // A repeat is the same point again: nearly the same words, or the same
        // topic without much new in it. A same-topic remark that says something
        // substantially new (e.g. a lab result that makes a worry more urgent) passes.
        function alreadySaid(topic, text) {
            const now = elapsed();
            return wm.said.some((s) => s.kind !== 'answer' && now - s.t < cfg.repeatWindowMs
                && (overlap(s.text, text) >= 0.6 || (topic && s.topic === topic && overlap(s.text, text) >= 0.3)));
        }

        function consider(c) {
            if (c.kind === 'answer') return deliver(c);
            const repeat = c.updateOf
                ? wm.said.some((x) => x.kind !== 'answer' && overlap(x.text, c.text) >= 0.6)   // an update shares its card's topic by design
                : alreadySaid(c.topic, c.text);
            if (repeat) { emit('suppressed', Object.assign({ reason: 'repeat' }, c)); return null; }
            if (c.kind === 'critical') return deliver(c);
            // insight
            if (cfg.mode === 'lead' && elapsed() - lastInsightAt >= cfg.insightGapMs) { lastInsightAt = elapsed(); return deliver(c); }
            if (!wm.held.some((h) => h.topic === c.topic)) wm.held.push({ t: elapsed(), topic: c.topic, text: c.text, why: c.why, kind: 'insight', reason: c.reason || '', cueLine: c.cueLine || null, checkMs: c.checkMs != null ? c.checkMs : null, checkWallMs: c.checkWallMs != null ? c.checkWallMs : null, severity: c.severity || 'important', via: c.via || '' });
            emit('held', c);
            touch();
            return null;
        }

        function deliver(c) {
            const item = {
                id: c.id || ('S' + (++saidSeq)), t: elapsed(), kind: c.kind, topic: c.topic || '', text: c.text, why: c.why || '',
                question: c.question || '', cueLine: c.cueLine || null, via: c.via || '',
                latencyMs: c.heardAt != null ? elapsed() - c.heardAt : null, error: !!c.error, updateOf: c.updateOf || null,
                reason: c.reason || '', checkMs: c.checkMs != null ? c.checkMs : null, checkWallMs: c.checkWallMs != null ? c.checkWallMs : null,
                severity: c.severity || (c.kind === 'critical' ? 'critical' : c.kind === 'insight' ? 'important' : ''), decision: c.decision || '', waited: c.waited || 0,
                tools: c.tools && c.tools.length ? c.tools : null,
            };
            wm.said.push(item);
            wm.held = wm.held.filter((h) => h.topic !== item.topic);
            emit('say', item);
            touch();
            if (item.kind === 'critical') scheduleActions(0);   // flag the order it is about, if it is on the radar
            return item;
        }

        // ── lifecycle ────────────────────────────────────────────────────
        function start(startOpts) {
            if (running) return;
            running = true;
            if (wm.startedAt == null) wm.startedAt = clock.now();
            emit('status', { running: true });
            if (!(startOpts && startOpts.skipPrime)) prime();
            startHeartbeat();
            pumpEar();
        }

        function stop() {
            running = false;
            for (const entry of pendingChecks.splice(0)) clock.clearTimeout(entry.timer);
            if (heartbeatTimer) clock.clearTimeout(heartbeatTimer);
            if (quickTimer) clock.clearTimeout(quickTimer);
            heartbeatTimer = quickTimer = null;
            if (pendingWake && pendingWake.timer) clock.clearTimeout(pendingWake.timer);
            pendingWake = null;
            if (noteTimer) clock.clearTimeout(noteTimer);
            noteTimer = null;
            if (actionsTimer) clock.clearTimeout(actionsTimer);
            actionsTimer = null;
            for (const c of aborters) { try { c.abort(); } catch (e) { /* ignore */ } }
            emit('status', { running: false });
        }

        /**
         * An order went into the EHR: log it, add it to the plan, and safety-check it.
         * o.actionId: it was placed from that radar item's form, so the item is done.
         */
        function order(o) {
            const what = [o && o.name, o && o.details, o && o.priority && o.priority !== 'Routine' ? o.priority : ''].filter(Boolean).join(' ');
            if (!what) return null;
            if (wm.startedAt == null) wm.startedAt = clock.now();
            const line = { id: 'L' + (++lineSeq), t: elapsed(), speaker: 'ehr', text: 'Order placed in the EHR: ' + what };
            wm.lines.push(line);
            emit('line', line);
            const fromItem = !!(o.actionId && wm.actions.some((a) => a.id === o.actionId));
            wm.plan.push({ id: 'P' + (++planSeq), t: elapsed(), text: clip(what, 160), kind: 'order', line: line.id, from: 'ehr', radar: fromItem });
            markDirty();
            touch();
            if (fromItem) setActionStatus(o.actionId, 'done', 'ehr');
            if (running) verify('a new order was just placed in the EHR: ' + what, line, 'order:' + line.id);
            scheduleNote();
            if (!fromItem) scheduleActions();   // the radar ticks off what matches, or lists it as done
            return line;
        }

        /** The doctor asked for a held thought ("Tell me"). */
        function tell(topic) {
            const h = wm.held.find((x) => x.topic === topic);
            if (!h) return null;
            return deliver({ kind: 'insight', topic: h.topic, text: h.text, why: h.why, via: 'asked' });
        }

        function setMode(m) {
            if (!['follow', 'abreast', 'lead'].includes(m)) return;
            cfg.mode = m;
            emit('config', cfg);
        }
        function setBrainModel(model) {
            cfg.brainModel = model;
            emit('config', cfg);
        }
        function setSpeed(speed) { cfg.speed = speed || null; emit('config', cfg); }

        /** Resolves when no call is in flight (the harness's stepwise mode). */
        async function idle() {
            for (let i = 0; i < 50; i++) {
                if (!pending.size && !earQueue.length && !earBusy) return;
                await Promise.allSettled([...pending]);
            }
        }

        function stats() {
            const by = {};
            for (const c of calls) {
                const b = by[c.lane] || (by[c.lane] = { calls: 0, errors: 0, cost: 0, ms: [], ttft: [] });
                b.calls++;
                if (!c.ok) b.errors++;
                b.cost += c.cost || 0;
                if (c.ms) { b.ms.push(c.ms.total); b.ttft.push(c.ms.ttft); }
            }
            const total = calls.reduce((a, c) => a + (c.cost || 0), 0);
            return { calls: calls.length, cost: total, byLane: by };
        }

        return {
            on, hear, ask, tell, order, ack, start, stop, update, prime, note: writeNote, editNote, acceptSuggestion, actions: writeActions, setActionStatus, idle, stats, setMode, setBrainModel, setSpeed,
            wm, cfg, calls, renderForBrain, renderForEar, renderForActions, patientHeader,
            get running() { return running; },
            get elapsed() { return elapsed(); },
        };
    }

    // ── a radar item's fields -> the EHR order form's values ─────────────
    // The model is asked for the form's exact choices; this maps what it says
    // otherwise ("twice a day" -> BID, "BMP" -> Basic Metabolic Panel) and leaves a
    // choice blank, for the doctor, rather than guess. Unknown tests and
    // specialties go in the form's "Other" box.
    const SYNONYMS = {
        route: { 'PO': ['oral', 'orally', 'by mouth'], 'IV Push': ['ivp', 'push', 'iv bolus', 'slow push'], 'IV Piggyback': ['ivpb', 'piggyback'], 'IV': ['intravenous', 'iv drip', 'iv infusion', 'infusion', 'drip'], 'SC': ['subq', 'sq', 'subcut', 'subcutaneous'], 'IM': ['intramuscular'], 'SL': ['sublingual'], 'PR': ['rectal', 'per rectum'], 'Inhaled': ['nebulized', 'neb', 'inhaler'] },
        frequency: {
            'Once': ['now', 'stat', 'x1', 'once now', 'one time', 'single dose', 'one dose', 'tonight'], 'BID': ['twice daily', 'twice a day', 'two times a day', 'b i d', 'every 12 hours'], 'TID': ['three times daily', 'three times a day', 't i d'],
            'QID': ['four times daily', 'four times a day'], 'Daily': ['once daily', 'once a day', 'every day', 'qd', 'every morning', 'qam'], 'At bedtime': ['qhs', 'nightly', 'at night', 'bedtime'],
            'Continuous': ['drip', 'infusion', 'continuous infusion', 'gtt'], 'PRN': ['as needed'], 'Q8H': ['every 8 hours'], 'Q6H': ['every 6 hours'], 'Q4H': ['every 4 hours'], 'Q24H': ['every 24 hours'],
        },
        priority: { 'STAT': ['now', 'stat', 'immediately', 'emergent', 'right away'], 'Urgent': ['asap', 'today'], 'Routine': ['in the morning', 'morning', 'am', 'tomorrow', 'am labs'] },
        name: {
            'Complete Blood Count': ['cbc', 'blood count', 'hemoglobin', 'hgb', 'h&h', 'h and h', 'cbc with differential'], 'Basic Metabolic Panel': ['bmp', 'chem 7', 'chem7', 'basic panel', 'basic metabolic', 'electrolytes', 'lytes'],
            'Comprehensive Metabolic Panel': ['cmp', 'chem 14', 'comprehensive panel'], 'Coagulation Panel (PT/INR/PTT)': ['inr', 'pt/inr', 'pt inr', 'coags', 'coagulation panel', 'pt/ptt', 'ptt'],
            'Magnesium': ['mg', 'mag'], 'Phosphorus': ['phos', 'phosphate'], 'Troponin': ['trop', 'troponins', 'hs troponin'], 'Liver Function Tests': ['lfts', 'lft', 'hepatic panel', 'liver panel'],
            'Thyroid Panel': ['tsh'], 'Arterial Blood Gas': ['abg'], 'Venous Blood Gas': ['vbg'], 'Urinalysis': ['ua', 'urine analysis'], 'Hemoglobin A1c': ['a1c', 'hba1c'], 'C-Reactive Protein': ['crp'],
            'Blood Culture': ['blood cultures', 'blood cx'], 'Lactate': ['lactic acid'], 'Iron Studies': ['iron panel'], 'Pro-BNP': ['nt-probnp', 'probnp', 'nt pro bnp'],
        },
        specialty: { 'Gastroenterology': ['gi', 'gastro'], 'Infectious Disease': ['id', 'infectious diseases'], 'Pulmonology': ['pulm', 'pulmonary'], 'Cardiology': ['cards', 'cardiac', 'heart failure', 'electrophysiology', 'ep'], 'Neurology': ['neuro', 'stroke', 'stroke neurology'], 'Nephrology': ['renal', 'kidney'], 'Psychiatry': ['psych'], 'Surgery': ['general surgery'], 'Endocrinology': ['endo', 'endocrine'] },
        modality: { 'X-Ray': ['xray', 'x ray', 'cxr', 'radiograph', 'plain film', 'film', 'kub'], 'Ultrasound': ['us', 'sonogram', 'doppler', 'duplex'], 'Echo': ['echocardiogram', 'tte', 'tee'], 'CT': ['cat scan', 'ct scan', 'cta'], 'MRI': ['mr', 'mra'] },
        contrast: { 'Without contrast': ['no contrast', 'noncontrast', 'non contrast', 'without'], 'With contrast': ['with'], 'N/A': ['none', 'not applicable'] },
        orderType: { 'Vital Signs': ['vitals'], 'I&O Monitoring': ['i&o', 'i and o', 'ins and outs', 'intake and output', 'strict i&o'], 'Diet': ['nutrition'], 'Activity': ['ambulation'] },
        specimen: { 'Blood': ['serum', 'plasma'] },
    };
    const normOpt = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9&/+]+/g, ' ').trim();
    function matchOption(options, key, value) {
        const v = normOpt(value);
        if (!v) return '';
        let hit = options.find((o) => o === value) || options.find((o) => normOpt(o) === v);
        if (hit) return hit;
        const syn = SYNONYMS[key] || {};
        const pairs = Object.entries(syn).filter(([opt]) => options.includes(opt));
        hit = pairs.find(([, list]) => list.some((s) => normOpt(s) === v));
        if (hit) return hit[0];
        // A choice named inside a longer value ("IV push over 2 minutes"), longest first so "IV Push" beats "IV".
        const padded = ' ' + v + ' ';
        hit = options.slice().sort((a, b) => b.length - a.length).find((o) => normOpt(o).length >= 2 && padded.includes(' ' + normOpt(o) + ' '));
        if (hit) return hit;
        hit = pairs.find(([, list]) => list.some((s) => padded.includes(' ' + normOpt(s) + ' ')));
        return hit ? hit[0] : '';
    }
    /** fieldsConfig: the order form's fields ([{name, type, options, showIf}]); values: {key: value}. */
    function toOrderForm(fieldsConfig, values) {
        const cfgFields = Array.isArray(fieldsConfig) ? fieldsConfig : [];
        const v = values || {};
        const out = {};
        for (const f of cfgFields) {
            const raw = v[f.name];
            if (raw == null || String(raw).trim() === '' || out[f.name] != null) continue;
            if (f.type === 'select' && Array.isArray(f.options)) {
                const options = f.options.filter((o) => !/^-{2,}/.test(o));
                const hit = matchOption(options, f.name, raw);
                const other = cfgFields.find((g) => g.showIf === f.name + ':Other');
                if (hit) out[f.name] = hit;
                else if (other && options.includes('Other')) { out[f.name] = 'Other'; if (!v[other.name]) out[other.name] = String(raw).trim(); }
            } else if (f.type !== 'multiselect') {
                out[f.name] = String(raw).trim();
            }
        }
        return out;
    }

    const api = { createCoworker, toOrderForm, DEFAULTS, _overlap: overlap, _mmss: mmss };
    if (isNode) module.exports = api;
    else root.LiveCore = api;
})(typeof window !== 'undefined' ? window : globalThis);
