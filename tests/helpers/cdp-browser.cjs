// Headless Chrome over the DevTools protocol for tests (patterned on
// scripts/smoke-study.mjs). Each page gets a fresh browser context, every
// request is logged, and any write to an outside host is blocked and recorded.
// Also starts this checkout's server.js with fake keys and the fake Anthropic,
// so nothing can reach a real AI service or spend credit.
'use strict';
const { spawn } = require('child_process');
const fs = require('fs'), os = require('os'), path = require('path'), net = require('net');

const ROOT = path.join(__dirname, '..', '..');
const CHROME = process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const tmpDirs = [];
const mkTmp = (prefix) => { const d = fs.mkdtempSync(path.join(os.tmpdir(), prefix)); tmpDirs.push(d); return d; };

const freePort = () => new Promise((resolve, reject) => {
    const s = net.createServer();
    s.once('error', reject);
    s.listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => resolve(port)); });
});

async function startServer() {
    const port = await freePort();
    const cwd = mkTmp('live-test-server-');
    const proc = spawn(process.execPath, ['--require', path.join(__dirname, 'fake-anthropic.cjs'), path.join(ROOT, 'server.js')], {
        cwd, env: { PATH: process.env.PATH, PORT: String(port), ANTHROPIC_API_KEY: 'sk-ant-test-shared-not-a-real-key', ANTHROPIC_API_KEY_FULLSITE: 'sk-ant-test-fullsite-not-a-real-key' },
        stdio: ['ignore', 'pipe', 'pipe'],
    });
    let out = '';
    proc.stdout.on('data', (d) => { out += d; });
    proc.stderr.on('data', (d) => { out += d; });
    const deadline = Date.now() + 10000;
    while (!/running on/.test(out)) {
        if (Date.now() > deadline || proc.exitCode !== null) throw new Error('server did not start: ' + out);
        await sleep(50);
    }
    return { base: 'http://127.0.0.1:' + port, output: () => out, stop: () => proc.kill() };
}

function connect(url) {
    return new Promise((resolve, reject) => {
        const ws = new WebSocket(url);
        let id = 0;
        const pending = new Map();
        const listeners = new Map();
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
        // If Chrome goes away, fail every call still waiting instead of hanging silently.
        ws.addEventListener('close', () => {
            for (const p of pending.values()) p.reject(new Error('DevTools connection closed (Chrome exited?)'));
            pending.clear();
        });
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

async function startChrome(extraArgs) {
    if (!fs.existsSync(CHROME)) throw new Error('Chrome not found at ' + CHROME + ' (set CHROME_PATH)');
    const profile = mkTmp('live-test-chrome-');
    const proc = spawn(CHROME, ['--headless=new', '--remote-debugging-port=0', '--user-data-dir=' + profile, '--no-first-run', '--no-default-browser-check',
        '--disable-extensions', '--disable-sync', '--disable-background-networking', '--disable-component-update', '--window-size=1440,900'].concat(extraArgs || [], ['about:blank']), { stdio: 'ignore' });
    const portFile = path.join(profile, 'DevToolsActivePort');
    for (let i = 0; i < 300 && !fs.existsSync(portFile); i++) await sleep(50);
    if (!fs.existsSync(portFile)) { proc.kill(); throw new Error('Chrome did not start'); }
    await sleep(100);
    const [port, wsPath] = fs.readFileSync(portFile, 'utf8').trim().split('\n');
    const cdp = await connect('ws://127.0.0.1:' + port + wsPath);
    return { cdp, stop: () => { try { cdp.close(); } catch (e) { /* ignore */ } proc.kill(); } };
}

async function openPage(cdp, base) {
    const { browserContextId } = await cdp.send('Target.createBrowserContext', { disposeOnDetach: true });
    const { targetId } = await cdp.send('Target.createTarget', { url: 'about:blank', browserContextId });
    const { sessionId } = await cdp.send('Target.attachToTarget', { targetId, flatten: true });
    const S = (m, p) => cdp.send(m, p, sessionId);
    const page = { requests: [], exceptions: [], errors: [], blockedWrites: [], loads: 0 };
    cdp.listen(sessionId, (msg) => {
        const p = msg.params || {};
        if (msg.method === 'Runtime.exceptionThrown') {
            const d = p.exceptionDetails || {};
            page.exceptions.push(((d.exception && d.exception.description) || d.text || 'exception').split('\n')[0]);
        } else if (msg.method === 'Runtime.consoleAPICalled' && p.type === 'error') {
            page.errors.push((p.args || []).map((a) => (a.value !== undefined ? String(a.value) : (a.description || ''))).join(' ').slice(0, 300));
        } else if (msg.method === 'Page.loadEventFired') {
            page.loads++;
        } else if (msg.method === 'Fetch.requestPaused') {
            const { requestId, request } = p;
            const u = new URL(request.url);
            page.requests.push(request.method + ' ' + (u.origin === base ? u.pathname : u.origin + u.pathname));
            if (u.origin === base || ['GET', 'HEAD', 'OPTIONS'].includes(request.method)) {
                if (/(^|\.)(google-analytics|googletagmanager)\.com$/.test(u.hostname) || u.hostname.endsWith('workers.dev')) S('Fetch.failRequest', { requestId, errorReason: 'BlockedByClient' }).catch(() => {});
                else S('Fetch.continueRequest', { requestId }).catch(() => {});
            } else {
                page.blockedWrites.push(request.method + ' ' + u.origin + u.pathname);
                S('Fetch.failRequest', { requestId, errorReason: 'BlockedByClient' }).catch(() => {});
            }
        }
    });
    await S('Runtime.enable');
    await S('Page.enable');
    await S('Fetch.enable', { patterns: [{ urlPattern: '*', requestStage: 'Request' }] });
    page.S = S;
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
            try { if (await page.eval(expression)) return true; } catch (e) { /* still loading */ }
            await sleep(200);
        }
        return false;
    };
    page.screenshot = async (file, clip) => {
        const r = await S('Page.captureScreenshot', Object.assign({ format: 'png' }, clip ? { clip: Object.assign({ scale: 1 }, clip) } : {}));
        fs.writeFileSync(file, Buffer.from(r.data, 'base64'));
    };
    page.close = async () => {
        await cdp.send('Target.closeTarget', { targetId }).catch(() => {});
        await cdp.send('Target.disposeBrowserContext', { browserContextId }).catch(() => {});
    };
    return page;
}

/** Skip the site password the way a returning browser does (no password typed or stored). */
async function preseedAccess(page, base) {
    await page.goto(base + '/favicon.svg');
    await page.eval("localStorage.setItem('access-granted', 'gate'); true");
}

function cleanup() { for (const d of tmpDirs) { try { fs.rmSync(d, { recursive: true, force: true }); } catch (e) { /* ignore */ } } }

module.exports = { startServer, startChrome, openPage, preseedAccess, cleanup, sleep, ROOT };
