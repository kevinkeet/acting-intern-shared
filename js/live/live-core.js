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
        effort: { ear: 'low', answer: 'low', verify: 'low', update: 'medium', prime: 'medium', helper: 'medium' },
        maxTokens: { ear: 2000, answer: 6000, verify: 3000, update: 9000, prime: 9000, helper: 3000 },
        earThinking: 'disabled',      // Haiku 5.5 accepts disabled at low..high effort
        heartbeatMs: 60000,           // think at least this often while things change
        quickLookMs: 12000,           // sooner after something "worth a look"
        minUpdateGapMs: 25000,        // but never two take updates closer than this
        insightGapMs: 120000,         // Lead: at most one unprompted insight per 2 minutes
        repeatWindowMs: 15 * 60000,   // never repeat a topic within this window
        recentLines: 12,              // verbatim lines the ear sees as context
        brainLines: 24,               // verbatim lines the brain sees
        maxToolRounds: 3,
        wakeWords: /\b(?:hey\s+)?(?:co-?worker|claude)\b[,:]?\s*/i,
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
    const clip = (s, n) => { s = String(s || ''); return s.length > n ? s.slice(0, n - 1) + '…' : s; };
    const mmss = (ms) => { const s = Math.max(0, Math.round(ms / 1000)); return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'); };

    function newMemory() {
        return {
            startedAt: null,
            lines: [],            // {id, t, speaker, text, viaAi?}
            facts: [],            // {id, t, text, kind, from, line}
            thinking: [],         // doctor's reasoning: {t, text}
            plan: [],             // {t, text, kind}
            take: null,           // brain's current take + t
            watch: [],            // tripwires for the ear
            said: [],             // {id, t, kind, topic, text, why, latencyMs, cueLine}
            held: [],             // thoughts kept for when asked: {t, topic, text, why, kind}
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
        let lineSeq = 0, factSeq = 0, saidSeq = 0;
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
        const lineText = (l) => l.id + ' [' + mmss(l.t) + '] ' + l.speaker.toUpperCase() + ': ' + l.text;

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
                'YOUR CURRENT TAKE' + (take ? ' (from ' + mmss(take.t) + ')' : '') + ':',
                take ? ['- ' + take.one_liner, '- ' + take.assessment].concat((take.concerns || []).map((c) => '- concern [' + c.topic + ', ' + c.severity + ']: ' + c.text)).join('\n') : '- (none yet)',
                'WATCH LIST:',
                wm.watch.length ? wm.watch.map((w) => '- ' + w.id + ' (' + w.severity + '): ' + w.trigger).join('\n') : '- (empty)',
                'ALREADY SAID (do not repeat):',
                wm.said.length ? wm.said.map((s) => '- [' + mmss(s.t) + ', ' + s.kind + ', ' + s.topic + '] ' + s.text).join('\n') : '- (nothing yet)',
                'HELD FOR WHEN ASKED:',
                wm.held.length ? wm.held.map((h) => '- [' + h.topic + '] ' + h.text).join('\n') : '- (nothing)',
                '</working_memory>',
                '<recent_conversation>',
                wm.lines.length ? wm.lines.slice(-cfg.brainLines).map(lineText).join('\n') : '(no conversation yet)',
                '</recent_conversation>',
            ];
            return out.join('\n');
        }

        // ── model calls ──────────────────────────────────────────────────
        async function modelCall(lane, model, body, hooks) {
            const ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
            if (ctrl) aborters.add(ctrl);
            const entry = { lane, model, at: elapsed(), ok: false };
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
            wm.lines.push(line);
            emit('line', line);
            touch();

            // Fast path: "Coworker, what was his last potassium?" goes straight to the brain.
            const m = text.match(cfg.wakeWords);
            if (m && line.speaker !== 'patient') {
                let q = text.slice(m.index + m[0].length).trim() || text;
                q = q.charAt(0).toUpperCase() + q.slice(1);
                handledLines.add(line.id);
                ask(q, { cueLine: line.id, heardAt: line.t, via: 'wake word' });
            }
            earQueue.push(line);
            pumpEar();
            return line;
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
            for (const p of out.plan || []) {
                if (p && p.text && !wm.plan.some((x) => overlap(x.text, p.text) >= 0.85)) { wm.plan.push({ t: elapsed(), text: clip(p.text, 160), kind: p.kind || 'plan', line: lastLine.id }); changed = true; }
            }
            if (changed) { markDirty(); touch(); }

            // Questions for the coworker (unless the wake-word path already took them).
            if (out.to_coworker && out.question && !batch.some((l) => handledLines.has(l.id))) {
                ask(out.question, { cueLine: lastLine.id, heardAt: lastLine.t, via: 'ear' });
            }
            // Tripwires and alarms -> one safety check for these lines; the brain decides whether to interrupt.
            const reasons = [];
            for (const id of out.watch_hits || []) {
                const w = wm.watch.find((x) => x.id === id);
                if (w) reasons.push('watch item "' + w.id + '" fired: ' + w.trigger + ' (prepared alert: ' + w.alert + ')');
            }
            if (out.alarm === 'possible_critical') reasons.push(out.alarm_reason || 'possible safety issue');
            if (reasons.length) verify(reasons.join('; '), lastLine, 'lines:' + batch.map((l) => l.id).join(','));
            if (out.worth_a_look) scheduleQuickLook();
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
                for (let round = 0; round <= cfg.maxToolRounds; round++) {
                    const body = brainBody('answer', '', { toolChoice: round < cfg.maxToolRounds ? 'auto' : 'none' });
                    body.messages = messages;
                    let streamed = '';
                    const res = await modelCall('answer', cfg.brainModel, body, {
                        onText: (d) => { streamed += d; emit('say-partial', { id, text: streamed, question }); },
                    });
                    if (res.message.stop_reason === 'refusal') { answer = 'I can\'t help with that one.'; break; }
                    const uses = res.message.content.filter((b) => b.type === 'tool_use');
                    if (!uses.length || res.message.stop_reason !== 'tool_use') { answer = res.text.trim(); break; }
                    messages.push({ role: 'assistant', content: res.message.content });
                    emit('say-partial', { id, text: '', question, status: 'Looking up ' + uses.map((u) => u.name.replace(/_/g, ' ')).join(', ') + '…' });
                    const results = await Promise.all(uses.map((u) => runTool(u)));
                    messages.push({ role: 'user', content: results });
                }
                deliver({ id, kind: 'answer', topic: 'answer', text: answer || 'Sorry, I lost that one.', why: '', question, cueLine: m.cueLine, heardAt: m.heardAt, via: m.via });
            })().catch((e) => {
                if (e && e.name === 'AbortError') return;
                deliver({ id, kind: 'answer', topic: 'answer', text: 'Sorry, I could not answer just now (' + clip(e && e.message, 80) + ').', why: '', question, cueLine: m.cueLine, heardAt: m.heardAt, error: true });
            });
            return track(p);
        }

        // ── brain: tools ─────────────────────────────────────────────────
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
                output_config: { effort: cfg.effort.helper },
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
        function verify(reason, cueLine, key) {
            if (inflightVerify.has(key)) return null;
            inflightVerify.add(key);
            const startedAt = elapsed();
            const p = (async () => {
                emit('thinking', { lane: 'verify', reason });
                const body = brainBody('verify', renderForBrain() + '\n\n' + P.taskVerify(reason), { schema: P.VERIFY_SCHEMA });
                const res = await modelCall('verify', cfg.brainModel, body);
                const out = parseJSON(res);
                emit('verified', { reason, out, ms: elapsed() - startedAt });
                if (out && out.should_say && out.text) {
                    const kind = out.severity === 'critical' ? 'critical' : 'insight';
                    consider({ kind, topic: out.topic || key, text: out.text, why: out.why, cueLine: cueLine && cueLine.id, heardAt: cueLine && cueLine.t, via: 'verify' });
                }
            })().catch(() => { /* logged */ }).finally(() => inflightVerify.delete(key));
            return track(p);
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
                    if (dirtySince != null) update('heartbeat');
                    beat();
                }, cfg.heartbeatMs);
            };
            beat();
        }

        function applyTake(out, why) {
            if (out.take) {
                wm.take = Object.assign({}, out.take, { t: elapsed(), why });
                emit('take', wm.take);
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
                    consider({ kind: out.say.kind === 'critical' ? 'critical' : 'insight', topic: out.say.topic, text: out.say.text, why: out.say.why, via: 'update' });
                }
                wm.held = wm.held.filter((h) => !alreadySaid(h.topic, h.text)).slice(-8);
                touch();
            })().catch(() => { dirtySince = dirtySince == null ? seenUpTo : dirtySince; })
                .finally(() => {
                    updateBusy = false;
                    if (updateAgain) { updateAgain = false; update('catch-up'); }
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
            if (alreadySaid(c.topic, c.text)) { emit('suppressed', Object.assign({ reason: 'repeat' }, c)); return null; }
            if (c.kind === 'critical') return deliver(c);
            // insight
            if (cfg.mode === 'lead' && elapsed() - lastInsightAt >= cfg.insightGapMs) { lastInsightAt = elapsed(); return deliver(c); }
            if (!wm.held.some((h) => h.topic === c.topic)) wm.held.push({ t: elapsed(), topic: c.topic, text: c.text, why: c.why, kind: 'insight' });
            emit('held', c);
            touch();
            return null;
        }

        function deliver(c) {
            const item = {
                id: c.id || ('S' + (++saidSeq)), t: elapsed(), kind: c.kind, topic: c.topic || '', text: c.text, why: c.why || '',
                question: c.question || '', cueLine: c.cueLine || null, via: c.via || '',
                latencyMs: c.heardAt != null ? elapsed() - c.heardAt : null, error: !!c.error,
            };
            wm.said.push(item);
            wm.held = wm.held.filter((h) => h.topic !== item.topic);
            emit('say', item);
            touch();
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
            if (heartbeatTimer) clock.clearTimeout(heartbeatTimer);
            if (quickTimer) clock.clearTimeout(quickTimer);
            heartbeatTimer = quickTimer = null;
            for (const c of aborters) { try { c.abort(); } catch (e) { /* ignore */ } }
            emit('status', { running: false });
        }

        /** An order went into the EHR: log it, add it to the plan, and safety-check it. */
        function order(o) {
            const what = [o && o.name, o && o.details, o && o.priority && o.priority !== 'Routine' ? o.priority : ''].filter(Boolean).join(' ');
            if (!what) return null;
            if (wm.startedAt == null) wm.startedAt = clock.now();
            const line = { id: 'L' + (++lineSeq), t: elapsed(), speaker: 'ehr', text: 'Order placed in the EHR: ' + what };
            wm.lines.push(line);
            emit('line', line);
            wm.plan.push({ t: elapsed(), text: clip(what, 160), kind: 'order', line: line.id });
            markDirty();
            touch();
            if (running) verify('a new order was just placed in the EHR: ' + what, line, 'order:' + line.id);
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
            on, hear, ask, tell, order, start, stop, update, prime, idle, stats, setMode, setBrainModel, setSpeed,
            wm, cfg, calls, renderForBrain, renderForEar, patientHeader,
            get running() { return running; },
            get elapsed() { return elapsed(); },
        };
    }

    const api = { createCoworker, DEFAULTS, _overlap: overlap, _mmss: mmss };
    if (isNode) module.exports = api;
    else root.LiveCore = api;
})(typeof window !== 'undefined' ? window : globalThis);
