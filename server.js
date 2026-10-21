require('dotenv').config();
const express = require('express');
const http = require('http');
const path = require('path');
const WebSocket = require('ws');

const app = express();
const server = http.createServer(app);
const PORT = process.env.PORT || 3000;

// --- Parse JSON bodies (up to 1MB for large prompts) ---
app.use(express.json({ limit: '1mb' }));

// --- Static file serving (frontend) ---
app.use(express.static(path.join(__dirname, '.')));

// --- Health check ---
app.get('/api/health', (req, res) => {
    res.json({
        status: 'ok',
        apiConfigured: !!process.env.ANTHROPIC_API_KEY,
        deepgramConfigured: !!process.env.DEEPGRAM_API_KEY,
        // The full-site door sends its AI calls to /api/claude-full (below).
        fullSiteRoute: true,
        fullSiteKeyConfigured: !!process.env.ANTHROPIC_API_KEY_FULLSITE,
        // /api/claude-full passes "stream": true replies straight through (lab, 21 Oct 2026).
        fullSiteStreaming: true
    });
});

// --- Anthropic API proxy ---
app.post('/api/claude', async (req, res) => {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
        return res.status(500).json({
            error: { message: 'ANTHROPIC_API_KEY not configured on server' }
        });
    }

    try {
        const response = await fetch('https://api.anthropic.com/v1/messages', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'x-api-key': apiKey,
                'anthropic-version': '2023-06-01'
            },
            body: JSON.stringify(req.body)
        });

        const data = await response.json();
        res.status(response.status).json(data);
    } catch (error) {
        console.error('Anthropic proxy error:', error.message);
        res.status(502).json({
            error: { message: 'Failed to reach Anthropic API: ' + error.message }
        });
    }
});

// --- Full-site Anthropic proxy ---
// The full-site door (?allmodes: AI Assistant, Tutor, all patients) calls this
// route instead of /api/claude. It is paid by its own key,
// ANTHROPIC_API_KEY_FULLSITE, which belongs in a separate Anthropic workspace
// with a monthly spend limit, so heavy full-site use can never spend the
// credit the study's AI Chat and auto-grader rely on. Until that variable is
// set, this route uses the shared key, which is what the full site used before.
// /api/claude above is deliberately left unchanged for the study.
//
// Two additions for the real-time AI Coworker (Kevin's OK, 21 Oct 2026; full-site
// route only):
//  - A request with "stream": true gets Anthropic's server-sent events passed
//    straight through as they arrive, and if the browser goes away mid-reply the
//    upstream request is cancelled so it stops generating (and billing).
//  - The anthropic-beta flags on FULL_SITE_BETAS are forwarded; any other flag
//    the browser sends is dropped.
const FULL_SITE_BETAS = new Set([
    'fast-mode-2026-02-01',            // speed: "fast" (Opus)
    'server-side-fallback-2026-07-01'  // fallbacks: "default" after a safety decline
]);

function fullSiteBetas(headerValue) {
    if (!headerValue) return [];
    return String(headerValue).split(',')
        .map((flag) => flag.trim())
        .filter((flag) => FULL_SITE_BETAS.has(flag));
}

app.post('/api/claude-full', async (req, res) => {
    const apiKey = process.env.ANTHROPIC_API_KEY_FULLSITE || process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
        return res.status(500).json({
            error: { message: 'No Anthropic API key configured on server' }
        });
    }

    const headers = {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01'
    };
    const betas = fullSiteBetas(req.get('anthropic-beta'));
    if (betas.length) headers['anthropic-beta'] = betas.join(',');

    const streaming = !!(req.body && req.body.stream === true);
    const upstream = new AbortController();
    if (streaming) {
        // 'close' also fires after a normal end; only a reply cut short cancels.
        res.on('close', () => { if (!res.writableEnded) upstream.abort(); });
    }

    try {
        const response = await fetch('https://api.anthropic.com/v1/messages', {
            method: 'POST',
            headers,
            body: JSON.stringify(req.body),
            signal: upstream.signal
        });

        const isEventStream = streaming && response.ok &&
            /text\/event-stream/i.test(response.headers.get('content-type') || '');
        if (!isEventStream) {
            // Ordinary replies, and errors (which Anthropic sends as JSON even
            // for streaming requests), pass through as before.
            const data = await response.json();
            return res.status(response.status).json(data);
        }

        res.status(200).set({
            'Content-Type': 'text/event-stream; charset=utf-8',
            'Cache-Control': 'no-cache, no-transform',
            'Connection': 'keep-alive',
            'X-Accel-Buffering': 'no'
        });
        res.flushHeaders();
        for await (const chunk of response.body) {
            res.write(chunk);
        }
        res.end();
    } catch (error) {
        if (upstream.signal.aborted) {
            // The browser left mid-reply; nothing to report.
            if (!res.writableEnded) res.end();
            return;
        }
        console.error('Anthropic full-site proxy error:', error.message);
        if (res.headersSent) {
            // Broke mid-stream: say so in the stream's own format, then close.
            res.write('event: error\ndata: ' + JSON.stringify({
                type: 'error',
                error: { type: 'proxy_error', message: 'Stream from Anthropic broke: ' + error.message }
            }) + '\n\n');
            return res.end();
        }
        res.status(502).json({
            error: { message: 'Failed to reach Anthropic API: ' + error.message }
        });
    }
});

// --- Text to speech for the live coworker (Deepgram Aura; lab, Kevin's OK 21 Oct 2026) ---
// The browser posts one sentence at a time; the server adds its Deepgram key and
// streams the audio (MP3) back. Voices are an allowlist; text is capped well under
// Deepgram's 2,000 characters. (DEEPGRAM_SPEAK_URL exists for the tests.)
const DEEPGRAM_SPEAK_URL = process.env.DEEPGRAM_SPEAK_URL || 'https://api.deepgram.com/v1/speak';
const TTS_VOICES = new Set(['aura-2-athena-en', 'aura-2-asteria-en', 'aura-2-thalia-en', 'aura-2-harmonia-en',
    'aura-2-odysseus-en', 'aura-2-orpheus-en', 'aura-2-arcas-en', 'aura-2-draco-en', 'aura-2-pandora-en']);
app.post('/api/tts', async (req, res) => {
    const key = process.env.DEEPGRAM_API_KEY;
    if (!key) return res.status(503).json({ error: 'Speech is not set up on this server' });
    const text = String((req.body && req.body.text) || '').replace(/\s+/g, ' ').trim();
    if (!text) return res.status(400).json({ error: 'No text to speak' });
    if (text.length > 1000) return res.status(413).json({ error: 'Text too long (1,000 characters at most)' });
    const voice = TTS_VOICES.has(req.body && req.body.voice) ? req.body.voice : 'aura-2-athena-en';
    const upstream = new AbortController();
    res.on('close', () => { if (!res.writableEnded) upstream.abort(); });
    try {
        const r = await fetch(DEEPGRAM_SPEAK_URL + '?model=' + voice, {
            method: 'POST',
            headers: { 'Authorization': 'Token ' + key, 'Content-Type': 'application/json' },
            body: JSON.stringify({ text }),
            signal: upstream.signal,
        });
        if (!r.ok) {
            const detail = (await r.text().catch(() => '')).slice(0, 200);
            console.error('🔊 TTS: Deepgram replied ' + r.status);
            return res.status(r.status === 429 ? 429 : 502).json({ error: 'Speech service error (' + r.status + ')', detail });
        }
        res.status(200).set({ 'Content-Type': r.headers.get('content-type') || 'audio/mpeg', 'Cache-Control': 'no-store' });
        for await (const chunk of r.body) res.write(chunk);
        res.end();
    } catch (e) {
        if (upstream.signal.aborted || res.headersSent) return res.end();
        console.error('🔊 TTS error:', e.message);
        res.status(502).json({ error: 'Could not reach the speech service' });
    }
});

// --- Deepgram WebSocket relay ---
const wss = new WebSocket.Server({ server, path: '/ws/transcribe' });

// A browser may ask for Deepgram's medical model and pass vocabulary hints (drug
// names) in the URL: /ws/transcribe?model=medical&keyterm=Entresto&keyterm=Zosyn.
// Anything else is ignored, so a caller that passes nothing gets exactly the
// connection it always got. Deepgram allows 500 tokens of key terms in all; the
// caps below stay well under that. (DEEPGRAM_LISTEN_URL exists for the tests.)
const DEEPGRAM_LISTEN_URL = process.env.DEEPGRAM_LISTEN_URL || 'wss://api.deepgram.com/v1/listen';
const DEEPGRAM_MODELS = { medical: 'nova-3-medical' };
function deepgramOptions(reqUrl) {
    let q;
    try { q = new URL(reqUrl || '/', 'http://relay.local').searchParams; } catch (e) { q = new URLSearchParams(); }
    const model = DEEPGRAM_MODELS[q.get('model')] || 'nova-3';
    const keyterms = [];
    let chars = 0;
    for (const raw of q.getAll('keyterm')) {
        const term = String(raw).replace(/\s+/g, ' ').trim();
        if (!/^[A-Za-z0-9][A-Za-z0-9 .'\/-]{1,39}$/.test(term) || keyterms.includes(term)) continue;
        if (keyterms.length >= 50 || chars + term.length > 900) break;
        keyterms.push(term);
        chars += term.length;
    }
    return { model, keyterms };
}

wss.on('connection', (browserWs, req) => {
    const dgKey = process.env.DEEPGRAM_API_KEY;
    if (!dgKey) {
        browserWs.close(4001, 'DEEPGRAM_API_KEY not configured');
        return;
    }

    const { model, keyterms } = deepgramOptions(req.url);
    console.log('🎙️ Deepgram relay: browser connected (' + model + (keyterms.length ? ', ' + keyterms.length + ' key terms' : '') + ')');

    // Open upstream connection to Deepgram
    const dgUrl = DEEPGRAM_LISTEN_URL + '?' + [
        'model=' + model,
        'diarize=true',
        'punctuate=true',
        'interim_results=true',
        'utterance_end_ms=1500',
        'encoding=linear16',
        'sample_rate=16000',
        'channels=1'
    ].concat(keyterms.map((term) => 'keyterm=' + encodeURIComponent(term))).join('&');

    const dgWs = new WebSocket(dgUrl, {
        headers: { 'Authorization': `Token ${dgKey}` }
    });

    let dgReady = false;

    dgWs.on('open', () => {
        dgReady = true;
        console.log('🎙️ Deepgram relay: upstream connected');
    });

    // Relay audio from browser → Deepgram
    browserWs.on('message', (data, isBinary) => {
        if (dgReady && dgWs.readyState === WebSocket.OPEN) {
            dgWs.send(data);
        }
    });

    // Relay transcripts from Deepgram → browser
    dgWs.on('message', (data) => {
        if (browserWs.readyState === WebSocket.OPEN) {
            browserWs.send(data.toString());
        }
    });

    // Browser disconnects → close Deepgram
    browserWs.on('close', () => {
        console.log('🎙️ Deepgram relay: browser disconnected');
        if (dgWs.readyState === WebSocket.OPEN) {
            dgWs.send(JSON.stringify({ type: 'CloseStream' }));
            dgWs.close();
        }
    });

    // Deepgram disconnects → close browser
    dgWs.on('close', (code, reason) => {
        console.log(`🎙️ Deepgram relay: upstream closed (${code})`);
        if (browserWs.readyState === WebSocket.OPEN) {
            browserWs.close();
        }
    });

    // Error handling
    dgWs.on('error', (err) => {
        console.error('🎙️ Deepgram relay error:', err.message);
        if (browserWs.readyState === WebSocket.OPEN) {
            browserWs.close(4002, 'Deepgram connection error');
        }
    });

    browserWs.on('error', (err) => {
        console.error('🎙️ Browser WS error:', err.message);
        if (dgWs.readyState === WebSocket.OPEN) {
            dgWs.close();
        }
    });
});

// --- Glasses HUD state endpoint ---
// The G2 companion app polls this to get the latest clinical display data.
// The main app POSTs state here; the companion app GETs it.
let glassesState = null;

app.post('/api/glasses-state', (req, res) => {
    glassesState = req.body;
    glassesState._updatedAt = Date.now();
    res.json({ ok: true });
});

app.get('/api/glasses-state', (req, res) => {
    if (!glassesState) {
        return res.status(404).json({ error: 'No glasses state available' });
    }
    res.json(glassesState);
});

// --- Start server ---
server.listen(PORT, () => {
    console.log(`Acting Intern server running on http://localhost:${PORT}`);
    console.log(`Anthropic API key: ${process.env.ANTHROPIC_API_KEY ? 'configured' : 'NOT SET'}`);
    console.log(`Full-site API key: ${process.env.ANTHROPIC_API_KEY_FULLSITE ? 'configured' : 'NOT SET (the full site uses the shared key)'}`);
    console.log(`Deepgram API key: ${process.env.DEEPGRAM_API_KEY ? 'configured' : 'NOT SET'}`);
});
