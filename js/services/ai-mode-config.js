/**
 * AI Mode Configuration
 *
 * Defines three AI assistant modes that differ STRUCTURALLY — not just by prompt.
 *
 * Follow  — Butler. Executes tasks the doctor requests. No unsolicited analysis.
 *           Shows only a minimal context line + conversation thread.
 *           Full internal context is maintained so it can interpret orders correctly.
 *
 * Abreast — Copilot. Mirrors the doctor's thinking, surfaces relevant data,
 *           flags safety concerns. Balanced analysis.
 *
 * Lead    — Senior colleague. Opinionated, challenges DDx, full analysis.
 *           No teaching points — treats the user as a peer, not a learner.
 *
 * Each mode has editable promptSections (summary, problemList, actions)
 * that persist to localStorage when customized by the user.
 */

const AIModeConfig = {
    MODES: {
        'follow': {
            id: 'follow',
            label: 'Follow',
            icon: '\u25CB',     // ○
            description: 'Follows your lead. Executes tasks, no unsolicited analysis.',
            sections: {
                alertBar: true,           // Safety flags always visible
                contextLine: true,        // Minimal 1-line patient context
                clinicalSummary: false,    // No full summary
                problemList: false,        // No problem list
                suggestedActions: false,   // No suggested actions
                conversationThread: true,  // Chat history
                teachingPoints: false,
                ddxChallenge: false
            },
            chips: [
                { label: 'Place Order', prompt: 'Help me place an order' },
                { label: 'Check Labs', prompt: 'Show me the latest lab results' },
                { label: 'Summarize', prompt: 'Give me a brief summary of this patient' }
            ],
            proactive: {
                autoRefreshOnExpand: false,       // No auto-analysis
                autoSynthesizeOnDictation: false   // No auto-synthesis
            },
            responseStyle: {
                maxTokensAsk: 1024,
                maxTokensDictation: 800,
                maxTokensRefresh: 1200,
                personalityPrefix: 'You are a clinical order entry assistant and scribe. Execute tasks the physician requests. Do not offer clinical opinions, differentials, or analysis unless explicitly asked. Keep responses under 3 sentences. When the doctor dictates clinical thinking, acknowledge it and note any actionable orders — do NOT synthesize a full clinical analysis or generate a problem list.',
                includeTeachingPoints: false,
                includeDDxChallenge: false
            },
            promptSections: {
                summary: 'Not used in Follow mode.',
                problemList: 'Not used in Follow mode.',
                actions: 'Not used in Follow mode.'
            }
        },
        'abreast': {
            id: 'abreast',
            label: 'Abreast',
            icon: '\u25D0',     // ◐
            description: 'Stays alongside. Mirrors your thinking, flags safety.',
            sections: {
                alertBar: true,
                contextLine: false,
                clinicalSummary: true,
                problemList: true,
                suggestedActions: true,
                conversationThread: true,
                teachingPoints: false,
                ddxChallenge: false
            },
            chips: [
                { label: 'Summarize', prompt: 'Summarize case' },
                { label: 'Concerns?', prompt: 'What are the key concerns?' },
                { label: 'Missing?', prompt: "What haven't I checked yet?" }
            ],
            proactive: {
                autoRefreshOnExpand: true,
                autoSynthesizeOnDictation: true
            },
            responseStyle: {
                maxTokensAsk: 2048,
                maxTokensDictation: 2500,
                maxTokensRefresh: 3000,
                personalityPrefix: '',  // empty = existing prompts unchanged
                includeTeachingPoints: false,
                includeDDxChallenge: false
            },
            promptSections: {
                summary: 'Concise 3-sentence clinical summary. Demographics/PMH in one sentence, functional status in one sentence, current presentation in one sentence. Use clinical shorthand.',
                problemList: 'Concise problem list with brief 1-sentence plans. Include DDx for the chief complaint only. Keep each problem entry short.',
                actions: 'Standard categorized actions. 1-3 items per category. Each action is one discrete step with an action verb.'
            }
        },
        'lead': {
            id: 'lead',
            label: 'Lead',
            icon: '\u25CF',     // ●
            description: 'Opinionated. Challenges your thinking, full analysis.',
            sections: {
                alertBar: true,
                contextLine: false,
                clinicalSummary: true,
                problemList: true,
                suggestedActions: true,
                conversationThread: true,
                teachingPoints: false,
                ddxChallenge: true
            },
            chips: [
                { label: 'Challenge DDx', prompt: 'Challenge my differential diagnosis. What am I missing?' },
                { label: 'Critique plan', prompt: 'Critique my current plan. What would you change?' },
                { label: 'What else?', prompt: 'What am I not considering in this case?' },
                { label: 'Deep dive', prompt: 'Give me a deep analysis of the most critical problem' }
            ],
            proactive: {
                autoRefreshOnExpand: true,
                autoSynthesizeOnDictation: true
            },
            responseStyle: {
                maxTokensAsk: 4096,
                maxTokensDictation: 4096,
                maxTokensRefresh: 4096,
                personalityPrefix: `You are a senior attending physician who is brilliant, opinionated, and direct. You:
- Actively push differential diagnoses and challenge the doctor's thinking
- Offer your own assessment when you have one, clearly labeled as "My thinking:"
- Point out things the doctor may have missed or not considered
- Are direct and confident but not dismissive
- Flag when the doctor's plan diverges from best practices or guidelines

Include this additional JSON field in your synthesis:
"ddxChallenge": "A brief challenge to the current differential — what else should be considered and why?"`,
                includeTeachingPoints: false,
                includeDDxChallenge: true
            },
            promptSections: {
                summary: 'Comprehensive clinical summary with detailed qualifiers for every diagnosis. Include treatment regimens, baseline values, specific severity markers. Be thorough.',
                problemList: 'Detailed problem list with full differential diagnoses and reasoning for each problem. Include evidence for and against each DDx item. Detailed plans with rationale.',
                actions: 'Comprehensive action set across all categories. Include detailed indications and clinical reasoning for each order. Be thorough — don\'t leave out steps.'
            }
        }
    },

    currentMode: 'abreast',

    /**
     * Get the current mode configuration
     */
    getMode() {
        return this.MODES[this.currentMode];
    },

    /**
     * Set the active mode
     */
    setMode(modeId) {
        if (!this.MODES[modeId]) return;
        this.currentMode = modeId;
        localStorage.setItem('ai-assistant-mode', modeId);
        // Dispatch event for other components to react
        window.dispatchEvent(new CustomEvent('ai-mode-changed', { detail: { mode: modeId } }));
    },

    /**
     * Get a prompt section for a mode — returns custom override if saved, else default.
     * @param {string} modeId - 'follow', 'abreast', or 'lead'
     * @param {string} section - 'summary', 'problemList', or 'actions'
     * @returns {string} The prompt section text
     */
    getModePromptSection(modeId, section) {
        var key = 'modePrompt_' + modeId + '_' + section;
        var custom = localStorage.getItem(key);
        if (custom !== null) return custom;
        var mode = this.MODES[modeId];
        if (mode && mode.promptSections && mode.promptSections[section]) {
            return mode.promptSections[section];
        }
        return '';
    },

    /**
     * Save a custom prompt section override for a mode.
     */
    saveModePromptSection(modeId, section, text) {
        var key = 'modePrompt_' + modeId + '_' + section;
        localStorage.setItem(key, text);
    },

    /**
     * Reset a prompt section for a mode to its default.
     */
    resetModePromptSection(modeId, section) {
        var key = 'modePrompt_' + modeId + '_' + section;
        localStorage.removeItem(key);
    },

    /**
     * Reset ALL prompt sections for a mode to defaults.
     */
    resetAllModePromptSections(modeId) {
        ['summary', 'problemList', 'actions'].forEach(function(section) {
            localStorage.removeItem('modePrompt_' + modeId + '_' + section);
        });
    },

    /**
     * Check if a mode has a custom override for a given section.
     */
    hasCustomModePrompt(modeId, section) {
        var key = 'modePrompt_' + modeId + '_' + section;
        return localStorage.getItem(key) !== null;
    },

    /**
     * Load saved mode from localStorage, with migration from old names
     */
    loadMode() {
        var saved = localStorage.getItem('ai-assistant-mode');
        // Migration: old mode names → new mode names
        var migration = { 'light': 'follow', 'medium': 'abreast', 'heavy': 'lead' };
        if (saved && migration[saved]) {
            saved = migration[saved];
            localStorage.setItem('ai-assistant-mode', saved);
        }
        if (saved && this.MODES[saved]) {
            this.currentMode = saved;
        }
    },

    /**
     * Initialize — load persisted mode and migrate old data
     */
    init() {
        this.loadMode();
        // Migrate custom prompt keys from old mode names
        var migrations = { 'light': 'follow', 'medium': 'abreast', 'heavy': 'lead' };
        ['summary', 'problemList', 'actions'].forEach(function(section) {
            Object.keys(migrations).forEach(function(oldId) {
                var oldKey = 'modePrompt_' + oldId + '_' + section;
                var newKey = 'modePrompt_' + migrations[oldId] + '_' + section;
                var oldVal = localStorage.getItem(oldKey);
                if (oldVal !== null && localStorage.getItem(newKey) === null) {
                    localStorage.setItem(newKey, oldVal);
                    localStorage.removeItem(oldKey);
                }
            });
        });
    }
};

window.AIModeConfig = AIModeConfig;
