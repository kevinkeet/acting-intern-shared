/**
 * Smart Glasses HUD Prototype
 * Simulates Even Realities G1 smart glasses display.
 * Left lens: Patient context (summary, problems, alerts)
 * Right lens: Orders (suggested orders, order confirmation after dictation)
 *
 * Data source priority:
 * 1. LLM-generated glassesDisplay (pre-formatted, optimized by Claude)
 * 2. Client-side condensation of AICoworker.state (fallback)
 *
 * Order confirmation flow:
 * After dictating an order, call SmartGlasses.showOrderConfirmation(orderData)
 * to display a structured confirmation screen on the right lens.
 * The user confirms with the Even Realities ring tap (simulated by click).
 */
const SmartGlasses = {
    isOpen: false,
    leftScreen: 0,
    rightScreen: 0,
    leftScreens: [],
    rightScreens: [],
    _keyHandler: null,
    _orderConfirmation: null, // Active order confirmation data
    _savedRightScreens: null, // Saved screens during confirmation mode
    _savedRightScreen: 0,
    _sessionOrders: [],       // Orders confirmed this session (for right lens)

    LINES_PER_SCREEN: 5,
    MAX_LINE_CHARS: 45,

    toggle() {
        if (this.isOpen) this.close();
        else this.open();
    },

    open() {
        if (this.isOpen) return;
        this.isOpen = true;
        this.leftScreen = 0;
        this.rightScreen = 0;
        this._orderConfirmation = null;
        this._savedRightScreens = null;

        const state = (typeof AICoworker !== 'undefined') ? AICoworker.state : null;
        const glassesData = state ? state.glassesDisplay : null;

        // Left lens: paged screens (patient context)
        if (glassesData && glassesData.leftLens) {
            this.leftScreens = this._parseLLMScreens(glassesData.leftLens, 'PATIENT');
        } else {
            const data = this._getGlassesData();
            this.leftScreens = this._buildLeftScreensFallback(data);
        }
        // Right lens: unified scrollable orders view (built in _createOverlay via _buildOrdersViewHTML)

        this._createOverlay();

        this._keyHandler = (e) => {
            if (e.key === 'Escape') {
                if (this._orderConfirmation) { this.cancelOrderConfirmation(); return; }
                this.close(); return;
            }
            if (e.key === 'ArrowLeft') { e.preventDefault(); this.prevScreen('left'); }
            if (e.key === 'ArrowRight') { e.preventDefault(); this.nextScreen('left'); }
            if (e.key === 'ArrowUp') { e.preventDefault(); this._scrollRightLens(-60); }
            if (e.key === 'ArrowDown') { e.preventDefault(); this._scrollRightLens(60); }
            if (e.key === 'Enter' && this._orderConfirmation) { e.preventDefault(); this.confirmOrder(); }
        };
        document.addEventListener('keydown', this._keyHandler);
    },

    close() {
        const overlay = document.getElementById('glasses-overlay');
        if (overlay) overlay.remove();
        if (this._keyHandler) {
            document.removeEventListener('keydown', this._keyHandler);
            this._keyHandler = null;
        }
        this._orderConfirmation = null;
        this._savedRightScreens = null;
        this.isOpen = false;
    },

    // ==================== Order Confirmation ====================

    /**
     * Show an order confirmation on the right lens.
     * @param {Object} orderData - The parsed order to confirm
     * @param {string} orderData.type - 'medication'|'lab'|'imaging'|'consult'|'nursing'
     * @param {string} orderData.summary - Human-readable one-liner (e.g. "Lasix 40mg IV Push x1")
     * @param {Object} orderData.details - Structured fields for display
     *   For meds: {name, dose, route, frequency, indication}
     *   For labs: {name, priority, specimen, indication}
     *   For imaging: {modality, bodyPart, contrast, priority, indication}
     */
    showOrderConfirmation(orderData) {
        if (!this.isOpen) this.open();

        this._orderConfirmation = orderData;
        this._savedRightScreens = this.rightScreens;
        this._savedRightScreen = this.rightScreen;

        // Build confirmation screens for the right lens
        const lines = this._buildConfirmationLines(orderData);
        this.rightScreens = [{ title: 'CONFIRM ORDER', lines }];
        this.rightScreen = 0;

        this._updateLens('right');
        this._showConfirmationUI();
    },

    _buildConfirmationLines(order) {
        const lines = [];
        const t = (s) => this._truncate(s || '', this.MAX_LINE_CHARS);

        if (order.type === 'medication') {
            const d = order.details || {};
            lines.push(t(`RX: ${d.name || order.summary}`));
            lines.push(t(`Dose: ${d.dose || '?'} ${d.route || ''}`));
            lines.push(t(`Freq: ${d.frequency || '?'}`));
            lines.push(t(`For: ${d.indication || '—'}`));
            lines.push('');
        } else if (order.type === 'lab') {
            const d = order.details || {};
            lines.push(t(`LAB: ${d.name || order.summary}`));
            lines.push(t(`Priority: ${d.priority || 'Routine'}`));
            lines.push(t(`Specimen: ${d.specimen || 'Blood'}`));
            lines.push(t(`For: ${d.indication || '—'}`));
            lines.push('');
        } else if (order.type === 'imaging') {
            const d = order.details || {};
            lines.push(t(`IMG: ${d.modality || '?'} ${d.bodyPart || ''}`));
            lines.push(t(`Contrast: ${d.contrast || 'N/A'}`));
            lines.push(t(`Priority: ${d.priority || 'Routine'}`));
            lines.push(t(`For: ${d.indication || '—'}`));
            lines.push('');
        } else if (order.type === 'consult') {
            const d = order.details || {};
            lines.push(t(`CONSULT: ${d.specialty || order.summary}`));
            lines.push(t(`Priority: ${d.priority || 'Routine'}`));
            lines.push(t(`Reason: ${d.reason || '—'}`));
            lines.push('');
            lines.push('');
        } else {
            // Generic order
            lines.push(t(order.summary || 'Order pending'));
            lines.push('');
            lines.push('');
            lines.push('');
            lines.push('');
        }

        while (lines.length < this.LINES_PER_SCREEN) lines.push('');
        return lines.slice(0, this.LINES_PER_SCREEN);
    },

    _showConfirmationUI() {
        const lens = document.getElementById('glasses-lens-right');
        if (!lens) return;

        // Replace nav with confirmation buttons
        const nav = lens.querySelector('.lens-nav');
        if (nav) {
            nav.innerHTML = `
                <button class="lens-confirm-btn confirm" onclick="SmartGlasses.confirmOrder()" title="Confirm order (Enter / Ring tap)">
                    <span class="confirm-icon">\u2713</span> CONFIRM
                </button>
                <button class="lens-confirm-btn cancel" onclick="SmartGlasses.cancelOrderConfirmation()" title="Cancel (Esc)">
                    <span class="confirm-icon">\u2717</span> EDIT
                </button>
            `;
        }

        // Add pulsing border to right lens
        lens.classList.add('lens-confirming');
    },

    confirmOrder() {
        if (!this._orderConfirmation) return;

        const order = this._orderConfirmation;

        // Track in session orders
        const orderName = order.summary || order.details?.name || 'Order';
        if (!this._sessionOrders.some(o => o === orderName)) {
            this._sessionOrders.push(orderName);
        }

        // Submit the order through the existing order entry system
        if (typeof OrderEntry !== 'undefined' && order.details) {
            if (order.type === 'medication') {
                OrderEntry.quickOrder && OrderEntry.quickOrder(order.details);
            } else if (order.type === 'lab') {
                OrderEntry.quickLabOrder && OrderEntry.quickLabOrder(order.details);
            } else if (order.type === 'imaging') {
                OrderEntry.quickImagingOrder && OrderEntry.quickImagingOrder(order.details);
            }
        }

        // Show brief confirmed state
        const contentEl = document.getElementById('lens-content-right');
        const titleEl = document.getElementById('lens-title-right');
        if (titleEl) titleEl.textContent = 'ORDER PLACED';
        if (contentEl) {
            contentEl.innerHTML = this._renderLines([
                '\u2713 ' + this._truncate(orderName, this.MAX_LINE_CHARS - 2),
                '',
                'Order sent to chart.',
                '',
                ''
            ]);
        }

        // Restore orders view after brief delay
        setTimeout(() => this._restoreRightLens(), 1500);
    },

    cancelOrderConfirmation() {
        this._restoreRightLens();
    },

    _restoreRightLens() {
        this._orderConfirmation = null;

        const lens = document.getElementById('glasses-lens-right');
        if (lens) lens.classList.remove('lens-confirming');

        // Restore title
        const titleEl = document.getElementById('lens-title-right');
        if (titleEl) titleEl.textContent = 'ORDERS';

        // Refresh the unified scrollable orders view
        this.refreshOrdersView();

        // Restore normal nav
        const nav = lens ? lens.querySelector('.lens-nav') : null;
        if (nav) {
            nav.innerHTML = '<span class="lens-nav-indicator" id="lens-nav-right">\u2191\u2193 scroll</span>';
        }
    },

    // ==================== Live Updates from Dictation ====================

    /**
     * Push a new context line to the left lens (patient info).
     * Called by DictationWidget when context is dictated.
     * Adds a new "DICTATION" screen or appends to the last one.
     */
    pushContextToLeftLens(text) {
        if (!this.isOpen) return;

        const truncated = this._truncate(text, this.MAX_LINE_CHARS);

        // Find or create a DICTATION screen
        let dictScreen = this.leftScreens.find(s => s.title === 'DICTATION');
        if (!dictScreen) {
            dictScreen = { title: 'DICTATION', lines: [] };
            this.leftScreens.push(dictScreen);
        }

        // Add line, rolling window of 5 lines (most recent)
        dictScreen.lines.push(truncated);
        if (dictScreen.lines.length > this.LINES_PER_SCREEN) {
            dictScreen.lines = dictScreen.lines.slice(-this.LINES_PER_SCREEN);
        }

        // Pad to 5 lines
        while (dictScreen.lines.length < this.LINES_PER_SCREEN) {
            dictScreen.lines.push('');
        }

        // Auto-navigate to the dictation screen
        const dictIdx = this.leftScreens.indexOf(dictScreen);
        if (dictIdx >= 0) {
            this.leftScreen = dictIdx;
            this._updateLens('left');
        }
    },

    /**
     * Push a parsed order line to the right lens (orders).
     * Called by DictationWidget when an order is being parsed or confirmed.
     */
    pushOrderToRightLens(orderText, status) {
        if (!this.isOpen || this._orderConfirmation) return;

        // Track confirmed orders in session list
        if (status === 'confirmed') {
            // Avoid duplicates
            if (!this._sessionOrders.some(o => o === orderText)) {
                this._sessionOrders.push(orderText);
            }
        }

        // Refresh the unified orders view
        this.refreshOrdersView();
    },

    // ==================== LLM Data Parsing ====================

    _parseLLMScreens(lensData, fallbackTitle) {
        if (!Array.isArray(lensData) || lensData.length === 0) {
            return [{ title: fallbackTitle, lines: ['', 'No data available.', '', '', ''] }];
        }

        return lensData.map(screen => {
            const title = (screen.title || fallbackTitle).toUpperCase();
            let lines = Array.isArray(screen.lines) ? screen.lines.slice() : [];

            lines = lines.map(l => {
                if (typeof l !== 'string') return '';
                if (l.length > this.MAX_LINE_CHARS) {
                    return l.slice(0, this.MAX_LINE_CHARS - 1) + '\u2026';
                }
                return l;
            });

            while (lines.length < this.LINES_PER_SCREEN) lines.push('');
            lines = lines.slice(0, this.LINES_PER_SCREEN);

            return { title, lines };
        }).filter(screen => {
            return screen.lines.some(l => l.trim().length > 0);
        });
    },

    // ==================== Fallback Data Extraction ====================

    _getGlassesData() {
        const state = (typeof AICoworker !== 'undefined') ? AICoworker.state : null;
        if (!state) return null;

        const hasData = !!(state.aiOneLiner || (state.problemList && state.problemList.length > 0)
            || (state.categorizedActions && Object.values(state.categorizedActions).some(a => a && a.length)));

        if (!hasData) return null;

        return {
            oneLiner: state.aiOneLiner || '',
            clinicalSummary: state.clinicalSummary || {},
            problemList: state.problemList || [],
            categorizedActions: state.categorizedActions || {},
            flags: state.flags || [],
            keyConsiderations: state.keyConsiderations || [],
        };
    },

    // ==================== Fallback Screen Builders ====================
    // Left lens = Patient context (swapped from original)

    _buildLeftScreensFallback(data) {
        const screens = [];

        if (!data) {
            screens.push({ title: 'PATIENT', lines: ['', 'No AI analysis available.', 'Run analysis first.', '', ''] });
            return screens;
        }

        // Screen 1: Patient summary
        const summaryLines = [];
        if (data.oneLiner) {
            this._wordWrap(data.oneLiner, summaryLines);
        } else if (data.clinicalSummary.demographics) {
            summaryLines.push(this._truncate(data.clinicalSummary.demographics, this.MAX_LINE_CHARS));
        }
        if (data.clinicalSummary.presentation) {
            this._wordWrap(this._truncate(data.clinicalSummary.presentation, this.MAX_LINE_CHARS * 2), summaryLines);
        }
        while (summaryLines.length < this.LINES_PER_SCREEN) summaryLines.push('');
        screens.push({ title: 'PATIENT', lines: summaryLines.slice(0, this.LINES_PER_SCREEN) });

        // Screen 2: Problem list
        if (data.problemList.length > 0) {
            const probLines = data.problemList.slice(0, this.LINES_PER_SCREEN).map(p => {
                const icon = p.urgency === 'urgent' ? '! ' : p.urgency === 'monitoring' ? '~ ' : '  ';
                return icon + this._truncate(p.name || '', this.MAX_LINE_CHARS - 2);
            });
            while (probLines.length < this.LINES_PER_SCREEN) probLines.push('');
            screens.push({ title: 'PROBLEMS', lines: probLines });
        }

        // Screen 3: Alerts
        const alertLines = [];
        if (data.flags && data.flags.length) {
            data.flags.forEach(f => {
                const text = typeof f === 'string' ? f : (f.text || '');
                if (text) alertLines.push('\u26A0 ' + this._truncate(text, this.MAX_LINE_CHARS - 2));
            });
        }
        if (data.keyConsiderations && data.keyConsiderations.length) {
            data.keyConsiderations.forEach(k => {
                if (k.severity === 'critical' || k.severity === 'important') {
                    alertLines.push('\u26A0 ' + this._truncate(k.text || '', this.MAX_LINE_CHARS - 2));
                }
            });
        }
        if (alertLines.length > 0) {
            while (alertLines.length < this.LINES_PER_SCREEN) alertLines.push('');
            screens.push({ title: 'ALERTS', lines: alertLines.slice(0, this.LINES_PER_SCREEN) });
        }

        return screens;
    },

    // Right lens = Orders (swapped from original)

    /**
     * Build unified orders view HTML for the right lens.
     * Single scrollable view: "ORDERED THIS SESSION" at top, separator, then recommended orders.
     */
    _buildOrdersViewHTML() {
        const lines = [];

        // === ORDERED THIS SESSION ===
        lines.push('<div class="lens-section-title">ORDERED THIS SESSION</div>');

        if (this._sessionOrders.length > 0) {
            for (const order of this._sessionOrders) {
                lines.push(`<div class="lens-line lens-order-confirmed">\u2713 ${this._esc(this._truncate(order, this.MAX_LINE_CHARS - 2))}</div>`);
            }
        } else {
            lines.push('<div class="lens-line lens-order-empty">No orders yet</div>');
        }

        // === SEPARATOR ===
        lines.push('<div class="lens-order-separator">\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500</div>');

        // === RECOMMENDED ORDERS ===
        lines.push('<div class="lens-section-title">RECOMMENDED</div>');

        const recs = this._getRecommendedOrders();
        if (recs.length > 0) {
            for (const rec of recs) {
                // Check if already ordered this session
                const isOrdered = this._sessionOrders.some(o =>
                    o.toLowerCase().includes(rec.text.toLowerCase().slice(0, 15)));
                const cls = isOrdered ? 'lens-line lens-order-done' : 'lens-line lens-order-rec';
                const prefix = isOrdered ? '\u2713' : '\u25CB';
                lines.push(`<div class="${cls}">${prefix} ${this._esc(this._truncate(rec.text, this.MAX_LINE_CHARS - 2))}</div>`);
            }
        } else {
            lines.push('<div class="lens-line lens-order-empty">Run analysis for recommendations</div>');
        }

        return lines.join('');
    },

    /**
     * Get recommended orders from AICoworker state.
     */
    _getRecommendedOrders() {
        if (typeof AICoworker === 'undefined' || !AICoworker.state) return [];

        const recs = [];

        // From suggested actions
        const actions = AICoworker.state.suggestedActions || [];
        for (const a of actions) {
            const text = typeof a === 'string' ? a : (a.text || '');
            if (text) recs.push({ text });
        }

        // From categorized actions if available
        if (recs.length === 0) {
            const cats = AICoworker.state.categorizedActions || {};
            for (const key of ['labs', 'imaging', 'medications', 'communication', 'other']) {
                const items = cats[key];
                if (!items) continue;
                for (const item of items) {
                    const text = typeof item === 'string' ? item : (item.text || '');
                    if (text) recs.push({ text });
                }
            }
        }

        return recs;
    },

    /**
     * Refresh the orders view on the right lens (call after any order change).
     */
    refreshOrdersView() {
        if (!this.isOpen || this._orderConfirmation) return;
        const contentEl = document.getElementById('lens-content-right');
        if (contentEl) {
            contentEl.innerHTML = this._buildOrdersViewHTML();
            // Auto-scroll to bottom to show latest
            contentEl.scrollTop = contentEl.scrollHeight;
        }
    },

    // ==================== Overlay Creation ====================

    _createOverlay() {
        const overlay = document.createElement('div');
        overlay.className = 'glasses-overlay';
        overlay.id = 'glasses-overlay';
        overlay.setAttribute('role', 'dialog');
        overlay.setAttribute('aria-label', 'Smart Glasses HUD');

        const totalLeft = this.leftScreens.length;
        const totalRight = this.rightScreens.length;
        const isLLM = (typeof AICoworker !== 'undefined') && AICoworker.state.glassesDisplay;
        const sourceLabel = isLLM ? 'AI-optimized' : 'fallback';

        overlay.innerHTML = `
            <div class="glasses-backdrop" onclick="SmartGlasses.close()"></div>
            <div class="glasses-frame">
                <div class="glasses-header">
                    <span class="glasses-header-title">SMART GLASSES HUD</span>
                    <span class="glasses-header-source">${sourceLabel}</span>
                    <button class="glasses-close" onclick="SmartGlasses.close()" title="Close">\u00D7</button>
                </div>
                <div class="glasses-viewport">
                    <div class="glasses-lens glasses-lens-left" id="glasses-lens-left">
                        <div class="lens-title" id="lens-title-left">${this._esc(this.leftScreens[0]?.title || 'PATIENT')}</div>
                        <div class="lens-separator">\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500</div>
                        <div class="lens-content" id="lens-content-left">
                            ${this._renderLines(this.leftScreens[0]?.lines || [])}
                        </div>
                        <div class="lens-nav">
                            <button class="lens-nav-btn" onclick="SmartGlasses.prevScreen('left')" title="Previous (Left arrow)">\u25C0</button>
                            <span class="lens-nav-indicator" id="lens-nav-left">1/${totalLeft}</span>
                            <button class="lens-nav-btn" onclick="SmartGlasses.nextScreen('left')" title="Next (Right arrow)">\u25B6</button>
                        </div>
                    </div>
                    <div class="glasses-bridge"></div>
                    <div class="glasses-lens glasses-lens-right" id="glasses-lens-right">
                        <div class="lens-title" id="lens-title-right">ORDERS</div>
                        <div class="lens-separator">\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500</div>
                        <div class="lens-content lens-content-scrollable" id="lens-content-right">
                            ${this._buildOrdersViewHTML()}
                        </div>
                        <div class="lens-nav" id="lens-nav-right-container">
                            <span class="lens-nav-indicator" id="lens-nav-right">\u2191\u2193 scroll</span>
                        </div>
                    </div>
                </div>
                <div class="glasses-footer">
                    PROTOTYPE \u00B7 Even Realities G1 \u00B7 \u2190\u2192 Patient \u00B7 \u2191\u2193 Scroll Orders
                </div>
            </div>
        `;

        document.body.appendChild(overlay);
        requestAnimationFrame(() => overlay.classList.add('visible'));
    },

    _renderLines(lines) {
        return lines.map(l => `<div class="lens-line">${this._esc(l) || '&nbsp;'}</div>`).join('');
    },

    // ==================== Navigation ====================

    nextScreen(lens) {
        if (this._orderConfirmation && lens === 'right') return; // Lock during confirmation
        if (lens === 'left') {
            if (this.leftScreens.length <= 1) return;
            this.leftScreen = (this.leftScreen + 1) % this.leftScreens.length;
        } else {
            if (this.rightScreens.length <= 1) return;
            this.rightScreen = (this.rightScreen + 1) % this.rightScreens.length;
        }
        this._updateLens(lens);
    },

    prevScreen(lens) {
        if (this._orderConfirmation && lens === 'right') return; // Lock during confirmation
        if (lens === 'left') {
            if (this.leftScreens.length <= 1) return;
            this.leftScreen = (this.leftScreen - 1 + this.leftScreens.length) % this.leftScreens.length;
        } else {
            if (this.rightScreens.length <= 1) return;
            this.rightScreen = (this.rightScreen - 1 + this.rightScreens.length) % this.rightScreens.length;
        }
        this._updateLens(lens);
    },

    _updateLens(lens) {
        const idx = lens === 'left' ? this.leftScreen : this.rightScreen;
        const screens = lens === 'left' ? this.leftScreens : this.rightScreens;
        const screen = screens[idx];
        if (!screen) return;

        const titleEl = document.getElementById(`lens-title-${lens}`);
        const contentEl = document.getElementById(`lens-content-${lens}`);
        const navEl = document.getElementById(`lens-nav-${lens}`);

        if (titleEl) titleEl.textContent = screen.title;
        if (contentEl) {
            contentEl.style.opacity = '0';
            setTimeout(() => {
                contentEl.innerHTML = this._renderLines(screen.lines);
                contentEl.style.opacity = '1';
            }, 80);
        }
        if (navEl) navEl.textContent = `${idx + 1}/${screens.length}`;
    },

    _scrollRightLens(delta) {
        const contentEl = document.getElementById('lens-content-right');
        if (contentEl) contentEl.scrollBy({ top: delta, behavior: 'smooth' });
    },

    // ==================== Utilities ====================

    _wordWrap(text, targetArray) {
        const words = text.split(' ');
        let line = '';
        for (const w of words) {
            if ((line + ' ' + w).trim().length > this.MAX_LINE_CHARS) {
                targetArray.push(line.trim());
                line = w;
            } else {
                line = (line + ' ' + w).trim();
            }
        }
        if (line) targetArray.push(line.trim());
    },

    _truncate(str, max) {
        if (!str) return '';
        str = str.replace(/\n/g, ' ').trim();
        if (str.length <= max) return str;
        return str.slice(0, max - 1) + '\u2026';
    },

    _esc(str) {
        if (!str) return '';
        const el = document.createElement('span');
        el.textContent = str;
        return el.innerHTML;
    }
};

window.SmartGlasses = SmartGlasses;
