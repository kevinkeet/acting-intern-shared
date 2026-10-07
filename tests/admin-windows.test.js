// Parser for the admin console's "Register enrollments from REDCap" box.
// Run: node tests/admin-windows.test.js
const fs = require('fs'), path = require('path'), vm = require('vm'), assert = require('assert');
const src = fs.readFileSync(path.join(__dirname, '..', 'js', 'components', 'admin-dashboard.js'), 'utf8') + '\n;globalThis.__AD = AdminDashboard;';
const ctx = { console, window: {}, document: { getElementById: () => null, addEventListener() {} }, localStorage: { getItem: () => null, setItem() {} }, setTimeout };
ctx.globalThis = ctx; vm.createContext(ctx); vm.runInContext(src, ctx);
const parse = (t) => JSON.parse(JSON.stringify(ctx.__AD._parseRegistrations(t)));
let fail = 0;
const check = (name, fn) => { try { fn(); console.log('PASS  ' + name); } catch (e) { fail++; console.log('FAIL  ' + name + ' -> ' + e.message); } };
check('typed lines with commas and spaces', () => assert.deepStrictEqual(parse('1007, 1, 2\n1008 1 1\n'), { rows: [{ code: '1007', site: 1, arm: 2 }, { code: '1008', site: 1, arm: 1 }], errors: [] }));
check('REDCap CSV export, columns in another order, quoted', () => assert.deepStrictEqual(
    parse('"arm","record_id","site"\r\n"2","1009","1"\r\n"1","1010","1"'),
    { rows: [{ code: '1009', site: 1, arm: 2 }, { code: '1010', site: 1, arm: 1 }], errors: [] }));
check('not yet randomized (blank arm) and label exports are reported, not registered', () => {
    const r = parse('record_id,site,arm\n1011,1,\n1012,Stanford,Pre-session');
    assert.strictEqual(r.rows.length, 0); assert.strictEqual(r.errors.length, 2);
});
check('header missing arm column', () => assert.match(parse('record_id,site\n1013,1').errors[0], /record_id, site and arm/));
check('bad codes and out-of-range values rejected', () => assert.deepStrictEqual(parse('123, 1, 1\n1014, 5, 1\n1015, 1, 3').rows, []));
check('empty box', () => assert.deepStrictEqual(parse('  \n '), { rows: [], errors: [] }));
process.exit(fail ? 1 : 0);
