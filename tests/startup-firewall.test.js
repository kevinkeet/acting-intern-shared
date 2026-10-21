// App start-up contains AI panel / AI Coworker failures (guardrails, 21 Oct 2026), so a
// coworker bug can never stop the study pages loading. The browser smoke test
// (scripts/smoke-study.mjs) proves it end to end; this keeps the wiring from being
// removed by a later edit. Run: node tests/startup-firewall.test.js
const fs = require('fs'), path = require('path'), vm = require('vm'), assert = require('assert');
const src = fs.readFileSync(path.join(__dirname, '..', 'js', 'app.js'), 'utf8');
const logged = [];
const ctx = {
    console: { log() {}, warn() {}, info() {}, error: (...a) => logged.push(a.join(' ')) },
    document: { addEventListener() {} },
};
ctx.window = ctx; ctx.globalThis = ctx;
vm.createContext(ctx);
vm.runInContext(src, ctx, { filename: 'app.js' });
const App = ctx.App;
let fail = 0;
const check = (name, fn) => { try { fn(); console.log('PASS  ' + name); } catch (e) { fail++; console.log('FAIL  ' + name + ' -> ' + e.message); } };

check('a component that throws while starting is contained and logged', () => {
    logged.length = 0;
    assert.strictEqual(App._startSafely('AI Coworker', () => { throw new Error('boom'); }), false);
    assert.match(logged[0], /AI Coworker failed to start; the rest of the site carries on: boom/);
});
check('a component whose script never loaded (ReferenceError) is contained', () => {
    assert.strictEqual(App._startSafely('AI panel', () => NotLoadedPanel.init()), false); // eslint-disable-line no-undef
});
check('a healthy component starts normally', () => {
    let ran = false;
    assert.strictEqual(App._startSafely('x', () => { ran = true; }), true);
    assert.ok(ran);
});
check('App.init starts the AI panel and AI Coworker only through _startSafely', () => {
    const init = App.init.toString();
    assert.ok(init.includes("this._startSafely('AI panel', () => AIPanel.init())"), 'AI panel wrapped');
    assert.ok(init.includes("this._startSafely('AI Coworker', () => AICoworker.init())"), 'AI Coworker wrapped');
    const rest = init.replace("() => AIPanel.init()", '').replace("() => AICoworker.init()", '');
    assert.ok(!/AIPanel\.init\(|AICoworker\.init\(/.test(rest), 'no unguarded start-up call left');
});
check('loadPatient calls AICoworker.onPatientLoaded inside a try', () => {
    const lp = App.loadPatient.toString();
    assert.match(lp, /try \{\s*if \(typeof AICoworker !== 'undefined'\) \{\s*AICoworker\.onPatientLoaded\(patientId\)/);
    assert.strictEqual((lp.match(/onPatientLoaded/g) || []).length, 1, 'one call site');
});
process.exit(fail ? 1 : 0);
