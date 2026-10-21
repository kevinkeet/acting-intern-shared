// Which server route each kind of browser uses for Claude (guardrails, 21 Oct 2026).
// Study and demo browsers must behave exactly as before; only the full-site door
// (?allmodes) moves to /api/claude-full, which has its own key and spend limit.
// Loads the real mode-manager.js, claude-api.js and ai-coworker.js in a sandbox.
// Run: node tests/claude-api-routing.test.js
const fs = require('fs'), path = require('path'), vm = require('vm'), assert = require('assert');
const ROOT = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

const store = new Map();
const localStorage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => { store.set(k, String(v)); },
    removeItem: (k) => { store.delete(k); },
};
const quiet = { log() {}, info() {}, warn() {}, error: console.error, debug() {} };
const ctx = {
    console: quiet, localStorage, location: { search: '', hostname: 'actingintern.com' },
    document: { getElementById: () => null, querySelector: () => null, querySelectorAll: () => [] },
    setTimeout, clearTimeout, AbortController, JSON, Promise,
};
ctx.window = ctx; ctx.globalThis = ctx;
vm.createContext(ctx);
vm.runInContext(read('js/services/mode-manager.js'), ctx, { filename: 'mode-manager.js' });
vm.runInContext(read('js/services/claude-api.js'), ctx, { filename: 'claude-api.js' });
vm.runInContext(read('js/components/ai-coworker.js'), ctx, { filename: 'ai-coworker.js' });

// The client as it was before this change (main at 3adaf2f), copied verbatim, to prove
// study and demo browsers get exactly the same endpoint, headers and "configured" answer.
vm.runInContext(`globalThis.__OLD = {
    _ensureKey() {
        if (!this.useProxy && !this.apiKey) {
            try {
                const k = localStorage.getItem('anthropic-api-key');
                if (k) this.apiKey = k;
            } catch (e) { /* localStorage unavailable */ }
        }
        return this.apiKey;
    },
    isConfigured() {
        if (this.useProxy) return true;
        return !!this._ensureKey();
    },
    _getHeaders() {
        if (this.useProxy) {
            return { 'Content-Type': 'application/json' };
        }
        return {
            'Content-Type': 'application/json',
            'x-api-key': this._ensureKey(),
            'anthropic-version': '2023-06-01',
            'anthropic-dangerous-direct-browser-access': 'true'
        };
    },
    _getEndpoint() {
        if (this.useProxy) return '/api/claude';
        return 'https://api.anthropic.com/v1/messages';
    },
};`, ctx);

const C = ctx.ClaudeAPI, CW = ctx.AICoworker, OLD = ctx.__OLD;
const DIRECT = 'https://api.anthropic.com/v1/messages';
const DOORS = {
    study: () => { store.delete('all-modes-unlocked'); store.delete('demo-mode'); },
    demo: () => { store.delete('all-modes-unlocked'); store.set('demo-mode', '1'); },
    full: () => { store.set('all-modes-unlocked', '1'); store.delete('demo-mode'); },
};
const setState = (s) => {
    C.useProxy = s.useProxy; C.serverAvailable = s.serverAvailable; C.fullSiteRoute = s.fullSiteRoute; C.apiKey = s.apiKey;
};

let fail = 0;
const results = [];
const check = async (name, fn) => {
    try { await fn(); results.push('PASS  ' + name); } catch (e) { fail++; results.push('FAIL  ' + name + ' -> ' + e.message); }
};

(async () => {
    await check('study and demo browsers: endpoint, headers and "configured" match the old client in every state', () => {
        let combos = 0;
        for (const door of ['study', 'demo']) {
            for (const useProxy of [true, false]) for (const serverAvailable of [true, false])
            for (const fullSiteRoute of [true, false]) for (const apiKey of [null, 'sk-ant-in-memory'])
            for (const stored of [null, 'sk-ant-stored']) {
                DOORS[door]();
                if (stored) store.set('anthropic-api-key', stored); else store.delete('anthropic-api-key');
                const state = { useProxy, serverAvailable, fullSiteRoute, apiKey };
                setState(state);
                const old = Object.assign(Object.create(OLD), { useProxy, apiKey });
                const label = JSON.stringify({ door, ...state, stored });
                assert.strictEqual(C.isConfigured(), old.isConfigured(), 'isConfigured ' + label);
                assert.deepStrictEqual({ ...C._getHeaders() }, { ...old._getHeaders() }, 'headers ' + label);
                assert.strictEqual(C._getEndpoint(), old._getEndpoint(), 'endpoint ' + label);
                assert.strictEqual(C.apiKey, old.apiKey, 'key loaded ' + label);
                combos++;
            }
        }
        assert.strictEqual(combos, 64);
    });

    await check('full-site door with the server: /api/claude-full, no key sent from the browser', () => {
        DOORS.full(); store.set('anthropic-api-key', 'sk-ant-stored');
        for (const useProxy of [true, false]) {   // false = the access gate unlocked after detectBackend
            setState({ useProxy, serverAvailable: true, fullSiteRoute: true, apiKey: 'sk-ant-in-memory' });
            assert.strictEqual(C._getEndpoint(), '/api/claude-full');
            assert.deepStrictEqual({ ...C._getHeaders() }, { 'Content-Type': 'application/json' });
            assert.strictEqual(C.isConfigured(), true);
            assert.strictEqual(C.serverEndpoint(), '/api/claude-full');
        }
    });

    await check('full-site door, server without the new route: same as before (/api/claude)', () => {
        DOORS.full();
        setState({ useProxy: true, serverAvailable: true, fullSiteRoute: false, apiKey: null });
        assert.strictEqual(C._getEndpoint(), '/api/claude');
        assert.strictEqual(C.serverEndpoint(), '/api/claude');
    });

    await check('full-site door, no server (static hosting): direct, as before', () => {
        DOORS.full(); store.set('anthropic-api-key', 'sk-ant-stored');
        setState({ useProxy: false, serverAvailable: false, fullSiteRoute: false, apiKey: null });
        assert.strictEqual(C._getEndpoint(), DIRECT);
        assert.strictEqual(C._getHeaders()['x-api-key'], 'sk-ant-stored');
    });

    await check('if the door cannot be read, the browser is treated as a study browser', () => {
        setState({ useProxy: true, serverAvailable: true, fullSiteRoute: true, apiKey: null });
        const realGet = localStorage.getItem;
        localStorage.getItem = () => { throw new Error('storage blocked'); };
        try { assert.strictEqual(C._getEndpoint(), '/api/claude'); } finally { localStorage.getItem = realGet; }
        const realLocked = ctx.ModeManager.isStudyLocked;
        DOORS.full();
        ctx.ModeManager.isStudyLocked = () => { throw new Error('mode manager broken'); };
        try { assert.strictEqual(C._getEndpoint(), '/api/claude'); } finally { ctx.ModeManager.isStudyLocked = realLocked; }
    });

    // Real requests through every ClaudeAPI entry point, with fetch recorded.
    const calls = [];
    ctx.fetch = async (url, init) => {
        calls.push({ url, headers: init && init.headers });
        return { ok: true, json: async () => ({ content: [{ type: 'text', text: 'ok' }] }) };
    };
    const everyEntryPoint = async () => {
        calls.length = 0;
        await C.sendMessage('system', [{ role: 'user', content: 'hi' }], { model: 'claude-sonnet-5' });  // study AI Chat path
        await C.chat('system', [{ role: 'user', content: 'hi' }]);
        await C._singleChat({ systemPrompt: 's', userMessage: 'u' });                                  // auto-grader path
        await C.parallelChat([{ systemPrompt: 's', userMessage: 'u' }], 1);
        await C.webSearchChat({ systemPrompt: 's', userMessage: 'u' });
        return calls.map((c) => c.url);
    };
    await check('study browser: every ClaudeAPI request goes to /api/claude', async () => {
        DOORS.study(); setState({ useProxy: true, serverAvailable: true, fullSiteRoute: true, apiKey: null });
        assert.deepStrictEqual(await everyEntryPoint(), Array(5).fill('/api/claude'));
    });
    await check('demo browser: every ClaudeAPI request goes to /api/claude', async () => {
        DOORS.demo(); setState({ useProxy: true, serverAvailable: true, fullSiteRoute: true, apiKey: null });
        assert.deepStrictEqual(await everyEntryPoint(), Array(5).fill('/api/claude'));
    });
    await check('full-site browser: every ClaudeAPI request goes to /api/claude-full', async () => {
        DOORS.full(); setState({ useProxy: false, serverAvailable: true, fullSiteRoute: true, apiKey: 'sk-ant-in-memory' });
        assert.deepStrictEqual(await everyEntryPoint(), Array(5).fill('/api/claude-full'));
        assert.ok(calls.every((c) => !('x-api-key' in c.headers)), 'no key leaves the browser');
    });

    // AICoworker.detectBackend sets the flags from /api/health.
    const health = (body, ok = true) => {
        ctx.fetch = async (url) => {
            assert.strictEqual(url, '/api/health');
            if (body instanceof Error) throw body;
            return { ok, json: async () => body };
        };
    };
    const detect = async (door, body) => {
        DOORS[door](); setState({ useProxy: true, serverAvailable: false, fullSiteRoute: false, apiKey: null });
        health(body);
        await CW.detectBackend();
        return { coworker: CW.apiEndpoint, client: C._getEndpoint(), backend: CW.backendAvailable, useProxy: C.useProxy };
    };
    const NEW_SERVER = { status: 'ok', apiConfigured: true, fullSiteRoute: true, fullSiteKeyConfigured: true };
    await check('detectBackend, study browser: coworker and client both on /api/claude', async () => {
        assert.deepStrictEqual(await detect('study', NEW_SERVER),
            { coworker: '/api/claude', client: '/api/claude', backend: true, useProxy: true });
    });
    await check('detectBackend, demo browser: coworker and client both on /api/claude', async () => {
        assert.deepStrictEqual(await detect('demo', NEW_SERVER),
            { coworker: '/api/claude', client: '/api/claude', backend: true, useProxy: true });
    });
    await check('detectBackend, full-site browser: coworker and client both on /api/claude-full', async () => {
        assert.deepStrictEqual(await detect('full', NEW_SERVER),
            { coworker: '/api/claude-full', client: '/api/claude-full', backend: true, useProxy: true });
    });
    await check('detectBackend, full-site browser on a server without the route: /api/claude as before', async () => {
        assert.deepStrictEqual(await detect('full', { status: 'ok', apiConfigured: true }),
            { coworker: '/api/claude', client: '/api/claude', backend: true, useProxy: true });
    });
    await check('detectBackend, no server: direct mode as before, server flag cleared', async () => {
        const r = await detect('full', new Error('offline'));
        assert.deepStrictEqual(r, { coworker: DIRECT, client: DIRECT, backend: false, useProxy: false });
        assert.strictEqual(C.serverAvailable, false);
    });

    results.forEach((line) => console.log(line));
    process.exit(fail ? 1 : 0);
})();
