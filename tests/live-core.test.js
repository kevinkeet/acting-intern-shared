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
const P = require('../js/live/live-prompts.js');

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
        const clock = manualClock();
        const cw = LiveCore.createCoworker({ transport: t, chart, clock });
        const said = [];
        cw.on('say', (s) => said.push(s));
        cw.start({ skipPrime: true });
        cw.hear({ speaker: 'doctor', text: 'Coworker, what was his last potassium?' });
        await cw.idle();
        assert.strictEqual(said.length, 0, 'waits a beat in case the doctor keeps going');
        clock.advance(1000);
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

    const wakeRun = async (pieces) => {
        const t = fakeTransport((lane) => (lane === 'answer' ? reply('An answer.') : reply(JSON.stringify(lane === 'ear' ? EMPTY_EAR : TAKE()))));
        const clock = manualClock();
        const cw = LiveCore.createCoworker({ transport: t, chart, clock });
        const said = [];
        cw.on('say', (s) => said.push(s));
        cw.start({ skipPrime: true });
        const asked = () => t.log.filter((x) => x.lane === 'answer').map((x) => (x.body.messages[0].content[0].text.match(/just asked you: "([^"]*)"/) || [])[1]);
        const seen = [];
        for (const [gapMs, speaker, text] of pieces) {
            clock.advance(gapMs);
            await cw.idle();
            seen.push(asked().length);
            cw.hear({ speaker, text });
            await cw.idle();
        }
        clock.advance(5000);
        await cw.idle();
        cw.stop();
        return { asked: asked(), seen, said };
    };

    await check('"Coworker, um..." waits for the rest of the question, then asks it once, without the filler', async () => {
        const r = await wakeRun([[0, 'doctor', 'Coworker, um,'], [1500, 'doctor', 'what was his, uh, last potassium?']]);
        assert.deepStrictEqual(r.asked, ['What was his last potassium?']);
        assert.deepStrictEqual(r.seen, [0, 0], 'nothing asked before the question was finished');
    });

    await check('a question that trails off ("what about his...") waits for more; a wake word alone asks nothing', async () => {
        const r = await wakeRun([[0, 'doctor', 'Coworker, what about his'], [2500, 'doctor', 'kidney function lately?']]);
        assert.deepStrictEqual(r.asked, ['What about his kidney function lately?']);
        const r2 = await wakeRun([[0, 'doctor', 'Coworker, um']]);
        assert.deepStrictEqual(r2.asked, []);
        const r3 = await wakeRun([[0, 'doctor', 'Coworker, thoughts?']]);
        assert.deepStrictEqual(r3.asked, ['Thoughts?'], 'a short question that ends with a question mark is fine');
    });

    await check('live note: written a few seconds after speech, at most every 12 s, from the whole conversation and its last version', async () => {
        let n = 0;
        const t = fakeTransport((lane, body) => {
            if (lane === 'note') {
                n++;
                return reply(JSON.stringify({ problem_representation: 'PR v' + n, hpi: 'HPI v' + n, problems: [{ name: 'Acute on chronic HFrEF', assessment: 'Missed furosemide.', plan: n > 1 ? ['IV furosemide 80 mg now'] : [], consider: [] }] }));
            }
            return reply(JSON.stringify(lane === 'ear' ? EMPTY_EAR : TAKE()));
        });
        const clock = manualClock();
        const cw = LiveCore.createCoworker({ transport: t, chart, clock });
        const notes = [];
        cw.on('note', (x) => notes.push(x));
        cw.start({ skipPrime: true });
        cw.hear({ speaker: 'patient', text: 'I cannot catch my breath.' });
        await cw.idle();
        assert.strictEqual(t.log.filter((x) => x.lane === 'note').length, 0, 'waits for a few lines to go in together');
        clock.advance(3000);
        await cw.idle();
        assert.strictEqual(notes.length, 1);
        assert.strictEqual(cw.wm.note.problem_representation, 'PR v1');
        const first = t.log.filter((x) => x.lane === 'note')[0].body;
        assert.match(first.messages[0].content, /I cannot catch my breath/);
        assert.deepStrictEqual(first.thinking, { type: 'disabled' });
        assert.ok(first.system[1].cache_control, 'the chart digest is cached');
        cw.hear({ speaker: 'doctor', text: 'Let us give IV furosemide 80 now.' });
        await cw.idle();
        clock.advance(3000);
        await cw.idle();
        assert.strictEqual(t.log.filter((x) => x.lane === 'note').length, 1, 'not again within 12 s');
        clock.advance(9000);   // 12 s after the first note
        await cw.idle();
        assert.strictEqual(t.log.filter((x) => x.lane === 'note').length, 2);
        assert.match(t.log.filter((x) => x.lane === 'note')[1].body.messages[0].content, /<previous_note>\{"problem_representation":"PR v1"/);
        assert.deepStrictEqual(cw.wm.note.problems[0].plan, ['IV furosemide 80 mg now']);
        cw.note();
        await cw.idle();
        assert.strictEqual(t.log.filter((x) => x.lane === 'note').length, 3, 'on demand (end of the encounter)');
        cw.stop();
    });

    await check('dictating the exam: lines are marked, the note catches up within seconds, the exam is kept by system', async () => {
        let n = 0;
        const many = Array.from({ length: 16 }, (_, i) => ({ system: 'System ' + i, findings: 'Finding ' + i }));
        const t = fakeTransport((lane) => {
            if (lane === 'note') {
                n++;
                return reply(JSON.stringify({ problem_representation: 'PR', hpi: '', problems: [],
                    exam: n === 1 ? { vitals: 'T 38.6, SpO2 94% on 2 L', systems: [{ system: 'Lungs', findings: 'Crackles at both bases' }, { system: 'Heart', findings: '' }] } : { vitals: '', systems: many } }));
            }
            return reply(JSON.stringify(lane === 'ear' ? EMPTY_EAR : TAKE()));
        });
        const clock = manualClock();
        const cw = LiveCore.createCoworker({ transport: t, chart, clock });
        cw.start({ skipPrime: true });
        const line = cw.hear({ speaker: 'doctor', text: 'Lungs: crackles at both bases.', mode: 'exam', typed: true });
        assert.strictEqual(line.dictation, 'exam');
        assert.strictEqual(line.typed, true);
        await cw.idle();
        assert.match(t.log.find((x) => x.lane === 'ear').body.messages[0].content, /L1 \[0:00\] DOCTOR \(dictating the exam\): Lungs: crackles/, 'the ear knows it is dictation');
        clock.advance(1499); await cw.idle();
        assert.strictEqual(t.log.filter((x) => x.lane === 'note').length, 0);
        clock.advance(1); await cw.idle();
        const notes = t.log.filter((x) => x.lane === 'note');
        assert.strictEqual(notes.length, 1, 'written 1.5 s after the dictation, not 3 s');
        assert.match(notes[0].body.messages[0].content, /DOCTOR \(dictating the exam\): Lungs: crackles at both bases/);
        assert.deepStrictEqual(cw.wm.note.exam, { vitals: 'T 38.6, SpO2 94% on 2 L', systems: [{ system: 'Lungs', findings: 'Crackles at both bases' }] }, 'an empty finding is dropped');
        assert.strictEqual(cw.wm.note.upToLine, 1, 'the note says which lines it has seen');
        cw.hear({ speaker: 'doctor', text: 'Heart: irregularly irregular.', mode: 'exam' });
        await cw.idle();
        clock.advance(4999); await cw.idle();
        assert.strictEqual(t.log.filter((x) => x.lane === 'note').length, 1, 'at most every 5 s while dictating');
        clock.advance(1); await cw.idle();
        assert.strictEqual(t.log.filter((x) => x.lane === 'note').length, 2);
        assert.match(t.log.filter((x) => x.lane === 'note')[1].body.messages[0].content, /<previous_note>\{[^<]*"exam":\{"vitals":"T 38\.6/);
        assert.strictEqual(cw.wm.note.exam.systems.length, 14, 'at most 14 systems');
        assert.ok(P.NOTE_SCHEMA.required.includes('exam'));
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
        assert.match(said[0].reason, /watch item "pcn-anaphylaxis" fired/, 'the alert remembers what set it off');
        assert.ok(typeof said[0].checkMs === 'number');
        assert.ok(typeof said[0].checkWallMs === 'number', 'and how long the check took in real time');
        assert.strictEqual(said[0].decision, 'say');
        assert.strictEqual(said[0].severity, 'critical');
        assert.strictEqual(said[0].waited, 0);
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

    await check('two checks about the same thing at once alert once (the later one asks whether it adds anything)', async () => {
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
            if (lane === 'helper' && ((body.output_config || {}).format || {}).schema && body.output_config.format.schema.properties.same_as) {
                const msg = JSON.stringify(body.messages);
                const first = msg.match(/- (S\d+): Treat it as a TIA/);
                return reply(JSON.stringify({ same_as: first && msg.includes(SECOND) ? first[1] : '', adds_new: false }));
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

    // Updates: a new point about a problem already on screen goes onto that card.
    const updateRun = async (ackFirst) => {
        const t = fakeTransport((lane, body) => {
            const user = JSON.stringify(body.messages || '');
            if (lane === 'ear') {
                const nl = user.split('<new_lines>')[1] || '';
                if (/black stools/.test(nl)) return reply(JSON.stringify(Object.assign({}, EMPTY_EAR, { alarm: 'possible_critical', alarm_reason: 'melena' })));
                if (/heparin drip/.test(nl)) return reply(JSON.stringify(Object.assign({}, EMPTY_EAR, { alarm: 'possible_critical', alarm_reason: 'heparin with melena' })));
                return reply(JSON.stringify(EMPTY_EAR));
            }
            if (lane === 'verify') {
                const open = (user.split('OPEN SAFETY ALERTS')[1] || '').split('ALREADY SAID')[0];
                const gi = open.match(/- (S\d+) \[[^\]]*\] Black stools/);
                if (/heparin with melena/.test(user)) return reply(JSON.stringify({ decision: 'say', severity: 'critical', topic: 'heparin', text: 'Hold the heparin drip: he may be bleeding.', why: '', update_of: gi ? gi[1] : '' }));
                return reply(JSON.stringify({ decision: 'say', severity: 'critical', topic: 'melena', text: 'Black stools after a 2023 ulcer bleed: check his hemoglobin.', why: '', update_of: '' }));
            }
            return reply(JSON.stringify(lane === 'note' ? { problem_representation: '', hpi: '', problems: [] } : TAKE()));
        });
        const cw = LiveCore.createCoworker({ transport: t, chart, clock: manualClock() });
        const said = [];
        cw.on('say', (x) => said.push(x));
        cw.start({ skipPrime: true });
        cw.hear({ speaker: 'doctor', text: 'He says his black stools started three days ago.' });
        await cw.idle();
        if (ackFirst) cw.ack(said[0].id);
        cw.hear({ speaker: 'doctor', text: 'And start a heparin drip.' });
        await cw.idle();
        const verify2 = t.log.filter((x) => x.lane === 'verify')[1];
        cw.stop();
        return { said, prompt: JSON.stringify(verify2.body.messages) };
    };

    await check('a new point about a problem already on screen becomes an update to that card', async () => {
        const { said, prompt } = await updateRun(false);
        assert.strictEqual(said.length, 2);
        assert.strictEqual(said[1].updateOf, said[0].id, 'the heparin alert updates the GI bleed card');
        assert.match(prompt, /OPEN SAFETY ALERTS[^]*- S\d+ \[[^\]]*\] Black stools/, 'the brain sees the open alert and its id');
    });

    await check('after "Got it", the same problem gets a new card', async () => {
        const { said, prompt } = await updateRun(true);
        assert.strictEqual(said.length, 2);
        assert.strictEqual(said[1].updateOf, null);
        assert.match(prompt, /OPEN SAFETY ALERTS[^:]*:\\n- \(none\)/, 'no open alerts after Got it');
        assert.match(prompt, /acknowledged/);
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

    // ── on my radar ──────────────────────────────────────────────────────
    const item = (x) => Object.assign({ id: '', kind: 'order', title: '', order_type: 'none', fields: [], to: '', note_type: '', draft: '', next: '', status: 'todo', flag: '', alert: '', line: '' }, x);
    const radarReply = (changes) => reply(JSON.stringify({ changes }));

    await check('on my radar: a heard plan item shows at once, then Haiku lists it ready to act on', async () => {
        const events = [];
        const t = fakeTransport((lane, body, n) => {
            if (lane === 'ear') return reply(JSON.stringify(Object.assign({}, EMPTY_EAR, { plan: [{ text: 'Repeat BMP and magnesium in the morning', kind: 'test' }] })));
            if (lane === 'actions' && n === 1) {
                return radarReply([
                    item({ kind: 'order', order_type: 'lab', title: 'BMP in the morning', fields: [{ key: 'name', value: 'Basic Metabolic Panel' }, { key: 'priority', value: 'Routine' }, { key: 'dose', value: 'not a lab field' }], line: 'L1' }),
                    item({ kind: 'order', order_type: 'lab', title: 'Magnesium in the morning', fields: [{ key: 'name', value: 'Magnesium' }], line: 'L99' }),
                ]);
            }
            if (lane === 'actions') return radarReply([]);
            return reply(JSON.stringify(TAKE()));
        });
        const clock = manualClock();
        const cw = LiveCore.createCoworker({ transport: t, chart, clock });
        cw.on('actions', (list) => events.push(list.length));
        cw.start({ skipPrime: true });
        cw.hear({ speaker: 'doctor', text: 'Repeat BMP and magnesium in the morning.' });
        await cw.idle();
        assert.strictEqual(cw.wm.plan[0].id, 'P1');
        assert.ok(!cw.wm.plan[0].radar, 'heard, not yet ready');
        assert.deepStrictEqual(events, [0], 'the panel hears about it at once (shown as "heard")');
        assert.strictEqual(t.log.filter((x) => x.lane === 'actions').length, 0, 'waits a beat for the rest of the plan');
        clock.advance(1200);
        await cw.idle();
        const call = t.log.find((x) => x.lane === 'actions');
        assert.strictEqual(call.model, 'claude-haiku-5-5');
        assert.deepStrictEqual(call.body.thinking, { type: 'disabled' });
        assert.strictEqual(call.body.output_config.format.type, 'json_schema');
        assert.ok(call.body.system[1].cache_control, 'patient header is a cache breakpoint');
        assert.match(call.body.messages[0].content, /<new_plan_items>\nP1 \[test, heard by L1\] Repeat BMP and magnesium/);
        assert.match(call.body.messages[0].content, /<on_my_radar>\n\(empty\)/);
        assert.deepStrictEqual(cw.wm.actions.map((a) => a.id + ' ' + a.title), ['A1 BMP in the morning', 'A2 Magnesium in the morning']);
        assert.deepStrictEqual(cw.wm.actions[0].fields, { name: 'Basic Metabolic Panel', priority: 'Routine' }, 'only the form\'s own fields');
        assert.strictEqual(cw.wm.actions[0].orderType, 'lab');
        assert.strictEqual(cw.wm.actions[0].line, 'L1');
        assert.strictEqual(cw.wm.actions[1].line, '', 'a line that was never heard is not kept');
        assert.strictEqual(cw.wm.plan[0].radar, true);
        // Next time it sees the list (and no new plan items: just a re-check).
        await cw.actions();
        const second = t.log.filter((x) => x.lane === 'actions')[1].body.messages[0].content;
        assert.match(second, /A1 \[todo\] order \(lab\): BMP in the morning · said L1/);
        assert.match(second, /\(none: check flags and statuses only\)/);
        cw.stop();
    });

    await check('radar changes: by id, a repeat merges, and the doctor\'s tick stands unless the EHR shows it placed', async () => {
        const replies = [
            [item({ title: 'Furosemide 80 mg IV now', order_type: 'medication' }), item({ title: 'EKG now', order_type: 'procedure' }), item({ kind: 'task', title: 'Update allergy list: penicillin' })],
            [item({ id: 'A1', title: 'Furosemide 80 mg IV now', order_type: 'medication', status: 'todo' }), item({ title: 'EKG now', order_type: 'procedure', next: 'Compare with the last EKG' }), item({ id: 'A3', kind: 'task', title: '', status: 'dropped' })],
            [item({ id: 'A1', title: 'Furosemide 80 mg IV now', order_type: 'medication', status: 'done' }), item({ id: 'A9', kind: 'note', title: 'Goals-of-care note', note_type: 'Goals of Care Note!', draft: 'He does not want machines.' })],
        ];
        let n = 0;
        const t = fakeTransport((lane) => (lane === 'actions' ? radarReply(replies[n++] || []) : reply(JSON.stringify(TAKE()))));
        const cw = LiveCore.createCoworker({ transport: t, chart, clock: manualClock() });
        cw.start({ skipPrime: true });
        cw.wm.plan.push({ id: 'P1', t: 0, text: 'x', kind: 'order', line: 'L1' });
        await cw.actions();
        assert.strictEqual(cw.wm.actions.length, 3);
        cw.setActionStatus('A1', 'dropped', 'doctor');
        await cw.actions();
        const a = (id) => cw.wm.actions.find((x) => x.id === id);
        assert.strictEqual(a('A1').status, 'dropped', 'the doctor removed it; the model\'s "todo" does not bring it back');
        assert.strictEqual(cw.wm.actions.length, 3, 'EKG listed again updated A2 instead of adding A4');
        assert.strictEqual(a('A2').next, 'Compare with the last EKG');
        assert.strictEqual(a('A3').status, 'dropped');
        assert.strictEqual(a('A3').title, 'Update allergy list: penicillin', 'an empty title keeps the old one');
        await cw.actions();
        assert.strictEqual(a('A1').status, 'dropped', '"done" without any order placed in the EHR is not believed');
        n--;
        cw.wm.lines.push({ id: 'L9', t: 0, speaker: 'ehr', text: 'Order placed in the EHR: Furosemide 80 mg IV Push Once' });
        await cw.actions();
        assert.strictEqual(a('A1').status, 'done', 'placed in the EHR wins over the doctor\'s earlier tick');
        assert.ok(a('A4') && a('A4').kind === 'note', 'a made-up id is a new item');
        assert.strictEqual(a('A4').noteType, 'Goals of Care Note', 'note type kept to safe characters');
        cw.stop();
    });

    await check('an order signed from a radar item ticks it off at once; one placed by hand goes to the radar lane', async () => {
        const t = fakeTransport((lane) => {
            if (lane === 'actions') return radarReply([item({ title: 'Furosemide 80 mg IV now', order_type: 'medication' })]);
            if (lane === 'verify') return reply(JSON.stringify({ decision: 'quiet', severity: 'none', topic: '', text: '', why: '', update_of: '' }));
            return reply(JSON.stringify(TAKE()));
        });
        const clock = manualClock();
        const cw = LiveCore.createCoworker({ transport: t, chart, clock });
        cw.start({ skipPrime: true });
        cw.wm.plan.push({ id: 'P1', t: 0, text: 'IV furosemide 80 now', kind: 'order', line: 'L1' });
        await cw.actions();
        cw.order({ name: 'Furosemide', details: '80 mg, IV Push, Once', priority: 'Routine', actionId: 'A1' });
        await cw.idle();
        assert.strictEqual(cw.wm.actions[0].status, 'done');
        assert.strictEqual(cw.wm.actions[0].statusBy, 'ehr');
        assert.strictEqual(cw.wm.plan[cw.wm.plan.length - 1].radar, true, 'nothing left for the radar lane');
        clock.advance(2000);
        await cw.idle();
        assert.strictEqual(t.log.filter((x) => x.lane === 'actions').length, 1, 'no radar call for an order it already ticked');
        cw.order({ name: 'Troponin', details: 'Blood', priority: 'STAT' });
        clock.advance(1200);
        await cw.idle();
        const calls = t.log.filter((x) => x.lane === 'actions');
        assert.strictEqual(calls.length, 2);
        assert.match(calls[1].body.messages[0].content, /\[order, heard by L\d+\] Troponin Blood STAT/);
        assert.match(calls[1].body.messages[0].content, /A1 \[done \(placed in the EHR\)\]/);
        cw.stop();
    });

    await check('a safety alert sends the radar lane back to flag the order it is about', async () => {
        let n = 0;
        const t = fakeTransport((lane, body) => {
            if (lane === 'actions') {
                n++;
                if (n === 1) return radarReply([item({ title: 'Zosyn IV', order_type: 'medication', fields: [{ key: 'name', value: 'Piperacillin-tazobactam' }] })]);
                assert.match(body.messages[0].content, /<open_safety_alerts>\n- S1 \[[^\]]+\] Hold the Zosyn/);
                return radarReply([item({ id: 'A1', title: 'Zosyn IV', order_type: 'medication', flag: 'Penicillin anaphylaxis in 1985', alert: 'S1' }), item({ title: 'Ceftriaxone 1 g IV daily', order_type: 'medication', flag: 'made up', alert: 'S7' })]);
            }
            if (lane === 'verify') return reply(JSON.stringify({ decision: 'say', severity: 'critical', topic: 'pcn', text: 'Hold the Zosyn: penicillin anaphylaxis in 1985.', why: 'Anaphylaxis on file.', update_of: '' }));
            return reply(JSON.stringify(TAKE()));
        });
        const clock = manualClock();
        const cw = LiveCore.createCoworker({ transport: t, chart, clock });
        cw.start({ skipPrime: true });
        cw.wm.plan.push({ id: 'P1', t: 0, text: 'Start Zosyn', kind: 'order', line: 'L1' });
        await cw.actions();
        cw.order({ name: 'Piperacillin-tazobactam', details: '4.5 g IV', priority: 'Routine', actionId: 'nope' });   // not a radar item: an ordinary EHR order
        await cw.idle();
        clock.advance(0);
        await cw.idle();
        assert.strictEqual(n, 2, 'the alert brought the radar lane back at once');
        assert.strictEqual(cw.wm.actions[0].flag, 'Penicillin anaphylaxis in 1985');
        assert.strictEqual(cw.wm.actions[0].alert, 'S1');
        assert.strictEqual(cw.wm.actions[1].alert, '', 'an alert id that does not exist is dropped');
        cw.stop();
    });

    await check('a safety flag stays on an item until its order changes', async () => {
        const replies = [
            [item({ title: 'Zosyn IV', order_type: 'medication', flag: 'Penicillin anaphylaxis in 1985 (S1)' })],
            [item({ id: 'A1', title: 'Zosyn IV', order_type: 'medication', next: 'Choose the dose' })],
            [item({ id: 'A1', title: 'Ceftriaxone 1 g IV daily', order_type: 'medication' })],
        ];
        let n = 0;
        const t = fakeTransport((lane) => (lane === 'actions' ? radarReply(replies[n++] || []) : reply(JSON.stringify(TAKE()))));
        const cw = LiveCore.createCoworker({ transport: t, chart, clock: manualClock() });
        cw.start({ skipPrime: true });
        cw.wm.plan.push({ id: 'P1', t: 0, text: 'Start Zosyn', kind: 'order', line: 'L1' });
        await cw.actions();
        assert.strictEqual(cw.wm.actions[0].flag, 'Penicillin anaphylaxis in 1985');
        assert.match(cw.renderForBrain(), /ON THE DOCTOR'S RADAR[^\n]*\n- \[to do, flagged: Penicillin anaphylaxis in 1985\] order: Zosyn IV/, 'the brain can say what is still to sign');
        await cw.actions();
        assert.strictEqual(cw.wm.actions[0].flag, 'Penicillin anaphylaxis in 1985', 'a routine update does not drop the flag');
        assert.strictEqual(cw.wm.actions[0].next, 'Choose the dose');
        assert.match(cw.renderForActions([]), /A1 \[todo, flag: Penicillin anaphylaxis in 1985\] order \(medication\): Zosyn IV · next: Choose the dose/);
        await cw.actions();
        assert.strictEqual(cw.wm.actions[0].flag, '', 'a changed order (new title) loses the old flag');
        assert.strictEqual(cw.wm.actions[0].next, 'Choose the dose', 'an empty next keeps the last one');
        cw.stop();
    });

    await check('radar guards: a hold is a nursing order; a drug only the coworker named waits for the doctor; an alert that also says hold does not flag the hold', async () => {
        const replies = [
            // The doctor holds spironolactone; the model writes a medication order for it, flagged by an alert that agrees.
            [item({ title: 'Hold spironolactone tonight', order_type: 'medication', fields: [{ key: 'name', value: 'Spironolactone' }, { key: 'dose', value: '25 mg' }], flag: 'K 5.1: hold spironolactone and Entresto', alert: 'S1' })],
            // "I want the rate down": the model fills in the coworker's amiodarone; the diltiazem the doctor said is fine.
            [item({ title: 'Amiodarone for AF rate control', order_type: 'medication', fields: [{ key: 'name', value: 'Amiodarone' }] }), item({ title: 'Diltiazem 10 mg IV push now', order_type: 'medication', fields: [{ key: 'name', value: 'Diltiazem' }] })],
            // The same drug, retitled onto the diltiazem item: still the coworker's idea.
            [item({ id: 'A2', title: 'Amiodarone 150 mg IV now', order_type: 'medication', fields: [{ key: 'name', value: 'Amiodarone' }] })],
            // "Lasix" said, "Furosemide" written (and the coworker said furosemide too): the doctor's order.
            [item({ title: 'Furosemide 80 mg IV now', order_type: 'medication', fields: [{ key: 'name', value: 'Furosemide' }] })],
            // The doctor takes the coworker's suggestion.
            [item({ title: 'Amiodarone 150 mg IV now', order_type: 'medication', fields: [{ key: 'name', value: 'Amiodarone' }] })],
        ];
        let n = 0;
        const t = fakeTransport((lane) => (lane === 'actions' ? radarReply(replies[n++] || []) : reply(JSON.stringify(TAKE()))));
        const cw = LiveCore.createCoworker({ transport: t, chart, clock: manualClock() });
        cw.start({ skipPrime: true });
        const hear = (speaker, text) => { const id = 'L' + (cw.wm.lines.length + 1); cw.wm.lines.push({ id, t: 0, speaker, text }); cw.wm.plan.push({ id: 'P' + (cw.wm.plan.length + 1), t: 0, text, kind: 'order', line: id }); };
        const say = (id, text) => cw.wm.said.push({ id, t: 0, kind: 'critical', topic: id, text, why: '', question: '', cueLine: null, via: 'test', updateOf: null });
        const titles = () => cw.wm.actions.map((a) => a.title);

        say('S1', 'K 5.1 and creatinine 2.4: hold spironolactone and Entresto.');
        hear('doctor', 'Hold the spironolactone tonight with the potassium at 5.1.');
        await cw.actions();
        const hold = cw.wm.actions[0];
        assert.strictEqual(hold.orderType, 'nursing', 'a hold is a nursing order');
        assert.deepStrictEqual(hold.fields, { orderType: 'Other', details: 'Hold spironolactone tonight', priority: 'Routine' }, 'no dose: nothing that would give the drug');
        assert.strictEqual(hold.flag, '', 'the alert says hold too: no flag');

        say('S2', 'For rate control avoid diltiazem (EF 35%); consider IV amiodarone or digoxin.');
        hear('doctor', "His heart can't fill at that rate, so I want the rate down now.");
        hear('doctor', "Okay, let's push 10 of IV diltiazem.");
        await cw.actions();
        assert.deepStrictEqual(titles(), ['Hold spironolactone tonight', 'Diltiazem 10 mg IV push now'], 'no amiodarone: only the coworker named it');
        await cw.actions();
        assert.strictEqual(cw.wm.actions[1].title, 'Diltiazem 10 mg IV push now', 'not retitled to the coworker\'s drug either');

        say('S3', 'Check a hemoglobin before more furosemide.');
        hear('doctor', 'Give him 80 of IV Lasix now.');
        await cw.actions();
        assert.ok(titles().includes('Furosemide 80 mg IV now'), 'Lasix heard counts for furosemide');

        cw.wm.said.push({ id: 'S4', t: 0, kind: 'answer', topic: 'answer', text: 'Amiodarone 150 mg IV over 10 minutes, then a drip.', why: '', question: 'what would you use?', cueLine: null, via: 'test', updateOf: null });
        hear('doctor', "Okay, let's do that.");
        await cw.actions();
        assert.ok(titles().includes('Amiodarone 150 mg IV now'), 'the doctor took it up');
        cw.stop();
    });

    await check('radar merge: two items side by side are two things; a later repeat updates the closest title', async () => {
        const replies = [
            [item({ title: 'BMP and magnesium in the morning', order_type: 'lab', fields: [{ key: 'name', value: 'Basic Metabolic Panel' }] }), item({ title: 'Magnesium in the morning', order_type: 'lab', fields: [{ key: 'name', value: 'Magnesium' }] })],
            [item({ title: 'Magnesium in the morning', order_type: 'lab', fields: [{ key: 'name', value: 'Magnesium' }, { key: 'priority', value: 'Routine' }] })],
        ];
        let n = 0;
        const t = fakeTransport((lane) => (lane === 'actions' ? radarReply(replies[n++] || []) : reply(JSON.stringify(TAKE()))));
        const cw = LiveCore.createCoworker({ transport: t, chart, clock: manualClock() });
        cw.start({ skipPrime: true });
        cw.wm.plan.push({ id: 'P1', t: 0, text: 'Repeat BMP and magnesium in the morning', kind: 'test', line: 'L1' });
        await cw.actions();
        assert.deepStrictEqual(cw.wm.actions.map((a) => a.title), ['BMP and magnesium in the morning', 'Magnesium in the morning'], 'the BMP is not swallowed');
        await cw.actions();
        assert.strictEqual(cw.wm.actions.length, 2, 'listed again: an update, not a third item');
        assert.strictEqual(cw.wm.actions[0].title, 'BMP and magnesium in the morning', 'the BMP item keeps its title');
        assert.strictEqual(cw.wm.actions[1].fields.priority, 'Routine', 'the closest title got the update');
        cw.stop();
    });

    await check('a busy radar tries again (4 s, 8 s), then shows the item as heard but not ready', async () => {
        let busy = true, calls = 0;
        const t = fakeTransport((lane) => {
            if (lane === 'ear') return reply(JSON.stringify(Object.assign({}, EMPTY_EAR, { plan: [{ text: 'EKG now', kind: 'test' }] })));
            if (lane === 'actions') {
                calls++;
                if (busy) throw Object.assign(new Error('AI call failed (529): Overloaded'), { status: 529 });
                return radarReply([item({ title: 'EKG now', order_type: 'procedure' }), item({ title: 'Troponin now', order_type: 'lab' })]);
            }
            return reply(JSON.stringify(TAKE()));
        });
        const clock = manualClock();
        const cw = LiveCore.createCoworker({ transport: t, chart, clock });
        const seen = [];
        cw.on('actions', () => seen.push(cw.wm.plan.map((p) => p.radar).join(',')));
        cw.start({ skipPrime: true });
        cw.hear({ speaker: 'doctor', text: 'EKG now.' });
        await cw.idle();
        clock.advance(1200); await cw.idle();
        assert.strictEqual(calls, 1);
        clock.advance(3999); await cw.idle();
        assert.strictEqual(calls, 1, 'waits 4 s');
        clock.advance(1); await cw.idle();
        assert.strictEqual(calls, 2);
        clock.advance(8000); await cw.idle();
        assert.strictEqual(calls, 3);
        assert.strictEqual(cw.wm.plan[0].radar, 'failed', 'shown as heard, not ready');
        clock.advance(60000); await cw.idle();
        assert.strictEqual(calls, 3, 'no endless retries');
        busy = false;
        await cw.actions();
        assert.strictEqual(cw.wm.plan[0].radar, true, 'the next run picks it up');
        assert.strictEqual(cw.wm.actions.length, 2);
        cw.stop();
    });

    await check('toOrderForm maps the model\'s words to the order form\'s choices and never guesses', async () => {
        const vm = require('vm');
        const ctx = { window: {}, document: { addEventListener() {}, getElementById: () => null }, console };
        vm.createContext(ctx);
        vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'js', 'components', 'order-entry.js'), 'utf8'), ctx);
        const types = ctx.window.OrderEntry.orderTypes;
        const form = (type, values) => LiveCore.toOrderForm(types[type].fields, values);
        assert.deepStrictEqual(form('medication', { name: 'Furosemide', dose: '40 mg', route: 'iv push', frequency: 'twice a day', indication: 'HF' }),
            { name: 'Furosemide', dose: '40 mg', route: 'IV Push', frequency: 'BID', indication: 'HF' });
        assert.strictEqual(form('medication', { route: 'IV push over 2 minutes' }).route, 'IV Push', 'longest choice wins');
        assert.strictEqual(form('medication', { route: 'IV' }).route, 'IV');
        assert.strictEqual(form('medication', { frequency: 'every few hours as he needs' }).frequency, undefined, 'no guess');
        assert.strictEqual(form('medication', { frequency: 'drip' }).frequency, 'Continuous');
        assert.deepStrictEqual(form('lab', { name: 'BMP', priority: 'in the morning' }), { name: 'Basic Metabolic Panel', priority: 'Routine' });
        assert.deepStrictEqual(form('lab', { name: 'Type and screen' }), { name: 'Other', customName: 'Type and screen' }, 'an unknown test goes in "Other"');
        assert.strictEqual(form('lab', { name: 'Coagulation Panel (PT/INR/PTT)' }).name, 'Coagulation Panel (PT/INR/PTT)');
        assert.strictEqual(form('lab', { name: 'INR' }).name, 'Coagulation Panel (PT/INR/PTT)');
        assert.deepStrictEqual(form('consult', { specialty: 'GI', reason: 'Melena' }), { specialty: 'Gastroenterology', reason: 'Melena' });
        assert.deepStrictEqual(form('consult', { specialty: 'Palliative care' }), { specialty: 'Other', customSpecialty: 'Palliative care' });
        assert.strictEqual(form('imaging', { modality: 'CXR', contrast: 'without IV contrast' }).modality, 'X-Ray');
        assert.strictEqual(form('imaging', { contrast: 'without IV contrast' }).contrast, 'Without contrast');
        assert.strictEqual(form('nursing', { orderType: 'strict I&O' }).orderType, 'I&O Monitoring');
    });

    await check('the radar\'s field guide matches the EHR order form (keys and choices)', async () => {
        const vm = require('vm');
        const ctx = { window: {}, document: { addEventListener() {}, getElementById: () => null }, console };
        vm.createContext(ctx);
        vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'js', 'components', 'order-entry.js'), 'utf8'), ctx);
        const types = ctx.window.OrderEntry.orderTypes;
        for (const [type, guide] of Object.entries(P.ORDER_FIELDS)) {
            assert.ok(types[type], 'order type ' + type + ' exists');
            const fields = types[type].fields.filter((f) => f.type !== 'multiselect');
            // (Arrays from the order form's own context: copy them before comparing.)
            assert.deepStrictEqual(Object.keys(guide).sort(), Array.from(fields, (f) => f.name).sort(), type + ' keys');
            for (const f of fields) {
                const want = f.type === 'select' ? Array.from(f.options).filter((o) => !/^-{2,}/.test(o)) : null;
                assert.deepStrictEqual(guide[f.name], want, type + '.' + f.name + ' choices');
            }
        }
        assert.match(P.ACTIONS_SYSTEM, /lab: name \[Complete Blood Count \| Basic Metabolic Panel/);
        assert.ok(P.EAR_SCHEMA.properties.plan.items.properties.kind.enum.includes('cancel'));
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
        assert.match(cw.wm.held.find((h) => h.topic === 'topic-1').reason, /its take update/, 'a held thought remembers what raised it');
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
        // Why it said that: the lookups behind the answer, and what each prompt was made of.
        assert.strictEqual(said[0].tools.length, 1);
        assert.strictEqual(said[0].tools[0].name, 'lookup_labs');
        assert.match(said[0].tools[0].result, /Potassium/);
        const parts = cw.calls.filter((c) => c.lane === 'answer').map((c) => c.parts);
        assert.ok(parts[0].rules > 1000 && parts[0].digest > 1000 && parts[0].tools > 500, 'fixed parts: rules, digest, tools');
        assert.ok(parts[0].memory > 0 && parts[0].conversation > 0 && parts[0].task > 0 && parts[0].lookups === 0);
        assert.ok(parts[1].lookups > 0, 'the second round carries the lookup results');
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
