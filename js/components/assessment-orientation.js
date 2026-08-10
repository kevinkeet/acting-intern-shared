/**
 * AssessmentOrientation — first-run guided tour of the assessment runner.
 *
 * A resident's first 60 seconds decide whether the pilot produces data or
 * confusion: they land in a two-pane UI they have never seen, with a chart,
 * a question, an answer box, and an AI panel all competing for attention.
 * This walks them through it once, in reading order, then gets out of the way.
 *
 * Design constraints:
 *  - Auto-shows ONCE per browser (localStorage), replayable any time from the
 *    "How this works" button in the assessment bar.
 *  - The AI Assistant step DESCRIBES the tool neutrally. It must not encourage
 *    use — nudging residents toward AI would bias the behaviour the trial
 *    measures. Say what it is and where it is; nothing more.
 *  - No dependency on the tutorial.js component (that targets the
 *    non-assessment UI and none of its selectors exist here).
 *
 * Global: window.AssessmentOrientation
 */

const AssessmentOrientation = {
    _step: 0,
    _active: false,
    _seenKey: 'assessment-orientation-seen',

    // Steps in reading order: where am I → what's the task → where do I answer
    // → what's this AI panel → how do I progress. Selectors resolve at show()
    // time so layout changes don't strand the tour.
    steps: [
        {
            target: '#main-content',
            position: 'right',
            title: 'This is the patient\'s chart',
            body: 'It works like a real EHR: use the left sidebar to open notes, labs, imaging, medications, and vitals. Everything you need to answer the questions is somewhere in this chart — reviewing it is part of the task. New information is added to the chart as the case moves forward in time, and a banner will tell you when that happens.'
        },
        {
            target: '.assessment-dock-body',
            position: 'left',
            title: 'Your question and answer',
            body: 'The current question sits here, with a short scenario above it telling you where you are in the case. Type your answer in your own words — there is no required length and no multiple choice. When you submit, the next question appears. You cannot go back to a submitted answer, so finish a question before moving on.'
        },
        {
            target: '.assessment-chatbot-panel',
            position: 'left',
            title: 'AI Assistant',
            body: 'An AI assistant is available for this case. If you choose to use it, first select which parts of the chart it can see and a time window, then ask it anything in the chat. Whether and how you use it is entirely up to you — answer questions however you would normally work.'
        },
        {
            target: '#assessment-bar',
            position: 'left',
            title: 'Timer, progress, and pausing',
            body: 'The clock counts up — it is a record of time spent, not a countdown. There is no time limit and nothing auto-submits. The dots show your progress through the case\'s questions. You can pause if you are interrupted. When every question is answered, your responses are scored and you will see a results page.'
        },
        {
            target: '.assessment-dock-resize-x',
            position: 'left',
            title: 'One last thing — the layout is yours',
            body: 'Drag the left edge of this panel to make it wider or narrower, and drag the bar between the answer box and the AI Assistant to change their split. Double-click either handle to reset. That\'s everything — good luck.'
        }
    ],

    /** Auto-show on first entry to the runner; no-op afterwards. */
    maybeShow() {
        try {
            if (localStorage.getItem(this._seenKey)) return;
        } catch (e) { /* storage unavailable — still show, just not persistently */ }
        // Give the dock + chatbot a beat to mount before measuring targets.
        setTimeout(() => this.show(), 700);
    },

    show() {
        if (this._active) return;
        this._active = true;
        this._step = 0;
        try { localStorage.setItem(this._seenKey, '1'); } catch (e) { /* ignore */ }
        this._renderOverlay();
        this._renderStep();
    },

    _renderOverlay() {
        const overlay = document.createElement('div');
        overlay.id = 'assessment-orientation';
        overlay.innerHTML = `
            <div class="aor-backdrop"></div>
            <div class="aor-spotlight" id="aor-spotlight"></div>
            <div class="aor-card" id="aor-card" role="dialog" aria-label="Assessment orientation">
                <div class="aor-card-step" id="aor-step-label"></div>
                <h3 class="aor-card-title" id="aor-title"></h3>
                <p class="aor-card-body" id="aor-body"></p>
                <div class="aor-card-controls">
                    <button class="aor-skip" id="aor-skip">Skip tour</button>
                    <div class="aor-nav">
                        <button class="aor-back" id="aor-back">Back</button>
                        <button class="aor-next" id="aor-next">Next</button>
                    </div>
                </div>
            </div>
        `;
        document.body.appendChild(overlay);
        overlay.querySelector('#aor-skip').addEventListener('click', () => this.dismiss());
        overlay.querySelector('#aor-back').addEventListener('click', () => this._go(-1));
        overlay.querySelector('#aor-next').addEventListener('click', () => this._go(1));
        this._keyHandler = (e) => {
            if (e.key === 'Escape') this.dismiss();
            if (e.key === 'ArrowRight' || e.key === 'Enter') this._go(1);
            if (e.key === 'ArrowLeft') this._go(-1);
        };
        document.addEventListener('keydown', this._keyHandler);
    },

    _go(delta) {
        const next = this._step + delta;
        if (next < 0) return;
        if (next >= this.steps.length) { this.dismiss(); return; }
        this._step = next;
        this._renderStep();
    },

    _renderStep() {
        const overlay = document.getElementById('assessment-orientation');
        if (!overlay) return;
        // Skip steps whose target is missing (e.g. chatbot still mounting).
        let step = this.steps[this._step];
        let el = document.querySelector(step.target);
        while (!el && this._step < this.steps.length - 1) {
            this._step += 1;
            step = this.steps[this._step];
            el = document.querySelector(step.target);
        }
        if (!el) { this.dismiss(); return; }

        const r = el.getBoundingClientRect();
        const spot = overlay.querySelector('#aor-spotlight');
        const pad = 6;
        spot.style.top = Math.max(0, r.top - pad) + 'px';
        spot.style.left = Math.max(0, r.left - pad) + 'px';
        spot.style.width = Math.min(window.innerWidth, r.width + pad * 2) + 'px';
        spot.style.height = Math.min(window.innerHeight, r.height + pad * 2) + 'px';

        overlay.querySelector('#aor-step-label').textContent =
            'Step ' + (this._step + 1) + ' of ' + this.steps.length;
        overlay.querySelector('#aor-title').textContent = step.title;
        overlay.querySelector('#aor-body').textContent = step.body;
        overlay.querySelector('#aor-back').style.visibility = this._step === 0 ? 'hidden' : 'visible';
        overlay.querySelector('#aor-next').textContent =
            this._step === this.steps.length - 1 ? 'Start the case' : 'Next';

        // Card placement: opposite side of the spotlighted element, clamped.
        const card = overlay.querySelector('#aor-card');
        card.style.visibility = 'hidden';
        requestAnimationFrame(() => {
            const cw = card.offsetWidth, ch = card.offsetHeight, gap = 16;
            let top, left;
            if (step.position === 'left') {
                left = r.left - cw - gap;
                top = r.top + (r.height - ch) / 2;
            } else {
                left = r.right + gap;
                top = r.top + (r.height - ch) / 2;
            }
            left = Math.max(12, Math.min(left, window.innerWidth - cw - 12));
            top = Math.max(12, Math.min(top, window.innerHeight - ch - 12));
            card.style.left = left + 'px';
            card.style.top = top + 'px';
            card.style.visibility = 'visible';
        });
    },

    dismiss() {
        const overlay = document.getElementById('assessment-orientation');
        if (overlay) overlay.remove();
        if (this._keyHandler) {
            document.removeEventListener('keydown', this._keyHandler);
            this._keyHandler = null;
        }
        this._active = false;
    }
};

window.AssessmentOrientation = AssessmentOrientation;
