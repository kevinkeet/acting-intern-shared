/**
 * Chat Summary Panel Service
 *
 * Generates AI-powered contextual summaries for the Patient and Nurse chat windows.
 * Uses the AI's longitudinal document + simulation state to produce role-specific briefs.
 *
 * Patient summary: Patient-friendly, education-level-appropriate explanation
 * Nurse summary: Two modes —
 *   - Bedside Nurse: Brief clinical summary for the RN
 *   - Case Manager: Discharge planning, anticipated needs, barriers
 */

const ChatSummaryPanel = {
    // Cache summaries to avoid redundant API calls
    cache: {
        patient: { text: '', timestamp: 0 },
        nurse: { text: '', timestamp: 0 },
        caseManager: { text: '', timestamp: 0 }
    },

    // Loading states
    loading: {
        patient: false,
        nurse: false,
        caseManager: false
    },

    // Current nurse panel mode: 'bedside' or 'caseManager'
    nurseMode: 'bedside',

    // Cache TTL: 3 minutes (summaries refresh when stale)
    CACHE_TTL: 3 * 60 * 1000,

    /**
     * Build clinical context string from available sources
     */
    _buildContext() {
        let context = '';

        // 1. Try the AI's longitudinal document (richest source)
        if (typeof AICoworker !== 'undefined' && AICoworker.longitudinalDoc) {
            const doc = AICoworker.longitudinalDoc;

            // Patient knowledge base
            if (doc.patientSummary) {
                context += `PATIENT SUMMARY:\n${doc.patientSummary}\n\n`;
            }

            // Active problems
            if (doc.problems && doc.problems.length > 0) {
                context += `ACTIVE PROBLEMS:\n`;
                doc.problems.forEach(p => {
                    context += `- ${p.name || p}`;
                    if (p.status) context += ` (${p.status})`;
                    if (p.plan) context += ` — Plan: ${p.plan}`;
                    context += '\n';
                });
                context += '\n';
            }

            // Medications
            if (doc.medications && doc.medications.length > 0) {
                context += `MEDICATIONS:\n`;
                doc.medications.forEach(m => {
                    const name = typeof m === 'string' ? m : (m.name || m.medication || '');
                    if (name) context += `- ${name}\n`;
                });
                context += '\n';
            }

            // Clinical narrative / encounter notes
            if (doc.clinicalNarrative) {
                context += `CLINICAL NARRATIVE:\n${doc.clinicalNarrative}\n\n`;
            }
            if (doc.encounterNotes) {
                context += `ENCOUNTER NOTES:\n${doc.encounterNotes}\n\n`;
            }
        }

        // 2. AI Coworker state (LLM-generated summaries)
        if (typeof AICoworker !== 'undefined' && AICoworker.state) {
            const st = AICoworker.state;
            if (st.clinicalSummary) {
                const cs = st.clinicalSummary;
                if (typeof cs === 'string') {
                    context += `AI CLINICAL SUMMARY:\n${cs}\n\n`;
                } else {
                    if (cs.demographics) context += `Demographics: ${cs.demographics}\n`;
                    if (cs.functional) context += `Functional: ${cs.functional}\n`;
                    if (cs.presentation) context += `Presentation: ${cs.presentation}\n`;
                    context += '\n';
                }
            }
            if (st.problemList && st.problemList.length > 0) {
                context += `PROBLEM LIST:\n`;
                st.problemList.forEach(p => {
                    context += `- ${p.name || p}`;
                    if (p.urgency) context += ` [${p.urgency}]`;
                    if (p.plan) context += ` — ${p.plan}`;
                    context += '\n';
                });
                context += '\n';
            }
            if (st.aiOneLiner) {
                context += `ONE-LINER: ${st.aiOneLiner}\n\n`;
            }
        }

        // 3. Simulation state (vitals, trajectory)
        if (typeof SimulationEngine !== 'undefined') {
            const state = SimulationEngine.getState();
            if (state) {
                if (state.vitals) {
                    const v = state.vitals;
                    context += `CURRENT VITALS: BP ${Math.round(v.systolic)}/${Math.round(v.diastolic)}, HR ${Math.round(v.heartRate)}, RR ${Math.round(v.respiratoryRate)}, SpO2 ${Math.round(v.oxygenSaturation)}%`;
                    if (v.temperature) context += `, Temp ${v.temperature.toFixed(1)}°F`;
                    context += '\n';
                }
                if (state.trajectory) {
                    context += `TRAJECTORY: Patient is ${state.trajectory}\n`;
                }
                if (state.physiology) {
                    const p = state.physiology;
                    if (p.fluidOverload !== undefined) {
                        context += `FLUID STATUS: ${p.fluidOverload > 0 ? '+' : ''}${p.fluidOverload.toFixed(1)} kg from dry weight\n`;
                    }
                    if (p.urineOutput) {
                        context += `URINE OUTPUT: ${Math.round(p.urineOutput)} mL/hr\n`;
                    }
                }
                if (state.symptoms) {
                    const s = state.symptoms;
                    const parts = [];
                    if (s.dyspnea >= 6) parts.push('severe dyspnea');
                    else if (s.dyspnea >= 4) parts.push('moderate dyspnea');
                    else if (s.dyspnea >= 2) parts.push('mild dyspnea');
                    if (s.edema >= 3) parts.push('significant edema');
                    else if (s.edema >= 2) parts.push('moderate edema');
                    if (s.fatigue >= 5) parts.push('significant fatigue');
                    if (parts.length > 0) context += `SYMPTOMS: ${parts.join(', ')}\n`;
                }
                context += '\n';
            }
        }

        // 4. Active interventions
        if (typeof InterventionTracker !== 'undefined') {
            const interventions = InterventionTracker.getActiveInterventions();
            if (interventions.length > 0) {
                context += `ACTIVE TREATMENTS:\n`;
                interventions.forEach(i => {
                    context += `- ${i.name}${i.dose ? ` ${i.dose}` : ''}${i.route ? ` ${i.route}` : ''} (${Math.round(i.elapsedMinutes || 0)} min ago)\n`;
                });
                context += '\n';
            }
        }

        // 5. Patient demographics
        if (typeof PatientHeader !== 'undefined' && PatientHeader.currentPatient) {
            const p = PatientHeader.currentPatient;
            const age = typeof DateUtils !== 'undefined' ? DateUtils.calculateAge(p.dateOfBirth) : '';
            context += `DEMOGRAPHICS: ${p.firstName} ${p.lastName}, ${age}${p.sex ? ' ' + p.sex : ''}\n`;
        }

        return context;
    },

    /**
     * Generate a patient-friendly summary
     */
    async generatePatientSummary() {
        if (this.loading.patient) return this.cache.patient.text;

        // Check cache
        if (this.cache.patient.text && (Date.now() - this.cache.patient.timestamp) < this.CACHE_TTL) {
            return this.cache.patient.text;
        }

        // Check API
        if (!ClaudeAPI.isConfigured()) {
            if (typeof AICoworker !== 'undefined') AICoworker.loadApiKey();
            if (!ClaudeAPI.isConfigured()) return 'API key not configured.';
        }

        this.loading.patient = true;
        this._updatePanelUI('patient', 'loading');

        try {
            const context = this._buildContext();
            if (!context.trim()) {
                this.loading.patient = false;
                this._updatePanelUI('patient', 'empty');
                return 'No clinical information available yet. Open the AI panel and review the patient chart first.';
            }

            const systemPrompt = `You are generating a brief patient-friendly summary of what is happening with their care.

Write as if you are speaking directly TO the patient in plain, warm, reassuring language.
- Use "you" and "your" — speak to them
- Avoid ALL medical jargon — translate everything to plain language
- Keep it to 3-4 sentences maximum
- Mention: why they are here, what the doctors are worried about, what the current plan is
- Be honest but reassuring — don't minimize, but frame things with care
- Use language a 6th grader could understand

Example tone: "You're here because you've been having trouble breathing. Your doctors think your heart may not be pumping fluid as well as it should, which can cause fluid to build up in your lungs and legs. The plan right now is to give you medicine through your IV to help your body get rid of that extra fluid, and they're keeping a close eye on your blood work and how much you're urinating to make sure it's working."`;

            const response = await ClaudeAPI.chat(systemPrompt, [
                { role: 'user', content: `Here is the current clinical context for this patient. Generate a patient-friendly summary:\n\n${context}` }
            ]);

            this.cache.patient = { text: response, timestamp: Date.now() };
            this.loading.patient = false;
            this._updatePanelUI('patient', 'ready');
            return response;

        } catch (error) {
            console.error('Patient summary generation error:', error);
            this.loading.patient = false;
            this._updatePanelUI('patient', 'error');
            return 'Unable to generate summary right now.';
        }
    },

    /**
     * Generate a bedside nurse clinical summary
     */
    async generateNurseSummary() {
        if (this.loading.nurse) return this.cache.nurse.text;

        // Check cache
        if (this.cache.nurse.text && (Date.now() - this.cache.nurse.timestamp) < this.CACHE_TTL) {
            return this.cache.nurse.text;
        }

        // Check API
        if (!ClaudeAPI.isConfigured()) {
            if (typeof AICoworker !== 'undefined') AICoworker.loadApiKey();
            if (!ClaudeAPI.isConfigured()) return 'API key not configured.';
        }

        this.loading.nurse = true;
        this._updatePanelUI('nurse', 'loading');

        try {
            const context = this._buildContext();
            if (!context.trim()) {
                this.loading.nurse = false;
                this._updatePanelUI('nurse', 'empty');
                return 'No clinical information available yet.';
            }

            const systemPrompt = `You are generating a brief clinical situation report for the bedside nurse.

Write a concise, structured nursing handoff summary:
- Start with a one-line patient identifier and chief complaint
- Active problems with current status (2-3 bullet points)
- Current treatments and monitoring parameters
- Key things to watch for / escalation triggers
- Keep it to 4-6 lines total — concise and actionable
- Use standard clinical shorthand (BP, HR, SpO2, I&O, etc.)
- Focus on what the NURSE needs to know right now for safe care`;

            const response = await ClaudeAPI.chat(systemPrompt, [
                { role: 'user', content: `Generate a bedside nurse situation report from this clinical context:\n\n${context}` }
            ]);

            this.cache.nurse = { text: response, timestamp: Date.now() };
            this.loading.nurse = false;
            this._updatePanelUI('nurse', 'ready');
            return response;

        } catch (error) {
            console.error('Nurse summary generation error:', error);
            this.loading.nurse = false;
            this._updatePanelUI('nurse', 'error');
            return 'Unable to generate summary right now.';
        }
    },

    /**
     * Generate a case manager discharge planning summary
     */
    async generateCaseManagerSummary() {
        if (this.loading.caseManager) return this.cache.caseManager.text;

        // Check cache
        if (this.cache.caseManager.text && (Date.now() - this.cache.caseManager.timestamp) < this.CACHE_TTL) {
            return this.cache.caseManager.text;
        }

        // Check API
        if (!ClaudeAPI.isConfigured()) {
            if (typeof AICoworker !== 'undefined') AICoworker.loadApiKey();
            if (!ClaudeAPI.isConfigured()) return 'API key not configured.';
        }

        this.loading.caseManager = true;
        this._updatePanelUI('nurse', 'loading');

        try {
            const context = this._buildContext();
            if (!context.trim()) {
                this.loading.caseManager = false;
                this._updatePanelUI('nurse', 'empty');
                return 'No clinical information available yet.';
            }

            const systemPrompt = `You are generating a case management / discharge planning summary.

Focus on disposition and transitions of care:
- Anticipated discharge date/timeframe (estimate based on clinical trajectory)
- Discharge disposition (home, SNF, rehab, home with services)
- Barriers to discharge (pending workup, social needs, medication access, follow-up)
- Medication reconciliation needs (new meds, dose changes, prior auth)
- Follow-up appointments needed
- Patient/family education needs
- Home services that may be needed (home health, PT/OT, DME)
- Insurance/authorization considerations if relevant

Keep it structured with bullet points, 5-8 lines max. Be practical and anticipatory — what does the care team need to start working on NOW to avoid discharge delays?`;

            const response = await ClaudeAPI.chat(systemPrompt, [
                { role: 'user', content: `Generate a case management discharge planning summary from this clinical context:\n\n${context}` }
            ]);

            this.cache.caseManager = { text: response, timestamp: Date.now() };
            this.loading.caseManager = false;
            this._updatePanelUI('nurse', 'ready');
            return response;

        } catch (error) {
            console.error('Case manager summary generation error:', error);
            this.loading.caseManager = false;
            this._updatePanelUI('nurse', 'error');
            return 'Unable to generate summary right now.';
        }
    },

    /**
     * Toggle the nurse panel between bedside and case manager mode
     */
    async toggleNurseMode() {
        this.nurseMode = this.nurseMode === 'bedside' ? 'caseManager' : 'bedside';

        // Update toggle UI
        const toggle = document.getElementById('nurse-summary-toggle');
        if (toggle) {
            toggle.classList.toggle('case-manager', this.nurseMode === 'caseManager');
        }
        const label = document.getElementById('nurse-summary-toggle-label');
        if (label) {
            label.textContent = this.nurseMode === 'bedside' ? 'Bedside RN' : 'Case Mgmt';
        }

        // Generate appropriate summary
        await this.refreshNurseSummary();
    },

    /**
     * Refresh the nurse summary based on current mode
     */
    async refreshNurseSummary() {
        const text = this.nurseMode === 'bedside'
            ? await this.generateNurseSummary()
            : await this.generateCaseManagerSummary();

        const textEl = document.getElementById('nurse-summary-text');
        if (textEl) {
            textEl.textContent = text;
        }
    },

    /**
     * Refresh the patient summary
     */
    async refreshPatientSummary() {
        // Clear cache to force regeneration
        this.cache.patient = { text: '', timestamp: 0 };
        const text = await this.generatePatientSummary();
        const textEl = document.getElementById('patient-summary-text');
        if (textEl) {
            textEl.textContent = text;
        }
    },

    /**
     * Force refresh nurse summary (clears cache)
     */
    async forceRefreshNurseSummary() {
        if (this.nurseMode === 'bedside') {
            this.cache.nurse = { text: '', timestamp: 0 };
        } else {
            this.cache.caseManager = { text: '', timestamp: 0 };
        }
        await this.refreshNurseSummary();
    },

    /**
     * Toggle panel collapse/expand
     */
    togglePanel(chatType) {
        const panel = document.getElementById(`${chatType}-summary-panel`);
        if (!panel) return;
        panel.classList.toggle('collapsed');

        const icon = panel.querySelector('.summary-panel-collapse-icon');
        if (icon) {
            icon.textContent = panel.classList.contains('collapsed') ? '▸' : '▾';
        }
    },

    /**
     * Initialize a summary panel when a chat window opens
     */
    async initPanel(chatType) {
        const panel = document.getElementById(`${chatType}-summary-panel`);
        if (!panel) return;

        if (chatType === 'patient') {
            const text = await this.generatePatientSummary();
            const textEl = document.getElementById('patient-summary-text');
            if (textEl) textEl.textContent = text;
        } else if (chatType === 'nurse') {
            await this.refreshNurseSummary();
        }
    },

    /**
     * Update the panel UI based on state
     */
    _updatePanelUI(chatType, state) {
        // For nurse mode, the panel ID is always 'nurse'
        const panelId = chatType === 'caseManager' ? 'nurse' : chatType;
        const panel = document.getElementById(`${panelId}-summary-panel`);
        if (!panel) return;

        const textEl = chatType === 'patient'
            ? document.getElementById('patient-summary-text')
            : document.getElementById('nurse-summary-text');

        const refreshBtn = panel.querySelector('.summary-panel-refresh');

        if (state === 'loading') {
            if (textEl) textEl.innerHTML = '<span class="summary-loading-dots">Generating summary<span>.</span><span>.</span><span>.</span></span>';
            if (refreshBtn) refreshBtn.classList.add('spinning');
        } else if (state === 'ready') {
            if (refreshBtn) refreshBtn.classList.remove('spinning');
        } else if (state === 'error') {
            if (refreshBtn) refreshBtn.classList.remove('spinning');
        } else if (state === 'empty') {
            if (refreshBtn) refreshBtn.classList.remove('spinning');
        }
    },

    /**
     * Get the HTML for the patient summary panel
     */
    getPatientPanelHTML() {
        return `
            <div id="patient-summary-panel" class="chat-summary-panel patient-summary-panel">
                <div class="summary-panel-header" onclick="ChatSummaryPanel.togglePanel('patient')">
                    <div class="summary-panel-header-left">
                        <span class="summary-panel-collapse-icon">▾</span>
                        <span class="summary-panel-icon">💡</span>
                        <span class="summary-panel-title">What's happening with your care</span>
                    </div>
                    <button class="summary-panel-refresh" onclick="event.stopPropagation(); ChatSummaryPanel.refreshPatientSummary()" title="Refresh summary">
                        <span>↻</span>
                    </button>
                </div>
                <div class="summary-panel-body">
                    <div id="patient-summary-text" class="summary-panel-text">
                        <span class="summary-loading-dots">Generating summary<span>.</span><span>.</span><span>.</span></span>
                    </div>
                </div>
            </div>`;
    },

    /**
     * Get the HTML for the nurse summary panel (with bedside/case manager toggle)
     */
    getNursePanelHTML() {
        return `
            <div id="nurse-summary-panel" class="chat-summary-panel nurse-summary-panel">
                <div class="summary-panel-header" onclick="ChatSummaryPanel.togglePanel('nurse')">
                    <div class="summary-panel-header-left">
                        <span class="summary-panel-collapse-icon">▾</span>
                        <span class="summary-panel-icon">📋</span>
                        <span class="summary-panel-title">Situation Report</span>
                    </div>
                    <div class="summary-panel-header-right" onclick="event.stopPropagation()">
                        <div class="nurse-mode-toggle" onclick="ChatSummaryPanel.toggleNurseMode()">
                            <span id="nurse-summary-toggle-label" class="toggle-label">Bedside RN</span>
                            <div id="nurse-summary-toggle" class="toggle-track">
                                <div class="toggle-thumb"></div>
                            </div>
                        </div>
                        <button class="summary-panel-refresh" onclick="ChatSummaryPanel.forceRefreshNurseSummary()" title="Refresh summary">
                            <span>↻</span>
                        </button>
                    </div>
                </div>
                <div class="summary-panel-body">
                    <div id="nurse-summary-text" class="summary-panel-text">
                        <span class="summary-loading-dots">Generating summary<span>.</span><span>.</span><span>.</span></span>
                    </div>
                </div>
            </div>`;
    }
};

window.ChatSummaryPanel = ChatSummaryPanel;
