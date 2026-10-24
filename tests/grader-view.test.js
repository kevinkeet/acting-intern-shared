// Grader view (Kevin, 23 Oct 2026): a signed-in grader sees the grading pages only, with no links to
// other parts of the site and no AI panels, and the visitor chooser never covers a staff page.
// scripts/smoke-study.mjs and the browser check cover the pages end to end; this keeps the wiring.
// Run: node tests/grader-view.test.js
const fs = require('fs'), path = require('path'), vm = require('vm'), assert = require('assert');
const read = (p) => fs.readFileSync(path.join(__dirname, '..', p), 'utf8');
let fail = 0;
const check = (name, fn) => { try { fn(); console.log('PASS  ' + name); } catch (e) { fail++; console.log('FAIL  ' + name + ' -> ' + e.message); } };

function storage() {
    const m = new Map();
    return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k), _m: m };
}
function classList() {
    const s = new Set();
    return { toggle: (c, on) => (on ? s.add(c) : s.delete(c)), contains: (c) => s.has(c), forEach: (f) => s.forEach(f), add: (c) => s.add(c), remove: (c) => s.delete(c), _s: s };
}

// ── app.js ────────────────────────────────────────────────────────────────
const appCtx = {
    console: { log() {}, warn() {}, info() {}, error() {} },
    localStorage: storage(),
    location: { hash: '' },
    history: { replaceState: (a, b, url) => { appCtx.location.hash = url; } },
    AdminDashboard: { _adminRole: null },
    appended: [],
};
appCtx.document = {
    addEventListener() {}, body: { classList: classList(), appendChild: (el) => appCtx.appended.push(el) },
    querySelector: () => null, getElementById: () => null, createElement: () => ({ querySelectorAll: () => [], setAttribute() {} }),
};
appCtx.window = appCtx; appCtx.globalThis = appCtx;
vm.createContext(appCtx);
vm.runInContext(read('js/app.js'), appCtx, { filename: 'app.js' });
const App = appCtx.App;
const as = (live, remembered, hash) => {
    appCtx.AdminDashboard._adminRole = live;
    if (remembered) appCtx.localStorage.setItem('staff-role', remembered); else appCtx.localStorage.removeItem('staff-role');
    appCtx.location.hash = hash || '';
};

check('staff role: the live session wins, then the role remembered in this browser', () => {
    as('admin', 'grader'); assert.strictEqual(App._staffRole(), 'admin');
    as(null, 'grader'); assert.strictEqual(App._staffRole(), 'grader');
    as(null, null); assert.strictEqual(App._staffRole(), null);
});
check('grader view: on everywhere for a grader, on the grading pages for anyone not signed in as admin', () => {
    as('grader', null, '#/chart-review'); assert.strictEqual(App._graderView(), true);
    as(null, 'grader', '#/assessment/start'); assert.strictEqual(App._graderView(), true);
    as(null, null, '#/grade'); assert.strictEqual(App._graderView(), true);
    as(null, null, '#/grade-practice/abc'); assert.strictEqual(App._graderView(), true);
    as('admin', null, '#/grade'); assert.strictEqual(App._graderView(), false);
    as('proctor', null, '#/grade'); assert.strictEqual(App._graderView(), false);
    as(null, null, '#/chart-review'); assert.strictEqual(App._graderView(), false);
    as(null, null, '#/assessment/start'); assert.strictEqual(App._graderView(), false);
});
check('route guard: a grader may open the grading pages only', () => {
    as('grader');
    for (const ok of ['/grade', '/grade/abc-123', '/grade-practice', '/grade-practice/xyz']) assert.strictEqual(App.routeGuard(ok), null, ok);
    for (const no of ['/chart-review', '/admin/attempts', '/admin/grading', '/assessment/start', '/tutor', '/about', '/gradebook', ''])
        assert.strictEqual(App.routeGuard(no), '#/grade', no);
});
check('route guard: admins, proctors and visitors are never redirected', () => {
    for (const role of ['admin', 'proctor', null]) { as(role); assert.strictEqual(App.routeGuard('/chart-review'), null, String(role)); }
});
check('staff mode sync sets body.grader-view and body.mode-staff', () => {
    const cl = appCtx.document.body.classList;
    as('grader', null, '#/grade'); App._syncStaffMode();
    assert.ok(cl.contains('grader-view') && cl.contains('mode-staff'));
    as('admin', null, '#/grade'); App._syncStaffMode();
    assert.ok(!cl.contains('grader-view') && cl.contains('mode-staff'));
    as(null, null, '#/chart-review'); App._syncStaffMode();
    assert.ok(!cl.contains('grader-view') && !cl.contains('mode-staff'));
});
check('the visitor chooser never opens on a staff page or for a grader', () => {
    appCtx.localStorage.removeItem('entry-mode');
    for (const [role, hash] of [[null, '#/grade'], [null, '#/admin/windows'], ['grader', '#/chart-review']]) {
        appCtx.appended.length = 0; as(role, null, hash); App._maybeShowEntryChooser();
        assert.strictEqual(appCtx.appended.length, 0, role + ' ' + hash);
    }
    appCtx.appended.length = 0; as(null, null, '#/assessment/start'); App._maybeShowEntryChooser();
    assert.strictEqual(appCtx.appended.length, 1, 'a visitor still gets the chooser');
});
check('start-up treats #/grade like #/admin (no chooser, no About) and sends a grader to #/grade', () => {
    const init = App.init.toString();
    assert.match(init, /const _onStaffRoute = \/\^#\\\/\(admin\|grade\)\/\.test/);
    assert.ok(!/_onAdminRoute/.test(init), 'old name gone');
    assert.match(init, /this\._staffRole\(\) === 'grader'[^\n]*'#\/grade'/);
    assert.match(init, /history\.replaceState\(null, '', '#\/grade'\)/);
});

// ── router.js ─────────────────────────────────────────────────────────────
const rCtx = { console: { log() {}, warn() {} }, document: { body: { classList: classList() }, querySelectorAll: () => [], getElementById: () => ({ innerHTML: '' }) } };
rCtx.window = rCtx; rCtx.globalThis = rCtx;
rCtx.addEventListener = () => {};
rCtx.location = { hash: '#/chart-review', replace: (h) => { rCtx.replaced = h; } };
rCtx.window.location = rCtx.location;
vm.createContext(rCtx);
vm.runInContext(read('js/router.js'), rCtx, { filename: 'router.js' });
const router = rCtx.router;
let rendered = [];
router.on('/chart-review', () => rendered.push('chart')).on('/grade', () => rendered.push('grade'));
check('router asks App.routeGuard first and redirects without rendering the page', () => {
    rCtx.App = { routeGuard: (p) => (p === '/grade' ? null : '#/grade') };
    rendered = []; rCtx.replaced = null; rCtx.location.hash = '#/chart-review';
    router.handleRoute();
    assert.strictEqual(rCtx.replaced, '#/grade'); assert.deepStrictEqual(rendered, []);
    rCtx.location.hash = '#/grade'; rCtx.replaced = null; router.handleRoute();
    assert.strictEqual(rCtx.replaced, null); assert.deepStrictEqual(rendered, ['grade']);
});
check('router renders normally when the guard says go ahead, throws, or is missing', () => {
    rCtx.location.hash = '#/chart-review';
    for (const app of [{ routeGuard: () => null }, { routeGuard: () => { throw new Error('x'); } }, undefined]) {
        rCtx.App = app; rendered = []; rCtx.replaced = null; router.handleRoute();
        assert.deepStrictEqual(rendered, ['chart']); assert.strictEqual(rCtx.replaced, null);
    }
});

// ── admin-dashboard.js ────────────────────────────────────────────────────
const aCtx = { console: { log() {}, warn() {} }, localStorage: storage(), synced: 0, events: [] };
aCtx.window = aCtx; aCtx.globalThis = aCtx;
aCtx.location = { hash: '#/grade' }; aCtx.window.location = aCtx.location;
aCtx.App = { _syncStaffMode: () => { aCtx.synced++; } };
aCtx.CustomEvent = function (type) { this.type = type; };
aCtx.dispatchEvent = (e) => aCtx.events.push(e.type);
aCtx.router = { handleRoute: () => { aCtx.handled = (aCtx.handled || 0) + 1; } };
vm.createContext(aCtx);
vm.runInContext(read('js/components/admin-dashboard.js'), aCtx, { filename: 'admin-dashboard.js' });
const AD = aCtx.AdminDashboard;
check('remembering the staff role stores it, clears it, and refreshes the view', () => {
    aCtx.synced = 0;
    AD._rememberStaffRole('grader'); assert.strictEqual(aCtx.localStorage.getItem('staff-role'), 'grader');
    AD._rememberStaffRole('admin'); assert.strictEqual(aCtx.localStorage.getItem('staff-role'), 'admin');
    AD._rememberStaffRole('resident'); assert.strictEqual(aCtx.localStorage.getItem('staff-role'), null);
    AD._rememberStaffRole(null); assert.strictEqual(aCtx.localStorage.getItem('staff-role'), null);
    assert.strictEqual(aCtx.synced, 4);
});
(async () => {
    const signOutTo = async (role, hash) => {
        AD._client = { auth: { signOut: async () => ({}) } }; AD._adminRole = role; AD._session = { user: { id: 'u' } };
        aCtx.localStorage.setItem('staff-role', role); aCtx.location.hash = hash; aCtx.handled = 0;
        await AD.signOut();
        return { hash: aCtx.location.hash, remembered: aCtx.localStorage.getItem('staff-role'), role: AD._adminRole, handled: aCtx.handled };
    };
    try {
        let r = await signOutTo('grader', '#/grade-practice/abc');
        assert.deepStrictEqual(r, { hash: '#/grade', remembered: null, role: null, handled: 0 });
        r = await signOutTo('grader', '#/grade');
        assert.deepStrictEqual(r, { hash: '#/grade', remembered: null, role: null, handled: 1 });
        r = await signOutTo('admin', '#/admin/windows');
        assert.deepStrictEqual(r, { hash: '#/admin/attempts', remembered: null, role: null, handled: 0 });
        console.log('PASS  sign-out destinations: grader -> #/grade, admin -> #/admin/attempts; role forgotten');
    } catch (e) { fail++; console.log('FAIL  sign-out destinations -> ' + e.message); }

    check('the grader sign-in shows the graders\' note, not the PI/proctor small print', () => {
        const root = { innerHTML: '' };
        aCtx.document = { getElementById: () => null };
        aCtx.App.refreshIcons = () => {};
        AD._renderLogin(root, { title: 'Grader sign-in', note: 'For the study\'s faculty graders.' });
        assert.match(root.innerHTML, /For the study&#39;s faculty graders\./);
        assert.ok(!/PI \/ proctors/.test(root.innerHTML));
        AD._renderLogin(root, {});
        assert.match(root.innerHTML, /PI \/ proctors/);
    });

    // ── CSS ───────────────────────────────────────────────────────────────
    check('grader-view CSS hides the other header items, AI panels and pop-ups, outranking the mode rules', () => {
        const css = read('css/epic-theme.css');
        const block = css.slice(css.indexOf('body.grader-view .top-header .header-left'), css.indexOf('{ display: none !important; }', css.indexOf('body.grader-view .top-header .header-left')));
        for (const sel of ['.header-left > :not(.logo)', '.header-right > :not(#header-auth-chip)', 'html body.grader-view #ai-panel,',
            '#ai-panel-floating-btn.visible', '#tutor-panel', '#chat-trigger-buttons', '#entry-chooser', '#mode-chooser', '#about-modal-overlay'])
            assert.ok(block.includes(sel), sel);
    });
    process.exit(fail ? 1 : 0);
})();
