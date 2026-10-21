// Live Coworker engine (js/live/live-core.js) with a scripted fake model: the
// ear's bookkeeping, the wake-word fast path, tripwire -> verify -> critical
// alert, never repeating, Lead/Abreast speaking rules, held thoughts, the
// answer lane's tool loop, and the SSE parser in live-transport.js.
// No network. Run: node tests/live-core.test.js
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const LiveCore = require('../js/live/live-core.js');
const LiveChart = require('../js/live/live-chart.js');
const LiveTransport = require('../js/live/live-transport.js');

const BASE = path.join(__dirname, '..', 'data', 'patients', 'PAT001');

let fail = 0;
const check = async (name, fn) => {
    try { await fn(); console.log('PASS  ' + name); } catch (e) { fail++; console.log('FAIL  ' + name + ' -> ' + (e && e.stack || e)); }
};

const reply = (text, extra) => Object.assign({
    message: { content: [{ type: 'text', text }], stop_reason: 'end_turn', usage: { input_tokens: 10, output_tokens: 5 } },
    text, usage: { input_tokens: 10, output_tokens: 5 }, cost: 0.0001, ms: { ttft: 5, total: 10 }, servedBy: 'x', fellBack: false,
}, extra || {});

const EMPTY_EAR = { facts: [], doctor_thinking: [], plan: [], to_coworker: false, question: '', watch_hits: [], alarm: 'none', alarm_reason: '', worth_a_look: false, speaker_fix: [] };
const TAKE = (extra) => Object.assign({
    take: { one_liner: '74M HFrEF in for volume overload', assessment: 'ADHF after missed furosemide', concerns: [{ topic: 'k-high', text: 'K 5.1 on spironolactone', severity: 'important' }], next: ['diurese'], doctor_view: 'ADHF', differs: '' },
    watch: [{ id: 'pcn-anaphylaxis', trigger: 'an order for a penicillin or piperacillin', alert: 'Penicillin anaphylaxis on file.', severity: 'critical' }],
    say: { should_say: false, kind: 'insight', topic: '', text: '', why: '' },
}, extra || {});

/** A fake transport: handler(lane, body, callIndex) -> reply. Records every call. */
function fakeTransport(handler) {
    const log = [];
    return {
        log,
        async callWithRetry(req, hooks) {
            const lane = req.label;
            log.push({ lane, model: req.model, body: req.body });
            const r = await handler(lane, req.body, log.filter((x) => x.lane === lane).length);
            if (hooks && hooks.onText && r.text) hooks.onText(r.text, 0);
            return r;
        },
    };
}

async function loadChart() {
    const chart = LiveChart.create({ loadJSON: async (p) => JSON.parse(fs.readFileSync(path.join(BASE, p), 'utf8')) });
    await chart.load();
    return chart;
}

const manualClock = () => {
    let t = 0;
    const timers = [];
    return {
        now: () => t,
        setTimeout: (fn, ms) => { const h = { at: t + ms, fn }; timers.push(h); return h; },
        clearTimeout: (h) => { const i = timers.indexOf(h); if (i >= 0) timers.splice(i, 1); },
        advance(ms) {
            t += ms;
            for (;;) {
                timers.sort((a, b) => a.at - b.at);
                if (!timers.length || timers[0].at > t) break;
                const h = timers.shift();
                h.fn();
            }
        },
    };
};

(async () => {
    const chart = await loadChart();

    await check('chart digest header lists the real allergies (never the AI memory)', async () => {
        const cw = LiveCore.createCoworker({ transport: fakeTransport(() => reply('{}')), chart });
        const h = cw.patientHeader();
        assert.match(h, /Penicillin \(Anaphylaxis\)/);
        assert.match(h, /Lisinopril \(Angioedema\)/);
        assert.match(h, /Entresto/);
    });

    await check('the ear adds facts, thinking and plan once, and caches the patient header', async () => {
        const t = fakeTransport((lane) => {
            if (lane === 'ear') return reply(JSON.stringify(Object.assign({}, EMPTY_EAR, {
                facts: [{ text: 'Ran out of furosemide 6 days ago', kind: 'medication', from: 'patient' }, { text: 'ran out of furosemide 6 days ago', kind: 'medication', from: 'patient' }],
                doctor_thinking: ['Sounds like a heart failure flare'], plan: [{ text: 'IV furosemide 80 mg now', kind: 'order' }],
            })));
            return reply(JSON.stringify(TAKE()));
        });
        const cw = LiveCore.createCoworker({ transport: t, chart, clock: manualClock() });
        cw.start({ skipPrime: true });
        cw.hear({ speaker: 'patient', text: 'I ran out of my water pill about six days ago.' });
        await cw.idle();
        assert.strictEqual(cw.wm.facts.length, 1, 'duplicate fact collapsed');
        assert.strictEqual(cw.wm.thinking.length, 1);
        assert.strictEqual(cw.wm.plan[0].kind, 'order');
        const ear = t.log.find((x) => x.lane === 'ear');
        assert.strictEqual(ear.model, 'claude-haiku-5-5');
        assert.deepStrictEqual(ear.body.thinking, { type: 'disabled' });
        assert.ok(ear.body.system[1].cache_control, 'patient header is a cache breakpoint');
        assert.strictEqual(ear.body.output_config.format.type, 'json_schema');
        cw.stop();
    });

    await check('wake word goes straight to the brain; the ear does not ask twice', async () => {
        const t = fakeTransport((lane) => {
            if (lane === 'ear') return reply(JSON.stringify(Object.assign({}, EMPTY_EAR, { to_coworker: true, question: 'What was his last potassium?' })));
            if (lane === 'answer') return reply('Potassium 4.46 on 1/11/2026.');
            return reply(JSON.stringify(TAKE()));
        });
        const cw = LiveCore.createCoworker({ transport: t, chart, clock: manualClock() });
        const said = [];
        cw.on('say', (s) => said.push(s));
        cw.start({ skipPrime: true });
        cw.hear({ speaker: 'doctor', text: 'Coworker, what was his last potassium?' });
        await cw.idle();
        assert.strictEqual(said.length, 1);
        assert.strictEqual(said[0].kind, 'answer');
        assert.strictEqual(said[0].via, 'wake word');
        assert.strictEqual(t.log.filter((x) => x.lane === 'answer').length, 1);
        const ans = t.log.find((x) => x.lane === 'answer');
        assert.match(ans.body.messages[0].content[0].text, /"What was his last potassium\?"/);
        assert.deepStrictEqual(ans.body.tool_choice, { type: 'auto' });
        cw.stop();
    });

    await check('a question the ear catches without a wake word is answered', async () => {
        const t = fakeTransport((lane) => {
            if (lane === 'ear') return reply(JSON.stringify(Object.assign({}, EMPTY_EAR, { to_coworker: true, question: 'What is his EF?' })));
            if (lane === 'answer') return reply('EF 30-35% on the 9/2024 TEE.');
            return reply(JSON.stringify(TAKE()));
        });
        const cw = LiveCore.createCoworker({ transport: t, chart, clock: manualClock() });
        const said = [];
        cw.on('say', (s) => said.push(s));
        cw.start({ skipPrime: true });
        cw.hear({ speaker: 'doctor', text: 'What is his ejection fraction again?' });
        await cw.idle();
        assert.strictEqual(said.length, 1);
        assert.strictEqual(said[0].via, 'ear');
        cw.stop();
    });

    await check('tripwire -> verify -> critical alert, said once, never repeated', async () => {
        let verifyCalls = 0;
        const t = fakeTransport((lane) => {
            if (lane === 'prime') return reply(JSON.stringify(TAKE()));
            if (lane === 'ear') return reply(JSON.stringify(Object.assign({}, EMPTY_EAR, { watch_hits: ['pcn-anaphylaxis'], alarm: 'possible_critical', alarm_reason: 'Zosyn ordered' })));
            if (lane === 'verify') { verifyCalls++; return reply(JSON.stringify({ decision: 'say', severity: 'critical', topic: 'pcn-anaphylaxis', text: 'Hold the Zosyn: penicillin anaphylaxis on file.', why: 'piperacillin is a penicillin' })); }
            return reply(JSON.stringify(TAKE()));
        });
        const cw = LiveCore.createCoworker({ transport: t, chart, clock: manualClock() });
        const said = [], suppressed = [];
        cw.on('say', (s) => said.push(s));
        cw.on('suppressed', (s) => suppressed.push(s));
        cw.start();
        await cw.idle();
        assert.strictEqual(cw.wm.watch.length, 1, 'prime set the watch list');
        cw.hear({ speaker: 'doctor', text: 'Let\'s start Zosyn.' });
        await cw.idle();
        assert.strictEqual(said.length, 1);
        assert.strictEqual(said[0].kind, 'critical');
        assert.ok(verifyCalls >= 1);
        cw.hear({ speaker: 'doctor', text: 'Go ahead and hang the Zosyn.' });
        await cw.idle();
        assert.strictEqual(said.length, 1, 'not repeated');
        assert.ok(suppressed.length >= 1);
        const v = t.log.find((x) => x.lane === 'verify');
        assert.deepStrictEqual(v.body.tool_choice, { type: 'none' });
        assert.strictEqual(v.body.output_config.format.type, 'json_schema');
        cw.stop();
    });

    await check('a tripwire and an alarm on the same line make ONE safety check', async () => {
        const t = fakeTransport((lane) => {
            if (lane === 'prime') return reply(JSON.stringify(TAKE()));
            if (lane === 'ear') return reply(JSON.stringify(Object.assign({}, EMPTY_EAR, { watch_hits: ['pcn-anaphylaxis'], alarm: 'possible_critical', alarm_reason: 'Zosyn with penicillin allergy' })));
            if (lane === 'verify') return reply(JSON.stringify({ decision: 'say', severity: 'critical', topic: 'pcn', text: 'Hold the Zosyn: penicillin anaphylaxis.', why: '' }));
            return reply(JSON.stringify(TAKE()));
        });
        const cw = LiveCore.createCoworker({ transport: t, chart, clock: manualClock() });
        cw.start();
        await cw.idle();
        cw.hear({ speaker: 'doctor', text: 'Start Zosyn.' });
        await cw.idle();
        const v = t.log.filter((x) => x.lane === 'verify');
        assert.strictEqual(v.length, 1);
        assert.match(v[0].body.messages[0].content[0].text, /watch item "pcn-anaphylaxis" fired.*Zosyn with penicillin allergy/s);
        cw.stop();
    });

    await check('same topic: a rephrase is suppressed, new and more urgent information gets through', async () => {
        const texts = [
            'Black stools with his 2023 ulcer bleed: possible upper GI bleed, check his hemoglobin.',
            'His black stools and the 2023 ulcer bleed suggest a possible upper GI bleed; check hemoglobin.',
            'INR 2.3 off warfarin plus hemoglobin down to 10.2: ask about leftover warfarin at home.',
        ];
        let i = 0;
        const t = fakeTransport((lane) => {
            if (lane === 'ear') return reply(JSON.stringify(Object.assign({}, EMPTY_EAR, { alarm: 'possible_critical', alarm_reason: 'bleeding' })));
            if (lane === 'verify') return reply(JSON.stringify({ decision: 'say', severity: 'critical', topic: 'gi-bleed', text: texts[i++], why: '' }));
            return reply(JSON.stringify(TAKE()));
        });
        const cw = LiveCore.createCoworker({ transport: t, chart, clock: manualClock() });
        const said = [];
        cw.on('say', (s) => said.push(s));
        cw.start({ skipPrime: true });
        for (const line of ['My stools are black.', 'They have been black for days.', 'INR is 2.3.']) { cw.hear({ speaker: 'doctor', text: line }); await cw.idle(); }
        assert.deepStrictEqual(said.map((s) => s.text), [texts[0], texts[2]]);
        cw.stop();
    });

    const waitScenario = async (followUpDecision) => {
        const t = fakeTransport((lane, body) => {
            const user = JSON.stringify(body.messages || '');
            if (lane === 'ear') {
                const red = /almost black/.test(user.split('<new_lines>')[1] || '');
                return reply(JSON.stringify(Object.assign({}, EMPTY_EAR, red ? { alarm: 'possible_critical', alarm_reason: 'black stools, prior ulcer bleed' } : {})));
            }
            if (lane === 'verify') {
                if (/chose to wait/.test(user)) return reply(JSON.stringify({ decision: followUpDecision, severity: followUpDecision === 'say' ? 'critical' : 'none', topic: 'melena', text: 'Black stools with his 2023 ulcer bleed: check his hemoglobin.', why: 'moved on' }));
                return reply(JSON.stringify({ decision: 'wait', severity: 'critical', topic: 'melena', text: '', why: 'just raised; give the doctor a turn' }));
            }
            return reply(JSON.stringify(TAKE()));
        });
        const clock = manualClock();
        const cw = LiveCore.createCoworker({ transport: t, chart, clock });
        const said = [];
        cw.on('say', (s) => said.push(s));
        cw.start({ skipPrime: true });
        clock.advance(5000);
        cw.hear({ speaker: 'patient', text: 'My stools have been almost black.' });
        await cw.idle();
        assert.strictEqual(said.length, 0, 'held while the doctor has not had a turn');
        clock.advance(4000);
        cw.hear({ speaker: 'doctor', text: followUpDecision === 'say' ? 'Okay. How are you sleeping?' : 'Black stools? Let us check your blood count right now.' });
        await cw.idle();
        return { said, t };
    };

    await check('a red flag just raised is held, then said once the doctor moves past it', async () => {
        const { said, t } = await waitScenario('say');
        assert.strictEqual(said.length, 1);
        assert.strictEqual(said[0].via, 'after waiting');
        assert.strictEqual(said[0].latencyMs, 4000, 'latency counts from the red flag');
        assert.strictEqual(t.log.filter((x) => x.lane === 'verify').length, 2);
    });

    await check('a held red flag stays unsaid when the doctor addresses it', async () => {
        const { said } = await waitScenario('quiet');
        assert.strictEqual(said.length, 0);
    });

    await check('a held point gets its second look after the fresh check on the same words (no double alert)', async () => {
        const ALERT = 'Treat it as a TIA: head imaging and neurology tonight.';
        const t = fakeTransport((lane, body) => {
            const user = JSON.stringify(body.messages || '');
            if (lane === 'ear') {
                const nl = user.split('<new_lines>')[1] || '';
                if (/hand went clumsy/.test(nl)) return reply(JSON.stringify(Object.assign({}, EMPTY_EAR, { alarm: 'possible_critical', alarm_reason: 'ZZ-raised' })));
                if (/keep an eye/.test(nl)) return reply(JSON.stringify(Object.assign({}, EMPTY_EAR, { alarm: 'possible_critical', alarm_reason: 'ZZ-moved-on' })));
                return reply(JSON.stringify(EMPTY_EAR));
            }
            if (lane === 'verify') {
                if (/chose to wait/.test(user)) {
                    const covered = user.includes(ALERT);
                    return reply(JSON.stringify({ decision: covered ? 'quiet' : 'say', severity: covered ? 'none' : 'critical', topic: 'tia-held', text: covered ? '' : 'Possible TIA: he needs a stroke workup.', why: '' }));
                }
                if (/ZZ-moved-on/.test(user)) return reply(JSON.stringify({ decision: 'say', severity: 'critical', topic: 'tia', text: ALERT, why: '' }));
                return reply(JSON.stringify({ decision: 'wait', severity: 'critical', topic: 'tia', text: '', why: 'just raised' }));
            }
            return reply(JSON.stringify(TAKE()));
        });
        const clock = manualClock();
        const cw = LiveCore.createCoworker({ transport: t, chart, clock });
        const said = [];
        cw.on('say', (s) => said.push(s));
        cw.start({ skipPrime: true });
        clock.advance(3000);
        cw.hear({ speaker: 'other', text: 'Last Tuesday his right hand went clumsy and his words came out jumbled.' });
        await cw.idle();
        assert.strictEqual(said.length, 0, 'held at first');
        clock.advance(4000);
        cw.hear({ speaker: 'doctor', text: 'Okay, we will keep an eye on that.' });
        await cw.idle();
        assert.deepStrictEqual(said.map((s) => s.text), [ALERT]);
        const v = t.log.filter((x) => x.lane === 'verify');
        assert.strictEqual(v.length, 3);
        assert.match(JSON.stringify(v[2].body.messages), /chose to wait/, 'the second look runs last');
        cw.stop();
    });

    await check('two checks about the same thing at once alert once (the later one asks whether it is covered)', async () => {
        const FIRST = 'Treat it as a TIA: head imaging and neurology tonight.';
        const SECOND = 'Probable TIA with AF off anticoagulation: do a neuro exam now.';
        const OTHER = 'Hold the heparin drip: black stools and Hgb 10.2.';
        let n = 0;
        const t = fakeTransport(async (lane, body) => {
            const user = JSON.stringify(body.messages || '');
            if (lane === 'ear') {
                const nl = user.split('<new_lines>')[1] || '';
                if (/jumbled|keep an eye|heparin/.test(nl)) return reply(JSON.stringify(Object.assign({}, EMPTY_EAR, { alarm: 'possible_critical', alarm_reason: /heparin/.test(nl) ? 'heparin with melena' : 'possible TIA' })));
                return reply(JSON.stringify(EMPTY_EAR));
            }
            if (lane === 'verify') {
                await new Promise((r) => setTimeout(r, 30 - 10 * n));   // a check is slower than the ear; the later one finishes later
                n++;
                const text = /heparin with melena/.test(user) ? OTHER : n === 1 ? FIRST : SECOND;
                return reply(JSON.stringify({ decision: 'say', severity: 'critical', topic: 'topic-' + n, text, why: '' }));
            }
            if (lane === 'helper' && /Two safety checks/.test(JSON.stringify(body.system))) {
                const msg = JSON.stringify(body.messages);
                return reply(JSON.stringify({ covered: msg.includes(FIRST) && msg.includes(SECOND) }));
            }
            return reply(JSON.stringify(TAKE()));
        });
        const cw = LiveCore.createCoworker({ transport: t, chart, clock: manualClock() });
        const said = [];
        cw.on('say', (s) => said.push(s));
        cw.start({ skipPrime: true });
        cw.hear({ speaker: 'other', text: 'His words came out all jumbled.' });
        cw.hear({ speaker: 'doctor', text: 'Okay, we will keep an eye on that.' });
        await cw.idle();
        assert.strictEqual(t.log.filter((x) => x.lane === 'verify').length, 2, 'both batches were checked, side by side');
        assert.deepStrictEqual(said.map((s) => s.text), [FIRST]);
        // A different problem in the meantime is still said.
        cw.hear({ speaker: 'doctor', text: 'And start a heparin drip.' });
        await cw.idle();
        assert.deepStrictEqual(said.map((s) => s.text), [FIRST, OTHER]);
        cw.stop();
    });

    await check('an order placed in the EHR is logged, planned and safety-checked (no ear call)', async () => {
        const t = fakeTransport((lane) => {
            if (lane === 'verify') return reply(JSON.stringify({ decision: 'say', severity: 'critical', topic: 'pcn', text: 'Cancel the Zosyn: penicillin anaphylaxis in 1985.', why: '' }));
            return reply(JSON.stringify(TAKE()));
        });
        const cw = LiveCore.createCoworker({ transport: t, chart, clock: manualClock() });
        const said = [];
        cw.on('say', (s) => said.push(s));
        cw.start({ skipPrime: true });
        const line = cw.order({ name: 'Piperacillin-tazobactam', details: '4.5 g, IV, q6h', priority: 'STAT' });
        await cw.idle();
        assert.strictEqual(line.speaker, 'ehr');
        assert.match(line.text, /Piperacillin-tazobactam 4\.5 g, IV, q6h STAT/);
        assert.strictEqual(cw.wm.plan[0].kind, 'order');
        assert.strictEqual(t.log.filter((x) => x.lane === 'ear').length, 0);
        assert.match(t.log.find((x) => x.lane === 'verify').body.messages[0].content[0].text, /new order was just placed in the EHR: Piperacillin/);
        assert.strictEqual(said.length, 1);
        cw.stop();
    });

    await check('insights: held in Abreast, spoken in Lead at most once per gap', async () => {
        const TEXTS = ['Consider amiodarone loading for rate control', 'His troponin needs a repeat in six hours', 'Dry weight was 97 kilograms in January notes', 'Ask about leftover warfarin tablets at home'];
        const insight = (topic, i) => reply(JSON.stringify(TAKE({ say: { should_say: true, kind: 'insight', topic, text: TEXTS[i % TEXTS.length], why: 'w' } })));
        let n = 0;
        const t = fakeTransport((lane) => (lane === 'update' ? insight('topic-' + (++n), n - 1) : reply(JSON.stringify(EMPTY_EAR))));
        const clock = manualClock();
        const cw = LiveCore.createCoworker({ transport: t, chart, clock, config: { mode: 'abreast' } });
        const said = [];
        cw.on('say', (s) => said.push(s));
        cw.start({ skipPrime: true });
        await cw.update('test');
        assert.strictEqual(said.length, 0, 'abreast holds insights');
        assert.ok(cw.wm.held.some((h) => h.topic === 'topic-1'));
        cw.setMode('lead');
        clock.advance(1000);
        await cw.update('test');
        assert.strictEqual(said.length, 1, 'lead speaks');
        clock.advance(1000);
        await cw.update('test');
        assert.strictEqual(said.length, 1, 'rate limited');
        clock.advance(130000);
        await cw.idle();
        await cw.update('test');
        assert.strictEqual(said.length, 2, 'after the gap');
        cw.stop();
    });

    await check('answer lane runs lookup tools, then answers; tools and system stay identical', async () => {
        let round = 0;
        const t = fakeTransport((lane, body) => {
            if (lane === 'answer') {
                round++;
                if (round === 1) {
                    return {
                        message: { content: [{ type: 'tool_use', id: 'tu1', name: 'lookup_labs', input: { tests: ['k', 'creatinine'], how_many: 2 } }], stop_reason: 'tool_use', usage: {} },
                        text: '', usage: {}, cost: 0, ms: { ttft: 1, total: 2 },
                    };
                }
                const last = body.messages[body.messages.length - 1];
                assert.strictEqual(last.role, 'user');
                assert.strictEqual(last.content[0].type, 'tool_result');
                assert.match(last.content[0].content, /Potassium/);
                return reply('K 4.46 and creatinine 2.03 on 1/11/2026.');
            }
            return reply(JSON.stringify(EMPTY_EAR));
        });
        const cw = LiveCore.createCoworker({ transport: t, chart, clock: manualClock() });
        const said = [], statuses = [];
        cw.on('say', (s) => said.push(s));
        cw.on('say-partial', (p) => { if (p.status) statuses.push(p.status); });
        cw.start({ skipPrime: true });
        await cw.ask('What are his last K and creatinine?');
        assert.strictEqual(said.length, 1);
        assert.match(said[0].text, /4\.46/);
        assert.deepStrictEqual(statuses, ['Checking labs…'], 'tool status in plain words');
        const a = t.log.filter((x) => x.lane === 'answer');
        assert.strictEqual(a.length, 2);
        assert.strictEqual(JSON.stringify(a[0].body.system), JSON.stringify(a[1].body.system));
        assert.strictEqual(JSON.stringify(a[0].body.tools), JSON.stringify(a[1].body.tools));
        cw.stop();
    });

    await check('a refusal or bad JSON never crashes the loop', async () => {
        const t = fakeTransport((lane) => {
            if (lane === 'ear') return reply('not json at all');
            if (lane === 'update') return { message: { content: [], stop_reason: 'refusal', stop_details: { category: 'bio' }, usage: {} }, text: '', usage: {}, cost: 0, ms: { ttft: 1, total: 1 } };
            return reply('{}');
        });
        const cw = LiveCore.createCoworker({ transport: t, chart, clock: manualClock() });
        cw.start({ skipPrime: true });
        cw.hear({ speaker: 'doctor', text: 'Hello there.' });
        await cw.update('x');
        await cw.idle();
        assert.strictEqual(cw.wm.lines.length, 1);
        cw.stop();
    });

    await check('transport folds SSE (text, tool input, usage) into a message and prices it', async () => {
        const sse = [
            ['message_start', { type: 'message_start', message: { id: 'm', model: 'claude-sonnet-5-5', content: [], usage: { input_tokens: 100, cache_read_input_tokens: 5000, output_tokens: 1 } } }],
            ['content_block_start', { type: 'content_block_start', index: 0, content_block: { type: 'thinking', thinking: '' } }],
            ['content_block_delta', { type: 'content_block_delta', index: 0, delta: { type: 'thinking_delta', thinking: 'hmm' } }],
            ['content_block_delta', { type: 'content_block_delta', index: 0, delta: { type: 'signature_delta', signature: 'sig' } }],
            ['content_block_stop', { type: 'content_block_stop', index: 0 }],
            ['content_block_start', { type: 'content_block_start', index: 1, content_block: { type: 'text', text: '' } }],
            ['content_block_delta', { type: 'content_block_delta', index: 1, delta: { type: 'text_delta', text: 'Checking.' } }],
            ['content_block_stop', { type: 'content_block_stop', index: 1 }],
            ['content_block_start', { type: 'content_block_start', index: 2, content_block: { type: 'tool_use', id: 'tu', name: 'lookup_labs', input: {} } }],
            ['content_block_delta', { type: 'content_block_delta', index: 2, delta: { type: 'input_json_delta', partial_json: '{"tests":["k"],' } }],
            ['content_block_delta', { type: 'content_block_delta', index: 2, delta: { type: 'input_json_delta', partial_json: '"how_many":2}' } }],
            ['content_block_stop', { type: 'content_block_stop', index: 2 }],
            ['message_delta', { type: 'message_delta', delta: { stop_reason: 'tool_use' }, usage: { output_tokens: 40 } }],
            ['message_stop', { type: 'message_stop' }],
        ].map(([e, d]) => 'event: ' + e + '\ndata: ' + JSON.stringify(d) + '\n\n').join('');
        const chunks = [sse.slice(0, 333), sse.slice(333, 901), sse.slice(901)];
        let sent;
        const fetchImpl = async (url, opts) => {
            sent = { url, opts };
            let i = 0;
            return {
                ok: true, status: 200, headers: { get: () => 'text/event-stream' },
                body: { getReader: () => ({ read: async () => (i < chunks.length ? { value: new TextEncoder().encode(chunks[i++]), done: false } : { done: true }) }) },
            };
        };
        const tr = LiveTransport.createTransport({ endpoint: '/api/claude-full', fetchImpl });
        let streamed = '';
        const r = await tr.call({ model: 'claude-sonnet-5-5', body: { max_tokens: 10, messages: [] } }, { onText: (d) => { streamed += d; } });
        assert.strictEqual(streamed, 'Checking.');
        assert.strictEqual(r.message.stop_reason, 'tool_use');
        assert.deepStrictEqual(r.message.content[2].input, { tests: ['k'], how_many: 2 });
        assert.strictEqual(r.message.content[0].signature, 'sig');
        const body = JSON.parse(sent.opts.body);
        assert.strictEqual(body.stream, true);
        assert.strictEqual(body.fallbacks, 'default');
        assert.strictEqual(sent.opts.headers['anthropic-beta'], 'server-side-fallback-2026-07-01');
        const expected = (100 * 2 + 5000 * 0.2 + 40 * 10) / 1e6;
        assert.ok(Math.abs(r.cost - expected) < 1e-9, 'cost ' + r.cost + ' vs ' + expected);
        // Haiku: no fallback flag (it has none).
        await tr.call({ model: 'claude-haiku-5-5', body: { max_tokens: 10, messages: [] } }).catch(() => {});
        const hb = JSON.parse(sent.opts.body);
        assert.strictEqual(hb.fallbacks, undefined);
        assert.strictEqual(sent.opts.headers['anthropic-beta'], undefined);
    });

    process.exit(fail ? 1 : 0);
})().catch((e) => { console.log('FAIL  crashed -> ' + (e && e.stack || e)); process.exit(1); });
