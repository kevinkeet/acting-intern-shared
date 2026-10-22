/**
 * Grading — blinded human grading of study answers (migration 008), plus a
 * practice area on pilot answers (migration 019).
 *
 *   #/grade                   study queue: progress + next ungraded item
 *   #/grade/:id               one study answer: question, rubric checklist,
 *                             answer text, points, notes → Save & next
 *   #/grade-practice          practice queue (answers from the Aug-Sep 2026 pilot)
 *   #/grade-practice/:id      one practice answer, same screen; after saving,
 *                             the other graders' practice points for it
 *
 * Graders sign in with the same Supabase Auth account system as admins but
 * hold role 'grader' in admin_roles. Everything they see comes from the
 * SECURITY DEFINER functions grading_queue() / practice_queue(): answer text
 * + prompt identity only. No participant code, arm, site, timing, or
 * automated score is ever loaded on these pages. Study grades live in
 * human_grades and practice grades in practice_grades, each under the
 * grader's own user id (RLS: own rows only), so practice never reaches the
 * study's grades, assignment, adjudication or exports. Every page carries a
 * banner saying which area it is.
 *
 * Order (Kevin, 22 Oct 2026): graders go question by question: every answer
 * to Case 1 question 1, then Case 1 question 2, and so on through Case 3.
 * Within a question the answers keep the grader's own shuffled order, so PRE
 * and POST answers stay mixed and nobody sees them in enrollment order.
 * Study grading also asks for a deliberate "Start study grading" click once
 * per browser session, and again after any visit to the practice area, so
 * nobody grades real answers while meaning to practise.
 */
const Grading = {
    _mode: 'real',
    _cache: {},          // mode -> { items, order, mine }
    _items: null,        // [{response_id, case_id, assessment_id, prompt_id, response_text, sort_key}]
    _mine: null,         // Map response_id -> grade row
    _order: null,        // response ids in display order
    _caseDefs: {},

    // The study battery in the order residents see it (same as
    // AssessmentData's CASE_IDS: Case 1, 2, 3), then the two pilot-only cases
    // that appear in the practice area.
    CASE_ORDER: ['PAT005', 'PAT004', 'PAT007', 'PAT003', 'PAT006'],
    STUDY_CASES: 3,
    STUDY_OK_KEY: 'grading-study-confirmed',

    MODES: {
        real: {
            route: '/grade',
            title: 'Study grading',
            tab: 'Study grading',
            banner: '<b>STUDY GRADING</b> · Real study answers. Every grade you save here counts in the trial.',
        },
        practice: {
            route: '/grade-practice',
            title: 'Grading practice',
            tab: 'Practice (pilot answers)',
            banner: '<b>PRACTICE AREA</b> · Answers from the Aug–Sep 2026 pilot. Grades you save here are for practice only and are never used in the study.',
        },
    },

    _conf() { return this.MODES[this._mode] || this.MODES.real; },
    _href(id) { return '#' + this._conf().route + (id ? '/' + id : ''); },

    _setMode(mode) {
        this._mode = mode === 'practice' ? 'practice' : 'real';
        // A visit to the practice area means study grading asks again next time.
        if (this._mode === 'practice') this._setStudyConfirmed(false);
        const c = this._cache[this._mode];
        this._items = c ? c.items : null;
        this._order = c ? c.order : null;
        this._mine = c ? c.mine : null;
        try { document.title = this._conf().title + ' · Acting Intern'; } catch (e) { /* no document in tests */ }
    },

    // ── study-grading confirmation ────────────────────────────────────────
    _studyConfirmed() {
        try { return sessionStorage.getItem(this.STUDY_OK_KEY) === '1'; } catch (e) { return this._studyOkMem === true; }
    },
    _setStudyConfirmed(on) {
        this._studyOkMem = !!on;
        try { if (on) sessionStorage.setItem(this.STUDY_OK_KEY, '1'); else sessionStorage.removeItem(this.STUDY_OK_KEY); } catch (e) { /* storage blocked: memory only */ }
    },
    confirmStudy(responseId) {
        this._setStudyConfirmed(true);
        if (responseId) this.renderItem(responseId, 'real');
        else this.renderQueue('real');
    },
    _studyConfirmScreen(responseId) {
        const arg = responseId ? `'${String(responseId).replace(/[^A-Za-z0-9-]/g, '')}'` : '';
        return `
            <div class="grading-confirm" role="alertdialog" aria-labelledby="grading-confirm-title">
                <h1 id="grading-confirm-title">You are about to grade real study answers</h1>
                <p>Every grade you save here counts in the trial. These are answers from residents taking part in the study, and your scores go on to adjudication.</p>
                <p>If you meant to practise, use the practice area instead. It has the same screens, with answers from the pilot, and nothing there is used in the study.</p>
                <div class="grading-actions">
                    <button class="btn btn-primary grading-confirm-go" onclick="Grading.confirmStudy(${arg})">Start study grading</button>
                    <a class="btn grading-switch" href="#/grade-practice">Go to the practice area instead</a>
                </div>
                <p class="grading-confirm-small">You will be asked again whenever you come back from the practice area.</p>
            </div>`;
    },

    // ── order: question by question ───────────────────────────────────────
    /** Where an item sits: case rank, case number (1-3 for study cases) and question index in its case. */
    _position(item) {
        const ci = this.CASE_ORDER.indexOf(item.case_id);
        const def = this._caseDefs[item.case_id];
        const ids = [];
        if (def) for (const ap of def.assessments || []) for (const p of ap.prompts || []) ids.push(p.id);
        return {
            caseRank: ci >= 0 ? ci : this.CASE_ORDER.length,
            caseNo: ci >= 0 && ci < this.STUDY_CASES ? ci + 1 : null,
            q: ids.indexOf(item.prompt_id),
            total: ids.length,
        };
    },

    /** Case 1 question 1 first, then question 2, and so on; within a question, the grader's shuffled order (sort_key). */
    _sortByQuestion(items) {
        const pos = new Map(items.map((i) => [i.response_id, this._position(i)]));
        const qn = (p) => (p.q < 0 ? 9999 : p.q);
        return items.slice().sort((a, b) => {
            const pa = pos.get(a.response_id), pb = pos.get(b.response_id);
            return (pa.caseRank - pb.caseRank)
                || String(a.case_id).localeCompare(String(b.case_id))
                || (qn(pa) - qn(pb))
                || String(a.prompt_id).localeCompare(String(b.prompt_id), undefined, { numeric: true })
                || String(a.sort_key).localeCompare(String(b.sort_key));
        });
    },

    _caseLabel(caseId) {
        const ci = this.CASE_ORDER.indexOf(caseId);
        return ci >= 0 && ci < this.STUDY_CASES ? `Case ${ci + 1}` : `Pilot case ${caseId}`;
    },

    /** The queue as questions, in grading order: [{key, case_id, prompt_id, label, ids, done}]. */
    _groups() {
        const groups = []; const byKey = new Map();
        for (const id of this._order || []) {
            const it = this._items.find((x) => x.response_id === id);
            if (!it) continue;
            const key = it.case_id + '|' + it.prompt_id;
            let g = byKey.get(key);
            if (!g) {
                const p = this._position(it);
                g = { key, case_id: it.case_id, prompt_id: it.prompt_id, caseLabel: this._caseLabel(it.case_id),
                      qLabel: p.q >= 0 ? `Question ${p.q + 1}${p.total ? ' of ' + p.total : ''}` : `Question ${it.prompt_id}`,
                      ids: [], done: 0 };
                byKey.set(key, g); groups.push(g);
            }
            g.ids.push(id);
            const gr = this._mine && this._mine.get(id);
            if (gr && gr.status === 'submitted') g.done++;
        }
        return groups;
    },

    // ── data ──────────────────────────────────────────────────────────────
    async _sb() {
        return AdminDashboard._adminClient();
    },

    /** practice_queue() rows → the item shape the screens use. */
    _practiceItems(rows) {
        return (rows || []).map((r) => ({ response_id: r.item_id, case_id: r.case_id, assessment_id: null, prompt_id: r.prompt_id, response_text: r.response_text, sort_key: r.case_id + '|' + r.sort_key }));
    },

    async _load(force) {
        if (this._items && !force) return;
        const sb = await this._sb();
        let items, grades;
        if (this._mode === 'practice') {
            const [q, g] = await Promise.all([sb.rpc('practice_queue'), sb.from('practice_grades').select('*')]);
            if (q.error) throw new Error(q.error.message);
            if (g.error) throw new Error(g.error.message);
            items = this._practiceItems(q.data);
            grades = (g.data || []).map((r) => ({ ...r, response_id: r.item_id, status: 'submitted' }));
        } else {
            // Hand out any newly completed attempts before reading the queue
            // (balanced across the current roster; existing assignments are kept).
            try { await sb.rpc('assign_pending_grading'); } catch (e) { /* pre-010 database */ }
            const [q, g] = await Promise.all([sb.rpc('grading_queue'), sb.from('human_grades').select('*')]);
            if (q.error) throw new Error(q.error.message);
            if (g.error) throw new Error(g.error.message);
            items = q.data || [];
            grades = g.data || [];
        }
        // Case definitions first: they give each question's place in its case.
        const cases = [...new Set(items.map((i) => i.case_id))];
        await Promise.all(cases.map(async (c) => {
            if (this._caseDefs[c]) return;
            try { this._caseDefs[c] = await AssessmentData.loadCase(c); } catch (e) { /* sorts by question id instead */ }
        }));
        this._items = this._sortByQuestion(items);
        this._order = this._items.map((i) => i.response_id);
        this._mine = new Map(grades.map((r) => [r.response_id, r]));
        this._cache[this._mode] = { items: this._items, order: this._order, mine: this._mine };
    },

    _prompt(item) {
        const def = this._caseDefs[item.case_id];
        if (!def) return null;
        for (const ap of def.assessments || []) {
            const p = (ap.prompts || []).find((x) => x.id === item.prompt_id);
            if (p) return { prompt: p, ap };
        }
        return null;
    },

    /**
     * Turn free-text rubric into a checklist. Bullet/numbered lines become
     * items; a trailing ": N", "(N points)", "— N pt" sets the points, else 1.
     * Non-bullet lines are shown as guidance above the checklist. Total points
     * are still editable by the grader, because several rubrics cap totals or
     * use branches the parser cannot model.
     */
    parseRubric(text) {
        const items = []; const notes = [];
        for (const raw of String(text || '').split(/\r?\n/)) {
            const line = raw.trim();
            if (!line) continue;
            const m = line.match(/^(?:[-•*·]|\d+[.)]|[a-z][.)])\s+(.*)$/i);
            if (!m) { notes.push(line); continue; }
            let label = m[1].trim(); let pts = 1;
            const pm = label.match(/(?::\s*|\(|—|-|–)\s*(-?\d+(?:\.\d+)?)\s*(?:pts?|points?)?\)?\s*$/i);
            if (pm) { pts = parseFloat(pm[1]); label = label.slice(0, pm.index).replace(/[\s:(—–-]+$/, '').trim(); }
            items.push({ label, points: pts });
        }
        return { items, notes };
    },

    // ── gate ──────────────────────────────────────────────────────────────
    async _gate(root) {
        if (!AdminDashboard._adminClient()) { AdminDashboard._renderNoClient(root); return false; }
        await AdminDashboard._ensureAuth();
        if (!AdminDashboard._session) { AdminDashboard._renderLogin(root, { title: 'Grader sign-in', note: 'For the study\'s faculty graders. Sign in with the account the study team created for you.' }); return false; }
        const v = await AdminDashboard._verifyAdmin();
        if (!v.ok || !(v.role === 'grader' || v.role === 'admin')) { AdminDashboard._renderDenied(root, v.ok ? { reason: 'wrong_role', role: v.role } : v); return false; }
        return true;
    },

    /**
     * 'admin', 'study' or 'practice' for the signed-in account (migration 020),
     * or null if the database cannot say. Practice accounts (notes "TEST…")
     * use the practice area only; the database refuses them study answers.
     */
    async _kind() {
        const uid = AdminDashboard._session && AdminDashboard._session.user && AdminDashboard._session.user.id;
        if (this._kindFor === uid && this._kindValue !== undefined) return this._kindValue;
        let kind = null;
        try { const { data, error } = await (await this._sb()).rpc('grader_kind'); if (!error) kind = data || null; } catch (e) { kind = null; }
        this._kindFor = uid; this._kindValue = kind;
        return kind;
    },

    _practiceAccountNotice() {
        return `
            <div class="admin-header"><h1>Study grading</h1></div>
            <div class="grading-intro">
                <p><b>This is a practice account, so study grading is closed to it.</b> Study answers are graded only by the study's graders.
                The practice area has the same screens, with answers from the pilot, and you can practise there as much as you like.</p>
            </div>
            <div class="grading-actions"><a class="btn btn-primary" href="#/grade-practice">Open the practice area (pilot answers) →</a></div>`;
    },

    _topbar() {
        const email = (AdminDashboard._session && AdminDashboard._session.user && AdminDashboard._session.user.email) || '';
        const done = this._items ? this._items.filter((i) => { const g = this._mine.get(i.response_id); return g && g.status === 'submitted'; }).length : 0;
        const total = this._items ? this._items.length : 0;
        const practice = this._mode === 'practice';
        return `
            <div class="admin-topbar">
                <nav class="admin-tabs">
                    <a href="#/grade" class="admin-tab${practice ? '' : ' active'}"><i data-lucide="check-square"></i><span>${this.MODES.real.tab}</span></a>
                    <a href="#/grade-practice" class="admin-tab grading-tab-practice${practice ? ' active' : ''}"><i data-lucide="graduation-cap"></i><span>${this.MODES.practice.tab}</span></a>
                    ${AdminDashboard._adminRole === 'admin' ? `<a href="#/admin/grading" class="admin-tab"><i data-lucide="scale"></i><span>Adjudication</span></a>` : ''}
                </nav>
                <div class="admin-session">
                    ${this._items ? `<span class="grading-progress"><b>${done}</b> of ${total} ${practice ? 'practised' : 'graded'}</span>` : ''}
                    <span class="admin-session-email">${AdminDashboard._escape(email)}</span>
                    <button class="btn btn-sm" onclick="AdminDashboard.changePassword()">Change password</button>
                </div>
            </div>
            <div class="grading-mode grading-mode-${this._mode}" role="note">${this._conf().banner}</div>`;
    },

    // ── views ─────────────────────────────────────────────────────────────
    async renderQueue(mode) {
        const root = document.getElementById('main-content');
        if (!root) return;
        this._setMode(mode);
        root.innerHTML = `<div class="admin-page"><div class="loading">Loading…</div></div>`;
        if (!(await this._gate(root))) return;
        const practice = this._mode === 'practice';
        if (!practice && (await this._kind()) === 'practice') {
            this._items = []; this._mine = new Map(); this._order = [];
            root.innerHTML = `<div class="admin-page">${this._topbar()}${this._practiceAccountNotice()}</div>`;
            App.refreshIcons();
            return;
        }
        if (!practice && !this._studyConfirmed()) {
            root.innerHTML = `<div class="admin-page grading-is-real">${this._topbar()}${this._studyConfirmScreen(null)}</div>`;
            App.refreshIcons();
            return;
        }
        try { await this._load(true); } catch (err) { root.innerHTML = `<div class="admin-page"><div class="empty-state-text">Could not load the ${practice ? 'practice' : 'grading'} queue: ${AdminDashboard._escape(err.message)}</div></div>`; return; }

        const E = (s) => AdminDashboard._escape(String(s == null ? '' : s));
        const isDone = (id) => { const g = this._mine.get(id); return !!(g && g.status === 'submitted'); };
        const next = this._order.find((id) => !isDone(id));
        const groups = this._groups();
        const nextGroup = next ? groups.find((g) => g.ids.includes(next)) : null;
        const intro = practice
            ? `<p>These are answers that residents wrote while testing the cases in August and September 2026, before the trial began. They come one question at a time, as in study grading. Grade them exactly as you would study answers: tick the criteria the answer earns, adjust the points if the rubric caps or branches, and save.</p>
               <p class="grading-blind">Practice grades are kept apart from the study and never used in it. After you save an item, you see how the other graders scored it in practice, so you can compare your reading of the rubric.</p>`
            : `<p>Answers come one question at a time: every answer to Case 1, question 1, then question 2, and so on through Case 3. Each item shows one participant's answer with the rubric as a checklist. Tick the criteria the answer earns, adjust the points if the rubric caps or branches, add a note if useful, and save. You can return to any item later.</p>
               <p class="grading-blind">You are blind to who wrote each answer, which arm they are in, and how anyone else scored it. Every answer is scored by two graders. Your ${this._items.length} items are below; within each question they come in a shuffled order unique to you.</p>`;
        root.innerHTML = `
            <div class="admin-page${practice ? ' grading-is-practice' : ' grading-is-real'}">
                ${this._topbar()}
                <div class="admin-header"><h1>${practice ? 'Practice queue' : 'Grading queue'}</h1></div>
                <div class="grading-intro">${intro}</div>
                <div class="grading-actions">
                    ${next ? `<a class="btn btn-primary" href="${this._href(next)}">${practice ? 'Practise next item' : 'Grade next answer'} (${E(nextGroup.caseLabel)}, ${E(nextGroup.qLabel.toLowerCase())})</a>` : `<span class="grading-done">${practice ? 'You have practised every item.' : 'All items graded — thank you.'}</span>`}
                    ${practice
                        ? '<a class="btn grading-switch" href="#/grade">Go to study grading (real answers) →</a>'
                        : '<a class="btn grading-switch" href="#/grade-practice">Open the practice area (pilot answers) →</a>'}
                </div>
                <table class="admin-table grading-case-table grading-q-table">
                    <thead><tr><th>Question</th><th>${practice ? 'Practised' : 'Graded'}</th><th></th></tr></thead>
                    <tbody>
                    ${groups.map((g, i) => `${i === 0 || groups[i - 1].case_id !== g.case_id ? `<tr class="grading-q-case"><td colspan="3">${E(g.caseLabel)}</td></tr>` : ''}<tr${nextGroup && g.key === nextGroup.key ? ' class="is-current"' : ''}><td><a href="${this._href(g.ids.find((id) => !isDone(id)) || g.ids[0])}">${E(g.qLabel)}</a> <span class="pill">${E(g.prompt_id)}</span></td><td>${g.done} / ${g.ids.length}</td><td><div class="admin-bar"><div class="admin-bar-fill" style="width:${g.ids.length ? Math.round(100 * g.done / g.ids.length) : 0}%"></div></div></td></tr>`).join('')}
                    </tbody>
                </table>
                <details class="grading-list"><summary>All items (${this._items.length})</summary>
                    <ol>${this._order.map((id, i) => { const g = this._mine.get(id); const grp = groups.find((x) => x.ids.includes(id)); return `<li><a href="${this._href(id)}">${practice ? 'Practice item' : 'Item'} ${i + 1}</a> · ${E(grp ? grp.caseLabel + ', ' + grp.qLabel.split(' of ')[0].toLowerCase() : '')} · ${g ? (g.status === 'submitted' ? `<b>${g.points}</b> / ${g.max_points}` : 'draft') : '—'}</li>`; }).join('')}</ol>
                </details>
            </div>`;
        App.refreshIcons();
    },

    async renderItem(responseId, mode) {
        const root = document.getElementById('main-content');
        if (!root) return;
        this._setMode(mode);
        root.innerHTML = `<div class="admin-page"><div class="loading">Loading…</div></div>`;
        if (!(await this._gate(root))) return;
        if (this._mode === 'real' && (await this._kind()) === 'practice') {
            this._items = []; this._mine = new Map(); this._order = [];
            root.innerHTML = `<div class="admin-page">${this._topbar()}${this._practiceAccountNotice()}</div>`;
            App.refreshIcons();
            return;
        }
        if (this._mode === 'real' && !this._studyConfirmed()) {
            root.innerHTML = `<div class="admin-page grading-is-real">${this._topbar()}${this._studyConfirmScreen(responseId)}</div>`;
            App.refreshIcons();
            return;
        }
        try { await this._load(); } catch (err) { root.innerHTML = `<div class="admin-page"><div class="empty-state-text">${AdminDashboard._escape(err.message)}</div></div>`; return; }
        const practice = this._mode === 'practice';
        const item = this._items.find((x) => x.response_id === responseId);
        if (!item) { root.innerHTML = `<div class="admin-page">${this._topbar()}<div class="empty-state-text">Item not found. <a href="${this._href()}">Back to the queue</a></div></div>`; App.refreshIcons(); return; }
        const found = this._prompt(item);
        const prompt = found ? found.prompt : null;
        const sr = (prompt && prompt.scoringRubric) || {};
        const parsed = this.parseRubric(sr.rubricText);
        const existing = this._mine.get(responseId);
        const checked = new Set(((existing && existing.criteria) || []).filter((c) => c.checked).map((c) => c.label));
        const idx = this._order.indexOf(responseId);
        const prevId = idx > 0 ? this._order[idx - 1] : null;
        const nextId = idx >= 0 && idx < this._order.length - 1 ? this._order[idx + 1] : null;
        const maxPts = sr.maxPoints != null ? sr.maxPoints : '';
        const E = (s) => AdminDashboard._escape(String(s == null ? '' : s));
        const groups = this._groups();
        const grp = groups.find((g) => g.ids.includes(responseId));
        const k = grp ? grp.ids.indexOf(responseId) + 1 : 1;
        const nextGrp = nextId ? groups.find((g) => g.ids.includes(nextId)) : null;
        const newQuestionNext = !!(nextGrp && grp && nextGrp.key !== grp.key);

        root.innerHTML = `
            <div class="admin-page grading-page${practice ? ' grading-is-practice' : ' grading-is-real'}">
                ${this._topbar()}
                <div class="grading-item-head">
                    <div>
                        <div class="grading-item-title">${E(grp ? grp.caseLabel : item.case_id)} · ${E(grp ? grp.qLabel : item.prompt_id)} <span class="grading-item-sub">answer ${k} of ${grp ? grp.ids.length : 1}</span> <span class="pill">${E(item.prompt_id)}</span> ${prompt && prompt.type ? `<span class="pill">${E(prompt.type)}</span>` : ''}${k === 1 ? ' <span class="pill grading-newq">New question</span>' : ''}</div>
                        <div class="grading-item-overall">${practice ? 'Practice item' : 'Item'} ${idx + 1} of ${this._order.length} overall</div>
                    </div>
                    <div class="grading-item-nav">${prevId ? `<a class="btn btn-sm" href="${this._href(prevId)}">← Previous</a>` : ''} <a class="btn btn-sm" href="${this._href()}">Queue</a> ${nextId ? `<a class="btn btn-sm" href="${this._href(nextId)}">Next →</a>` : ''}</div>
                </div>
                <div class="grading-cols">
                    <div class="grading-col">
                        <h3>Question</h3>
                        <p class="grading-question">${E(prompt ? prompt.question : '(question text unavailable)')}</p>
                        <h3>${practice ? 'Pilot answer' : 'Participant\'s answer'}</h3>
                        <div class="grading-answer">${E(item.response_text || '(blank)')}</div>
                    </div>
                    <div class="grading-col">
                        <h3>Rubric <span class="grading-max">max ${E(maxPts)} points</span></h3>
                        ${parsed.notes.length ? `<div class="grading-rubric-notes">${parsed.notes.map((n) => `<div>${E(n)}</div>`).join('')}</div>` : ''}
                        <div class="grading-checklist" id="grading-checklist">
                            ${parsed.items.map((c, i) => `<label class="grading-crit"><input type="checkbox" data-i="${i}" data-pts="${c.points}" ${checked.has(c.label) ? 'checked' : ''} onchange="Grading._recalc()"><span class="grading-crit-pts">${c.points}</span><span>${E(c.label)}</span></label>`).join('')}
                            ${parsed.items.length ? '' : '<div class="grading-rubric-notes">No itemised criteria could be parsed; score against the rubric text above.</div>'}
                        </div>
                        <div class="grading-score-row">
                            <label>Points awarded <input type="number" id="grading-points" step="0.5" min="0" max="${E(maxPts)}" value="${existing && existing.points != null ? existing.points : ''}"></label>
                            <span class="grading-max">of ${E(maxPts)}</span>
                            <span class="grading-hint" id="grading-sumhint"></span>
                        </div>
                        <label class="grading-notes-label">Notes (optional)<textarea id="grading-notes" rows="3" placeholder="${practice ? 'Anything you want to remember about this one' : 'Anything the adjudicator should know'}">${E(existing ? existing.notes || '' : '')}</textarea></label>
                        <div class="grading-save-row">
                            ${practice
                                ? `<button class="btn btn-primary" onclick="Grading.save('${responseId}', null)">Save practice grade and compare</button>
                                   ${existing && nextId ? `<a class="btn" href="${this._href(nextId)}">${newQuestionNext ? 'Next practice question →' : 'Next practice item →'}</a>` : ''}`
                                : `<button class="btn btn-primary" onclick="Grading.save('${responseId}', ${nextId ? `'${nextId}'` : 'null'})">${newQuestionNext ? 'Save study grade &amp; start the next question' : (nextId ? 'Save study grade &amp; next' : 'Save study grade')}</button>
                                   ${nextId ? `<button class="btn" onclick="Grading.save('${responseId}', null)">Save study grade</button>` : ''}`}
                            <span id="grading-status" class="grading-status">${existing ? (existing.status === 'submitted' ? 'Saved' : 'Draft') : ''}</span>
                        </div>
                        ${practice && existing ? '<div class="grading-others" id="grading-others">Loading the other graders\' practice scores…</div>' : ''}
                    </div>
                </div>
            </div>`;
        this._currentMax = maxPts === '' ? null : Number(maxPts);
        this._currentItems = parsed.items;
        this._recalc(!existing || existing.points == null);
        App.refreshIcons();
        if (practice && existing) this._showOthers(responseId);
    },

    /** Practice only: the other graders' points for this item (shown once you have saved yours). */
    async _showOthers(itemId) {
        const box = document.getElementById('grading-others');
        if (!box) return;
        try {
            const sb = await this._sb();
            const { data, error } = await sb.rpc('practice_others', { p_item: itemId });
            if (error) throw new Error(error.message);
            const rows = data || [];
            box.innerHTML = rows.length
                ? `<b>Other graders' practice scores:</b> ${rows.map((r) => `${Number(r.points)} / ${Number(r.max_points)}`).join(' · ')}`
                : 'No other grader has scored this practice item yet.';
        } catch (err) {
            box.textContent = 'Could not load the other graders\' practice scores (' + err.message + ').';
        }
    },

    /** Sum the ticked criteria; fill the points box if it is empty or was auto-filled. */
    _recalc(force) {
        const boxes = [...document.querySelectorAll('#grading-checklist input[type=checkbox]')];
        const sum = boxes.filter((b) => b.checked).reduce((s, b) => s + Number(b.dataset.pts || 0), 0);
        const capped = this._currentMax != null ? Math.min(sum, this._currentMax) : sum;
        const inp = document.getElementById('grading-points');
        const hint = document.getElementById('grading-sumhint');
        if (!inp) return;
        if (force || inp.dataset.auto === '1' || inp.value === '') { inp.value = capped; inp.dataset.auto = '1'; }
        inp.oninput = () => { inp.dataset.auto = '0'; };
        if (hint) hint.textContent = boxes.length ? `ticked criteria sum to ${sum}${this._currentMax != null && sum > this._currentMax ? `, capped at ${this._currentMax}` : ''}` : '';
    },

    async save(responseId, nextId) {
        const sb = await this._sb();
        const uid = AdminDashboard._session.user.id;
        const practice = this._mode === 'practice';
        const boxes = [...document.querySelectorAll('#grading-checklist input[type=checkbox]')];
        const criteria = boxes.map((b) => ({ label: this._currentItems[Number(b.dataset.i)].label, points: Number(b.dataset.pts), checked: b.checked }));
        const pts = document.getElementById('grading-points').value;
        const notes = document.getElementById('grading-notes').value;
        const status = document.getElementById('grading-status');
        if (pts === '') { status.textContent = 'Enter the points awarded before saving.'; return; }
        status.textContent = 'Saving…';
        let data, error;
        if (practice) {
            const row = { item_id: responseId, grader_id: uid, criteria, points: Number(pts), max_points: this._currentMax, notes, updated_at: new Date().toISOString() };
            ({ data, error } = await sb.from('practice_grades').upsert(row, { onConflict: 'item_id,grader_id' }).select().single());
            if (data) data = { ...data, response_id: data.item_id, status: 'submitted' };
        } else {
            const row = { response_id: responseId, grader_id: uid, criteria, points: Number(pts), max_points: this._currentMax, notes, status: 'submitted', updated_at: new Date().toISOString() };
            ({ data, error } = await sb.from('human_grades').upsert(row, { onConflict: 'response_id,grader_id' }).select().single());
        }
        if (error) { status.textContent = 'Save failed: ' + error.message; return; }
        this._mine.set(responseId, data);
        status.textContent = 'Saved';
        // Practice stays on the item after saving, so the other graders' scores can be compared.
        if (nextId && !practice) router.navigate(this._conf().route + '/' + nextId);
        else this.renderItem(responseId, this._mode);
    },
};
window.Grading = Grading;
