// server.js: /api/claude keeps the shared key (study), /api/claude-full uses the
// full-site key and falls back to the shared key until one is set (guardrails, 21 Oct 2026).
// Starts the real server with fake keys and a fake Anthropic (tests/helpers/fake-anthropic.cjs),
// so nothing leaves this machine. Run: node tests/server-routes.test.js
const { spawn } = require('child_process');
const fs = require('fs'), os = require('os'), path = require('path'), net = require('net'), assert = require('assert');
const ROOT = path.join(__dirname, '..');
const SHARED = 'sk-ant-test-shared-not-a-real-key';
const FULL = 'sk-ant-test-fullsite-not-a-real-key';

const freePort = () => new Promise((resolve, reject) => {
    const s = net.createServer();
    s.once('error', reject);
    s.listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => resolve(port)); });
});

// cwd is an empty temp folder, so dotenv can never pick up a real .env file.
async function startServer(env) {
    const port = await freePort();
    const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'teachai-server-test-'));
    const childEnv = { PATH: process.env.PATH, PORT: String(port), ...env };
    const proc = spawn(process.execPath, ['--require', path.join(__dirname, 'helpers', 'fake-anthropic.cjs'), path.join(ROOT, 'server.js')],
        { cwd, env: childEnv, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    proc.stdout.on('data', (d) => { out += d; });
    proc.stderr.on('data', (d) => { out += d; });
    const deadline = Date.now() + 10000;
    while (!/running on/.test(out)) {
        if (Date.now() > deadline || proc.exitCode !== null) throw new Error('server did not start: ' + out);
        await new Promise((r) => setTimeout(r, 50));
    }
    const base = 'http://127.0.0.1:' + port;
    return {
        base, output: () => out,
        stop: () => new Promise((r) => { proc.once('exit', () => { fs.rmSync(cwd, { recursive: true, force: true }); r(); }); proc.kill(); }),
    };
}

const ask = async (base, route) => {
    const res = await fetch(base + route, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: 'claude-sonnet-5', max_tokens: 5, messages: [{ role: 'user', content: 'ping' }] }),
    });
    const data = await res.json();
    return { status: res.status, text: data.content ? data.content[0].text : (data.error && data.error.message), model: data.model };
};

// A raw POST with extra headers and any body (streaming checks).
const post = (base, route, body, extraHeaders = {}, signal) => fetch(base + route, {
    method: 'POST', headers: { 'Content-Type': 'application/json', ...extraHeaders }, body: JSON.stringify(body), signal,
});

// Parse a complete server-sent-event body into [{event, data}].
const parseSSE = (text) => text.split('\n\n').filter((b) => b.trim()).map((block) => {
    const ev = (block.match(/^event: (.*)$/m) || [])[1];
    const data = (block.match(/^data: (.*)$/m) || [])[1];
    return { event: ev, data: data ? JSON.parse(data) : null };
});

const waitFor = async (fn, ms = 3000) => {
    const deadline = Date.now() + ms;
    while (!fn()) {
        if (Date.now() > deadline) return false;
        await new Promise((r) => setTimeout(r, 25));
    }
    return true;
};

// The fake's log lines, e.g. "call key=fullsite model=x stream=yes betas=-".
const calls = (s) => (s.output().match(/\[fake-anthropic\] call [^\n]*/g) || []);

let fail = 0;
const check = async (name, fn) => {
    try { await fn(); console.log('PASS  ' + name); } catch (e) { fail++; console.log('FAIL  ' + name + ' -> ' + e.message); }
};

(async () => {
    let s = await startServer({ ANTHROPIC_API_KEY: SHARED, ANTHROPIC_API_KEY_FULLSITE: FULL });
    await check('both keys set: /api/claude uses the shared key (study unchanged)', async () => {
        assert.deepStrictEqual(await ask(s.base, '/api/claude'), { status: 200, text: 'fake reply key=shared', model: 'claude-sonnet-5' });
    });
    await check('both keys set: /api/claude-full uses the full-site key', async () => {
        assert.deepStrictEqual(await ask(s.base, '/api/claude-full'), { status: 200, text: 'fake reply key=fullsite', model: 'claude-sonnet-5' });
    });
    await check('health reports the route and the full-site key', async () => {
        const h = await (await fetch(s.base + '/api/health')).json();
        assert.deepStrictEqual(h, { status: 'ok', apiConfigured: true, deepgramConfigured: false, fullSiteRoute: true, fullSiteKeyConfigured: true, fullSiteStreaming: true });
    });
    await check('/api/claude-full streams server-sent events straight through', async () => {
        const res = await post(s.base, '/api/claude-full', { model: 'claude-sonnet-5-5', max_tokens: 5, stream: true, messages: [{ role: 'user', content: 'ping' }] });
        assert.strictEqual(res.status, 200);
        assert.match(res.headers.get('content-type') || '', /text\/event-stream/);
        const events = parseSSE(await res.text());
        assert.deepStrictEqual(events.map((e) => e.event),
            ['message_start', 'content_block_start', 'ping', 'content_block_delta', 'content_block_delta', 'content_block_stop', 'message_delta', 'message_stop']);
        const text = events.filter((e) => e.event === 'content_block_delta').map((e) => e.data.delta.text).join('');
        assert.strictEqual(text, 'fake stream key=fullsite');
        assert.match(calls(s).pop(), /key=fullsite model=claude-sonnet-5-5 stream=yes betas=-$/);
    });
    await check('/api/claude-full forwards only the allowlisted beta flags', async () => {
        const res = await post(s.base, '/api/claude-full', { model: 'claude-opus-5-5', max_tokens: 5, messages: [{ role: 'user', content: 'ping' }] },
            { 'anthropic-beta': 'fast-mode-2026-02-01, made-up-beta-2099-01-01,server-side-fallback-2026-07-01' });
        assert.strictEqual(res.status, 200);
        assert.strictEqual((await res.json()).content[0].text, 'fake reply key=fullsite');
        assert.match(calls(s).pop(), /stream=no betas=fast-mode-2026-02-01,server-side-fallback-2026-07-01$/);
        await post(s.base, '/api/claude-full', { model: 'claude-opus-5-5', max_tokens: 5, messages: [{ role: 'user', content: 'ping' }] },
            { 'anthropic-beta': 'made-up-beta-2099-01-01' });
        assert.match(calls(s).pop(), /betas=-$/);
    });
    await check('/api/claude (study) still forwards no beta flags and no streaming change', async () => {
        assert.strictEqual((await post(s.base, '/api/claude', { model: 'claude-sonnet-5', max_tokens: 5, messages: [{ role: 'user', content: 'ping' }] },
            { 'anthropic-beta': 'fast-mode-2026-02-01' }).then((r) => r.json())).content[0].text, 'fake reply key=shared');
        assert.match(calls(s).pop(), /key=shared model=claude-sonnet-5 stream=no betas=-$/);
    });
    await check('/api/claude-full passes an upstream error through as JSON, even when streaming', async () => {
        const res = await post(s.base, '/api/claude-full', { model: 'fake-error-model', max_tokens: 5, stream: true, messages: [{ role: 'user', content: 'ping' }] });
        assert.strictEqual(res.status, 400);
        const data = await res.json();
        assert.strictEqual(data.error.type, 'invalid_request_error');
    });
    await check('hanging up mid-stream cancels the upstream request, and the server carries on', async () => {
        const ctrl = new AbortController();
        const res = await post(s.base, '/api/claude-full', { model: 'claude-sonnet-5-5', max_tokens: 5, stream: true, messages: [{ role: 'user', content: 'slow please' }] }, {}, ctrl.signal);
        const reader = res.body.getReader();
        const first = await reader.read();
        assert.ok(!first.done && first.value.length > 0, 'got the first chunk');
        ctrl.abort();
        assert.ok(await waitFor(() => /\[fake-anthropic\] upstream aborted/.test(s.output())), 'upstream was not cancelled');
        assert.doesNotMatch(s.output(), /full-site proxy error/);
        assert.strictEqual((await ask(s.base, '/api/claude-full')).text, 'fake reply key=fullsite');
    });
    await check('the site itself is still served', async () => {
        const r = await fetch(s.base + '/index.html');
        assert.strictEqual(r.status, 200);
        assert.match(await r.text(), /<script/);
    });
    await check('server log says which keys are set, never the keys themselves', () => {
        assert.match(s.output(), /Full-site API key: configured/);
        assert.ok(!s.output().includes(SHARED) && !s.output().includes(FULL));
    });
    await s.stop();

    s = await startServer({ ANTHROPIC_API_KEY: SHARED });
    await check('no full-site key yet: /api/claude-full falls back to the shared key (today\'s behavior)', async () => {
        assert.strictEqual((await ask(s.base, '/api/claude-full')).text, 'fake reply key=shared');
        assert.strictEqual((await ask(s.base, '/api/claude')).text, 'fake reply key=shared');
        const h = await (await fetch(s.base + '/api/health')).json();
        assert.strictEqual(h.fullSiteKeyConfigured, false);
        assert.strictEqual(h.apiConfigured, true);
    });
    await s.stop();

    s = await startServer({});
    await check('no keys at all: both routes refuse with 500, as /api/claude always did', async () => {
        assert.strictEqual((await ask(s.base, '/api/claude')).status, 500);
        assert.strictEqual((await ask(s.base, '/api/claude-full')).status, 500);
        assert.doesNotMatch(s.output(), /fake-anthropic\] call/);
    });
    await s.stop();

    process.exit(fail ? 1 : 0);
})().catch((e) => { console.log('FAIL  server test crashed -> ' + e.message); process.exit(1); });
