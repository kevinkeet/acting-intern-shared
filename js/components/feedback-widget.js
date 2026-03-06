/**
 * Feedback Widget
 *
 * A feedback tool with two states:
 *   1. EXPANDED — a panel anchored bottom-right with textarea, mic, history, export.
 *   2. MINIMIZED — a small floating bar at bottom-right that stays out of the way
 *      while the user clicks through the site. Voice dictation keeps running.
 *
 * Workflow: Open → start dictating → minimize → click around the site for minutes
 * while talking → expand or just hit Submit on the bar.
 *
 * Dictation uses the Web Speech API (same as think-out-loud).
 * Feedback is stored in localStorage and exportable as .txt.
 */

const FeedbackWidget = {
    isOpen: false,
    isMinimized: false,
    isRecording: false,
    recognition: null,
    feedbackEntries: [],
    _lastMethod: null,
    _finalTranscript: '',

    // ==================== Init & Storage ====================

    init() {
        this.loadEntries();
        this.createUI();
        console.log('Feedback Widget initialized');
    },

    loadEntries() {
        try {
            const saved = localStorage.getItem('feedback-entries');
            if (saved) this.feedbackEntries = JSON.parse(saved);
        } catch (e) {
            console.error('Error loading feedback:', e);
            this.feedbackEntries = [];
        }
    },

    saveEntries() {
        try {
            localStorage.setItem('feedback-entries', JSON.stringify(this.feedbackEntries));
        } catch (e) {
            console.error('Error saving feedback:', e);
        }
    },

    // ==================== UI Creation ====================

    createUI() {
        // Header trigger button
        let btn = document.getElementById('feedback-trigger-btn');
        if (!btn) {
            btn = document.createElement('button');
            btn.id = 'feedback-trigger-btn';
            btn.className = 'feedback-trigger-btn';
            btn.onclick = () => this.toggle();
            btn.title = 'Leave feedback';
            btn.innerHTML = '<span class="feedback-trigger-icon">&#128172;</span><span class="feedback-trigger-label">Feedback</span>';

            const headerRight = document.querySelector('.header-right');
            const aboutLink = headerRight ? headerRight.querySelector('.header-about-link') : null;
            if (aboutLink) {
                headerRight.insertBefore(btn, aboutLink);
            } else if (headerRight) {
                headerRight.appendChild(btn);
            } else {
                document.body.appendChild(btn);
            }
        }

        // Expanded panel (anchored bottom-right, no backdrop)
        let panel = document.getElementById('feedback-panel');
        if (!panel) {
            panel = document.createElement('div');
            panel.id = 'feedback-panel';
            panel.className = 'feedback-panel';
            panel.innerHTML = this._getPanelHTML();
            document.body.appendChild(panel);
        }

        // Minimized bar (small floating strip at bottom-right)
        let bar = document.getElementById('feedback-bar');
        if (!bar) {
            bar = document.createElement('div');
            bar.id = 'feedback-bar';
            bar.className = 'feedback-bar';
            bar.innerHTML = this._getBarHTML();
            document.body.appendChild(bar);
        }
    },

    // ---- Expanded panel HTML ----
    _getPanelHTML() {
        return `
            <div class="feedback-panel-header">
                <div class="feedback-panel-header-left">
                    <span class="feedback-panel-icon">&#128172;</span>
                    <span class="feedback-panel-title">Share Feedback</span>
                </div>
                <div class="feedback-panel-header-right">
                    <button class="feedback-minimize-btn" onclick="FeedbackWidget.minimize()" title="Minimize — keeps recording">&#8722;</button>
                    <button class="feedback-panel-close" onclick="FeedbackWidget.close()" title="Close">&times;</button>
                </div>
            </div>
            <div class="feedback-panel-body">
                <p class="feedback-prompt">Share thoughts, bugs, ideas, or reactions while using the site. Type or dictate — minimize to keep recording while you browse.</p>
                <div class="feedback-input-area">
                    <textarea
                        id="feedback-textarea"
                        class="feedback-textarea"
                        placeholder="Start typing or press the mic to dictate..."
                        rows="4"
                    ></textarea>
                    <div class="feedback-input-actions">
                        <button id="feedback-mic-btn" class="feedback-mic-btn" onclick="FeedbackWidget.toggleDictation()" title="Dictate feedback">
                            <span>&#127908;</span>
                        </button>
                        <div id="feedback-recording-indicator" class="feedback-recording-indicator" style="display:none;">
                            <span class="recording-dot"></span>
                            <span>Listening...</span>
                        </div>
                        <div class="feedback-input-actions-right">
                            <button class="feedback-submit-btn" onclick="FeedbackWidget.submit()">Save Feedback</button>
                        </div>
                    </div>
                </div>
                <div id="feedback-history" class="feedback-history">
                    ${this._renderHistory()}
                </div>
            </div>
            <div class="feedback-panel-footer">
                <button class="feedback-export-btn" onclick="FeedbackWidget.exportFeedback()" title="Download all feedback as a text file">
                    <span>&#128229;</span> Export All
                </button>
                <span class="feedback-entry-count" id="feedback-entry-count">${this.feedbackEntries.length} entries</span>
            </div>
        `;
    },

    // ---- Minimized bar HTML ----
    _getBarHTML() {
        return `
            <div class="feedback-bar-left" onclick="FeedbackWidget.expand()">
                <span class="feedback-bar-icon">&#128172;</span>
                <span id="feedback-bar-status" class="feedback-bar-status">Feedback</span>
                <span id="feedback-bar-preview" class="feedback-bar-preview"></span>
            </div>
            <div class="feedback-bar-right">
                <button id="feedback-bar-mic" class="feedback-bar-mic" onclick="FeedbackWidget.toggleDictation()" title="Toggle mic">&#127908;</button>
                <button class="feedback-bar-submit" onclick="FeedbackWidget.submit()">Submit</button>
                <button class="feedback-bar-expand" onclick="FeedbackWidget.expand()" title="Expand">&#9650;</button>
            </div>
        `;
    },

    // ==================== Open / Close / Minimize / Expand ====================

    toggle() {
        if (this.isOpen) {
            this.close();
        } else {
            this.open();
        }
    },

    open() {
        this.isOpen = true;
        this.isMinimized = false;

        const panel = document.getElementById('feedback-panel');
        const bar = document.getElementById('feedback-bar');
        if (panel) panel.classList.add('visible');
        if (bar) bar.classList.remove('visible');

        const btn = document.getElementById('feedback-trigger-btn');
        if (btn) btn.classList.add('active');

        // Sync textarea with any accumulated transcript
        this._syncTextarea();

        setTimeout(() => {
            const textarea = document.getElementById('feedback-textarea');
            if (textarea) textarea.focus();
        }, 200);
    },

    close() {
        this.isOpen = false;
        this.isMinimized = false;

        const panel = document.getElementById('feedback-panel');
        const bar = document.getElementById('feedback-bar');
        if (panel) panel.classList.remove('visible');
        if (bar) bar.classList.remove('visible');

        const btn = document.getElementById('feedback-trigger-btn');
        if (btn) btn.classList.remove('active');

        // Stop dictation on full close
        if (this.isRecording) {
            this.stopDictation();
        }
    },

    /** Minimize to floating bar — dictation keeps running */
    minimize() {
        this.isMinimized = true;

        const panel = document.getElementById('feedback-panel');
        const bar = document.getElementById('feedback-bar');
        if (panel) panel.classList.remove('visible');
        if (bar) bar.classList.add('visible');

        // Sync the final transcript from textarea in case user typed something
        const textarea = document.getElementById('feedback-textarea');
        if (textarea) {
            this._finalTranscript = textarea.value;
        }

        this._updateBar();
    },

    /** Expand from minimized bar back to full panel */
    expand() {
        this.isMinimized = false;

        const panel = document.getElementById('feedback-panel');
        const bar = document.getElementById('feedback-bar');
        if (panel) panel.classList.add('visible');
        if (bar) bar.classList.remove('visible');

        // Sync textarea
        this._syncTextarea();
    },

    // ==================== Submit ====================

    submit() {
        // Gather text from whichever source is current
        let text;
        if (this.isMinimized) {
            text = this._finalTranscript.trim();
        } else {
            const textarea = document.getElementById('feedback-textarea');
            text = textarea ? textarea.value.trim() : '';
        }

        if (!text) {
            App.showToast('Please enter some feedback first', 'info');
            return;
        }

        const entry = {
            text: text,
            timestamp: new Date().toISOString(),
            page: window.location.hash || '#/chart-review',
            method: this._lastMethod || 'typed',
            userAgent: navigator.userAgent
        };

        this.feedbackEntries.push(entry);
        this.saveEntries();

        // Clear
        this._finalTranscript = '';
        this._lastMethod = null;
        const textarea = document.getElementById('feedback-textarea');
        if (textarea) textarea.value = '';

        // Stop recording
        if (this.isRecording) {
            this.stopDictation();
        }

        this._refreshUI();
        this._updateBar();

        App.showToast('Feedback saved! Thank you.', 'success');

        // If minimized, close the bar after submit
        if (this.isMinimized) {
            setTimeout(() => this.close(), 800);
        }
    },

    // ==================== Voice Dictation ====================

    toggleDictation() {
        if (this.isRecording) {
            this.stopDictation();
        } else {
            this.startDictation();
        }
    },

    startDictation() {
        const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
        if (!SpeechRecognition) {
            App.showToast('Voice dictation not supported in this browser', 'error');
            return;
        }

        // Seed from textarea if we're in expanded mode
        if (!this.isMinimized) {
            const textarea = document.getElementById('feedback-textarea');
            if (textarea) this._finalTranscript = textarea.value;
        }

        this.recognition = new SpeechRecognition();
        this.recognition.continuous = true;
        this.recognition.interimResults = true;
        this.recognition.lang = 'en-US';

        this.recognition.onresult = (event) => {
            let interim = '';
            for (let i = event.resultIndex; i < event.results.length; i++) {
                const transcript = event.results[i][0].transcript;
                if (event.results[i].isFinal) {
                    this._finalTranscript += (this._finalTranscript ? ' ' : '') + transcript;
                } else {
                    interim = transcript;
                }
            }

            // Update whichever UI is visible
            if (this.isMinimized) {
                this._updateBar(interim);
            } else {
                const textarea = document.getElementById('feedback-textarea');
                if (textarea) {
                    textarea.value = this._finalTranscript + (interim ? ' ' + interim : '');
                    textarea.scrollTop = textarea.scrollHeight;
                }
            }
        };

        this.recognition.onerror = (event) => {
            console.error('Speech recognition error:', event.error);
            if (event.error !== 'aborted' && event.error !== 'no-speech') {
                this.stopDictation();
                App.showToast('Voice input error: ' + event.error, 'error');
            }
        };

        this.recognition.onend = () => {
            // Auto-restart if still recording
            if (this.isRecording) {
                try {
                    this.recognition.start();
                } catch (e) {
                    this.stopDictation();
                }
            }
        };

        try {
            this.recognition.start();
            this.isRecording = true;
            this._lastMethod = 'voice';
            this._updateRecordingUI(true);
        } catch (e) {
            console.error('Failed to start speech recognition:', e);
            App.showToast('Failed to start voice input', 'error');
        }
    },

    stopDictation() {
        this.isRecording = false;
        if (this.recognition) {
            try { this.recognition.stop(); } catch (e) { /* ignore */ }
            this.recognition = null;
        }
        this._updateRecordingUI(false);
    },

    // ==================== UI Helpers ====================

    _updateRecordingUI(recording) {
        // Expanded panel mic button
        const micBtn = document.getElementById('feedback-mic-btn');
        if (micBtn) micBtn.classList.toggle('recording', recording);

        // Expanded panel indicator
        const indicator = document.getElementById('feedback-recording-indicator');
        if (indicator) indicator.style.display = recording ? '' : 'none';

        // Minimized bar mic button
        const barMic = document.getElementById('feedback-bar-mic');
        if (barMic) barMic.classList.toggle('recording', recording);

        // Bar status text
        const barStatus = document.getElementById('feedback-bar-status');
        if (barStatus) {
            barStatus.textContent = recording ? 'Recording...' : 'Feedback';
            barStatus.classList.toggle('is-recording', recording);
        }

        // Whole bar recording state
        const bar = document.getElementById('feedback-bar');
        if (bar) bar.classList.toggle('is-recording', recording);
    },

    _updateBar(interim) {
        const preview = document.getElementById('feedback-bar-preview');
        if (!preview) return;

        let text = this._finalTranscript;
        if (interim) text += ' ' + interim;
        text = text.trim();

        if (text.length > 60) {
            preview.textContent = '...' + text.slice(-57);
        } else {
            preview.textContent = text;
        }
    },

    /** Sync the expanded textarea with accumulated _finalTranscript */
    _syncTextarea() {
        const textarea = document.getElementById('feedback-textarea');
        if (textarea && this._finalTranscript) {
            textarea.value = this._finalTranscript;
            textarea.scrollTop = textarea.scrollHeight;
        }
    },

    _refreshUI() {
        const history = document.getElementById('feedback-history');
        if (history) history.innerHTML = this._renderHistory();
        const count = document.getElementById('feedback-entry-count');
        if (count) count.textContent = `${this.feedbackEntries.length} entries`;
    },

    _renderHistory() {
        if (this.feedbackEntries.length === 0) {
            return '<div class="feedback-empty">No feedback yet. Be the first to share your thoughts!</div>';
        }
        const recent = this.feedbackEntries.slice(-10).reverse();
        let html = '<div class="feedback-history-title">Recent feedback</div>';
        recent.forEach((entry) => {
            const date = new Date(entry.timestamp);
            const timeStr = date.toLocaleString('en-US', {
                month: 'short', day: 'numeric',
                hour: 'numeric', minute: '2-digit', hour12: true
            });
            const page = entry.page || '';
            const method = entry.method === 'voice' ? '&#127908;' : '&#9998;';
            const displayText = entry.text.length > 200 ? entry.text.substring(0, 200) + '...' : entry.text;
            html += `
                <div class="feedback-entry">
                    <div class="feedback-entry-meta">
                        <span class="feedback-entry-method">${method}</span>
                        <span class="feedback-entry-time">${timeStr}</span>
                        ${page ? `<span class="feedback-entry-page">${page}</span>` : ''}
                    </div>
                    <div class="feedback-entry-text">${this._escapeHtml(displayText)}</div>
                </div>
            `;
        });
        return html;
    },

    exportFeedback() {
        if (this.feedbackEntries.length === 0) {
            App.showToast('No feedback to export', 'info');
            return;
        }
        let content = '=== Acting Intern — User Feedback Export ===\n';
        content += `Exported: ${new Date().toLocaleString()}\n`;
        content += `Total entries: ${this.feedbackEntries.length}\n`;
        content += '='.repeat(50) + '\n\n';
        this.feedbackEntries.forEach((entry, i) => {
            const date = new Date(entry.timestamp);
            content += `--- Entry ${i + 1} ---\n`;
            content += `Date: ${date.toLocaleString()}\n`;
            content += `Page: ${entry.page || 'unknown'}\n`;
            content += `Method: ${entry.method || 'typed'}\n`;
            content += `\n${entry.text}\n\n`;
        });
        const blob = new Blob([content], { type: 'text/plain' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `acting-intern-feedback-${new Date().toISOString().split('T')[0]}.txt`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        App.showToast('Feedback exported!', 'success');
    },

    _escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }
};

window.FeedbackWidget = FeedbackWidget;
