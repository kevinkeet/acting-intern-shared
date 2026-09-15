/**
 * Grading — blinded human grading of study answers (migration 008).
 *
 *   #/grade          queue: progress + next ungraded item
 *   #/grade/:id      one answer: question, rubric checklist, answer text,
 *                    points, notes → Save & next
 *
 * Graders sign in with the same Supabase Auth account system as admins but
 * hold role 'grader' in admin_roles. Everything they see comes from the
 * SECURITY DEFINER function grading_queue(): answer text + prompt identity
 * only. No participant code, arm, site, timing, or automated score is ever
 * loaded on this page. Each grader's checks/points/notes live in
 * human_grades under their own user id (RLS: own rows only).
 */
const Grading = {
    _items: null,        // [{response_id, case_id, assessment_id, prompt_id, response_text, sort_key}]
    _mine: null,         // Map response_id -> human_grades row
    _order: null,        // response ids in this grader's shuffled order
    _caseDefs: {},

    // ── data ──────────────────────────────────────────────────────────────
    async _sb() {
        return AdminDashboard._adminClient();
    },

    async _load(force) {
        if (this._items && !force) return;
        const sb = await this._sb();
        const [q, g] = await Promise.all([
            sb.rpc('grading_queue'),
            sb.from('human_grades').select('*'),
        ]);
        if (q.error) throw new Error(q.error.message);
        if (g.error) throw new Error(g.error.message);
        this._items = (q.data || []).slice().sort((a, b) => a.sort_key.localeCompare(b.sort_key));
        this._order = this._items.map((i) => i.response_id);
        this._mine = new Map((g.data || []).map((r) => [r.response_id, r]));
        const cases = [...new Set(this._items.map((i) => i.case_id))];
        await Promise.all(cases.map(async (c) => {
            if (!this._caseDefs[c]) this._caseDefs[c] = await AssessmentData.loadCase(c);
        }));
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

    _topbar() {
        const email = (AdminDashboard._session && AdminDashboard._session.user && AdminDashboard._session.user.email) || '';
        const done = this._items ? this._items.filter((i) => { const g = this._mine.get(i.response_id); return g && g.status === 'submitted'; }).length : 0;
        const total = this._items ? this._items.length : 0;
        return `
            <div class="admin-topbar">
                <nav class="admin-tabs">
                    <a href="#/grade" class="admin-tab active"><i data-lucide="check-square"></i><span>Grading</span></a>
                    ${AdminDashboard._adminRole === 'admin' ? `<a href="#/admin/grading" class="admin-tab"><i data-lucide="scale"></i><span>Adjudication</span></a>` : ''}
                </nav>
                <div class="admin-session">
                    <span class="grading-progress"><b>${done}</b> of ${total} graded</span>
                    <span class="admin-session-email">${AdminDashboard._escape(email)}</span>
                    <button class="btn btn-sm" onclick="AdminDashboard.changePassword()">Change password</button>
                </div>
            </div>`;
    },

    // ── views ─────────────────────────────────────────────────────────────
    async renderQueue() {
        const root = document.getElementById('main-content');
        if (!root) return;
        root.innerHTML = `<div class="admin-page"><div class="loading">Loading…</div></div>`;
        if (!(await this._gate(root))) return;
        try { await this._load(true); } catch (err) { root.innerHTML = `<div class="admin-page"><div class="empty-state-text">Could not load the grading queue: ${AdminDashboard._escape(err.message)}</div></div>`; return; }

        const next = this._order.find((id) => { const g = this._mine.get(id); return !g || g.status !== 'submitted'; });
        const byCase = {};
        for (const it of this._items) {
            const k = it.case_id; byCase[k] = byCase[k] || { total: 0, done: 0 };
            byCase[k].total++;
            const g = this._mine.get(it.response_id); if (g && g.status === 'submitted') byCase[k].done++;
        }
        root.innerHTML = `
            <div class="admin-page">
                ${this._topbar()}
                <div class="admin-header"><h1>Grading queue</h1></div>
                <div class="grading-intro">
                    <p>Each item shows one participant's answer to one question, with the rubric as a checklist. Tick the criteria the answer earns, adjust the points if the rubric caps or branches, add a note if useful, and save. You can return to any item later.</p>
                    <p class="grading-blind">You are blind to who wrote the answer, which arm they are in, and how anyone else scored it. Every answer is scored by two graders; the ${this._items.length} items below are your share, in a shuffled order unique to you, with each case's answers kept together.</p>
                </div>
                <div class="grading-actions">
                    ${next ? `<a class="btn btn-primary" href="#/grade/${next}">Grade next item</a>` : `<span class="grading-done">All items graded — thank you.</span>`}
                </div>
                <table class="admin-table grading-case-table">
                    <thead><tr><th>Case</th><th>Graded</th><th></th></tr></thead>
                    <tbody>
                    ${Object.keys(byCase).sort().map((c) => `<tr><td>${AdminDashboard._escape(c)}</td><td>${byCase[c].done} / ${byCase[c].total}</td><td><div class="admin-bar"><div class="admin-bar-fill" style="width:${byCase[c].total ? Math.round(100 * byCase[c].done / byCase[c].total) : 0}%"></div></div></td></tr>`).join('')}
                    </tbody>
                </table>
                <details class="grading-list"><summary>All items (${this._items.length})</summary>
                    <ol>${this._order.map((id, i) => { const g = this._mine.get(id); const it = this._items.find((x) => x.response_id === id); return `<li><a href="#/grade/${id}">Item ${i + 1}</a> · ${AdminDashboard._escape(it.case_id)} ${AdminDashboard._escape(it.prompt_id)} · ${g ? (g.status === 'submitted' ? `<b>${g.points}</b> / ${g.max_points}` : 'draft') : '—'}</li>`; }).join('')}</ol>
                </details>
            </div>`;
        App.refreshIcons();
    },

    async renderItem(responseId) {
        const root = document.getElementById('main-content');
        if (!root) return;
        root.innerHTML = `<div class="admin-page"><div class="loading">Loading…</div></div>`;
        if (!(await this._gate(root))) return;
        try { await this._load(); } catch (err) { root.innerHTML = `<div class="admin-page"><div class="empty-state-text">${AdminDashboard._escape(err.message)}</div></div>`; return; }
        const item = this._items.find((x) => x.response_id === responseId);
        if (!item) { root.innerHTML = `<div class="admin-page">${this._topbar()}<div class="empty-state-text">Item not found. <a href="#/grade">Back to the queue</a></div></div>`; App.refreshIcons(); return; }
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

        root.innerHTML = `
            <div class="admin-page grading-page">
                ${this._topbar()}
                <div class="grading-item-head">
                    <div class="grading-item-title">Item ${idx + 1} of ${this._order.length} <span class="pill">${E(item.case_id)} · ${E(item.prompt_id)}</span> ${prompt && prompt.type ? `<span class="pill">${E(prompt.type)}</span>` : ''}</div>
                    <div class="grading-item-nav">${prevId ? `<a class="btn btn-sm" href="#/grade/${prevId}">← Previous</a>` : ''} <a class="btn btn-sm" href="#/grade">Queue</a> ${nextId ? `<a class="btn btn-sm" href="#/grade/${nextId}">Next →</a>` : ''}</div>
                </div>
                <div class="grading-cols">
                    <div class="grading-col">
                        <h3>Question</h3>
                        <p class="grading-question">${E(prompt ? prompt.question : '(question text unavailable)')}</p>
                        <h3>Participant's answer</h3>
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
                        <label class="grading-notes-label">Notes (optional)<textarea id="grading-notes" rows="3" placeholder="Anything the adjudicator should know">${E(existing ? existing.notes || '' : '')}</textarea></label>
                        <div class="grading-save-row">
                            <button class="btn btn-primary" onclick="Grading.save('${responseId}', ${nextId ? `'${nextId}'` : 'null'})">Save &amp; next</button>
                            <button class="btn" onclick="Grading.save('${responseId}', null)">Save</button>
                            <span id="grading-status" class="grading-status">${existing ? (existing.status === 'submitted' ? 'Saved' : 'Draft') : ''}</span>
                        </div>
                    </div>
                </div>
            </div>`;
        this._currentMax = maxPts === '' ? null : Number(maxPts);
        this._currentItems = parsed.items;
        this._recalc(!existing || existing.points == null);
        App.refreshIcons();
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
        const boxes = [...document.querySelectorAll('#grading-checklist input[type=checkbox]')];
        const criteria = boxes.map((b) => ({ label: this._currentItems[Number(b.dataset.i)].label, points: Number(b.dataset.pts), checked: b.checked }));
        const pts = document.getElementById('grading-points').value;
        const notes = document.getElementById('grading-notes').value;
        const status = document.getElementById('grading-status');
        if (pts === '') { status.textContent = 'Enter the points awarded before saving.'; return; }
        status.textContent = 'Saving…';
        const row = { response_id: responseId, grader_id: uid, criteria, points: Number(pts), max_points: this._currentMax, notes, status: 'submitted', updated_at: new Date().toISOString() };
        const { data, error } = await sb.from('human_grades').upsert(row, { onConflict: 'response_id,grader_id' }).select().single();
        if (error) { status.textContent = 'Save failed: ' + error.message; return; }
        this._mine.set(responseId, data);
        status.textContent = 'Saved';
        if (nextId) router.navigate('/grade/' + nextId);
        else this.renderItem(responseId);
    },
};
window.Grading = Grading;
