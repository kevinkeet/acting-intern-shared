#!/usr/bin/env node
// Runs the existing Deep Learn to completion for a patient on the lab and
// freezes the result as data/live/<PATIENT>-deep-memory.json.
//
// Drives a private headless Chrome (throwaway profile) at the lab's full-site
// door. The site password box is skipped by pre-seeding localStorage
// 'access-granted' (no password typed); the lab's own keys pay for the calls.
// For this page only, the two old call functions are swapped for versions that
// stream (long syntheses would otherwise time out at the proxy), retry on
// overload, and allow more output room; nothing in the repo's old code changes.
//
//   node tools/live/deeplearn.mjs                      PAT001 on the lab
//   node tools/live/deeplearn.mjs --extract=claude-haiku-5-5 --synth=claude-sonnet-5-5
//   node tools/live/deeplearn.mjs --site=http://127.0.0.1:8787   (via tools/live/dev-proxy.mjs)
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const { startChrome, openPage, sleep, cleanup } = require(path.join(ROOT, 'tests/helpers/cdp-browser.cjs'));

const argv = Object.fromEntries(process.argv.slice(2).map((a) => { const m = a.match(/^--([^=]+)(?:=(.*))?$/); return m ? [m[1], m[2] === undefined ? true : m[2]] : [a, true]; }));
const SITE = (argv.site || 'https://acting-intern-lab.onrender.com').replace(/\/+$/, '');
const PATIENT = argv.patient || 'PAT001';
const EXTRACT = argv.extract || 'claude-haiku-5-5';
const SYNTH = argv.synth || 'claude-sonnet-5-5';
const OUT = path.join(ROOT, 'data/live', PATIENT + '-deep-memory.json');
const t0 = Date.now();
const stamp = () => '[' + Math.round((Date.now() - t0) / 1000) + 's]';

// Installed in the page: streaming + retry replacements for the old call paths.
const PATCH = `(() => {
    const T = LiveTransport.createTransport({ endpoint: () => ClaudeAPI._getEndpoint(), headers: () => ClaudeAPI._getHeaders() });
    window.__dl = { calls: [], errors: [], cost: 0 };
    const call = async (model, system, user, maxTokens, schema) => {
        const body = { max_tokens: Math.max(maxTokens || 1024, (maxTokens || 0) >= 12000 ? 40000 : 8000), system, messages: [{ role: 'user', content: user }] };
        if (schema) body.output_config = { format: { type: 'json_schema', schema }, effort: 'medium' };
        for (let attempt = 0; ; attempt++) {
            try {
                const r = await T.call({ model, body });
                const stop = r.message.stop_reason;
                window.__dl.calls.push({ model, ms: Math.round(r.ms.total), in: (r.usage.input_tokens || 0) + (r.usage.cache_read_input_tokens || 0), out: r.usage.output_tokens || 0, cost: r.cost, stop });
                window.__dl.cost += r.cost;
                if (stop === 'refusal') throw Object.assign(new Error('declined (' + ((r.message.stop_details || {}).category || '?') + ')'), { retryable: false });
                if (!r.text) throw Object.assign(new Error('empty reply'), { retryable: true });
                return r.text;
            } catch (e) {
                window.__dl.errors.push(model + ': ' + (e && e.message));
                if (attempt >= 4 || (e && e.retryable === false)) throw e;
                await new Promise((res) => setTimeout(res, 4000 * (attempt + 1)));
            }
        }
    };
    AICoworker.callLLM = function (systemPrompt, userMessage, maxTokens, options) {
        return call((options && options.model) || this.model, systemPrompt, userMessage, maxTokens, options && options.outputSchema);
    };
    ClaudeAPI._singleChat = function (req) {
        return call(req.model || this.model, req.systemPrompt, req.userMessage, req.maxTokens, req.outputSchema);
    };
    AICoworker.refreshThinking = () => {};   // the auto-refresh races the level runner
    return true;
})()`;

const RUN = (extract, synth) => `(async () => {
    const A = AICoworker;
    const D = () => A._deepLearn;
    A._suppressMemoryViewer = true;
    A.analysisModel = ${JSON.stringify(extract)};
    A.dictationModel = ${JSON.stringify(synth)};
    A._resetDeepLearn();
    window.__dlProgress = { level: 1, phase: 'level 1' };
    await A.learnPatient();
    for (let lvl = 2; lvl <= D().totalLevels; lvl++) {
        window.__dlProgress = { level: lvl, phase: 'level ' + lvl };
        for (let t = 0; t < 4; t++) {
            const b = D().levelBatches[lvl - 1] || [], f0 = D().extractedFacts.length;
            try { await (t ? A.redoCurrentLevel() : A._runNextLevel()); } catch (e) { window.__dl.errors.push('level ' + lvl + ': ' + e.message); }
            const done = b.every((i) => D().processed.has(i.id));
            const gained = D().extractedFacts.length - f0;
            if (done && gained >= b.length - 4) break;
            window.__dl.errors.push('level ' + lvl + ' incomplete (attempt ' + (t + 1) + ', +' + gained + ' facts of ' + b.length + '); redoing');
            await new Promise((r) => setTimeout(r, 15000));
        }
    }
    window.__dlProgress = { level: D().totalLevels, phase: 'done' };
    return { phase: D().phase, processed: D().processed.size, total: D().totalItems };
})()`;

const PROGRESS = `(() => {
    const D = AICoworker._deepLearn || {};
    return { p: window.__dlProgress, processed: D.processed ? D.processed.size : 0, total: D.totalItems, facts: (D.extractedFacts || []).length,
             calls: window.__dl ? window.__dl.calls.length : 0, cost: window.__dl ? +window.__dl.cost.toFixed(3) : 0,
             errors: window.__dl ? window.__dl.errors.slice(-3) : [] };
})()`;

const EXPORT = `(() => {
    const A = AICoworker, D = A._deepLearn;
    const md = A.longitudinalDoc && A.longitudinalDoc.aiMemory && A.longitudinalDoc.aiMemory.memoryDocument;
    return JSON.stringify({
        generated: new Date().toISOString(),
        note: 'Full Deep Learn run (all levels) frozen as the Live Coworker deep-memory fixture.',
        models: { extraction: A.analysisModel, synthesis: A.dictationModel },
        deepLearn: { phase: D.phase, processedCount: D.processed.size, totalItems: D.totalItems, totalLevels: D.totalLevels, processedIds: [...D.processed] },
        memoryDocument: md,
        extractedFacts: D.extractedFacts,
        runStats: { calls: window.__dl.calls.length, cost: window.__dl.cost, errors: window.__dl.errors },
        longitudinalDoc: A.longitudinalDoc.serialize(),
    });
})()`;

async function main() {
    const health = await fetch(SITE + '/api/health').then((r) => r.json());
    if (!health.apiConfigured) throw new Error(SITE + ' has no API key configured yet: ' + JSON.stringify(health));
    console.log(stamp(), 'Lab health OK. Deep Learn for ' + PATIENT + ': extraction ' + EXTRACT + ', synthesis ' + SYNTH);
    const chrome = await startChrome();
    const page = await openPage(chrome.cdp, SITE);
    try {
        await page.goto(SITE + '/favicon.svg');
        await page.eval("localStorage.setItem('access-granted','gate'); localStorage.setItem('app-mode','assistant'); localStorage.setItem('ai-panel-collapsed','true'); true");
        await page.goto(SITE + '/?allmodes#/chart-review');
        const ready = await page.waitFor("typeof AICoworker !== 'undefined' && !!AICoworker.contextAssembler && typeof LiveTransport !== 'undefined' && (typeof dataLoader !== 'undefined' && dataLoader.currentPatientId === " + JSON.stringify(PATIENT) + ')', 90000);
        if (!ready) throw new Error('page did not get ready (patient ' + PATIENT + ' loaded with the live files?)');
        await page.eval('AICoworker._backendReady');
        const ep = await page.eval('AICoworker.apiEndpoint');
        if (ep !== '/api/claude-full') throw new Error('expected the full-site route, got ' + ep);
        await page.eval(PATCH);
        console.log(stamp(), 'Patched; starting.');
        const run = page.eval(RUN(EXTRACT, SYNTH)).then((r) => ({ ok: r }), (e) => ({ err: e }));
        let done = null;
        let last = '';
        while (!done) {
            done = await Promise.race([run, sleep(20000).then(() => null)]);
            const pr = await page.eval(PROGRESS).catch((e) => ({ error: e.message }));
            const line = JSON.stringify(pr);
            if (line !== last) { console.log(stamp(), line); last = line; }
        }
        if (done.err) throw done.err;
        console.log(stamp(), 'Finished:', JSON.stringify(done.ok));
        const json = await page.eval(EXPORT);
        fs.writeFileSync(OUT, JSON.stringify(JSON.parse(json), null, 1));
        const fx = JSON.parse(json);
        console.log(stamp(), 'Saved ' + OUT + ' (' + Math.round(json.length / 1024) + ' KB): ' + fx.deepLearn.processedCount + '/' + fx.deepLearn.totalItems + ' items, ' + (fx.extractedFacts || []).length + ' extracted documents, $' + fx.runStats.cost.toFixed(2) + ', ' + fx.runStats.errors.length + ' retries/errors');
    } finally {
        await page.close().catch(() => {});
        chrome.stop();
        cleanup();
    }
}

main().catch((e) => { console.error(stamp(), 'Deep Learn run failed:', e && (e.stack || e.message || e)); process.exit(1); });
