// Parser for the admin console's "Register enrollments from REDCap" box.
// Run: node tests/admin-windows.test.js
const fs = require('fs'), path = require('path'), vm = require('vm'), assert = require('assert');
const src = fs.readFileSync(path.join(__dirname, '..', 'js', 'components', 'admin-dashboard.js'), 'utf8') + '\n;globalThis.__AD = AdminDashboard;';
const ctx = { console, Intl, window: {}, document: { getElementById: () => null, addEventListener() {} }, localStorage: { getItem: () => null, setItem() {} }, setTimeout };
ctx.globalThis = ctx; vm.createContext(ctx); vm.runInContext(src, ctx);

const SESSIONS = [
    { session_id: 'CHA1006', site: 3, tz: 'America/New_York', starts_at: '2026-10-06T16:00:00Z' },
    { session_id: 'STAN1022', site: 1, tz: 'America/Los_Angeles', starts_at: '2026-10-22T17:30:00Z' },
    { session_id: 'STAN1105', site: 1, tz: 'America/Los_Angeles', starts_at: '2026-11-05T18:30:00Z' },
    { session_id: 'BIDMC1110', site: 2, tz: 'America/New_York', starts_at: null },
];
const parse = (t) => JSON.parse(JSON.stringify(ctx.__AD._parseRegistrations(t, SESSIONS)));
let fail = 0;
const check = (name, fn) => { try { fn(); console.log('PASS  ' + name); } catch (e) { fail++; console.log('FAIL  ' + name + ' -> ' + e.message); } };

check('typed lines: code, site, arm, session date', () => assert.deepStrictEqual(
    parse('1007, 1, 2, 2026-10-22\n1008, 1, 1, 2026-11-05'),
    { rows: [{ code: '1007', session: 'STAN1022', arm: 2 }, { code: '1008', session: 'STAN1105', arm: 1 }], errors: [] }));
check('typed shortcut: code, session id, arm', () => assert.deepStrictEqual(
    parse('1009, stan1105, 2'), { rows: [{ code: '1009', session: 'STAN1105', arm: 2 }], errors: [] }));
check('REDCap raw CSV export, any column order, extra columns ignored', () => assert.deepStrictEqual(
    parse('"record_id","arm","enrollment_order","site","session_date"\r\n"1010","2","3","1","2026-10-22"\r\n"1011","1","4","1","2026-11-05"'),
    { rows: [{ code: '1010', session: 'STAN1022', arm: 2 }, { code: '1011', session: 'STAN1105', arm: 1 }], errors: [] }));
check('REDCap report copied as a table (tabs, labels with spaces)', () => assert.deepStrictEqual(
    parse('Record ID record_id\tYour residency program site\tArm (assigned automatically) arm\tWorkshop session date (this site) session_date\n'
        + '1012\tStanford\tPost-session (intervention): cases AFTER the workshop\t2026-10-22\n'
        + '1013\tCambridge Health Alliance\tPre-session (control): cases BEFORE the workshop\t2026-10-06'),
    { rows: [{ code: '1012', session: 'STAN1022', arm: 2 }, { code: '1013', session: 'CHA1006', arm: 1 }], errors: [] }));
check('missing session date is reported, not registered', () => {
    const r = parse('record_id,site,arm,session_date\n1014,1,2,');
    assert.strictEqual(r.rows.length, 0); assert.match(r.errors[0], /no session date yet/);
});
check('date with no session at that site (or session without a time) is reported', () => {
    const r = parse('1015, 1, 1, 2026-10-29\n1016, 2, 2, 2026-11-10');
    assert.strictEqual(r.rows.length, 0); assert.strictEqual(r.errors.length, 2);
    assert.match(r.errors[0], /no session on 2026-10-29/);
});
check('header without session_date says what is missing', () => assert.match(parse('record_id,site,arm\n1017,1,1').errors[0], /missing: session_date/));
check('bad code and bad arm rejected', () => {
    const r = parse('123, 1, 1, 2026-10-22\n1018, 1, 3, 2026-10-22');
    assert.strictEqual(r.rows.length, 0); assert.strictEqual(r.errors.length, 2);
});
check('US-style date is accepted', () => assert.deepStrictEqual(parse('1019, 1, 2, 10/22/2026').rows, [{ code: '1019', session: 'STAN1022', arm: 2 }]));
check('empty box', () => assert.deepStrictEqual(parse('  \n '), { rows: [], errors: [] }));
process.exit(fail ? 1 : 0);
