// Preloaded into server.js by the tests (node --require ...). Replaces the
// server's outbound fetch so a test can never reach the real Anthropic API or
// spend credit. A call to api.anthropic.com gets a canned reply that names
// which key the route used ("shared", "fullsite" or "unknown"); the same line
// is printed to stdout so a test can count AI calls. Any other outbound fetch
// is refused.
'use strict';

globalThis.fetch = async (url, opts = {}) => {
    const u = String(url);
    if (!u.startsWith('https://api.anthropic.com/')) {
        throw new Error('fake-anthropic: outbound fetch blocked in tests: ' + u);
    }
    const headers = opts.headers || {};
    const key = headers['x-api-key'] || '';
    const which = key && key === process.env.ANTHROPIC_API_KEY_FULLSITE ? 'fullsite'
        : key && key === process.env.ANTHROPIC_API_KEY ? 'shared' : 'unknown';
    let model = '';
    try { model = JSON.parse(opts.body || '{}').model || ''; } catch (e) { /* ignore */ }
    console.log('[fake-anthropic] call key=' + which + ' model=' + model);
    const body = {
        id: 'msg_fake', type: 'message', role: 'assistant', model: model || 'fake',
        content: [{ type: 'text', text: 'fake reply key=' + which }],
        stop_reason: 'end_turn', usage: { input_tokens: 0, output_tokens: 0 },
    };
    return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
};
