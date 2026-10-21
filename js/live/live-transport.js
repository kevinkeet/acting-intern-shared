/**
 * Live Coworker: streaming transport, model list and cost meter.
 *
 * Runs in the browser (full-site door only) and in Node (the replay harness).
 * One call = one POST of a Messages API body with "stream": true. The reply's
 * server-sent events are folded back into a normal message object, text is
 * handed to onText as it arrives, and timing and cost are measured.
 *
 * Where the request goes is decided by the caller: in the browser the
 * endpoint and headers come from ClaudeAPI (so the full-site door uses
 * /api/claude-full); the harness passes the lab server's URL. No API key ever
 * lives in this file.
 */
(function (root) {
    'use strict';

    // $ per million tokens. Haiku's rate applies to prompts up to 100K tokens.
    const MODELS = {
        'claude-haiku-5-5':  { label: 'Haiku 5.5',  in: 0.10, out: 0.50,  cacheWrite: 0.125, cacheRead: 0.01, fallback: false, fast: false },
        'claude-sonnet-5-5': { label: 'Sonnet 5.5', in: 2.00, out: 10.00, cacheWrite: 2.50,  cacheRead: 0.20, fallback: true,  fast: false },
        'claude-opus-5-5':   { label: 'Opus 5.5',   in: 4.00, out: 20.00, cacheWrite: 5.00,  cacheRead: 0.20, fallback: true,  fast: true },
    };
    const BETA_FALLBACK = 'server-side-fallback-2026-07-01';
    const BETA_FAST = 'fast-mode-2026-02-01';

    function priceOf(model, speed) {
        const p = MODELS[model];
        if (!p) return null;
        const k = speed === 'fast' ? 2 : 1;
        return { in: p.in * k, out: p.out * k, cacheWrite: p.cacheWrite * k, cacheRead: p.cacheRead * k };
    }

    /** Dollar cost of one reply's usage block. */
    function costOf(model, usage, speed) {
        const p = priceOf(model, speed);
        if (!p || !usage) return 0;
        const M = 1e6;
        return ((usage.input_tokens || 0) * p.in
            + (usage.cache_creation_input_tokens || 0) * p.cacheWrite
            + (usage.cache_read_input_tokens || 0) * p.cacheRead
            + (usage.output_tokens || 0) * p.out) / M;
    }

    class LiveApiError extends Error {
        constructor(status, body, message) {
            const apiMsg = body && body.error && body.error.message;
            super(message || ('AI call failed (' + status + ')' + (apiMsg ? ': ' + apiMsg : '')));
            this.name = 'LiveApiError';
            this.status = status;
            this.type = body && body.error && body.error.type;
            this.retryable = status === 429 || status === 529 || status >= 500 || status === 0;
        }
    }

    /**
     * Fold one parsed SSE event into the message being built.
     * Returns the text delta (if any) so the caller can stream it.
     */
    function applyEvent(state, name, data) {
        const type = (data && data.type) || name;
        switch (type) {
            case 'message_start': {
                const m = data.message || {};
                state.msg = Object.assign({}, m, { content: [] });
                state.usage = Object.assign({}, m.usage || {});
                return null;
            }
            case 'content_block_start': {
                const block = Object.assign({}, data.content_block || {});
                if (block.type === 'tool_use' || block.type === 'server_tool_use') {
                    block._json = '';
                }
                if (block.type === 'text' && typeof block.text !== 'string') block.text = '';
                if (block.type === 'thinking' && typeof block.thinking !== 'string') block.thinking = '';
                state.msg.content[data.index] = block;
                return null;
            }
            case 'content_block_delta': {
                const block = state.msg.content[data.index];
                const d = data.delta || {};
                if (!block) return null;
                if (d.type === 'text_delta') { block.text = (block.text || '') + d.text; return { index: data.index, text: d.text }; }
                if (d.type === 'input_json_delta') { block._json = (block._json || '') + (d.partial_json || ''); return null; }
                if (d.type === 'thinking_delta') { block.thinking = (block.thinking || '') + (d.thinking || ''); return null; }
                if (d.type === 'signature_delta') { block.signature = (block.signature || '') + (d.signature || ''); return null; }
                if (d.type === 'citations_delta') { (block.citations = block.citations || []).push(d.citation); return null; }
                return null;
            }
            case 'content_block_stop': {
                const block = state.msg.content[data.index];
                if (block && typeof block._json === 'string') {
                    const raw = block._json;
                    delete block._json;
                    try { block.input = raw ? JSON.parse(raw) : (block.input || {}); }
                    catch (e) { block.input = {}; block._badJson = raw; }
                }
                return null;
            }
            case 'message_delta': {
                if (data.delta) {
                    if ('stop_reason' in data.delta) state.msg.stop_reason = data.delta.stop_reason;
                    if ('stop_sequence' in data.delta) state.msg.stop_sequence = data.delta.stop_sequence;
                    if (data.delta.stop_details) state.msg.stop_details = data.delta.stop_details;
                }
                if (data.usage) Object.assign(state.usage, data.usage);
                return null;
            }
            case 'message_stop':
                state.done = true;
                return null;
            case 'error': {
                const err = data && data.error;
                state.error = new LiveApiError(0, { error: err }, 'AI stream error: ' + ((err && err.message) || 'unknown'));
                state.error.retryable = !!(err && /overloaded|api_error|proxy_error/.test(err.type || ''));
                return null;
            }
            default:
                return null; // ping and anything new
        }
    }

    /** Split a buffer into complete SSE event blocks; returns [events, rest]. */
    function takeEvents(buffer) {
        const events = [];
        let idx;
        buffer = buffer.replace(/\r\n/g, '\n');
        while ((idx = buffer.indexOf('\n\n')) !== -1) {
            const block = buffer.slice(0, idx);
            buffer = buffer.slice(idx + 2);
            let name = null;
            const dataLines = [];
            for (const line of block.split('\n')) {
                if (line.startsWith('event:')) name = line.slice(6).trim();
                else if (line.startsWith('data:')) dataLines.push(line.slice(5).replace(/^ /, ''));
            }
            if (!dataLines.length) continue;
            let data = null;
            try { data = JSON.parse(dataLines.join('\n')); } catch (e) { continue; }
            events.push([name, data]);
        }
        return [events, buffer];
    }

    /**
     * Make a transport.
     *   endpoint: string or () => string
     *   headers:  object or () => object (Content-Type etc.; the browser's comes from ClaudeAPI)
     *   fetchImpl: fetch (default: global fetch)
     *   now: () => ms (default: performance.now / Date.now)
     *   stream: bool or () => bool (default true; false for a server that cannot stream)
     */
    function createTransport(opts) {
        const o = opts || {};
        const fetchImpl = o.fetchImpl || (typeof fetch !== 'undefined' ? fetch.bind(root) : null);
        const now = o.now || (() => (typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now()));
        const resolve = (v) => (typeof v === 'function' ? v() : v);
        const totals = { calls: 0, cost: 0, byModel: {} };

        /**
         * One streamed Messages API call.
         *   req: { model, body (without model/stream), speed?, fallback? (default on where offered), label? }
         *   hooks: { onText(delta, index), signal }
         * Resolves to { message, text, usage, cost, ms: {ttft, total}, model, servedBy, fellBack }.
         */
        async function call(req, hooks) {
            const h = hooks || {};
            const info = MODELS[req.model] || {};
            const body = Object.assign({}, req.body, { model: req.model, stream: o.stream == null ? true : !!resolve(o.stream) });
            const betas = [];
            if (info.fallback && req.fallback !== false) { body.fallbacks = 'default'; betas.push(BETA_FALLBACK); }
            if (req.speed === 'fast' && info.fast) { body.speed = 'fast'; betas.push(BETA_FAST); }
            const headers = Object.assign({ 'Content-Type': 'application/json' }, resolve(o.headers) || {});
            if (betas.length) headers['anthropic-beta'] = betas.join(',');

            const t0 = now();
            let ttft = null;
            let res;
            try {
                res = await fetchImpl(resolve(o.endpoint), { method: 'POST', headers, body: JSON.stringify(body), signal: h.signal });
            } catch (e) {
                if (e && e.name === 'AbortError') throw e;
                throw new LiveApiError(0, null, 'Could not reach the AI service: ' + (e && e.message));
            }
            if (!res.ok) {
                let errBody = null;
                try { errBody = await res.json(); } catch (e) { /* not JSON */ }
                throw new LiveApiError(res.status, errBody);
            }

            const state = { msg: null, usage: {}, done: false, error: null };
            const ctype = (res.headers && res.headers.get && res.headers.get('content-type')) || '';
            if (!/event-stream/i.test(ctype)) {
                // A server that does not stream sends the whole message as JSON.
                const m = await res.json();
                state.msg = m;
                state.usage = m.usage || {};
                state.done = true;
                ttft = now() - t0;
                const txt = (m.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('');
                if (txt && h.onText) h.onText(txt, 0);
            } else {
                const reader = res.body.getReader();
                const decoder = new TextDecoder();
                let buffer = '';
                for (;;) {
                    const { value, done } = await reader.read();
                    if (done) break;
                    buffer += decoder.decode(value, { stream: true });
                    const [events, rest] = takeEvents(buffer);
                    buffer = rest;
                    for (const [name, data] of events) {
                        const delta = applyEvent(state, name, data);
                        if (delta && delta.text) {
                            if (ttft === null) ttft = now() - t0;
                            if (h.onText) h.onText(delta.text, delta.index);
                        }
                    }
                    if (state.error) break;
                }
                if (buffer.trim()) {
                    const [events] = takeEvents(buffer + '\n\n');
                    for (const [name, data] of events) applyEvent(state, name, data);
                }
            }
            if (state.error) throw state.error;
            if (!state.msg) throw new LiveApiError(0, null, 'Empty reply from the AI service');
            if (!state.done && !state.msg.stop_reason) throw new LiveApiError(0, null, 'The AI reply was cut off');

            const message = state.msg;
            message.usage = state.usage;
            message.content = (message.content || []).filter(Boolean);
            const total = now() - t0;
            const servedBy = message.model || req.model;
            const fellBack = (message.content || []).some((b) => b.type === 'fallback')
                || ((state.usage.iterations || []).some((it) => it && it.type === 'fallback_message'));
            const cost = costOf(fellBack && MODELS[servedBy] ? servedBy : req.model, state.usage, req.speed === 'fast' ? (state.usage.speed || 'fast') : null);
            const text = message.content.filter((b) => b.type === 'text').map((b) => b.text).join('');

            totals.calls += 1;
            totals.cost += cost;
            const bm = totals.byModel[req.model] || (totals.byModel[req.model] = { calls: 0, cost: 0, input: 0, cached: 0, output: 0 });
            bm.calls += 1;
            bm.cost += cost;
            bm.input += (state.usage.input_tokens || 0) + (state.usage.cache_creation_input_tokens || 0);
            bm.cached += state.usage.cache_read_input_tokens || 0;
            bm.output += state.usage.output_tokens || 0;

            return { message, text, usage: state.usage, cost, ms: { ttft: ttft === null ? total : ttft, total }, model: req.model, servedBy, fellBack, label: req.label || '' };
        }

        /** call() with one quick retry on overload, rate limit or a dropped connection. */
        async function callWithRetry(req, hooks, retries) {
            let left = retries == null ? 1 : retries;
            for (;;) {
                try {
                    return await call(req, hooks);
                } catch (e) {
                    if (e && e.name === 'AbortError') throw e;
                    if (left <= 0 || !(e && e.retryable)) throw e;
                    left -= 1;
                    await new Promise((r) => setTimeout(r, 900));
                }
            }
        }

        return { call, callWithRetry, totals, MODELS };
    }

    const api = { createTransport, costOf, priceOf, MODELS, LiveApiError, BETA_FALLBACK, BETA_FAST, _takeEvents: takeEvents, _applyEvent: applyEvent };
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    else root.LiveTransport = api;
})(typeof window !== 'undefined' ? window : globalThis);
