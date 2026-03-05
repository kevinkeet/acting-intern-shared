/**
 * AI Mode Configuration
 *
 * Defines three AI assistant modes: Light, Medium, Heavy.
 * Controls system prompt personality, visible sections, suggestion chips,
 * proactive behavior, and response verbosity.
 *
 * Light  — Minimal. Does tasks when asked, doesn't push opinions.
 * Medium — Balanced copilot. Mirrors thinking, surfaces data, flags safety.
 * Heavy  — Maximalist attending. Teaches, challenges, offers own assessment.
 */

const AIModeConfig = {
    MODES: {
        'light': {
            id: 'light',
            label: 'Light',
            icon: '\u25CB',     // ○
            description: 'Does what you ask. Minimal opinions.',
            sections: {
                alertBar: true,
                clinicalSummary: false,
                problemList: false,
                suggestedActions: false,
                conversationThread: true,
                teachingPoints: false,
                ddxChallenge: false
            },
            chips: [
                { label: 'Summarize', prompt: 'Summarize case briefly' },
                { label: 'Orders?', prompt: 'What orders are pending?' },
                { label: 'Labs', prompt: 'Show recent lab results' }
            ],
            proactive: {
                autoRefreshOnExpand: false,
                autoSynthesizeOnDictation: false
            },
            responseStyle: {
                maxTokensAsk: 1024,
                maxTokensDictation: 1500,
                maxTokensRefresh: 2000,
                personalityPrefix: 'You are a minimal clinical task assistant. Be extremely brief. Only answer what is asked. Do not volunteer opinions, teaching points, or differential diagnoses unless explicitly requested. Keep responses under 3 sentences when possible.',
                includeTeachingPoints: false,
                includeDDxChallenge: false
            }
        },
        'medium': {
            id: 'medium',
            label: 'Medium',
            icon: '\u25D0',     // ◐
            description: 'Balanced. Mirrors your thinking, flags safety.',
            sections: {
                alertBar: true,
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
            }
        },
        'heavy': {
            id: 'heavy',
            label: 'Heavy',
            icon: '\u25CF',     // ●
            description: 'Opinionated. Teaches, challenges, leads.',
            sections: {
                alertBar: true,
                clinicalSummary: true,
                problemList: true,
                suggestedActions: true,
                conversationThread: true,
                teachingPoints: true,
                ddxChallenge: true
            },
            chips: [
                { label: 'Teach me', prompt: 'What should I learn from this case?' },
                { label: 'Challenge DDx', prompt: 'Challenge my differential diagnosis. What am I missing?' },
                { label: 'Critique plan', prompt: 'Critique my current plan. What would you change?' },
                { label: 'Pimp me', prompt: 'Ask me a tough clinical question about this case' }
            ],
            proactive: {
                autoRefreshOnExpand: true,
                autoSynthesizeOnDictation: true
            },
            responseStyle: {
                maxTokensAsk: 4096,
                maxTokensDictation: 4096,
                maxTokensRefresh: 4096,
                personalityPrefix: `You are a senior attending physician who is brilliant, opinionated, and a great teacher. You:
- Actively push differential diagnoses and challenge the learner's thinking
- Offer your own assessment when you have one, clearly labeled as "My thinking:"
- Provide teaching points relevant to the case (evidence-based, practical pearls)
- Point out things the doctor may have missed or not considered
- Use Socratic questioning when appropriate
- Are direct and confident but not dismissive
- Flag when the doctor's plan diverges from best practices
- Include a "Teaching Point" section in your synthesis responses

Include these additional JSON fields in your synthesis:
"teachingPoints": ["Clinical pearl or evidence-based teaching point relevant to this case"],
"ddxChallenge": "A brief challenge to the current differential — what else should be considered and why?"`,
                includeTeachingPoints: true,
                includeDDxChallenge: true
            }
        }
    },

    currentMode: 'medium',

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
     * Load saved mode from localStorage
     */
    loadMode() {
        var saved = localStorage.getItem('ai-assistant-mode');
        if (saved && this.MODES[saved]) {
            this.currentMode = saved;
        }
    },

    /**
     * Initialize — load persisted mode
     */
    init() {
        this.loadMode();
    }
};

window.AIModeConfig = AIModeConfig;
