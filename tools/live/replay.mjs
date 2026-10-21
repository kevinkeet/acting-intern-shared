#!/usr/bin/env node
// Replays a scripted encounter through the Live Coworker engine and scores it.
//
// The engine is the same code the browser runs (js/live/*.js). AI calls go to
// a server's /api/claude-full (default: the lab), so no API key is needed here.
//
//   node tools/live/replay.mjs                       Sonnet brain, Abreast, step mode, AI judge
//   node tools/live/replay.mjs --brain=opus --mode=lead
//   node tools/live/replay.mjs --pace=realtime --speed=1   (real timing, ~10 min)
//   node tools/live/replay.mjs --until=U30 --no-judge      (quick partial run)
//   node tools/live/replay.mjs --endpoint=http://localhost:3000/api/claude-full
//
// Step mode runs on a virtual clock: each line is "spoken" when its time comes,
// then the run waits for every AI call it set off before the next line, so a
// run is repeatable. Wall-clock latency of each call chain is still measured.
// Reports go to tools/live/runs/ (not committed); one summary line is added to
// tools/live/runs/index.tsv.
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { score, judge, printScore } from './score.mjs';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const LiveCore = require(path.join(ROOT, 'js/live/live-core.js'));
const LiveChart = require(path.join(ROOT, 'js/live/live-chart.js'));
const LiveMemory = require(path.join(ROOT, 'js/live/live-memory.js'));
const LiveTransport = require(path.join(ROOT, 'js/live/live-transport.js'));
const LivePrompts = require(path.join(ROOT, 'js/live/live-prompts.js'));

const argv = Object.fromEntries(process.argv.slice(2).map((a) => {
    const m = a.match(/^--([^=]+)(?:=(.*))?$/);
    return m ? [m[1], m[2] === undefined ? true : m[2]] : [a, true];
}));
const BRAINS = { sonnet: 'claude-sonnet-5-5', opus: 'claude-opus-5-5', haiku: 'claude-haiku-5-5' };
const opt = {
    script: argv.script || 'data/live/morrison-admission-01.json',
    brain: BRAINS[argv.brain] || argv.brain || 'claude-sonnet-5-5',
    mode: argv.mode || 'abreast',
    pace: argv.pace || 'step',
    speed: parseFloat(argv.speed || '1'),
    endpoint: argv.endpoint || 'https://acting-intern-lab.onrender.com/api/claude-full',
    memory: argv.memory || 'auto',
    judge: !argv['no-judge'],
    until: argv.until || null,
    label: argv.label || '',
    fast: !!argv.fast,
    effort: argv.effort ? JSON.parse(argv.effort) : null,
    config: argv.config ? JSON.parse(argv.config) : null,
    quiet: !!argv.quiet,
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (...a) => { if (!opt.quiet) console.log(...a); };

function virtualClock() {
    let now = 0;
    let timers = [];
    return {
        now: () => now,
        setTimeout: (fn, ms) => { const h = { at: now + Math.max(0, ms), fn }; timers.push(h); return h; },
        clearTimeout: (h) => { timers = timers.filter((x) => x !== h); },
        async advanceTo(target, settle) {
            for (;;) {
                timers.sort((a, b) => a.at - b.at);
                const next = timers[0];
                if (!next || next.at > target) break;
                timers.shift();
                now = next.at;
                next.fn();
                await settle();
            }
            now = Math.max(now, target);
        },
    };
}

// --dry: a scripted stand-in for the models, to check this harness offline.
function dryTransport() {
    const R = (obj) => { const text = typeof obj === 'string' ? obj : JSON.stringify(obj); return { message: { content: [{ type: 'text', text }], stop_reason: 'end_turn', usage: { input_tokens: 1000, output_tokens: 100 } }, text, usage: { input_tokens: 1000, output_tokens: 100 }, cost: 0.001, ms: { ttft: 50, total: 120 }, servedBy: 'dry', fellBack: false }; };
    const TRAPS = [[/zosyn/i, 'Zosyn ordered with penicillin anaphylaxis'], [/heparin drip/i, 'heparin with prior major GI bleed'], [/diltiazem/i, 'diltiazem in HFrEF'], [/potassium chloride/i, 'KCl with K 5.1'], [/metformin and the gabapentin/i, 'metformin with eGFR under 30'], [/almost black/i, 'black stools with ulcer history'], [/inr 2\.3\. okay/i, 'INR 2.3 off warfarin'], [/words came out/i, 'possible TIA']];
    const SAY = { 'Zosyn ordered with penicillin anaphylaxis': 'Hold the Zosyn: penicillin anaphylaxis in 1985. Ceftriaxone was tolerated in 2021.', 'heparin with prior major GI bleed': 'No heparin drip: anticoagulation stopped after his 2023 ulcer bleed, and the black stools suggest bleeding now.', 'diltiazem in HFrEF': 'Avoid diltiazem: EF 30-35%, it can worsen heart failure.', 'KCl with K 5.1': 'Skip the KCl: potassium is already 5.1.', 'metformin with eGFR under 30': 'Hold metformin: creatinine 2.4, eGFR under 30.', 'black stools with ulcer history': 'Black stools with his 2023 ulcer bleed and aspirin: possible GI bleed, check hemoglobin.', 'INR 2.3 off warfarin': 'INR 2.3 is unexplained: he has been off warfarin since 2023.', 'possible TIA': 'That sounds like a TIA in AF without anticoagulation: needs urgent workup.' };
    return {
        async callWithRetry(req, hooks) {
            await sleep(5);
            const body = req.body;
            const user = JSON.stringify(body.messages);
            if (req.label === 'ear') {
                const m = user.match(/<new_lines>(.*?)<\/new_lines>/s);
                const nl = m ? m[1] : '';
                const trap = TRAPS.find(([re]) => re.test(nl));
                const q = /coworker,/i.test(nl);
                return R({ facts: [{ text: nl.slice(-60), kind: 'other', from: 'doctor' }], doctor_thinking: [], plan: [], to_coworker: q, question: q ? 'question' : '', watch_hits: [], alarm: trap ? 'possible_critical' : 'none', alarm_reason: trap ? trap[1] : '', worth_a_look: false, speaker_fix: [] });
            }
            if (req.label === 'verify') {
                const reason = (user.match(/possibly critical: \\"(.*?)\\"/) || [])[1] || '';
                return R({ should_say: !!SAY[reason], severity: 'critical', topic: reason.split(' ')[0].toLowerCase(), text: SAY[reason] || '', why: 'dry' });
            }
            if (req.label === 'answer') { const t = 'Dry answer: baseline creatinine about 2.0; no lisinopril (angioedema, on Entresto); 2023 GI bleed; ceftriaxone.'; if (hooks && hooks.onText) hooks.onText(t, 0); return R(t); }
            if (req.label === 'judge') return R({ remarks: [], answers: [], summary: 'dry run' });
            return R({ take: { one_liner: 'dry', assessment: 'dry', concerns: [], next: [], doctor_view: '', differs: '' }, watch: [{ id: 'pcn', trigger: 'penicillin order', alert: 'pcn anaphylaxis', severity: 'critical' }], say: { should_say: false, kind: 'insight', topic: '', text: '', why: '' } });
        },
    };
}

async function main() {
    const script = JSON.parse(fs.readFileSync(path.join(ROOT, opt.script), 'utf8'));
    const patientDir = path.join(ROOT, 'data/patients', script.patient || 'PAT001');
    const chart = LiveChart.create({ patientId: script.patient, loadJSON: async (p) => JSON.parse(fs.readFileSync(path.join(patientDir, p), 'utf8')) });
    await chart.load();

    // Memory: the frozen full Deep Learn fixture if present, else the shipped seed.
    let memoryDocument = null, extractedFacts = null, memorySource = 'none';
    const fixture = path.join(ROOT, 'data/live', (script.patient || 'PAT001') + '-deep-memory.json');
    if ((opt.memory === 'auto' || opt.memory === 'fixture') && fs.existsSync(fixture)) {
        const fx = JSON.parse(fs.readFileSync(fixture, 'utf8'));
        memoryDocument = fx.memoryDocument || (fx.longitudinalDoc && fx.longitudinalDoc.aiMemory && fx.longitudinalDoc.aiMemory.memoryDocument);
        extractedFacts = fx.extractedFacts || null;
        memorySource = 'fixture';
    } else if (opt.memory === 'auto' || opt.memory === 'seed') {
        const seed = JSON.parse(fs.readFileSync(path.join(patientDir, 'ai-seed.json'), 'utf8'));
        memoryDocument = seed.longitudinalDoc.aiMemory.memoryDocument;
        memorySource = 'seed';
    }
    const memory = LiveMemory.build({ chart, memoryDocument, extractedFacts });

    const transport = argv.dry ? dryTransport() : LiveTransport.createTransport({ endpoint: opt.endpoint });
    if (!argv.dry) {
        const health = await fetch(opt.endpoint.replace(/\/api\/claude-full$/, '/api/health')).then((r) => r.json()).catch((e) => ({ error: e.message }));
        if (!health.apiConfigured) throw new Error('The server at ' + opt.endpoint + ' has no API key configured: ' + JSON.stringify(health));
    }

    const stepMode = opt.pace === 'step';
    const vclock = stepMode ? virtualClock() : null;
    const config = Object.assign({ brainModel: opt.brain, mode: opt.mode, speed: opt.fast ? 'fast' : null }, opt.config || {});
    if (opt.effort) config.effort = opt.effort;
    if (!stepMode && opt.speed !== 1) {
        config.heartbeatMs = Math.round((config.heartbeatMs || LiveCore.DEFAULTS.heartbeatMs) / opt.speed);
        config.quickLookMs = Math.round((config.quickLookMs || LiveCore.DEFAULTS.quickLookMs) / opt.speed);
        config.insightGapMs = Math.round((config.insightGapMs || LiveCore.DEFAULTS.insightGapMs) / opt.speed);
    }
    const cw = LiveCore.createCoworker({ transport, chart, memory, clock: vclock || undefined, config });

    const wall0 = performance.now();
    const fedAt = {};          // script line id -> wall time it was heard
    const toScript = {};       // engine line id (L7) -> script line id (U7)
    const scriptNow = () => (stepMode ? vclock.now() / 1000 : ((performance.now() - runStart) / 1000) * opt.speed);
    let runStart = performance.now();
    const said = [], events = [];
    const firstText = {};
    cw.on('say-partial', (p) => { if (p.text && firstText[p.id] == null) firstText[p.id] = performance.now(); });
    cw.on('say', (s) => {
        const cue = s.cueLine ? (toScript[s.cueLine] || s.cueLine) : null;
        const cueWall = cue && fedAt[cue];
        const rec = Object.assign({}, s, {
            cueLine: cue,
            scriptT: +scriptNow().toFixed(1),
            wallLatencyMs: cueWall ? Math.round(performance.now() - cueWall) : null,
            firstTextMs: cueWall && firstText[s.id] ? Math.round(firstText[s.id] - cueWall) : null,
        });
        said.push(rec);
        log('  ' + (s.kind === 'answer' ? '💬' : s.kind === 'critical' ? '🚨' : '💡') + ' [' + rec.scriptT + 's' + (rec.wallLatencyMs != null ? ', ' + (rec.wallLatencyMs / 1000).toFixed(1) + 's' : '') + '] ' + (s.question ? '(' + s.question + ') ' : '') + s.text);
    });
    for (const name of ['suppressed', 'held', 'verified', 'tool', 'error', 'take', 'watch']) {
        cw.on(name, (p) => {
            events.push({ name, t: +scriptNow().toFixed(1), p });
            if (name === 'error') log('  ⚠️  ' + p.lane + ': ' + p.message);
            if (name === 'tool') log('     🔧 ' + p.name + ' ' + JSON.stringify(p.input).slice(0, 100));
            if (name === 'verified' && p.out) log('     ✔︎ verify (' + p.reason.slice(0, 60) + '…) → ' + (p.out.should_say ? 'SAY' : 'quiet') + (p.out.should_say ? '' : ': ' + (p.out.why || '').slice(0, 80)));
        });
    }

    log('Replay ' + script.id + ' · brain ' + opt.brain + ' · ' + opt.mode + ' · ' + opt.pace + (opt.pace !== 'step' ? ' x' + opt.speed : '') + ' · memory ' + memorySource + ' (digest ' + memory.meta.digestChars + ' chars, long-term ' + memory.meta.longTermChars + ')');

    // Before the visit: the brain primes its take and watch list.
    cw.start();
    await cw.idle();
    const watchAtStart = cw.wm.watch.slice();
    log('Primed in ' + ((performance.now() - wall0) / 1000).toFixed(1) + 's. Watching for: ' + watchAtStart.map((w) => w.id).join(', '));
    runStart = performance.now();

    const lines = opt.until ? script.lines.slice(0, script.lines.findIndex((l) => l.id === opt.until) + 1) : script.lines;
    for (const line of lines) {
        const at = line.t + line.dur;
        if (stepMode) {
            await vclock.advanceTo(at * 1000, () => cw.idle());
        } else {
            const wait = runStart + (at * 1000) / opt.speed - performance.now();
            if (wait > 0) await sleep(wait);
        }
        fedAt[line.id] = performance.now();
        log(line.id + ' ' + line.speaker.toUpperCase() + ': ' + line.text);
        const heard = cw.hear({ speaker: line.speaker === 'doctor' ? 'doctor' : line.speaker === 'patient' ? 'patient' : 'other', text: (line.speaker === 'wife' ? '(wife) ' : line.speaker === 'nurse' ? '(nurse) ' : '') + line.text });
        if (heard) toScript[heard.id] = line.id;
        if (stepMode) await cw.idle();
    }
    // Let pending thinking finish (and one more look for anything still unsaid).
    if (stepMode) await vclock.advanceTo((lines[lines.length - 1].t + lines[lines.length - 1].dur + 20) * 1000, () => cw.idle());
    else await sleep(Math.max(3000, 20000 / opt.speed));
    await cw.idle();
    cw.stop();

    const run = {
        script: script.id, at: new Date().toISOString(), config: { brain: opt.brain, mode: opt.mode, pace: opt.pace, speed: opt.speed, memory: memorySource, fast: opt.fast, prompts: LivePrompts.PROMPT_VERSION, effort: cw.cfg.effort },
        said, calls: cw.calls, watchAtStart, finalTake: cw.wm.take, finalWatch: cw.wm.watch, facts: cw.wm.facts, thinking: cw.wm.thinking, plan: cw.wm.plan, held: cw.wm.held, events,
        wallSeconds: Math.round((performance.now() - wall0) / 1000),
    };
    run.config.mode = opt.mode;

    let judged = null;
    if (opt.judge) {
        log('Judging…');
        judged = argv.dry ? null : await judge(transport, script, run).catch((e) => ({ out: null, error: e.message }));
        if (judged && !judged.out) log('Judge failed: ' + (judged.error || 'bad output') + ' (keyword scoring only)');
    }
    const metrics = score(script, run, judged);
    run.metrics = metrics;
    run.judge = judged;

    const outDir = path.join(ROOT, 'tools/live/runs');
    fs.mkdirSync(outDir, { recursive: true });
    const name = run.at.replace(/[:.]/g, '-').slice(0, 19) + '-' + opt.brain.replace('claude-', '') + '-' + opt.mode + (opt.label ? '-' + opt.label : '');
    fs.writeFileSync(path.join(outDir, name + '.json'), JSON.stringify(run, null, 1));
    const idx = path.join(outDir, 'index.tsv');
    if (!fs.existsSync(idx)) fs.writeFileSync(idx, ['run', 'prompts', 'brain', 'mode', 'pace', 'memory', 'must', 'answers', 'false_alarms', 'extras', 'repeats', 'wrong', 'alert_ms_med', 'answer_first_ms', 'cost', 'label'].join('\t') + '\n');
    fs.appendFileSync(idx, [name, LivePrompts.PROMPT_VERSION, opt.brain, opt.mode, opt.pace, memorySource, metrics.must.hit + '/' + metrics.must.of, metrics.answers.points + '/' + metrics.answers.of, metrics.falseAlarms, metrics.extras, metrics.repeats, metrics.wrong, metrics.alertLatencyMs.median, metrics.answerLatencyMs.firstWordMedian, metrics.cost, opt.label].join('\t') + '\n');

    console.log('\n' + printScore(metrics, name));
    console.log('Report: ' + path.join(outDir, name + '.json') + '  (wall ' + run.wallSeconds + 's)');
}

main().catch((e) => { console.error('Replay failed: ' + (e && e.stack || e)); process.exit(1); });
