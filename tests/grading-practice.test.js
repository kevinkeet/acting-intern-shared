// Grading pages: study grading vs the practice area (migration 019) are never confused.
// Run: node tests/grading-practice.test.js
const fs = require('fs'), path = require('path'), vm = require('vm'), assert = require('assert');
const src = fs.readFileSync(path.join(__dirname, '..', 'js', 'components', 'grading.js'), 'utf8') + '\n;globalThis.__G = Grading;';
const ctx = {
    console, window: {}, document: { title: '' },
    AdminDashboard: { _session: { user: { email: 'grader@example.org' } }, _adminRole: 'grader', _escape: (s) => String(s) },
};
ctx.globalThis = ctx; vm.createContext(ctx); vm.runInContext(src, ctx);
const G = ctx.__G;
let fail = 0;
const check = (name, fn) => { try { fn(); console.log('PASS  ' + name); } catch (e) { fail++; console.log('FAIL  ' + name + ' -> ' + e.message); } };

check('practice mode: links, title and banner say practice', () => {
    G._setMode('practice');
    assert.strictEqual(G._href(), '#/grade-practice');
    assert.strictEqual(G._href('abc'), '#/grade-practice/abc');
    assert.match(ctx.document.title, /^Grading practice/);
    assert.match(G._conf().banner, /PRACTICE AREA/);
    assert.match(G._conf().banner, /never used in the study/);
});
check('study mode: links, title and banner say the grades count', () => {
    G._setMode('real');
    assert.strictEqual(G._href('abc'), '#/grade/abc');
    assert.match(ctx.document.title, /^Study grading/);
    assert.match(G._conf().banner, /STUDY GRADING/);
    assert.match(G._conf().banner, /counts in the trial/);
});
check('unknown mode falls back to study grading', () => { G._setMode('whatever'); assert.strictEqual(G._mode, 'real'); });
check('top bar shows both areas, marks the current one, and carries the banner', () => {
    G._setMode('practice'); G._items = []; G._mine = new Map();
    const html = G._topbar();
    assert.match(html, /grading-mode grading-mode-practice/);
    assert.match(html, /href="#\/grade-practice" class="admin-tab grading-tab-practice active"/);
    assert.match(html, /href="#\/grade" class="admin-tab"/);
    G._setMode('real'); G._items = []; G._mine = new Map();
    const real = G._topbar();
    assert.match(real, /grading-mode grading-mode-real/);
    assert.match(real, /href="#\/grade" class="admin-tab active"/);
});
check('practice rows map to the item shape, kept together by case', () => assert.deepStrictEqual(
    JSON.parse(JSON.stringify(G._practiceItems([{ item_id: 'i1', case_id: 'PAT004', prompt_id: 'AP1-Q1', response_text: 'x', sort_key: '0a' }]))),
    [{ response_id: 'i1', case_id: 'PAT004', assessment_id: null, prompt_id: 'AP1-Q1', response_text: 'x', sort_key: 'PAT004|0a' }]));
check('each area keeps its own cache (switching never mixes items)', () => {
    G._cache = { real: { items: [{ response_id: 'r' }], order: ['r'], mine: new Map() }, practice: { items: [{ response_id: 'p' }], order: ['p'], mine: new Map() } };
    G._setMode('practice'); assert.strictEqual(G._items[0].response_id, 'p');
    G._setMode('real'); assert.strictEqual(G._items[0].response_id, 'r');
});
process.exit(fail ? 1 : 0);
