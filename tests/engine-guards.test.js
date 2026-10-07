// Guards in js/services/assessment-engine.js that protect study data.
// Run: node tests/engine-guards.test.js   (no dependencies; exits 1 on failure)
//
//  1. _pickResumable  — "Continue" never offers a case already finished
//  2. staff guard     — a staff browser cannot write under a 4-digit code
//  3. study windows   — a code outside its window cannot start/resume a case,
//                       and a failure of the check itself never blocks anyone

const fs = require('fs'), path = require('path'), vm = require('vm'), assert = require('assert');
const SRC = fs.readFileSync(path.join(__dirname, '..', 'js', 'services', 'assessment-engine.js'), 'utf8')
    + '\n;globalThis.__AE = AssessmentEngine;';

function load({ user = false, code = null, marked = false, rpc = null } = {}) {
    const store = marked ? { 'staff-browser': '1' } : {};
    let rpcCalls = 0;
    const client = {
        from: () => ({
            select() { return this; }, eq() { return this; },
            single: async () => ({ data: { id: 'a1', user_code: code, user_id: null, status: 'in_progress', case_id: 'PAT005' }, error: null }),
        }),
    };
    if (rpc) client.rpc = async (name) => { rpcCalls++; assert.strictEqual(name, 'my_study_window'); return rpc(); };
    const ctx = {
        console: { log() {}, warn() {}, error() {} }, setTimeout, clearTimeout,
        crypto: require('crypto').webcrypto, location: { hostname: 'test' },
        localStorage: { getItem: (k) => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); }, removeItem: (k) => { delete store[k]; } },
        SupabaseSync: { getUser: () => (user ? { id: 'staff-uuid' } : null), getClient: () => client },
        UserCode: { get: () => code, prompt: async () => { throw new Error('no prompt'); } },
        AssessmentData: { loadCase: async () => { throw new Error('REACHED-LOAD'); } },
    };
    ctx.globalThis = ctx; ctx.window = ctx;
    vm.createContext(ctx); vm.runInContext(SRC, ctx);
    return { AE: ctx.__AE, store, rpcCalls: () => rpcCalls };
}

async function outcome(p) {
    try { await p; return 'ok'; } catch (e) {
        if (e.code === 'WINDOW_CLOSED') return 'WINDOW_CLOSED';
        if (/staff browser/.test(e.message)) return 'STAFF_BLOCKED';
        return e.message === 'REACHED-LOAD' ? 'allowed' : 'other: ' + e.message;
    }
}

let failures = 0;
async function check(name, fn) {
    try { await fn(); console.log('PASS  ' + name); }
    catch (e) { failures++; console.log('FAIL  ' + name + ' -> ' + e.message); }
}

(async () => {
    // ── 1. resume selection ────────────────────────────────────────────────
    const pick = load().AE._pickResumable;
    const row = (id, c, s, st, done) => ({ id, case_id: c, status: s, started_at: st, completed_at: done || null });
    await check('resume: restarts orphaned by a later completion are not offered', () => {
        const rows = [
            row('a', 'PAT005', 'in_progress', '2026-09-26T02:37:00Z'),
            row('b', 'PAT005', 'completed', '2026-10-01T01:35:00Z', '2026-10-01T01:49:00Z'),
            row('c', 'PAT007', 'in_progress', '2026-10-02T09:48:00Z'),
            row('d', 'PAT007', 'completed', '2026-10-02T09:57:00Z', '2026-10-02T10:00:00Z'),
        ];
        assert.deepStrictEqual(pick(rows).map((r) => r.id), []);
    });
    await check('resume: an empty double-click twin started first is stale too', () => {
        const rows = [row('t', 'PAT007', 'in_progress', '2026-10-01T02:29:23.349Z'),
            row('k', 'PAT007', 'completed', '2026-10-01T02:29:23.458Z', '2026-10-01T05:28:10Z')];
        assert.deepStrictEqual(pick(rows).map((r) => r.id), []);
    });
    await check('resume: newest in-progress per unfinished case, newest first', () => {
        const rows = [row('c1', 'PAT005', 'completed', '2026-10-03T01:00:00Z', '2026-10-03T01:20:00Z'),
            row('c2a', 'PAT004', 'in_progress', '2026-10-03T01:21:00Z'), row('c2b', 'PAT004', 'in_progress', '2026-10-03T02:00:00Z'),
            row('c3', 'PAT007', 'in_progress', '2026-10-03T01:40:00Z')];
        assert.deepStrictEqual(pick(rows).map((r) => r.id), ['c2b', 'c3']);
    });

    // ── 2. staff guard ─────────────────────────────────────────────────────
    const staff = [
        ['staff: signed-in browser, 4-digit code -> blocked', { user: true, code: '1001' }, 'start', 'STAFF_BLOCKED'],
        ['staff: signed-in browser, TEST- code -> allowed', { user: true, code: 'TEST-QA' }, 'start', 'allowed'],
        ['staff: expired session but marked browser -> blocked', { code: '1001', marked: true }, 'start', 'STAFF_BLOCKED'],
        ['staff: resident browser, own code -> allowed', { code: '1001' }, 'start', 'allowed'],
        ['staff: signed-in browser resuming a resident attempt -> blocked', { user: true, code: '1001' }, 'resume', 'STAFF_BLOCKED'],
    ];
    for (const [name, opts, op, want] of staff) {
        await check(name, async () => {
            const { AE } = load(opts);
            assert.strictEqual(await outcome(op === 'start' ? AE.start('PAT005') : AE.resume('a1')), want);
        });
    }

    // ── 3. study windows ───────────────────────────────────────────────────
    const closed = () => ({ data: { open: false, opens_at: null, closes_at: '2026-10-06T03:59:59+00:00', now: '2026-10-07T15:00:00+00:00' }, error: null });
    const notYet = () => ({ data: { open: false, opens_at: '2026-10-22T19:00:00+00:00', closes_at: null, now: '2026-10-07T15:00:00+00:00' }, error: null });
    const open = () => ({ data: { open: true, opens_at: null, closes_at: null }, error: null });
    const missing = () => ({ data: null, error: { message: 'function public.my_study_window() does not exist' } });
    const down = () => { throw new Error('network down'); };
    const windows = [
        ['window: PRE code after its deadline cannot start', { code: '1005', rpc: closed }, 'start', 'WINDOW_CLOSED'],
        ['window: PRE code after its deadline cannot resume', { code: '1005', rpc: closed }, 'resume', 'WINDOW_CLOSED'],
        ['window: POST code before it opens cannot start', { code: '1002', rpc: notYet }, 'start', 'WINDOW_CLOSED'],
        ['window: open window -> allowed', { code: '1007', rpc: open }, 'start', 'allowed'],
        ['window: database function missing -> allowed (fail open)', { code: '1007', rpc: missing }, 'start', 'allowed'],
        ['window: network failure -> allowed (fail open)', { code: '1007', rpc: down }, 'start', 'allowed'],
    ];
    for (const [name, opts, op, want] of windows) {
        await check(name, async () => {
            const { AE } = load(opts);
            assert.strictEqual(await outcome(op === 'start' ? AE.start('PAT005') : AE.resume('a1')), want);
        });
    }
    await check('window: messages name the right situation', () => {
        const { AE } = load();
        assert.match(AE.studyWindowMessage(closed().data), /^The time for your TEACH-AI cases ended on /);
        assert.match(AE.studyWindowMessage(notYet().data), /^Your TEACH-AI cases open on /);
    });
    await check('window: cached for a minute (one database call for two checks)', async () => {
        const l = load({ code: '1007', rpc: open });
        await l.AE.getStudyWindow(false); await l.AE.getStudyWindow(false);
        assert.strictEqual(l.rpcCalls(), 1);
    });

    console.log(failures ? `\n${failures} FAILED` : '\nall passed');
    process.exit(failures ? 1 : 0);
})();
