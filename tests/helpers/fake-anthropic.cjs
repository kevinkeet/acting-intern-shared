// Preloaded into server.js by the tests (node --require ...). Replaces the
// server's outbound fetch so a test can never reach the real Anthropic API or
// spend credit. A call to api.anthropic.com gets a canned reply that names
// which key the route used ("shared", "fullsite" or "unknown"); the same line
// is printed to stdout so a test can count AI calls. Any other outbound fetch
// is refused.
//
// The log line also says whether the request asked to stream and which
// anthropic-beta flags reached "Anthropic" (betas=- when none):
//   [fake-anthropic] call key=fullsite model=claude-sonnet-5-5 stream=yes betas=fast-mode-2026-02-01
// A streaming request ("stream": true) gets a short server-sent-event reply
// whose text is "fake stream key=<which>". If the last user message says
// "slow", the events trickle out 300 ms apart so a test can hang up mid-reply;
// when the server then cancels the upstream request, "[fake-anthropic]
// upstream aborted" is printed. Model "fake-error-model" gets a 400 JSON
// error, as Anthropic sends for a bad request even when streaming.
'use strict';

const SSE_EVENTS = (which, model) => [
    ['message_start', { type: 'message_start', message: { id: 'msg_fake', type: 'message', role: 'assistant', model, content: [], stop_reason: null, usage: { input_tokens: 0, output_tokens: 0 } } }],
    ['content_block_start', { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } }],
    ['ping', { type: 'ping' }],
    ['content_block_delta', { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'fake stream ' } }],
    ['content_block_delta', { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'key=' + which } }],
    ['content_block_stop', { type: 'content_block_stop', index: 0 }],
    ['message_delta', { type: 'message_delta', delta: { stop_reason: 'end_turn', stop_sequence: null }, usage: { output_tokens: 4 } }],
    ['message_stop', { type: 'message_stop' }],
];

function sseStream(events, slow, signal) {
    const enc = new TextEncoder();
    let i = 0;
    let timer = null;
    let done = false;
    return new ReadableStream({
        start(controller) {
            if (signal) {
                signal.addEventListener('abort', () => {
                    if (done) return;
                    done = true;
                    clearTimeout(timer);
                    console.log('[fake-anthropic] upstream aborted');
                    const err = new Error('This operation was aborted');
                    err.name = 'AbortError';
                    controller.error(err);
                });
            }
        },
        pull(controller) {
            return new Promise((resolve) => {
                const emit = () => {
                    if (done) return resolve();
                    if (i >= events.length) { done = true; controller.close(); return resolve(); }
                    const [name, data] = events[i++];
                    controller.enqueue(enc.encode('event: ' + name + '\ndata: ' + JSON.stringify(data) + '\n\n'));
                    resolve();
                };
                if (slow && i > 1) timer = setTimeout(emit, 300); else emit();
            });
        },
        cancel() { done = true; clearTimeout(timer); },
    });
}

function lastUserText(body) {
    const msgs = Array.isArray(body.messages) ? body.messages : [];
    for (let k = msgs.length - 1; k >= 0; k--) {
        if (msgs[k] && msgs[k].role === 'user') {
            const c = msgs[k].content;
            if (typeof c === 'string') return c;
            if (Array.isArray(c)) return c.map((b) => (b && b.text) || '').join(' ');
        }
    }
    return '';
}

globalThis.fetch = async (url, opts = {}) => {
    const u = String(url);
    if (!u.startsWith('https://api.anthropic.com/')) {
        throw new Error('fake-anthropic: outbound fetch blocked in tests: ' + u);
    }
    const headers = opts.headers || {};
    const key = headers['x-api-key'] || '';
    const which = key && key === process.env.ANTHROPIC_API_KEY_FULLSITE ? 'fullsite'
        : key && key === process.env.ANTHROPIC_API_KEY ? 'shared' : 'unknown';
    let body = {};
    try { body = JSON.parse(opts.body || '{}'); } catch (e) { /* ignore */ }
    const model = body.model || '';
    const stream = body.stream === true;
    const betas = headers['anthropic-beta'] || '-';
    console.log('[fake-anthropic] call key=' + which + ' model=' + model + ' stream=' + (stream ? 'yes' : 'no') + ' betas=' + betas);

    if (model === 'fake-error-model') {
        const err = { type: 'error', error: { type: 'invalid_request_error', message: 'fake: unknown model' } };
        return new Response(JSON.stringify(err), { status: 400, headers: { 'content-type': 'application/json' } });
    }
    if (stream) {
        const slow = /\bslow\b/.test(lastUserText(body));
        return new Response(sseStream(SSE_EVENTS(which, model || 'fake'), slow, opts.signal),
            { status: 200, headers: { 'content-type': 'text/event-stream; charset=utf-8' } });
    }
    const reply = {
        id: 'msg_fake', type: 'message', role: 'assistant', model: model || 'fake',
        content: [{ type: 'text', text: 'fake reply key=' + which }],
        stop_reason: 'end_turn', usage: { input_tokens: 0, output_tokens: 0 },
    };
    return new Response(JSON.stringify(reply), { status: 200, headers: { 'content-type': 'application/json' } });
};
