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
    await check('no speech key: /api/tts refuses with 503', async () => {
        const r = await post(s.base, '/api/tts', { text: 'Hello.' });
        assert.strictEqual(r.status, 503);
    });
    await s.stop();

    // Deepgram relay (lab, 21 Oct 2026): a browser may ask for the medical model and
    // pass key terms; a caller that passes nothing gets the same connection as before.
    // A fake Deepgram on this machine records what the server asked for.
    const WS = require('ws');
    const dgPort = await freePort();
    const upstream = [];
    const fakeDeepgram = new WS.Server({ port: dgPort, host: '127.0.0.1' });
    fakeDeepgram.on('connection', (sock, req) => {
        const seen = { url: new URL(req.url, 'http://deepgram.local'), auth: req.headers.authorization, audioBytes: 0 };
        upstream.push(seen);
        sock.on('message', (data, isBinary) => {
            if (!isBinary) return;
            seen.audioBytes += data.length;
            sock.send(JSON.stringify({ type: 'Results', channel: { alternatives: [{ transcript: 'heard ' + data.length + ' bytes' }] } }));
        });
    });
    const DG_KEY = 'dg-test-not-a-real-key';
    // A fake Deepgram text-to-speech: records what it was asked, answers with a few "MP3" bytes.
    const http = require('http');
    const speakPort = await freePort();
    const spoken = [];
    const fakeSpeak = http.createServer((req, res) => {
        let body = '';
        req.on('data', (d) => { body += d; });
        req.on('end', () => {
            const u = new URL(req.url, 'http://deepgram.local');
            spoken.push({ path: u.pathname, model: u.searchParams.get('model'), auth: req.headers.authorization, body: JSON.parse(body || '{}') });
            if (/FAIL/.test(body)) { res.writeHead(500, { 'Content-Type': 'application/json' }); return res.end('{"err":"boom"}'); }
            res.writeHead(200, { 'Content-Type': 'audio/mpeg' });
            res.end(Buffer.from('ID3-fake-mp3'));
        });
    });
    await new Promise((r) => fakeSpeak.listen(speakPort, '127.0.0.1', r));
    s = await startServer({ DEEPGRAM_API_KEY: DG_KEY, DEEPGRAM_LISTEN_URL: 'ws://127.0.0.1:' + dgPort + '/v1/listen', DEEPGRAM_SPEAK_URL: 'http://127.0.0.1:' + speakPort + '/v1/speak' });
    const OLD_PARAMS = 'model=nova-3&diarize=true&punctuate=true&interim_results=true&utterance_end_ms=1500&encoding=linear16&sample_rate=16000&channels=1';
    // Open the relay, wait for the server's upstream connection, send a little audio, read the reply.
    const relay = (query) => new Promise((resolve, reject) => {
        const before = upstream.length;
        const c = new WS(s.base.replace('http', 'ws') + '/ws/transcribe' + (query || ''));
        const timer = setTimeout(() => { c.terminate(); reject(new Error('relay timed out')); }, 5000);
        c.on('error', (e) => { clearTimeout(timer); reject(e); });
        c.on('open', async () => {
            await waitFor(() => upstream.length > before, 3000);
            await new Promise((r) => setTimeout(r, 150));   // the server's side of the upstream is open too
            c.send(Buffer.alloc(320), { binary: true });
        });
        c.on('message', (data) => { clearTimeout(timer); c.close(); resolve({ seen: upstream[upstream.length - 1], reply: JSON.parse(data.toString()) }); });
    });
    await check('Deepgram relay: no options connects exactly as before (classic dictation and the scribe unchanged)', async () => {
        const { seen, reply } = await relay('');
        assert.strictEqual(seen.url.pathname, '/v1/listen');
        assert.strictEqual(seen.url.search.slice(1), OLD_PARAMS);
        assert.strictEqual(seen.auth, 'Token ' + DG_KEY);
        assert.strictEqual(seen.audioBytes, 320);
        assert.strictEqual(reply.channel.alternatives[0].transcript, 'heard 320 bytes');
    });
    await check('Deepgram relay: model=medical and key terms reach Deepgram as nova-3-medical with keyterm hints', async () => {
        const { seen } = await relay('?model=medical&keyterm=Entresto&keyterm=sacubitril%20valsartan&keyterm=piperacillin-tazobactam&keyterm=Zosyn');
        assert.strictEqual(seen.url.searchParams.get('model'), 'nova-3-medical');
        assert.deepStrictEqual(seen.url.searchParams.getAll('keyterm'), ['Entresto', 'sacubitril valsartan', 'piperacillin-tazobactam', 'Zosyn']);
        for (const p of ['diarize=true', 'interim_results=true', 'utterance_end_ms=1500', 'encoding=linear16', 'sample_rate=16000']) assert.ok(seen.url.search.includes(p), p);
        assert.match(s.output(), /browser connected \(nova-3-medical, 4 key terms\)/);
    });
    await check('Deepgram relay: unknown models and bad or excess key terms are dropped', async () => {
        const many = Array.from({ length: 70 }, (_, i) => 'keyterm=drugname' + i).join('&');
        const { seen } = await relay('?model=nova-2&keyterm=%3Cscript%3E&keyterm=x&keyterm=Zosyn&keyterm=Zosyn&keyterm=' + 'a'.repeat(60) + '&' + many);
        assert.strictEqual(seen.url.searchParams.get('model'), 'nova-3');
        const terms = seen.url.searchParams.getAll('keyterm');
        assert.strictEqual(terms[0], 'Zosyn');
        assert.strictEqual(terms.filter((t) => t === 'Zosyn').length, 1);
        assert.ok(!terms.some((t) => /[<>]/.test(t) || t === 'x' || t.length > 40), terms.join(','));
        assert.ok(terms.length <= 50 && terms.join('').length <= 900, terms.length + ' terms');
    });
    await check('/api/tts: one sentence in, Deepgram audio out, with the server\'s key and the chosen voice', async () => {
        const r = await post(s.base, '/api/tts', { text: 'Hold the heparin drip.', voice: 'aura-2-orpheus-en' });
        assert.strictEqual(r.status, 200);
        assert.match(r.headers.get('content-type'), /audio\/mpeg/);
        assert.strictEqual(Buffer.from(await r.arrayBuffer()).toString(), 'ID3-fake-mp3');
        const last = spoken[spoken.length - 1];
        assert.deepStrictEqual(last, { path: '/v1/speak', model: 'aura-2-orpheus-en', auth: 'Token ' + DG_KEY, body: { text: 'Hold the heparin drip.' } });
    });
    await check('/api/tts: unknown voices fall back to Athena; empty or too-long text is refused without calling Deepgram', async () => {
        await post(s.base, '/api/tts', { text: 'Hello.', voice: 'some-other-model' });
        assert.strictEqual(spoken[spoken.length - 1].model, 'aura-2-athena-en');
        const before = spoken.length;
        assert.strictEqual((await post(s.base, '/api/tts', { text: '   ' })).status, 400);
        assert.strictEqual((await post(s.base, '/api/tts', { text: 'x'.repeat(1001) })).status, 413);
        assert.strictEqual(spoken.length, before);
    });
    await check('/api/tts: a Deepgram error comes back as a 502 the browser can fall back from', async () => {
        const r = await post(s.base, '/api/tts', { text: 'FAIL please.' });
        assert.strictEqual(r.status, 502);
        assert.match((await r.json()).error, /Speech service error \(500\)/);
    });
    await check('Deepgram relay: the server log never shows the speech key', () => {
        assert.ok(!s.output().includes(DG_KEY));
    });
    await s.stop();
    await new Promise((r) => fakeDeepgram.close(r));
    await new Promise((r) => fakeSpeak.close(r));

    process.exit(fail ? 1 : 0);
})().catch((e) => { console.log('FAIL  server test crashed -> ' + e.message); process.exit(1); });
