// Who the admin console's exports keep: registered study participants' work after launch.
// Run: node tests/admin-export.test.js
const fs = require('fs'), path = require('path'), vm = require('vm'), assert = require('assert');
const src = fs.readFileSync(path.join(__dirname, '..', 'js', 'components', 'admin-dashboard.js'), 'utf8') + '\n;globalThis.__AD = AdminDashboard;';
const ctx = { console, Intl, window: {}, document: { getElementById: () => null, addEventListener() {} }, localStorage: { getItem: () => null, setItem() {} }, setTimeout };
ctx.globalThis = ctx; vm.createContext(ctx); vm.runInContext(src, ctx);
const AD = ctx.__AD;

const REGISTERED = new Set(['1001', '1016', '1036']);
const at = (user_code, started_at) => ({ user_code, started_at });
let fail = 0;
const check = (name, fn) => { try { fn(); console.log('PASS  ' + name); } catch (e) { fail++; console.log('FAIL  ' + name + ' -> ' + e.message); } };

check('registered code, after launch: kept', () => assert.strictEqual(AD._isParticipantAttempt(at('1016', '2026-10-14T07:00:00Z'), REGISTERED), true));
check('registered code, before launch (staff test run): left out', () => assert.strictEqual(AD._isParticipantAttempt(at('1001', '2026-09-17T20:00:00Z'), REGISTERED), false));
check('pilot code after launch (4782): left out', () => assert.strictEqual(AD._isParticipantAttempt(at('4782', '2026-10-13T19:53:00Z'), REGISTERED), false));
check('relabeled pilot, staff test and blank codes: left out', () => {
    for (const c of ['PILOT-0930', 'TEST-CLOSED', '', null]) assert.strictEqual(AD._isParticipantAttempt(at(c, '2026-10-01T00:00:00Z'), REGISTERED), false);
});
check('missing start time: left out', () => assert.strictEqual(AD._isParticipantAttempt(at('1036', null), REGISTERED), false));
check('scope summary lists unregistered 4-digit codes, only counts other labels', () => {
    const s = AD._exportScopeSummary([
        at('1016', '2026-10-14T07:00:00Z'), at('1036', '2026-10-15T18:00:00Z'), at('1036', '2026-10-15T19:00:00Z'),
        at('1001', '2026-09-17T20:00:00Z'), at('4782', '2026-10-13T19:53:00Z'), at('1295', '2026-08-20T00:00:00Z'),
        at('PILOT-0930', '2026-09-30T00:00:00Z'), at('TEST-CLOSED', '2026-10-07T00:00:00Z'),
    ], REGISTERED);
    assert.deepStrictEqual(JSON.parse(JSON.stringify(s)), { people: 2, attempts: 3, registered: 3, unregistered: ['1295', '4782'], earlyReal: 1, otherLabels: 2 });
});
process.exit(fail ? 1 : 0);
