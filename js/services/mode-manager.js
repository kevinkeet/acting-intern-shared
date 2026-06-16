/**
 * ModeManager — the three-purpose app shell.
 *
 * Acting Intern runs as three scoped "modes" that share one codebase:
 *   - assessment : the timed, graded RCT cases (consent + access code + scoring + saving)
 *   - tutor      : the standalone AI Teaching Tutor (#/tutor)
 *   - assistant  : the EHR chart with the right-hand AI coworker panel
 *
 * After the access gate unlocks the API key, the landing chooser asks which
 * mode to enter. A top-bar switcher links the other two. Each mode hides the
 * other two's chrome via a `body.mode-<id>` class (see epic-theme.css).
 *
 * Global: window.ModeManager
 */

const ModeManager = (function () {
    'use strict';

    const KEY = 'app-mode';

    const MODES = {
        assessment: {
            id: 'assessment',
            label: 'Assessment',
            short: 'Assessment',
            icon: 'clipboard-check',
            home: '#/assessment/start',
            tagline: 'Take a timed, graded clinical case. Your responses and score are recorded for the study.',
        },
        tutor: {
            id: 'tutor',
            label: 'AI Tutor',
            short: 'AI Tutor',
            icon: 'graduation-cap',
            home: '#/tutor',
            tagline: 'Ask any clinical question and get a sharp answer plus structured teaching with sources.',
        },
        assistant: {
            id: 'assistant',
            label: 'AI Assistant',
            short: 'AI Assistant',
            icon: 'sparkles',
            home: '#/chart-review',
            tagline: 'Work through a patient chart with an AI copilot in the side panel.',
        },
    };
    const ORDER = ['assessment', 'tutor', 'assistant'];

    function get() {
        try {
            const m = localStorage.getItem(KEY);
            return MODES[m] ? m : null;
        } catch (e) {
            return null;
        }
    }

    function _applyBodyClass(mode) {
        document.body.classList.remove('mode-assessment', 'mode-tutor', 'mode-assistant');
        if (mode) document.body.classList.add('mode-' + mode);
    }

    // Set (or switch to) a mode: persist, scope the UI, refresh the switcher,
    // and navigate to the mode's home route.
    function set(mode, opts) {
        if (!MODES[mode]) return;
        opts = opts || {};
        try { localStorage.setItem(KEY, mode); } catch (e) { /* ignore */ }
        _applyBodyClass(mode);
        _renderSwitcher();
        if (opts.navigate !== false) {
            window.location.hash = MODES[mode].home;
            // Force a route run if the hash didn't change.
            if (typeof router !== 'undefined' && router.handleRoute) router.handleRoute();
        }
    }

    // ── Top-bar mode switcher ──────────────────────────────────────────
    function _switcherContainer() {
        let el = document.getElementById('mode-switch');
        if (!el) {
            const header = document.querySelector('.top-header .header-left');
            if (!header) return null;
            el = document.createElement('div');
            el.id = 'mode-switch';
            el.className = 'mode-switch';
            // Place right after the logo.
            const logo = header.querySelector('.logo');
            if (logo && logo.nextSibling) header.insertBefore(el, logo.nextSibling);
            else header.appendChild(el);
        }
        return el;
    }

    function _renderSwitcher() {
        const el = _switcherContainer();
        if (!el) return;
        const cur = get();
        el.innerHTML = ORDER.map((id) => {
            const m = MODES[id];
            const active = id === cur;
            return `<button class="mode-switch-item ${active ? 'active' : ''}" data-mode="${id}"
                ${active ? 'aria-current="page"' : ''} title="${_esc(m.tagline)}">
                <i data-lucide="${m.icon}"></i><span>${_esc(m.short)}</span>
            </button>`;
        }).join('');
        el.querySelectorAll('.mode-switch-item').forEach((btn) => {
            btn.addEventListener('click', () => {
                const id = btn.getAttribute('data-mode');
                if (id !== get()) set(id);
            });
        });
        if (typeof App !== 'undefined' && App.refreshIcons) App.refreshIcons();
    }

    // ── Landing chooser ────────────────────────────────────────────────
    function showChooser() {
        if (document.getElementById('mode-chooser')) return;
        const overlay = document.createElement('div');
        overlay.id = 'mode-chooser';
        overlay.className = 'mode-chooser-overlay';
        overlay.innerHTML = `
            <div class="mode-chooser">
                <div class="mode-chooser-head">
                    <div class="mode-chooser-logo"><i data-lucide="stethoscope"></i></div>
                    <h1>Acting Intern</h1>
                    <p>Choose what you'd like to do. You can switch any time from the top bar.</p>
                </div>
                <div class="mode-chooser-grid">
                    ${ORDER.map((id) => {
                        const m = MODES[id];
                        return `<button class="mode-card" data-mode="${id}">
                            <div class="mode-card-icon"><i data-lucide="${m.icon}"></i></div>
                            <div class="mode-card-label">${_esc(m.label)}</div>
                            <div class="mode-card-tagline">${_esc(m.tagline)}</div>
                            <div class="mode-card-go"><span>Enter</span> <i data-lucide="arrow-right"></i></div>
                        </button>`;
                    }).join('')}
                </div>
            </div>`;
        document.body.appendChild(overlay);
        overlay.querySelectorAll('.mode-card').forEach((card) => {
            card.addEventListener('click', () => {
                const id = card.getAttribute('data-mode');
                overlay.remove();
                set(id);
            });
        });
        if (typeof App !== 'undefined' && App.refreshIcons) App.refreshIcons();
    }

    function _esc(s) {
        const el = document.createElement('div');
        el.textContent = s == null ? '' : String(s);
        return el.innerHTML;
    }

    // ── Boot ───────────────────────────────────────────────────────────
    // Apply scoping + switcher for any already-chosen mode. Returns the
    // current mode (or null if the chooser should be shown).
    function init() {
        const cur = get();
        _applyBodyClass(cur);
        _renderSwitcher();
        return cur;
    }

    return { MODES, ORDER, get, set, init, showChooser, _renderSwitcher };
})();

window.ModeManager = ModeManager;
