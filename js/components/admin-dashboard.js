/**
 * AdminDashboard — study-PI review console.
 *
 * Routes:
 *   #/admin/attempts           — all attempts (+ sign-in gate)
 *   #/admin/attempts/:id       — per-attempt CHRONOLOGICAL TRANSCRIPT
 *                                (question → AI conversation → answer → score)
 *   #/admin/analytics          — aggregate AI-usage analytics
 *   #/admin/export             — CSV / JSON download
 *
 * ── Auth model ────────────────────────────────────────────────────────────
 * Participants use code-based identity (localStorage `user-code` + the
 * `x-participant-code` header injected by supabase-sync's fetch wrapper) and
 * NEVER authenticate. Admins DO authenticate, with Supabase Auth.
 *
 * We deliberately use a SEPARATE Supabase client here rather than
 * SupabaseSync.getClient(), for two reasons:
 *   1. SupabaseSync's client injects `x-participant-code` on every request.
 *      Harmless for reads (RLS policies are OR'd) but it muddies the request
 *      and would silently scope things if 004's policies ever tighten.
 *   2. More importantly, `assessment-engine.js` stamps new attempts with
 *      `SupabaseSync.getUser().id` whenever that client holds a session. If
 *      the PI signed in on the shared client and a participant then used the
 *      same browser, their attempt would be written under the PI's user_id.
 *      A separate client with its own `storageKey` keeps the admin session
 *      completely invisible to the participant code path.
 *
 * No credentials are hardcoded. Nothing here logs tokens, passwords, or the
 * Anthropic key.
 */

const AdminDashboard = {

    // ── constants ─────────────────────────────────────────────────────────

    DEFAULT_URL: 'https://piwoinyrlicvndpsmtde.supabase.co',
    ADMIN_STORAGE_KEY: 'sb-admin-auth',
    MIGRATION: '005_admin_read_all.sql',

    WINDOW_LABEL: {
        today: 'Today only', '7d': 'Last 7 days', '30d': 'Last 30 days',
        '90d': 'Last 90 days', '6mo': 'Last 6 months', '1y': 'Last 1 year',
        all: 'All available history',
    },
    TYPE_LABEL: {
        notes: 'Notes', labs: 'Labs', vitals: 'Vitals', imaging: 'Imaging',
        encounters: 'Encounters', procedures: 'Procedures', orders: 'Orders',
        problems: 'Problems', medications: 'Meds', allergies: 'Allergies',
        social: 'Social', family: 'Family', immunizations: 'Imms',
    },

    // ── state ─────────────────────────────────────────────────────────────

    _client: null,
    _session: null,
    _isAdmin: false,
    _adminRole: null,
    _authWired: false,
    _cache: null,        // { attempts, responses, aiLog, errors, loadedAt }
    _caseDefs: null,     // { PAT003: caseDef, ... }
    _aiLog: [],          // per-detail-render scratch

    // ══════════════════════════════════════════════════════════════════════
    // AUTH
    // ══════════════════════════════════════════════════════════════════════

    /** Lazily create the admin-only Supabase client (separate session store). */
    _adminClient() {
        if (this._client) return this._client;
        if (typeof supabase === 'undefined' || !supabase.createClient) return null;
        const url = window.__SUPABASE_URL || this.DEFAULT_URL;
        const key = window.__SUPABASE_ANON_KEY;
        if (!key) return null;
        this._client = supabase.createClient(url, key, {
            auth: {
                storageKey: this.ADMIN_STORAGE_KEY,
                persistSession: true,
                autoRefreshToken: true,
                detectSessionInUrl: false,
            },
        });
        return this._client;
    },

    /** Restore any persisted admin session and wire the auth listener once. */
    async _ensureAuth() {
        const sb = this._adminClient();
        if (!sb) return null;
        if (this._authWired) return this._session;
        this._authWired = true;
        try {
            const { data } = await sb.auth.getSession();
            this._session = (data && data.session) || null;
        } catch (err) {
            console.warn('admin session restore failed:', err.message);
            this._session = null;
        }
        sb.auth.onAuthStateChange((event, session) => {
            this._session = session || null;
            if (!session) { this._isAdmin = false; this._adminRole = null; this._cache = null; }
            window.dispatchEvent(new CustomEvent('admin:auth-change', {
                detail: { signedIn: !!session },
            }));
        });
        return this._session;
    },

    /**
     * Confirm the signed-in user holds an admin/proctor row.
     * → { ok, reason?, role?, message? }
     */
    async _verifyAdmin() {
        const sb = this._adminClient();
        if (!sb || !this._session || !this._session.user) {
            this._isAdmin = false;
            return { ok: false, reason: 'signed_out' };
        }
        try {
            const { data, error } = await sb
                .from('admin_roles')
                .select('role')
                .eq('user_id', this._session.user.id)
                .maybeSingle();
            if (error) {
                this._isAdmin = false;
                return { ok: false, reason: 'query_error', message: error.message };
            }
            if (!data) {
                this._isAdmin = false;
                return { ok: false, reason: 'no_role' };
            }
            if (data.role === 'admin' || data.role === 'proctor') {
                this._isAdmin = true;
                this._adminRole = data.role;
                return { ok: true, role: data.role };
            }
            this._isAdmin = false;
            return { ok: false, reason: 'wrong_role', role: data.role };
        } catch (err) {
            this._isAdmin = false;
            return { ok: false, reason: 'network', message: err.message };
        }
    },

    /** Synchronous accessor used by App._refreshAssessmentNav(). */
    isAdmin() { return !!this._isAdmin; },

    /**
     * Async probe for the sidebar: restore the session, check the role, and
     * report whether the Admin link should be shown. Never throws.
     */
    async probeAdmin() {
        try {
            await this._ensureAuth();
            if (!this._session) return false;
            const v = await this._verifyAdmin();
            return !!v.ok;
        } catch (err) {
            return false;
        }
    },

    async signOut() {
        const sb = this._adminClient();
        this._cache = null;
        this._isAdmin = false;
        this._adminRole = null;
        if (sb) { try { await sb.auth.signOut(); } catch (e) { /* ignore */ } }
        this._session = null;
        window.dispatchEvent(new CustomEvent('admin:auth-change', { detail: { signedIn: false } }));
        if (typeof router !== 'undefined') {
            if (window.location.hash === '#/admin/attempts') router.handleRoute();
            else window.location.hash = '#/admin/attempts';
        }
    },

    /**
     * Gate every admin view. Returns true only when a verified admin is
     * signed in; otherwise it renders the login / denial view itself.
     */
    async _requireAdmin(root) {
        if (!this._adminClient()) {
            this._renderNoClient(root);
            return false;
        }
        await this._ensureAuth();
        if (!this._session) {
            this._renderLogin(root);
            return false;
        }
        const v = await this._verifyAdmin();
        if (!v.ok) {
            this._renderDenied(root, v);
            return false;
        }
        return true;
    },

    // ── auth views ────────────────────────────────────────────────────────

    _renderNoClient(root) {
        root.innerHTML = `
            <div class="admin-page">
                <div class="admin-gate">
                    <h1>Admin sign-in unavailable</h1>
                    <p class="admin-gate-note">
                        The Supabase client could not be created — either the
                        <code>@supabase/supabase-js</code> CDN script did not load, or
                        <code>window.__SUPABASE_ANON_KEY</code> is not set on this deployment.
                        The admin dashboard needs both.
                    </p>
                </div>
            </div>`;
        App.refreshIcons();
    },

    _renderLogin(root) {
        root.innerHTML = `
            <div class="admin-page">
                <div class="admin-gate">
                    <div class="admin-gate-icon"><i data-lucide="shield"></i></div>
                    <h1>Study admin sign-in</h1>
                    <p class="admin-gate-note">
                        Participants never sign in — they use a participant code. This page is for
                        the study PI / proctors and requires a Supabase Auth account listed in
                        <code>admin_roles</code>.
                    </p>
                    <form id="admin-login-form" class="admin-gate-form" autocomplete="on">
                        <label for="admin-login-email">Email</label>
                        <input type="email" id="admin-login-email" name="email" required
                               autocomplete="username" placeholder="you@example.edu" />
                        <label for="admin-login-password">Password</label>
                        <input type="password" id="admin-login-password" name="password" required
                               autocomplete="current-password" placeholder="Password" />
                        <button type="submit" class="btn btn-primary" id="admin-login-btn">Sign in</button>
                    </form>
                    <div id="admin-login-msg" class="admin-gate-msg"></div>
                </div>
            </div>`;
        App.refreshIcons();

        const form = document.getElementById('admin-login-form');
        const msg = document.getElementById('admin-login-msg');
        const btn = document.getElementById('admin-login-btn');
        if (!form) return;

        form.addEventListener('submit', async (e) => {
            e.preventDefault();
            const email = (document.getElementById('admin-login-email').value || '').trim();
            const password = document.getElementById('admin-login-password').value || '';
            if (!email || !password) return;

            btn.disabled = true;
            btn.textContent = 'Signing in…';
            msg.className = 'admin-gate-msg';
            msg.textContent = '';

            const sb = this._adminClient();
            try {
                // NOTE: never log the password, the returned session, or tokens.
                const { data, error } = await sb.auth.signInWithPassword({ email, password });
                if (error) {
                    msg.className = 'admin-gate-msg admin-gate-msg-error';
                    msg.textContent = error.message;
                    btn.disabled = false;
                    btn.textContent = 'Sign in';
                    return;
                }
                this._session = (data && data.session) || null;
                const v = await this._verifyAdmin();
                if (!v.ok) {
                    this._renderDenied(root, v);
                    return;
                }
                window.dispatchEvent(new CustomEvent('admin:auth-change', { detail: { signedIn: true } }));
                if (typeof router !== 'undefined') router.handleRoute();
                else this.renderList();
            } catch (err) {
                msg.className = 'admin-gate-msg admin-gate-msg-error';
                msg.textContent = 'Sign-in failed: ' + (err.message || 'unexpected error');
                btn.disabled = false;
                btn.textContent = 'Sign in';
            }
        });
    },

    _renderDenied(root, v) {
        const email = (this._session && this._session.user && this._session.user.email) || '';
        let body;
        if (v.reason === 'no_role' || v.reason === 'wrong_role') {
            body = `
                <p class="admin-gate-note">
                    You are signed in as <strong>${this._escape(email)}</strong>, but no
                    <code>admin_roles</code> row with role <code>admin</code> or <code>proctor</code>
                    is visible for your account${v.role ? ` (found role <code>${this._escape(v.role)}</code>)` : ''}.
                </p>
                <p class="admin-gate-note">
                    Two things can cause this:
                </p>
                <ol class="admin-gate-list">
                    <li>Migration <code>supabase/migrations/${this.MIGRATION}</code> has not been applied
                        to the live database yet. Apply it in the Supabase SQL editor.</li>
                    <li>The admin row has not been inserted. After the migration, run the
                        <code>INSERT INTO public.admin_roles …</code> statement documented at the
                        bottom of <code>${this.MIGRATION}</code>, substituting your email.</li>
                </ol>`;
        } else if (v.reason === 'query_error') {
            body = `
                <p class="admin-gate-note">
                    Signed in as <strong>${this._escape(email)}</strong>, but the
                    <code>admin_roles</code> lookup failed:
                    <code>${this._escape(v.message || '')}</code>
                </p>
                <p class="admin-gate-note">
                    This usually means migration <code>supabase/migrations/${this.MIGRATION}</code>
                    has not been applied to the live database yet (it creates the
                    <code>p_admin_roles_select_self</code> policy and <code>public.is_study_admin()</code>).
                </p>`;
        } else {
            body = `<p class="admin-gate-note">
                        Could not verify admin status${v.message ? `: <code>${this._escape(v.message)}</code>` : ''}.
                        Check your connection and try again — the Supabase project also auto-pauses
                        on the free tier and may need to be resumed from the dashboard.
                    </p>`;
        }
        root.innerHTML = `
            <div class="admin-page">
                <div class="admin-gate">
                    <div class="admin-gate-icon"><i data-lucide="lock"></i></div>
                    <h1>Admin access not confirmed</h1>
                    ${body}
                    <div class="admin-gate-actions">
                        <button class="btn" onclick="AdminDashboard.signOut()">Sign out</button>
                        <button class="btn" onclick="router.handleRoute()">Retry</button>
                    </div>
                </div>
            </div>`;
        App.refreshIcons();
    },

    // ══════════════════════════════════════════════════════════════════════
    // DATA
    // ══════════════════════════════════════════════════════════════════════

    /** Fetch the whole study dataset once and memoize it. */
    async _fetchAll(force) {
        if (this._cache && !force) return this._cache;
        const sb = this._adminClient();
        const [aRes, rRes, lRes] = await Promise.all([
            sb.from('test_attempts').select('*').order('started_at', { ascending: false }).limit(2000),
            sb.from('assessment_responses').select('*').order('submitted_at', { ascending: true }).limit(10000),
            sb.from('assessment_ai_log').select('*').order('timestamp', { ascending: true }).limit(20000),
        ]);
        const errors = [aRes.error, rRes.error, lRes.error]
            .filter(Boolean)
            .map((e) => e.message);
        this._cache = {
            attempts: aRes.data || [],
            responses: rRes.data || [],
            aiLog: lRes.data || [],
            errors,
            loadedAt: new Date(),
        };
        return this._cache;
    },

    /** Load (and memoize) the static case definitions for the given case ids. */
    async _loadCaseDefs(caseIds) {
        this._caseDefs = this._caseDefs || {};
        const wanted = Array.from(new Set(caseIds || [])).filter((id) => id && !this._caseDefs[id]);
        await Promise.all(wanted.map(async (id) => {
            try {
                this._caseDefs[id] = await AssessmentData.loadCase(id);
            } catch (err) {
                console.warn('case def load failed for', id, err.message);
                this._caseDefs[id] = null;
            }
        }));
        return this._caseDefs;
    },

    // ══════════════════════════════════════════════════════════════════════
    // SHARED CHROME
    // ══════════════════════════════════════════════════════════════════════

    _renderAdminNav(active) {
        const email = (this._session && this._session.user && this._session.user.email) || '';
        const tabs = [
            { key: 'attempts', href: '#/admin/attempts', label: 'Attempts', icon: 'list' },
            { key: 'analytics', href: '#/admin/analytics', label: 'AI-usage analytics', icon: 'bar-chart-2' },
            { key: 'export', href: '#/admin/export', label: 'Export', icon: 'download' },
            { key: 'feedback', href: '#/admin/feedback', label: 'Feedback', icon: 'message-square-text' },
        ];
        return `
            <div class="admin-topbar">
                <nav class="admin-tabs">
                    ${tabs.map((t) => `
                        <a href="${t.href}" class="admin-tab${t.key === active ? ' active' : ''}">
                            <i data-lucide="${t.icon}"></i><span>${t.label}</span>
                        </a>`).join('')}
                </nav>
                <div class="admin-session">
                    <span class="admin-session-email" title="Signed-in study admin">${this._escape(email)}${this._adminRole ? ` · ${this._escape(this._adminRole)}` : ''}</span>
                    <button class="btn btn-sm" onclick="AdminDashboard.refresh()">Refresh</button>
                    <button class="btn btn-sm" onclick="AdminDashboard.signOut()">Sign out</button>
                </div>
            </div>`;
    },

    /** Warn when a query errored, or when everything came back empty. */
    _rlsNotice(data) {
        if (data.errors && data.errors.length) {
            return `
                <div class="admin-notice admin-notice-error">
                    <strong>Query error.</strong> ${data.errors.map((m) => this._escape(m)).join('; ')}<br>
                    If this mentions permissions or a missing function, migration
                    <code>supabase/migrations/${this.MIGRATION}</code> has probably not been applied
                    to the live database yet.
                </div>`;
        }
        if (!data.attempts.length) {
            return `
                <div class="admin-notice">
                    <strong>No attempts returned.</strong> That is expected if nobody has taken the
                    assessment yet — but it is <em>also</em> exactly what you see when migration
                    <code>supabase/migrations/${this.MIGRATION}</code> has not been applied, because
                    row-level security filters rows silently instead of raising an error.
                    If you expect data here, apply that migration (and the two post-migration steps
                    documented at the bottom of the file: create the auth user, insert the
                    <code>admin_roles</code> row), then hit Refresh.
                </div>`;
        }
        return '';
    },

    refresh() {
        this._cache = null;
        if (typeof router !== 'undefined') router.handleRoute();
    },

    // ══════════════════════════════════════════════════════════════════════
    // VIEW 1 — ATTEMPTS LIST
    // ══════════════════════════════════════════════════════════════════════

    async renderList() {
        const root = document.getElementById('main-content');
        if (!root) return;
        root.innerHTML = `<div class="admin-page"><div class="loading">Loading…</div></div>`;
        if (!(await this._requireAdmin(root))) return;

        const data = await this._fetchAll();
        const attempts = data.attempts;
        const turnsByAttempt = this._turnsByAttempt(data.aiLog);
        const respByAttempt = this._groupBy(data.responses, (r) => r.attempt_id);

        const counts = { in_progress: 0, completed: 0, abandoned: 0, expired: 0 };
        for (const a of attempts) counts[a.status] = (counts[a.status] || 0) + 1;
        const completed = attempts.filter((a) => a.status === 'completed' && a.total_score !== null);
        const avgScore = completed.length
            ? Math.round((completed.reduce((s, a) => s + Number(a.total_score || 0), 0) / completed.length) * 100)
            : null;

        // Group by identity (user_code preferred, user_id fallback)
        const byUser = new Map();
        for (const a of attempts) {
            const key = a.user_code || ('auth:' + (a.user_id || 'unknown').slice(0, 8));
            const bucket = byUser.get(key) || { id: key, attempts: 0, completed: 0, totalScore: 0, cases: new Set(), turns: 0 };
            bucket.attempts += 1;
            bucket.cases.add(a.case_id);
            bucket.turns += (turnsByAttempt.get(a.id) || 0);
            if (a.status === 'completed' && a.total_score !== null) {
                bucket.completed += 1;
                bucket.totalScore += Number(a.total_score || 0);
            }
            byUser.set(key, bucket);
        }
        const userRows = Array.from(byUser.values())
            .map((u) => ({
                ...u,
                avgScore: u.completed ? Math.round((u.totalScore / u.completed) * 100) : null,
                cases: Array.from(u.cases).join(', '),
            }))
            .sort((a, b) => b.attempts - a.attempts);

        root.innerHTML = `
            <div class="admin-page">
                ${this._renderAdminNav('attempts')}
                <div class="admin-header">
                    <h1>Attempts</h1>
                    <div class="admin-header-stats">
                        <span>${attempts.length} total</span>
                        <span>&middot; ${counts.completed || 0} completed</span>
                        <span>&middot; ${counts.in_progress || 0} in progress</span>
                        <span>&middot; ${counts.abandoned || 0} abandoned</span>
                        ${avgScore !== null ? `<span>&middot; Avg completed score ${avgScore}%</span>` : ''}
                        <span>&middot; ${userRows.length} ${userRows.length === 1 ? 'participant' : 'participants'}</span>
                        <span>&middot; ${data.aiLog.length} AI-log rows</span>
                        <span class="admin-loaded-at">loaded ${this._escape(data.loadedAt.toLocaleTimeString())}</span>
                    </div>
                </div>
                ${this._rlsNotice(data)}
                ${userRows.length > 0 ? `
                <div class="admin-user-summary">
                    <h2 class="admin-section-title">By participant</h2>
                    <div class="admin-user-grid">
                        ${userRows.map((u) => `
                            <div class="admin-user-card">
                                <div class="admin-user-id">${u.id.startsWith('auth:') ? `<code>${this._escape(u.id.slice(5))}…</code>` : `<strong class="user-code-badge">${this._escape(u.id)}</strong>`}</div>
                                <div class="admin-user-meta">
                                    ${u.attempts} attempt${u.attempts === 1 ? '' : 's'}
                                    · ${u.completed} done
                                    ${u.avgScore !== null ? `· avg ${u.avgScore}%` : ''}
                                    · ${u.turns} AI turn${u.turns === 1 ? '' : 's'}
                                </div>
                                <div class="admin-user-cases">${this._escape(u.cases)}</div>
                            </div>
                        `).join('')}
                    </div>
                </div>` : ''}
                ${attempts.length ? `
                <div class="admin-attempts-table-wrap">
                    <table class="admin-attempts-table">
                        <thead>
                            <tr>
                                <th>Participant</th>
                                <th>Case</th>
                                <th>Started</th>
                                <th>Status</th>
                                <th>Current</th>
                                <th>Time</th>
                                <th>Answers</th>
                                <th>AI turns</th>
                                <th>Score</th>
                                <th></th>
                            </tr>
                        </thead>
                        <tbody>
                            ${attempts.map((a) => this._renderAttemptRow(
                                a,
                                (respByAttempt.get(a.id) || []).length,
                                turnsByAttempt.get(a.id) || 0
                            )).join('')}
                        </tbody>
                    </table>
                </div>` : ''}
            </div>`;
        App.refreshIcons();
    },

    _renderAttemptRow(a, answerCount, turnCount) {
        const pct = (a.total_score !== null && a.total_score !== undefined)
            ? Math.round(Number(a.total_score) * 100) + '%'
            : '—';
        return `
            <tr>
                <td>${this._renderUserCell(a)}</td>
                <td>${this._escape(a.case_id)}</td>
                <td>${this._escape(this._fmtDate(a.started_at))}</td>
                <td><span class="status-pill status-${this._escape(a.status)}">${this._escape(a.status)}</span></td>
                <td>${this._escape(a.current_assessment || '—')}</td>
                <td>${this._fmtTime(a.time_used_seconds || 0)}</td>
                <td>${answerCount}</td>
                <td>${turnCount}</td>
                <td>${pct}</td>
                <td><a class="btn btn-sm" href="#/admin/attempts/${this._escape(a.id)}">Transcript</a></td>
            </tr>`;
    },

    _renderUserCell(a) {
        if (a.user_code) return `<strong class="user-code-badge">${this._escape(a.user_code)}</strong>`;
        if (a.user_id) return `<code title="Supabase user id">${this._escape(a.user_id.slice(0, 8))}…</code>`;
        return '<span class="text-muted">—</span>';
    },

    // ══════════════════════════════════════════════════════════════════════
    // VIEW 2 — PER-ATTEMPT CHRONOLOGICAL TRANSCRIPT
    // ══════════════════════════════════════════════════════════════════════

    async renderDetail(attemptId) {
        const root = document.getElementById('main-content');
        if (!root) return;
        root.innerHTML = `<div class="admin-page"><div class="loading">Loading…</div></div>`;
        if (!(await this._requireAdmin(root))) return;

        const sb = this._adminClient();
        const [attemptRes, respRes, logRes] = await Promise.all([
            sb.from('test_attempts').select('*').eq('id', attemptId).maybeSingle(),
            sb.from('assessment_responses').select('*').eq('attempt_id', attemptId).order('submitted_at', { ascending: true }),
            sb.from('assessment_ai_log').select('*').eq('attempt_id', attemptId).order('timestamp', { ascending: true }),
        ]);

        if (attemptRes.error) {
            root.innerHTML = `
                <div class="admin-page">
                    ${this._renderAdminNav('attempts')}
                    <div class="admin-notice admin-notice-error">
                        Could not load this attempt: <code>${this._escape(attemptRes.error.message)}</code><br>
                        If this looks like a permissions error, apply
                        <code>supabase/migrations/${this.MIGRATION}</code>.
                    </div>
                </div>`;
            App.refreshIcons();
            return;
        }
        if (!attemptRes.data) {
            root.innerHTML = `
                <div class="admin-page">
                    ${this._renderAdminNav('attempts')}
                    <div class="admin-notice">
                        <strong>Attempt not found.</strong> Either the id is wrong, or row-level
                        security is hiding it — which is what happens when migration
                        <code>supabase/migrations/${this.MIGRATION}</code> has not been applied.
                    </div>
                </div>`;
            App.refreshIcons();
            return;
        }

        const attempt = attemptRes.data;
        const responses = respRes.data || [];
        const aiLog = logRes.data || [];
        this._aiLog = aiLog;

        const caseDefs = await this._loadCaseDefs([attempt.case_id]);
        const caseDef = caseDefs[attempt.case_id] || null;

        const askTurns = aiLog.filter((r) => r.interaction_type === 'ask' || r.interaction_type === 'ask_error');
        const chartViews = aiLog.filter((r) => r.interaction_type === 'chart_view').length;

        root.innerHTML = `
            <div class="admin-page admin-detail-page">
                ${this._renderAdminNav('attempts')}
                <div class="admin-detail-header">
                    <a href="#/admin/attempts" class="admin-back-link">&larr; Back to all attempts</a>
                    <h1>${this._escape(attempt.case_id)}${caseDef && caseDef.meta && caseDef.meta.title ? ' — ' + this._escape(caseDef.meta.title) : ''}</h1>
                    <div class="admin-detail-meta">
                        <span>Participant ${
                            attempt.user_code
                                ? `<strong class="user-code-badge">${this._escape(attempt.user_code)}</strong>`
                                : (attempt.user_id
                                    ? `<code>${this._escape(attempt.user_id.slice(0, 8))}…</code>`
                                    : '<span class="text-muted">unknown</span>')
                        }</span>
                        <span>&middot; <code>${this._escape(attempt.id.slice(0, 8))}</code></span>
                        <span>&middot; ${this._escape(attempt.status)}</span>
                        <span>&middot; Score ${attempt.total_score === null ? '—' : Math.round(Number(attempt.total_score) * 100) + '%'}</span>
                        <span>&middot; Time ${this._fmtTime(attempt.time_used_seconds || 0)}</span>
                        <span>&middot; Started ${this._escape(this._fmtDate(attempt.started_at))}</span>
                        ${attempt.completed_at ? `<span>&middot; Completed ${this._escape(this._fmtDate(attempt.completed_at))}</span>` : ''}
                        <span>&middot; ${responses.length} answer${responses.length === 1 ? '' : 's'}</span>
                        <span>&middot; ${askTurns.length} AI turn${askTurns.length === 1 ? '' : 's'}</span>
                        ${chartViews ? `<span>&middot; ${chartViews} chart views</span>` : ''}
                    </div>
                    <div class="admin-detail-actions">
                        <button class="btn btn-sm" onclick="AdminDashboard.expandAll(true)">Expand all</button>
                        <button class="btn btn-sm" onclick="AdminDashboard.expandAll(false)">Collapse all</button>
                    </div>
                </div>
                ${!caseDef ? `<div class="admin-notice">Case definition for <code>${this._escape(attempt.case_id)}</code> could not be loaded, so questions and rubrics are unavailable. Showing raw stored rows.</div>` : ''}
                ${this._renderTranscript(caseDef, responses, aiLog)}
            </div>`;
        App.refreshIcons();
    },

    expandAll(open) {
        const root = document.querySelector('.admin-detail-page');
        if (!root) return;
        root.querySelectorAll('details').forEach((d) => { d.open = !!open; });
    },

    /**
     * The core view: one chronological narrative per question, grouped by
     * assessment (AP1/AP2/AP3) then prompt id.
     */
    _renderTranscript(caseDef, responses, aiLog) {
        const respByPrompt = new Map();
        for (const r of responses) respByPrompt.set(r.prompt_id, r);

        const seenPrompts = new Set();
        let html = '';

        if (caseDef && Array.isArray(caseDef.assessments)) {
            html += caseDef.assessments.map((ap) => {
                const prompts = ap.prompts || [];
                prompts.forEach((p) => seenPrompts.add(p.id));
                const apResponses = prompts.map((p) => respByPrompt.get(p.id)).filter(Boolean);
                const apTurns = aiLog.filter((r) => r.assessment_id === ap.id
                    && (r.interaction_type === 'ask' || r.interaction_type === 'ask_error')).length;
                return `
                    <section class="admin-tx-ap">
                        <div class="admin-tx-ap-head">
                            <h2>${this._escape(ap.id)} — ${this._escape(ap.title || '')}</h2>
                            <div class="admin-tx-ap-meta">
                                ${prompts.length} question${prompts.length === 1 ? '' : 's'}
                                · ${apResponses.length} answered
                                · ${apTurns} AI turn${apTurns === 1 ? '' : 's'}
                                ${ap.anchorDate ? `· chart anchored ${this._escape(this._fmtDate(ap.anchorDate))}` : ''}
                            </div>
                        </div>
                        ${ap.scenarioBrief ? `<div class="admin-tx-brief">${this._long(ap.scenarioBrief, 'admin-tx-brief-text', 320)}</div>` : ''}
                        ${prompts.map((p) => this._renderQuestionBlock(p, respByPrompt.get(p.id), aiLog)).join('')}
                    </section>`;
            }).join('');
        }

        // Any stored responses whose prompt is not in the case definition.
        const orphanResponses = responses.filter((r) => !seenPrompts.has(r.prompt_id));
        if (orphanResponses.length) {
            html += `
                <section class="admin-tx-ap">
                    <div class="admin-tx-ap-head"><h2>Other stored responses</h2>
                    <div class="admin-tx-ap-meta">Prompt ids not present in the current case definition.</div></div>
                    ${orphanResponses.map((r) => this._renderQuestionBlock(
                        { id: r.prompt_id, question: '(question text unavailable — prompt not in the current case definition)' },
                        r, aiLog
                    )).join('')}
                </section>`;
        }

        // AI turns that carry no prompt_id (e.g. asked between questions).
        const unattributed = aiLog.filter((r) =>
            (r.interaction_type === 'ask' || r.interaction_type === 'ask_error') && !r.prompt_id);
        if (unattributed.length) {
            html += `
                <section class="admin-tx-ap">
                    <div class="admin-tx-ap-head"><h2>Unattributed AI turns</h2>
                    <div class="admin-tx-ap-meta">${unattributed.length} turn${unattributed.length === 1 ? '' : 's'} logged without a prompt id.</div></div>
                    <div class="admin-tx-turns">${unattributed.map((row, i) => this._renderTurn(row, i + 1)).join('')}</div>
                </section>`;
        }

        if (!html) {
            html = `<div class="admin-notice">Nothing recorded for this attempt yet — no responses and no AI log rows.</div>`;
        }
        return html;
    },

    /**
     * One question: the prompt, then the AI conversation the resident had for
     * it, then the answer they submitted, then the score.
     */
    _renderQuestionBlock(prompt, r, aiLog) {
        const turns = (aiLog || [])
            .filter((row) => row.prompt_id === prompt.id
                && (row.interaction_type === 'ask' || row.interaction_type === 'ask_error'))
            .sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));

        const maxPoints = prompt.scoringRubric && Number(prompt.scoringRubric.maxPoints);
        let scoreHtml = '<span class="admin-tx-score admin-tx-score-none">not answered</span>';
        if (r && typeof r.score === 'number') {
            const pct = Math.round(r.score * 100);
            const pts = Number.isFinite(maxPoints) && maxPoints > 0
                ? `${Math.round(r.score * maxPoints * 10) / 10} / ${maxPoints} pts · `
                : '';
            scoreHtml = `<span class="admin-tx-score">${pts}${pct}%</span>`;
        }

        return `
            <article class="admin-tx-q">
                <div class="admin-tx-q-head">
                    <span class="admin-tx-q-id">${this._escape(prompt.id)}</span>
                    ${prompt.type ? `<span class="admin-tx-q-type">${this._escape(prompt.type)}</span>` : ''}
                    ${scoreHtml}
                </div>
                <div class="admin-tx-question">${this._escape(prompt.question || '')}</div>

                <div class="admin-tx-step">
                    <div class="admin-tx-step-label admin-tx-step-ai">
                        <i data-lucide="message-square"></i>
                        AI conversation before answering
                        <span class="admin-tx-count">${turns.length} turn${turns.length === 1 ? '' : 's'}</span>
                    </div>
                    ${turns.length
                        ? `<div class="admin-tx-turns">${turns.map((row, i) => this._renderTurn(row, i + 1)).join('')}</div>`
                        : `<div class="admin-tx-noai">No AI assistant use for this question — answered unaided.</div>`}
                </div>

                <div class="admin-tx-step">
                    <div class="admin-tx-step-label admin-tx-step-answer">
                        <i data-lucide="edit-3"></i>
                        Submitted answer
                        ${r && r.submitted_at ? `<span class="admin-tx-count">${this._escape(this._fmtDate(r.submitted_at))}</span>` : ''}
                        ${r && r.time_spent_seconds ? `<span class="admin-tx-count">${this._fmtTime(r.time_spent_seconds)} on question</span>` : ''}
                    </div>
                    <div class="admin-tx-answer">${this._long((r && r.response_text) || '', 'admin-tx-answer-text', 900)}</div>
                    ${r && r.ai_sample_output
                        ? `<details class="admin-tx-sub"><summary>AI sample output the resident was critiquing</summary><pre>${this._escape(r.ai_sample_output)}</pre></details>`
                        : ''}
                </div>

                <div class="admin-tx-step">
                    <div class="admin-tx-step-label admin-tx-step-score">
                        <i data-lucide="check-square"></i>
                        Score &amp; rubric
                    </div>
                    ${this._renderScoreBox(prompt, r)}
                </div>
            </article>`;
    },

    _renderScoreBox(prompt, r) {
        if (!r) return `<div class="admin-tx-noai">No submission, so no score.</div>`;
        const b = r.score_breakdown || {};
        const rows = [];

        const list = (label, arr, cls) => {
            if (!Array.isArray(arr) || !arr.length) return '';
            return `<div class="admin-tx-rubric-group ${cls}">
                        <div class="admin-tx-rubric-label">${label} (${arr.length})</div>
                        <ul>${arr.map((x) => `<li>${this._escape(typeof x === 'string' ? x : JSON.stringify(x))}</li>`).join('')}</ul>
                    </div>`;
        };

        if (Number.isFinite(Number(b.earnedPoints)) && Number.isFinite(Number(b.applicableMax))) {
            rows.push(`<div class="admin-tx-points">${this._escape(String(b.earnedPoints))} / ${this._escape(String(b.applicableMax))} points awarded by the grader</div>`);
        }
        rows.push(list('Awarded', b.awarded, 'ok'));
        rows.push(list('Missed', b.missed, 'miss'));
        rows.push(list('Penalties', b.penalties, 'penalty'));
        // Legacy essential/bonus shape (PAT002 and old attempts)
        rows.push(list('Essential hit', b.essential_hit, 'ok'));
        rows.push(list('Essential missed', b.essential_missed, 'miss'));
        rows.push(list('Bonus hit', b.bonus_hit, 'ok'));
        rows.push(list('Red flags', b.red_flags_triggered, 'penalty'));

        if (Array.isArray(b._graderSamples) && b._graderSamples.length > 1) {
            rows.push(`<div class="admin-tx-grader-samples">Grader samples (median used): ${b._graderSamples.map((s) => Math.round(s * 100) + '%').join(', ')}</div>`);
        }

        const rubricText = prompt.scoringRubric && prompt.scoringRubric.rubricText;

        return `
            <div class="admin-tx-scorebox">
                ${rows.filter(Boolean).join('')}
                ${r.grader_notes ? `<div class="admin-grader-notes"><strong>Grader notes:</strong> ${this._escape(r.grader_notes)}</div>` : ''}
                ${rubricText ? `<details class="admin-tx-sub"><summary>Scoring rubric (max ${this._escape(String(prompt.scoringRubric.maxPoints || '?'))} pts)</summary><pre>${this._escape(rubricText)}</pre></details>` : ''}
                ${r.score_breakdown ? `<details class="admin-tx-sub"><summary>Raw score_breakdown JSON</summary><pre>${this._escape(JSON.stringify(r.score_breakdown, null, 2))}</pre></details>` : ''}
            </div>`;
    },

    /** One AI turn: the resident's prompt + the assistant's reply + settings. */
    _renderTurn(row, n) {
        const setup = (row.metadata && row.metadata.chatbot_setup) || null;
        const failed = row.interaction_type === 'ask_error';
        const chips = [];
        if (setup) {
            chips.push(`<span class="admin-tx-chip admin-tx-chip-window"><i data-lucide="calendar"></i>${this._escape(this.WINDOW_LABEL[setup.windowKey] || setup.windowKey || '?')}</span>`);
            const types = (setup.dataTypes || []).map((t) => this.TYPE_LABEL[t] || t);
            chips.push(`<span class="admin-tx-chip admin-tx-chip-types"><i data-lucide="layers"></i>${types.length ? this._escape(types.join(' · ')) : 'no data types'}</span>`);
            if (Number.isFinite(Number(setup.contextChars))) {
                chips.push(`<span class="admin-tx-chip">chart context ${this._num(setup.contextChars)} chars</span>`);
            }
        } else {
            chips.push(`<span class="admin-tx-chip admin-tx-chip-muted">no chatbot settings recorded</span>`);
        }
        chips.push(`<span class="admin-tx-chip">total context ${this._num(row.context_size_chars || 0)} chars</span>`);
        if (Array.isArray(row.chart_sections) && row.chart_sections.length) {
            chips.push(`<span class="admin-tx-chip admin-tx-chip-muted">chart gate: ${this._escape(row.chart_sections.join(', '))}</span>`);
        }

        const userText = this._extractUserText(row.query_text || '');

        return `
            <div class="admin-tx-turn${failed ? ' admin-tx-turn-failed' : ''}">
                <div class="admin-tx-turn-head">
                    <span class="admin-tx-turn-n">Turn ${n}</span>
                    <span class="admin-tx-turn-time">${this._escape(this._fmtDate(row.timestamp))}</span>
                    ${failed ? '<span class="admin-tx-chip admin-tx-chip-fail">API error</span>' : ''}
                    ${chips.join('')}
                </div>
                <div class="admin-tx-msg admin-tx-msg-user">
                    <span class="admin-tx-who">Resident asked</span>
                    ${this._long(userText, 'admin-tx-msg-text', 600)}
                </div>
                <div class="admin-tx-msg admin-tx-msg-bot">
                    <span class="admin-tx-who">AI replied</span>
                    ${this._long(row.response_text || '(no response)', 'admin-tx-msg-text', 600)}
                </div>
                <details class="admin-tx-sub admin-tx-raw">
                    <summary>Full serialized request (includes chart context)</summary>
                    <pre>${this._escape(row.query_text || '')}</pre>
                </details>
            </div>`;
    },

    _extractUserText(serialized) {
        if (!serialized) return '';
        const lastUserIdx = serialized.lastIndexOf('[user]');
        if (lastUserIdx === -1) return serialized.slice(-1000);
        const chunk = serialized.slice(lastUserIdx + '[user]'.length).trim();
        const sep = '— END OF CHART CONTEXT —';
        const sepIdx = chunk.indexOf(sep);
        if (sepIdx !== -1) return chunk.slice(sepIdx + sep.length).trim();
        return chunk;
    },

    // ══════════════════════════════════════════════════════════════════════
    // VIEW — PARTICIPANT FEEDBACK (widget submissions, migration 006)
    // ══════════════════════════════════════════════════════════════════════

    async renderFeedback() {
        const root = document.getElementById('main-content');
        if (!root) return;
        root.innerHTML = `<div class="admin-page"><div class="loading">Loading…</div></div>`;
        if (!(await this._requireAdmin(root))) return;

        const sb = this._adminClient();
        const { data, error } = await sb.from('feedback')
            .select('*').order('created_at', { ascending: false }).limit(500);
        const rows = data || [];
        root.innerHTML = `
            <div class="admin-page">
                ${this._renderAdminNav('feedback')}
                <div class="admin-header">
                    <h1>Participant feedback</h1>
                    <div class="admin-header-stats"><span>${rows.length} entr${rows.length === 1 ? 'y' : 'ies'}</span></div>
                </div>
                ${error ? `<div class="admin-error">Could not load feedback: ${this._escape(error.message)}.
                    If the table is missing, apply supabase/migrations/006_feedback_table.sql.</div>` : ''}
                ${!error && !rows.length ? `<div class="admin-empty">No feedback yet. Entries appear here the moment a participant hits Submit in the feedback widget.</div>` : ''}
                <div class="admin-feedback-list">
                    ${rows.map((r) => `
                        <div class="admin-feedback-item">
                            <div class="admin-feedback-meta">
                                <strong>${this._escape(r.participant_code || '?')}</strong>
                                <span>${this._escape((r.created_at || '').replace('T', ' ').slice(0, 16))}</span>
                                <span>${this._escape(r.page || '')}</span>
                                <span>${this._escape(r.method || '')}</span>
                                ${r.attempt_id ? `<a href="#/admin/attempts/${r.attempt_id}">attempt →</a>` : ''}
                            </div>
                            <div class="admin-feedback-text">${this._escape(r.feedback_text || '')}</div>
                        </div>`).join('')}
                </div>
            </div>`;
        App.refreshIcons();
    },

    // ══════════════════════════════════════════════════════════════════════
    // VIEW 3 — AI-USAGE ANALYTICS
    // ══════════════════════════════════════════════════════════════════════

    async renderAnalytics() {
        const root = document.getElementById('main-content');
        if (!root) return;
        root.innerHTML = `<div class="admin-page"><div class="loading">Loading…</div></div>`;
        if (!(await this._requireAdmin(root))) return;

        const data = await this._fetchAll();
        await this._loadCaseDefs(data.attempts.map((a) => a.case_id));
        const A = this._computeAnalytics(data);

        root.innerHTML = `
            <div class="admin-page admin-analytics-page">
                ${this._renderAdminNav('analytics')}
                <div class="admin-header">
                    <h1>AI-usage analytics</h1>
                    <div class="admin-header-stats">
                        <span>${A.attemptCount} attempts</span>
                        <span>&middot; ${A.questionCount} answered questions</span>
                        <span>&middot; ${A.turnCount} AI turns</span>
                        <span class="admin-loaded-at">loaded ${this._escape(data.loadedAt.toLocaleTimeString())}</span>
                    </div>
                </div>
                ${this._rlsNotice(data)}
                <div class="admin-caveat">
                    <strong>Descriptive only.</strong> N is small. Everything below is a raw count,
                    proportion, or median over the attempts currently in the database — no
                    inferential statistics, no confidence intervals, no hypothesis tests.
                    Do not read the usage-vs-score tables as causal; participants who ask more
                    may simply be facing harder questions.
                </div>

                ${A.turnCount === 0 && A.questionCount === 0 ? `
                    <div class="admin-notice">No responses or AI-log rows to analyze yet.</div>` : `

                <div class="admin-analytics-grid">
                    ${this._card('Chosen time window', 'Per AI turn. This is the resident\'s choice of how far back the chatbot may look.',
                        this._barTable(A.windows, A.turnCount, 'turns'))}
                    ${this._card('Chart data types included', 'Share of AI turns whose chatbot setup included each data type.',
                        this._barTable(A.dataTypes, A.turnCount, 'turns'))}
                </div>

                <div class="admin-analytics-grid">
                    ${this._card('AI turns per question', `Across ${A.questionCount} answered questions. Mean ${A.turnsPerQuestion.mean}, median ${A.turnsPerQuestion.median}, max ${A.turnsPerQuestion.max}.`,
                        this._barTable(A.turnHistogram, A.questionCount, 'questions'))}
                    ${this._card('AI turns per attempt', `Across ${A.attemptCount} attempts. Mean ${A.turnsPerAttempt.mean}, median ${A.turnsPerAttempt.median}, range ${A.turnsPerAttempt.min}–${A.turnsPerAttempt.max}.`,
                        this._statList([
                            ['Attempts with zero AI use', `${A.attemptsZeroAI} of ${A.attemptCount}`],
                            ['Median context size per turn', `${this._num(A.medianContext)} chars`],
                            ['Median chart-context block', `${this._num(A.medianChartContext)} chars`],
                            ['Failed AI calls logged', String(A.errorTurns)],
                        ]))}
                </div>

                <div class="admin-analytics-grid">
                    ${this._card('Questions answered with ZERO AI turns',
                        'The headline behavioural number: how often the resident answered unaided.',
                        this._statList([
                            ['Zero-AI questions', `${A.zeroAIQuestions} of ${A.questionCount} (${A.questionCount ? Math.round(A.zeroAIQuestions / A.questionCount * 100) : 0}%)`],
                            ['Mean score, zero-AI questions', A.zeroAIMeanScore === null ? '—' : A.zeroAIMeanScore + '%'],
                            ['Mean score, ≥1 AI turn', A.someAIMeanScore === null ? '—' : A.someAIMeanScore + '%'],
                        ]))}
                    ${this._card('Score by AI turn count', 'Question-level. Mean graded score within each turn-count bucket.',
                        this._scoreTable(A.scoreByTurns))}
                </div>

                <div class="admin-analytics-grid">
                    ${this._card('Score by context size', 'Question-level, using the largest context the resident sent for that question, split into terciles.',
                        this._scoreTable(A.scoreByContext))}
                    ${this._card('Per-case AI usage', 'Median AI turns per question, by case.',
                        this._scoreTable(A.byCase, 'Case'))}
                </div>

                <h2 class="admin-section-title">Attempt-level detail (N is small — read the rows, not the averages)</h2>
                <div class="admin-attempts-table-wrap">
                    <table class="admin-attempts-table">
                        <thead><tr>
                            <th>Participant</th><th>Case</th><th>Status</th>
                            <th>Answers</th><th>AI turns</th><th>Turns / question</th>
                            <th>Median context</th><th>Windows used</th><th>Score</th><th></th>
                        </tr></thead>
                        <tbody>
                            ${A.perAttempt.map((r) => `
                                <tr>
                                    <td>${r.userCode ? `<strong class="user-code-badge">${this._escape(r.userCode)}</strong>` : '<span class="text-muted">—</span>'}</td>
                                    <td>${this._escape(r.caseId)}</td>
                                    <td><span class="status-pill status-${this._escape(r.status)}">${this._escape(r.status)}</span></td>
                                    <td>${r.answers}</td>
                                    <td>${r.turns}</td>
                                    <td>${r.turnsPerQ}</td>
                                    <td>${this._num(r.medianContext)}</td>
                                    <td class="admin-cell-wrap">${this._escape(r.windows || '—')}</td>
                                    <td>${r.score === null ? '—' : r.score + '%'}</td>
                                    <td><a class="btn btn-sm" href="#/admin/attempts/${this._escape(r.id)}">Transcript</a></td>
                                </tr>`).join('')}
                        </tbody>
                    </table>
                </div>`}
            </div>`;
        App.refreshIcons();
    },

    _computeAnalytics(data) {
        const attempts = data.attempts;
        const responses = data.responses;
        const askTurns = data.aiLog.filter((r) => r.interaction_type === 'ask' || r.interaction_type === 'ask_error');
        const errorTurns = data.aiLog.filter((r) => r.interaction_type === 'ask_error').length;

        // ── distributions over turns ──────────────────────────────────────
        const windows = new Map();
        const dataTypes = new Map();
        const contextSizes = [];
        const chartContextSizes = [];
        for (const t of askTurns) {
            const setup = (t.metadata && t.metadata.chatbot_setup) || null;
            const wKey = setup ? (setup.windowKey || 'unrecorded') : 'unrecorded';
            windows.set(this.WINDOW_LABEL[wKey] || wKey, (windows.get(this.WINDOW_LABEL[wKey] || wKey) || 0) + 1);
            if (setup && Array.isArray(setup.dataTypes)) {
                for (const dt of setup.dataTypes) {
                    const label = this.TYPE_LABEL[dt] || dt;
                    dataTypes.set(label, (dataTypes.get(label) || 0) + 1);
                }
            }
            if (Number.isFinite(Number(t.context_size_chars))) contextSizes.push(Number(t.context_size_chars));
            if (setup && Number.isFinite(Number(setup.contextChars))) chartContextSizes.push(Number(setup.contextChars));
        }

        // ── per-question aggregation ──────────────────────────────────────
        const qKey = (attemptId, promptId) => attemptId + '::' + promptId;
        const turnsByQ = new Map();
        const ctxByQ = new Map();
        for (const t of askTurns) {
            if (!t.prompt_id) continue;
            const k = qKey(t.attempt_id, t.prompt_id);
            turnsByQ.set(k, (turnsByQ.get(k) || 0) + 1);
            const prev = ctxByQ.get(k) || 0;
            ctxByQ.set(k, Math.max(prev, Number(t.context_size_chars || 0)));
        }

        const questions = responses.map((r) => ({
            attemptId: r.attempt_id,
            promptId: r.prompt_id,
            score: typeof r.score === 'number' ? r.score : null,
            turns: turnsByQ.get(qKey(r.attempt_id, r.prompt_id)) || 0,
            ctx: ctxByQ.get(qKey(r.attempt_id, r.prompt_id)) || 0,
        }));

        const turnCounts = questions.map((q) => q.turns);
        const turnHistogram = new Map();
        for (const n of turnCounts) {
            const label = n >= 5 ? '5+ turns' : (n === 0 ? '0 turns (unaided)' : `${n} turn${n === 1 ? '' : 's'}`);
            turnHistogram.set(label, (turnHistogram.get(label) || 0) + 1);
        }
        // Keep the histogram in a sensible order.
        const histOrder = ['0 turns (unaided)', '1 turn', '2 turns', '3 turns', '4 turns', '5+ turns'];
        const orderedHist = new Map();
        histOrder.forEach((k) => { if (turnHistogram.has(k)) orderedHist.set(k, turnHistogram.get(k)); });

        const zeroAIQuestions = questions.filter((q) => q.turns === 0).length;
        const meanScorePct = (arr) => {
            const s = arr.filter((q) => q.score !== null);
            if (!s.length) return null;
            return Math.round(s.reduce((a, q) => a + q.score, 0) / s.length * 100);
        };

        // Score by turn bucket
        const bucketOf = (n) => (n === 0 ? '0 turns' : n === 1 ? '1 turn' : n === 2 ? '2 turns' : '3+ turns');
        const byTurnBucket = new Map();
        for (const q of questions) {
            const b = bucketOf(q.turns);
            const arr = byTurnBucket.get(b) || [];
            arr.push(q);
            byTurnBucket.set(b, arr);
        }
        const scoreByTurns = ['0 turns', '1 turn', '2 turns', '3+ turns']
            .filter((b) => byTurnBucket.has(b))
            .map((b) => ({ label: b, n: byTurnBucket.get(b).length, value: meanScorePct(byTurnBucket.get(b)) }));

        // Score by context tercile (questions with any AI use)
        const withAI = questions.filter((q) => q.turns > 0).sort((a, b) => a.ctx - b.ctx);
        const scoreByContext = [];
        if (withAI.length >= 3) {
            const third = Math.floor(withAI.length / 3);
            const groups = [
                { label: `Smallest context (≤${this._num(withAI[third - 1].ctx)} chars)`, items: withAI.slice(0, third) },
                { label: 'Middle context', items: withAI.slice(third, withAI.length - third) },
                { label: `Largest context (≥${this._num(withAI[withAI.length - third].ctx)} chars)`, items: withAI.slice(withAI.length - third) },
            ];
            for (const g of groups) {
                if (g.items.length) scoreByContext.push({ label: g.label, n: g.items.length, value: meanScorePct(g.items) });
            }
        } else if (withAI.length) {
            scoreByContext.push({ label: 'All AI-assisted questions', n: withAI.length, value: meanScorePct(withAI) });
        }

        // ── per-attempt rows ──────────────────────────────────────────────
        const respByAttempt = this._groupBy(responses, (r) => r.attempt_id);
        const turnsByAttemptList = this._groupBy(askTurns, (t) => t.attempt_id);
        const perAttempt = attempts.map((a) => {
            const rs = respByAttempt.get(a.id) || [];
            const ts = turnsByAttemptList.get(a.id) || [];
            const ctxs = ts.map((t) => Number(t.context_size_chars || 0));
            const winSet = new Set(ts.map((t) => {
                const s = t.metadata && t.metadata.chatbot_setup;
                return s ? (this.WINDOW_LABEL[s.windowKey] || s.windowKey) : null;
            }).filter(Boolean));
            return {
                id: a.id,
                userCode: a.user_code,
                caseId: a.case_id,
                status: a.status,
                answers: rs.length,
                turns: ts.length,
                turnsPerQ: rs.length ? (Math.round(ts.length / rs.length * 100) / 100) : 0,
                medianContext: Math.round(this._median(ctxs)),
                windows: Array.from(winSet).join(', '),
                score: a.total_score === null || a.total_score === undefined ? null : Math.round(Number(a.total_score) * 100),
            };
        });

        // ── per-case rows ─────────────────────────────────────────────────
        const caseMap = new Map();
        for (const q of questions) {
            const att = attempts.find((a) => a.id === q.attemptId);
            const cid = (att && att.case_id) || 'unknown';
            const arr = caseMap.get(cid) || [];
            arr.push(q);
            caseMap.set(cid, arr);
        }
        const byCase = Array.from(caseMap.entries()).sort((a, b) => a[0].localeCompare(b[0])).map(([cid, qs]) => ({
            label: cid,
            n: qs.length,
            value: meanScorePct(qs),
            extra: `median ${this._median(qs.map((q) => q.turns))} turns/Q`,
        }));

        const attemptTurnCounts = attempts.map((a) => (turnsByAttemptList.get(a.id) || []).length);

        return {
            attemptCount: attempts.length,
            questionCount: questions.length,
            turnCount: askTurns.length,
            errorTurns,
            windows: this._sortedMap(windows),
            dataTypes: this._sortedMap(dataTypes),
            turnHistogram: orderedHist,
            turnsPerQuestion: {
                mean: turnCounts.length ? Math.round(turnCounts.reduce((a, b) => a + b, 0) / turnCounts.length * 100) / 100 : 0,
                median: this._median(turnCounts),
                max: turnCounts.length ? Math.max(...turnCounts) : 0,
            },
            turnsPerAttempt: {
                mean: attemptTurnCounts.length ? Math.round(attemptTurnCounts.reduce((a, b) => a + b, 0) / attemptTurnCounts.length * 100) / 100 : 0,
                median: this._median(attemptTurnCounts),
                min: attemptTurnCounts.length ? Math.min(...attemptTurnCounts) : 0,
                max: attemptTurnCounts.length ? Math.max(...attemptTurnCounts) : 0,
            },
            attemptsZeroAI: attemptTurnCounts.filter((n) => n === 0).length,
            medianContext: Math.round(this._median(contextSizes)),
            medianChartContext: Math.round(this._median(chartContextSizes)),
            zeroAIQuestions,
            zeroAIMeanScore: meanScorePct(questions.filter((q) => q.turns === 0)),
            someAIMeanScore: meanScorePct(questions.filter((q) => q.turns > 0)),
            scoreByTurns,
            scoreByContext,
            byCase,
            perAttempt,
        };
    },

    // ── analytics render helpers (no chart library — CSS bars only) ───────

    _card(title, subtitle, body) {
        return `
            <div class="admin-card">
                <div class="admin-card-title">${title}</div>
                ${subtitle ? `<div class="admin-card-sub">${subtitle}</div>` : ''}
                <div class="admin-card-body">${body}</div>
            </div>`;
    },

    _barTable(map, total, unitLabel) {
        const entries = map instanceof Map ? Array.from(map.entries()) : Object.entries(map || {});
        if (!entries.length) return `<div class="admin-tx-noai">No data.</div>`;
        const max = Math.max(...entries.map(([, v]) => v));
        return `<table class="admin-bar-table">${entries.map(([k, v]) => `
            <tr>
                <td class="admin-bar-label">${this._escape(k)}</td>
                <td class="admin-bar-cell"><div class="admin-bar"><div class="admin-bar-fill" style="width:${max ? Math.round(v / max * 100) : 0}%"></div></div></td>
                <td class="admin-bar-value">${v}${total ? ` <span class="admin-bar-pct">${Math.round(v / total * 100)}%</span>` : ''}</td>
            </tr>`).join('')}
            <tr class="admin-bar-total"><td colspan="3">${total} ${this._escape(unitLabel || '')} total</td></tr>
        </table>`;
    },

    _scoreTable(rows, labelHead) {
        if (!rows || !rows.length) return `<div class="admin-tx-noai">Not enough data.</div>`;
        return `<table class="admin-bar-table">
            <tr class="admin-bar-head"><th>${this._escape(labelHead || 'Bucket')}</th><th>Mean score</th><th>n</th></tr>
            ${rows.map((r) => `
            <tr>
                <td class="admin-bar-label">${this._escape(r.label)}${r.extra ? `<span class="admin-bar-extra">${this._escape(r.extra)}</span>` : ''}</td>
                <td class="admin-bar-cell">
                    <div class="admin-bar"><div class="admin-bar-fill admin-bar-fill-score" style="width:${r.value === null ? 0 : r.value}%"></div></div>
                    <span class="admin-bar-inline">${r.value === null ? '—' : r.value + '%'}</span>
                </td>
                <td class="admin-bar-value">${r.n}</td>
            </tr>`).join('')}
        </table>`;
    },

    _statList(pairs) {
        return `<dl class="admin-stat-list">${pairs.map(([k, v]) => `
            <div><dt>${this._escape(k)}</dt><dd>${this._escape(String(v))}</dd></div>`).join('')}</dl>`;
    },

    // ══════════════════════════════════════════════════════════════════════
    // VIEW 4 — EXPORT
    // ══════════════════════════════════════════════════════════════════════

    async renderExport() {
        const root = document.getElementById('main-content');
        if (!root) return;
        root.innerHTML = `<div class="admin-page"><div class="loading">Loading…</div></div>`;
        if (!(await this._requireAdmin(root))) return;

        const data = await this._fetchAll();

        root.innerHTML = `
            <div class="admin-page">
                ${this._renderAdminNav('export')}
                <div class="admin-header">
                    <h1>Export</h1>
                    <div class="admin-header-stats">
                        <span>${data.attempts.length} attempts</span>
                        <span>&middot; ${data.responses.length} responses</span>
                        <span>&middot; ${data.aiLog.length} AI-log rows</span>
                        <span class="admin-loaded-at">loaded ${this._escape(data.loadedAt.toLocaleTimeString())}</span>
                    </div>
                </div>
                ${this._rlsNotice(data)}
                <div class="admin-export-grid">
                    ${this._card('Responses CSV (flat)',
                        'One row per answered question, joined to its attempt and its AI-usage summary. This is the analysis-ready file.',
                        `<button class="btn btn-primary" onclick="AdminDashboard.exportResponsesCsv()">Download responses CSV</button>`)}
                    ${this._card('AI log CSV (flat)',
                        'One row per logged AI turn, including the chosen time window, data types, and context size.',
                        `<button class="btn" onclick="AdminDashboard.exportAiLogCsv()">Download AI log CSV</button>`)}
                    ${this._card('Full JSON dump',
                        'Every attempt with its responses and AI log nested underneath, plus the question and rubric text from the case definitions. Lossless.',
                        `<button class="btn" onclick="AdminDashboard.exportJson()">Download full JSON</button>`)}
                </div>
                <div class="admin-export-note" id="admin-export-status"></div>
                <div class="admin-caveat">
                    CSV files are RFC-4180 quoted (every field is quoted; embedded quotes are doubled),
                    so commas, quotation marks, and newlines inside answers and prompts survive intact.
                    A UTF-8 BOM is prepended so Excel opens them correctly. Everything is generated in
                    your browser — nothing is uploaded anywhere.
                </div>
            </div>`;
        App.refreshIcons();
    },

    _exportStatus(msg) {
        const el = document.getElementById('admin-export-status');
        if (el) el.textContent = msg;
    },

    async exportResponsesCsv() {
        this._exportStatus('Building CSV…');
        try {
            const data = await this._fetchAll();
            await this._loadCaseDefs(data.attempts.map((a) => a.case_id));
            const attemptById = new Map(data.attempts.map((a) => [a.id, a]));
            const askTurns = data.aiLog.filter((r) => r.interaction_type === 'ask' || r.interaction_type === 'ask_error');

            const headers = [
                'attempt_id', 'user_code', 'user_id', 'case_id', 'attempt_status', 'attempt_score_pct',
                'attempt_started_at', 'attempt_completed_at', 'attempt_time_used_seconds',
                'assessment_id', 'prompt_id', 'prompt_type', 'prompt_max_points', 'question_text',
                'response_text', 'score_fraction', 'score_pct', 'points_awarded',
                'grader_notes', 'score_breakdown_json', 'time_spent_seconds', 'submitted_at',
                'ai_turns', 'ai_time_windows', 'ai_data_types', 'ai_max_context_chars',
                'ai_median_context_chars', 'ai_first_query', 'ai_all_queries',
            ];

            const rows = data.responses.map((r) => {
                const a = attemptById.get(r.attempt_id) || {};
                const prompt = this._findPrompt(a.case_id, r.assessment_id, r.prompt_id);
                const turns = askTurns.filter((t) => t.attempt_id === r.attempt_id && t.prompt_id === r.prompt_id);
                const ctxs = turns.map((t) => Number(t.context_size_chars || 0));
                const wins = new Set();
                const types = new Set();
                for (const t of turns) {
                    const s = t.metadata && t.metadata.chatbot_setup;
                    if (!s) continue;
                    if (s.windowKey) wins.add(s.windowKey);
                    (s.dataTypes || []).forEach((d) => types.add(d));
                }
                const queries = turns.map((t) => this._extractUserText(t.query_text || ''));
                const maxPoints = prompt && prompt.scoringRubric ? prompt.scoringRubric.maxPoints : '';
                return [
                    r.attempt_id, a.user_code || '', a.user_id || '', a.case_id || '', a.status || '',
                    a.total_score === null || a.total_score === undefined ? '' : Math.round(Number(a.total_score) * 100),
                    a.started_at || '', a.completed_at || '', a.time_used_seconds || 0,
                    r.assessment_id || '', r.prompt_id || '', (prompt && prompt.type) || '',
                    maxPoints === undefined ? '' : maxPoints,
                    (prompt && prompt.question) || '',
                    r.response_text || '',
                    typeof r.score === 'number' ? r.score : '',
                    typeof r.score === 'number' ? Math.round(r.score * 100) : '',
                    (typeof r.score === 'number' && Number(maxPoints) > 0)
                        ? Math.round(r.score * Number(maxPoints) * 10) / 10 : '',
                    r.grader_notes || '',
                    r.score_breakdown ? JSON.stringify(r.score_breakdown) : '',
                    r.time_spent_seconds || 0, r.submitted_at || '',
                    turns.length,
                    Array.from(wins).join('|'),
                    Array.from(types).join('|'),
                    ctxs.length ? Math.max(...ctxs) : 0,
                    ctxs.length ? Math.round(this._median(ctxs)) : 0,
                    queries[0] || '',
                    queries.join('\n---\n'),
                ];
            });

            this._download(`acting-intern-responses-${this._stamp()}.csv`, this._toCsv(headers, rows), 'text/csv;charset=utf-8');
            this._exportStatus(`Downloaded ${rows.length} response rows.`);
        } catch (err) {
            this._exportStatus('Export failed: ' + err.message);
        }
    },

    async exportAiLogCsv() {
        this._exportStatus('Building CSV…');
        try {
            const data = await this._fetchAll();
            const attemptById = new Map(data.attempts.map((a) => [a.id, a]));
            const headers = [
                'log_id', 'attempt_id', 'user_code', 'case_id', 'timestamp',
                'assessment_id', 'prompt_id', 'interaction_type',
                'chatbot_time_window', 'chatbot_data_types', 'chatbot_context_chars', 'chatbot_turn',
                'context_size_chars', 'chart_sections', 'model',
                'resident_query', 'ai_response', 'query_text_full', 'metadata_json',
            ];
            const rows = data.aiLog.map((t) => {
                const a = attemptById.get(t.attempt_id) || {};
                const s = (t.metadata && t.metadata.chatbot_setup) || {};
                return [
                    t.id, t.attempt_id, a.user_code || '', a.case_id || '', t.timestamp || '',
                    t.assessment_id || '', t.prompt_id || '', t.interaction_type || '',
                    s.windowKey || '', (s.dataTypes || []).join('|'),
                    s.contextChars === undefined ? '' : s.contextChars,
                    s.turn === undefined ? '' : s.turn,
                    t.context_size_chars || 0,
                    Array.isArray(t.chart_sections) ? t.chart_sections.join('|') : '',
                    (t.metadata && t.metadata.model) || '',
                    this._extractUserText(t.query_text || ''),
                    t.response_text || '',
                    t.query_text || '',
                    t.metadata ? JSON.stringify(t.metadata) : '',
                ];
            });
            this._download(`acting-intern-ai-log-${this._stamp()}.csv`, this._toCsv(headers, rows), 'text/csv;charset=utf-8');
            this._exportStatus(`Downloaded ${rows.length} AI-log rows.`);
        } catch (err) {
            this._exportStatus('Export failed: ' + err.message);
        }
    },

    async exportJson() {
        this._exportStatus('Building JSON…');
        try {
            const data = await this._fetchAll();
            await this._loadCaseDefs(data.attempts.map((a) => a.case_id));
            const respByAttempt = this._groupBy(data.responses, (r) => r.attempt_id);
            const logByAttempt = this._groupBy(data.aiLog, (t) => t.attempt_id);

            const payload = {
                export_version: 1,
                exported_at: new Date().toISOString(),
                source: 'Acting Intern — assessment study (test_attempts / assessment_responses / assessment_ai_log)',
                note: 'Descriptive research export. Question and rubric text are joined in from the static case definitions at export time.',
                counts: {
                    attempts: data.attempts.length,
                    responses: data.responses.length,
                    ai_log: data.aiLog.length,
                },
                attempts: data.attempts.map((a) => ({
                    ...a,
                    responses: (respByAttempt.get(a.id) || []).map((r) => {
                        const prompt = this._findPrompt(a.case_id, r.assessment_id, r.prompt_id);
                        return {
                            ...r,
                            question_text: (prompt && prompt.question) || null,
                            prompt_type: (prompt && prompt.type) || null,
                            max_points: (prompt && prompt.scoringRubric && prompt.scoringRubric.maxPoints) || null,
                            rubric_text: (prompt && prompt.scoringRubric && prompt.scoringRubric.rubricText) || null,
                        };
                    }),
                    ai_log: (logByAttempt.get(a.id) || []).map((t) => ({
                        ...t,
                        resident_query: this._extractUserText(t.query_text || ''),
                    })),
                })),
            };
            this._download(`acting-intern-full-${this._stamp()}.json`, JSON.stringify(payload, null, 2), 'application/json');
            this._exportStatus(`Downloaded ${payload.attempts.length} attempts.`);
        } catch (err) {
            this._exportStatus('Export failed: ' + err.message);
        }
    },

    _findPrompt(caseId, assessmentId, promptId) {
        const def = this._caseDefs && this._caseDefs[caseId];
        if (!def || !Array.isArray(def.assessments)) return null;
        for (const ap of def.assessments) {
            if (assessmentId && ap.id !== assessmentId) continue;
            const p = (ap.prompts || []).find((x) => x.id === promptId);
            if (p) return p;
        }
        // assessment_id mismatch — search everything.
        for (const ap of def.assessments) {
            const p = (ap.prompts || []).find((x) => x.id === promptId);
            if (p) return p;
        }
        return null;
    },

    // ── CSV / download primitives ────────────────────────────────────────

    /**
     * RFC 4180: quote EVERY field and double any embedded quote. Answer and
     * prompt text contain commas, quotes and newlines, all of which survive
     * intact inside a quoted field.
     */
    _csvCell(v) {
        if (v === null || v === undefined) return '""';
        return '"' + String(v).replace(/"/g, '""') + '"';
    },

    _toCsv(headers, rows) {
        const lines = [headers.map((h) => this._csvCell(h)).join(',')];
        for (const row of rows) lines.push(row.map((c) => this._csvCell(c)).join(','));
        return '﻿' + lines.join('\r\n') + '\r\n';
    },

    _download(filename, text, mime) {
        const blob = new Blob([text], { type: mime });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        a.style.display = 'none';
        document.body.appendChild(a);
        a.click();
        setTimeout(() => {
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
        }, 0);
    },

    _stamp() {
        const d = new Date();
        const p = (n) => String(n).padStart(2, '0');
        return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}`;
    },

    // ══════════════════════════════════════════════════════════════════════
    // UTILITIES
    // ══════════════════════════════════════════════════════════════════════

    _groupBy(arr, keyFn) {
        const m = new Map();
        for (const x of arr || []) {
            const k = keyFn(x);
            const list = m.get(k) || [];
            list.push(x);
            m.set(k, list);
        }
        return m;
    },

    _turnsByAttempt(aiLog) {
        const m = new Map();
        for (const t of aiLog || []) {
            if (t.interaction_type !== 'ask' && t.interaction_type !== 'ask_error') continue;
            m.set(t.attempt_id, (m.get(t.attempt_id) || 0) + 1);
        }
        return m;
    },

    _sortedMap(map) {
        return new Map(Array.from(map.entries()).sort((a, b) => b[1] - a[1]));
    },

    _median(nums) {
        const a = (nums || []).filter((n) => Number.isFinite(n)).sort((x, y) => x - y);
        if (!a.length) return 0;
        const mid = Math.floor(a.length / 2);
        return a.length % 2 ? a[mid] : (a[mid - 1] + a[mid]) / 2;
    },

    /** Collapsible block for text that could be long. Pure CSS, no JS. */
    _long(text, cls, previewChars) {
        previewChars = previewChars || 400;
        const s = text == null ? '' : String(text);
        if (!s.trim()) return `<div class="${cls} admin-tx-empty">(empty)</div>`;
        if (s.length <= previewChars) return `<div class="${cls}">${this._escape(s)}</div>`;
        return `
            <details class="admin-longtext">
                <summary>
                    <span class="admin-longtext-preview">${this._escape(s.slice(0, previewChars))}…</span>
                    <span class="admin-longtext-toggle">Show all ${this._num(s.length)} characters</span>
                </summary>
                <div class="${cls}">${this._escape(s)}</div>
            </details>`;
    },

    _num(n) {
        const v = Number(n);
        return Number.isFinite(v) ? v.toLocaleString() : '0';
    },

    _fmtDate(iso) {
        if (!iso) return '';
        try { return new Date(iso).toLocaleString(); } catch (e) { return iso; }
    },

    _fmtTime(secs) {
        secs = Math.max(0, Math.floor(secs));
        const h = Math.floor(secs / 3600);
        const m = Math.floor((secs % 3600) / 60);
        const s = secs % 60;
        if (h > 0) return `${h}h ${m}m`;
        if (m > 0) return `${m}m`;
        return `${s}s`;
    },

    /** HTML-escape, safe for both text and attribute contexts. */
    _escape(s) {
        if (s === null || s === undefined) return '';
        return String(s)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    },
};

window.AdminDashboard = AdminDashboard;
