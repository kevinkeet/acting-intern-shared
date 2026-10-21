#!/usr/bin/env node
// Read-only browser smoke test for the study pages (guardrails, 21 Oct 2026).
//
// Starts this checkout's server.js on a free local port with FAKE API keys and a
// fake Anthropic (tests/helpers/fake-anthropic.cjs), then drives a private
// headless Chrome (its own throwaway profile, so Kevin's Chrome is untouched)
// through the three doors of the site and checks:
//   - the study door renders the participant-code page with no uncaught errors,
//     and loading a study case chart works;
//   - study and demo AI calls land on /api/claude (shared key), full-site calls
//     on /api/claude-full (full-site key), checked end to end through the fake;
//   - the study door still loads when the AI Coworker or AI panel is broken
//     (the files are rewritten in flight; nothing on disk changes).
// It never starts a case, enters a participant code or signs in. Every request
// that would write to an outside host (Supabase, Anthropic, analytics) is
// blocked, and a blocked write counts as a failure, so the test cannot touch
// study data. Page loads that need the CDNs (Supabase JS, Lucide, Chart.js)
// need internet.
//
// Run:   node scripts/smoke-study.mjs            (about 30-60 seconds)
//        node scripts/smoke-study.mjs --verbose  (print page errors and logs)
// Proof that the sabotage check can fail: serve app.js from a commit without
// the start-up firewall; the study door should FAIL under sabotage:
//        node scripts/smoke-study.mjs --app-js-from=3adaf2f --only=sabotage
// After a deploy, check the LIVE site the same way (read-only):
//        node scripts/smoke-study.mjs --live=https://actingintern.com
//   It never types or skips the site password: the pages are checked as they
//   render behind the password box. It blocks every write, including to the
//   live site, and checks that the live files match this checkout. It also
//   makes one tiny real Claude call through each AI route (skip: --no-ai).
import { spawn, execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CHROME = process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const SHARED = 'sk-ant-smoke-shared-not-a-real-key';
const FULL = 'sk-ant-smoke-fullsite-not-a-real-key';
const args = process.argv.slice(2);
const VERBOSE = args.includes('--verbose');
const ONLY = (args.find((a) => a.startsWith('--only=')) || '').split('=')[1] || '';
const APP_JS_FROM = (args.find((a) => a.startsWith('--app-js-from=')) || '').split('=')[1] || '';
const LIVE = ((args.find((a) => a.startsWith('--live=')) || '').split('=')[1] || '').replace(/\/+$/, '');
const NO_AI = args.includes('--no-ai');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const tmpDirs = [];
const mkTmp = (prefix) => { const d = fs.mkdtempSync(path.join(os.tmpdir(), prefix)); tmpDirs.push(d); return d; };

// ── local server with fake keys ─────────────────────────────────────────
const freePort = () => new Promise((resolve, reject) => {
    const s = net.createServer();
    s.once('error', reject);
    s.listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => resolve(port)); });
});

async function startServer() {
    const port = await freePort();
    const proc = spawn(process.execPath,
        ['--require', path.join(ROOT, 'tests', 'helpers', 'fake-anthropic.cjs'), path.join(ROOT, 'server.js')],
        { cwd: mkTmp('teachai-smoke-server-'), stdio: ['ignore', 'pipe', 'pipe'],
          env: { PATH: process.env.PATH, PORT: String(port), ANTHROPIC_API_KEY: SHARED, ANTHROPIC_API_KEY_FULLSITE: FULL } });
    let out = '';
    proc.stdout.on('data', (d) => { out += d; });
    proc.stderr.on('data', (d) => { out += d; });
    for (let i = 0; i < 200 && !/running on/.test(out); i++) {
        if (proc.exitCode !== null) break;
        await sleep(50);
    }
    if (!/running on/.test(out)) throw new Error('server did not start: ' + out);
    return { proc, base: 'http://127.0.0.1:' + port, aiCalls: () => (out.match(/\[fake-anthropic\] call key=\w+/g) || []) };
}

// ── headless Chrome over the DevTools protocol ──────────────────────────
async function startChrome() {
    if (!fs.existsSync(CHROME)) throw new Error('Chrome not found at ' + CHROME + ' (set CHROME_PATH)');
    const profile = mkTmp('teachai-smoke-chrome-');
    const proc = spawn(CHROME, ['--headless=new', '--remote-debugging-port=0', '--user-data-dir=' + profile,
        '--no-first-run', '--no-default-browser-check', '--disable-extensions', '--disable-sync',
        '--disable-background-networking', '--disable-component-update', 'about:blank'], { stdio: 'ignore' });
    const portFile = path.join(profile, 'DevToolsActivePort');
    for (let i = 0; i < 300 && !fs.existsSync(portFile); i++) await sleep(50);
    if (!fs.existsSync(portFile)) { proc.kill(); throw new Error('Chrome did not start'); }
    await sleep(100);
    const [port, wsPath] = fs.readFileSync(portFile, 'utf8').trim().split('\n');
    const cdp = await connect('ws://127.0.0.1:' + port + wsPath);
    return { proc, cdp };
}

function connect(url) {
    return new Promise((resolve, reject) => {
        const ws = new WebSocket(url);
        let id = 0;
        const pending = new Map();
        const listeners = new Map();   // sessionId -> fn(msg)
        ws.addEventListener('message', (ev) => {
            const msg = JSON.parse(ev.data);
            if (msg.id && pending.has(msg.id)) {
                const p = pending.get(msg.id); pending.delete(msg.id);
                if (msg.error) p.reject(new Error(msg.error.message)); else p.resolve(msg.result);
            } else if (msg.method && msg.sessionId && listeners.has(msg.sessionId)) {
                listeners.get(msg.sessionId)(msg);
            }
        });
        ws.addEventListener('error', () => reject(new Error('DevTools connection failed')));
        ws.addEventListener('open', () => resolve({
            send(method, params = {}, sessionId) {
                const msg = { id: ++id, method, params };
                if (sessionId) msg.sessionId = sessionId;
                ws.send(JSON.stringify(msg));
                return new Promise((res, rej) => pending.set(msg.id, { resolve: res, reject: rej }));
            },
            listen(sessionId, fn) { listeners.set(sessionId, fn); },
            close() { ws.close(); },
        }));
    });
}

// ── in-flight file rewrites (sabotage and the control run) ──────────────
const readRepo = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const throwInFirstInit = (rel, label) => {
    const src = readRepo(rel);
    const marker = '\n    init() {\n';
    if (!src.includes(marker)) throw new Error('sabotage marker not found in ' + rel);
    return src.replace(marker, marker + "        throw new Error('SMOKE sabotage: " + label + "');\n");
};
const SABOTAGE = {
    'coworker-init-throws': { '/js/components/ai-coworker.js': () => throwInFirstInit('js/components/ai-coworker.js', 'AICoworker.init') },
    'coworker-file-broken': { '/js/components/ai-coworker.js': () => readRepo('js/components/ai-coworker.js') + '\n}}} // SMOKE sabotage: syntax error\n' },
    'ai-panel-init-throws': { '/js/components/ai-panel.js': () => throwInFirstInit('js/components/ai-panel.js', 'AIPanel.init') },
};
const controlOverrides = () => {
    if (!APP_JS_FROM) return {};
    const src = execFileSync('git', ['-C', ROOT, 'show', APP_JS_FROM + ':js/app.js'], { encoding: 'utf8' });
    return { '/js/app.js': () => src };
};

// ── one scenario = one fresh browser profile (incognito-like context) ───
async function openPage(cdp, base, overrides) {
    const { browserContextId } = await cdp.send('Target.createBrowserContext', { disposeOnDetach: true });
    const { targetId } = await cdp.send('Target.createTarget', { url: 'about:blank', browserContextId });
    const { sessionId } = await cdp.send('Target.attachToTarget', { targetId, flatten: true });
    const S = (m, p) => cdp.send(m, p, sessionId);
    const page = { exceptions: [], errors: [], logs: [], blockedWrites: [], initDone: false, loads: 0 };
    cdp.listen(sessionId, (msg) => {
        const p = msg.params || {};
        if (msg.method === 'Runtime.exceptionThrown') {
            const d = p.exceptionDetails || {};
            page.exceptions.push(((d.exception && d.exception.description) || d.text || 'exception').split('\n')[0]);
        } else if (msg.method === 'Runtime.consoleAPICalled') {
            const text = (p.args || []).map((a) => (a.value !== undefined ? String(a.value) : (a.description || ''))).join(' ');
            if (text.includes('Acting Intern initialized successfully')) page.initDone = true;
            if (p.type === 'error') page.errors.push(text.slice(0, 300)); else page.logs.push(text.slice(0, 200));
        } else if (msg.method === 'Page.loadEventFired') {
            page.loads++;
        } else if (msg.method === 'Fetch.requestPaused') {
            onRequest(S, p, base, overrides, page).catch(() => {});
        }
    });
    await S('Runtime.enable');
    await S('Page.enable');
    await S('Fetch.enable', { patterns: [{ urlPattern: '*', requestStage: 'Request' }] });
    page.S = S;
    page.close = async () => {
        await cdp.send('Target.closeTarget', { targetId }).catch(() => {});
        await cdp.send('Target.disposeBrowserContext', { browserContextId }).catch(() => {});
    };
    page.goto = async (url) => {
        const before = page.loads;
        await S('Page.navigate', { url });
        for (let i = 0; i < 300 && page.loads === before; i++) await sleep(50);
    };
    page.eval = async (expression) => {
        const r = await S('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
        if (r.exceptionDetails) throw new Error((r.exceptionDetails.exception && r.exceptionDetails.exception.description) || r.exceptionDetails.text);
        return r.result.value;
    };
    page.waitFor = async (expression, ms = 25000) => {
        const end = Date.now() + ms;
        while (Date.now() < end) {
            try { if (await page.eval(expression)) return true; } catch (e) { /* page still loading */ }
            await sleep(200);
        }
        return false;
    };
    return page;
}

async function onRequest(S, p, base, overrides, page) {
    const { requestId, request } = p;
    const u = new URL(request.url);
    if (u.origin === base) {
        const make = overrides[u.pathname];
        if (make) {
            return S('Fetch.fulfillRequest', { requestId, responseCode: 200, body: Buffer.from(make()).toString('base64'),
                responseHeaders: [{ name: 'Content-Type', value: 'application/javascript; charset=utf-8' }, { name: 'Cache-Control', value: 'no-store' }] });
        }
        if (LIVE && !['GET', 'HEAD', 'OPTIONS'].includes(request.method)) {
            // Live site: never write to it. An AI call during page load would show up here.
            if (/^\/api\/claude/.test(u.pathname)) page.blockedWrites.push(request.method + ' ' + u.pathname);
            else (page.otherBlocked = page.otherBlocked || []).push(request.method + ' ' + u.pathname);
            return S('Fetch.failRequest', { requestId, errorReason: 'BlockedByClient' });
        }
        return S('Fetch.continueRequest', { requestId });
    }
    if (/(^|\.)(google-analytics|googletagmanager)\.com$/.test(u.hostname)) {
        return S('Fetch.failRequest', { requestId, errorReason: 'BlockedByClient' });   // keep test visits out of analytics
    }
    if (u.hostname === 'acting-intern-relay.kevinkeet.workers.dev') {
        // Smart-glasses relay: the glasses bridge pushes chart display text there in the
        // background. Not study data; blocked so test runs never reach a real pair of glasses.
        page.relayPosts = (page.relayPosts || 0) + 1;
        return S('Fetch.failRequest', { requestId, errorReason: 'BlockedByClient' });
    }
    if (['GET', 'HEAD', 'OPTIONS'].includes(request.method)) return S('Fetch.continueRequest', { requestId });
    page.blockedWrites.push(request.method + ' ' + u.origin + u.pathname);
    return S('Fetch.failRequest', { requestId, errorReason: 'BlockedByClient' });
}

// What a page reports about itself once loaded.
const PROBE = `(async () => {
    const o = {};
    try { if (typeof AICoworker !== 'undefined' && AICoworker._backendReady) await AICoworker._backendReady; } catch (e) { o.backendError = String(e); }
    o.studyLocked = (typeof ModeManager !== 'undefined') ? ModeManager.isStudyLocked() : null;
    o.clientEndpoint = (typeof ClaudeAPI !== 'undefined') ? ClaudeAPI._getEndpoint() : null;
    o.coworkerLoaded = (typeof AICoworker !== 'undefined');
    o.coworkerEndpoint = o.coworkerLoaded ? AICoworker.apiEndpoint : null;
    o.codeBox = !!document.getElementById('assessment-access-code');
    o.startPage = !!document.querySelector('.assessment-start-page');
    o.hash = location.hash;
    const main = document.getElementById('main-content');
    o.mainText = main ? main.innerText.replace(/\\s+/g, ' ').trim().slice(0, 160) : '';
    return o;
})()`;
const askClaude = (forceDirectRace) => `(async () => {
    ${forceDirectRace ? 'ClaudeAPI.useProxy = false;' : ''}
    const r = await ClaudeAPI.sendMessage('', [{ role: 'user', content: 'smoke test' }], { model: 'claude-sonnet-5', maxTokens: 5 });
    return ClaudeAPI.textFrom(r.content);
})()`;
const askCoworkerRoute = `(async () => {
    const r = await fetch(AICoworker.apiEndpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: 'claude-sonnet-5', max_tokens: 5, messages: [{ role: 'user', content: 'smoke test' }] }) });
    const d = await r.json();
    return d.content ? d.content[0].text : ('HTTP ' + r.status);
})()`;

// ── the scenarios ────────────────────────────────────────────────────────
const results = [];
function record(name, problems, page, extra) {
    const ok = problems.length === 0;
    results.push({ name, ok });
    console.log((ok ? 'PASS  ' : 'FAIL  ') + name + (ok ? '' : ' -> ' + problems.join('; ')));
    if (VERBOSE || !ok) {
        if (extra) console.log('      ' + JSON.stringify(extra));
        if (page && page.exceptions.length) console.log('      uncaught: ' + page.exceptions.slice(0, 5).join(' | '));
        if (page && page.errors.length) console.log('      console errors: ' + page.errors.slice(0, 5).join(' | '));
    }
}

async function loadDoor(cdp, server, url, overrides) {
    const page = await openPage(cdp, server.base, overrides);
    if (!LIVE) {
        // Local test server only: skip the site password the way a returning browser
        // does (no password is typed or stored). On the live site the password box
        // stays up and the page is checked as it renders behind it.
        await page.goto(server.base + '/favicon.svg');
        await page.eval("localStorage.setItem('access-granted', 'gate'); true");
    }
    const callsBefore = server.aiCalls().length;
    await page.goto(server.base + url);
    return { page, callsBefore };
}

async function studyDoor(cdp, server, name, overrides, expectCleanConsole) {
    const { page, callsBefore } = await loadDoor(cdp, server, '/?studymode#/assessment/start', overrides);
    const ready = await page.waitFor("!!document.getElementById('assessment-access-code')");
    await sleep(1500);   // let late errors and background work surface
    const probe = await page.eval(PROBE).catch((e) => ({ probeError: e.message }));
    const problems = [];
    if (!ready || !probe.codeBox) problems.push('participant-code page did not render (main: "' + (probe.mainText || '') + '")');
    if (!page.initDone) problems.push('App.init did not finish');
    if (probe.studyLocked !== true) problems.push('browser is not in the study door');
    if (expectCleanConsole && page.exceptions.length) problems.push(page.exceptions.length + ' uncaught error(s)');
    if (server.aiCalls().length !== callsBefore) problems.push('page load made AI calls');
    if (page.blockedWrites.length) problems.push('tried to write outside: ' + page.blockedWrites.join(', '));
    return { page, probe, problems };
}

// Live mode only: the server answering is this checkout, and both AI routes work.
async function liveServerChecks(base) {
    const problems = [];
    const health = await fetch(base + '/api/health').then((r) => r.json()).catch((e) => ({ error: e.message }));
    if (health.apiConfigured !== true) problems.push('/api/health: apiConfigured is not true');
    if (health.fullSiteRoute !== true) problems.push('/api/health: no full-site route (old server still running?)');
    const ver = (s) => (String(s).match(/__CACHE_V = '([^']+)'/) || [])[1];
    const localVer = ver(readRepo('index.html'));
    const liveVer = ver(await fetch(base + '/index.html').then((r) => r.text()).catch(() => ''));
    if (liveVer !== localVer) problems.push('live cache version ' + liveVer + ', this checkout ' + localVer);
    const sha = (s) => createHash('sha256').update(s).digest('hex');
    for (const f of ['server.js', 'js/app.js', 'js/services/claude-api.js', 'js/components/ai-coworker.js',
                     'js/router.js', 'js/services/assessment-engine.js', 'js/components/assessment-chatbot.js']) {
        const live = await fetch(base + '/' + f + '?v=' + localVer).then((r) => (r.ok ? r.text() : null)).catch(() => null);
        if (live === null) problems.push(f + ' not reachable');
        else if (sha(live) !== sha(readRepo(f))) problems.push(f + ' differs from this checkout');
    }
    record('live site runs this checkout (health, cache version, files)', problems, null,
        { health, liveVer, localVer });
    if (NO_AI) return;
    const ask = async (route) => {
        const r = await fetch(base + route, { method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ model: 'claude-sonnet-5', max_tokens: 16, messages: [{ role: 'user', content: 'Reply with the word OK.' }] }) })
            .catch((e) => ({ status: 0, json: async () => ({ error: { message: e.message } }) }));
        const d = await r.json().catch(() => ({}));
        return { status: r.status, type: d.type || null, error: (d.error && d.error.message) || null };
    };
    const study = await ask('/api/claude');
    const full = await ask('/api/claude-full');
    const p2 = [];
    if (study.status !== 200 || study.type !== 'message') p2.push('/api/claude answered ' + JSON.stringify(study));
    if (full.status !== 200 || full.type !== 'message') p2.push('/api/claude-full answered ' + JSON.stringify(full));
    record('live AI routes answer (one tiny real call each)', p2, null,
        { study, full, fullSiteKeyConfigured: health.fullSiteKeyConfigured });
}

async function main() {
    const server = LIVE ? { proc: null, base: LIVE, aiCalls: () => [] } : await startServer();
    const { proc: chrome, cdp } = await startChrome();
    const control = controlOverrides();
    try {
        if (LIVE) await liveServerChecks(server.base);
        if (!ONLY || ONLY === 'doors') {
            // 1. Study door, healthy.
            let r = await studyDoor(cdp, server, 'study', control, true);
            if (r.probe.clientEndpoint !== '/api/claude') r.problems.push('client endpoint ' + r.probe.clientEndpoint);
            if (r.probe.coworkerEndpoint !== '/api/claude') r.problems.push('coworker endpoint ' + r.probe.coworkerEndpoint);
            if (!LIVE) {
                const studyAnswer = await r.page.eval(askClaude(false)).catch((e) => 'error: ' + e.message);
                if (studyAnswer !== 'fake reply key=shared') r.problems.push('study AI call answered "' + studyAnswer + '"');
            }
            record('study door: participant-code page renders, no errors, AI calls use the shared key' + (LIVE ? ' route' : ''),
                r.problems, r.page, { ...r.probe, blockedOther: r.page.otherBlocked || [] });

            // 1b. Same page: load a study case chart (Case 1 patient) the way a case does, read-only.
            const before = r.page.exceptions.length;
            const loaded = await r.page.eval("App.loadPatient('PAT005').then(() => document.body.classList.contains('patient-pat005'))")
                .catch((e) => 'error: ' + e.message);
            await sleep(1500);
            const p2 = [];
            if (loaded !== true) p2.push('loadPatient returned ' + loaded);
            if (r.page.exceptions.length !== before) p2.push('uncaught: ' + r.page.exceptions.slice(before).join(' | '));
            if (r.page.blockedWrites.length) p2.push('tried to write outside: ' + r.page.blockedWrites.join(', '));
            record('study door: a study case chart loads with the AI Coworker attached', p2, r.page);
            await r.page.close();

            // 2. Demo door.
            const d = await loadDoor(cdp, server, '/?demo#/assessment/start', control);
            // With no code the demo door opens on the same participant-code page as the study.
            const demoReady = await d.page.waitFor("!!document.getElementById('assessment-access-code') || !!document.querySelector('.assessment-start-page')");
            await sleep(1500);
            const dp = await d.page.eval(PROBE).catch((e) => ({ probeError: e.message }));
            const dProblems = [];
            if (!demoReady) dProblems.push('start page did not render');
            if (dp.studyLocked !== true) dProblems.push('demo browser is not study-locked');
            if (!d.page.initDone) dProblems.push('App.init did not finish');
            if (d.page.exceptions.length) dProblems.push(d.page.exceptions.length + ' uncaught error(s)');
            if (dp.clientEndpoint !== '/api/claude' || dp.coworkerEndpoint !== '/api/claude') dProblems.push('endpoints ' + dp.clientEndpoint + ' / ' + dp.coworkerEndpoint);
            if (!LIVE) {
                const demoAnswer = await d.page.eval(askClaude(false)).catch((e) => 'error: ' + e.message);
                if (demoAnswer !== 'fake reply key=shared') dProblems.push('demo AI call answered "' + demoAnswer + '"');
            }
            if (d.page.blockedWrites.length) dProblems.push('tried to write outside: ' + d.page.blockedWrites.join(', '));
            record('demo door: start page renders, AI calls use the shared key' + (LIVE ? ' route' : ''), dProblems, d.page, dp);
            await d.page.close();

            // 3. Full-site door.
            const f = await loadDoor(cdp, server, '/?allmodes#/chart-review', control);
            const fullReady = await f.page.waitFor("typeof AICoworker !== 'undefined' && !!AICoworker._backendReady && document.getElementById('main-content') && document.getElementById('main-content').innerText.length > 50");
            await sleep(2000);
            const fp = await f.page.eval(PROBE).catch((e) => ({ probeError: e.message }));
            const fProblems = [];
            if (!fullReady) fProblems.push('chart did not render');
            if (!f.page.initDone) fProblems.push('App.init did not finish');
            if (fp.studyLocked !== false) fProblems.push('browser is not in the full-site door');
            if (fp.clientEndpoint !== '/api/claude-full') fProblems.push('client endpoint ' + fp.clientEndpoint);
            if (fp.coworkerEndpoint !== '/api/claude-full') fProblems.push('coworker endpoint ' + fp.coworkerEndpoint);
            if (!LIVE) {
                const a1 = await f.page.eval(askClaude(false)).catch((e) => 'error: ' + e.message);
                const a2 = await f.page.eval(askCoworkerRoute).catch((e) => 'error: ' + e.message);
                const a3 = await f.page.eval(askClaude(true)).catch((e) => 'error: ' + e.message);   // after the access-gate race
                if (a1 !== 'fake reply key=fullsite') fProblems.push('ClaudeAPI call answered "' + a1 + '"');
                if (a2 !== 'fake reply key=fullsite') fProblems.push('coworker route answered "' + a2 + '"');
                if (a3 !== 'fake reply key=fullsite') fProblems.push('after the gate race, answered "' + a3 + '"');
            }
            if (f.page.blockedWrites.length) fProblems.push('tried to write outside: ' + f.page.blockedWrites.join(', '));
            record('full-site door: chart and AI Coworker load, AI calls use the full-site key' + (LIVE ? ' route' : ''), fProblems, f.page,
                { ...fp, uncaught: f.page.exceptions.length });
            await f.page.close();
        }

        if (!LIVE && (!ONLY || ONLY === 'sabotage')) {
            for (const [label, files] of Object.entries(SABOTAGE)) {
                const r = await studyDoor(cdp, server, label, { ...control, ...files }, false);
                record('study door still loads when broken: ' + label, r.problems, r.page,
                    { coworkerLoaded: r.probe.coworkerLoaded, uncaught: r.page.exceptions.slice(0, 3) });
                await r.page.close();
            }
        }
    } finally {
        cdp.close();
        chrome.kill();
        if (server.proc) server.proc.kill();
        await sleep(300);
        for (const d of tmpDirs) fs.rmSync(d, { recursive: true, force: true });
    }
    const failed = results.filter((r) => !r.ok).length;
    console.log(failed ? `\nSMOKE TEST FAILED: ${failed} of ${results.length} checks` : `\nSmoke test passed: ${results.length} checks`);
    process.exit(failed ? 1 : 0);
}

main().catch((e) => {
    console.log('SMOKE TEST ERROR: ' + e.message);
    for (const d of tmpDirs) { try { fs.rmSync(d, { recursive: true, force: true }); } catch (x) { /* ignore */ } }
    process.exit(2);
});
