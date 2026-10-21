// The Live Coworker loads ONLY in the full-site door (study guardrails).
//  - Study door (?studymode) and demo door (?demo): no request for js/live/*
//    or css/live-coworker.css, no LiveApp, no live panel.
//  - Full-site door (?allmodes): the files load, the panel mounts with no
//    uncaught errors, and with the scripted stand-in model (?livefake, no AI
//    cost) the Morrison demo at high speed produces a take and a safety alert.
// Runs this checkout's server.js with fake keys and a fake Anthropic, and a
// private headless Chrome. Run: node tests/live-doors.test.js  (about 40 s)
const assert = require('assert');
const { startServer, startChrome, openPage, preseedAccess, cleanup, sleep } = require('./helpers/cdp-browser.cjs');

const LIVE_FILE = /\/js\/live\/|\/css\/live-coworker\.css/;
let fail = 0;
const check = async (name, fn) => {
    try { await fn(); console.log('PASS  ' + name); } catch (e) { fail++; console.log('FAIL  ' + name + ' -> ' + (e && e.message)); }
};

(async () => {
    const server = await startServer();
    const chrome = await startChrome();
    try {
        await check('study door never downloads the live coworker', async () => {
            const page = await openPage(chrome.cdp, server.base);
            await preseedAccess(page, server.base);
            await page.goto(server.base + '/?studymode#/assessment/start');
            assert.ok(await page.waitFor("!!document.getElementById('assessment-access-code')"), 'participant-code page did not render');
            await sleep(2500);
            const live = page.requests.filter((r) => LIVE_FILE.test(r));
            assert.deepStrictEqual(live, [], 'requested: ' + live.join(', '));
            assert.strictEqual(await page.eval("typeof LiveApp + '|' + !!document.getElementById('live-coworker')"), 'undefined|false');
            assert.deepStrictEqual(page.exceptions, []);
            await page.close();
        });

        await check('demo door never downloads the live coworker', async () => {
            const page = await openPage(chrome.cdp, server.base);
            await preseedAccess(page, server.base);
            await page.goto(server.base + '/?demo');
            assert.ok(await page.waitFor("typeof App !== 'undefined' && !!document.querySelector('#main-content') && document.querySelector('#main-content').innerText.length > 20"), 'demo page did not render');
            await sleep(2500);
            const live = page.requests.filter((r) => LIVE_FILE.test(r));
            assert.deepStrictEqual(live, [], 'requested: ' + live.join(', '));
            assert.strictEqual(await page.eval('typeof LiveApp'), 'undefined');
            await page.close();
        });

        await check('full-site door: live panel mounts, reads the chart, and catches a planted alert (stand-in model)', async () => {
            const page = await openPage(chrome.cdp, server.base);
            await preseedAccess(page, server.base);
            await page.eval("localStorage.setItem('ai-panel-collapsed','false'); localStorage.setItem('app-mode','assistant'); true");
            await page.goto(server.base + '/?allmodes&livefake#/chart-review');
            assert.ok(await page.waitFor("typeof LiveApp !== 'undefined' && LiveApp.enabled && !!document.getElementById('live-coworker')", 30000), 'live panel did not mount');
            const live = page.requests.filter((r) => LIVE_FILE.test(r));
            assert.ok(live.length >= 8, 'expected the live files, got ' + live.join(', '));
            assert.ok(await page.waitFor('!!LiveApp.engine && !!LiveApp.chart', 20000), 'session not prepared');
            await page.eval("LiveApp.setSetting('replaySpeed', 16); LiveApp.replay('play'); true");
            assert.ok(await page.waitFor("!!document.querySelector('#live-coworker .lc-one')", 20000), 'no take rendered');
            assert.ok(await page.waitFor("LiveApp.view.said.some((s) => s.kind === 'critical')", 40000), 'no safety alert');
            const alertText = await page.eval("document.querySelector('#live-coworker .lc-alert-text') && document.querySelector('#live-coworker .lc-alert-text').textContent");
            assert.match(alertText || '', /stool|bleed/i);
            assert.deepStrictEqual(page.exceptions, [], 'uncaught: ' + page.exceptions.join(' | '));
            assert.deepStrictEqual(page.blockedWrites, [], 'outside writes: ' + page.blockedWrites.join(', '));
            await page.close();
        });
    } finally {
        chrome.stop();
        server.stop();
        await sleep(200);
        cleanup();
    }
    process.exit(fail ? 1 : 0);
})().catch((e) => { console.log('FAIL  crashed -> ' + (e && e.stack || e)); process.exit(1); });
