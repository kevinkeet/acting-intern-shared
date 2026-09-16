/**
 * AssessmentStart — landing page at #/assessment/start
 *
 * Lists available cases. If user is not signed in, prompts login first.
 * If there is an in_progress attempt, offers Resume.
 */

const AssessmentStart = {

    async render() {
        const root = document.getElementById('main-content');
        if (!root) return;

        // Consent happens on the REDCap enrollment page, not here. All this
        // page needs is the participant code, which the study link supplies
        // (?code=NNNN, stored by ModeManager). Only a resident who opened the
        // site without their link sees the code box. Admins/proctors skip it.
        const isAdmin = (typeof UserCode !== 'undefined' && UserCode.isAdmin && UserCode.isAdmin());
        const hasCode = (typeof UserCode !== 'undefined' && UserCode.get && !!UserCode.get());
        if (!hasCode && !isAdmin) {
            this._renderCodeEntry(root);
            return;
        }

        // No auth gate. The site-level password gate already controls access.
        // If Supabase happens to be signed in, attempts persist centrally; if
        // not, attempts run in-memory and results are viewable in this tab
        // session only.
        // Demo-door visitors see only Sandoval and can mistake her for the
        // study — several coded pilots did exactly that. Give them a one-click
        // path to the real study cases.
        const inDemo = (function () { try { return localStorage.getItem('entry-mode') === 'demo'; } catch (e) { return false; } })();
        const demoSwitchHtml = inDemo ? `
            <div class="demo-switch-banner">
                <strong>You're in the practice version.</strong> Maria Sandoval is a demo case — she is <em>not</em> one of the study cases.
                If you're here to pilot the study, switch over:
                <button class="btn btn-primary" id="demo-switch-study-btn">Go to the study cases</button>
            </div>` : '';

        root.innerHTML = `
            <div class="assessment-start-page">
                ${demoSwitchHtml}
                <div class="assessment-start-hero">
                    <h1>${inDemo ? 'Practice case' : 'Your cases'}</h1>
                    <p class="assessment-start-tagline">
                        Work through each case as you would in practice.
                    </p>
                    <div id="user-code-strip" class="user-code-strip"></div>
                </div>

                <div id="assessment-resume-slot"></div>

                <div class="assessment-start-cases">
                    <h2>Available cases</h2>
                    <div id="assessment-case-list" class="assessment-case-list">
                        <div class="loading">Loading cases…</div>
                    </div>
                </div>

                <div class="assessment-start-policy">
                    <h3>Good to know</h3>
                    <ul>
                        <li><strong>One case at a time.</strong> Each case is a self-contained exercise of about 10–20 minutes. Doing one case per sitting is completely fine — come back for the others whenever suits you.</li>
                        <li><strong>No time limits.</strong> Nothing counts down and nothing auto-submits. Take the time you need.</li>
                        <li><strong>Your work saves as you go.</strong> If you get interrupted or close the tab, opening your study link again brings you right back to where you stopped. Finish a case on the same device you started it on.</li>
                        <li><strong>The chart moves forward in time</strong> as the case progresses — a banner tells you whenever new information has arrived.</li>
                    </ul>
                </div>
            </div>
        `;
        const switchBtn = document.getElementById('demo-switch-study-btn');
        if (switchBtn) switchBtn.addEventListener('click', () => {
            try {
                localStorage.setItem('entry-mode', 'pilot');
                localStorage.removeItem('demo-mode');
                localStorage.removeItem('all-modes-unlocked');
                localStorage.setItem('app-mode', 'assessment');
            } catch (e) { /* proceed anyway */ }
            // location.replace with the bare pathname drops any ?demo flag —
            // crucial, because URL flags re-record entry-mode at script parse
            // and would immediately undo the switch. No explicit reload():
            // removing the query string forces a full navigation by itself,
            // and racing a reload() re-applies the old URL first.
            location.replace(location.pathname + '#/assessment/start');
        });

        App.refreshIcons();
        this._renderUserCodeStrip();

        // In parallel: check resume + load case list + this code's completions
        const [resume, cases, doneCaseIds] = await Promise.all([
            AssessmentEngine.getAttemptIdForResume(),
            this._loadCaseList(),
            this._loadMyCompletions(),
        ]);
        this._renderResume(resume);
        this._renderHowItWorks();
        this._renderCaseList(cases, doneCaseIds);
    },

    /**
     * Participant-code entry. Only shown when no code is stored — i.e. the
     * resident opened the site without the link from their study email.
     * Consent itself was recorded on the REDCap enrollment page.
     */
    _renderCodeEntry(root) {
        root.innerHTML = `
            <div class="assessment-consent-page">
                <div class="assessment-consent-card">
                    <div class="assessment-consent-brand">Acting Intern — TEACH-AI study</div>
                    <h1>Enter your participant code</h1>
                    <div class="assessment-consent-body">
                        <p>Your participant code is the four-digit number in your study email. <strong>The link in that
                        email fills it in for you</strong>, so the easiest fix is to open that link again. If you
                        can't find the email, ask your study coordinator.</p>
                    </div>
                    <form id="assessment-consent-form" autocomplete="off">
                        <label class="assessment-consent-code-label" for="assessment-access-code">Participant code</label>
                        <input type="text" id="assessment-access-code" placeholder="e.g. 1042" inputmode="numeric"
                            spellcheck="false" autocapitalize="off" maxlength="32" autocomplete="off">
                        <div id="assessment-consent-error" class="assessment-consent-error" aria-live="polite"></div>
                        <button type="submit" id="assessment-consent-continue" class="btn btn-primary">
                            Continue
                        </button>
                    </form>
                </div>
            </div>
        `;
        if (typeof App !== 'undefined' && App.refreshIcons) App.refreshIcons();
        const codeInput = document.getElementById('assessment-access-code');
        if (codeInput) codeInput.focus();
        const form = document.getElementById('assessment-consent-form');
        if (form) {
            form.addEventListener('submit', (e) => {
                e.preventDefault();
                this._submitCode();
            });
        }
    },

    _submitCode() {
        const errEl = document.getElementById('assessment-consent-error');
        const codeInput = document.getElementById('assessment-access-code');
        const show = (m) => { if (errEl) errEl.textContent = m || ''; };
        try {
            UserCode.set((codeInput && codeInput.value) || '');
        } catch (err) {
            show('Please enter the code from your study email (letters and digits only).');
            if (codeInput) { codeInput.focus(); codeInput.select(); }
            return;
        }
        this.render();
    },

    _renderAuthGate(root) {
        root.innerHTML = `
            <div class="assessment-start-page">
                <div class="assessment-start-hero">
                    <h1>Assessment Mode</h1>
                    <p class="assessment-start-tagline">Sign in to take an assessment. Your attempt will be linked to your account.</p>
                </div>
                <div class="assessment-auth-block" id="assessment-auth-block"></div>
            </div>
        `;
        if (typeof SupabaseSync !== 'undefined' && SupabaseSync.renderAuthUI) {
            SupabaseSync.renderAuthUI('assessment-auth-block');
        }
        // Re-render when auth state changes
        const onAuth = (e) => {
            const { user } = e.detail || {};
            if (user) {
                window.removeEventListener('supabase:auth-state-change', onAuth);
                this.render();
            }
        };
        window.addEventListener('supabase:auth-state-change', onAuth);
    },

    /**
     * Show the resident's chosen code at the top of the assessment-start
     * page. Lets them see who they're logged in as and switch identities
     * if needed. Hidden if no code is set (e.g. Supabase-authed admin).
     */
    _renderUserCodeStrip() {
        const slot = document.getElementById('user-code-strip');
        if (!slot || typeof UserCode === 'undefined') return;
        const code = UserCode.get();
        if (!code) {
            slot.innerHTML = '<span class="user-code-strip-empty">You will be asked to pick an identity code when you begin.</span>';
            return;
        }
        slot.innerHTML = `
            <span class="user-code-strip-label">Participant code</span>
            <strong class="user-code-badge">${this._escape(code)}</strong>
            <a href="#" id="user-code-change-link" class="user-code-change-link" title="Only if this is not the code from your study email">not your code?</a>
        `;
        const link = document.getElementById('user-code-change-link');
        if (link) {
            link.addEventListener('click', async (e) => {
                e.preventDefault();
                try {
                    await UserCode.prompt({
                        force: true,
                        reason: 'Enter the participant code from your study email. Only change this if the code shown was not yours.',
                    });
                    this._renderUserCodeStrip();
                } catch (err) {
                    /* user cancelled */
                }
            });
        }
    },

    /**
     * Case IDs this participant code has already completed — powers the
     * per-case checkmarks and the "X of N done" progress line, so a
     * returning pilot sees momentum instead of the same wall of cases.
     */
    async _loadMyCompletions() {
        try {
            const code = (typeof UserCode !== 'undefined') ? UserCode.get() : null;
            const sb = (typeof SupabaseSync !== 'undefined') ? SupabaseSync.getClient() : null;
            if (!code || !sb) return [];
            const { data, error } = await sb
                .from('test_attempts')
                .select('case_id,status')
                .eq('user_code', code)
                .eq('status', 'completed');
            if (error) return [];
            return [...new Set((data || []).map((a) => a.case_id))];
        } catch (e) { return []; }
    },

    async _loadCaseList() {
        const ids = AssessmentData.listCases().map((c) => c.caseId);
        const metas = await Promise.all(
            ids.map((id) =>
                AssessmentData.loadCaseMeta(id)
                    .then((m) => ({ ok: true, m, id }))
                    .catch((err) => ({ ok: false, id, err: err.message }))
            )
        );
        return metas;
    },

    /**
     * Compact 3-step "what to expect" strip above the case list, so the
     * resident knows the shape of the task before the first case opens.
     * The full spatial tour runs inside the runner (AssessmentOrientation).
     */
    _renderHowItWorks() {
        const root = document.getElementById('assessment-case-list');
        if (!root || document.getElementById('assessment-how-strip')) return;
        const strip = document.createElement('div');
        strip.id = 'assessment-how-strip';
        strip.className = 'assessment-how-strip';
        strip.innerHTML = `
            <div class="assessment-how-step"><span class="assessment-how-num">1</span>
                <div><strong>Review the chart</strong><br>Start with the first case. Read the patient's chart like a real EHR — notes, labs, imaging. The chart holds everything you need.</div></div>
            <div class="assessment-how-step"><span class="assessment-how-num">2</span>
                <div><strong>Answer in your own words</strong><br>Questions appear on the right. Free text, no length requirement, no time limit. You cannot return to a submitted answer.</div></div>
            <div class="assessment-how-step"><span class="assessment-how-num">3</span>
                <div><strong>AI assistant available</strong><br>An AI assistant sits below the answer box. Using it is optional and up to you — work the way you normally would.</div></div>
        `;
        root.parentElement.insertBefore(strip, root);
    },

    _renderCaseList(cases, doneCaseIds) {
        const container = document.getElementById('assessment-case-list');
        if (!container) return;
        if (!cases.length) {
            container.innerHTML = '<div class="empty-state-text">No assessment cases are configured.</div>';
            return;
        }
        const done = new Set(doneCaseIds || []);
        const okCases = cases.filter((e) => e.ok);
        const doneCount = okCases.filter((e) => done.has(e.m.caseId)).length;
        // First not-yet-completed case gets the visually primary "start here" CTA
        const nextEntry = okCases.find((e) => !done.has(e.m.caseId));

        let progressHtml = '';
        if (okCases.length > 1) {
            progressHtml = doneCount > 0
                ? `<div class="assessment-progress-line">You've completed <strong>${doneCount} of ${okCases.length}</strong> cases${doneCount >= okCases.length ? ' — all done, thank you! <button class="btn btn-primary assessment-finish-btn" onclick="router.navigate(\'/assessment/complete\')">Finish and exit</button>' : ' — each one helps, do the rest whenever suits you.'}</div>`
                : `<div class="assessment-progress-line">${okCases.length} cases, each about 10–20 minutes. <strong>Doing just one is a great start</strong> — they can be done in any sitting, in any order.</div>`;
        }

        container.innerHTML = progressHtml + cases.map((entry, i) => {
            if (!entry.ok) {
                return `
                    <div class="assessment-case-card error">
                        <strong>${entry.id}</strong> — failed to load: ${this._escape(entry.err)}
                    </div>
                `;
            }
            const m = entry.m;
            const isScaffold = (m.status === 'scaffold');
            const isDone = done.has(m.caseId);
            const isNext = nextEntry && nextEntry.m.caseId === m.caseId;
            return `
                <div class="assessment-case-card${isDone ? ' case-done' : ''}${isNext ? ' case-next' : ''}">
                    <div class="assessment-case-card-header">
                        <h3>Case ${i + 1}: ${this._escape(this._cardTitle(m))}</h3>
                        ${isDone ? '<span class="assessment-case-tag done">&#10003; Completed</span>' : ''}
                        ${isScaffold ? '<span class="assessment-case-tag scaffold">SCAFFOLD</span>' : ''}
                    </div>
                    <div class="assessment-case-card-meta">
                        <span>${(m.assessments || []).length} timepoint${(m.assessments || []).length === 1 ? '' : 's'} &middot; ~10&ndash;20 min</span>
                    </div>
                    ${m.source ? `<div class="assessment-case-card-source">Test case &middot; ${this._escape(m.source)}</div>` : ''}
                    ${m.warning ? `<div class="assessment-case-card-warning">${this._escape(m.warning)}</div>` : ''}
                    <button class="btn ${isDone ? '' : 'btn-primary'}" onclick="AssessmentStart.beginCase('${m.caseId}')">
                        ${isDone ? 'Do again' : (isNext ? 'Start here' : 'Begin case')}
                    </button>
                </div>
            `;
        }).join('');
    },

    _renderResume(resume) {
        const slot = document.getElementById('assessment-resume-slot');
        if (!slot) return;
        if (!resume) { slot.innerHTML = ''; return; }
        slot.innerHTML = `
            <div class="assessment-resume-card">
                <div>
                    <strong>Your progress is saved.</strong> You have a case in progress — pick up exactly where you left off.
                    <div class="assessment-resume-meta">
                        Case ${this._escape(resume.case_id)} &middot;
                        Started ${this._escape(new Date(resume.started_at).toLocaleString())} &middot;
                        Currently at ${this._escape(resume.current_assessment || '—')}
                    </div>
                </div>
                <div class="assessment-resume-actions">
                    <button class="btn btn-primary" onclick="AssessmentStart.resumeAttempt('${resume.id}')">Continue where I left off</button>
                    <a href="#" class="assessment-resume-startover" onclick="AssessmentStart.confirmAbandon('${resume.id}'); return false;" title="Discard this attempt and start the case from the beginning">Start this case over</a>
                </div>
            </div>
        `;
    },

    async beginCase(caseId) {
        try {
            App.showLoading('Starting assessment…');
            await AssessmentEngine.start(caseId);
            router.navigate('/assessment/run');
        } catch (err) {
            console.error('beginCase failed', err);
            App.showToast('Could not start assessment: ' + err.message, 'error', 5000);
        } finally {
            App.hideLoading();
        }
    },

    async resumeAttempt(attemptId) {
        try {
            App.showLoading('Resuming attempt…');
            await AssessmentEngine.resume(attemptId);
            router.navigate('/assessment/run');
        } catch (err) {
            console.error('resumeAttempt failed', err);
            App.showToast('Could not resume: ' + err.message, 'error', 5000);
        } finally {
            App.hideLoading();
        }
    },

    async confirmAbandon(attemptId) {
        if (!confirm('Start this case over? Your answers so far will be discarded and the case restarts from the beginning. (To keep your progress, use Continue instead.)')) return;
        try {
            // Need to resume first so engine knows the attempt, then abandon.
            await AssessmentEngine.resume(attemptId);
            await AssessmentEngine.abandon();
            App.showToast('Attempt abandoned.', 'info');
            this.render();
        } catch (err) {
            App.showToast('Could not abandon: ' + err.message, 'error');
        }
    },

    // Pre-test card title: the patient name only. The full caseTitle embeds a
    // spoiler subtitle (e.g. "— The drug fever that almost killed her") that
    // gives the case away, so we strip everything after the em/en/hyphen dash.
    _cardTitle(m) {
        const full = m.caseTitle || m.caseId || '';
        return full.split(/\s[—–-]\s/)[0].trim() || full;
    },

    _escape(s) {
        const el = document.createElement('span');
        el.textContent = s == null ? '' : String(s);
        return el.innerHTML;
    },
};

window.AssessmentStart = AssessmentStart;
