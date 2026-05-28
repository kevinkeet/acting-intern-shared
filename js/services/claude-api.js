/**
 * Claude API Service
 * Handles communication with the Anthropic Claude API via server proxy
 * (falls back to direct browser access if no backend detected)
 */

const ClaudeAPI = {
    model: 'claude-sonnet-4-6',
    maxTokens: 1024,

    // Set by AICoworker.detectBackend()
    useProxy: true,
    apiKey: null, // Only used in fallback (no backend) mode

    /**
     * Set the API key (fallback mode only)
     */
    setApiKey(key) {
        this.apiKey = key;
    },

    /**
     * Lazily load the API key from localStorage if it isn't already in memory.
     * Needed because the access gate writes the decrypted key to localStorage
     * but may not have called setApiKey() in this session (e.g., on the first
     * unlock, after detectBackend already ran). Self-healing here ensures every
     * downstream caller — chatbot, grader, AI coworker — can authenticate.
     */
    _ensureKey() {
        if (!this.useProxy && !this.apiKey) {
            try {
                const k = localStorage.getItem('anthropic-api-key');
                if (k) this.apiKey = k;
            } catch (e) { /* localStorage unavailable */ }
        }
        return this.apiKey;
    },

    /**
     * Check if API is configured
     * In proxy mode: always true (server handles auth)
     * In fallback mode: needs an API key (pulled from localStorage if needed)
     */
    isConfigured() {
        if (this.useProxy) return true;
        return !!this._ensureKey();
    },

    /**
     * Build headers based on mode
     */
    _getHeaders() {
        if (this.useProxy) {
            return { 'Content-Type': 'application/json' };
        }
        // Fallback: direct browser access
        return {
            'Content-Type': 'application/json',
            'x-api-key': this._ensureKey(),
            'anthropic-version': '2023-06-01',
            'anthropic-dangerous-direct-browser-access': 'true'
        };
    },

    /**
     * Get the API endpoint URL
     */
    _getEndpoint() {
        if (this.useProxy) return '/api/claude';
        return 'https://api.anthropic.com/v1/messages';
    },

    /**
     * Send a message to Claude and get a response.
     * @param {string} systemPrompt
     * @param {Array}  messages
     * @param {object} [options] - { model, maxTokens } to override defaults
     *                             for a single call without mutating shared state.
     */
    async sendMessage(systemPrompt, messages, options) {
        if (!this.isConfigured()) {
            throw new Error('API key not configured. Please add your Anthropic API key in settings.');
        }

        const opts = options || {};
        const body = {
            model: opts.model || this.model,
            max_tokens: opts.maxTokens || this.maxTokens,
            messages: messages,
        };
        // Only include `system` if a non-empty value was provided; otherwise
        // omit it so the API treats the request as having no system prompt.
        if (systemPrompt && String(systemPrompt).length > 0) {
            body.system = systemPrompt;
        }

        try {
            const response = await fetch(this._getEndpoint(), {
                method: 'POST',
                headers: this._getHeaders(),
                body: JSON.stringify(body)
            });

            if (!response.ok) {
                const errorData = await response.json().catch(() => ({}));
                const errorMessage = errorData.error?.message || `HTTP error ${response.status}`;
                throw new Error(errorMessage);
            }

            const data = await response.json();
            return data;
        } catch (error) {
            console.error('Claude API Error:', error);
            throw error;
        }
    },

    /**
     * Send a message and get just the text content
     */
    async chat(systemPrompt, messages) {
        const response = await this.sendMessage(systemPrompt, messages);

        if (response.content && response.content.length > 0) {
            return response.content[0].text;
        }

        throw new Error('Invalid response format from API');
    },

    /**
     * Stream a message response (simulated)
     */
    async chatStream(systemPrompt, messages, onChunk) {
        const fullResponse = await this.chat(systemPrompt, messages);

        const words = fullResponse.split(' ');
        let accumulated = '';

        for (let i = 0; i < words.length; i++) {
            accumulated += (i > 0 ? ' ' : '') + words[i];
            if (onChunk) {
                onChunk(accumulated);
            }
            await new Promise(resolve => setTimeout(resolve, 20));
        }

        return fullResponse;
    },

    /**
     * Run multiple LLM calls in parallel with concurrency control.
     * Each request: { systemPrompt, userMessage, model, maxTokens }
     * Returns array of { success, result?, error? } in same order as requests.
     * @param {Array} requests — array of request objects
     * @param {number} concurrency — max simultaneous calls (default 5)
     * @param {Function} onProgress — optional callback(completedCount, totalCount)
     */
    async parallelChat(requests, concurrency = 5, onProgress = null) {
        const results = new Array(requests.length);
        let completedCount = 0;
        let runningCount = 0;
        let nextIndex = 0;

        return new Promise((resolve) => {
            const startNext = () => {
                while (runningCount < concurrency && nextIndex < requests.length) {
                    const idx = nextIndex++;
                    const req = requests[idx];
                    runningCount++;

                    this._singleChat(req)
                        .then(result => {
                            results[idx] = { success: true, result };
                        })
                        .catch(error => {
                            console.warn(`parallelChat: request ${idx} failed:`, error.message);
                            results[idx] = { success: false, error: error.message };
                        })
                        .finally(() => {
                            runningCount--;
                            completedCount++;
                            if (onProgress) onProgress(completedCount, requests.length);
                            if (completedCount === requests.length) {
                                resolve(results);
                            } else {
                                startNext();
                            }
                        });
                }
            };
            if (requests.length === 0) resolve(results);
            else startNext();
        });
    },

    /**
     * Internal: single chat call with custom model/maxTokens (does not mutate this.model)
     */
    async _singleChat(req) {
        if (!this.isConfigured()) {
            throw new Error('API key not configured');
        }

        const response = await fetch(this._getEndpoint(), {
            method: 'POST',
            headers: this._getHeaders(),
            body: JSON.stringify({
                model: req.model || this.model,
                max_tokens: req.maxTokens || 1024,
                system: req.systemPrompt,
                messages: [{ role: 'user', content: req.userMessage }]
            })
        });

        if (!response.ok) {
            const errorData = await response.json().catch(() => ({}));
            throw new Error(errorData.error?.message || `HTTP ${response.status}`);
        }

        const data = await response.json();
        if (data.content && data.content.length > 0) {
            return data.content[0].text;
        }
        throw new Error('Invalid response format');
    },

    setModel(model) {
        this.model = model;
    },

    setMaxTokens(tokens) {
        this.maxTokens = tokens;
    }
};

window.ClaudeAPI = ClaudeAPI;
