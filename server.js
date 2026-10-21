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

// --- Deepgram WebSocket relay ---
const wss = new WebSocket.Server({ server, path: '/ws/transcribe' });

wss.on('connection', (browserWs, req) => {
    const dgKey = process.env.DEEPGRAM_API_KEY;
    if (!dgKey) {
        browserWs.close(4001, 'DEEPGRAM_API_KEY not configured');
        return;
    }

    console.log('🎙️ Deepgram relay: browser connected');

    // Open upstream connection to Deepgram
    const dgUrl = 'wss://api.deepgram.com/v1/listen?' + [
        'model=nova-3',
        'diarize=true',
        'punctuate=true',
        'interim_results=true',
        'utterance_end_ms=1500',
        'encoding=linear16',
        'sample_rate=16000',
        'channels=1'
    ].join('&');

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
