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
        assert.deepStrictEqual(h, { status: 'ok', apiConfigured: true, deepgramConfigured: false, fullSiteRoute: true, fullSiteKeyConfigured: true });
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
