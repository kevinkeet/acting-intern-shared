require('dotenv').config();
const express = require('express');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// --- Parse JSON bodies (up to 1MB for large prompts) ---
app.use(express.json({ limit: '1mb' }));

// --- Static file serving (frontend) ---
app.use(express.static(path.join(__dirname, '.')));

// --- Health check ---
app.get('/api/health', (req, res) => {
    res.json({
        status: 'ok',
        apiConfigured: !!process.env.ANTHROPIC_API_KEY
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

// --- Start server ---
app.listen(PORT, () => {
    console.log(`Acting Intern server running on http://localhost:${PORT}`);
    console.log(`Anthropic API key: ${process.env.ANTHROPIC_API_KEY ? 'configured' : 'NOT SET — add to .env'}`);
});
