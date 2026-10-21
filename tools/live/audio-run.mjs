#!/usr/bin/env node
// Live-audio test: plays the scripted encounter's synthetic audio (made by
// tools/live/script-audio.mjs) into a private headless Chrome as its
// microphone, lets the Live Coworker listen through the room-mic path
// (DeepgramClient -> the server's /ws/transcribe -> Deepgram, speakers
// separated), then scores what it said with the same scorer as the replay.
// Needs DEEPGRAM_API_KEY and the Anthropic keys on the server. Simulated
// patient only. The site password box is skipped by pre-seeding localStorage
// 'access-granted' (no password typed).
//
//   node tools/live/audio-run.mjs                        lab, Sonnet, Abreast (~11 min)
//   node tools/live/audio-run.mjs --brain=opus --mode=lead
//   node tools/live/audio-run.mjs --site=http://127.0.0.1:8787   (this checkout via the dev proxy)
//   node tools/live/audio-run.mjs --mic=general     Deepgram's general model instead of the medical one
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { score, judge, printScore } from './score.mjs';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const { startChrome, openPage, sleep, cleanup } = require(path.join(ROOT, 'tests/helpers/cdp-browser.cjs'));
const LiveTransport = require(path.join(ROOT, 'js/live/live-transport.js'));

const argv = Object.fromEntries(process.argv.slice(2).map((a) => { const m = a.match(/^--([^=]+)(?:=(.*))?$/); return m ? [m[1], m[2] === undefined ? true : m[2]] : [a, true]; }));
const BRAINS = { sonnet: 'claude-sonnet-5-5', opus: 'claude-opus-5-5' };
const SITE = (argv.site || 'https://acting-intern-lab.onrender.com').replace(/\/+$/, '');
const SCRIPT = path.join(ROOT, argv.script || 'data/live/morrison-admission-01.json');
const script = JSON.parse(fs.readFileSync(SCRIPT, 'utf8'));
const AUDIO = path.join(ROOT, argv.audio || ('tools/live/runs/audio/' + script.id));
const brain = BRAINS[argv.brain] || argv.brain || 'claude-sonnet-5-5';
const mode = argv.mode || 'abreast';
const mic = argv.mic === 'general' ? 'general' : 'medical';
const t0 = Date.now();
const stamp = () => '[' + Math.round((Date.now() - t0) / 1000) + 's]';

async function main() {
    if (!fs.existsSync(AUDIO + '.wav')) throw new Error('No audio yet: run node tools/live/script-audio.mjs first');
    const timing = JSON.parse(fs.readFileSync(AUDIO + '.timing.json', 'utf8'));
    const health = await fetch(SITE + '/api/health').then((r) => r.json());
    if (!health.apiConfigured || !health.deepgramConfigured) throw new Error(SITE + ' is missing keys: ' + JSON.stringify(health));

    // Chrome's audio service is sandboxed on macOS and silently reads zeros from
    // a fake-capture file; run it in-process for this throwaway profile. The file
    // goes to a temp path without spaces.
    const wavCopy = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'live-audio-')), 'encounter.wav');
    fs.copyFileSync(AUDIO + '.wav', wavCopy);
    const chrome = await startChrome(['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream',
        '--use-file-for-fake-audio-capture=' + wavCopy + '%noloop', '--autoplay-policy=no-user-gesture-required',
        '--disable-features=AudioServiceSandbox,AudioServiceOutOfProcess']);
    const page = await openPage(chrome.cdp, SITE);
    try {
        await page.goto(SITE + '/favicon.svg');
        await page.eval("localStorage.setItem('access-granted','gate'); localStorage.setItem('app-mode','assistant'); localStorage.setItem('ai-panel-collapsed','false'); localStorage.setItem('live-coworker', JSON.stringify({ brain: " + JSON.stringify(brain) + ", mode: " + JSON.stringify(mode) + ", source: 'room', chime: false, speakAloud: false, classic: false })); true");
        await page.goto(SITE + '/?allmodes' + (mic === 'general' ? '&livemic=general' : '') + '#/chart-review');
        if (!(await page.waitFor("typeof LiveApp !== 'undefined' && !!LiveApp.engine && !!LiveApp.chart && LiveApp.view.deepgram === true", 90000))) throw new Error('live coworker not ready (or no Deepgram on the server)');
        // Fresh encounter; wait for the chart read so the take exists before audio starts.
        await page.eval('LiveApp.newEncounter(); true');
        await page.waitFor('!!LiveApp.view.take', 60000);
        const eMic = await page.eval('LiveApp.engine.elapsed');
        await page.eval('LiveApp.startListening().then(() => true)');
        const micState = await page.eval('LiveApp.view.status.state');
        console.log(stamp(), 'Listening (' + micState + ', ' + mic + ' speech model); audio ' + Math.round(timing.duration_s) + 's, brain ' + brain + ', ' + mode);
        let lastLines = 0;
        const end = Date.now() + (timing.duration_s + 12) * 1000;
        while (Date.now() < end) {
            await sleep(15000);
            const p = await page.eval('({ lines: LiveApp.view.lines.length, said: LiveApp.view.said.length, calls: LiveApp.engine.calls.length, cost: +LiveApp.engine.stats().cost.toFixed(3), state: LiveApp.view.status.state })');
            if (p.lines !== lastLines) console.log(stamp(), JSON.stringify(p));
            lastLines = p.lines;
        }
        await page.eval('LiveApp.stopListening(); true');
        await page.eval('LiveApp.engine.idle()');
        const data = await page.eval('JSON.stringify({ said: LiveApp.view.said, lines: LiveApp.view.lines, calls: LiveApp.engine.calls, wm: { facts: LiveApp.engine.wm.facts, thinking: LiveApp.engine.wm.thinking, plan: LiveApp.engine.wm.plan, take: LiveApp.engine.wm.take, watch: LiveApp.engine.wm.watch }, cfg: LiveApp.engine.cfg })');
        const d = JSON.parse(data);

        // Align engine time to audio time, then map answers to the question lines.
        const toAudio = (engineMs) => +((engineMs - eMic) / 1000 - 0.15).toFixed(1);
        const lineEnd = Object.fromEntries(timing.lines.map((l) => [l.id, l]));
        const questions = script.expect.filter((e) => e.type === 'answer');
        const said = d.said.slice().reverse().map((s) => {
            const at = toAudio(s.t);
            let cueLine = null;
            if (s.kind === 'answer') {
                const q = questions.filter((x) => lineEnd[x.cue] && lineEnd[x.cue].start <= at).pop();
                cueLine = q ? q.cue : null;
            } else {
                const prev = timing.lines.filter((l) => l.end <= at).pop();
                cueLine = prev ? prev.id : null;
            }
            return Object.assign({}, s, { scriptT: at, cueLine, wallLatencyMs: cueLine && lineEnd[cueLine] ? Math.round((at - lineEnd[cueLine].end) * 1000) : null });
        });
        // The scorer measures windows against the script's times; use the audio's.
        const audioScript = Object.assign({}, script, { lines: script.lines.map((l) => (lineEnd[l.id] ? Object.assign({}, l, { t: lineEnd[l.id].start, dur: lineEnd[l.id].end - lineEnd[l.id].start }) : l)) });
        const run = { script: script.id, at: new Date().toISOString(), config: { brain, mode, pace: 'audio', memory: 'site', mic }, said, calls: d.calls, heard: d.lines, finalTake: d.wm.take, facts: d.wm.facts, thinking: d.wm.thinking, plan: d.wm.plan };
        const transport = LiveTransport.createTransport({ endpoint: SITE + '/api/claude-full' });
        const judged = argv['no-judge'] ? null : await judge(transport, audioScript, run).catch((e) => ({ out: null, error: e.message }));
        const metrics = score(audioScript, run, judged);
        run.metrics = metrics;
        run.judge = judged;
        const outDir = path.join(ROOT, 'tools/live/runs');
        const name = run.at.replace(/[:.]/g, '-').slice(0, 19) + '-audio-' + mic + '-' + brain.replace('claude-', '') + '-' + mode;
        fs.writeFileSync(path.join(outDir, name + '.json'), JSON.stringify(run, null, 1));
        console.log('\nHeard ' + d.lines.length + ' lines (script has ' + script.lines.length + '). Speakers: ' + JSON.stringify(d.lines.reduce((m, l) => { m[l.speaker] = (m[l.speaker] || 0) + 1; return m; }, {})));
        console.log(printScore(metrics, name));
        console.log('Report: ' + path.join(outDir, name + '.json'));
    } finally {
        await page.close().catch(() => {});
        chrome.stop();
        cleanup();
    }
}

main().catch((e) => { console.error(stamp(), 'Audio run failed:', e && (e.stack || e.message || e)); process.exit(1); });
