// ai-preferences.js — User preferences system for AI clinical assistant
// Stores in localStorage, auto-syncs to Supabase via monkey-patch in supabase-sync.js

const AIPreferences = (() => {
    const STORAGE_KEY = 'ai-user-preferences';

    const DEFAULTS = {
        assertiveness: 3,
        detailLevels: {
            summary: 'moderate',
            problemList: 'moderate',
            actions: 'moderate',
            thinking: 'brief'
        },
        summarySections: [
            { key: 'demographics', label: 'ID', instruction: 'HPI-style: age, sex, key PMH with specific qualifiers (EF%, treatment regimen, anticoagulation status, baseline Cr/eGFR)' },
            { key: 'functional', label: 'USOH', instruction: 'Functional status, living situation, ADL/IADL dependence, mobility, caregiver, key psychosocial factors' },
            { key: 'presentation', label: 'NOW', instruction: 'Chief complaint with timeline, significant exam findings, pertinent negatives, key abnormal labs with actual values' }
        ],
        noteTemplates: {},
        globalInstruction: ''
    };

    const ASSERTIVENESS_LABELS = {
        1: 'Passive — Only answers direct questions',
        2: 'Quiet — Brief observations, defers to physician',
        3: 'Balanced — Summarizes, suggests, flags safety concerns',
        4: 'Proactive — Challenges differential, pushes thinking',
        5: 'Senior Attending — Opinionated, debates, teaches'
    };

    const ASSERTIVENESS_PREFIXES = {
        1: 'You are a passive clinical reference. Only provide information when directly asked. Never volunteer opinions or suggestions.',
        2: 'You are a quiet clinical observer. Offer brief observations when relevant but defer to the physician\'s judgment.',
        3: 'You are a balanced clinical assistant. Summarize findings, suggest actions, and flag safety concerns proactively.',
        4: 'You are a proactive clinical partner. Challenge the differential diagnosis, push the physician\'s thinking, and suggest evidence-based alternatives.',
        5: 'You are a senior attending physician. Be opinionated. Debate clinical decisions, teach through questioning, and hold the physician to high standards.'
    };

    const DEFAULT_NOTE_TYPES = ['Progress', 'H&P', 'Discharge', 'Patient Instructions', 'Patient Letter'];

    // --- Helpers ---

    function deepClone(obj) {
        return JSON.parse(JSON.stringify(obj));
    }

    function deepMerge(target, source) {
        const result = deepClone(target);
        for (const key of Object.keys(source)) {
            if (source[key] && typeof source[key] === 'object' && !Array.isArray(source[key])) {
                result[key] = deepMerge(result[key] || {}, source[key]);
            } else {
                result[key] = deepClone(source[key] !== undefined ? source[key] : target[key]);
            }
        }
        return result;
    }

    function log(...args) {
        console.log('\u2699\uFE0F', ...args);
    }

    // --- Storage Methods ---

    function get() {
        try {
            const raw = localStorage.getItem(STORAGE_KEY);
            if (!raw) return deepClone(DEFAULTS);
            const parsed = JSON.parse(raw);
            return deepMerge(DEFAULTS, parsed);
        } catch (e) {
            log('Error reading preferences, returning defaults:', e.message);
            return deepClone(DEFAULTS);
        }
    }

    function set(prefs) {
        try {
            localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs));
            log('Preferences saved');
        } catch (e) {
            log('Error saving preferences:', e.message);
        }
    }

    function update(partial) {
        const current = get();
        const merged = deepMerge(current, partial);
        set(merged);
        return merged;
    }

    function reset() {
        localStorage.removeItem(STORAGE_KEY);
        log('Preferences reset to defaults');
    }

    function getDefaults() {
        return deepClone(DEFAULTS);
    }

    // --- Accessor Methods ---

    function getAssertiveness() {
        return get().assertiveness;
    }

    function getDetailLevel(section) {
        const levels = get().detailLevels;
        return levels[section] || 'moderate';
    }

    function getSummarySections() {
        return get().summarySections;
    }

    function getNoteTemplate(noteType) {
        const templates = get().noteTemplates;
        return templates[noteType] || null;
    }

    function getGlobalInstruction() {
        return get().globalInstruction || '';
    }

    // --- Prompt Generation Methods ---

    function buildPersonalityPrefix(modePrefix) {
        const level = getAssertiveness();
        const assertPrefix = ASSERTIVENESS_PREFIXES[level] || ASSERTIVENESS_PREFIXES[3];
        if (modePrefix) {
            return assertPrefix + '\n\n' + modePrefix;
        }
        return assertPrefix;
    }

    function buildSectionInstructions(modeInstructions) {
        const levels = get().detailLevels;
        const parts = [];

        for (const [section, level] of Object.entries(levels)) {
            if (level === 'brief') {
                parts.push(`For ${section}: Be extremely concise. 1-2 sentences max. Use abbreviations freely.`);
            } else if (level === 'detailed') {
                parts.push(`For ${section}: Be comprehensive. Include all relevant details, clinical reasoning, and evidence.`);
            } else {
                // moderate — use mode default or generic
                const modeDefault = modeInstructions && modeInstructions[section];
                parts.push(modeDefault || `For ${section}: Be concise but thorough.`);
            }
        }

        return parts.join('\n');
    }

    function buildSummaryFormatSpec() {
        const sections = getSummarySections();
        return '"clinicalSummary": {\n' +
            sections.map(s => `    "${s.key}": "${s.instruction}"`).join(',\n') +
            '\n}';
    }

    function buildNoteTemplateInstruction(noteType) {
        const template = getNoteTemplate(noteType);
        if (template) {
            return '\n\nIMPORTANT: Follow this exact note template format:\n' + template;
        }
        return '';
    }

    // --- Customize UI Panel ---

    function openCustomizePanel() {
        const _draft = get();

        // Build overlay
        const overlay = document.createElement('div');
        overlay.className = 'about-modal-overlay customize-overlay';
        overlay.style.cssText = 'display:flex; align-items:center; justify-content:center; z-index:10000;';

        const panel = document.createElement('div');
        panel.className = 'customize-panel';
        panel.innerHTML = `
            <div class="customize-header">
                <h2>AI Preferences</h2>
                <button class="customize-close" aria-label="Close">&times;</button>
            </div>
            <div class="customize-body">
                ${renderAssertiveness(_draft)}
                ${renderDetailLevels(_draft)}
                ${renderSummarySections(_draft)}
                ${renderNoteTemplates(_draft)}
                ${renderGlobalInstruction(_draft)}
            </div>
            <div class="customize-footer">
                <button class="btn customize-reset">Reset to Defaults</button>
                <button class="btn btn-primary customize-save">Save</button>
            </div>
        `;
        overlay.appendChild(panel);
        document.body.appendChild(overlay);
        injectStyles();

        // --- Bind Events ---

        // Close
        const closePanel = () => overlay.remove();
        panel.querySelector('.customize-close').addEventListener('click', closePanel);
        overlay.addEventListener('click', (e) => { if (e.target === overlay) closePanel(); });
        document.addEventListener('keydown', function escHandler(e) {
            if (e.key === 'Escape') { closePanel(); document.removeEventListener('keydown', escHandler); }
        });

        // Assertiveness slider
        const slider = panel.querySelector('#customize-assertiveness');
        const sliderLabel = panel.querySelector('.customize-assertiveness-label');
        slider.addEventListener('input', () => {
            const val = parseInt(slider.value);
            _draft.assertiveness = val;
            sliderLabel.textContent = `Level ${val}: ${ASSERTIVENESS_LABELS[val]}`;
        });

        // Detail level buttons
        panel.querySelectorAll('.customize-detail-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                const section = btn.dataset.section;
                const level = btn.dataset.level;
                _draft.detailLevels[section] = level;
                // Update active state
                panel.querySelectorAll(`.customize-detail-btn[data-section="${section}"]`).forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
            });
        });

        // Summary sections
        bindSummarySectionEvents(panel, _draft);

        // Note templates
        bindNoteTemplateEvents(panel, _draft);

        // Global instruction
        const globalTextarea = panel.querySelector('#customize-global-instruction');
        globalTextarea.addEventListener('input', () => {
            _draft.globalInstruction = globalTextarea.value;
        });

        // Save
        panel.querySelector('.customize-save').addEventListener('click', () => {
            set(_draft);
            closePanel();
            showToast('AI preferences saved');
        });

        // Reset
        panel.querySelector('.customize-reset').addEventListener('click', () => {
            if (confirm('Reset all AI preferences to defaults? This cannot be undone.')) {
                reset();
                closePanel();
                showToast('AI preferences reset to defaults');
            }
        });
    }

    // --- Render Helpers ---

    function renderAssertiveness(draft) {
        const val = draft.assertiveness;
        return `
            <div class="customize-section">
                <h3>Assertiveness</h3>
                <input type="range" id="customize-assertiveness" min="1" max="5" step="1" value="${val}" class="customize-slider">
                <div class="customize-assertiveness-label">Level ${val}: ${ASSERTIVENESS_LABELS[val]}</div>
            </div>`;
    }

    function renderDetailLevels(draft) {
        const sections = [
            { key: 'summary', label: 'Summary' },
            { key: 'problemList', label: 'Problem List' },
            { key: 'actions', label: 'Actions' },
            { key: 'thinking', label: 'Thinking' }
        ];
        const levels = ['brief', 'moderate', 'detailed'];
        const rows = sections.map(s => {
            const btns = levels.map(l => {
                const active = draft.detailLevels[s.key] === l ? 'active' : '';
                return `<button class="btn customize-detail-btn ${active}" data-section="${s.key}" data-level="${l}">${capitalize(l)}</button>`;
            }).join('');
            return `<div class="customize-detail-row"><span class="customize-detail-label">${s.label}</span><div class="customize-detail-btns">${btns}</div></div>`;
        }).join('');
        return `<div class="customize-section"><h3>Detail Levels</h3>${rows}</div>`;
    }

    function renderSummarySections(draft) {
        const rows = draft.summarySections.map((s, i) => renderSummarySectionRow(s, i)).join('');
        return `
            <div class="customize-section" id="customize-summary-sections">
                <h3>Clinical Summary Structure</h3>
                <div class="customize-summary-list">${rows}</div>
                <button class="btn customize-add-section">+ Add Section</button>
            </div>`;
    }

    function renderSummarySectionRow(section, index) {
        return `
            <div class="customize-summary-row" data-index="${index}">
                <input type="text" class="customize-summary-label" value="${escapeAttr(section.label)}" placeholder="Label" maxlength="10">
                <textarea class="customize-summary-instruction" placeholder="Instruction for this section">${escapeHtml(section.instruction)}</textarea>
                <button class="btn customize-delete-section" data-index="${index}">&times;</button>
            </div>`;
    }

    function renderNoteTemplates(draft) {
        const allTypes = [...new Set([...DEFAULT_NOTE_TYPES, ...Object.keys(draft.noteTemplates)])];
        const rows = allTypes.map(type => {
            const hasCustom = !!draft.noteTemplates[type];
            const badge = hasCustom ? '<span class="customize-badge custom">Custom \u270E</span>' : '<span class="customize-badge default">Default</span>';
            return `
                <div class="customize-note-row" data-type="${escapeAttr(type)}">
                    <span class="customize-note-name">${escapeHtml(type)}</span>
                    ${badge}
                    <button class="btn customize-note-edit" data-type="${escapeAttr(type)}">Edit</button>
                    ${hasCustom ? `<button class="btn customize-note-delete" data-type="${escapeAttr(type)}">Delete</button>` : ''}
                </div>`;
        }).join('');
        return `
            <div class="customize-section" id="customize-note-templates">
                <h3>Note Templates</h3>
                <div class="customize-note-list">${rows}</div>
                <button class="btn customize-add-note">+ Add Note Type</button>
            </div>`;
    }

    function renderGlobalInstruction(draft) {
        return `
            <div class="customize-section">
                <h3>Global Instructions</h3>
                <textarea id="customize-global-instruction" class="customize-global-textarea" placeholder="e.g., 'Always mention guideline citations. Use metric units. Focus on cardiac issues.'">${escapeHtml(draft.globalInstruction)}</textarea>
            </div>`;
    }

    // --- Event Binding for Dynamic Sections ---

    function bindSummarySectionEvents(panel, draft) {
        const container = panel.querySelector('.customize-summary-list');

        // Delegated input events
        container.addEventListener('input', (e) => {
            const row = e.target.closest('.customize-summary-row');
            if (!row) return;
            const idx = parseInt(row.dataset.index);
            if (e.target.classList.contains('customize-summary-label')) {
                draft.summarySections[idx].label = e.target.value;
            } else if (e.target.classList.contains('customize-summary-instruction')) {
                draft.summarySections[idx].instruction = e.target.value;
            }
        });

        // Delete
        container.addEventListener('click', (e) => {
            if (!e.target.classList.contains('customize-delete-section')) return;
            if (draft.summarySections.length <= 1) {
                showToast('At least one section is required');
                return;
            }
            const idx = parseInt(e.target.dataset.index);
            draft.summarySections.splice(idx, 1);
            refreshSummarySections(panel, draft);
        });

        // Add
        panel.querySelector('.customize-add-section').addEventListener('click', () => {
            const newKey = 'section_' + Date.now();
            draft.summarySections.push({ key: newKey, label: '', instruction: '' });
            refreshSummarySections(panel, draft);
        });
    }

    function refreshSummarySections(panel, draft) {
        const container = panel.querySelector('.customize-summary-list');
        container.innerHTML = draft.summarySections.map((s, i) => renderSummarySectionRow(s, i)).join('');
    }

    function bindNoteTemplateEvents(panel, draft) {
        const container = panel.querySelector('#customize-note-templates');

        container.addEventListener('click', (e) => {
            const type = e.target.dataset.type;
            if (e.target.classList.contains('customize-note-edit')) {
                openNoteTemplateEditor(panel, draft, type);
            } else if (e.target.classList.contains('customize-note-delete')) {
                delete draft.noteTemplates[type];
                refreshNoteTemplates(panel, draft);
            }
        });

        panel.querySelector('.customize-add-note').addEventListener('click', () => {
            const name = prompt('Enter note type name:');
            if (name && name.trim()) {
                draft.noteTemplates[name.trim()] = '';
                openNoteTemplateEditor(panel, draft, name.trim());
            }
        });
    }

    function refreshNoteTemplates(panel, draft) {
        const container = panel.querySelector('.customize-note-list');
        const allTypes = [...new Set([...DEFAULT_NOTE_TYPES, ...Object.keys(draft.noteTemplates)])];
        container.innerHTML = allTypes.map(type => {
            const hasCustom = !!draft.noteTemplates[type];
            const badge = hasCustom ? '<span class="customize-badge custom">Custom \u270E</span>' : '<span class="customize-badge default">Default</span>';
            return `
                <div class="customize-note-row" data-type="${escapeAttr(type)}">
                    <span class="customize-note-name">${escapeHtml(type)}</span>
                    ${badge}
                    <button class="btn customize-note-edit" data-type="${escapeAttr(type)}">Edit</button>
                    ${hasCustom ? `<button class="btn customize-note-delete" data-type="${escapeAttr(type)}">Delete</button>` : ''}
                </div>`;
        }).join('');
    }

    function openNoteTemplateEditor(panel, draft, noteType) {
        const existing = draft.noteTemplates[noteType] || '';
        const editorOverlay = document.createElement('div');
        editorOverlay.className = 'customize-sub-overlay';
        editorOverlay.innerHTML = `
            <div class="customize-sub-modal">
                <h3>Edit Template: ${escapeHtml(noteType)}</h3>
                <textarea class="customize-template-textarea" placeholder="Enter note template format...">${escapeHtml(existing)}</textarea>
                <div class="customize-sub-footer">
                    <button class="btn customize-sub-cancel">Cancel</button>
                    <button class="btn btn-primary customize-sub-save">Save Template</button>
                </div>
            </div>`;
        panel.appendChild(editorOverlay);

        editorOverlay.querySelector('.customize-sub-cancel').addEventListener('click', () => editorOverlay.remove());
        editorOverlay.querySelector('.customize-sub-save').addEventListener('click', () => {
            const val = editorOverlay.querySelector('.customize-template-textarea').value;
            if (val.trim()) {
                draft.noteTemplates[noteType] = val;
            } else {
                delete draft.noteTemplates[noteType];
            }
            refreshNoteTemplates(panel, draft);
            editorOverlay.remove();
        });
    }

    // --- Utilities ---

    function capitalize(s) {
        return s.charAt(0).toUpperCase() + s.slice(1);
    }

    function escapeHtml(str) {
        const div = document.createElement('div');
        div.textContent = str || '';
        return div.innerHTML;
    }

    function escapeAttr(str) {
        return (str || '').replace(/"/g, '&quot;').replace(/'/g, '&#39;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    }

    function showToast(message) {
        const toast = document.createElement('div');
        toast.className = 'customize-toast';
        toast.textContent = message;
        document.body.appendChild(toast);
        requestAnimationFrame(() => toast.classList.add('visible'));
        setTimeout(() => {
            toast.classList.remove('visible');
            setTimeout(() => toast.remove(), 300);
        }, 2500);
    }

    // --- Inject Styles ---

    let stylesInjected = false;
    function injectStyles() {
        if (stylesInjected) return;
        stylesInjected = true;

        const style = document.createElement('style');
        style.textContent = `
            .customize-overlay {
                position: fixed; top: 0; left: 0; right: 0; bottom: 0;
                background: rgba(0,0,0,0.6);
            }
            .customize-panel {
                background: var(--bg-primary, #1a1a2e); color: var(--text-primary, #e0e0e0);
                border-radius: 12px; width: 640px; max-width: 95vw; max-height: 90vh;
                display: flex; flex-direction: column; box-shadow: 0 8px 32px rgba(0,0,0,0.4);
            }
            .customize-header {
                display: flex; justify-content: space-between; align-items: center;
                padding: 16px 20px; border-bottom: 1px solid var(--border-color, #333);
            }
            .customize-header h2 { margin: 0; font-size: 18px; }
            .customize-close {
                background: none; border: none; color: var(--text-secondary, #999);
                font-size: 24px; cursor: pointer; padding: 0 4px; line-height: 1;
            }
            .customize-close:hover { color: var(--text-primary, #fff); }
            .customize-body {
                flex: 1; overflow-y: auto; padding: 16px 20px;
            }
            .customize-section {
                margin-bottom: 24px;
            }
            .customize-section h3 {
                font-size: 14px; text-transform: uppercase; letter-spacing: 0.05em;
                color: var(--text-secondary, #aaa); margin: 0 0 12px 0;
            }
            .customize-slider {
                width: 100%; margin: 8px 0;
            }
            .customize-assertiveness-label {
                font-size: 13px; color: var(--text-secondary, #bbb); margin-top: 4px;
            }
            .customize-detail-row {
                display: flex; align-items: center; justify-content: space-between;
                margin-bottom: 8px;
            }
            .customize-detail-label {
                flex: 0 0 110px; font-size: 14px;
            }
            .customize-detail-btns { display: flex; gap: 6px; }
            .customize-detail-btn {
                font-size: 12px; padding: 4px 12px; border-radius: 4px;
                border: 1px solid var(--border-color, #444); background: transparent;
                color: var(--text-secondary, #aaa); cursor: pointer; transition: all 0.15s;
            }
            .customize-detail-btn.active {
                background: var(--accent-color, #4a6cf7); color: #fff;
                border-color: var(--accent-color, #4a6cf7);
            }
            .customize-detail-btn:hover:not(.active) {
                border-color: var(--text-secondary, #888);
            }
            .customize-summary-row {
                display: flex; gap: 8px; align-items: flex-start; margin-bottom: 8px;
            }
            .customize-summary-label {
                width: 60px; flex-shrink: 0; padding: 6px 8px; font-size: 13px;
                background: var(--bg-secondary, #252540); border: 1px solid var(--border-color, #444);
                border-radius: 4px; color: var(--text-primary, #e0e0e0);
            }
            .customize-summary-instruction {
                flex: 1; padding: 6px 8px; font-size: 13px; min-height: 48px; resize: vertical;
                background: var(--bg-secondary, #252540); border: 1px solid var(--border-color, #444);
                border-radius: 4px; color: var(--text-primary, #e0e0e0); font-family: inherit;
            }
            .customize-delete-section {
                flex-shrink: 0; font-size: 16px; padding: 4px 8px;
                background: transparent; border: 1px solid var(--border-color, #444);
                color: var(--text-secondary, #999); border-radius: 4px; cursor: pointer;
            }
            .customize-delete-section:hover { color: #e74c3c; border-color: #e74c3c; }
            .customize-note-row {
                display: flex; align-items: center; gap: 8px; margin-bottom: 6px;
                padding: 6px 8px; border-radius: 4px;
                background: var(--bg-secondary, #252540);
            }
            .customize-note-name { flex: 1; font-size: 14px; }
            .customize-badge {
                font-size: 11px; padding: 2px 8px; border-radius: 10px;
            }
            .customize-badge.default { background: var(--border-color, #444); color: var(--text-secondary, #aaa); }
            .customize-badge.custom { background: #2d6a4f; color: #b7e4c7; }
            .customize-note-edit, .customize-note-delete {
                font-size: 12px; padding: 3px 10px;
            }
            .customize-global-textarea {
                width: 100%; min-height: 80px; padding: 10px; font-size: 13px;
                background: var(--bg-secondary, #252540); border: 1px solid var(--border-color, #444);
                border-radius: 6px; color: var(--text-primary, #e0e0e0); font-family: inherit;
                resize: vertical; box-sizing: border-box;
            }
            .customize-footer {
                display: flex; justify-content: space-between; align-items: center;
                padding: 12px 20px; border-top: 1px solid var(--border-color, #333);
            }
            .customize-reset {
                color: var(--text-secondary, #999); border-color: var(--border-color, #555);
            }
            .customize-sub-overlay {
                position: absolute; top: 0; left: 0; right: 0; bottom: 0;
                background: rgba(0,0,0,0.5); display: flex; align-items: center;
                justify-content: center; border-radius: 12px;
            }
            .customize-sub-modal {
                background: var(--bg-primary, #1a1a2e); padding: 20px; border-radius: 8px;
                width: 90%; max-width: 500px; box-shadow: 0 4px 16px rgba(0,0,0,0.3);
            }
            .customize-sub-modal h3 { margin: 0 0 12px 0; font-size: 15px; }
            .customize-template-textarea {
                width: 100%; min-height: 200px; padding: 10px; font-size: 13px;
                background: var(--bg-secondary, #252540); border: 1px solid var(--border-color, #444);
                border-radius: 6px; color: var(--text-primary, #e0e0e0);
                font-family: 'Courier New', monospace; resize: vertical; box-sizing: border-box;
            }
            .customize-sub-footer {
                display: flex; justify-content: flex-end; gap: 8px; margin-top: 12px;
            }
            .customize-toast {
                position: fixed; bottom: 24px; left: 50%; transform: translateX(-50%) translateY(20px);
                background: #2d6a4f; color: #fff; padding: 10px 24px; border-radius: 8px;
                font-size: 14px; opacity: 0; transition: all 0.3s ease; z-index: 10001;
                pointer-events: none;
            }
            .customize-toast.visible { opacity: 1; transform: translateX(-50%) translateY(0); }
        `;
        document.head.appendChild(style);
    }

    // --- Public API ---

    log('AI Preferences module loaded');

    return {
        get,
        set,
        update,
        reset,
        getDefaults,
        getAssertiveness,
        getDetailLevel,
        getSummarySections,
        getNoteTemplate,
        getGlobalInstruction,
        buildPersonalityPrefix,
        buildSectionInstructions,
        buildSummaryFormatSpec,
        buildNoteTemplateInstruction,
        openCustomizePanel
    };
})();

window.AIPreferences = AIPreferences;
