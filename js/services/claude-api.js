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
     * Check if API is configured
     * In proxy mode: always true (server handles auth)
     * In fallback mode: needs localStorage API key
     */
    isConfigured() {
        if (this.useProxy) return true;
        return !!this.apiKey;
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
            'x-api-key': this.apiKey,
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
     * Send a message to Claude and get a response
     */
    async sendMessage(systemPrompt, messages) {
        if (!this.isConfigured()) {
            throw new Error('API key not configured. Please add your Anthropic API key in settings.');
        }

        try {
            const response = await fetch(this._getEndpoint(), {
                method: 'POST',
                headers: this._getHeaders(),
                body: JSON.stringify({
                    model: this.model,
                    max_tokens: this.maxTokens,
                    system: systemPrompt,
                    messages: messages
                })
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

    setModel(model) {
        this.model = model;
    },

    setMaxTokens(tokens) {
        this.maxTokens = tokens;
    }
};

window.ClaudeAPI = ClaudeAPI;
