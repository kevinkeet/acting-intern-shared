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
// Question-by-question order (Kevin, 22 Oct 2026).
const defs = {
    PAT005: { assessments: [{ prompts: [{ id: 'AP1-Q1' }, { id: 'AP1-Q2' }] }, { prompts: [{ id: 'AP2-Q3' }] }] },
    PAT004: { assessments: [{ prompts: [{ id: 'AP1-Q1' }] }, { prompts: [{ id: 'AP2-Q2' }] }] },
};
const it = (id, c, p, k) => ({ response_id: id, case_id: c, prompt_id: p, sort_key: k });
check('study order: Case 1 question 1 for everyone, then question 2, then Case 2', () => {
    G._caseDefs = defs;
    const items = [it('a', 'PAT004', 'AP1-Q1', '1'), it('b', 'PAT005', 'AP2-Q3', '1'), it('c', 'PAT005', 'AP1-Q1', '9'),
                   it('d', 'PAT005', 'AP1-Q2', '2'), it('e', 'PAT005', 'AP1-Q1', '3'), it('f', 'PAT004', 'AP2-Q2', '0')];
    assert.deepStrictEqual(G._sortByQuestion(items).map((i) => i.response_id), ['e', 'c', 'd', 'b', 'a', 'f']);
});
check('within one question, answers keep the grader\'s own shuffled order', () => {
    G._caseDefs = defs;
    const items = [it('x', 'PAT005', 'AP1-Q1', 'ff'), it('y', 'PAT005', 'AP1-Q1', '0a'), it('z', 'PAT005', 'AP1-Q1', '7c')];
    assert.deepStrictEqual(G._sortByQuestion(items).map((i) => i.response_id), ['y', 'z', 'x']);
});
check('without a case definition, questions fall back to their ids in natural order', () => {
    G._caseDefs = {};
    const items = [it('p', 'PAT007', 'AP1-Q10', 'a'), it('q', 'PAT007', 'AP1-Q2', 'a'), it('r', 'PAT003', 'AP1-Q1', 'a')];
    assert.deepStrictEqual(G._sortByQuestion(items).map((i) => i.response_id), ['q', 'p', 'r']);
});
check('the queue groups by question with case labels and per-question counts', () => {
    G._setMode('real'); G._caseDefs = defs;
    G._items = G._sortByQuestion([it('a', 'PAT005', 'AP1-Q1', '1'), it('b', 'PAT005', 'AP1-Q1', '2'), it('c', 'PAT005', 'AP1-Q2', '1'), it('d', 'PAT003', 'AP1-Q1', '1')]);
    G._order = G._items.map((i) => i.response_id);
    G._mine = new Map([['a', { status: 'submitted' }]]);
    const g = JSON.parse(JSON.stringify(G._groups().map((x) => [x.caseLabel, x.qLabel, x.ids.length, x.done])));
    assert.deepStrictEqual(g, [['Case 1', 'Question 1 of 3', 2, 1], ['Case 1', 'Question 2 of 3', 1, 0], ['Pilot case PAT003', 'Question AP1-Q1', 1, 0]]);
});
check('study grading needs a deliberate start, and a visit to practice asks again', () => {
    const rendered = [];
    const realQ = G.renderQueue, realI = G.renderItem;
    G.renderQueue = (m) => rendered.push('queue ' + m); G.renderItem = (id, m) => rendered.push('item ' + id + ' ' + m);
    try {
        G._setMode('practice');
        assert.strictEqual(G._studyConfirmed(), false, 'not confirmed after practice');
        G.confirmStudy('abc-123');
        assert.strictEqual(G._studyConfirmed(), true);
        assert.deepStrictEqual(rendered, ['item abc-123 real']);
        G._setMode('real');
        assert.strictEqual(G._studyConfirmed(), true, 'stays confirmed within study grading');
        G._setMode('practice');
        assert.strictEqual(G._studyConfirmed(), false, 'practice resets it');
    } finally { G.renderQueue = realQ; G.renderItem = realI; }
});
check('the confirmation screen says the grades count and offers the practice area', () => {
    const html = G._studyConfirmScreen('abc-123');
    assert.match(html, /You are about to grade real study answers/);
    assert.match(html, /Every grade you save here counts in the trial/);
    assert.match(html, /onclick="Grading\.confirmStudy\('abc-123'\)">Start study grading</);
    assert.match(html, /href="#\/grade-practice"/);
    assert.match(G._studyConfirmScreen(null), /onclick="Grading\.confirmStudy\(\)"/);
    assert.match(G._studyConfirmScreen('x\'); alert(1); (\''), /confirmStudy\('xalert1'\)/, 'the id is sanitised');
});
check('the confirmation is kept in sessionStorage when the browser allows it', () => {
    const store = new Map();
    ctx.sessionStorage = { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, v), removeItem: (k) => store.delete(k) };
    try {
        G._setStudyConfirmed(true);
        assert.strictEqual(store.get('grading-study-confirmed'), '1');
        G._setMode('practice');
        assert.strictEqual(store.has('grading-study-confirmed'), false);
    } finally { delete ctx.sessionStorage; }
});

(async () => {
    let calls = 0;
    ctx.AdminDashboard._session = { user: { id: 'u-practice', email: 'p@example.org' } };
    ctx.AdminDashboard._adminClient = () => ({ rpc: async (name) => { calls++; assert.strictEqual(name, 'grader_kind'); return { data: 'practice', error: null }; } });
    try {
        G._kindFor = undefined; G._kindValue = undefined;
        assert.strictEqual(await G._kind(), 'practice');
        assert.strictEqual(await G._kind(), 'practice');
        assert.strictEqual(calls, 1, 'grader_kind is asked once per signed-in account');
        console.log('PASS  a practice account is recognised (asked once per account)');
    } catch (e) { fail++; console.log('FAIL  practice account recognised -> ' + e.message); }
    try {
        ctx.AdminDashboard._adminClient = () => ({ rpc: async () => ({ data: null, error: { message: 'function grader_kind() does not exist' } }) });
        G._kindFor = undefined; G._kindValue = undefined;
        assert.strictEqual(await G._kind(), null);
        console.log('PASS  before migration 020 the page carries on as before (kind unknown)');
    } catch (e) { fail++; console.log('FAIL  pre-020 fallback -> ' + e.message); }
    check('practice accounts are told study grading is closed and sent to the practice area', () => {
        const html = G._practiceAccountNotice();
        assert.match(html, /practice account, so study grading is closed/);
        assert.match(html, /href="#\/grade-practice"/);
    });
    process.exit(fail ? 1 : 0);
})();
